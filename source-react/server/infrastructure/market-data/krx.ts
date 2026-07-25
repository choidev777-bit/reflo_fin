import { createHash } from "node:crypto";

export type KrxMarket = "KOSPI" | "KOSDAQ" | "KONEX" | "KRX";

export type MarketPriceRequest = {
  companyMasterId: string;
  ticker: string;
  exchange: KrxMarket;
  cutoffDate: string;
};

export type MarketPriceSnapshot = {
  schemaVersion: "1.0";
  provider: "KRX_OPEN_API";
  status: "available" | "unavailable";
  companyMasterId: string;
  ticker: string;
  exchange: KrxMarket;
  requestedDate: string;
  tradingDate: string | null;
  closePrice: number | null;
  currency: "KRW";
  sourceApiId: string | null;
  retrievedAt: string;
  sourcePayloadHash: string | null;
  errorCode: string | null;
  errorMessage: string | null;
};

type KrxDailyRow = {
  BAS_DD?: unknown;
  ISU_CD?: unknown;
  ISU_NM?: unknown;
  MKT_NM?: unknown;
  TDD_CLSPRC?: unknown;
};

type FetchLike = typeof fetch;

const API_IDS: Record<Exclude<KrxMarket, "KRX">, string> = {
  KOSPI: "stk_bydd_trd",
  KOSDAQ: "ksq_bydd_trd",
  KONEX: "knx_bydd_trd",
};

