export type FileIngestWorkflowInput = {
  workflowType: "fileIngestWorkflow";
  jobId: string;
  jobAttempt: number;
  projectId: string;
  uploadId: string;
  fileVersionId: string;
  artifactId: string;
  fileRole:
    | "previous_report_pdf"
    | "analysis_workbook"
    | "current_ir_pdf";
  objectKey: string;
  sha256: string;
  byteSize: number;
  declaredMediaType: string;
};

export type InspectionFileInput = {
  fileVersionId: string;
  artifactId: string;
  objectKey: string;
  sha256: string;
};

export type FileInspectionWorkflowInput = {
  workflowType: "fileInspectionWorkflow";
  jobId: string;
  jobAttempt: number;
  projectId: string;
  inspectionId: string;
  setupResourceVersionId: string;
  targetYear: number;
  targetQuarter: number;
  corpCode: string | null;
  reportPeriodPlan: import("../../server/domain/report-period-plan").ReportPeriodPlan;
  pdf: InspectionFileInput;
  workbook: InspectionFileInput;
  currentIr: InspectionFileInput | null;
  marketData: {
    companyMasterId: string;
    ticker: string;
    exchange: "KOSPI" | "KOSDAQ" | "KONEX" | "KRX";
    cutoffDate: string;
  };
};

export type HypothesisGenerationWorkflowInput = {
  workflowType: "hypothesisGenerationWorkflow";
  jobId: string;
  jobAttempt: number;
  projectId: string;
  generationId: string;
  inputResourceVersionId: string;
  sourceInputVersionIds: string[];
  inputDraftVersion: number;
  inputContentHash: string;
  inputRevision: string;
  company: string;
  ticker: string;
  sector: string;
  targetPeriod: string;
  asOfDate: string;
  reportType: string;
  rating: "BUY" | "HOLD" | "SELL";
  hypothesis: string;
  knownFacts: string[];
  availableSourceTypes: Array<
    "filing" | "company" | "news" | "industry" | "market_data"
  >;
  optionalContext: string | null;
  agentProfile: {
    version: string;
    promptVersion: string;
    outputSchemaVersion: string;
    model: string;
    reasoning: "medium";
    inputTokenLimit: number;
    outputTokenLimit: number;
    timeoutSeconds: number;
    costLimitUsd: number;
  };
};

export type ResearchValidationWorkflowInput = {
  workflowType: "researchValidationWorkflow";
  jobId: string;
  jobAttempt: number;
  projectId: string;
  researchRunId: string;
  approvedPlanResourceVersionId: string;
  sourceInputVersionIds: string[];
  companyMasterId: string;
  companyName: string;
  corpCode: string | null;
  ticker: string;
  exchange: "KOSPI" | "KOSDAQ" | "KONEX" | "KRX";
  industry: string;
  targetYear: number;
  targetQuarter: number;
  cutoffDate: string;
  cutoffAt: string;
  questions: import("../../server/domain/research-validation").ResearchPlanQuestion[];
  answerQuestions?: import("../../server/domain/research-validation").ResearchPlanQuestion[];
  priorEvidence?: import("../../server/domain/research-validation").ValidatedEvidence[];
  excelTargets: import("../../server/domain/research-validation").ResearchExcelTarget[];
  userUrls: string[];
  sourceReferences: Array<
    import("../../server/domain/research-validation").ResearchSourceReference & {
      objectKey: string | null;
    }
  >;
  workbookConsensusFallback: Array<{
    sheetId: string;
    sheetName: string;
    address: string;
    label: string;
    displayValue: string;
    rawValue: unknown;
    formula: string | null;
  }>;
  researchAgentProfile: {
    version: string;
    model: string;
    reasoning: "medium";
  };
  validationAgentProfile: {
    version: string;
    model: string;
    reasoning: "medium";
  };
  validationRuleVersion: string;
};

