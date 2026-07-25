import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import yauzl from "yauzl";
import {
  normalizePublicResearchUrl,
  type ResearchCandidate,
  type ResearchExcelTarget,
  type ResearchPlanQuestion,
  type ResearchSourceReference,
  type ResearchSourceSnapshot,
  type ResearchSourceType,
} from "../../domain/research-validation";
import {
  fetchKrxClosingPrice,
  type KrxMarket,
} from "../market-data/krx";
import {
  createWorkerDownloadUrl,
  putImmutableObject,
  readObjectBytes,
} from "../object-storage/s3";

export type ResearchMaterialInput = ResearchSourceReference & {
  objectKey: string | null;
};

export type ResearchCollectionContext = {
  projectId: string;
  companyMasterId: string;
  companyName: string;
  corpCode: string | null;
  ticker: string;
  exchange: KrxMarket;
  targetYear: number;
  targetQuarter: number;
  cutoffDate: string;
  cutoffAt: string;
  questions: ResearchPlanQuestion[];
  excelTargets: ResearchExcelTarget[];
  userUrls: string[];
  sourceReferences: ResearchMaterialInput[];
};

export type CollectionBundle = {
  sources: ResearchSourceSnapshot[];
  candidates: ResearchCandidate[];
  warnings: Array<{ code: string; message: string }>;
};

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function reportCode(quarter: number): string {
  if (quarter === 1) return "11013";
  if (quarter === 2) return "11012";
  if (quarter === 3) return "11014";
  return "11011";
}

function nowIso(): string {
  return new Date().toISOString();
}

async function unzipFirstFile(bytes: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(
      bytes,
      { lazyEntries: true, validateEntrySizes: true },
      (error, zip) => {
        if (error || !zip) {
          reject(error ?? new Error("ZIP_OPEN_FAILED"));
          return;
        }
        zip.readEntry();
        zip.once("entry", (entry) => {
          zip.openReadStream(entry, (streamError, stream) => {
            if (streamError || !stream) {
              reject(streamError ?? new Error("ZIP_ENTRY_OPEN_FAILED"));
              return;
            }
            const chunks: Buffer[] = [];
            stream.on("data", (chunk: Buffer) => chunks.push(chunk));
            stream.on("end", () => {
              zip.close();
              resolve(Buffer.concat(chunks));
            });
            stream.on("error", reject);
          });
        });
        zip.once("end", () => reject(new Error("ZIP_EMPTY")));
        zip.once("error", reject);
      },
    );
  });
}

declare global {
  var __refloDartCorpCodeCache:
    | { expiresAt: number; byTicker: Map<string, string> }
    | undefined;
}

function xmlValue(block: string, name: string): string {
  return (
    new RegExp(`<${name}>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*</${name}>`).exec(
      block,
    )?.[1] ??
    new RegExp(`<${name}>\\s*([^<]*?)\\s*</${name}>`).exec(block)?.[1] ??
    ""
  ).trim();
}

async function dartCorpCode(ticker: string, apiKey: string): Promise<string> {
  const cached = globalThis.__refloDartCorpCodeCache;
  if (cached && cached.expiresAt > Date.now()) {
    const corpCode = cached.byTicker.get(ticker);
    if (!corpCode) throw new Error(`DART_CORP_CODE_NOT_FOUND:${ticker}`);
    return corpCode;
  }
  const endpoint = new URL("https://opendart.fss.or.kr/api/corpCode.xml");
  endpoint.searchParams.set("crtfc_key", apiKey);
  const response = await fetch(endpoint, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`DART_CORP_CODE_HTTP_${response.status}`);
  const archive = Buffer.from(await response.arrayBuffer());
  let xml: string;
  try {
    xml = (await unzipFirstFile(archive)).toString("utf8");
  } catch {
    throw new Error("DART_CORP_CODE_RESPONSE_INVALID");
  }
  const byTicker = new Map<string, string>();
  for (const match of xml.matchAll(/<list>([\s\S]*?)<\/list>/g)) {
    const stockCode = xmlValue(match[1], "stock_code");
    const corpCode = xmlValue(match[1], "corp_code");
    if (/^\d{6}$/.test(stockCode) && /^\d{8}$/.test(corpCode)) {
      byTicker.set(stockCode, corpCode);
    }
  }
  globalThis.__refloDartCorpCodeCache = {
    expiresAt: Date.now() + 24 * 60 * 60 * 1_000,
    byTicker,
  };
  const corpCode = byTicker.get(ticker);
  if (!corpCode) throw new Error(`DART_CORP_CODE_NOT_FOUND:${ticker}`);
  return corpCode;
}

