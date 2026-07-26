import assert from "node:assert/strict";
import test from "node:test";
import {
  pipelineMigrationIdempotencyKey,
  planReportPipelineMigration,
} from "../server/domain/report-pipeline-migration";

test("migration inherits only stable semantic keys with exact structure fingerprints", () => {
  const plan = planReportPipelineMigration({
    projectId: "project-isc",
    sourcePipelineMode: "legacy",
    previous: [
      {
        slotId: "old-revenue",
        semanticKey: "revenue:FY2025:KRW",
        structureFingerprint: "same",
        resourceVersionId: "mapping-v1",
      },
      {
        slotId: "old-margin",
        semanticKey: "margin:FY2025:percent",
        structureFingerprint: "old",
        resourceVersionId: "mapping-v1",
      },
    ],
    target: [
      {
        slotId: "new-revenue",
        semanticKey: "revenue:FY2025:KRW",
        structureFingerprint: "same",
        resourceVersionId: "template-v2",
      },
      {
        slotId: "new-margin",
        semanticKey: "margin:FY2025:percent",
        structureFingerprint: "new",
        resourceVersionId: "template-v2",
      },
    ],
  });
  assert.deepEqual(plan.inherited, [
    {
      previousSlotId: "old-revenue",
      targetSlotId: "new-revenue",
      resourceVersionId: "mapping-v1",
    },
  ]);
  assert.deepEqual(plan.reviewQueue, [
    {
      targetSlotId: "new-margin",
      reason: "STRUCTURE_FINGERPRINT_CHANGED",
    },
  ]);
});

test("migration dry-run/apply keys are deterministic and isolated", () => {
  const input = {
    projectId: "project-isc",
    sourcePipelineMode: "legacy",
    previous: [],
    target: [],
  };
  const first = planReportPipelineMigration(input);
  const second = planReportPipelineMigration(input);
  assert.equal(first.planHash, second.planHash);
  assert.equal(
    pipelineMigrationIdempotencyKey(first, "dry_run"),
    pipelineMigrationIdempotencyKey(second, "dry_run"),
  );
  assert.notEqual(
    pipelineMigrationIdempotencyKey(first, "dry_run"),
    pipelineMigrationIdempotencyKey(first, "apply"),
  );
});
