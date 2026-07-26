export type StageState = {
  stageKey: string;
  stageOrder: number;
  status: string;
  blockerCodes: string[];
  route: string;
};

export type SourceType =
  | "DART"
  | "COMPANY_IR"
  | "NEWS"
  | "KRX"
  | "ECOS"
  | "FNGUIDE_CONSENSUS"
  | "USER_MATERIAL";

export type NewsSearchPolicy = {
  mode: "agent_web_search";
  publicationWindows: Array<{
    purpose: "current_period" | "historical_comparison";
    startAt: string;
    endAt: string;
  }>;
  subjectPeriods: string[];
  timezone: "Asia/Seoul";
  queryLimit: number;
  discoverLimit: number;
  fetchLimit: number;
  retainLimit: number;
  perPublisherLimit: number;
  languages: string[];
  providerCode: string;
  policyVersion: string;
};

export type PlanQuestion = {
  questionId: string;
  order: number;
  text: string;
  purpose: string;
  metrics: string[];
  period: string;
  comparison: string;
  suggestedSourceTypes: SourceType[];
  included: boolean;
  collectionTargets: Array<{
    label: string;
    resultTypes: string[];
  }>;
  sourceBindingIds: SourceType[];
  collectionMethods: Partial<Record<SourceType, string>>;
  newsSearchPolicy?: NewsSearchPolicy;
  validationErrors: string[];
};

export type ExcelTarget = {
  targetId: string;
  sheetId: string;
  sheetName: string;
  address: string;
  metric: string;
  period: string;
  unit: string;
  scope: string;
  valueKind: "actual" | "preliminary_actual";
  required: boolean;
  included: boolean;
  sourcePolicy: Array<{
    sourceType: SourceType;
    role: "authority" | "verification" | "comparison";
  }>;
  mappingSlotIds: string[];
  excludedReason: string | null;
};

export type PlanValidationIssue = {
  code: string;
  targetId: string | null;
  category: "hypothesis" | "excel" | "material";
  message: string;
};

export type ResearchSourceReference = {
  referenceId: string;
  sourceType: Extract<SourceType, "COMPANY_IR" | "NEWS" | "USER_MATERIAL">;
  ingestionMethod: "user_upload" | "user_url";
  title: string;
  publisher: string;
  publishedAt: string | null;
  canonicalUrl: string | null;
  artifactId: string | null;
  originalFilename: string | null;
  mediaType: string | null;
  byteSize: number | null;
  sha256: string | null;
};

export type ResearchJob = {
  jobId: string;
  researchRunId: string;
  operationStatus:
    | "queued"
    | "running"
    | "succeeded"
    | "failed"
    | "cancel_requested"
    | "cancelled";
  phase: string | null;
  progressPercent: number;
  retryable: boolean;
  error: { code: string; message: string } | null;
  requestedAt: string;
  updatedAt: string;
  validationRoute: string;
};

export type ResearchPlanWorkspace = {
  project: {
    projectId: string;
    name: string;
    companyName: string;
    ticker: string;
    industry: string;
    targetPeriod: { year: number; quarter: number };
    cutoffDate: string;
    cutoffAt: string;
    currentStage: string;
  };
  prerequisites: {
    questionSetVersion: number;
    questionSetVersionId: string;
    questionSetApproved: boolean;
    workbookVersionId: string;
    workbookStructureHash: string;
    mappingSetVersionId: string;
  };
  plan: {
    planId: string;
    version: number;
    status: "draft" | "approved" | "revalidation_required";
    questions: PlanQuestion[];
    excelTargets: ExcelTarget[];
    userUrls: string[];
    sourceReferences: ResearchSourceReference[];
    validationSummary: {
      valid: boolean;
      issues: PlanValidationIssue[];
    };
    lastSavedAt: string;
  };
  sourceOptions: Array<{
    sourceType: SourceType;
    label: string;
    description: string;
    collectionMethod: string;
  }>;
  policy: {
    fileLimit: number;
    urlLimit: number;
    allowedFileTypes: Array<{ extension: string; maxBytes: number }>;
  };
  activeJob: ResearchJob | null;
  workflow: {
    stageStates: StageState[];
    allowedRoutes: string[];
  };
  navigation: {
    previousRoute: string;
    validationRoute: string;
  };
};

export type ValidationResult = {
  resultId: string;
  resultVersion: number;
  category: "hypothesis" | "excel";
  questionId: string | null;
  targetId: string | null;
  title: string;
  oneLineValue: string;
  stance: "supporting" | "contradicting" | "neutral";
  machineStatus: "passed" | "failed" | "needs_review" | "stale";
  exceptionStatus: string;
  valueOriginal: string | null;
  valueNormalized: string | null;
  unit: string | null;
  currency: string | null;
  period: string | null;
  scope: string | null;
  valueKind: string | null;
  evidenceIds: string[];
  required: boolean;
  criticalNumeric: boolean;
  validatedAt: string;
};

