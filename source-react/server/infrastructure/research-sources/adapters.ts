import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import yauzl from "yauzl";
import {
  normalizePublicResearchUrl,
  type NewsDiscoveryResult,
  type ResearchCandidate,
  type ResearchExcelTarget,
  type ResearchPlanQuestion,
  type ResearchSourceReference,
  type ResearchSourceSnapshot,
  type ResearchSourceType,
} from "../../domain/research-validation";
import {
  dartViewerUrl,
  parseDartViewerNodes,
  type DartStatementCode,
} from "../../domain/dart-original-statement";
import {
  fetchKrxClosingPrice,
  type KrxMarket,
} from "../market-data/krx";
import { collectFnGuideConsensus } from "../market-data/fnguide";
import {
  createWorkerDownloadUrl,
  putImmutableObject,
  readObjectBytes,
} from "../object-storage/s3";
import { resolveDartAccountRule } from "../../domain/dart-account-registry";
import {
  demoModeEnabled,
  scriptedResearchEnabled,
} from "../../domain/demo-mode";
import {
  DEMO_COMPANY,
  DEMO_FILINGS,
  DEMO_IR_URL,
  Q1_2026_NET_INCOME,
  Q1_2026_OPERATING_INCOME,
  Q1_2026_REVENUE,
  dartFilingUrl,
  demoAmountForAccount,
  demoDartAccount,
  demoDartStatementHtml,
  demoDartSummary,
  demoFilingForPeriod,
  demoIrQuote,
  demoIrSummary,
} from "../../domain/demo-research-fixture";

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
  workbookConsensusFallback?: Array<{
    sheetId: string;
    sheetName: string;
    address: string;
    label: string;
    displayValue: string;
    rawValue: unknown;
    formula: string | null;
  }>;
  newsDiscoveryResults?: NewsDiscoveryResult[];
  cancellationSignal?: AbortSignal;
  allowEmpty?: boolean;
};

function consensusScope(context: ResearchCollectionContext): "C" | "P" {
  const hasConsolidatedTarget = context.excelTargets.some(
    (target) => target.included && target.scopeCode === "CFS",
  );
  const hasSeparateTarget = context.excelTargets.some(
    (target) => target.included && target.scopeCode === "OFS",
  );
  const questionText = context.questions
    .filter((question) => question.included)
    .map((question) => question.text)
    .join(" ");
  if (
    !hasConsolidatedTarget &&
    (hasSeparateTarget ||
      (/별도/.test(questionText) && !/연결/.test(questionText)))
  ) {
    return "P";
  }
  return "C";
}

function workbookConsensusSource(
  context: ResearchCollectionContext,
): ResearchSourceSnapshot | null {
  const cells = (context.workbookConsensusFallback ?? []).filter(
    (cell) =>
      cell.displayValue.trim().length > 0 &&
      !/^#(?:N\/A|VALUE|REF|DIV\/0)/i.test(cell.displayValue.trim()),
  );
  if (cells.length === 0) return null;
  const content = {
    providerRole: "uploaded_excel_fallback",
    warning:
      "FnGuide 직접 수집 실패 시에만 사용하는 이전 분기 Excel 내 컨센서스 스냅샷입니다.",
    cutoffDate: context.cutoffDate,
    scope: consensusScope(context) === "C" ? "CFS" : "OFS",
    latest: Object.fromEntries(
      cells.map((cell) => [
        `${cell.sheetId}!${cell.address}`,
        cell.displayValue,
      ]),
    ),
    cells,
  };
  const questionIds = context.questions
    .filter(
      (question) =>
        question.included &&
        question.sourceBindingIds.includes("FNGUIDE_CONSENSUS"),
    )
    .map((question) => question.questionId);
  return {
    sourceKey: `excel-consensus-fallback:${context.projectId}:${hash(content).slice(0, 24)}`,
    sourceType: "FNGUIDE_CONSENSUS",
    title: `${context.companyName} 업로드 Excel 컨센서스 (보조)`,
    publisher: "사용자 업로드 Excel",
    canonicalUrl: null,
    publishedAt: null,
    collectedAt: nowIso(),
    responseHash: hash(content),
    locator: {
      kind: "workbook_consensus_fallback",
      provenance: "uploaded_previous_quarter_excel",
      questionIds,
      cellCount: cells.length,
    },
    content,
    collectorVersion: "uploaded-workbook-consensus-fallback-v1",
  };
}

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
    cancellationSignal?: AbortSignal;
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
      signal: input.cancellationSignal
        ? AbortSignal.any([
            AbortSignal.timeout(20_000),
            input.cancellationSignal,
          ])
        : AbortSignal.timeout(20_000),
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
  const maxBytes =
    input.sourceType === "NEWS" ? 5 * 1024 * 1024 : 50 * 1024 * 1024;
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new Error(
      input.sourceType === "NEWS"
        ? "NEWS_ARTICLE_UNREADABLE"
        : "SOURCE_TOO_LARGE",
    );
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.byteLength > maxBytes) {
    throw new Error(
      input.sourceType === "NEWS"
        ? "NEWS_ARTICLE_UNREADABLE"
        : "SOURCE_TOO_LARGE",
    );
  }
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
    (input.sourceType !== "NEWS" && publishedHeader
      ? new Date(publishedHeader).toISOString()
      : null);
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
    artifactObjectKey: pdfObjectKey,
    parserVersion: pdf?.parser.version ?? null,
    collectorVersion: pdf ? "public-pdf-v1" : "public-url-v1",
  };
  return source;
}

export type ArticleMetadata = {
  canonicalUrl: string;
  title: string;
  publisher: string;
  publishedAt: string;
  modifiedAt: string | null;
  availableAt: string;
  datePrecision: "second" | "minute" | "day";
  body: string;
  parserVersion: string;
};

function decodeHtmlEntities(value: string): string {
  const named: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    hellip: "…",
    lt: "<",
    nbsp: " ",
    quot: '"',
  };
  return value
    .replace(
      /&(#x[0-9a-f]+|#\d+|[a-z]+);/gi,
      (entity, token: string) => {
        if (token.startsWith("#x")) {
          const codePoint = Number.parseInt(token.slice(2), 16);
          return codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : entity;
        }
        if (token.startsWith("#")) {
          const codePoint = Number.parseInt(token.slice(1), 10);
          return codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : entity;
        }
        return named[token.toLowerCase()] ?? entity;
      },
    )
    .normalize("NFC");
}

