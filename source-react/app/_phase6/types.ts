import type { StageState } from "../_phase4/types";

export type OutlineNarrative = {
  reportTitle: string;
  companyReview: string;
  companyOutlook: string;
  targetDirection: "유지" | "상향" | "하향";
  targetReason: string;
};

export type OutlinePage = {
  pageId: string;
  pageNumber: number;
  pageLabel: string;
  role: string;
  editable: boolean;
  widthPt: number;
  heightPt: number;
  rotation: number;
  narrative: OutlineNarrative | null;
  visualSlots: Array<{
    slotId: string;
    blockId: string;
    kind: "표" | "차트" | "수치";
    label: string;
    metric: string;
    required: boolean;
    bindingStatus: "confirmed" | "invalid";
  }>;
  evidenceIds: string[];
  reviewStatus: "reviewed" | "needs-review";
};

export type EvidenceSummary = {
  evidenceId: string;
  evidenceVersion: number;
  title: string;
  oneLineValue: string;
  stance: string;
  machineStatus: string;
  quoteExact: string;
  sourceType: string;
  publisher: string;
  sourceTitle: string;
  publishedAt: string | null;
  canonicalUrl: string | null;
  locator: Record<string, unknown>;
  provenance: Record<string, unknown>;
};

export type ReportOutlineWorkspace = {
  project: {
    projectId: string;
    name: string;
    companyName: string;
    ticker: string;
    targetPeriod: { year: number; quarter: number };
    cutoffDate: string;
    currentStage: string;
  };
  prerequisites: {
    ready: boolean;
    revalidationRequired: boolean;
    blockingItems: string[];
  };
  inputVersions: Record<string, string | number>;
  outline: {
    outlineId: string;
    version: number;
    status: "editing" | "approved" | "revalidation_required";
    savedAt: string;
    pages: OutlinePage[];
  };
  mainHypothesis: {
    rating: string;
    thesis: string;
    targetPer: string;
    targetPrice: string;
    currentPrice: string;
    upside: string;
  };
  evidenceSummary: EvidenceSummary[];
  draftTask: {
    taskId: string;
    operationStatus: string;
    reportRoute: string;
  } | null;
  workflow: { stageStates: StageState[] };
  navigation: {
    previousRoute: string;
    reportRoute: string;
  };
};

export type ReportBlock = {
  blockId: string;
  pageId: string;
  role: "title" | "narrative" | "judgement" | "numeric" | "visual" | "fixed";
  label: string;
  text: string;
  editable: boolean;
  revision: number;
  evidenceIds: string[];
  numericAuthority: string | null;
};

export type ReportPage = {
  pageId: string;
  pageNumber: number;
  pageLabel: string;
  role: string;
  widthPt: number;
  heightPt: number;
  rotation: number;
  blocks: ReportBlock[];
};

export type ReportWorkspaceData = {
  project: {
    projectId: string;
    name: string;
    companyName: string;
    ticker: string;
    targetPeriod: { year: number; quarter: number };
    cutoffDate: string;
  };
  report: {
    reportId: string;
    activeVersionId: string;
    version: number;
    status: "working" | "approved" | "revalidation_required";
    pageCount: number;
    lastSavedAt: string;
    validationStatus: string;
    previewStatus: string;
  };
  permissions: {
    canView: boolean;
    canEdit: boolean;
    canApprove: boolean;
    canExport: boolean;
  };
  editSession: {
    status: string;
    editSessionId: string;
    expiresAt: string;
    heartbeatAt: string;
    ownedByCurrentUser: boolean;
  } | null;
  pages: ReportPage[];
  sourcePdf: {
    artifactId: string;
    filename: string;
    contentUrl: string;
  };
  provenanceSummary: {
    evidenceCount: number;
    validationVersion: number;
    valuationVersion: number;
    outlineVersion: number;
  };
  jobs: {
    preview: PreviewJob | null;
    validation: ValidationJob | null;
    approval: {
      approvalId: string;
      approvedAt: string;
    } | null;
    export: {
      exportId: string;
      operationStatus: string;
      outcome: string;
      requestedAt: string;
    } | null;
  };
  navigation: {
    processRoute: string;
    valuationRoute: string;
  };
};

export type EditSession = {
  editSessionId: string;
  leaseToken: string;
  reportVersionId: string;
  expiresAt: string;
  heartbeatSeconds: number;
};

export type PreviewJob = {
  previewId: string;
  status: string;
  artifactId: string | null;
  contentUrl?: string;
  warnings?: unknown[];
  updatedAt: string;
};

export type ValidationIssue = {
  code: string;
  severity: "blocking" | "warning";
  message: string;
  pageId: string | null;
  blockId: string | null;
};

export type ValidationJob = {
  validationRunId: string;
  status: string;
  issues: ValidationIssue[];
  startedAt: string;
  finishedAt: string | null;
};

export type ExportJob = {
  exportId: string;
  operationStatus: string;
  outcome: string;
  approvedReportVersionId: string;
  requestedAt: string;
  updatedAt: string;
  artifacts: Array<{
    type: "pdf" | "xlsx";
    artifactId: string | null;
    status: string;
    attempt: number;
    retryable: boolean;
    error: { code: string; message: string } | null;
    filename: string;
    byteSize: number | null;
    downloadPath: string | null;
  }>;
};

export type ProvenanceDetail = {
  block: {
    blockId: string;
    pageId: string;
    label: string;
    numericAuthority: string | null;
  };
  evidence: EvidenceSummary[];
  calculation: {
    workbookVersion: number;
    forwardEps: string;
    targetPer: string;
    targetPrice: string;
    path: string;
  } | null;
};