export type QuestionAnswer = {
  questionId: string;
  answer: string;
  sufficiency: "sufficient" | "qualified" | "insufficient" | "reinvestigating";
  supportingCount: number;
  contradictingCount: number;
  neutralCount: number;
  qualifiedAccepted: boolean;
  required: boolean;
  blockers: string[];
};

export type ValidationWorkspace = {
  project: {
    projectId: string;
    name: string;
    companyName: string;
    ticker: string;
    targetPeriod: { year: number; quarter: number };
  };
  workspace: {
    projectId: string;
    projectVersion: number;
    researchPlanVersion: number | null;
    collectionRunId: string;
    validationRunId: string | null;
    validationVersion: number;
    status: string;
    cutoffAt: string | null;
    jobs: ResearchJob[];
    stageGate: {
      canProceed: boolean;
      blockers: Array<{
        code: string;
        targetId: string | null;
        message: string;
      }>;
    };
    updatedAt?: string;
  };
  questions: PlanQuestion[];
  questionAnswers: QuestionAnswer[];
  results: ValidationResult[];
  conflicts: Array<{
    conflictId: string;
    resultId: string;
    candidateEvidenceIds: string[];
    status: string;
    selectedEvidenceId: string | null;
  }>;
  workflow: { stageStates: StageState[] };
  navigation: { previousRoute: string; nextRoute: string };
};

export type ResultDetail = {
  result: {
    resultId: string;
    title: string;
    oneLineValue: string;
    machineStatus: string;
    exceptionStatus: string;
  };
  evidence: Array<{
    evidenceId: string;
    evidenceVersion: number;
    sourceVersionId: string;
    sourceType: string;
    title: string;
    publisher: string;
    canonicalUrl: string | null;
    publishedAt: string | null;
    quoteExact: string;
    quoteNormalized: string;
    locator: Record<string, unknown>;
    valueOriginal: string | null;
    valueNormalized: string | null;
    unit: string | null;
    currency: string | null;
    period: string | null;
    scope: string | null;
    valueKind: string | null;
    stance: string;
    machineStatus: string;
    checks: Array<{ code: string; status: string; message: string }>;
    provenance: Record<string, unknown>;
  }>;
};

export type ValidationWorkbookManifest = {
  originalWorkbookHash: string;
  workbookVersion: number;
  workbookResourceVersionId: string;
  structureHash: string;
  readOnlyReason: string;
  visibleSheets: Array<{
    sheetId?: string;
    name?: string;
    index?: number;
    usedRange?: string;
  }>;
  cells: Array<{
    candidateId?: string;
    sheetId?: string;
    sheetName?: string;
    address?: string;
    displayValue?: string;
    rawValue?: unknown;
    label?: string;
    formula?: string | null;
    numberFormat?: string;
  }>;
  validationTargets: ExcelTarget[];
  evidenceBindings: Array<{
    targetId: string;
    evidenceIds: string[];
    value: string | null;
    formattedText: string;
    beforeValue: string | null;
    afterValue: string | null;
    writeStatus:
      | "awaiting_validation"
      | "proposed"
      | "blocked"
      | "applying"
      | "applied";
  }>;
  validatedValueSetVersionId: string | null;
  sourceSnapshotId: string | null;
  sourceFingerprint: string | null;
  expectedProjectVersion: number | null;
  workbookApplication: {
    taskId: string;
    status: "queued" | "running" | "succeeded" | "failed" | "obsolete";
  } | null;
  workbookApplicationPlan: {
    commands: Array<{
      targetId: string;
      sheetId: string;
      sheetName: string;
      address: string;
      valueType: "number" | "string" | "boolean" | "blank";
      beforeValue: string | null;
      afterValue: string | null;
      evidenceIds: string[];
      generatedBridge: boolean;
    }>;
    blocked: Array<{
      targetId: string;
      reasonCode: string;
    }>;
    planHash: string;
  } | null;
  validatedWorkbookArtifactId: string | null;
};

export type WorkbookApplicationAccepted = {
  taskId: string;
  operationStatus: "queued" | "running" | "succeeded";
  validity: "current";
  statusUrl: string;
  sourceSnapshotId: string;
  sourceFingerprint: string;
};

export type WorkbookApplicationProjection = {
  taskId: string;
  operationStatus:
    | "queued"
    | "running"
    | "succeeded"
    | "failed"
    | "cancelled";
  validity: "current" | "obsolete";
  phase: string | null;
  progressPercent: number;
  retryable: boolean;
  error: { code: string; message: string | null } | null;
  outputWorkbook: {
    id: string;
    version: number;
    artifactId: string | null;
  } | null;
};
