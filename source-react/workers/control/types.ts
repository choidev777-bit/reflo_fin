export type FileIngestWorkflowInput = {
  workflowType: "fileIngestWorkflow";
  jobId: string;
  jobAttempt: number;
  projectId: string;
  uploadId: string;
  fileVersionId: string;
  artifactId: string;
  fileRole: "previous_report_pdf" | "analysis_workbook";
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
  pdf: InspectionFileInput;
  workbook: InspectionFileInput;
  marketData: {
    companyMasterId: string;
    ticker: string;
    exchange: "KOSPI" | "KOSDAQ" | "KONEX" | "KRX";
    cutoffDate: string;
  };
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
};

export type TemplateIr = {
  schemaVersion: "1.0";
  templateId: string;
  templateVersion: number;
  source: { pdfHash: string };
  pages: Array<{
    pageId: string;
    pageNumber: number;
    blocks: Array<{ blockId: string; role: string }>;
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
