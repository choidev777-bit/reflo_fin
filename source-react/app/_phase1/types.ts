export type SessionUser = {
  userId: string;
  displayName: string;
  email: string;
  avatarUrl: string | null;
};

export type SessionState =
  | { status: "loading"; user: null; csrfToken: null }
  | { status: "anonymous"; user: null; csrfToken: null }
  | { status: "authenticated"; user: SessionUser; csrfToken: string }
  | { status: "error"; user: null; csrfToken: null };

export type ProjectSummary = {
  projectId: string;
  name: string;
  version: number;
  company: {
    name: string;
    ticker: string;
    exchange: string;
  } | null;
  targetPeriod: { year: number; quarter: number } | null;
  reportType: "EARNINGS_REVIEW";
  companyDomain: string;
  valuationMethod: ValuationMethod;
  workflow: {
    currentStage: string;
    completedStageCount: number;
    totalStageCount: number;
    progressPercent: number;
    resumeRoute: string;
  };
  primaryStatusCode: string;
  attentionCodes: string[];
  lastSavedAt: string;
  createdAt: string;
};

export type CompanySearchItem = {
  companyId: string;
  corpCode?: string | null;
  name: string;
  ticker: string;
  exchange: string;
  industry: string;
  listed?: boolean;
  mvpEligible: boolean;
  ineligibilityReason: string | null;
};

export type ValuationMethod = "PER" | "PBR" | "EV_EBITDA" | "DCF";

export type SetupBootstrap = {
  project: {
    projectId: string;
    name: string;
    status: string;
    currentStage: string;
    version: number;
    updatedAt: string;
  };
  setup: {
    company: CompanySearchItem | null;
    targetPeriod: { year: number; quarter: number } | null;
    cutoffDate: string | null;
    reportType: "EARNINGS_REVIEW";
    companyDomain: string;
    valuationMethod: ValuationMethod;
    status: "draft" | "complete";
    version: number;
  };
  workflow: {
    stageStates: Array<{
      stageKey: string;
      stageOrder: number;
      status: string;
      blockerCodes: string[];
      route: string;
    }>;
    allowedRoutes: string[];
    downstreamImpact: string[];
  };
  supportedTargetYears: number[];
};