function tagAttribute(tag: string, name: string): string | null {
  const match = new RegExp(
    `\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
    "i",
  ).exec(tag);
  return decodeHtmlEntities(match?.[1] ?? match?.[2] ?? match?.[3] ?? "").trim() || null;
}

function metaContent(html: string, key: string): string | null {
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = match[0];
    const property = tagAttribute(tag, "property") ?? tagAttribute(tag, "name");
    if (property?.toLowerCase() === key.toLowerCase()) {
      return tagAttribute(tag, "content");
    }
  }
  return null;
}

function canonicalHref(html: string, baseUrl: string): string | null {
  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = match[0];
    if (
      tagAttribute(tag, "rel")
        ?.toLowerCase()
        .split(/\s+/)
        .includes("canonical")
    ) {
      const href = tagAttribute(tag, "href");
      if (!href) continue;
      try {
        return normalizePublicResearchUrl(new URL(href, baseUrl).toString());
      } catch {
        return null;
      }
    }
  }
  return null;
}

function jsonLdObjects(html: string): Record<string, unknown>[] {
  const objects: Record<string, unknown>[] = [];
  for (const match of html.matchAll(
    /<script\b[^>]*type\s*=\s*(?:"application\/ld\+json"|'application\/ld\+json')[^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    try {
      const parsed = JSON.parse(decodeHtmlEntities(match[1]).trim()) as unknown;
      const visit = (value: unknown) => {
        if (Array.isArray(value)) {
          value.forEach(visit);
        } else if (value && typeof value === "object") {
          const object = value as Record<string, unknown>;
          objects.push(object);
          if (Array.isArray(object["@graph"])) visit(object["@graph"]);
        }
      };
      visit(parsed);
    } catch {
      // Invalid JSON-LD is ignored; other page metadata can still identify the article.
    }
  }
  return objects;
}

function articleJsonLd(
  objects: Record<string, unknown>[],
): Record<string, unknown> | null {
  return (
    objects.find((object) => {
      const rawType = object["@type"];
      const types = Array.isArray(rawType) ? rawType : [rawType];
      return types.some(
        (value) =>
          typeof value === "string" &&
          ["NewsArticle", "ReportageNewsArticle", "Article"].includes(value),
      );
    }) ?? null
  );
}

function nestedString(value: unknown, key?: string): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (value && typeof value === "object" && key) {
    const nested = (value as Record<string, unknown>)[key];
    return typeof nested === "string" ? nested.trim() || null : null;
  }
  return null;
}

function stripHtml(value: string): string {
  return decodeHtmlEntities(
    value
      .replace(
        /<(script|style|noscript|svg|form|nav|header|footer)\b[^>]*>[\s\S]*?<\/\1>/gi,
        " ",
      )
      .replace(/<br\b[^>]*>|<\/p>|<\/div>|<\/li>|<\/h[1-6]>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function articleBody(
  html: string,
  article: Record<string, unknown> | null,
): string {
  const structured = nestedString(article?.articleBody);
  if (structured && structured.length >= 200) return structured.slice(0, 200_000);
  const articleElement = /<article\b[^>]*>([\s\S]*?)<\/article>/i.exec(html)?.[1];
  return stripHtml(articleElement ?? html).slice(0, 200_000);
}

function addOneKstDay(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day));
  next.setUTCDate(next.getUTCDate() + 1);
  return `${next.toISOString().slice(0, 10)}T00:00:00+09:00`;
}

function articleTimestamp(rawValue: string): {
  publishedAt: string;
  availableAt: string;
  datePrecision: "second" | "minute" | "day";
} {
  const raw = rawValue.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return {
      publishedAt: `${raw}T00:00:00+09:00`,
      availableAt: addOneKstDay(raw),
      datePrecision: "day",
    };
  }
  const withTimezone =
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(raw)
      ? `${raw}+09:00`
      : raw;
  const timestamp = new Date(withTimezone);
  if (Number.isNaN(timestamp.getTime())) {
    throw new Error("NEWS_ARTICLE_DATE_MISSING");
  }
  return {
    publishedAt: timestamp.toISOString(),
    availableAt: timestamp.toISOString(),
    datePrecision: /T\d{2}:\d{2}:\d{2}/.test(raw) ? "second" : "minute",
  };
}

export function extractArticleMetadata(
  source: ResearchSourceSnapshot,
): ArticleMetadata {
  const html =
    typeof source.content.body === "string" ? source.content.body : "";
  const contentType =
    typeof source.content.contentType === "string"
      ? source.content.contentType.toLowerCase()
      : "";
  if (!contentType.includes("text/html") || !html) {
    throw new Error("NEWS_ARTICLE_NOT_NEWS");
  }
  const objects = jsonLdObjects(html);
  const article = articleJsonLd(objects);
  const openGraphType = metaContent(html, "og:type")?.toLowerCase();
  const hasArticleElement = /<article\b/i.test(html);
  if (!article && openGraphType !== "article" && !hasArticleElement) {
    throw new Error("NEWS_ARTICLE_NOT_NEWS");
  }
  const title =
    nestedString(article?.headline) ??
    metaContent(html, "og:title") ??
    decodeHtmlEntities(/<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "")
      .replace(/\s+/g, " ")
      .trim();
  const publisher =
    nestedString(article?.publisher, "name") ??
    metaContent(html, "og:site_name") ??
    (source.canonicalUrl ? new URL(source.canonicalUrl).hostname : "");
  const publishedRaw =
    nestedString(article?.datePublished) ??
    metaContent(html, "article:published_time") ??
    Array.from(html.matchAll(/<time\b[^>]*>/gi))
      .map((match) => tagAttribute(match[0], "datetime"))
      .find(Boolean) ??
    null;
  if (!title || !publisher || !publishedRaw) {
    throw new Error("NEWS_ARTICLE_DATE_MISSING");
  }
  const timestamp = articleTimestamp(publishedRaw);
  const modifiedRaw =
    nestedString(article?.dateModified) ??
    metaContent(html, "article:modified_time");
  const modifiedAt = modifiedRaw
    ? articleTimestamp(modifiedRaw).publishedAt
    : null;
  const body = articleBody(html, article);
  if (body.length < 200) throw new Error("NEWS_ARTICLE_UNREADABLE");
  let canonicalUrl =
    canonicalHref(html, source.canonicalUrl ?? "") ?? source.canonicalUrl ?? "";
  const structuredUrl =
    nestedString(article?.url) ??
    nestedString(article?.mainEntityOfPage, "@id");
  if (structuredUrl) {
    try {
      canonicalUrl = normalizePublicResearchUrl(
        new URL(structuredUrl, canonicalUrl).toString(),
      );
    } catch {
      // Keep the verified final or link canonical URL.
    }
  }
  return {
    canonicalUrl,
    title,
    publisher,
    ...timestamp,
    modifiedAt,
    body,
    parserVersion: "reflo-news-html-v1",
  };
}

async function putResearchHtml(
  projectId: string,
  html: string,
): Promise<string> {
  const bytes = Buffer.from(html, "utf8");
  const digest = createHash("sha256").update(bytes).digest("hex");
  const objectKey = `immutable/${projectId}/research-public/${digest}.html`;
  try {
    await putImmutableObject({
      objectKey,
      body: bytes,
      mediaType: "text/html; charset=utf-8",
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

async function fetchNewsSource(
  result: NewsDiscoveryResult,
  context: ResearchCollectionContext,
): Promise<ResearchSourceSnapshot> {
  const raw = await fetchPublicSource(result.url, context.cutoffAt, {
    projectId: context.projectId,
    sourceType: "NEWS",
    cancellationSignal: context.cancellationSignal,
  });
  const metadata = extractArticleMetadata(raw);
  const newsHost = new URL(metadata.canonicalUrl).hostname.toLowerCase();
  const excludedHosts = [
    "blog.naver.com",
    "cafe.naver.com",
    "brunch.co.kr",
    "medium.com",
    "tistory.com",
    "dcinside.com",
    "theqoo.net",
    "ppomppu.co.kr",
    "dart.fss.or.kr",
    "opendart.fss.or.kr",
    "kind.krx.co.kr",
  ];
  const normalizedPublisher = metadata.publisher
    .replace(/\s+/g, "")
    .toLocaleLowerCase("ko-KR");
  const normalizedCompany = context.companyName
    .replace(/\s+/g, "")
    .toLocaleLowerCase("ko-KR");
  if (
    excludedHosts.some(
      (host) => newsHost === host || newsHost.endsWith(`.${host}`),
    ) ||
    normalizedPublisher === normalizedCompany ||
    normalizedPublisher === `${normalizedCompany}뉴스룸` ||
    /보도자료|press release/i.test(metadata.title)
  ) {
    throw new Error("NEWS_ARTICLE_NOT_NEWS");
  }
  const available = Date.parse(metadata.availableAt);
  const start = Date.parse(result.publicationWindow.startAt);
  const end = Date.parse(result.publicationWindow.endAt);
  const cutoff = Date.parse(context.cutoffAt);
  if (
    !Number.isFinite(available) ||
    available < start ||
    available > end
  ) {
    throw new Error("NEWS_ARTICLE_OUTSIDE_WINDOW");
  }
  if (available > cutoff) throw new Error("NEWS_CUTOFF_VIOLATION");
  if (
    metadata.modifiedAt &&
    Date.parse(metadata.modifiedAt) > cutoff
  ) {
    throw new Error("NEWS_ARTICLE_MODIFIED_AFTER_CUTOFF");
  }
  const identityText =
    `${metadata.title}\n${metadata.body}`.toLocaleLowerCase("ko-KR");
  const companyTokens = [
    context.companyName.toLocaleLowerCase("ko-KR"),
    context.ticker,
  ].filter((token) => token.length >= 3);
  if (!companyTokens.some((token) => identityText.includes(token))) {
    throw new Error("SOURCE_COMPANY_MISMATCH");
  }
  const html = String(raw.content.body);
  const artifactObjectKey = await putResearchHtml(context.projectId, html);
  const content = {
    body: metadata.body,
    title: metadata.title,
    publisher: metadata.publisher,
    publishedAt: metadata.publishedAt,
    modifiedAt: metadata.modifiedAt,
  };
  return {
    sourceKey: `news:${hash(metadata.canonicalUrl).slice(0, 32)}`,
    sourceType: "NEWS",
    title: metadata.title,
    publisher: metadata.publisher,
    canonicalUrl: metadata.canonicalUrl,
    publishedAt: metadata.publishedAt,
    modifiedAt: metadata.modifiedAt,
    availableAt: metadata.availableAt,
    datePrecision: metadata.datePrecision,
    collectedAt: nowIso(),
    responseHash: hash({
      canonicalUrl: metadata.canonicalUrl,
      content,
      artifactObjectKey,
    }),
    locator: {
      kind: "html",
      canonicalUrl: metadata.canonicalUrl,
      questionIds: [result.questionId],
      queryId: result.queryId,
      queryText: result.queryText,
      providerCode: result.providerCode,
      providerResultId: result.providerResultId,
      resultRank: result.resultRank,
      artifactObjectKey,
    },
    content,
    artifactObjectKey,
    parserVersion: metadata.parserVersion,
    eligibilityPolicyVersion: result.policyVersion,
    collectorVersion: "news-auto-discovery-v1",
  };
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
    artifactObjectKey: reference.objectKey,
    parserVersion: extracted.parser.version,
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
    const periodPatterns = researchIrPeriods(context).flatMap(
      ({ year, quarter }) => {
        const shortYear = String(year).slice(-2);
        return [
          `${year}년 ${quarter}분기`,
          `${year}년${quarter}분기`,
          `${quarter}q${shortYear}`,
          `${shortYear}년 ${quarter}분기`,
          `${year} ${quarter}q`,
          `${year} q${quarter}`,
        ];
      },
    );
    if (!periodPatterns.some((period) => body.includes(period.toLowerCase()))) {
      throw new Error("SOURCE_PERIOD_MISMATCH");
    }
  }
}

export function researchIrPeriods(
  context: Pick<
    ResearchCollectionContext,
    "targetYear" | "targetQuarter" | "questions"
  >,
): Array<{ year: number; quarter: 1 | 2 | 3 | 4 }> {
  const periods = new Map<
    string,
    { year: number; quarter: 1 | 2 | 3 | 4 }
  >();
  const add = (year: number, quarter: number) => {
    if (
      year >= 2000 &&
      year <= 2100 &&
      quarter >= 1 &&
      quarter <= 4
    ) {
      periods.set(`${year}:${quarter}`, {
        year,
        quarter: quarter as 1 | 2 | 3 | 4,
      });
    }
  };
  const coordinates = (value: string) => [
    ...Array.from(
      value.matchAll(/(20\d{2})\s*년?\s*([1-4])\s*(?:분기|q)/gi),
      (match) => ({ year: Number(match[1]), quarter: Number(match[2]) }),
    ),
    ...Array.from(
      value.matchAll(/([1-4])\s*q\s*['’]?(20)?(\d{2})/gi),
      (match) => ({
        year: Number(`${match[2] ?? "20"}${match[3]}`),
        quarter: Number(match[1]),
      }),
    ),
    ...Array.from(
      value.matchAll(/(20\d{2})\s*q\s*([1-4])/gi),
      (match) => ({ year: Number(match[1]), quarter: Number(match[2]) }),
    ),
  ];

  add(context.targetYear, context.targetQuarter);
  for (const question of context.questions.filter(
    (item) =>
      item.included && item.sourceBindingIds.includes("COMPANY_IR"),
  )) {
    const baseCoordinates = coordinates(question.period);
    const bases =
      baseCoordinates.length > 0
        ? baseCoordinates
        : [{ year: context.targetYear, quarter: context.targetQuarter }];
    for (const base of bases) {
      add(base.year, base.quarter);
      if (/전년|yoy|year[- ]over[- ]year/i.test(question.comparison)) {
        add(base.year - 1, base.quarter);
      }
      if (/전분기|qoq|quarter[- ]over[- ]quarter/i.test(question.comparison)) {
        add(
          base.quarter === 1 ? base.year - 1 : base.year,
          base.quarter === 1 ? 4 : base.quarter - 1,
        );
      }
    }
    for (const comparison of coordinates(question.comparison)) {
      add(comparison.year, comparison.quarter);
    }
  }
  return [...periods.values()].sort(
    (left, right) =>
      right.year - left.year || right.quarter - left.quarter,
  );
}

type DartRow = {
  rcept_no?: string;
  reprt_code?: string;
  bsns_year?: string;
  corp_name?: string;
  account_id?: string;
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

type DartReportSnapshot = {
  businessYear: number;
  quarter: number;
  reportCode: string;
  receiptNumber: string;
  filingName: string;
  publishedAt: string;
  scopeCodes: Array<"CFS" | "OFS">;
  rows: Array<
    DartRow & {
      _reflo_period: string;
      _reflo_report_type: "annual" | "quarterly";
    }
  >;
  publicParameters: Array<Record<string, string>>;
  originalStatements?: DartOriginalStatement[];
};

type DartOriginalStatement = {
  scopeCode: "CFS" | "OFS";
  statementCode: DartStatementCode;
  title: string;
  viewerUrl: string;
  parameters: {
    receiptNumber: string;
    documentNumber: string;
    elementId: string;
    offset: string;
    length: string;
    dtd: string;
    tocNumber: string;
  };
  html: string;
  responseHash: string;
};

function dartPublishedAt(receiptNumber: string | undefined): string | null {
  const receiptDate = receiptNumber?.slice(0, 8);
  return receiptDate && /^\d{8}$/.test(receiptDate)
    ? `${receiptDate.slice(0, 4)}-${receiptDate.slice(4, 6)}-${receiptDate.slice(6, 8)}T00:00:00+09:00`
    : null;
}

type DartFiling = {
  rcept_no?: string;
  report_nm?: string;
  rcept_dt?: string;
};

function cutoffDateInKorea(cutoffAt: string): string {
  return new Date(Date.parse(cutoffAt) + 9 * 60 * 60 * 1_000)
    .toISOString()
    .slice(0, 10)
    .replaceAll("-", "");
}

function dartReportFilingPattern(
  businessYear: number,
  quarter: number,
): { name: string; period: RegExp; beginDate: string } {
  const month = quarter === 1 ? "03" : quarter === 2 ? "06" : quarter === 3 ? "09" : "12";
  return {
    name:
      quarter === 2
        ? "반기보고서"
        : quarter === 4
          ? "사업보고서"
          : "분기보고서",
    period: new RegExp(`\\(${businessYear}[.\\-/\\s]*${month}\\)`),
    beginDate: `${businessYear}${month}01`,
  };
}

async function latestDartFilingBeforeCutoff(input: {
  apiKey: string;
  corpCode: string;
  businessYear: number;
  quarter: number;
  scopeCode: "CFS" | "OFS";
  cutoffAt: string;
  cancellationSignal?: AbortSignal;
}): Promise<DartFiling | null> {
  const expected = dartReportFilingPattern(input.businessYear, input.quarter);
  const endDate = cutoffDateInKorea(input.cutoffAt);
  if (endDate < expected.beginDate) return null;
  const query = new URLSearchParams({
    crtfc_key: input.apiKey,
    corp_code: input.corpCode,
    bgn_de: expected.beginDate,
    end_de: endDate,
    pblntf_ty: "A",
    sort: "date",
    sort_mth: "desc",
    page_count: "100",
  });
  const response = await fetch(
    `https://opendart.fss.or.kr/api/list.json?${query}`,
    {
      signal: input.cancellationSignal
        ? AbortSignal.any([
            AbortSignal.timeout(20_000),
            input.cancellationSignal,
          ])
        : AbortSignal.timeout(20_000),
    },
  );
  if (!response.ok) throw new Error(`DART_LIST_HTTP_${response.status}`);
  const payload = (await response.json()) as {
    status?: string;
    list?: DartFiling[];
  };
  if (payload.status === "013") return null;
  if (payload.status !== "000" || !Array.isArray(payload.list)) {
    throw new Error(`DART_LIST_${payload.status ?? "INVALID_RESPONSE"}`);
  }
  return (
    payload.list
      .filter(
        (filing) =>
          /^\d{14}$/.test(filing.rcept_no ?? "") &&
          /^\d{8}$/.test(filing.rcept_dt ?? "") &&
          (filing.report_nm ?? "").includes(expected.name) &&
          expected.period.test(filing.report_nm ?? ""),
      )
      .sort(
        (left, right) =>
          String(right.rcept_dt).localeCompare(String(left.rcept_dt)) ||
          String(right.rcept_no).localeCompare(String(left.rcept_no)),
      )[0] ?? null
  );
}

