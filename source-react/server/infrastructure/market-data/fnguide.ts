import { createHash } from "node:crypto";
import type { ResearchSourceSnapshot } from "../../domain/research-validation";
import {
  putImmutableObject,
  readObjectBytes,
} from "../object-storage/s3";

const HOST = "https://wcomp.fnguide.com";
const PAGE_URL = `${HOST}/CompanyInfo/Consensus`;
const COLLECTOR_VERSION = "fnguide-companyinfo-consensus-v1";

type JsonRecord = Record<string, unknown>;

export type FnGuideCollectionInput = {
  projectId: string;
  companyName: string;
  ticker: string;
  targetYear: number;
  targetQuarter: number;
  cutoffDate: string;
  scope: "C" | "P";
  cancellationSignal?: AbortSignal;
};

function records(value: unknown): JsonRecord[] {
  if (Array.isArray(value)) {
    return value.filter(
      (item): item is JsonRecord =>
        Boolean(item) && typeof item === "object" && !Array.isArray(item),
    );
  }
  if (!value || typeof value !== "object") return [];
  const object = value as JsonRecord;
  for (const key of ["dataset", "Dataset", "data", "Data", "rows"]) {
    if (object[key] !== undefined) {
      const nested = records(object[key]);
      if (nested.length > 0) return nested;
    }
  }
  return [];
}

function text(value: unknown): string {
  return value === null || value === undefined ? "" : String(value).trim();
}

function fnGuideDate(value: unknown): string | null {
  const match = text(value).match(/^(\d{2}|\d{4})[./-](\d{2})[./-](\d{2})$/);
  if (!match) return null;
  const year = match[1]!.length === 2 ? `20${match[1]}` : match[1]!;
  return `${year}-${match[2]}-${match[3]}`;
}

function selectedYymm(value: unknown, targetYear: number): string {
  const values = records(value)
    .map((row) => text(row.YYMM ?? row.yymm))
    .filter((item) => /^\d{6}$/.test(item));
  return (
    values.find((item) => item.startsWith(String(targetYear))) ??
    values[0] ??
    `${targetYear}12`
  );
}

function cutoffPoint(value: unknown, cutoffDate: string): JsonRecord | null {
  return (
    records(value)
      .map((row) => ({
        row,
        date: fnGuideDate(row.TRD_DT ?? row.trd_dt ?? row.DATE),
      }))
      .filter(
        (item): item is { row: JsonRecord; date: string } =>
          typeof item.date === "string" && item.date <= cutoffDate,
      )
      .sort((left, right) => right.date.localeCompare(left.date))[0]?.row ?? null
  );
}

function cookies(headers: Headers): string {
  const values =
    typeof headers.getSetCookie === "function"
      ? headers.getSetCookie()
      : [headers.get("set-cookie") ?? ""];
  return values
    .map((value) => value.split(";")[0]?.trim())
    .filter(Boolean)
    .join("; ");
}

function signal(cancellationSignal?: AbortSignal): AbortSignal {
  return cancellationSignal
    ? AbortSignal.any([AbortSignal.timeout(20_000), cancellationSignal])
    : AbortSignal.timeout(20_000);
}

async function storeSnapshot(
  projectId: string,
  content: JsonRecord,
): Promise<{ objectKey: string; responseHash: string }> {
  const body = Buffer.from(JSON.stringify(content), "utf8");
  const responseHash = createHash("sha256").update(body).digest("hex");
  const objectKey = `immutable/${projectId}/research-fnguide/${responseHash}.json`;
  try {
    await putImmutableObject({
      objectKey,
      body,
      mediaType: "application/json; charset=utf-8",
      metadata: { sha256: responseHash, provider: "fnguide" },
    });
  } catch (error) {
    const existing = await readObjectBytes(objectKey).catch(() => null);
    if (
      !existing ||
      createHash("sha256").update(existing).digest("hex") !== responseHash
    ) {
      throw error;
    }
  }
  return { objectKey, responseHash };
}

