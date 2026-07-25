import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import {
  normalizePublicResearchUrl,
  type ResearchCandidate,
  type ResearchExcelTarget,
  type ResearchPlanQuestion,
  type ResearchSourceSnapshot,
  type ResearchSourceType,
} from "../../domain/research-validation";
import {
  fetchKrxClosingPrice,
  type KrxMarket,
} from "../market-data/krx";

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
  const body =
    contentType.includes("text") || contentType.includes("json")
      ? bytes.toString("utf8").slice(0, 2_000_000)
      : `[binary ${contentType} ${bytes.byteLength} bytes]`;
  const publishedHeader =
    response.headers.get("last-modified") ?? response.headers.get("date");
  const publishedAt = publishedHeader
    ? new Date(publishedHeader).toISOString()
    : null;
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
  };
  return {
    sourceKey: `url:${hash(current.toString()).slice(0, 32)}`,
    sourceType: "USER_MATERIAL",
    title: current.hostname,
    publisher: current.hostname,
    canonicalUrl: current.toString(),
    publishedAt,
    collectedAt: nowIso(),
    responseHash: hash(snapshot),
    locator: { kind: "html", canonicalUrl: current.toString() },
    content: snapshot,
    collectorVersion: "public-url-v1",
  };
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
): Promise<ResearchSourceSnapshot | null> {
  const apiKey = process.env.OPENDART_API_KEY?.trim();
  if (!apiKey || !context.corpCode) return null;
  const query = new URLSearchParams({
    crtfc_key: apiKey,
    corp_code: context.corpCode,
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
  return {
    sourceKey: `dart:${context.corpCode}:${context.targetYear}:${reportCode(context.targetQuarter)}`,
    sourceType: "DART",
    title: `${context.companyName} ${context.targetYear}년 ${context.targetQuarter}분기 재무제표`,
    publisher: "금융감독원 전자공시시스템",
    canonicalUrl: "https://dart.fss.or.kr/",
    publishedAt: null,
    collectedAt: nowIso(),
    responseHash: hash(payload),
    locator: {
      kind: "structured_api",
      endpoint: "/api/fnlttSinglAcntAll.json",
      parameters: Object.fromEntries(publicQuery),
    },
    content: { rows: payload.list },
    collectorVersion: "opendart-fnltt-v1",
  };
}

async function collectKrx(
  context: ResearchCollectionContext,
): Promise<ResearchSourceSnapshot | null> {
  const result = await fetchKrxClosingPrice({
    companyMasterId: context.companyMasterId,
    ticker: context.ticker,
    exchange: context.exchange,
    cutoffDate: context.cutoffDate,
  });
  if (result.status !== "available") return null;
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
): Promise<ResearchSourceSnapshot | null> {
  const apiKey = process.env.ECOS_API_KEY?.trim();
  if (!apiKey) return null;
  const end = context.cutoffDate.replaceAll("-", "").slice(0, 6);
  const url =
    `https://ecos.bok.or.kr/api/StatisticSearch/${encodeURIComponent(apiKey)}` +
    `/json/kr/1/100/731Y001/M/${end}/${end}/0000001`;
  const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`ECOS_HTTP_${response.status}`);
  const payload = (await response.json()) as Record<string, unknown>;
  const rows =
    (
      payload.StatisticSearch as
        | { row?: Array<Record<string, unknown>> }
        | undefined
    )?.row ?? [];
  if (rows.length === 0) return null;
  return {
    sourceKey: `ecos:731Y001:0000001:${end}`,
    sourceType: "ECOS",
    title: "원/미국달러 환율",
    publisher: "한국은행 경제통계시스템",
    canonicalUrl: "https://ecos.bok.or.kr/",
    publishedAt: `${context.cutoffDate}T00:00:00+09:00`,
    collectedAt: nowIso(),
    responseHash: hash(payload),
    locator: {
      kind: "structured_api",
      endpoint: "/api/StatisticSearch",
      parameters: {
        statCode: "731Y001",
        cycle: "M",
        itemCode: "0000001",
        period: end,
      },
      jsonPointer: "/StatisticSearch/row/0/DATA_VALUE",
    },
    content: { rows },
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
  const tasks: Array<Promise<ResearchSourceSnapshot | null>> = [];
  if (selected.has("DART")) tasks.push(collectDart(context));
  if (selected.has("KRX")) tasks.push(collectKrx(context));
  if (selected.has("ECOS")) tasks.push(collectEcos(context));
  for (const url of context.userUrls) {
    tasks.push(fetchPublicSource(url, context.cutoffAt));
  }
  const settled = await Promise.allSettled(tasks);
  for (const result of settled) {
    if (result.status === "fulfilled" && result.value) {
      sources.push(result.value);
    } else if (result.status === "rejected") {
      warnings.push({
        code: "SOURCE_OPTIONAL_FAILED",
        message:
          result.reason instanceof Error
            ? result.reason.message.slice(0, 200)
            : "자료 수집에 실패했습니다.",
      });
    }
  }
  return { sources, candidates: [], warnings };
}