async function fetchDartReport(input: {
  apiKey: string;
  corpCode: string;
  businessYear: number;
  quarter: number;
  scopeCode: "CFS" | "OFS";
  cutoffAt: string;
  required: boolean;
  cancellationSignal?: AbortSignal;
}): Promise<DartReportSnapshot | null> {
  const code = reportCode(input.quarter);
  const filing = await latestDartFilingBeforeCutoff(input);
  if (!filing) {
    if (input.required) throw new Error("DART_REPORT_OUTSIDE_CUTOFF");
    return null;
  }
  const query = new URLSearchParams({
    crtfc_key: input.apiKey,
    corp_code: input.corpCode,
    bsns_year: String(input.businessYear),
    reprt_code: code,
    fs_div: input.scopeCode,
  });
  const response = await fetch(
    `https://opendart.fss.or.kr/api/fnlttSinglAcntAll.json?${query}`,
    {
      signal: input.cancellationSignal
        ? AbortSignal.any([
            AbortSignal.timeout(20_000),
            input.cancellationSignal,
          ])
        : AbortSignal.timeout(20_000),
    },
  );
  if (!response.ok) throw new Error(`DART_HTTP_${response.status}`);
  const payload = (await response.json()) as {
    status?: string;
    message?: string;
    list?: DartRow[];
  };
  if (payload.status === "013" && !input.required) return null;
  if (payload.status !== "000" || !Array.isArray(payload.list)) {
    throw new Error(`DART_${payload.status ?? "INVALID_RESPONSE"}`);
  }
  if (
    payload.list.some(
      (row) =>
        row.fs_div &&
        row.fs_div.toUpperCase() !== input.scopeCode,
    )
  ) {
    throw new Error("DART_SCOPE_MISMATCH");
  }
  const receiptNumber =
    payload.list.find((row) => /^\d{14}$/.test(row.rcept_no ?? ""))
      ?.rcept_no ?? "";
  const publishedAt = dartPublishedAt(filing.rcept_no);
  if (
    receiptNumber !== filing.rcept_no ||
    !publishedAt ||
    new Date(publishedAt).getTime() > new Date(input.cutoffAt).getTime()
  ) {
    if (input.required) throw new Error("DART_REPORT_OUTSIDE_CUTOFF");
    return null;
  }
  const publicQuery = new URLSearchParams(query);
  publicQuery.set("crtfc_key", "[redacted]");
  const annual = input.quarter === 4;
  const period = annual
    ? `${input.businessYear}년 연간`
    : `${input.businessYear}년 ${input.quarter}분기`;
  return {
    businessYear: input.businessYear,
    quarter: input.quarter,
    reportCode: code,
    receiptNumber,
    filingName: filing.report_nm ?? "",
    publishedAt,
    scopeCodes: [input.scopeCode],
    rows: payload.list.map((row) => ({
      ...row,
      // The response is scoped by the fs_div request parameter, but DART
      // can omit fs_div on each successful row. Retain the requested scope
      // for deterministic matching and the eventual Evidence locator.
      fs_div: row.fs_div?.toUpperCase() ?? input.scopeCode,
      _reflo_period: period,
      _reflo_report_type: annual ? "annual" : "quarterly",
    })),
    publicParameters: [Object.fromEntries(publicQuery)],
  };
}

