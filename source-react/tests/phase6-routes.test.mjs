import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Phase 06 pages use the dedicated outline and report workspaces", async () => {
  const [outlinePage, reportPage] = await Promise.all([
    read("app/projects/[projectId]/process/report-outline/page.tsx"),
    read("app/projects/[projectId]/report/page.tsx"),
  ]);

  assert.match(outlinePage, /ReportOutlineScreen/);
  assert.doesNotMatch(outlinePage, /LegacyClient/);
  assert.match(reportPage, /ReportWorkspace/);
  assert.doesNotMatch(reportPage, /LegacyClient/);
});

test("Phase 06 exposes versioned editing, validation, approval, and export routes", async () => {
  const routes = [
    "app/api/projects/[projectId]/report-outline/route.ts",
    "app/api/projects/[projectId]/report-outline/approve/route.ts",
    "app/api/projects/[projectId]/report/edit-sessions/route.ts",
    "app/api/projects/[projectId]/report/versions/[versionId]/route.ts",
    "app/api/projects/[projectId]/report/versions/[versionId]/approve/route.ts",
    "app/api/projects/[projectId]/report/previews/route.ts",
    "app/api/projects/[projectId]/report/validations/route.ts",
    "app/api/projects/[projectId]/report/exports/route.ts",
    "app/api/projects/[projectId]/artifacts/[artifactId]/download/route.ts",
  ];
  const sources = await Promise.all(routes.map(read));

  assert.equal(sources.length, routes.length);
  assert.ok(sources.every((source) => source.includes("withApiErrors")));
});
