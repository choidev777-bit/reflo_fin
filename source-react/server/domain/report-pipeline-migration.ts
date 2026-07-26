import { contentHash } from "./hash";

export type PipelineMigrationBinding = {
  slotId: string;
  semanticKey: string;
  structureFingerprint: string | null;
  resourceVersionId: string;
};

export type PipelineMigrationPlan = {
  schemaVersion: "1.0";
  plannerVersion: "report-pipeline-migration/1.0";
  projectId: string;
  sourcePipelineMode: string;
  targetPipelineMode: "render_scene_v1";
  inherited: Array<{
    previousSlotId: string;
    targetSlotId: string;
    resourceVersionId: string;
  }>;
  reviewQueue: Array<{
    targetSlotId: string;
    reason: "SEMANTIC_KEY_AMBIGUOUS" | "STRUCTURE_FINGERPRINT_CHANGED";
  }>;
  planHash: string;
};

export function planReportPipelineMigration(input: {
  projectId: string;
  sourcePipelineMode: string;
  previous: PipelineMigrationBinding[];
  target: PipelineMigrationBinding[];
}): PipelineMigrationPlan {
  const inherited: PipelineMigrationPlan["inherited"] = [];
  const reviewQueue: PipelineMigrationPlan["reviewQueue"] = [];

  for (const target of [...input.target].sort((a, b) =>
    a.slotId.localeCompare(b.slotId),
  )) {
    const semanticMatches = input.previous.filter(
      (item) => item.semanticKey === target.semanticKey,
    );
    const exact = semanticMatches.filter(
      (item) =>
        item.structureFingerprint !== null &&
        item.structureFingerprint === target.structureFingerprint,
    );
    if (semanticMatches.length === 1 && exact.length === 1) {
      inherited.push({
        previousSlotId: exact[0].slotId,
        targetSlotId: target.slotId,
        resourceVersionId: exact[0].resourceVersionId,
      });
      continue;
    }
    reviewQueue.push({
      targetSlotId: target.slotId,
      reason:
        semanticMatches.length > 1
          ? "SEMANTIC_KEY_AMBIGUOUS"
          : "STRUCTURE_FINGERPRINT_CHANGED",
    });
  }

  const body = {
    schemaVersion: "1.0" as const,
    plannerVersion: "report-pipeline-migration/1.0" as const,
    projectId: input.projectId,
    sourcePipelineMode: input.sourcePipelineMode,
    targetPipelineMode: "render_scene_v1" as const,
    inherited,
    reviewQueue,
  };
  return { ...body, planHash: contentHash(body) };
}

export function pipelineMigrationIdempotencyKey(
  plan: PipelineMigrationPlan,
  mode: "dry_run" | "apply",
): string {
  return `report-pipeline:${mode}:${plan.planHash}`;
}