type PdfInspection = {
  compatible?: boolean;
  issues?: Array<{ code?: string; severity?: string }>;
  parserName?: string;
  parserVersion?: string;
  templateIr?: {
    pages?: Array<{
      pageNumber?: number;
      objects?: Array<{
        type?: string;
        textRun?: { text?: string };
      }>;
    }>;
  };
};

async function extractPdfText(objectKey: string): Promise<{
  pages: Array<{ pageNumber: number; text: string }>;
  parser: { name: string; version: string };
}> {
  const downloadUrl = await createWorkerDownloadUrl(objectKey, 10 * 60);
  const response = await fetch(
    `${(process.env.REFLO_PDF_WORKER_URL || "http://127.0.0.1:8091").replace(/\/$/, "")}/inspect`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ downloadUrl }),
      signal: AbortSignal.timeout(120_000),
    },
  );
  if (!response.ok) {
    throw new Error(`SOURCE_PDF_PARSE_${response.status}`);
  }
  const result = (await response.json()) as PdfInspection;
  if (!result.compatible || !result.templateIr?.pages) {
    const blocking = result.issues
      ?.filter((issue) => issue.severity === "blocking")
      .map((issue) => issue.code)
      .filter(Boolean)
      .join(",");
    throw new Error(`SOURCE_PDF_INCOMPATIBLE${blocking ? `:${blocking}` : ""}`);
  }
  const pages = result.templateIr.pages.map((page, index) => ({
    pageNumber: Number(page.pageNumber ?? index + 1),
    text: (page.objects ?? [])
      .filter((object) => object.type === "text_run")
      .map((object) => object.textRun?.text ?? "")
      .filter(Boolean)
      .join("\n")
      .slice(0, 500_000),
  }));
  if (!pages.some((page) => page.text.trim())) {
    throw new Error("SOURCE_PDF_TEXT_LAYER_MISSING");
  }
  return {
    pages,
    parser: {
      name: result.parserName ?? "PyMuPDF",
      version: result.parserVersion ?? "unknown",
    },
  };
}

async function putResearchPdf(
  projectId: string,
  bytes: Buffer,
): Promise<string> {
  const digest = createHash("sha256").update(bytes).digest("hex");
  const objectKey = `immutable/${projectId}/research-public/${digest}.pdf`;
  try {
    await putImmutableObject({
      objectKey,
      body: bytes,
      mediaType: "application/pdf",
      metadata: { sha256: digest },
    });
  } catch (error) {
    const existing = await readObjectBytes(objectKey).catch(() => null);
    if (
      !existing ||
      createHash("sha256").update(existing).digest("hex") !== digest
    ) {
      throw error;
    }
  }
  return objectKey;
}

function literalPrivateIp(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  if (isIP(normalized) === 4) {
    const [a, b] = normalized.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    );
  }
  if (isIP(normalized) === 6) {
    return (
      normalized === "::" ||
      normalized === "::1" ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      /^fe[89ab]/.test(normalized)
    );
  }
  return false;
}

async function assertPublicResolution(url: URL): Promise<void> {
  const answers = await lookup(url.hostname, { all: true, verbatim: true });
  if (
    answers.length === 0 ||
    answers.some((answer) => literalPrivateIp(answer.address))
  ) {
    throw new Error("SOURCE_URL_PRIVATE_NETWORK");
  }
}

