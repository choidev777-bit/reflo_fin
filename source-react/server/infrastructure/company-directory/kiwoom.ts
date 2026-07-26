import type { DirectoryCompany, ExchangeCode } from "./types";
import { itManufacturingEligibility } from "./it-manufacturing-policy";

const DEFAULT_API_URL = "https://api.kiwoom.com";
const MINIMUM_COMPANY_COUNT = 2_000;
const MARKETS: Array<{ marketType: string; exchange: ExchangeCode }> = [
  { marketType: "0", exchange: "KOSPI" },
  { marketType: "10", exchange: "KOSDAQ" },
  { marketType: "50", exchange: "KONEX" },
];

type KiwoomToken = {
  token: string;
  expiresAt: number;
};

type KiwoomCompanyRow = {
  code?: unknown;
  name?: unknown;
  upName?: unknown;
};

declare global {
  var __refloKiwoomToken: KiwoomToken | undefined;
}

function apiUrl(path: string): string {
  const base = process.env.KIWOOM_API_BASE_URL?.trim() || DEFAULT_API_URL;
  return new URL(path, base.endsWith("/") ? base : `${base}/`).toString();
}

function credentials(): { appKey: string; appSecret: string } | null {
  const appKey = process.env.KIWOOM_APP_KEY?.trim();
  const appSecret = process.env.KIWOOM_APP_SECRET?.trim();
  return appKey && appSecret ? { appKey, appSecret } : null;
}

export function hasKiwoomCredentials(): boolean {
  return credentials() !== null;
}

async function getAccessToken(): Promise<string> {
  const configured = credentials();
  if (!configured) throw new Error("KIWOOM_CREDENTIALS_MISSING");
  if (
    globalThis.__refloKiwoomToken &&
    globalThis.__refloKiwoomToken.expiresAt > Date.now() + 5 * 60 * 1000
  ) {
    return globalThis.__refloKiwoomToken.token;
  }

  const response = await fetch(apiUrl("/oauth2/token"), {
    method: "POST",
    headers: { "Content-Type": "application/json;charset=UTF-8" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      appkey: configured.appKey,
      secretkey: configured.appSecret,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await response.json()) as {
    token?: unknown;
    return_code?: unknown;
    return_msg?: unknown;
  };
  if (
    !response.ok ||
    body.return_code !== 0 ||
    typeof body.token !== "string" ||
    !body.token
  ) {
    throw new Error(
      `KIWOOM_TOKEN_FAILED:${response.status}:${String(body.return_msg ?? "")}`,
    );
  }

  globalThis.__refloKiwoomToken = {
    token: body.token,
    expiresAt: Date.now() + 23 * 60 * 60 * 1000,
  };
  return body.token;
}

export function parseKiwoomCompanyList(
  rows: KiwoomCompanyRow[],
  exchange: ExchangeCode,
): Omit<DirectoryCompany, "companyId">[] {
  const companies: Omit<DirectoryCompany, "companyId">[] = [];
  for (const row of rows) {
    const ticker =
      typeof row.code === "string" ? row.code.trim().toUpperCase() : "";
    const name = typeof row.name === "string" ? row.name.trim() : "";
    const industry = typeof row.upName === "string" ? row.upName.trim() : "";
    if (!name || !/^[0-9A-Z]{6}$/.test(ticker)) continue;

    companies.push({
      corpCode: null,
      name,
      ticker,
      exchange,
      industry: industry || "업종 정보 없음",
      listed: true,
      ...itManufacturingEligibility(ticker),
    });
  }
  return companies;
}

async function fetchMarket(
  token: string,
  marketType: string,
  exchange: ExchangeCode,
): Promise<Omit<DirectoryCompany, "companyId">[]> {
  const response = await fetch(apiUrl("/api/dostk/stkinfo"), {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "api-id": "ka10099",
      "Content-Type": "application/json;charset=UTF-8",
    },
    body: JSON.stringify({ mrkt_tp: marketType }),
    signal: AbortSignal.timeout(30_000),
  });
  const body = (await response.json()) as {
    list?: unknown;
    return_code?: unknown;
    return_msg?: unknown;
  };
  if (!response.ok || body.return_code !== 0 || !Array.isArray(body.list)) {
    throw new Error(
      `KIWOOM_DIRECTORY_FAILED:${response.status}:${exchange}:${String(body.return_msg ?? "")}`,
    );
  }
  return parseKiwoomCompanyList(body.list as KiwoomCompanyRow[], exchange);
}

export async function fetchKiwoomCompanies(): Promise<
  Omit<DirectoryCompany, "companyId">[]
> {
  const token = await getAccessToken();
  const markets = await Promise.all(
    MARKETS.map(({ marketType, exchange }) =>
      fetchMarket(token, marketType, exchange),
    ),
  );
  const companies = markets.flat();
  if (companies.length < MINIMUM_COMPANY_COUNT) {
    throw new Error(`KIWOOM_DIRECTORY_INCOMPLETE:${companies.length}`);
  }
  return companies;
}
