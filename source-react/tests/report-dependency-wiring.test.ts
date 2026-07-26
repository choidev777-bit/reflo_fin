import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const repository = readFileSync(
  new URL("../server/infrastructure/repositories/report-repository.ts", import.meta.url),
  "utf8",
);

function functionBody(name: string): string {
  const signature = `function ${name}(`;
  const start = repository.indexOf(signature);
  assert.notEqual(start, -1, `${name} must exist`);
  const tailStart = start + signature.length;
  const next = repository
    .slice(tailStart)
    .search(/\n(?:export\s+)?(?:async\s+)?function\s+\w+\s*\(/);
  return repository.slice(
    start,
    next === -1 ? repository.length : tailStart + next,
  );
}

test("every outline version records its versioned upstreams", () => {
  const recorder = functionBody("recordReportOutlineDependencies");
  for (const upstream of [
    "templateResourceVersionId",
    "mappingSetResourceVersionId",
    "valuationResourceVersionId",
    "hypothesisResourceVersionId",
  ]) {
    assert.match(recorder, new RegExp(`context\\.${upstream}`));
  }
  assert.match(recorder, /recordResourceDependencies\(client,/);

  for (const creator of [
    "ensureOutline",
    "patchReportOutline",
    "regenerateReportOutline",
  ]) {
    assert.match(
      functionBody(creator),
      /recordReportOutlineDependencies\(\s*client,/,
      `${creator} must wire the new outline`,
    );
  }
});

test("every report version records the approved outline dependency", () => {
  const recorder = functionBody("recordReportVersionDependency");
  assert.match(recorder, /outline_resource_version_id/);
  assert.match(recorder, /recordResourceDependencies\(client,/);
  assert.match(recorder, /outline_to_report/);

  for (const creator of [
    "createReport",
    "patchReportVersion",
    "restoreReportVersion",
  ]) {
    assert.match(
      functionBody(creator),
      /recordReportVersionDependency\(\s*client,/,
      `${creator} must wire the new report version`,
    );
  }
});

test("outline and report pointer replacements invalidate old dependents", () => {
  for (const replacement of [
    "patchReportOutline",
    "regenerateReportOutline",
    "patchReportVersion",
    "restoreReportVersion",
  ]) {
    assert.match(
      functionBody(replacement),
      /invalidateResourceDependents\(client,/,
      `${replacement} must invalidate dependents of the replaced version`,
    );
  }
  assert.match(
    functionBody("regenerateReportOutline"),
    /invalidateProjectStages\(client,/,
  );
});
