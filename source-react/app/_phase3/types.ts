export type InvestmentRating = "BUY" | "HOLD" | "SELL";

export type HypothesisQuestion = {
  questionId: string;
  order: number;
  text: string;
  purpose: string;
  metrics: string[];
  period: string;
  comparison: string;
  suggestedSourceTypes: string[];
  origin: "agent" | "user";
};

export type QuestionSet = {
  questionSetId: string;
  version: number;
  generatedFromInputRevision: string;
  status: "draft" | "stale" | "approved" | "obsolete";
  promptVersion: string | null;
  missingContext: string[];
  approvedAt: string | null;
  approvedBy: string | null;
  questions: HypothesisQuestion[];
};

export type GenerationState = {
  generationId: string;
  operationStatus:
    | "queued"
    | "running"
    | "succeeded"
    | "failed"
    | "cancel_requested"
    | "cancelled";
  validity: "current" | "obsolete";
  phase: string | null;
  progressPercent: number;
  retryable: boolean;
  error: { code: string; message: string } | null;
  requestedAt: string;
  finishedAt: string | null;
};

export type HypothesisWorkspace = {
  project: {
    projectId: string;
    name: string;
    companyName: string;
    ticker: string;
    industry: string;
    targetPeriod: { year: number; quarter: number };
    cutoffDate: string;
    reportType: string;
    currentStage: string;
  };
  prerequisites: {
    setup: "completed";
    files: "completed";
    filesCompletionId: string;
  };
  draft: {
    draftVersion: number;
    inputRevision: string;
    provisionalRating: InvestmentRating | null;
    thesis: string;
    updatedAt: string;
  };
  questionSet: QuestionSet | null;
  generation: GenerationState | null;
  workflow: {
    stageStates: Array<{
      stageKey: string;
      stageOrder: number;
      status: string;
      blockerCodes: string[];
      route: string;
    }>;
    allowedRoutes: string[];
  };
  navigation: {
    previousRoute: string;
    nextRoute: string;
    canContinue: boolean;
  };
};
