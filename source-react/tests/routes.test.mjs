import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const routePages = [
  "../app/projects/page.tsx",
  "../app/projects/[projectId]/process/setup/page.tsx",
  "../app/projects/[projectId]/process/files/page.tsx",
  "../app/projects/[projectId]/process/hypothesis/page.tsx",
  "../app/projects/[projectId]/process/research-plan/page.tsx",
  "../app/projects/[projectId]/process/validation/page.tsx",
  "../app/projects/[projectId]/process/valuation/page.tsx",
  "../app/projects/[projectId]/process/report-outline/page.tsx",
  "../app/projects/[projectId]/report/page.tsx",
];

test("defines every documented REFLO screen as an App Router URL", async () => {
  await Promise.all(routePages.map((route) => access(new URL(route, import.meta.url))));
});

test("maps the seven process URLs to the existing seven screen states", async () => {
  const source = await readFile(new URL("../app/legacy-client.tsx", import.meta.url), "utf8");

  for (const [step, route] of [
    [0, "setup"],
    [1, "files"],
    [3, "hypothesis"],
    [4, "research-plan"],
    [5, "validation"],
    [9, "valuation"],
    [11, "report-outline"],
  ]) {
    assert.match(source, new RegExp(`${step}: "${route}"`));
  }

  assert.match(source, /window\.history\.pushState\(null, "", nextPath\)/);
  assert.match(source, /\/projects\/\$\{encodeURIComponent\(projectIdRef\.current\)\}\/report/);
});

test("uses dedicated Phase 1 pages instead of re-exporting the prototype root", async () => {
  const [home, projects, setup] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/projects/page.tsx", import.meta.url), "utf8"),
    readFile(
      new URL("../app/projects/[projectId]/process/setup/page.tsx", import.meta.url),
      "utf8",
    ),
  ]);

  assert.match(home, /HomeScreen/);
  assert.match(projects, /ProjectsScreen/);
  assert.match(setup, /SetupScreen/);
  assert.doesNotMatch(setup, /export \{ default \}/);
});

test("uses the real Phase 2 file workspace instead of the timer prototype", async () => {
  const [page, screen, repository] = await Promise.all([
    readFile(
      new URL("../app/projects/[projectId]/process/files/page.tsx", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../app/_phase2/FilesScreen.tsx", import.meta.url), "utf8"),
    readFile(
      new URL(
        "../server/infrastructure/repositories/file-repository.ts",
        import.meta.url,
      ),
      "utf8",
    ),
  ]);

  assert.match(page, /FilesScreen/);
  assert.doesNotMatch(page, /LegacyClient/);
  assert.match(screen, /\/files\/upload-sessions/);
  assert.match(screen, /file-inspections/);
  assert.match(screen, /document\.hidden/);
  assert.doesNotMatch(screen, /setCheckProgress/);
  assert.match(repository, /INSERT INTO outbox_event/);
  assert.match(repository, /temporal_workflow_id/);
});

test("uses the versioned Phase 3 hypothesis workspace and Agent job", async () => {
  const [page, screen, repository, workflow] = await Promise.all([
    readFile(
      new URL(
        "../app/projects/[projectId]/process/hypothesis/page.tsx",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(new URL("../app/_phase3/HypothesisScreen.tsx", import.meta.url), "utf8"),
    readFile(
      new URL(
        "../server/infrastructure/repositories/hypothesis-repository.ts",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(new URL("../workers/control/workflows.ts", import.meta.url), "utf8"),
  ]);

  assert.match(page, /HypothesisScreen/);
  assert.doesNotMatch(page, /LegacyClient/);
  assert.match(screen, /question-sets/);
  assert.match(screen, /질문 전체 승인/);
  assert.match(repository, /hypothesis_approval/);
  assert.match(repository, /INPUT_REVISION_CHANGED/);
  assert.match(workflow, /hypothesisGenerationWorkflow/);
});

test("uses the persisted Phase 4 research and validation workspaces", async () => {
  const [researchPage, validationPage, researchScreen, repository, workflow] =
    await Promise.all([
      readFile(
        new URL(
          "../app/projects/[projectId]/process/research-plan/page.tsx",
          import.meta.url,
        ),
        "utf8",
      ),
      readFile(
        new URL(
          "../app/projects/[projectId]/process/validation/page.tsx",
          import.meta.url,
        ),
        "utf8",
      ),
      readFile(
        new URL("../app/_phase4/ResearchPlanScreen.tsx", import.meta.url),
        "utf8",
      ),
      readFile(
        new URL(
          "../server/infrastructure/repositories/phase4-repository.ts",
          import.meta.url,
        ),
        "utf8",
      ),
      readFile(new URL("../workers/control/workflows.ts", import.meta.url), "utf8"),
    ]);

  assert.match(researchPage, /ResearchPlanScreen/);
  assert.match(validationPage, /ValidationScreen/);
  assert.doesNotMatch(researchPage, /LegacyClient/);
  assert.doesNotMatch(validationPage, /LegacyClient/);
  assert.match(researchScreen, /approve-and-start/);
  assert.match(repository, /INSERT INTO research_source_version/);
  assert.match(repository, /INSERT INTO validation_decision/);
  assert.match(repository, /ACCEPT_QUALIFIED/);
  assert.match(workflow, /researchValidationWorkflow/);
});