export type WorkbookApplicationWorkflowInput = {
  workflowType: "workbookApplicationWorkflow";
  jobId: string;
  jobAttempt: number;
  projectId: string;
  applicationId: string;
  validationSourceSnapshotId: string;
  sourceFingerprint: string;
  sourceWorkbookResourceVersionId: string;
  mappingSetResourceVersionId: string;
  validatedValueSetResourceVersionId: string;
  sourceArtifactId: string;
  sourceObjectKey: string;
  sourceWorkbookHash: string;
  sourceFilename: string;
  plan: import("../../server/domain/workbook-application").WorkbookApplicationPlan;
  outputBindings: Array<{
    metric: "forward_eps" | "target_per" | "target_price";
    sheetId: string;
    sheetName: string;
    address: string;
  }>;
  inputVersionIds: string[];
};

export type ReportMaterializationWorkflowInput = {
  workflowType: "reportMaterializationWorkflow";
  jobId: string;
  jobAttempt: number;
  projectId: string;
  materializationRunId: string;
  sourceSnapshotId: string;
  sourceFingerprint: string;
  outlineApprovalId: string;
  requestedByUserId: string;
};

export type ReportDeliveryWorkflowInput = {
  workflowType: "reportDeliveryWorkflow";
  jobId: string;
  jobAttempt: number;
  projectId: string;
  operationKind: "preview" | "validation" | "export";
  operationId: string;
  reportVersionId: string;
  sourceSnapshotId: string;
  sourceFingerprint: string;
  requestedByUserId: string;
  validationRunId?: string;
};

export type InspectionIssue = {
  code: string;
  severity: "info" | "warning" | "blocking";
  message: string;
};

export type PdfInspectionResult = {
  pageCount: number;
  textLayer: boolean;
  compatible: boolean;
  issues: InspectionIssue[];
  parserName: string;
  parserVersion: string;
  templateIr: TemplateIr | null;
  summary: PdfAnalysisSummary;
};

export type WorkbookInspectionResult = {
  sheetCount: number;
  usedCellCount: number;
  structureHash: string;
  originalSha256: string;
  compatible: boolean;
  issues: InspectionIssue[];
  engineName: string;
  engineVersion: string;
  workbookAnalysis: WorkbookAnalysis | null;
  summary: WorkbookAnalysisSummary;
};

export type TemplateSlot = {
  slotId: string;
  blockId: string;
  valueType:
    | "decimal"
    | "money"
    | "percent"
    | "integer"
    | "date"
    | "string"
    | "boolean"
    | "table"
    | "chart"
    | "decision";
  semanticKey: {
    metric: string;
    period?: string;
    unit?: string;
    scope?: string;
  };
  required: boolean;
  styleRef?: string;
};

export type TemplateIr = {
  schemaVersion: "1.0";
  templateId: string;
  templateVersion: number;
  source: { pdfHash: string };
  pages: Array<{
    pageId: string;
    pageNumber: number;
    blocks: Array<{
      blockId: string;
      role: string;
      bbox?: [number, number, number, number];
      classification?: "scalar" | "table" | "chart" | "composite_chart" | "fixed_visual";
      geometryFingerprint?: string;
      analysisConfidence?: number;
      reasonCodes?: string[];
      styleTemplateRef?: string;
    }>;
    slots: TemplateSlot[];
    objects: Array<{ objectId: string; type: string }>;
  }>;
  resources: {
    fonts: unknown[];
    images: unknown[];
    xobjects: unknown[];
    styles: unknown[];
    clipPaths: unknown[];
  };
  analysisWarnings: Array<{ code: string; message: string }>;
};

export type PdfAnalysisSummary = {
  blockCount?: number;
  slotCount?: number;
  requiredSlotCount?: number;
  objectCount?: number;
  textObjectCount?: number;
  pathCount?: number;
  fontCount?: number;
  imageCount?: number;
  tableCount?: number;
  chartCount?: number;
  warningCount?: number;
};

