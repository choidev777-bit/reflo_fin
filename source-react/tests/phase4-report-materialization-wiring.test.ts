import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const repository = readFileSync(
  new URL(
    "../server/infrastructure/repositories/report-repository.ts",
    import.meta.url,
  ),
  "utf8",
);
const migration = readFileSync(
  new URL(
    "../../infra/migrations/202607260018_report_materialization_completion.ts",
    import.meta.url,
  ),
  "utf8",
);

function functionBody(name: string): string {
  const expression = new RegExp(
    `(?:export\\s+)?(?:async\\s+)?function\\s+${name}\\s*\\(`,
  );
  const match = expression.exec(repository);
  assert.ok(match, `${name} must exist`);
  const start = match.index;
  const tailStart = start + match[0].length;
  const next = repository
    .slice(tailStart)
    .search(/\n(?:export\s+)?(?:async\s+)?function\s+\w+\s*\(/);
  return repository.slice(
    start,
    next === -1 ? repository.length : tailStart + next,
  );
}

test("outline approval queues a 202 materialization task without running the LLM transaction", () => {
  const approve = functionBody("approveReportOutline");
  assert.match(approve, /enqueueReportMaterialization\(client,/);
  assert.match(approve, /status:\s*202/);
  assert.doesNotMatch(approve, /suggestReportDraft|buildReportDocument/);

  const build = functionBody("buildReportMaterialization");
  assert.match(build, /await suggestReportDraft\(/);
  assert.doesNotMatch(build, /withTransaction\(/);
});

test("materialization commit rechecks lineage before publishing versioned blocks and report pointer", () => {
  const commit = functionBody("commitReportMaterialization");
  const recheck = commit.indexOf("persistReportSourceSnapshot(");
  const blockInsert = commit.indexOf("INSERT INTO report_materialization_block");
  const pointerUpdate = commit.indexOf("UPDATE report");
  assert.ok(recheck >= 0, "commit must recheck the SourceSnapshot");
  assert.ok(blockInsert > recheck, "blocks must be written after the recheck");
  assert.ok(
    pointerUpdate > blockInsert,
    "the active report pointer must move only after block persistence",
  );
  assert.match(commit, /INSERT INTO resource_artifact/);
  assert.match(commit, /materialization_run_id/);
  assert.match(commit, /markReportMaterializationObsolete/);
});

test("migration persists task ownership, versioned artifact, block snapshots, and report reference", () => {
  for (const expected of [
    "job_id uuid UNIQUE",
    "materialization_resource_version_id uuid UNIQUE",
    "CREATE TABLE report_materialization_block",
    "snapshot_json jsonb NOT NULL",
    "ADD COLUMN materialization_run_id uuid",
  ]) {
    assert.match(migration, new RegExp(expected.replaceAll(" ", "\\s+")));
  }
});