export async function fetchPublicSource(
  rawUrl: string,
  cutoffAt: string,
  input: {
    projectId: string;
    sourceType: ResearchSourceType;
    title?: string;
    publisher?: string;
    publishedAt?: string | null;
  },
): Promise<ResearchSourceSnapshot> {
  let current = new URL(normalizePublicResearchUrl(rawUrl));
  const redirectChain: string[] = [];
  let response: Response | null = null;
  for (let redirect = 0; redirect <= 5; redirect += 1) {
    await assertPublicResolution(current);
    response = await fetch(current, {
      redirect: "manual",
      headers: {
        Accept: "text/html,application/pdf,text/plain;q=0.9,*/*;q=0.1",
        "User-Agent": "REFLO-Research-Collector/1.0",
      },
      signal: AbortSignal.timeout(20_000),
    });
    if (![301, 302, 303, 307, 308].includes(response.status)) break;
    const location = response.headers.get("location");
    if (!location) throw new Error("SOURCE_REDIRECT_INVALID");
    redirectChain.push(current.toString());
    current = new URL(normalizePublicResearchUrl(new URL(location, current).toString()));
  }
  if (!response?.ok) {
    throw new Error(`SOURCE_HTTP_${response?.status ?? "UNAVAILABLE"}`);
  }
  const contentType = response.headers.get("content-type") ?? "application/octet-stream";
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.byteLength > 50 * 1024 * 1024) throw new Error("SOURCE_TOO_LARGE");
  const isPdf =
    contentType.toLowerCase().includes("application/pdf") ||
    bytes.subarray(0, 5).toString("ascii") === "%PDF-";
  const pdfObjectKey = isPdf
    ? await putResearchPdf(input.projectId, bytes)
    : null;
  const pdf = pdfObjectKey ? await extractPdfText(pdfObjectKey) : null;
  const body = pdf
    ? null
    : contentType.includes("text") || contentType.includes("json")
      ? bytes.toString("utf8").slice(0, 2_000_000)
      : `[binary ${contentType} ${bytes.byteLength} bytes]`;
  const publishedHeader =
    response.headers.get("last-modified") ?? response.headers.get("date");
  const publishedAt =
    input.publishedAt ??
    (publishedHeader ? new Date(publishedHeader).toISOString() : null);
  if (
    publishedAt &&
    new Date(publishedAt).getTime() > new Date(cutoffAt).getTime()
  ) {
    throw new Error("SOURCE_CUTOFF_VIOLATION");
  }
  const snapshot = {
    finalUrl: current.toString(),
    redirectChain,
    contentType,
    body,
    pages: pdf?.pages,
    parser: pdf?.parser,
    objectKey: pdfObjectKey,
  };
  const source: ResearchSourceSnapshot = {
    sourceKey: `url:${hash(current.toString()).slice(0, 32)}`,
    sourceType: input.sourceType,
    title: input.title ?? current.hostname,
    publisher: input.publisher ?? current.hostname,
    canonicalUrl: current.toString(),
    publishedAt,
    collectedAt: nowIso(),
    responseHash: hash(snapshot),
    locator: {
      kind: pdf ? "pdf" : "html",
      canonicalUrl: current.toString(),
      ...(pdfObjectKey ? { objectKey: pdfObjectKey, pageCount: pdf?.pages.length } : {}),
    },
    content: snapshot,
    collectorVersion: pdf ? "public-pdf-v1" : "public-url-v1",
  };
  return source;
}

async function collectUploadedMaterial(
  reference: ResearchMaterialInput,
  context: ResearchCollectionContext,
): Promise<ResearchSourceSnapshot> {
  if (!reference.objectKey) throw new Error("SOURCE_ARTIFACT_UNAVAILABLE");
  const extracted = await extractPdfText(reference.objectKey);
  const content = {
    pages: extracted.pages,
    parser: extracted.parser,
    sha256: reference.sha256,
    byteSize: reference.byteSize,
    originalFilename: reference.originalFilename,
  };
  const source: ResearchSourceSnapshot = {
    sourceKey: `upload:${reference.referenceId}`,
    sourceType: reference.sourceType,
    title: reference.title,
    publisher: reference.publisher,
    canonicalUrl: null,
    publishedAt: reference.publishedAt,
    collectedAt: nowIso(),
    responseHash: hash(content),
    locator: {
      kind: "pdf",
      referenceId: reference.referenceId,
      objectKey: reference.objectKey,
      pageCount: extracted.pages.length,
    },
    content,
    collectorVersion: "user-pdf-pymupdf-v1",
  };
  assertMaterialIdentity(source, context);
  return source;
}

