import type { StageState } from "../_phase4/types";

export type ReportChartType = "line" | "bar" | "area" | "combo";

export type ReportMaterializedCell = {
  address: string;
  row: number;
  column: number;
  valueType: string;
  rawValue: string | null;
  formattedText: string;
  formula: string | null;
  numberFormat: string;
};

export type ReportMaterializationProvenance = {
  mappingSetResourceVersionId: string;
  workbookArtifactId: string;
  workbookVersion: number;
  workbookHash: string | null;
  slotId: string;
  sources: Array<{
    role: "table" | "category" | "series";
    seriesId: string | null;
    label: string | null;
    sheetId: string;
    sheetName: string;
    address: string;
    structureFingerprint: string | null;
  }>;
};

type ReportMaterializationState = {
  status: "ready" | "blocked";
  blockerCode: string | null;
  provenance: ReportMaterializationProvenance;
};

export type ReportTableSnapshot = ReportMaterializationState & {
  kind: "table";
  headerRow: number | null;
  columns: Array<{
    column: number;
    address: string;
    label: string;
  }>;
  headers: ReportMaterializedCell[];
  rows: Array<{
    rowNumber: number;
    rowKey: string | null;
    cells: ReportMaterializedCell[];
  }>;
};

export type ReportChartSnapshot = ReportMaterializationState & {
  kind: "chart";
  supportedChartTypes: ReportChartType[];
  categories: ReportMaterializedCell[];
  series: Array<{
    seriesId: string;
    label: string;
    values: ReportMaterializedCell[];
  }>;
};

export type ReportFixedVisualSnapshot = {
  kind: "fixed_visual";
  status: "ready";
  blockerCode: null;
  provenance: null;
};

export type ReportMaterializedData =
  | ReportTableSnapshot
  | ReportChartSnapshot
  | ReportFixedVisualSnapshot;

export type ReportRenderAsset = {
  rendererVersion: "reflo-svg-1";
  mediaType: "image/svg+xml";
  sceneHash: string;
  assetHash: string;
  svg: string;
};

export type OutlineTitle = {
  blockId: string;
  value: string;
  sourceText: string;
  maxLength: number;
  evidenceIds: string[];
};

export type OutlineNarrativeBlock = {
  blockId: string;
  order: number;
  subtitle: string;
  summary: string;
  sourceHeading: string;
  sourceText: string;
  maxLength: number;
  evidenceIds: string[];
};

export type OutlineChange = {
  pageId: string;
  blockId: string;
  field: "value" | "subtitle" | "summary";
  value: string;
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
  recommendedTitle: OutlineTitle | null;
  narrativeBlocks: OutlineNarrativeBlock[];
  visualSlots: Array<{
    slotId: string;
    blockId: string;
    kind: "표" | "차트" | "수치";
    label: string;
    metric: string;
    required: boolean;
    bindingStatus: "confirmed" | "unmapped" | "invalid";
    sourceLabel?: string | null;
    sourceAddress?: string | null;
    sourceType?: string | null;
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
    generationSource: "ai" | "fallback";
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
    statusUrl: string | null;
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
  templateBlockId: string | null;
  bbox: [number, number, number, number] | null;
  regions?: Array<[number, number, number, number]>;
  sourceObjectIds: string[];
  sourceCoverage?: "complete" | "review_required";
  uncoveredSourceObjectIds?: string[];
  dataBinding?: {
    slotId?: string;
    metric: string;
    kind: "scalar" | "table" | "chart";
    status: "confirmed" | "suggested" | "unmapped" | "invalid";
    sourceLabel: string | null;
    sourceAddress: string | null;
    sourceType: string | null;
  } | null;
  materializedData?: ReportMaterializedData;
  chartType?: ReportChartType;
  renderAssets?: Partial<Record<ReportChartType | "default", ReportRenderAsset>>;
  patchStrategy:
    | "fixed"
    | "operator_replace"
    | "block_vector_replace"
    | "region_background_patch";
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
  binding: ReportBlock["dataBinding"];
  materialization: ReportMaterializedData | null;
  evidence: EvidenceSummary[];
  calculation: {
    workbookVersion: number;
    forwardEps: string;
    targetPer: string;
    targetPrice: string;
    path: string;
  } | null;
};
