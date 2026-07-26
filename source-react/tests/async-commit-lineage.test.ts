import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) =>
  readFileSync(new URL(path, import.meta.url), "utf8");

test("every active async result path pins inputs and rechecks the snapshot", () => {
  const files = read(
    "../server/infrastructure/repositories/file-repository.ts",
  );
  const hypothesis = read(
    "../server/infrastructure/repositories/hypothesis-repository.ts",
  );
  const research = read(
    "../server/infrastructure/repositories/phase4-repository.ts",
  );

  assert.equal(
    files.match(/pinWorkflowJobSourceSnapshot\(client, \{ jobId \}\)/g)?.length,
    2,
    "file scan and inspection jobs must both pin their inputs",
  );
  assert.equal(
    files.match(/decidePinnedWorkflowJobCommit\(client,/g)?.length,
    2,
    "file scan and inspection commits must both recheck their inputs",
  );
  assert.match(hypothesis, /pinWorkflowJobSourceSnapshot\(client, \{ jobId \}\)/);
  assert.match(hypothesis, /decidePinnedWorkflowJobCommit\(client,/);
  assert.match(hypothesis, /lateResultRequiresAuditOnly\(snapshotDecision\)/);
  assert.match(hypothesis, /recordLateWorkflowJobResult\(client,/);
  assert.match(hypothesis, /snapshotDecision\.decision === "obsolete"/);
  assert.match(research, /pinWorkflowJobSourceSnapshot\(client, \{ jobId \}\)/);
  assert.match(research, /decidePinnedWorkflowJobCommit\(client,/);
  assert.match(research, /lateResultRequiresAuditOnly\(snapshotDecision\)/);
  assert.match(research, /recordLateWorkflowJobResult\(client,/);
  assert.match(research, /if \(obsolete\) \{/);
  assert.match(
    research,
    /validity_status = 'obsolete'[\s\S]*current_phase = 'stored_obsolete'/,
  );
});

test("authoritative version switches invalidate resource dependents", () => {
  const project = read(
    "../server/infrastructure/repositories/project-repository.ts",
  );
  const hypothesis = read(
    "../server/infrastructure/repositories/hypothesis-repository.ts",
  );
  const research = read(
    "../server/infrastructure/repositories/phase4-repository.ts",
  );
  const valuation = read(
    "../server/infrastructure/repositories/valuation-repository.ts",
  );

  assert.match(project, /invalidateResourceDependents\(client,/);
  assert.match(hypothesis, /invalidateResourceDependents\(client,/);
  assert.match(research, /invalidateResourceDependents\(client,/);
  assert.match(valuation, /invalidateResourceDependents\(client,/);
});

test("synchronous version boundaries persist the concrete lineage chain", () => {
  const files = read(
    "../server/infrastructure/repositories/file-repository.ts",
  );
  const hypothesis = read(
    "../server/infrastructure/repositories/hypothesis-repository.ts",
  );
  const research = read(
    "../server/infrastructure/repositories/phase4-repository.ts",
  );
  const valuation = read(
    "../server/infrastructure/repositories/valuation-repository.ts",
  );

  assert.match(files, /RETURNING resource_version_id/);
  assert.match(files, /invalidateFilesStagesIfProgressed\(client,/);
  assert.match(files, /template_ir_to_mapping_set/);
  assert.match(files, /workbook_analysis_to_mapping_set/);
  assert.match(hypothesis, /setup_to_hypothesis/);
  assert.match(hypothesis, /mapping_set_to_hypothesis/);
  assert.match(hypothesis, /hypothesis_to_question_set/);
  assert.match(research, /question_set_to_research_plan/);
  assert.match(research, /mapping_set_to_research_plan/);
  assert.match(valuation, /validation_approval_input/);
  assert.match(valuation, /workbook_analysis_to_valuation/);
  assert.match(valuation, /market_price_to_valuation/);
});

test("canonical result metadata reaches all repository commit boundaries", () => {
  const route = read("../app/internal/v1/jobs/[jobId]/results/route.ts");

  assert.match(route, /const metadata: WorkerResultCommitMetadata/);
  assert.match(route, /body\.results\[0\]\.hash !== payloadHash/);
  assert.match(route, /resultHash: payloadHash/);
  assert.equal(
    route.match(/metadata,\s*\)/g)?.length,
    4,
    "all four runtime result handlers must receive canonical metadata",
  );
});
