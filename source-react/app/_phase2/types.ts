export type FileRole = "previous_report_pdf" | "analysis_workbook";

export type FileVersionSummary = {
  fileVersionId: string;
  role: FileRole;
  fileName: string;
  mediaType: string;
  sizeBytes: number;
  status: "scanning" | "accepted" | "rejected" | "superseded";
  version: number;
};

export type InspectionIssue = {
  code: string;
  severity: "info" | "warning" | "blocking";
  message: string;
};

export type InspectionProjection = {
  inspectionId: string;
  jobId: string;
  operationStatus:
    | "queued"
    | "running"
    | "succeeded"
    | "failed"
    | "cancel_requested"
    | "cancelled";
  validity: "current" | "obsolete";
  phase: string | null;
  progressMode: "determinate" | "indeterminate";
  progressPercent: number;
  heartbeatAt: string | null;
  retryable: boolean;
  attempt: number;
  outcome: "passed" | "failed" | null;
  issues: InspectionIssue[];
  mappingSet: {
    versionId: string;
    version: number;
    status: "pending" | "confirmed" | "blocked";
  } | null;
  resultVersions: {
    template: number;
    workbook: number;
    mappingSet: number;
  } | null;
  error: { code: string; message: string; retryable: boolean } | null;
};

export type FilesBootstrap = {
  projectId: string;
  projectVersion: number;
  project: {
    name: string;
    company: {
      name: string;
      ticker: string;
      targetPeriod: { year: number; quarter: number };
      cutoffDate: string;
    } | null;
  };
  slots: Array<{
    role: FileRole;
    required: true;
    status: "empty" | "uploading" | "scanning" | "ready" | "rejected";
    currentFile: FileVersionSummary | null;
    maxSizeBytes: number;
    acceptedMediaType: string;
  }>;
  inspection: InspectionProjection | null;
  workflow: {
    stageStates: Array<{ stageKey: string; status: string; route: string }>;
    allowedRoutes: string[];
  };
};
