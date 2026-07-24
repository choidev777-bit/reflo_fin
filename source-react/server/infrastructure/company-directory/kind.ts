import type { DirectoryCompany, ExchangeCode } from "./types";

const KIND_LIST_URL =
  "https://kind.krx.co.kr/corpgeneral/corpList.do?method=download&searchType=13";
const MARKET_TYPES = ["stockMkt", "kosdaqMkt", "konexMkt"] as const;
const MINIMUM_COMPANY_COUNT = 2_000;

const EXCHANGE_NAMES: Record<string, ExchangeCode> = {
  유가: "KOSPI",
  코스피: "KOSPI",
  KOSPI: "KOSPI",
  코스닥: "KOSDAQ",
  KOSDAQ: "KOSDAQ",
  코넥스: "KONEX",
  KONEX: "KONEX",
};

function decodeHtml(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#(\d+);/g, (_, code: string) =>
      String.fromCodePoint(Number(code)),
    )
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    )
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseKindCompanyHtml(html: string): Omit<
  DirectoryCompany,
  "companyId"
>[] {
  const companies: Omit<DirectoryCompany, "companyId">[] = [];
  const rows = html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi);

  for (const row of rows) {
    const cells = [
      ...row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi),
    ].map((cell) => decodeHtml(cell[1]));
    if (cells.length < 4) continue;

    const [name, marketName, rawTicker, industry] = cells;
    const ticker = rawTicker.toUpperCase();
    const exchange = EXCHANGE_NAMES[marketName];
    if (!name || !exchange || !/^[0-9A-Z]{6}$/.test(ticker)) continue;

    companies.push({
      corpCode: null,
      name,
      ticker,
      exchange,
      industry: industry || "업종 정보 없음",
      listed: true,
      mvpEligible: true,
      ineligibilityReason: null,
    });
  }

  return companies;
}

export async function fetchKindCompanies(): Promise<
  Omit<DirectoryCompany, "companyId">[]
> {
  const companies = (
    await Promise.all(
      MARKET_TYPES.map(async (marketType) => {
        const url = new URL(KIND_LIST_URL);
        url.searchParams.set("marketType", marketType);
        const response = await fetch(url, {
          headers: {
            Accept: "application/vnd.ms-excel,text/html",
            "User-Agent": "REFLO/1.0 company-directory",
          },
          signal: AbortSignal.timeout(30_000),
        });
        if (!response.ok) {
          throw new Error(`KRX_KIND_HTTP_${response.status}:${marketType}`);
        }
        const html = new TextDecoder("euc-kr").decode(
          await response.arrayBuffer(),
        );
        return parseKindCompanyHtml(html);
      }),
    )
  ).flat();
  if (companies.length < MINIMUM_COMPANY_COUNT) {
    throw new Error(`KRX_KIND_DIRECTORY_INCOMPLETE:${companies.length}`);
  }
  return companies;
}