export type WorkbookCandidateCell = {
  candidateId: string;
  sheetId: string;
  sheetName: string;
  address: string;
  valueType: string;
  displayValue: string;
  rawValue: unknown;
  numberFormat: string;
  label: string;
  formula: string | null;
  styleFingerprint: string;
  structureFingerprint: string;
};

export type WorkbookCandidateRange = {
  candidateId: string;
  sheetId: string;
  sheetName: string;
  range: string;
  label: string;
  rowCount: number;
  columnCount: number;
  structureFingerprint: string;
  kind?: "excel_table" | "dense_region" | "used_range";
  headerRows?: number[];
  headerValues?: string[];
  rowKeyColumns?: Array<{
    index: number;
    column: string;
    label: string;
  }>;
  periodColumns?: Array<{
    index: number;
    column: string;
    label: string;
    role: "actual" | "forecast" | "unknown";
  }>;
  unitHints?: string[];
  subtotalRows?: number[];
  styleFingerprint?: string;
  mergedRanges?: string[];
  columnDimensions?: Array<{
    index: number;
    column: string;
    widthPx: number;
  }>;
  rowDimensions?: Array<{
    index: number;
    row: number;
    heightPx: number;
  }>;
  presentationTruncated?: boolean;
};

export type WorkbookChartCachedValue = {
  index: number;
  value: string | null;
};

export type WorkbookChartDataReference = {
  formula: string;
  sheetId: string | null;
  sheetName: string | null;
  range: string | null;
  cacheType: "string" | "number" | "none";
  pointCount: number;
  cachedValues: WorkbookChartCachedValue[];
};

export type WorkbookChartSeries = {
  seriesId: string;
  index: number;
  name: string;
  nameFormula: string | null;
  chartType: string;
  axis: "primary" | "secondary";
  category: WorkbookChartDataReference | null;
  values: WorkbookChartDataReference | null;
};

export type WorkbookChartAnalysis = {
  chartId: string;
  sheetId: string;
  sheetName: string;
  partPath: string;
  title: string;
  anchor: {
    kind: "two_cell" | "one_cell" | "absolute" | "unknown";
    fromCell: string | null;
    toCell: string | null;
  };
  chartTypes: string[];
  category: WorkbookChartDataReference | null;
  series: WorkbookChartSeries[];
  axes: Array<{
    axisId: string;
    type: "category" | "date" | "value" | "series";
    position: "left" | "right" | "top" | "bottom" | "unknown";
    title: string;
    numberFormat: string | null;
    crossAxisId: string | null;
    secondary: boolean;
  }>;
  structureFingerprint: string;
};

export type WorkbookAnalysis = {
  schemaVersion: "1.0";
  workbookAnalysisId: string;
  workbookVersionId: string;
  fileHash: string;
  structureHash: string;
  format: "xlsx" | "xlsm";
  calculationStatus: string;
  sheets: Array<{
    sheetId: string;
    ooxmlSheetId?: string;
    relationshipId?: string;
    partPath?: string;
    name: string;
    index: number;
    visibility: string;
    usedRange: string;
    structureHash: string;
    formulaCount: number;
    mergedRangeCount: number;
    chartCount: number;
    tableCount: number;
    protected?: boolean;
  }>;
  editableCells: unknown[];
  candidateCells: WorkbookCandidateCell[];
  candidateRanges: WorkbookCandidateRange[];
  charts?: WorkbookChartAnalysis[];
  externalLinks: unknown[];
  namedRanges?: unknown[];
  warnings: Array<{ code: string; message: string }>;
  calculationErrors?: unknown[];
  functions?: string[];
  tool: { name: string; version: string };
};

export type WorkbookAnalysisSummary = {
  sheetCount?: number;
  hiddenSheetCount?: number;
  usedCellCount?: number;
  formulaCount?: number;
  editableCellCount?: number;
  mergedRangeCount?: number;
  chartCount?: number;
  tableCount?: number;
  externalLinkCount?: number;
  namedRangeCount?: number;
  calculationErrorCount?: number;
  functionCount?: number;
};