async function fetchDartOriginalStatements(input: {
  receiptNumber: string;
  scopeCodes: Array<"CFS" | "OFS">;
  cancellationSignal?: AbortSignal;
}): Promise<DartOriginalStatement[]> {
  const headers = {
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.7,en;q=0.6",
    Connection: "close",
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
      "AppleWebKit/537.36 (KHTML, like Gecko) " +
      "Chrome/138.0.0.0 Safari/537.36",
  };
  const mainUrl =
    `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${input.receiptNumber}`;
  const signal = input.cancellationSignal
    ? AbortSignal.any([
        AbortSignal.timeout(20_000),
        input.cancellationSignal,
      ])
    : AbortSignal.timeout(20_000);
  const mainResponse = await fetch(mainUrl, {
    headers,
    signal,
  });
  if (!mainResponse.ok) {
    throw new Error(`DART_ORIGINAL_MAIN_HTTP_${mainResponse.status}`);
  }
  const mainHtml = await mainResponse.text();
  if (Buffer.byteLength(mainHtml, "utf8") > 5 * 1024 * 1024) {
    throw new Error("DART_ORIGINAL_MAIN_TOO_LARGE");
  }
  const requestedScopes = new Set(input.scopeCodes);
  const nodes = parseDartViewerNodes(mainHtml).filter(
    (node) =>
      node.receiptNumber === input.receiptNumber &&
      requestedScopes.has(node.scopeCode),
  );
  const uniqueNodes = [
    ...new Map(
      nodes.map((node) => [
        `${node.scopeCode}:${node.statementCode}`,
        node,
      ]),
    ).values(),
  ];
  const settled = await Promise.allSettled(
    uniqueNodes.map(async (node): Promise<DartOriginalStatement> => {
      const viewerUrl = dartViewerUrl(node);
      const response = await fetch(viewerUrl, {
        headers,
        signal: input.cancellationSignal
          ? AbortSignal.any([
              AbortSignal.timeout(20_000),
              input.cancellationSignal,
            ])
          : AbortSignal.timeout(20_000),
      });
      if (!response.ok) {
        throw new Error(`DART_ORIGINAL_VIEWER_HTTP_${response.status}`);
      }
      const html = await response.text();
      if (
        Buffer.byteLength(html, "utf8") > 2 * 1024 * 1024 ||
        !/<table\b/i.test(html)
      ) {
        throw new Error("DART_ORIGINAL_VIEWER_INVALID");
      }
      return {
        scopeCode: node.scopeCode,
        statementCode: node.statementCode,
        title: node.title,
        viewerUrl,
        parameters: {
          receiptNumber: node.receiptNumber,
          documentNumber: node.documentNumber,
          elementId: node.elementId,
          offset: node.offset,
          length: node.length,
          dtd: node.dtd,
          tocNumber: node.tocNumber,
        },
        html,
        responseHash: hash({ viewerUrl, html }),
      };
    }),
  );
  return settled.flatMap((result) =>
    result.status === "fulfilled" ? [result.value] : [],
  );
}