function assertMaterialIdentity(
  source: ResearchSourceSnapshot,
  context: ResearchCollectionContext,
): void {
  if (source.publishedAt) {
    if (
      new Date(source.publishedAt).getTime() >
      new Date(context.cutoffAt).getTime()
    ) {
      throw new Error("SOURCE_CUTOFF_VIOLATION");
    }
  } else if (source.sourceType === "COMPANY_IR" || source.sourceType === "NEWS") {
    throw new Error("SOURCE_PUBLISHED_AT_MISSING");
  }
  if (source.sourceType !== "COMPANY_IR" && source.sourceType !== "NEWS") {
    return;
  }
  const body = JSON.stringify(source.content).toLocaleLowerCase("ko-KR");
  const companyTokens = [
    context.companyName.toLocaleLowerCase("ko-KR"),
    context.ticker,
  ].filter((token) => token.length >= 3);
  if (!companyTokens.some((token) => body.includes(token))) {
    throw new Error("SOURCE_COMPANY_MISMATCH");
  }
  if (source.sourceType === "COMPANY_IR") {
    const shortYear = String(context.targetYear).slice(-2);
    const quarter = String(context.targetQuarter);
    const periodPatterns = [
      `${context.targetYear}년 ${quarter}분기`,
      `${context.targetYear}년${quarter}분기`,
      `${quarter}q${shortYear}`,
      `${shortYear}년 ${quarter}분기`,
      `${context.targetYear} ${quarter}q`,
    ];
    if (!periodPatterns.some((period) => body.includes(period.toLowerCase()))) {
      throw new Error("SOURCE_PERIOD_MISMATCH");
    }
  }
}

type DartRow = {
  rcept_no?: string;
  reprt_code?: string;
  bsns_year?: string;
  corp_name?: string;
  account_nm?: string;
  fs_div?: string;
  fs_nm?: string;
  sj_div?: string;
  sj_nm?: string;
  thstrm_nm?: string;
  thstrm_amount?: string;
  frmtrm_nm?: string;
  frmtrm_amount?: string;
};

async function collectDart(
  context: ResearchCollectionContext,
): Promise<ResearchSourceSnapshot> {
  const apiKey = process.env.OPENDART_API_KEY?.trim();
  if (!apiKey) throw new Error("DART_API_KEY_MISSING");
  const corpCode =
    context.corpCode ?? (await dartCorpCode(context.ticker, apiKey));
  const query = new URLSearchParams({
    crtfc_key: apiKey,
    corp_code: corpCode,
    bsns_year: String(context.targetYear),
    reprt_code: reportCode(context.targetQuarter),
    fs_div: "CFS",
  });
  const endpoint = `https://opendart.fss.or.kr/api/fnlttSinglAcntAll.json?${query}`;
  const response = await fetch(endpoint, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`DART_HTTP_${response.status}`);
  const payload = (await response.json()) as {
    status?: string;
    message?: string;
    list?: DartRow[];
  };
  if (payload.status !== "000" || !Array.isArray(payload.list)) {
    throw new Error(`DART_${payload.status ?? "INVALID_RESPONSE"}`);
  }
  const publicQuery = new URLSearchParams(query);
  publicQuery.set("crtfc_key", "[redacted]");
  const receiptNumber = payload.list.find((row) =>
    /^\d{14}$/.test(row.rcept_no ?? ""),
  )?.rcept_no;
  const receiptDate = receiptNumber?.slice(0, 8);
  const publishedAt =
    receiptDate && /^\d{8}$/.test(receiptDate)
      ? `${receiptDate.slice(0, 4)}-${receiptDate.slice(4, 6)}-${receiptDate.slice(6, 8)}T00:00:00+09:00`
      : null;
  return {
    sourceKey: `dart:${corpCode}:${context.targetYear}:${reportCode(context.targetQuarter)}`,
    sourceType: "DART",
    title: `${context.companyName} ${context.targetYear}년 ${context.targetQuarter}분기 재무제표`,
    publisher: "금융감독원 전자공시시스템",
    canonicalUrl: receiptNumber
      ? `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${receiptNumber}`
      : "https://dart.fss.or.kr/",
    publishedAt,
    collectedAt: nowIso(),
    responseHash: hash(payload),
    locator: {
      kind: "structured_api",
      endpoint: "/api/fnlttSinglAcntAll.json",
      parameters: {
        ...Object.fromEntries(publicQuery),
        ...(receiptNumber ? { rceptNo: receiptNumber } : {}),
      },
    },
    content: { rows: payload.list },
    collectorVersion: "opendart-fnltt-v1",
  };
}