function previousDate(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

function compactDate(value: string): string {
  return value.replaceAll("-", "");
}

function normalizeTicker(value: unknown): string {
  return String(value ?? "")
    .trim()
    .replace(/^A/i, "")
    .padStart(6, "0");
}

function parseClosePrice(value: unknown): number | null {
  const parsed = Number(String(value ?? "").replaceAll(",", "").trim());
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function unavailable(
  request: MarketPriceRequest,
  errorCode: string,
  errorMessage: string,
  sourceApiId: string | null = null,
): MarketPriceSnapshot {
  return {
    schemaVersion: "1.0",
    provider: "KRX_OPEN_API",
    status: "unavailable",
    companyMasterId: request.companyMasterId,
    ticker: request.ticker,
    exchange: request.exchange,
    requestedDate: request.cutoffDate,
    tradingDate: null,
    closePrice: null,
    currency: "KRW",
    sourceApiId,
    retrievedAt: new Date().toISOString(),
    sourcePayloadHash: null,
    errorCode,
    errorMessage,
  };
}

function fixtureSnapshot(request: MarketPriceRequest): MarketPriceSnapshot {
  let tradingDate = request.cutoffDate;
  const date = new Date(`${tradingDate}T00:00:00.000Z`);
  while (date.getUTCDay() === 0 || date.getUTCDay() === 6) {
    tradingDate = previousDate(tradingDate, 1);
    date.setUTCDate(date.getUTCDate() - 1);
  }
  const closePrice = 100_000 + Number(request.ticker.slice(-3));
  const evidence = JSON.stringify({ tradingDate, closePrice, fixture: true });
  return {
    schemaVersion: "1.0",
    provider: "KRX_OPEN_API",
    status: "available",
    companyMasterId: request.companyMasterId,
    ticker: request.ticker,
    exchange: request.exchange,
    requestedDate: request.cutoffDate,
    tradingDate,
    closePrice,
    currency: "KRW",
    sourceApiId:
      request.exchange === "KRX"
        ? API_IDS.KOSPI
        : API_IDS[request.exchange],
    retrievedAt: new Date().toISOString(),
    sourcePayloadHash: createHash("sha256").update(evidence).digest("hex"),
    errorCode: null,
    errorMessage: null,
  };
}

export async function fetchKrxClosingPrice(
  request: MarketPriceRequest,
  options: {
    fetchImpl?: FetchLike;
    apiKey?: string;
    baseUrl?: string;
    maxLookbackDays?: number;
    useFixture?: boolean;
  } = {},
): Promise<MarketPriceSnapshot> {
  if (options.useFixture ?? process.env.REFLO_KRX_TEST_FIXTURE === "1") {
    return fixtureSnapshot(request);
  }

  const apiKey = options.apiKey ?? process.env.KRX_API_KEY?.trim();
  if (!apiKey) {
    return unavailable(
      request,
      "KRX_API_KEY_MISSING",
      "KRX Open API 인증키가 설정되지 않았습니다.",
    );
  }

  const baseUrl = (
    options.baseUrl ??
    process.env.KRX_API_BASE_URL ??
    "https://data-dbg.krx.co.kr/svc/apis"
  ).replace(/\/$/, "");
  const fetchImpl = options.fetchImpl ?? fetch;
  const apiIds =
    request.exchange === "KRX"
      ? [API_IDS.KOSPI, API_IDS.KOSDAQ, API_IDS.KONEX]
      : [API_IDS[request.exchange]];
  const maxLookbackDays = options.maxLookbackDays ?? 10;

  for (let offset = 0; offset <= maxLookbackDays; offset += 1) {
    const candidateDate = previousDate(request.cutoffDate, offset);
    for (const apiId of apiIds) {
      let response: Response;
      try {
        response = await fetchImpl(
          `${baseUrl}/sto/${apiId}?basDd=${compactDate(candidateDate)}`,
          {
            headers: { AUTH_KEY: apiKey, Accept: "application/json" },
            signal: AbortSignal.timeout(10_000),
          },
        );
      } catch (error) {
        return unavailable(
          request,
          "KRX_API_UNREACHABLE",
          error instanceof Error
            ? error.message
            : "KRX Open API에 연결하지 못했습니다.",
          apiId,
        );
      }

      const raw = await response.text();
      if (response.status === 401 || response.status === 403) {
        return unavailable(
          request,
          "KRX_API_UNAUTHORIZED",
          "KRX Open API 인증키에 일별매매정보 조회 권한이 없습니다.",
          apiId,
        );
      }
      if (!response.ok) {
        return unavailable(
          request,
          `KRX_API_HTTP_${response.status}`,
          `KRX Open API가 HTTP ${response.status}를 반환했습니다.`,
          apiId,
        );
      }

      let payload: { OutBlock_1?: KrxDailyRow[] };
      try {
        payload = JSON.parse(raw) as { OutBlock_1?: KrxDailyRow[] };
      } catch {
        return unavailable(
          request,
          "KRX_API_INVALID_RESPONSE",
          "KRX Open API 응답을 해석하지 못했습니다.",
          apiId,
        );
      }
      const row = (payload.OutBlock_1 ?? []).find(
        (item) => normalizeTicker(item.ISU_CD) === normalizeTicker(request.ticker),
      );
      const closePrice = parseClosePrice(row?.TDD_CLSPRC);
      if (!row || closePrice == null) continue;

      return {
        schemaVersion: "1.0",
        provider: "KRX_OPEN_API",
        status: "available",
        companyMasterId: request.companyMasterId,
        ticker: request.ticker,
        exchange: request.exchange,
        requestedDate: request.cutoffDate,
        tradingDate:
          typeof row.BAS_DD === "string" && /^\d{8}$/.test(row.BAS_DD)
            ? `${row.BAS_DD.slice(0, 4)}-${row.BAS_DD.slice(4, 6)}-${row.BAS_DD.slice(6, 8)}`
            : candidateDate,
        closePrice,
        currency: "KRW",
        sourceApiId: apiId,
        retrievedAt: new Date().toISOString(),
        sourcePayloadHash: createHash("sha256").update(raw).digest("hex"),
        errorCode: null,
        errorMessage: null,
      };
    }
  }

  return unavailable(
    request,
    "KRX_PRICE_NOT_FOUND",
    `기준일 이전 ${maxLookbackDays}일 동안 KRX 종가를 찾지 못했습니다.`,
    apiIds[0],
  );
}