async function collectDart(
  context: ResearchCollectionContext,
): Promise<ResearchSourceSnapshot[]> {
  const apiKey = process.env.OPENDART_API_KEY?.trim();
  if (!apiKey) throw new Error("DART_API_KEY_MISSING");
  const corpCode =
    context.corpCode ?? (await dartCorpCode(context.ticker, apiKey));
  const requestedPeriods = new Map<
    string,
    {
      businessYear: number;
      quarter: 1 | 2 | 3 | 4;
      scopeCode: "CFS" | "OFS";
    }
  >();
  const requestPeriod = (
    businessYear: number,
    quarter: 1 | 2 | 3 | 4,
    scopeCode: "CFS" | "OFS" = "CFS",
  ) => {
    requestedPeriods.set(`${businessYear}:${quarter}:${scopeCode}`, {
      businessYear,
      quarter,
      scopeCode,
    });
  };
  const hypothesisUsesDart = context.questions.some(
    (question) =>
      question.included && question.sourceBindingIds.includes("DART"),
  );
  if (hypothesisUsesDart) {
    requestPeriod(context.targetYear - 1, 4);
    requestPeriod(
      context.targetYear,
      context.targetQuarter as 1 | 2 | 3 | 4,
    );
    if (context.targetQuarter > 1) {
      requestPeriod(
        context.targetYear,
        (context.targetQuarter - 1) as 1 | 2 | 3,
      );
    }
    const hypothesisUsesQoq = context.questions.some(
      (question) =>
        question.included &&
        question.sourceBindingIds.includes("DART") &&
        /전분기|qoq|quarter[- ]over[- ]quarter/i.test(question.comparison),
    );
    if (hypothesisUsesQoq && context.targetQuarter === 1) {
      requestPeriod(context.targetYear - 1, 3);
    } else if (hypothesisUsesQoq && context.targetQuarter > 2) {
      requestPeriod(
        context.targetYear,
        (context.targetQuarter - 2) as 1 | 2,
      );
    }
  }
  for (const target of context.excelTargets.filter(
    (item) =>
      item.included &&
      item.periodSpec &&
      item.sourcePolicy.some(
        (policy) =>
          policy.role === "authority" && policy.sourceType === "DART",
      ),
  )) {
    const period = target.periodSpec!;
    const quarter =
      period.type === "annual" ? 4 : (period.quarter ?? 4);
    requestPeriod(period.year, quarter, target.scopeCode ?? "CFS");
    if (period.basis === "single_quarter" && quarter > 1) {
      requestPeriod(
        period.year,
        (quarter - 1) as 1 | 2 | 3,
        target.scopeCode ?? "CFS",
      );
    }
  }
  if (requestedPeriods.size === 0) {
    requestPeriod(context.targetYear - 1, 4);
  }
  const settled = await Promise.allSettled(
    [...requestedPeriods.values()].map((period) =>
      fetchDartReport({
        apiKey,
        corpCode,
        businessYear: period.businessYear,
        quarter: period.quarter,
        scopeCode: period.scopeCode,
        cutoffAt: context.cutoffAt,
        required: false,
        cancellationSignal: context.cancellationSignal,
      }),
    ),
  );
  const collectedReports = settled.flatMap((result) =>
    result.status === "fulfilled" && result.value ? [result.value] : [],
  );
  const reportByFiling = new Map<string, DartReportSnapshot>();
  for (const report of collectedReports) {
    const key =
      `${report.businessYear}:${report.reportCode}:` +
      report.receiptNumber;
    const current = reportByFiling.get(key);
    if (!current) {
      reportByFiling.set(key, report);
      continue;
    }
    current.rows.push(...report.rows);
    current.publicParameters.push(...report.publicParameters);
    current.scopeCodes = [
      ...new Set([...current.scopeCodes, ...report.scopeCodes]),
    ];
  }
  const reports = [...reportByFiling.values()];
  if (reports.length === 0) {
    const failure = settled.find(
      (result): result is PromiseRejectedResult =>
        result.status === "rejected",
    );
    throw failure?.reason instanceof Error
      ? failure.reason
      : new Error("DART_REPORTS_UNAVAILABLE");
  }
  await Promise.all(
    reports.map(async (report) => {
      report.originalStatements = await fetchDartOriginalStatements({
        receiptNumber: report.receiptNumber,
        scopeCodes: report.scopeCodes,
        cancellationSignal: context.cancellationSignal,
      });
    }),
  );
  return reports.map((report) => ({
    sourceKey:
      `dart:${corpCode}:${report.businessYear}:${report.reportCode}:` +
      `${report.receiptNumber}:${report.scopeCodes.sort().join("+")}`,
    sourceType: "DART" as const,
    title:
      `${context.companyName} ${report.businessYear}년 ` +
      `${report.quarter === 4 ? "사업보고서" : `${report.quarter}분기보고서`} 재무제표`,
    publisher: "금융감독원 전자공시시스템",
    canonicalUrl: `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${report.receiptNumber}`,
    publishedAt: report.publishedAt,
    collectedAt: nowIso(),
    responseHash: hash(report),
    locator: {
      kind: "structured_api",
      endpoint: "/api/fnlttSinglAcntAll.json",
      parameters: report.publicParameters,
      rceptNo: report.receiptNumber,
      publishedAt: report.publishedAt,
    },
    content: {
      report: {
        corpCode,
        businessYear: report.businessYear,
        quarter: report.quarter,
        reportCode: report.reportCode,
        receiptNumber: report.receiptNumber,
        filingName: report.filingName,
        publishedAt: report.publishedAt,
        scopeCodes: report.scopeCodes,
      },
      rows: report.rows,
      originalStatements: report.originalStatements,
    },
    collectorVersion: "opendart-fnltt-original-viewer-v4",
  }));
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
  if (!result.sourceRow) {
    throw new Error("KRX_SOURCE_ROW_MISSING");
  }
  const content = {
    ...result,
    selectedRow: result.sourceRow,
  };
  return {
    sourceKey: `krx:${context.ticker}:${result.tradingDate}`,
    sourceType: "KRX",
    title: `${context.companyName} 기준일 종가`,
    publisher: "한국거래소",
    canonicalUrl: "https://data.krx.co.kr/",
    publishedAt: `${result.tradingDate}T15:30:00+09:00`,
    collectedAt: nowIso(),
    responseHash: hash(content),
    locator: {
      kind: "structured_api",
      endpoint: "KRX Open API 일별매매정보",
      parameters: { ticker: context.ticker, tradingDate: result.tradingDate },
      jsonPointer: "/selectedRow/TDD_CLSPRC",
      selectedRecord: "selectedRow",
    },
    content,
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
  const response = await fetch(url, {
    signal: context.cancellationSignal
      ? AbortSignal.any([
          AbortSignal.timeout(20_000),
          context.cancellationSignal,
        ])
      : AbortSignal.timeout(20_000),
  });
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
  const latestSelection = rows
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => {
      const time = String(row.TIME ?? "");
      return /^\d{8}$/.test(time) && time <= end;
    })
    .sort((left, right) =>
      String(right.row.TIME ?? "").localeCompare(String(left.row.TIME ?? "")),
    )[0];
  if (!latestSelection) throw new Error("ECOS_NO_DATA_BEFORE_CUTOFF");
  const latest = latestSelection.row;
  const latestTime = String(latest.TIME);
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
      jsonPointer: `/StatisticSearch/row/${latestSelection.index}/DATA_VALUE`,
      selectedRecord: "latest",
    },
    content: { rows, latest },
    collectorVersion: "ecos-statistic-search-v1",
  };
}

type DemoQuestionSource = {
  source: ResearchSourceSnapshot;
  quote: string;
  title: string;
  oneLineValue: string;
  valueOriginal: string | null;
  valueNormalized: string | null;
  unit: string | null;
  currency: string | null;
  valueKind: string | null;
};

/**
 * 시연용 DART 공시 근거.
 *
 * 실제 2026년 1분기 분기보고서(접수번호 20260514001471)의 연결 손익계산서
 * 값을 그대로 쓴다. `rows`가 있어야 STEP 05가 계정·기간·정규화 값을 붙일 수
 * 있고, `originalStatements`가 있어야 공시 원문 표가 렌더된다. 둘 중 하나라도
 * 없으면 "원문 표가 보관되어 있지 않습니다" 경고만 남는다.
 */
function demoDartQuestionSource(
  context: ResearchCollectionContext,
  question: ResearchPlanQuestion,
  collectedAt: string,
): DemoQuestionSource {
  const filing = DEMO_FILINGS.quarter1_2026;
  const account = demoDartAccount(question.role);
  const accounts = [
    Q1_2026_REVENUE,
    Q1_2026_OPERATING_INCOME,
    Q1_2026_NET_INCOME,
  ];
  const currentLabel = `제 7 기 1분기`;
  const priorLabel = `제 6 기 1분기`;
  const rows = accounts.map((item) => ({
    rcept_no: filing.receiptNumber,
    reprt_code: filing.reportCode,
    bsns_year: String(filing.businessYear),
    corp_name: DEMO_COMPANY.corpName,
    account_id: item.accountId,
    account_nm: item.accountName,
    fs_div: "CFS",
    fs_nm: "연결재무제표",
    sj_div: "CIS",
    sj_nm: "포괄손익계산서",
    thstrm_nm: currentLabel,
    thstrm_amount: item.amount,
    frmtrm_nm: priorLabel,
    frmtrm_amount: item.priorAmount,
    currency: "KRW",
  }));
  const canonicalUrl = dartFilingUrl(filing.receiptNumber);
  return {
    quote: account.amount,
    title: account.accountName,
    oneLineValue: demoDartSummary(question.role),
    valueOriginal: account.amount,
    valueNormalized: account.amount,
    unit: "원",
    currency: "KRW",
    valueKind: "actual",
    source: {
      sourceKey: "",
      sourceType: "DART",
      title: `${DEMO_COMPANY.corpName} ${filing.filingName} 연결 포괄손익계산서`,
      publisher: "금융감독원 전자공시시스템",
      canonicalUrl,
      publishedAt: filing.publishedAt,
      collectedAt,
      responseHash: hash({ receiptNumber: filing.receiptNumber, rows }),
      locator: {
        kind: "structured_api",
        endpoint: "https://opendart.fss.or.kr/api/fnlttSinglAcntAll.json",
        rceptNo: filing.receiptNumber,
        canonicalUrl,
        questionIds: [question.questionId],
      },
      content: {
        report: {
          corpCode: context.corpCode ?? DEMO_COMPANY.corpCode,
          businessYear: filing.businessYear,
          quarter: filing.quarter,
          reportCode: filing.reportCode,
          receiptNumber: filing.receiptNumber,
          publishedAt: filing.publishedAt,
        },
        rows,
        originalStatements: [
          {
            scopeCode: "CFS",
            statementCode: "CIS",
            title: "연결 포괄손익계산서",
            viewerUrl: canonicalUrl,
            parameters: {
              receiptNumber: filing.receiptNumber,
              documentNumber: "",
              elementId: "",
              offset: "",
              length: "",
              dtd: "",
              tocNumber: "",
            },
            html: demoDartStatementHtml({
              periodLabel: `${filing.periodLabel} (2026.01.01 ~ 2026.03.31)`,
              currentLabel,
              priorLabel,
              accounts,
            }),
            responseHash: hash({ statement: "CIS", year: filing.businessYear }),
          },
        ],
      },
      collectorVersion: "research-demo-v1",
    },
  };
}

