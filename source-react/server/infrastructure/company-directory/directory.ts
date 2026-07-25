import { createHash } from "node:crypto";
import { fetchKindCompanies } from "./kind";
import {
  fetchKiwoomCompanies,
  hasKiwoomCredentials,
} from "./kiwoom";
import type {
  CompanyDirectoryProvider,
  CompanyDirectorySnapshot,
  DirectoryCompany,
} from "./types";

const FRESH_FOR_MS = 24 * 60 * 60 * 1000;

type DirectoryState = CompanyDirectorySnapshot & {
  byId: Map<string, DirectoryCompany>;
  aliases: Map<string, DirectoryCompany>;
};

declare global {
  var __refloCompanyDirectory: DirectoryState | undefined;
  var __refloCompanyDirectoryLoad: Promise<DirectoryState> | undefined;
}

function stableCompanyId(company: {
  ticker: string;
  exchange: string;
}): string {
  const bytes = createHash("sha256")
    .update(`reflo-company:${company.exchange}:${company.ticker}`)
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const value = bytes.toString("hex");
  return [
    value.slice(0, 8),
    value.slice(8, 12),
    value.slice(12, 16),
    value.slice(16, 20),
    value.slice(20),
  ].join("-");
}

function withIds(
  companies: Omit<DirectoryCompany, "companyId">[],
): DirectoryCompany[] {
  const unique = new Map<string, DirectoryCompany>();
  for (const company of companies) {
    const key = `${company.exchange}:${company.ticker}`;
    unique.set(key, {
      ...company,
      companyId: stableCompanyId(company),
    });
  }
  return [...unique.values()];
}

function testDirectory(): Omit<DirectoryCompany, "companyId">[] {
  return [
    {
      corpCode: null,
      name: "삼성전자",
      ticker: "005930",
      exchange: "KOSPI",
      industry: "반도체 제조업",
      listed: true,
      mvpEligible: true,
      ineligibilityReason: null,
    },
    {
      corpCode: null,
      name: "ISC",
      ticker: "095340",
      exchange: "KOSDAQ",
      industry: "반도체 부품 제조업",
      listed: true,
      mvpEligible: true,
      ineligibilityReason: null,
    },
  ];
}

async function loadDirectory(): Promise<DirectoryState> {
  let provider: CompanyDirectoryProvider = "krx-kind";
  let companies: Omit<DirectoryCompany, "companyId">[];

  if (process.env.REFLO_TEST_AUTH_ENABLED === "1") {
    companies = testDirectory();
  } else if (hasKiwoomCredentials()) {
    try {
      companies = await fetchKiwoomCompanies();
      provider = "kiwoom";
    } catch (error) {
      console.error(
        "REFLO Kiwoom directory unavailable; using KRX KIND:",
        error instanceof Error ? error.message : "Unknown error",
      );
      companies = await fetchKindCompanies();
    }
  } else {
    companies = await fetchKindCompanies();
  }

  const identified = withIds(companies);
  const state: DirectoryState = {
    companies: identified,
    provider,
    loadedAt: Date.now(),
    byId: new Map(identified.map((company) => [company.companyId, company])),
    aliases: new Map(),
  };
  globalThis.__refloCompanyDirectory = state;
  return state;
}

async function getDirectory(): Promise<DirectoryState> {
  const current = globalThis.__refloCompanyDirectory;
  if (current && Date.now() - current.loadedAt < FRESH_FOR_MS) return current;

  globalThis.__refloCompanyDirectoryLoad ??= loadDirectory().finally(() => {
    globalThis.__refloCompanyDirectoryLoad = undefined;
  });
  return globalThis.__refloCompanyDirectoryLoad;
}

function normalized(value: string): string {
  return value.replace(/\s+/g, "").toLocaleLowerCase("ko-KR");
}

function score(company: DirectoryCompany, query: string): number {
  const name = normalized(company.name);
  const ticker = company.ticker.toLowerCase();
  if (name === query || ticker === query) return 0;
  if (name.startsWith(query) || ticker.startsWith(query)) return 1;
  return 2;
}

export async function searchCompanyDirectory(
  query: string,
  limit: number,
): Promise<DirectoryCompany[]> {
  const directory = await getDirectory();
  const target = normalized(query);
  return directory.companies
    .filter(
      (company) =>
        normalized(company.name).includes(target) ||
        company.ticker.toLowerCase().includes(target),
    )
    .sort(
      (left, right) =>
        score(left, target) - score(right, target) ||
        left.name.localeCompare(right.name, "ko"),
    )
    .slice(0, limit);
}

export function rememberCompanyReference(
  companyId: string,
  company: DirectoryCompany,
): void {
  globalThis.__refloCompanyDirectory?.aliases.set(companyId, company);
}

export function findCachedCompany(
  companyId: string,
): DirectoryCompany | undefined {
  const directory = globalThis.__refloCompanyDirectory;
  return directory?.byId.get(companyId) ?? directory?.aliases.get(companyId);
}

export async function refreshCompanyDirectory(): Promise<CompanyDirectorySnapshot> {
  globalThis.__refloCompanyDirectory = undefined;
  const directory = await getDirectory();
  return {
    companies: directory.companies,
    provider: directory.provider,
    loadedAt: directory.loadedAt,
  };
}