async function collectKrx(
  context: ResearchCollectionContext,
): Promise<ResearchSourceSnapshot> {
  const result = await fetchKrxClosingPrice({
    companyMasterId: context.companyMasterId,
    ticker: context.ticker,
    exchange: context.exchange,
    cutoffDate: context.cutoffDate,
  });
  if (result.status !== "available") {
    throw new Error(result.errorCode ?? "KRX_MARKET_PRICE_UNAVAILABLE");
  }
  return {
    sourceKey: `krx:${context.ticker}:${result.tradingDate}`,
    sourceType: "KRX",
    title: `${context.companyName} 기준일 종가`,
    publisher: "한국거래소",
    canonicalUrl: "https://data.krx.co.kr/",
    publishedAt: `${result.tradingDate}T15:30:00+09:00`,
    collectedAt: nowIso(),
    responseHash: hash(result),
    locator: {
      kind: "structured_api",
      endpoint: "KRX Open API 일별매매정보",
      parameters: { ticker: context.ticker, tradingDate: result.tradingDate },
      jsonPointer: "/OutBlock_1/0/TDD_CLSPRC",
    },
    content: result as unknown as Record<string, unknown>,
    collectorVersion: "krx-open-api-v1",
  };
}

async function collectEcos(
  context: ResearchCollectionContext,
): Promise<ResearchSourceSnapshot> {
  const apiKey = process.env.ECOS_API_KEY?.trim();
  if (!apiKey) throw new Error("ECOS_API_KEY_MISSING");
  const end = context.cutoffDate.replaceAll("-", "");
  const cutoff = new Date(`${context.cutoffDate}T00:00:00Z`);
  cutoff.setUTCDate(cutoff.getUTCDate() - 45);
  const start = cutoff.toISOString().slice(0, 10).replaceAll("-", "");
  const url =
    `https://ecos.bok.or.kr/api/StatisticSearch/${encodeURIComponent(apiKey)}` +
    `/json/kr/1/100/731Y001/D/${start}/${end}/0000001`;
  const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`ECOS_HTTP_${response.status}`);
  const payload = (await response.json()) as Record<string, unknown>;
  const rows =
    (
      payload.StatisticSearch as
        | { row?: Array<Record<string, unknown>> }
        | undefined
    )?.row ?? [];
  if (rows.length === 0) {
    const error = payload.RESULT as
      | { CODE?: string; MESSAGE?: string }
      | undefined;
    throw new Error(`ECOS_${error?.CODE ?? "NO_DATA"}`);
  }
  const latest = rows.at(-1)!;
  const latestTime = String(latest.TIME ?? end);
  const publishedAt = /^\d{8}$/.test(latestTime)
    ? `${latestTime.slice(0, 4)}-${latestTime.slice(4, 6)}-${latestTime.slice(6, 8)}T00:00:00+09:00`
    : `${context.cutoffDate}T00:00:00+09:00`;
  return {
    sourceKey: `ecos:731Y001:0000001:${latestTime}`,
    sourceType: "ECOS",
    title: "원/미국달러 환율",
    publisher: "한국은행 경제통계시스템",
    canonicalUrl: "https://ecos.bok.or.kr/",
    publishedAt,
    collectedAt: nowIso(),
    responseHash: hash(payload),
    locator: {
      kind: "structured_api",
      endpoint: "/api/StatisticSearch",
      parameters: {
        statCode: "731Y001",
        cycle: "D",
        itemCode: "0000001",
        period: `${start}-${end}`,
      },
      jsonPointer: `/StatisticSearch/row/${rows.length - 1}/DATA_VALUE`,
    },
    content: { rows, latest },
    collectorVersion: "ecos-statistic-search-v1",
  };
}