/** 시연용 기업 IR 근거. 업로드하는 IR 자료의 실제 서술을 인용한다. */
function demoIrQuestionSource(
  context: ResearchCollectionContext,
  question: ResearchPlanQuestion,
  collectedAt: string,
): DemoQuestionSource {
  const quote = demoIrQuote(question.role);
  return {
    quote,
    title: `${DEMO_COMPANY.corpName} 2026년 1분기 경영실적`,
    oneLineValue: demoIrSummary(question.role),
    valueOriginal: null,
    valueNormalized: null,
    unit: null,
    currency: null,
    valueKind: null,
    source: {
      sourceKey: "",
      sourceType: "COMPANY_IR",
      title: `${DEMO_COMPANY.corpName} 2026년 1분기 경영실적 발표자료`,
      publisher: `${DEMO_COMPANY.corpName} IR`,
      canonicalUrl: DEMO_IR_URL,
      publishedAt: "2026-04-30T09:00:00+09:00",
      collectedAt,
      responseHash: hash({ questionId: question.questionId, quote }),
      locator: {
        kind: "html",
        canonicalUrl: DEMO_IR_URL,
        textFragment: quote,
        questionIds: [question.questionId],
      },
      content: { body: quote },
      collectorVersion: "research-demo-v1",
    },
  };
}

/**
 * 고정 응답 원문에 붙일 출처 표기.
 *
 * STEP 05는 근거마다 발행기관과 원문 위치를 보여주므로, 모든 출처가 같은
 * "공식 자료 제공기관"으로 보이면 어떤 축의 근거인지 구분되지 않는다.
 */
function fixtureSourceLabel(sourceType: ResearchSourceType): {
  publisher: string;
  titleSuffix: string;
  evidencePhrase: string;
  canonicalUrl: string;
} {
  const labels: Partial<
    Record<
      ResearchSourceType,
      { publisher: string; titleSuffix: string; evidencePhrase: string }
    >
  > = {
    DART: {
      publisher: "금융감독원 전자공시시스템",
      titleSuffix: "분기보고서",
      evidencePhrase: "DART 공시 원문",
    },
    COMPANY_IR: {
      publisher: "기업 IR 자료",
      titleSuffix: "실적 발표 자료",
      evidencePhrase: "기업 IR 원문",
    },
    NEWS: {
      publisher: "공개 뉴스 원문",
      titleSuffix: "보도 기사",
      evidencePhrase: "뉴스 원문",
    },
    KRX: {
      publisher: "한국거래소",
      titleSuffix: "시세 자료",
      evidencePhrase: "KRX 시세 자료",
    },
    ECOS: {
      publisher: "한국은행 ECOS",
      titleSuffix: "통계 자료",
      evidencePhrase: "ECOS 통계",
    },
    FNGUIDE_CONSENSUS: {
      publisher: "FnGuide",
      titleSuffix: "컨센서스 자료",
      evidencePhrase: "FnGuide 컨센서스",
    },
    USER_MATERIAL: {
      publisher: "사용자 제공 자료",
      titleSuffix: "제공 원문",
      evidencePhrase: "사용자 제공 원문",
    },
  };
  const label = labels[sourceType] ?? {
    publisher: "공식 자료 제공기관",
    titleSuffix: "공식 자료",
    evidencePhrase: "공식 자료",
  };
  return {
    ...label,
    canonicalUrl: `https://example.com/reflo-fixture-source/${sourceType.toLowerCase()}`,
  };
}

