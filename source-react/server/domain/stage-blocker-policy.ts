import { processRoute, type StageKey } from "./project";

export const BLOCKER_RESUME_STAGE = {
  SETUP_CHANGED: "files",
  FILES_CHANGED: "files",
  HYPOTHESIS_CHANGED: "research_plan",
  PLAN_REVALIDATION_REQUIRED: "research_plan",
  RESEARCH_IN_PROGRESS: "research_plan",
  VALIDATION_CHANGED: "validation",
  VALUATION_REAPPROVAL_REQUIRED: "valuation",
  VALUATION_CHANGED: "valuation",
  REPORT_OUTLINE_CHANGED: "report_outline",
} as const satisfies Record<string, StageKey>;

export type CentralBlockerCode = keyof typeof BLOCKER_RESUME_STAGE;

export function resumeRouteForBlocker(input: {
  projectId: string;
  blockerCode?: string;
  fallbackStage?: StageKey;
}): string {
  const stage =
    (input.blockerCode
      ? BLOCKER_RESUME_STAGE[
          input.blockerCode as CentralBlockerCode
        ]
      : undefined) ?? input.fallbackStage;
  if (!stage) throw new Error("BLOCKER_RESUME_STAGE_MISSING");
  return processRoute(input.projectId, stage);
}

export function blockerMeta(input: {
  projectId: string;
  blockerCode?: string;
  requiredStage: StageKey;
}): { requiredStage: StageKey; resumeRoute: string } {
  return {
    requiredStage: input.requiredStage,
    resumeRoute: resumeRouteForBlocker({
      projectId: input.projectId,
      blockerCode: input.blockerCode,
      fallbackStage: input.requiredStage,
    }),
  };
}

export function uniformRevalidationTransitions(
  stages: readonly StageKey[],
  blockerCode: CentralBlockerCode,
) {
  return [...new Set(stages)].map((stageKey) => ({
    stageKey,
    stageStatus: "revalidation_required" as const,
    blockerCodes: [blockerCode] as const,
  }));
}
