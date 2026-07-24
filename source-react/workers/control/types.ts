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
};
