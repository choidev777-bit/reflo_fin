import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

function section(source, start, end) {
  const startIndex = source.indexOf(start);
  assert.notEqual(startIndex, -1, `missing section start: ${start}`);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(endIndex, -1, `missing section end: ${end}`);
  return source.slice(startIndex, endIndex);
}

test("Phase 04 runs hypothesis and official Excel as separate pipelines", async () => {
  const [workflow, activities] = await Promise.all([
    read("workers/control/workflows.ts"),
    read("workers/control/activities.ts"),
  ]);
  const currentWorkflow = section(
    workflow,
    'patched("phase4-separated-hypothesis-excel-v1")',
    'patched("phase4-autonomous-news-v1")',
  );
  const researchAgent = section(
    activities,
    "async function callResearchAgent",
    "async function callNewsSearchAgent",
  );
  const officialExcelValidation = section(
    activities,
    "export async function validateOfficialExcelPipeline",
    "function mergeSources",
  );

  assert.match(currentWorkflow, /Promise\.all/);
  // 공식 원문은 한 번만 수집(collectResearchBundle)해 두 축이 공유하고, 후보
  // 추출은 별도 활동(extractResearchCandidates)으로 분리한다. 축별 개별 수집
  // (collectHypothesisBundle/collectOfficialExcelBundle)은 스냅샷 충돌 때문에 폐기됐다.
  assert.match(currentWorkflow, /collectResearchBundle/);
  assert.match(currentWorkflow, /extractResearchCandidates/);
  assert.match(currentWorkflow, /validateHypothesisPipeline/);
  assert.match(currentWorkflow, /validateOfficialExcelPipeline/);
  assert.match(currentWorkflow, /publishSeparatedResearchValidation/);
  assert.doesNotMatch(researchAgent, /excelTargets/);
  assert.match(officialExcelValidation, /collectOfficialExcelValues/);
  assert.doesNotMatch(
    officialExcelValidation,
    /callResearchAgent|callValidationAgent|REFLO_LLM_WORKER_URL/,
  );
});

test("targeted reruns preserve the pipeline and target boundaries", async () => {
  const repository = await read(
    "server/infrastructure/repositories/phase4-repository.ts",
  );

  assert.match(repository, /\{ kind: "question_metric"; questionId: string; metricId: string \}/);
  assert.match(repository, /\{ kind: "excel_target"; targetId: string \}/);
  assert.match(repository, /target_id = \$6::text/);
  assert.match(repository, /category = 'hypothesis'/);
  assert.match(repository, /category = 'excel'/);
});

test("evidence selection opens the retained original in the right viewer", async () => {
  const [screen, repository] = await Promise.all([
    read("app/_phase4/ValidationScreen.tsx"),
    read("server/infrastructure/repositories/phase4-repository.ts"),
  ]);
  const viewerRepository = section(
    repository,
    "export async function getEvidenceViewer",
    "export async function getValidationWorkbook",
  );

  assert.match(screen, /<iframe/);
  assert.match(screen, /DART 재무제표 원문 표/);
  assert.match(screen, /수집 시점 뉴스 기사 본문/);
  assert.match(screen, /OFFICIAL API SNAPSHOT/);
  assert.match(screen, /ref=\{markRef\}/);
  assert.match(screen, /reflo-selected-row/);
  assert.match(screen, /originalStatements/);
  assert.match(viewerRepository, /createDownloadUrl/);
  assert.match(viewerRepository, /documentUrl/);
  assert.match(viewerRepository, /locator_json/);
});

test("migrations persist scoped reruns, question answers, and normalized Excel rules", async () => {
  const [separation, scope, metadata, metricRepair, evidenceUniqueness] = await Promise.all([
    read("../infra/migrations/202607270021_step05_pipeline_separation.ts"),
    read("../infra/migrations/202607270022_question_answers_and_reinvestigation_scope.ts"),
    read("../infra/migrations/202607270023_research_plan_rule_metadata.ts"),
    read("../infra/migrations/202607270024_repair_validation_metric_id.ts"),
    read("../infra/migrations/202607270025_scope_evidence_uniqueness.ts"),
  ]);

  assert.match(separation, /metric_id/);
  assert.match(separation, /status_code/);
  assert.doesNotMatch(separation, /SET metric_id = title/);
  assert.match(scope, /scope_json/);
  assert.match(scope, /validation_question_answer/);
  assert.match(metadata, /verdict_policy/);
  assert.match(metadata, /metric_id/);
  assert.match(metadata, /period_spec/);
  assert.match(metadata, /target_unit/);
  assert.match(metadata, /scope_code/);
  assert.match(metadata, /dart_rule_id/);
  assert.match(metadata, /write_authority/);
  assert.match(metricRepair, /provenance_json->>'metricId'/);
  assert.match(metricRepair, /legacy_metric_unresolved/);
  assert.match(evidenceUniqueness, /provenance_json->>'targetId'/);
  assert.match(evidenceUniqueness, /provenance_json->>'candidateKey'/);
});

test("blocked validation still loads the read-only workbook before write preparation", async () => {
  const screen = await read("app/_phase4/ValidationScreen.tsx");
  const workbookLoad = section(
    screen,
    "workbookLoadingRef.current = true",
    '  useEffect(() => {\n    if (\n      category !== "excel" ||\n      session.status !== "authenticated" ||\n      !session.csrfToken',
  );

  assert.match(workbookLoad, /validation\/workbook/);
  assert.doesNotMatch(workbookLoad, /stageGate\.canProceed/);
  assert.match(screen, /!workspace\?\.workspace\.stageGate\.canProceed/);
  assert.match(screen, /자료 수집과 검증 실행이 생성되면 Workbook을 표시합니다/);
});

test("long network and LLM activities emit periodic heartbeats", async () => {
  const activities = await read("workers/control/activities.ts");

  assert.match(activities, /runWithPeriodicActivityHeartbeat/);
  assert.match(activities, /planning_news_search/);
  assert.match(activities, /collecting_hypothesis_sources/);
  assert.match(activities, /validating_hypothesis_evidence/);
});

test("news search runs one independently retryable activity per question", async () => {
  const [workflow, activities, worker] = await Promise.all([
    read("workers/control/workflows.ts"),
    read("workers/control/activities.ts"),
    read("workers/control/run.ts"),
  ]);
  const discovery = section(
    workflow,
    "async function discoverNews",
    "export async function fileIngestWorkflow",
  );

  assert.match(discovery, /phase4-news-search-per-question-v1/);
  assert.match(discovery, /prepareNewsSearch/);
  assert.match(discovery, /Promise\.all/);
  assert.match(discovery, /planNewsSearchQuestion/);
  assert.match(workflow, /startToCloseTimeout: "7 minutes"/);
  assert.match(activities, /export async function prepareNewsSearch/);
  assert.match(activities, /export async function planNewsSearchQuestion/);
  assert.match(activities, /AbortSignal\.timeout\(PHASE4_AGENT_FETCH_TIMEOUT_MS\)/);
  assert.match(worker, /maxConcurrentActivityTaskExecutions: 2/);
  assert.match(worker, /planNewsSearchQuestion: activities\.planNewsSearchQuestion/);
});