function fixtureBundle(context: ResearchCollectionContext): CollectionBundle {
  const sources: ResearchSourceSnapshot[] = [];
  const candidates: ResearchCandidate[] = [];
  const collectedAt = nowIso();
  for (const question of context.questions.filter((item) => item.included)) {
    const quote = `${context.targetYear}년 ${context.targetQuarter}분기 ${context.companyName}의 ${question.metrics[0]} 관련 공식 자료가 확인되었습니다.`;
    const source: ResearchSourceSnapshot = {
      sourceKey: `fixture:question:${question.questionId}`,
      sourceType: question.sourceBindingIds[0] ?? "DART",
      title: `${context.companyName} ${question.metrics[0]} 공식 자료`,
      publisher: question.sourceBindingIds[0] === "NEWS" ? "공개 뉴스 원문" : "공식 자료 제공기관",
      canonicalUrl: "https://example.com/reflo-fixture-source",
      publishedAt: `${context.cutoffDate}T09:00:00+09:00`,
      collectedAt,
      responseHash: hash({ questionId: question.questionId, quote }),
      locator: {
        kind: "html",
        canonicalUrl: "https://example.com/reflo-fixture-source",
        textFragment: quote,
      },
      content: { body: quote },
      collectorVersion: "research-fixture-v1",
    };
    sources.push(source);
    candidates.push({
      candidateKey: `candidate:${question.questionId}`,
      category: "hypothesis",
      questionId: question.questionId,
      targetId: null,
      sourceKey: source.sourceKey,
      title: question.metrics[0] ?? question.purpose,
      quoteExact: quote,
      oneLineValue: `${question.metrics[0]} 관련 공식 근거를 확인했습니다.`,
      valueOriginal: null,
      valueNormalized: null,
      unit: null,
      currency: null,
      period: question.period,
      scope: "연결",
      valueKind: null,
      stance: "supporting",
      required: true,
      criticalNumeric: false,
    });
  }
  for (const target of context.excelTargets.filter((item) => item.included)) {
    const normalized = String(1_000 + candidates.length * 100);
    const quote = `${target.metric}은 ${normalized}${target.unit}입니다.`;
    const source: ResearchSourceSnapshot = {
      sourceKey: `fixture:excel:${target.targetId}`,
      sourceType: target.sourcePolicy[0]?.sourceType ?? "DART",
      title: `${context.companyName} ${target.metric} 공시`,
      publisher: "금융감독원 전자공시시스템",
      canonicalUrl: "https://dart.fss.or.kr/",
      publishedAt: `${context.cutoffDate}T09:00:00+09:00`,
      collectedAt,
      responseHash: hash({ targetId: target.targetId, quote }),
      locator: {
        kind: "structured_api",
        endpoint: "REFLO fixture",
        jsonPointer: "/value",
      },
      content: { metric: target.metric, value: normalized, quote },
      collectorVersion: "research-fixture-v1",
    };
    sources.push(source);
    candidates.push({
      candidateKey: `candidate:${target.targetId}`,
      category: "excel",
      questionId: null,
      targetId: target.targetId,
      sourceKey: source.sourceKey,
      title: target.metric,
      quoteExact: quote,
      oneLineValue: `${Number(normalized).toLocaleString("ko-KR")}${target.unit}`,
      valueOriginal: normalized,
      valueNormalized: normalized,
      unit: target.unit,
      currency: target.unit.includes("원") ? "KRW" : null,
      period: target.period,
      scope: target.scope,
      valueKind: target.valueKind,
      stance: "supporting",
      required: target.required,
      criticalNumeric: true,
    });
  }
  return { sources, candidates, warnings: [] };
}

