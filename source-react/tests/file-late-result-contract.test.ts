import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  analysisVersionPublication,
  fileStageInvalidationTransitions,
  fileResultCommitAction,
} from "../server/infrastructure/repositories/file-repository";
import type { WorkerResultCommitMetadata } from "../server/domain/worker-result-contract";
import {
  lateResultRequiresAuditOnly,
  snapshotInputVersionIds,
} from "../server/infrastructure/services/source-snapshot-service";

const repositorySource = readFileSync(
  new URL(
    "../server/infrastructure/repositories/file-repository.ts",
    import.meta.url,
  ),
  "utf8",
);

function assertRepositoryContains(pattern: RegExp, message: string): void {
  assert.ok(pattern.test(repositorySource), message);
}

test("file result policy publishes only a current snapshot for the active attempt", () => {
  assert.equal(
    fileResultCommitAction({ decision: "current" }),
    "publish",
  );
  assert.equal(
    fileResultCommitAction({ decision: "obsolete" }),
    "store_obsolete",
  );
  assert.equal(
    fileResultCommitAction({ decision: "duplicate" }),
    "ignore_duplicate",
  );
});

test("terminal states and mismatched attempts are audit-only", () => {
  assert.equal(
    lateResultRequiresAuditOnly({
      decision: "obsolete",
      attemptMatches: false,
      operationStatus: "running",
    }),
    true,
  );
  assert.equal(
    lateResultRequiresAuditOnly({
      decision: "obsolete",
      attemptMatches: true,
      operationStatus: "cancel_requested",
    }),
    true,
  );
  assert.equal(
    lateResultRequiresAuditOnly({
      decision: "obsolete",
      attemptMatches: true,
      operationStatus: "running",
    }),
    false,
  );
});

test("canonical file result metadata carries the attempt, sequence, inputs, and hash", () => {
  const metadata = {
    attempt: 2,
    sequence: 7,
    inputVersionIds: [
      "019c0000-0000-7000-8000-000000000001",
      "019c0000-0000-7000-8000-000000000002",
    ],
    resultHash: "a".repeat(64),
  } satisfies WorkerResultCommitMetadata;

  assert.equal(metadata.attempt, 2);
  assert.equal(metadata.sequence, 7);
  assert.equal(new Set(metadata.inputVersionIds).size, 2);
  assert.match(metadata.resultHash, /^[a-f0-9]{64}$/);
});

test("pinned input version ids are unique and deterministic across repeated roles", () => {
  assert.deepEqual(
    snapshotInputVersionIds([
      { versionId: "019c0000-0000-7000-8000-000000000002" },
      { versionId: "019c0000-0000-7000-8000-000000000001" },
      { versionId: "019c0000-0000-7000-8000-000000000001" },
      { versionId: null },
    ]),
    [
      "019c0000-0000-7000-8000-000000000001",
      "019c0000-0000-7000-8000-000000000002",
    ],
  );
});

test("initial file work does not produce false revalidation transitions", () => {
  assert.deepEqual(
    fileStageInvalidationTransitions([
      { stageKey: "files", stageStatus: "in_progress" },
      {
        stageKey: "hypothesis",
        stageStatus: "blocked",
        blockerCodes: ["PREREQUISITE_INCOMPLETE"],
      },
      {
        stageKey: "research_plan",
        stageStatus: "blocked",
        blockerCodes: ["PREREQUISITE_INCOMPLETE"],
      },
      {
        stageKey: "validation",
        stageStatus: "revalidation_required",
        blockerCodes: ["FILES_CHANGED"],
      },
    ]),
    [],
  );
  assert.deepEqual(
    fileStageInvalidationTransitions([
      { stageKey: "files", stageStatus: "completed" },
      { stageKey: "hypothesis", stageStatus: "completed" },
      { stageKey: "research_plan", stageStatus: "not_started" },
    ]).map((transition) => ({
      stageKey: transition.stageKey,
      stageStatus: transition.stageStatus,
    })),
    [
      { stageKey: "files", stageStatus: "in_progress" },
      { stageKey: "hypothesis", stageStatus: "revalidation_required" },
    ],
  );
});

test("obsolete analysis outputs are archived without replacing the current version", () => {
  assert.deepEqual(analysisVersionPublication("publish"), {
    lifecycleStatus: "approved",
    validityStatus: "current",
    publishCurrent: true,
  });
  assert.deepEqual(analysisVersionPublication("store_obsolete"), {
    lifecycleStatus: "archived",
    validityStatus: "obsolete",
    publishCurrent: false,
  });
});

test("upload scan and inspection jobs pin all declared workflow inputs", () => {
  assertRepositoryContains(
    /pinWorkflowJobSourceSnapshot/,
    "workflow jobs must pin their declared source snapshot",
  );
  assertRepositoryContains(
    /VALUES \(\$1, 'setup', \$2\), \(\$1, 'pdf_file', \$3\), \(\$1, 'workbook_file', \$4\)/,
    "inspection jobs must pin setup, PDF, and workbook resource versions",
  );
  assertRepositoryContains(
    /setupResourceVersionId: setup\.resource_version_id/,
    "inspection workflow payload must carry the pinned setup version",
  );
});

test("file result commits gate publication and retain obsolete outputs", () => {
  assertRepositoryContains(
    /decidePinnedWorkflowJobCommit/,
    "file commits must pass through the shared late-result gate",
  );
  assertRepositoryContains(
    /validity_status = \$2/,
    "workflow validity must be persisted with the result disposition",
  );
  assertRepositoryContains(
    /lifecycleStatus: "archived"/,
    "obsolete analysis versions must not be approved",
  );
  assertRepositoryContains(
    /validityStatus: "obsolete"/,
    "obsolete analysis versions must retain obsolete validity",
  );
});