export async function collectFnGuideConsensus(
  input: FnGuideCollectionInput,
): Promise<ResearchSourceSnapshot> {
  if (!/^\d{6}$/.test(input.ticker)) {
    throw new Error("FNGUIDE_TICKER_INVALID");
  }

  const pageUrl = `${PAGE_URL}?cmp_cd=${encodeURIComponent(input.ticker)}`;
  const page = await fetch(pageUrl, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36",
      "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.7",
    },
    signal: signal(input.cancellationSignal),
  });
  if (!page.ok) throw new Error(`FNGUIDE_PAGE_HTTP_${page.status}`);
  const cookie = cookies(page.headers);
  await page.arrayBuffer();

  const getJson = async (
    endpoint: string,
    parameters: Record<string, string | number>,
  ): Promise<unknown> => {
    const url = new URL(`/CompanyInfo/${endpoint}`, HOST);
    for (const [key, value] of Object.entries(parameters)) {
      url.searchParams.set(key, String(value));
    }
    const response = await fetch(url, {
      headers: {
        Accept: "application/json, text/javascript, */*; q=0.01",
        "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.7",
        Referer: pageUrl,
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36",
        "X-Requested-With": "XMLHttpRequest",
        ...(cookie ? { Cookie: cookie } : {}),
      },
      signal: signal(input.cancellationSignal),
    });
    if (!response.ok) {
      throw new Error(`FNGUIDE_${endpoint.toUpperCase()}_HTTP_${response.status}`);
    }
    return response.json();
  };

  const base = { cmp_cd: input.ticker, consol_typ: input.scope };
  const yymmPayload = await getJson("getCnsTrendYYMM", {
    ...base,
    freq_typ: "Y",
    data_typ: 1,
  });
  const yymm = selectedYymm(yymmPayload, input.targetYear);
  const [trend, ...payloads] = await Promise.all([
    getJson("getCnsTrend", {
      ...base,
      freq_typ: "Y",
      select_gsym: yymm,
      data_typ: 0,
    }),
    ...[0, 1, 2, 3, 4, 5].map((dataType) =>
      getJson("getCnsTrendChart", {
        ...base,
        freq_typ: "Y",
        select_gsym: yymm,
        data_typ: dataType,
      }),
    ),
    ...[1, 2, 3].map((dataType) =>
      getJson("getCnsPerforTrend", {
        ...base,
        freq_typ: "Q",
        data_typ: dataType,
      }),
    ),
    ...[1, 2, 3].map((dataType) =>
      getJson("getCnsPerforTrendChart", {
        ...base,
        freq_typ: "Q",
        data_typ: dataType,
      }),
    ),
  ]);

  const annualCharts = payloads.slice(0, 6);
  const quarterlyTables = payloads.slice(6, 9);
  const quarterlyCharts = payloads.slice(9, 12);
  const metricLabels = [
    "매출액",
    "영업이익",
    "당기순이익",
    "EPS",
    "PER",
    "PER(Fwd.12M)",
  ];
  const annualForecast = annualCharts.map((payload, dataType) => ({
    dataType,
    metric: metricLabels[dataType],
    unit: dataType <= 2 ? "억원" : dataType === 3 ? "원" : "배",
    selectedPoint: cutoffPoint(payload, input.cutoffDate),
  }));
  const dates = annualForecast
    .map((item) =>
      fnGuideDate(
        item.selectedPoint?.TRD_DT ??
          item.selectedPoint?.trd_dt ??
          item.selectedPoint?.DATE,
      ),
    )
    .filter((value): value is string => Boolean(value));
  if (!annualForecast.some((item) => item.selectedPoint)) {
    throw new Error("FNGUIDE_NO_DATA_BEFORE_CUTOFF");
  }
  const latest = Object.fromEntries(
    annualForecast.flatMap((item) =>
      item.selectedPoint?.VAL_AVG === null ||
      item.selectedPoint?.VAL_AVG === undefined
        ? []
        : [
            [
              `consensus_${String(item.metric).replaceAll(/[^A-Za-z0-9가-힣]+/g, "_")}`,
              item.selectedPoint.VAL_AVG,
            ],
          ],
    ),
  );

  const content: JsonRecord = {
    provider: "FnGuide CompanyInfo",
    providerRole: "consensus_primary",
    ticker: input.ticker,
    companyName: input.companyName,
    scope: input.scope === "C" ? "CFS" : "OFS",
    cutoffDate: input.cutoffDate,
    selectedYymm: yymm,
    latest: {
      companyName: input.companyName,
      ticker: input.ticker,
      scope: input.scope === "C" ? "CFS" : "OFS",
      observedAt: dates.sort().at(-1) ?? input.cutoffDate,
      ...latest,
    },
    annualForecast,
    quarterlyPerformance: {
      targetPeriod: `${input.targetYear}${input.targetQuarter}Q`,
      tables: quarterlyTables,
      charts: quarterlyCharts,
    },
    trend,
    raw: { yymm: yymmPayload, annualCharts },
  };
  const stored = await storeSnapshot(input.projectId, content);
  const publishedDate = dates.sort().at(-1) ?? input.cutoffDate;

  return {
    sourceKey:
      `fnguide:${input.ticker}:${input.scope}:${yymm}:${publishedDate}`,
    sourceType: "FNGUIDE_CONSENSUS",
    title: `${input.companyName} FnGuide 컨센서스`,
    publisher: "FnGuide",
    canonicalUrl: pageUrl,
    publishedAt: `${publishedDate}T00:00:00+09:00`,
    collectedAt: new Date().toISOString(),
    responseHash: stored.responseHash,
    locator: {
      kind: "structured_api",
      provider: "FnGuide",
      endpoint: "/CompanyInfo/getCnsTrend*",
      parameters: {
        cmp_cd: input.ticker,
        consol_typ: input.scope,
        select_gsym: yymm,
      },
      cutoffDate: input.cutoffDate,
      selectedRecord: "latest TRD_DT on or before cutoffDate",
    },
    content,
    artifactObjectKey: stored.objectKey,
    parserVersion: COLLECTOR_VERSION,
    eligibilityPolicyVersion: "fnguide-cutoff-v1",
    collectorVersion: COLLECTOR_VERSION,
  };
}