function selectedSourceTypes(context: ResearchCollectionContext): Set<ResearchSourceType> {
  return new Set([
    ...context.questions.flatMap((question) =>
      question.included ? question.sourceBindingIds : [],
    ),
    ...context.excelTargets.flatMap((target) =>
      target.included ? target.sourcePolicy.map((policy) => policy.sourceType) : [],
    ),
    ...(context.userUrls.length > 0 ? (["USER_MATERIAL"] as const) : []),
  ]);
}

export async function collectResearchSources(
  context: ResearchCollectionContext,
): Promise<CollectionBundle> {
  if (
    process.env.REFLO_RESEARCH_TEST_FIXTURE === "1" ||
    process.env.REFLO_LLM_TEST_FIXTURE === "1"
  ) {
    return fixtureBundle(context);
  }
  const selected = selectedSourceTypes(context);
  const warnings: CollectionBundle["warnings"] = [];
  const sources: ResearchSourceSnapshot[] = [];
  const tasks: Array<Promise<ResearchSourceSnapshot>> = [];
  if (selected.has("DART")) tasks.push(collectDart(context));
  if (selected.has("KRX")) tasks.push(collectKrx(context));
  if (selected.has("ECOS")) tasks.push(collectEcos(context));
  for (const reference of context.sourceReferences) {
    if (!selected.has(reference.sourceType)) continue;
    tasks.push(
      reference.ingestionMethod === "user_upload"
        ? collectUploadedMaterial(reference, context)
        : fetchPublicSource(reference.canonicalUrl ?? "", context.cutoffAt, {
            projectId: context.projectId,
            sourceType: reference.sourceType,
            title: reference.title,
            publisher: reference.publisher,
            publishedAt: reference.publishedAt,
          }).then((source) => {
            assertMaterialIdentity(source, context);
            return source;
          }),
    );
  }
  for (const url of context.userUrls) {
    tasks.push(
      fetchPublicSource(url, context.cutoffAt, {
        projectId: context.projectId,
        sourceType: "USER_MATERIAL",
      }),
    );
  }
  const settled = await Promise.allSettled(tasks);
  for (const result of settled) {
    if (result.status === "fulfilled" && result.value) {
      sources.push(result.value);
    } else if (result.status === "rejected") {
      warnings.push({
        code:
          result.reason instanceof Error &&
          /^[A-Z][A-Z0-9_:-]{2,200}$/.test(result.reason.message)
            ? result.reason.message.split(":")[0]
            : "SOURCE_COLLECTION_FAILED",
        message:
          result.reason instanceof Error
            ? result.reason.message.slice(0, 200)
            : "자료 수집에 실패했습니다.",
      });
    }
  }
  if (sources.length === 0) {
    throw new Error(
      `RESEARCH_NO_SOURCES${
        warnings.length > 0
          ? `:${warnings.map((warning) => warning.code).join(",")}`
          : ""
      }`,
    );
  }
  const collectedTypes = new Set(sources.map((source) => source.sourceType));
  for (const sourceType of [
    "COMPANY_IR",
    "NEWS",
    "USER_MATERIAL",
  ] as const) {
    if (selected.has(sourceType) && !collectedTypes.has(sourceType)) {
      throw new Error(`REQUIRED_SOURCE_UNAVAILABLE:${sourceType}`);
    }
  }
  for (const question of context.questions.filter((item) => item.included)) {
    if (
      !question.sourceBindingIds.some((sourceType) =>
        collectedTypes.has(sourceType),
      )
    ) {
      throw new Error(`QUESTION_SOURCE_UNAVAILABLE:${question.questionId}`);
    }
  }
  for (const target of context.excelTargets.filter(
    (item) => item.included && item.required,
  )) {
    const authorityTypes = target.sourcePolicy
      .filter((policy) => policy.role === "authority")
      .map((policy) => policy.sourceType);
    if (
      authorityTypes.length === 0 ||
      !authorityTypes.some((sourceType) => collectedTypes.has(sourceType))
    ) {
      throw new Error(`EXCEL_SOURCE_UNAVAILABLE:${target.targetId}`);
    }
  }
  return { sources, candidates: [], warnings };
}
