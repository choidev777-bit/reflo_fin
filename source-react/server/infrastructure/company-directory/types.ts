export type ExchangeCode = "KOSPI" | "KOSDAQ" | "KONEX";

export type DirectoryCompany = {
  companyId: string;
  corpCode: string | null;
  name: string;
  ticker: string;
  exchange: ExchangeCode;
  industry: string;
  listed: true;
  mvpEligible: true;
  ineligibilityReason: null;
};

export type CompanyDirectoryProvider = "kiwoom" | "krx-kind";

export type CompanyDirectorySnapshot = {
  companies: DirectoryCompany[];
  provider: CompanyDirectoryProvider;
  loadedAt: number;
};