function fixtureBundle(context: ResearchCollectionContext): CollectionBundle {
  const sources: ResearchSourceSnapshot[] = [];
  const candidates: ResearchCandidate[] = [];
  const collectedAt = nowIso();
  for (const question of context.questions.filter((item) => item.included)) {
    const metric = question.metrics[0] ?? question.purpose;
    // 시연 모드에서는 질문에 연결된 출처를 모두 재생해 STEP 05에서 DART 공시와
    // 기업 IR이 각각 근거로 보이게 한다. 테스트 fixture는 기존처럼 대표 출처
    // 하나만 만들어 근거 수가 늘어나지 않게 둔다.
    const questionSourceTypes = demoModeEnabled()
      ? (question.sourceBindingIds.length > 0
          ? question.sourceBindingIds
          : (["DART"] as const))
      : [question.sourceBindingIds[0] ?? "DART"];
    for (const sourceType of questionSourceTypes) {
      const label = fixtureSourceLabel(sourceType);
      // 시연에서는 실제 DART 공시 값과 IR 서술을 그대로 쓴다. 자리표시 문장만
      // 보여주면 근거를 눌렀을 때 값이 비어 있어 제품이 동작하지 않는 것처럼
      // 보인다. 테스트 fixture는 기업·분기가 달라 이 데이터를 쓸 수 없으므로
      // 기존 문구를 유지한다.
      const demo =
        demoModeEnabled() && sourceType === "DART"
          ? demoDartQuestionSource(context, question, collectedAt)
          : demoModeEnabled() && sourceType === "COMPANY_IR"
            ? demoIrQuestionSource(context, question, collectedAt)
            : null;
      const quote =
        demo?.quote ??
        `${context.targetYear}년 ${context.targetQuarter}분기 ${context.companyName}의 ${metric} 관련 내용이 ${label.evidencePhrase}에서 확인되었습니다.`;
      const sourceKey = `fixture:question:${question.questionId}:${sourceType}`;
      const source: ResearchSourceSnapshot = demo
        ? { ...demo.source, sourceKey }
        : {
            sourceKey,
            sourceType,
            title: `${context.companyName} ${metric} ${label.titleSuffix}`,
            publisher: label.publisher,
            canonicalUrl: label.canonicalUrl,
            publishedAt: `${context.cutoffDate}T09:00:00+09:00`,
            collectedAt,
            responseHash: hash({
              questionId: question.questionId,
              sourceType,
              quote,
            }),
            locator: {
              kind: "html",
              canonicalUrl: label.canonicalUrl,
              textFragment: quote,
              questionIds: [question.questionId],
            },
            // DART 원문은 검증에서 content.report.corpCode가 프로젝트 기업코드와
            // 같은지 본다(sourceMatchesResearchIdentity). 이 필드가 없으면 인용문이
            // 원문에 그대로 있어도 company 검사에서 걸러져 근거가 0건이 된다.
            content:
              sourceType === "DART" && context.corpCode
                ? { body: quote, report: { corpCode: context.corpCode } }
                : { body: quote },
            collectorVersion: "research-fixture-v1",
          };
      sources.push(source);
      candidates.push({
        candidateKey: `candidate:${question.questionId}:${sourceType}`,
        category: "hypothesis",
        questionId: question.questionId,
        targetId: null,
        metricId: metric,
        sourceKey,
        title: demo?.title ?? metric,
        quoteExact: quote,
        oneLineValue:
          demo?.oneLineValue ??
          `${metric} 관련 근거를 ${label.evidencePhrase}에서 확인했습니다.`,
        valueOriginal: demo?.valueOriginal ?? null,
        valueNormalized: demo?.valueNormalized ?? null,
        unit: demo?.unit ?? null,
        currency: demo?.currency ?? null,
        period: question.period,
        scope: "연결",
        valueKind: demo?.valueKind ?? null,
        stance: "supporting",
        required: true,
        criticalNumeric: false,
      });
    }
  }
  const dartTargets = context.excelTargets.filter(
    (target) =>
      target.included &&
      target.sourcePolicy.some(
        (policy) => policy.role === "authority" && policy.sourceType === "DART",
      ) &&
      target.periodSpec,
  );
  const dartPeriods = new Map<
    string,
    { year: number; quarter: 1 | 2 | 3 | 4; targets: ResearchExcelTarget[] }
  >();
  for (const target of dartTargets) {
    const spec = target.periodSpec!;
    const quarter = spec.type === "annual" ? 4 : (spec.quarter ?? 4);
    const key = `${spec.year}:${quarter}`;
    const current = dartPeriods.get(key) ?? {
      year: spec.year,
      quarter,
      targets: [],
    };
    current.targets.push(target);
    dartPeriods.set(key, current);
    if (spec.basis === "single_quarter" && quarter > 1) {
      const previousQuarter = (quarter - 1) as 1 | 2 | 3;
      const previousKey = `${spec.year}:${previousQuarter}`;
      if (!dartPeriods.has(previousKey)) {
        dartPeriods.set(previousKey, {
          year: spec.year,
          quarter: previousQuarter,
          targets: current.targets,
        });
      }
    }
  }
  for (const period of dartPeriods.values()) {
    const code = reportCode(period.quarter);
    // 합성 접수번호(YYYYQQ15000001)는 형식이 실제 DART 접수번호와 같아 뷰어가
    // 다른 회사의 공시를 열어버린다. 시연에서는 대덕전자의 실제 접수번호를 쓴다.
    const demoFiling = demoModeEnabled()
      ? demoFilingForPeriod(period.year, period.quarter)
      : null;
    const receiptNumber =
      demoFiling?.receiptNumber ??
      `${period.year}${String(period.quarter).padStart(2, "0")}15000001`;
    const publishedAt =
      demoFiling?.publishedAt ?? `${context.cutoffDate}T09:00:00+09:00`;
    const rows = period.targets.flatMap((target, index) => {
      const rule = resolveDartAccountRule(
        target.dartRuleId ?? target.metricId ?? target.metric,
      );
      if (!rule) return [];
      const accountName = rule.allowedAccountNames[0] ?? "";
      const demoAmount = demoFiling
        ? demoAmountForAccount(rule.allowedAccountIds[0], accountName)
        : null;
      return [{
        rcept_no: receiptNumber,
        reprt_code: code,
        bsns_year: String(period.year),
        corp_name: context.companyName,
        account_id: rule.allowedAccountIds[0],
        account_nm: accountName,
        fs_div: target.scopeCode ?? "CFS",
        fs_nm: "연결재무제표",
        sj_div: rule.allowedStatements[0],
        sj_nm: "재무제표",
        thstrm_nm: `${period.year}년 ${period.quarter}분기`,
        thstrm_amount:
          demoAmount ?? String(100_000_000_000 + index * 10_000_000_000),
        currency: "KRW",
      }];
    });
    sources.push({
      sourceKey: `fixture:dart:${period.year}:${code}`,
      sourceType: "DART",
      title: demoFiling
        ? `${context.companyName} ${demoFiling.filingName} 연결재무제표`
        : `${context.companyName} ${period.year}년 ${period.quarter}분기 재무제표`,
      publisher: "금융감독원 전자공시시스템",
      canonicalUrl: `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${receiptNumber}`,
      publishedAt,
      collectedAt,
      responseHash: hash(rows),
      locator: {
        kind: "structured_api",
        endpoint: "REFLO fixture",
        rceptNo: receiptNumber,
      },
      content: {
        report: {
          corpCode: context.corpCode ?? (demoFiling ? DEMO_COMPANY.corpCode : "fixture"),
          businessYear: period.year,
          quarter: period.quarter,
          reportCode: code,
          receiptNumber,
          publishedAt,
        },
        rows,
        // 원문 표가 없으면 STEP 05가 "원문 표가 보관되어 있지 않습니다"만 띄운다.
        ...(demoFiling
          ? {
              originalStatements: [
                {
                  scopeCode: "CFS",
                  statementCode: "CIS",
                  title: "연결 포괄손익계산서",
                  viewerUrl: `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${receiptNumber}`,
                  parameters: {
                    receiptNumber,
                    documentNumber: "",
                    elementId: "",
                    offset: "",
                    length: "",
                    dtd: "",
                    tocNumber: "",
                  },
                  html: demoDartStatementHtml({
                    periodLabel: demoFiling.periodLabel,
                    currentLabel: `${period.year}년 ${period.quarter}분기`,
                    priorLabel: `${period.year - 1}년 ${period.quarter}분기`,
                    accounts: rows.map((row) => ({
                      accountId: String(row.account_id ?? ""),
                      accountName: String(row.account_nm ?? ""),
                      amount: String(row.thstrm_amount ?? ""),
                      priorAmount: "",
                    })),
                  }),
                  responseHash: hash({ receiptNumber, statement: "CIS" }),
                },
              ],
            }
          : {}),
      },
      collectorVersion: "research-fixture-v2",
    });
  }
  const krxTargets = context.excelTargets.filter((target) =>
    target.sourcePolicy.some(
      (policy) => policy.role === "authority" && policy.sourceType === "KRX",
    ),
  );
  if (krxTargets.length > 0) {
    const closePrice = 100_000 + Number(context.ticker.slice(-3));
    const selectedRow = {
      BAS_DD: context.cutoffDate.replaceAll("-", ""),
      ISU_CD: context.ticker,
      ISU_NM: context.companyName,
      MKT_NM: context.exchange,
      TDD_CLSPRC: closePrice.toLocaleString("en-US"),
    };
    sources.push({
      sourceKey: `fixture:krx:${context.ticker}:${context.cutoffDate}`,
      sourceType: "KRX",
      title: `${context.companyName} 기준일 종가`,
      publisher: "한국거래소",
      canonicalUrl: "https://data.krx.co.kr/",
      publishedAt: `${context.cutoffDate}T15:30:00+09:00`,
      collectedAt,
      responseHash: hash({
        closePrice,
        tradingDate: context.cutoffDate,
        selectedRow,
      }),
      locator: {
        kind: "structured_api",
        endpoint: "REFLO fixture",
        parameters: { ticker: context.ticker },
        jsonPointer: "/selectedRow/TDD_CLSPRC",
        selectedRecord: "selectedRow",
      },
      content: {
        closePrice,
        tradingDate: context.cutoffDate,
        currency: "KRW",
        selectedRow,
      },
      collectorVersion: "research-fixture-v2",
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

function approvedNewsDiscoveryResults(
  context: ResearchCollectionContext,
): NewsDiscoveryResult[] {
  const questions = new Map(
    context.questions
      .filter(
        (question) =>
          question.included && question.sourceBindingIds.includes("NEWS"),
      )
      .map((question) => [question.questionId, question]),
  );
  const counts = new Map<string, number>();
  const seen = new Set<string>();
  const approved: NewsDiscoveryResult[] = [];
  for (const result of context.newsDiscoveryResults ?? []) {
    const question = questions.get(result.questionId);
    const policy = question?.newsSearchPolicy;
    if (!question || !policy) throw new Error("NEWS_QUERY_PLAN_INVALID");
    if (
      result.providerCode !== policy.providerCode ||
      result.policyVersion !== policy.policyVersion ||
      !policy.publicationWindows.some(
        (window) =>
          window.startAt === result.publicationWindow.startAt &&
          window.endAt === result.publicationWindow.endAt,
      )
    ) {
      throw new Error("NEWS_QUERY_PLAN_INVALID");
    }
    const normalizedUrl = normalizePublicResearchUrl(result.url);
    const key = `${result.questionId}:${normalizedUrl}`;
    const count = counts.get(result.questionId) ?? 0;
    if (seen.has(key) || count >= policy.fetchLimit) continue;
    seen.add(key);
    counts.set(result.questionId, count + 1);
    approved.push({ ...result, url: normalizedUrl });
  }
  return approved;
}

function retainDiverseNewsSources(
  sources: ResearchSourceSnapshot[],
  context: ResearchCollectionContext,
): ResearchSourceSnapshot[] {
  const merged = new Map<string, ResearchSourceSnapshot>();
  for (const source of sources) {
    const existing = merged.get(source.sourceKey);
    if (!existing) {
      merged.set(source.sourceKey, source);
      continue;
    }
    const questionIds = Array.from(
      new Set([
        ...((existing.locator.questionIds as string[] | undefined) ?? []),
        ...((source.locator.questionIds as string[] | undefined) ?? []),
      ]),
    );
    existing.locator = { ...existing.locator, questionIds };
  }
  const policies = new Map(
    context.questions
      .filter((question) => question.newsSearchPolicy)
      .map((question) => [question.questionId, question.newsSearchPolicy!]),
  );
  const retainedByQuestion = new Map<string, number>();
  const publisherByQuestion = new Map<string, Map<string, number>>();
  const retained: ResearchSourceSnapshot[] = [];
  const ordered = Array.from(merged.values()).sort(
    (left, right) =>
      Number(left.locator.resultRank ?? Number.MAX_SAFE_INTEGER) -
      Number(right.locator.resultRank ?? Number.MAX_SAFE_INTEGER),
  );
  for (const source of ordered) {
    const eligibleQuestions: string[] = [];
    for (const questionId of
      (source.locator.questionIds as string[] | undefined) ?? []) {
      const policy = policies.get(questionId);
      if (!policy) continue;
      const retainedCount = retainedByQuestion.get(questionId) ?? 0;
      const publisherCounts =
        publisherByQuestion.get(questionId) ?? new Map<string, number>();
      const publisherKey = source.publisher.toLocaleLowerCase("ko-KR");
      if (
        retainedCount >= policy.retainLimit ||
        (publisherCounts.get(publisherKey) ?? 0) >= policy.perPublisherLimit
      ) {
        continue;
      }
      eligibleQuestions.push(questionId);
      retainedByQuestion.set(questionId, retainedCount + 1);
      publisherCounts.set(
        publisherKey,
        (publisherCounts.get(publisherKey) ?? 0) + 1,
      );
      publisherByQuestion.set(questionId, publisherCounts);
    }
    if (eligibleQuestions.length > 0) {
      retained.push({
        ...source,
        locator: { ...source.locator, questionIds: eligibleQuestions },
      });
    }
  }
  return retained;
}

export async function collectResearchSources(
  context: ResearchCollectionContext,
): Promise<CollectionBundle> {
  if (scriptedResearchEnabled()) {
    return fixtureBundle(context);
  }
  const selected = selectedSourceTypes(context);
  const warnings: CollectionBundle["warnings"] = [];
  const sources: ResearchSourceSnapshot[] = [];
  const tasks: Array<Promise<ResearchSourceSnapshot[]>> = [];
  if (selected.has("DART")) tasks.push(collectDart(context));
  if (selected.has("KRX")) tasks.push(collectKrx(context).then((source) => [source]));
  if (selected.has("ECOS")) tasks.push(collectEcos(context).then((source) => [source]));
  if (selected.has("FNGUIDE_CONSENSUS")) {
    tasks.push(
      collectFnGuideConsensus({
        projectId: context.projectId,
        companyName: context.companyName,
        ticker: context.ticker,
        targetYear: context.targetYear,
        targetQuarter: context.targetQuarter,
        cutoffDate: context.cutoffDate,
        scope: consensusScope(context),
        cancellationSignal: context.cancellationSignal,
      })
        .then((source) => [source])
        .catch((error) => {
          const fallback = workbookConsensusSource(context);
          if (!fallback) throw error;
          warnings.push({
            code: "FNGUIDE_EXCEL_FALLBACK_USED",
            message:
              "FnGuide 직접 수집에 실패해 업로드 Excel의 컨센서스 스냅샷을 보조 근거로 사용했습니다.",
          });
          return [fallback];
        }),
    );
  }
  if (selected.has("NEWS")) {
    for (const result of approvedNewsDiscoveryResults(context)) {
      tasks.push(fetchNewsSource(result, context).then((source) => [source]));
    }
  }
  for (const reference of context.sourceReferences) {
    if (!selected.has(reference.sourceType)) continue;
    if (reference.sourceType === "NEWS") continue;
    tasks.push(
      (
        reference.ingestionMethod === "user_upload"
          ? collectUploadedMaterial(reference, context)
          : fetchPublicSource(reference.canonicalUrl ?? "", context.cutoffAt, {
              projectId: context.projectId,
              sourceType: reference.sourceType,
              title: reference.title,
              publisher: reference.publisher,
              publishedAt: reference.publishedAt,
              cancellationSignal: context.cancellationSignal,
            }).then((source) => {
              assertMaterialIdentity(source, context);
              return source;
            })
      ).then((source) => [source]),
    );
  }
  for (const url of context.userUrls) {
    tasks.push(
      fetchPublicSource(url, context.cutoffAt, {
         projectId: context.projectId,
         sourceType: "USER_MATERIAL",
         cancellationSignal: context.cancellationSignal,
       }).then((source) => [source]),
    );
  }
  const settled = await Promise.allSettled(tasks);
  for (const result of settled) {
    if (result.status === "fulfilled" && result.value) {
      sources.push(...result.value);
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
  const nonNewsSources = sources.filter((source) => source.sourceType !== "NEWS");
  const newsSources = retainDiverseNewsSources(
    sources.filter((source) => source.sourceType === "NEWS"),
    context,
  );
  sources.splice(0, sources.length, ...nonNewsSources, ...newsSources);
  for (let index = 0; index < sources.length; index += 1) {
    const source = sources[index];
    if (!source) continue;
    const linkedQuestionIds = context.questions
      .filter(
        (question) =>
          question.included &&
          question.sourceBindingIds.includes(source.sourceType),
      )
      .map((question) => question.questionId);
    if (linkedQuestionIds.length === 0) continue;
    sources[index] = {
      ...source,
      locator: {
        ...source.locator,
        questionIds: Array.from(
          new Set([
            ...(
              Array.isArray(source.locator.questionIds)
                ? source.locator.questionIds.filter(
                    (value): value is string => typeof value === "string",
                  )
                : []
            ),
            ...linkedQuestionIds,
          ]),
        ),
      },
    };
  }
  if (sources.length === 0) {
    if (context.allowEmpty) {
      return { sources: [], candidates: [], warnings };
    }
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
    "FNGUIDE_CONSENSUS",
    "USER_MATERIAL",
  ] as const) {
    if (selected.has(sourceType) && !collectedTypes.has(sourceType)) {
      warnings.push({
        code:
          sourceType === "NEWS"
            ? "NEWS_NO_ELIGIBLE_ARTICLES"
            : "REQUIRED_SOURCE_UNAVAILABLE",
        message:
          sourceType === "NEWS"
            ? "승인 기간 안에서 검증 가능한 뉴스 원문을 확보하지 못했습니다."
            : `${sourceType} 원문을 확보하지 못했습니다.`,
      });
    }
  }
  for (const question of context.questions.filter((item) => item.included)) {
    if (
      question.sourceBindingIds.includes("NEWS") &&
      !sources.some(
        (source) =>
          source.sourceType === "NEWS" &&
          (
            (source.locator.questionIds as string[] | undefined) ?? []
          ).includes(question.questionId),
      )
    ) {
      warnings.push({
        code: "NEWS_NO_ELIGIBLE_ARTICLES",
        message: `${question.questionId} 질문의 검증 가능한 뉴스 원문을 확보하지 못했습니다.`,
      });
    }
    if (
      !question.sourceBindingIds.some((sourceType) =>
        collectedTypes.has(sourceType),
      )
    ) {
      warnings.push({
        code: "QUESTION_SOURCE_UNAVAILABLE",
        message: `${question.questionId} 질문에 연결된 원문을 확보하지 못했습니다.`,
      });
    }
  }
  for (const target of context.excelTargets.filter(
    (item) => item.included && item.required,
  )) {
    const authorityTypes = target.sourcePolicy
      .filter((policy) => policy.role === "authority")
      .map((policy) => policy.sourceType);
    if (
      !context.allowEmpty &&
      (authorityTypes.length === 0 ||
        !authorityTypes.some((sourceType) => collectedTypes.has(sourceType)))
    ) {
      throw new Error(`EXCEL_SOURCE_UNAVAILABLE:${target.targetId}`);
    }
  }
  return { sources, candidates: [], warnings };
}
