import { createHash } from "node:crypto";
import { contentHash } from "../../domain/hash";
import { uuidv7 } from "../../domain/ids";
import { processRoute, STAGES, type StageKey } from "../../domain/project";
import {
  blockerMeta,
  resumeRouteForBlocker,
} from "../../domain/stage-blocker-policy";
import type {
  WorkerResultCommitMetadata,
  WorkerResultCommitOutcome,
} from "../../domain/worker-result-contract";
import {
  RESEARCH_SOURCE_TYPES,
  attachNewsSearchPolicies,
  calculateQuestionSufficiency,
  defaultCollectionMethod,
  normalizePublicResearchUrls,
  suggestedResearchSources,
  validateResearchPlan,
  type PlanValidationIssue,
  type ResearchCandidate,
  type ResearchExcelTarget,
  type ResearchPlanQuestion,
  type ResearchPlanSnapshot,
  type ResearchSourceReference,
  type ResearchSourceSnapshot,
  type ResearchSourceType,
  type NewsDiscoveryResult,
  type ValidatedEvidence,
} from "../../domain/research-validation";
import { ApiError } from "../../http/api-error";
import type { TransactionClient } from "../database/transaction";
import { withTransaction } from "../database/transaction";
import {
  objectStoreBucket,
  putImmutableObject,
} from "../object-storage/s3";
import { inspectResearchPdf } from "../security/research-material";
import {
  invalidateProjectStages,
  invalidateResourceDependents,
  recordResourceDependencies,
} from "../services/dependency-invalidator";
import {
  decidePinnedWorkflowJobCommit,
  lateResultRequiresAuditOnly,
  lockWorkflowJobLineage,
  pinWorkflowJobSourceSnapshot,
  recordLateWorkflowJobResult,
} from "../services/source-snapshot-service";
import {
  assertValidatedWorkbookReady,
  readPreparedValidatedWorkbook,
} from "./workbook-application-repository";

type IdempotentResult = { status: number; body: unknown };
const MAX_RESEARCH_PDF_REFERENCES = 10;
const MAX_RESEARCH_URL_REFERENCES = 20;

type ProjectContext = {
  projectId: string;
  name: string;
  rowVersion: number;
  companyMasterId: string;
  companyName: string;
  corpCode: string | null;
  ticker: string;
  exchange: "KOSPI" | "KOSDAQ" | "KONEX" | "KRX";
  industry: string;
  targetYear: number;
  targetQuarter: number;
  cutoffDate: string;
  cutoffAt: string;
  questionSetId: string;
  questionSetVersion: number;
  questionSetResourceVersionId: string;
  workbookResourceVersionId: string;
  workbookStructureHash: string;
  mappingSetResourceVersionId: string;
  setupResourceVersionId: string;
};

type PlanRow = {
  planId: string;
  resourceId: string;
  resourceVersionId: string;
  version: number;
  status: "draft" | "approved" | "revalidation_required";
  questionSetResourceVersionId: string;
  workbookResourceVersionId: string;
  mappingSetResourceVersionId: string;
  snapshot: ResearchPlanSnapshot;
  validationSummary: { valid: boolean; issues: PlanValidationIssue[] };
  lastSavedAt: string;
};

type JobProjection = {
  jobId: string;
  researchRunId: string;
  operationStatus:
    | "queued"
    | "running"
    | "succeeded"
    | "failed"
    | "cancel_requested"
    | "cancelled";
  phase: string | null;
  progressPercent: number;
  retryable: boolean;
  error: { code: string; message: string } | null;
  requestedAt: string;
  updatedAt: string;
  validationRoute: string;
};

export type PhaseFourWorkerPayload = {
  sources: ResearchSourceSnapshot[];
  candidates: ResearchCandidate[];
  evidence: ValidatedEvidence[];
  newsDiscovery?: NewsDiscoveryResult[];
  warnings: Array<{ code: string; message: string }>;
  metadata: {
    researchAgentProfile: string;
    validationAgentProfile: string;
    validationRuleVersion: string;
    startedAt: string;
    finishedAt: string;
  };
};

const VALIDATION_RULE_VERSION = "validation-sufficiency-v1";
const RESEARCH_AGENT_PROFILE = "research-openai-v1";
const VALIDATION_AGENT_PROFILE = "validation-openai-v1";

function requireIdempotencyKey(value: string | null): string {
  const key = value?.trim() ?? "";
  if (key.length < 16 || key.length > 128) {
    throw new ApiError(
      400,
      "IDEMPOTENCY_KEY_REQUIRED",
      "요청 식별자가 필요합니다. 화면을 새로고침해주세요.",
    );
  }
  return key;
}

function requireVersion(value: unknown, label: string): number {
  const version = Number(value);
  if (!Number.isInteger(version) || version < 1) {
    throw new ApiError(400, "INVALID_VERSION", `${label} 버전이 올바르지 않습니다.`);
  }
  return version;
}

function cleanReason(value: unknown): string {
  if (typeof value !== "string") {
    throw new ApiError(
      400,
      "INVALID_DECISION_REASON",
      "결정 이유를 입력해주세요.",
    );
  }
  const reason = value
    .normalize("NFC")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .trim();
  if (reason.length < 5 || reason.length > 500) {
    throw new ApiError(
      400,
      "INVALID_DECISION_REASON",
      "결정 이유는 5자 이상 500자 이하로 작성해주세요.",
    );
  }
  return reason;
}

async function idempotentReplay(
  client: TransactionClient,
  input: {
    userId: string;
    operation: string;
    projectId: string;
    key: string;
    requestHash: string;
  },
): Promise<IdempotentResult | null> {
  const result = await client.query<{
    request_hash: string;
    response_status: number;
    response_json: unknown;
  }>(
    `SELECT request_hash, response_status, response_json
     FROM idempotency_record
     WHERE user_id = $1 AND operation = $2 AND project_id = $3
       AND idempotency_key = $4 AND expires_at > now()`,
    [input.userId, input.operation, input.projectId, input.key],
  );
  const row = result.rows[0];
  if (!row) return null;
  if (row.request_hash !== input.requestHash) {
    throw new ApiError(
      409,
      "IDEMPOTENCY_KEY_REUSED",
      "같은 요청 식별자가 다른 내용에 사용되었습니다.",
    );
  }
  return { status: row.response_status, body: row.response_json };
}

async function storeIdempotency(
  client: TransactionClient,
  input: {
    userId: string;
    operation: string;
    projectId: string;
    key: string;
    requestHash: string;
    status: number;
    body: unknown;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO idempotency_record (
       idempotency_id, user_id, operation, project_id, idempotency_key,
       request_hash, response_status, response_json, expires_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, now() + interval '24 hours')
     ON CONFLICT (user_id, operation, project_id, idempotency_key) DO NOTHING`,
    [
      uuidv7(),
      input.userId,
      input.operation,
      input.projectId,
      input.key,
      input.requestHash,
      input.status,
      JSON.stringify(input.body),
    ],
  );
}

async function projectContext(
  client: TransactionClient,
  projectId: string,
  userId: string,
  lock = false,
): Promise<ProjectContext> {
  const result = await client.query<{
    project_id: string;
    name: string;
    row_version: string;
    company_master_id: string;
    company_name: string;
    corp_code: string | null;
    ticker: string;
    exchange_code: "KOSPI" | "KOSDAQ" | "KONEX" | "KRX";
    industry_name: string;
    target_year: number;
    target_quarter: number;
    cutoff_date: string;
    cutoff_at: Date;
    question_set_id: string;
    question_set_version: string;
    question_set_resource_version_id: string;
    workbook_resource_version_id: string;
    structure_hash: string;
    mapping_set_resource_version_id: string;
    setup_resource_version_id: string;
    hypothesis_status: string;
    files_status: string;
  }>(
    `SELECT p.project_id, p.name, p.row_version, cm.company_master_id,
       cm.company_name, cm.corp_code, cm.ticker, cm.exchange_code,
       cm.industry_name, psv.target_year, psv.target_quarter,
       psv.cutoff_date::text, psv.cutoff_at,
       qsv.question_set_id, qsv.version_no AS question_set_version,
       qsv.resource_version_id AS question_set_resource_version_id,
       msv.workbook_version_id AS workbook_resource_version_id,
       wv.structure_hash,
       msv.resource_version_id AS mapping_set_resource_version_id,
       setup_completion.primary_version_id AS setup_resource_version_id,
       hypothesis_state.stage_status AS hypothesis_status,
       files_state.stage_status AS files_status
     FROM project p
     JOIN project_stage_state setup_state
       ON setup_state.project_id = p.project_id AND setup_state.stage_key = 'setup'
     JOIN stage_completion setup_completion
       ON setup_completion.stage_completion_id = setup_state.current_completion_id
     JOIN project_setup_version psv
       ON psv.resource_version_id = setup_completion.primary_version_id
     JOIN company_master cm ON cm.company_master_id = psv.company_master_id
     JOIN project_stage_state files_state
       ON files_state.project_id = p.project_id AND files_state.stage_key = 'files'
     JOIN stage_completion files_completion
       ON files_completion.stage_completion_id = files_state.current_completion_id
     JOIN mapping_set_version msv
       ON msv.resource_version_id = files_completion.primary_version_id
     JOIN workbook_version wv
       ON wv.resource_version_id = msv.workbook_version_id
     JOIN project_stage_state hypothesis_state
       ON hypothesis_state.project_id = p.project_id
      AND hypothesis_state.stage_key = 'hypothesis'
     JOIN stage_completion hypothesis_completion
       ON hypothesis_completion.stage_completion_id = hypothesis_state.current_completion_id
     JOIN hypothesis_question_set_version qsv
       ON qsv.resource_version_id = hypothesis_completion.primary_version_id
     WHERE p.project_id = $1
       AND p.owner_user_id = $2
       AND p.deleted_at IS NULL
     ${lock ? "FOR UPDATE OF p" : ""}`,
    [projectId, userId],
  );
  const row = result.rows[0];
  if (!row) {
    const owned = await client.query(
      `SELECT 1 FROM project
       WHERE project_id = $1 AND owner_user_id = $2 AND deleted_at IS NULL`,
      [projectId, userId],
    );
    if (owned.rows.length === 0) {
      throw new ApiError(404, "PROJECT_NOT_FOUND", "프로젝트를 찾을 수 없습니다.");
    }
    throw new ApiError(
      409,
      "PREREQUISITE_INCOMPLETE",
      "파일 검사와 조사 질문 승인을 먼저 완료해주세요.",
      {
        meta: blockerMeta({
          projectId,
          requiredStage: "hypothesis",
        }),
      },
    );
  }
  if (
    row.files_status !== "completed" ||
    row.hypothesis_status !== "completed"
  ) {
    const stage = row.files_status !== "completed" ? "files" : "hypothesis";
    throw new ApiError(
      409,
      "PREREQUISITE_INCOMPLETE",
      "필수 선행 단계를 먼저 완료해주세요.",
      { meta: blockerMeta({ projectId, requiredStage: stage }) },
    );
  }
  return {
    projectId: row.project_id,
    name: row.name,
    rowVersion: Number(row.row_version),
    companyMasterId: row.company_master_id,
    companyName: row.company_name,
    corpCode: row.corp_code,
    ticker: row.ticker,
    exchange: row.exchange_code,
    industry: row.industry_name,
    targetYear: row.target_year,
    targetQuarter: row.target_quarter,
    cutoffDate: row.cutoff_date,
    cutoffAt: row.cutoff_at.toISOString(),
    questionSetId: row.question_set_id,
    questionSetVersion: Number(row.question_set_version),
    questionSetResourceVersionId: row.question_set_resource_version_id,
    workbookResourceVersionId: row.workbook_resource_version_id,
    workbookStructureHash: row.structure_hash,
    mappingSetResourceVersionId: row.mapping_set_resource_version_id,
    setupResourceVersionId: row.setup_resource_version_id,
  };
}

async function workflowState(client: TransactionClient, projectId: string) {
  const result = await client.query<{
    stage_key: StageKey;
    stage_order: number;
    stage_status: string;
    blocker_codes: string[];
  }>(
    `SELECT stage_key, stage_order, stage_status, blocker_codes
     FROM project_stage_state
     WHERE project_id = $1 ORDER BY stage_order`,
    [projectId],
  );
  return result.rows.map((row) => ({
    stageKey: row.stage_key,
    stageOrder: row.stage_order,
    status: row.stage_status,
    blockerCodes: row.blocker_codes,
    route: processRoute(projectId, row.stage_key),
  }));
}

function collectionTargets(metrics: string[]) {
  return metrics.map((metric) => ({
    label: metric,
    resultTypes: [
      /매출|이익|가격|수량|율|비중|주가|환율|금리/.test(metric)
        ? ("number" as const)
        : ("statement" as const),
    ],
  }));
}

async function buildDefaultSnapshot(
  client: TransactionClient,
  context: ProjectContext,
): Promise<ResearchPlanSnapshot> {
  const questionRows = await client.query<{
    question_id: string;
    display_order: number;
    question_text: string;
    purpose: string;
    metrics: string[];
    period: string;
    comparison: string;
    suggested_source_types: string[];
  }>(
    `SELECT question_id, display_order, question_text, purpose, metrics,
       period, comparison, suggested_source_types
     FROM hypothesis_question
     WHERE question_set_id = $1 AND set_version = $2
     ORDER BY display_order`,
    [context.questionSetId, context.questionSetVersion],
  );
  const questions: ResearchPlanQuestion[] = questionRows.rows.map((row) => {
    const sources = suggestedResearchSources(row.suggested_source_types);
    return {
      questionId: row.question_id,
      order: row.display_order,
      text: row.question_text,
      purpose: row.purpose,
      metrics: row.metrics,
      period: row.period,
      comparison: row.comparison,
      suggestedSourceTypes: sources,
      included: true,
      collectionTargets: collectionTargets(row.metrics),
      sourceBindingIds: sources,
      collectionMethods: Object.fromEntries(
        sources.map((source) => [source, defaultCollectionMethod(source)]),
      ),
      validationErrors: [],
    };
  });
  const mappingRows = await client.query<{
    mapping_entry_id: string;
    slot_id: string;
    semantic_metric: string;
    value_type: string;
    required: boolean;
    source_json: Record<string, unknown> | null;
    sheet_id: string | null;
    sheet_name: string | null;
    address: string | null;
  }>(
    `SELECT me.mapping_entry_id, me.slot_id, me.semantic_metric, me.value_type,
       me.required, me.source_json,
       mc.sheet_id, mc.sheet_name, mc.address
     FROM mapping_entry me
     LEFT JOIN mapping_candidate mc
       ON mc.mapping_candidate_id = me.selected_candidate_id
     WHERE me.mapping_set_version_id = $1
       AND me.mapping_status = 'confirmed'
       AND me.binding_kind = 'scalar'
     ORDER BY me.required DESC, me.semantic_metric`,
    [context.mappingSetResourceVersionId],
  );
  const excelTargets: ResearchExcelTarget[] = mappingRows.rows
    .filter((row) => row.sheet_id && row.sheet_name && row.address)
    .map((row) => {
      const metric = row.semantic_metric;
      const marketPrice = /주가|종가/.test(metric);
      return {
        targetId: row.mapping_entry_id,
        sheetId: row.sheet_id!,
        sheetName: row.sheet_name!,
        address: row.address!,
        metric,
        period: `${context.targetYear}년 ${context.targetQuarter}분기`,
        unit: /율|비중|마진/.test(metric) ? "%" : "원",
        scope: "연결",
        valueKind: "actual",
        required: row.required,
        included: true,
        sourcePolicy: [
          {
            sourceType: marketPrice ? ("KRX" as const) : ("DART" as const),
            role: "authority" as const,
          },
          ...(/제품|사업|부문/.test(metric)
            ? [
                {
                  sourceType: "COMPANY_IR" as const,
                  role: "verification" as const,
                },
              ]
            : []),
        ],
        mappingSlotIds: [row.slot_id],
        excludedReason: null,
      };
    });
  return attachNewsSearchPolicies(
    { questions, excelTargets, userUrls: [], sourceReferences: [] },
    {
      targetYear: context.targetYear,
      targetQuarter: context.targetQuarter,
      cutoffAt: context.cutoffAt,
    },
  );
}

async function insertPlanSnapshot(
  client: TransactionClient,
  input: {
    context: ProjectContext;
    userId: string;
    planId: string;
    resourceId: string;
    version: number;
    previousResourceVersionId: string | null;
    snapshot: ResearchPlanSnapshot;
    status?: "draft" | "revalidation_required";
  },
): Promise<PlanRow> {
  const resourceVersionId = uuidv7();
  const issues = validateResearchPlan(input.snapshot, input.context.cutoffAt);
  const status = input.status ?? "draft";
  await client.query(
    `INSERT INTO resource_version (
       resource_version_id, resource_id, version_no, lifecycle_status,
       supersedes_version_id, input_fingerprint, content_hash,
       created_by_user_id
     ) VALUES ($1, $2, $3, 'draft', $4, $5, $6, $7)`,
    [
      resourceVersionId,
      input.resourceId,
      input.version,
      input.previousResourceVersionId,
      contentHash({
        questionSet: input.context.questionSetResourceVersionId,
        workbook: input.context.workbookResourceVersionId,
        mapping: input.context.mappingSetResourceVersionId,
        cutoffAt: input.context.cutoffAt,
      }),
      contentHash(input.snapshot),
      input.userId,
    ],
  );
  await client.query(
    `INSERT INTO research_plan_version (
       resource_version_id, plan_id, project_id, version_no, status,
       question_set_id, question_set_version,
       question_set_resource_version_id, workbook_resource_version_id,
       workbook_structure_hash, mapping_set_resource_version_id, cutoff_at,
       plan_snapshot_json, validation_summary_json, created_by_user_id
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
       $13::jsonb, $14::jsonb, $15
     )`,
    [
      resourceVersionId,
      input.planId,
      input.context.projectId,
      input.version,
      status,
      input.context.questionSetId,
      input.context.questionSetVersion,
      input.context.questionSetResourceVersionId,
      input.context.workbookResourceVersionId,
      input.context.workbookStructureHash,
      input.context.mappingSetResourceVersionId,
      input.context.cutoffAt,
      JSON.stringify(input.snapshot),
      JSON.stringify({ valid: issues.length === 0, issues }),
      input.userId,
    ],
  );
  await recordResourceDependencies(client, {
    projectId: input.context.projectId,
    dependencies: [
      {
        upstreamResourceVersionId:
          input.context.questionSetResourceVersionId,
        downstreamResourceVersionId: resourceVersionId,
        dependencyKind: "question_set_to_research_plan",
      },
      {
        upstreamResourceVersionId: input.context.workbookResourceVersionId,
        downstreamResourceVersionId: resourceVersionId,
        dependencyKind: "workbook_analysis_to_research_plan",
      },
      {
        upstreamResourceVersionId: input.context.mappingSetResourceVersionId,
        downstreamResourceVersionId: resourceVersionId,
        dependencyKind: "mapping_set_to_research_plan",
      },
      {
        upstreamResourceVersionId: input.context.setupResourceVersionId,
        downstreamResourceVersionId: resourceVersionId,
        dependencyKind: "setup_to_research_plan",
      },
    ],
  });
  for (const question of input.snapshot.questions) {
    await client.query(
      `INSERT INTO research_plan_question (
         plan_resource_version_id, question_id, display_order, question_text,
         purpose, metrics, period, comparison, included, source_binding_ids,
         collection_targets, collection_methods
       ) VALUES (
         $1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10::jsonb,
         $11::jsonb, $12::jsonb
       )`,
      [
        resourceVersionId,
        question.questionId,
        question.order,
        question.text,
        question.purpose,
        JSON.stringify(question.metrics),
        question.period,
        question.comparison,
        question.included,
        JSON.stringify(question.sourceBindingIds),
        JSON.stringify(question.collectionTargets),
        JSON.stringify(question.collectionMethods),
      ],
    );
  }
  for (const target of input.snapshot.excelTargets) {
    await client.query(
      `INSERT INTO research_plan_excel_target (
         plan_resource_version_id, target_id, sheet_id, sheet_name, address,
         metric, period, unit, scope, value_kind, required, included,
         source_policy, mapping_slot_ids
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
         $13::jsonb, $14::jsonb
       )`,
      [
        resourceVersionId,
        target.targetId,
        target.sheetId,
        target.sheetName,
        target.address,
        target.metric,
        target.period,
        target.unit,
        target.scope,
        target.valueKind,
        target.required,
        target.included,
        JSON.stringify(target.sourcePolicy),
        JSON.stringify(target.mappingSlotIds),
      ],
    );
  }
  return {
    planId: input.planId,
    resourceId: input.resourceId,
    resourceVersionId,
    version: input.version,
    status,
    questionSetResourceVersionId: input.context.questionSetResourceVersionId,
    workbookResourceVersionId: input.context.workbookResourceVersionId,
    mappingSetResourceVersionId: input.context.mappingSetResourceVersionId,
    snapshot: input.snapshot,
    validationSummary: { valid: issues.length === 0, issues },
    lastSavedAt: new Date().toISOString(),
  };
}

async function loadPlan(
  client: TransactionClient,
  context: ProjectContext,
): Promise<PlanRow | null> {
  const result = await client.query<{
    plan_id: string;
    resource_id: string;
    current_resource_version_id: string;
    current_version: string;
    status: PlanRow["status"];
    question_set_resource_version_id: string;
    workbook_resource_version_id: string;
    mapping_set_resource_version_id: string;
    plan_snapshot_json: ResearchPlanSnapshot;
    validation_summary_json: PlanRow["validationSummary"];
    last_saved_at: Date;
  }>(
    `SELECT rp.plan_id, rp.resource_id, rp.current_resource_version_id,
       rp.current_version, rp.status,
       rpv.question_set_resource_version_id,
       rpv.workbook_resource_version_id,
       rpv.mapping_set_resource_version_id,
       rpv.plan_snapshot_json, rpv.validation_summary_json,
       rp.last_saved_at
     FROM research_plan rp
     JOIN research_plan_version rpv
       ON rpv.resource_version_id = rp.current_resource_version_id
     WHERE rp.project_id = $1`,
    [context.projectId],
  );
  const row = result.rows[0];
  if (!row) return null;
  const snapshot = attachNewsSearchPolicies(
    {
      ...row.plan_snapshot_json,
      userUrls: row.plan_snapshot_json.userUrls ?? [],
      sourceReferences: row.plan_snapshot_json.sourceReferences ?? [],
    },
    {
      targetYear: context.targetYear,
      targetQuarter: context.targetQuarter,
      cutoffAt: context.cutoffAt,
    },
  );
  const issues = validateResearchPlan(snapshot, context.cutoffAt);
  return {
    planId: row.plan_id,
    resourceId: row.resource_id,
    resourceVersionId: row.current_resource_version_id,
    version: Number(row.current_version),
    status: row.status,
    questionSetResourceVersionId: row.question_set_resource_version_id,
    workbookResourceVersionId: row.workbook_resource_version_id,
    mappingSetResourceVersionId: row.mapping_set_resource_version_id,
    snapshot,
    validationSummary: { valid: issues.length === 0, issues },
    lastSavedAt: row.last_saved_at.toISOString(),
  };
}

async function ensurePlan(
  client: TransactionClient,
  context: ProjectContext,
  userId: string,
): Promise<PlanRow> {
  const existing = await loadPlan(client, context);
  const refsMatch =
    existing &&
    existing.questionSetResourceVersionId ===
      context.questionSetResourceVersionId &&
    existing.workbookResourceVersionId === context.workbookResourceVersionId &&
    existing.mappingSetResourceVersionId ===
      context.mappingSetResourceVersionId;
  if (refsMatch) return existing;
  const snapshot = await buildDefaultSnapshot(client, context);
  if (!existing) {
    const planId = uuidv7();
    const resourceId = uuidv7();
    await client.query(
      `INSERT INTO versioned_resource (
         resource_id, project_id, resource_kind, resource_key
       ) VALUES ($1, $2, 'research_plan', 'main')`,
      [resourceId, context.projectId],
    );
    const created = await insertPlanSnapshot(client, {
      context,
      userId,
      planId,
      resourceId,
      version: 1,
      previousResourceVersionId: null,
      snapshot,
    });
    await client.query(
      `INSERT INTO research_plan (
         plan_id, project_id, resource_id, current_resource_version_id,
         current_version, status, updated_by_user_id
       ) VALUES ($1, $2, $3, $4, 1, 'draft', $5)`,
      [planId, context.projectId, resourceId, created.resourceVersionId, userId],
    );
    return created;
  }
  await client.query(
    `UPDATE resource_version SET lifecycle_status = 'superseded'
     WHERE resource_version_id = $1`,
    [existing.resourceVersionId],
  );
  await client.query(
    `UPDATE research_plan_version SET status = 'superseded'
     WHERE resource_version_id = $1`,
    [existing.resourceVersionId],
  );
  const created = await insertPlanSnapshot(client, {
    context,
    userId,
    planId: existing.planId,
    resourceId: existing.resourceId,
    version: existing.version + 1,
    previousResourceVersionId: existing.resourceVersionId,
    snapshot,
    status: "revalidation_required",
  });
  await client.query(
    `UPDATE research_plan
     SET current_resource_version_id = $2, current_version = $3,
         status = 'revalidation_required', updated_by_user_id = $4,
         last_saved_at = now()
     WHERE plan_id = $1`,
    [
      existing.planId,
      created.resourceVersionId,
      created.version,
      userId,
    ],
  );
  await invalidateResourceDependents(client, {
    projectId: context.projectId,
    upstreamResourceVersionIds: [existing.resourceVersionId],
  });
  return created;
}

async function activeResearchJob(
  client: TransactionClient,
  projectId: string,
  approvedPlanResourceVersionId?: string,
): Promise<JobProjection | null> {
  const result = await client.query<{
    job_id: string;
    research_run_id: string;
    operation_status: JobProjection["operationStatus"];
    current_phase: string | null;
    progress_percent: number;
    retryable: boolean;
    error_code: string | null;
    error_summary: string | null;
    requested_at: Date;
    heartbeat_at: Date | null;
    finished_at: Date | null;
  }>(
    `SELECT wj.job_id, rr.research_run_id, wj.operation_status,
       wj.current_phase, wj.progress_percent, wj.retryable,
       wj.error_code, wj.error_summary, wj.requested_at,
       wj.heartbeat_at, wj.finished_at
     FROM research_run rr
     JOIN workflow_job wj ON wj.job_id = rr.job_id
     WHERE rr.project_id = $1
       AND ($2::uuid IS NULL OR rr.approved_plan_resource_version_id = $2)
     ORDER BY wj.requested_at DESC LIMIT 1`,
    [projectId, approvedPlanResourceVersionId ?? null],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    jobId: row.job_id,
    researchRunId: row.research_run_id,
    operationStatus: row.operation_status,
    phase: row.current_phase,
    progressPercent: row.progress_percent,
    retryable: row.retryable,
    error:
      row.error_code && row.error_summary
        ? { code: row.error_code, message: row.error_summary }
        : null,
    requestedAt: row.requested_at.toISOString(),
    updatedAt: (
      row.heartbeat_at ??
      row.finished_at ??
      row.requested_at
    ).toISOString(),
    validationRoute: processRoute(projectId, "validation"),
  };
}

function sourceOptions() {
  const labels: Record<
    ResearchSourceType,
    { label: string; description: string }
  > = {
    DART: { label: "DART 공시", description: "공식 공시·재무제표" },
    COMPANY_IR: {
      label: "기업 IR",
      description: "사용자가 제공한 공식 PDF 또는 IR URL",
    },
    NEWS: {
      label: "뉴스",
      description: "AI가 설정된 기간 안에서 실제 뉴스 원문을 검색",
    },
    KRX: { label: "KRX", description: "주가·거래 데이터" },
    ECOS: { label: "한국은행 ECOS", description: "금리·환율 등 거시지표" },
    FNGUIDE_CONSENSUS: {
      label: "FnGuide 컨센서스",
      description: "시장 예상치 비교 snapshot",
    },
    USER_MATERIAL: {
      label: "사용자 자료",
      description: "검사한 파일 또는 공개 URL",
    },
  };
  return RESEARCH_SOURCE_TYPES.filter(
    (sourceType) => sourceType !== "FNGUIDE_CONSENSUS",
  ).map((sourceType) => ({
    sourceType,
    ...labels[sourceType],
    collectionMethod: defaultCollectionMethod(sourceType),
  }));
}

export async function getResearchPlanWorkspace(
  projectId: string,
  userId: string,
): Promise<unknown> {
  return withTransaction(async (client) => {
    const context = await projectContext(client, projectId, userId, true);
    const plan = await ensurePlan(client, context, userId);
    const stages = await workflowState(client, projectId);
    return {
      project: {
        projectId,
        name: context.name,
        companyName: context.companyName,
        ticker: context.ticker,
        industry: context.industry,
        targetPeriod: {
          year: context.targetYear,
          quarter: context.targetQuarter,
        },
        cutoffDate: context.cutoffDate,
        cutoffAt: context.cutoffAt,
        currentStage: "research_plan",
      },
      prerequisites: {
        questionSetVersion: context.questionSetVersion,
        questionSetVersionId: context.questionSetResourceVersionId,
        questionSetApproved: true,
        workbookVersionId: context.workbookResourceVersionId,
        workbookStructureHash: context.workbookStructureHash,
        mappingSetVersionId: context.mappingSetResourceVersionId,
      },
      plan: {
        planId: plan.planId,
        version: plan.version,
        status: plan.status,
        questions: plan.snapshot.questions,
        excelTargets: plan.snapshot.excelTargets,
        userUrls: plan.snapshot.userUrls,
        sourceReferences: plan.snapshot.sourceReferences ?? [],
        validationSummary: plan.validationSummary,
        lastSavedAt: plan.lastSavedAt,
      },
      sourceOptions: sourceOptions(),
      policy: {
        fileLimit: 10,
        urlLimit: 20,
        allowedFileTypes: [
          { extension: ".pdf", maxBytes: 50 * 1024 * 1024 },
          { extension: ".xlsx", maxBytes: 100 * 1024 * 1024 },
          { extension: ".csv", maxBytes: 10 * 1024 * 1024 },
          { extension: ".txt", maxBytes: 5 * 1024 * 1024 },
        ],
      },
      activeJob: await activeResearchJob(
        client,
        projectId,
        plan.resourceVersionId,
      ),
      workflow: {
        stageStates: stages,
        allowedRoutes: stages
          .filter(
            (stage) =>
              stage.status !== "blocked" && stage.status !== "not_started",
          )
          .map((stage) => stage.route),
      },
      navigation: {
        previousRoute: processRoute(projectId, "hypothesis"),
        validationRoute: processRoute(projectId, "validation"),
      },
    };
  });
}

type PlanChange =
  | { op: "set_question_included"; questionId: string; included: boolean }
  | {
      op: "set_question_sources";
      questionId: string;
      sourceBindingIds: ResearchSourceType[];
    }
  | {
      op: "set_excel_target_included";
      targetId: string;
      included: boolean;
    }
  | { op: "set_user_urls"; urls: string[] };

function applyPlanChanges(
  snapshot: ResearchPlanSnapshot,
  changes: unknown,
  context: Pick<ProjectContext, "targetYear" | "targetQuarter" | "cutoffAt">,
): ResearchPlanSnapshot {
  if (!Array.isArray(changes) || changes.length < 1 || changes.length > 30) {
    throw new ApiError(
      400,
      "INVALID_PLAN_CHANGE",
      "저장할 계획 변경 내용을 확인해주세요.",
    );
  }
  const next = structuredClone(snapshot);
  for (const value of changes) {
    if (!value || typeof value !== "object" || !("op" in value)) {
      throw new ApiError(400, "INVALID_PLAN_CHANGE", "계획 변경 형식이 올바르지 않습니다.");
    }
    const change = value as PlanChange;
    if (change.op === "set_question_included") {
      const question = next.questions.find(
        (item) => item.questionId === change.questionId,
      );
      if (!question || typeof change.included !== "boolean") {
        throw new ApiError(400, "INVALID_PLAN_CHANGE", "질문 대상을 다시 선택해주세요.");
      }
      question.included = change.included;
    } else if (change.op === "set_question_sources") {
      const question = next.questions.find(
        (item) => item.questionId === change.questionId,
      );
      if (
        !question ||
        !Array.isArray(change.sourceBindingIds) ||
        change.sourceBindingIds.some(
          (source) => !RESEARCH_SOURCE_TYPES.includes(source),
        )
      ) {
        throw new ApiError(400, "INVALID_PLAN_CHANGE", "질문 출처를 다시 선택해주세요.");
      }
      question.sourceBindingIds = Array.from(new Set(change.sourceBindingIds));
      question.collectionMethods = Object.fromEntries(
        question.sourceBindingIds.map((source) => [
          source,
          defaultCollectionMethod(source),
        ]),
      );
    } else if (change.op === "set_excel_target_included") {
      const target = next.excelTargets.find(
        (item) => item.targetId === change.targetId,
      );
      if (!target || typeof change.included !== "boolean") {
        throw new ApiError(400, "INVALID_PLAN_CHANGE", "Excel 대상을 다시 선택해주세요.");
      }
      if (target.required && !change.included) {
        throw new ApiError(
          422,
          "PLAN_VALIDATION_FAILED",
          "필수 Excel 실제값은 제외할 수 없습니다.",
        );
      }
      target.included = change.included;
    } else if (change.op === "set_user_urls") {
      next.userUrls = normalizePublicResearchUrls(change.urls);
    } else {
      throw new ApiError(400, "INVALID_PLAN_CHANGE", "지원하지 않는 계획 변경입니다.");
    }
  }
  const hydrated = attachNewsSearchPolicies(next, context);
  const issues = validateResearchPlan(hydrated, context.cutoffAt);
  for (const question of hydrated.questions) {
    question.validationErrors = issues
      .filter((issue) => issue.targetId === question.questionId)
      .map((issue) => issue.message);
  }
  return hydrated;
}

export async function saveResearchPlan(input: {
  projectId: string;
  userId: string;
  expectedVersion: unknown;
  changes: unknown;
}): Promise<unknown> {
  const expectedVersion = requireVersion(input.expectedVersion, "조사 계획");
  return withTransaction(async (client) => {
    const context = await projectContext(
      client,
      input.projectId,
      input.userId,
      true,
    );
    const plan = await ensurePlan(client, context, input.userId);
    const job = await activeResearchJob(client, input.projectId);
    if (
      job &&
      ["queued", "running", "cancel_requested"].includes(job.operationStatus)
    ) {
      throw new ApiError(
        409,
        "PLAN_LOCKED_BY_ACTIVE_JOB",
        "자료 수집 중에는 승인 계획을 수정할 수 없습니다.",
      );
    }
    if (plan.version !== expectedVersion) {
      throw new ApiError(
        409,
        "PLAN_VERSION_CONFLICT",
        "다른 화면에서 조사 계획이 변경되었습니다.",
        { meta: { currentVersion: plan.version } },
      );
    }
    const snapshot = applyPlanChanges(plan.snapshot, input.changes, context);
    const created = await replacePlanSnapshot(client, {
      context,
      plan,
      userId: input.userId,
      snapshot,
    });
    return {
      version: created.version,
      questions: snapshot.questions,
      excelTargets: snapshot.excelTargets,
      userUrls: snapshot.userUrls,
      sourceReferences: snapshot.sourceReferences ?? [],
      validationSummary: created.validationSummary,
      lastSavedAt: created.lastSavedAt,
    };
  });
}

type ManualResearchSourceType = Exclude<
  ResearchSourceReference["sourceType"],
  "NEWS"
>;

function requireManualSourceType(value: unknown): ManualResearchSourceType {
  if (
    value !== "COMPANY_IR" &&
    value !== "USER_MATERIAL"
  ) {
    if (value === "NEWS") {
      throw new ApiError(
        422,
        "NEWS_MANUAL_MATERIAL_UNSUPPORTED",
        "뉴스는 Research Agent가 설정된 기간 안에서 자동으로 검색합니다.",
      );
    }
    throw new ApiError(
      422,
      "SOURCE_TYPE_INVALID",
      "사용자가 제공할 자료 유형을 다시 선택해주세요.",
    );
  }
  return value;
}

function cleanMaterialText(
  value: unknown,
  label: string,
  maxLength: number,
): string {
  if (typeof value !== "string") {
    throw new ApiError(422, "SOURCE_METADATA_INVALID", `${label}을 입력해주세요.`);
  }
  const result = value
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!result || result.length > maxLength) {
    throw new ApiError(
      422,
      "SOURCE_METADATA_INVALID",
      `${label}은 ${maxLength}자 이하로 입력해주세요.`,
    );
  }
  return result;
}

function materialPublishedAt(
  value: unknown,
  cutoffAt: string,
  required: boolean,
): string | null {
  if ((value === null || value === undefined || value === "") && !required) {
    return null;
  }
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw new ApiError(
      422,
      "SOURCE_PUBLISHED_AT_INVALID",
      "자료 발행일을 확인해주세요.",
    );
  }
  const publishedAt = new Date(value).toISOString();
  if (new Date(publishedAt).getTime() > new Date(cutoffAt).getTime()) {
    throw new ApiError(
      422,
      "SOURCE_CUTOFF_VIOLATION",
      "보고서 기준일 이후에 발행된 자료는 사용할 수 없습니다.",
    );
  }
  return publishedAt;
}

function assertResearchMaterialCapacity(
  snapshot: ResearchPlanSnapshot,
  ingestionMethod: ResearchSourceReference["ingestionMethod"],
): void {
  const limit =
    ingestionMethod === "user_upload"
      ? MAX_RESEARCH_PDF_REFERENCES
      : MAX_RESEARCH_URL_REFERENCES;
  const count = (snapshot.sourceReferences ?? []).filter(
    (reference) => reference.ingestionMethod === ingestionMethod,
  ).length;
  if (count >= limit) {
    throw new ApiError(
      422,
      "SOURCE_REFERENCE_LIMIT_EXCEEDED",
      ingestionMethod === "user_upload"
        ? `PDF 자료는 프로젝트당 ${limit}개까지 연결할 수 있습니다.`
        : `URL 자료는 프로젝트당 ${limit}개까지 연결할 수 있습니다.`,
    );
  }
}

async function replacePlanSnapshot(
  client: TransactionClient,
  input: {
    context: ProjectContext;
    plan: PlanRow;
    userId: string;
    snapshot: ResearchPlanSnapshot;
  },
): Promise<PlanRow> {
  await client.query(
    `UPDATE resource_version SET lifecycle_status = 'superseded'
     WHERE resource_version_id = $1`,
    [input.plan.resourceVersionId],
  );
  await client.query(
    `UPDATE research_plan_version SET status = 'superseded'
     WHERE resource_version_id = $1`,
    [input.plan.resourceVersionId],
  );
  const created = await insertPlanSnapshot(client, {
    context: input.context,
    userId: input.userId,
    planId: input.plan.planId,
    resourceId: input.plan.resourceId,
    version: input.plan.version + 1,
    previousResourceVersionId: input.plan.resourceVersionId,
    snapshot: input.snapshot,
  });
  await client.query(
    `UPDATE research_plan
     SET current_resource_version_id = $2, current_version = $3,
         status = 'draft', updated_by_user_id = $4, last_saved_at = now()
     WHERE plan_id = $1`,
    [
      input.plan.planId,
      created.resourceVersionId,
      created.version,
      input.userId,
    ],
  );
  await invalidateResourceDependents(client, {
    projectId: input.context.projectId,
    upstreamResourceVersionIds: [input.plan.resourceVersionId],
  });
  if (input.plan.status === "approved") {
    await invalidateProjectStages(client, {
      projectId: input.context.projectId,
      triggerVersionId: created.resourceVersionId,
      startStageKey: "research_plan",
      reasonCode: "PLAN_REVALIDATION_REQUIRED",
      transitions: [
        {
          stageKey: "research_plan",
          stageStatus: "in_progress",
          blockerCodes: [],
          clearCompletion: true,
          eligibleStatuses: [
            "not_started",
            "in_progress",
            "completed",
            "revalidation_required",
            "blocked",
          ],
        },
        {
          stageKey: "validation",
          stageStatus: "blocked",
          blockerCodes: ["PLAN_REVALIDATION_REQUIRED"],
          eligibleStatuses: [
            "not_started",
            "in_progress",
            "completed",
            "revalidation_required",
            "blocked",
          ],
        },
      ],
      markProjectRevalidation: true,
    });
    await client.query(
      `UPDATE validation_workspace
       SET workspace_status = 'REVIEW_BLOCKED', updated_at = now()
       WHERE project_id = $1`,
      [input.context.projectId],
    );
  }
  return created;
}

export async function addResearchMaterial(input: {
  projectId: string;
  userId: string;
  expectedVersion: unknown;
  sourceType: unknown;
  title: unknown;
  publishedAt: unknown;
  url?: unknown;
  file?: { name: string; mediaType: string; bytes: Buffer };
}): Promise<unknown> {
  const expectedVersion = requireVersion(input.expectedVersion, "조사 계획");
  const sourceType = requireManualSourceType(input.sourceType);
  if (!!input.file === (input.url !== undefined && input.url !== null && input.url !== "")) {
    throw new ApiError(
      422,
      "SOURCE_INPUT_INVALID",
      "PDF 파일 또는 공개 URL 중 하나만 입력해주세요.",
    );
  }
  const ingestionMethod = input.file ? "user_upload" : "user_url";
  const referenceId = uuidv7();
  const artifactId = input.file ? uuidv7() : null;
  const title = cleanMaterialText(input.title, "자료명", 200);
  await withTransaction(async (client) => {
    const context = await projectContext(client, input.projectId, input.userId, true);
    const plan = await ensurePlan(client, context, input.userId);
    if (plan.version !== expectedVersion) {
      throw new ApiError(
        409,
        "PLAN_VERSION_CONFLICT",
        "최신 조사 계획을 다시 확인해주세요.",
      );
    }
    const active = await activeResearchJob(client, input.projectId);
    if (
      active &&
      ["queued", "running", "cancel_requested"].includes(active.operationStatus)
    ) {
      throw new ApiError(
        409,
        "PLAN_LOCKED_BY_ACTIVE_JOB",
        "자료 수집 중에는 자료를 변경할 수 없습니다.",
      );
    }
    assertResearchMaterialCapacity(plan.snapshot, ingestionMethod);
  });
  let stored:
    | {
        objectKey: string;
        objectVersion: string;
        sha256: string;
        byteSize: number;
        mediaType: string;
        originalFilename: string;
      }
    | undefined;
  if (input.file) {
    await inspectResearchPdf(input.file.bytes);
    const sha256 = createHash("sha256").update(input.file.bytes).digest("hex");
    const objectKey = `immutable/${input.projectId}/research-materials/${referenceId}.pdf`;
    const object = await putImmutableObject({
      objectKey,
      body: input.file.bytes,
      mediaType: "application/pdf",
      metadata: { sha256 },
    });
    stored = {
      objectKey,
      objectVersion: object.objectVersion,
      sha256,
      byteSize: input.file.bytes.byteLength,
      mediaType: "application/pdf",
      originalFilename: cleanMaterialText(input.file.name, "파일명", 255),
    };
  }
  return withTransaction(async (client) => {
    const context = await projectContext(client, input.projectId, input.userId, true);
    const plan = await ensurePlan(client, context, input.userId);
    if (plan.version !== expectedVersion) {
      throw new ApiError(
        409,
        "PLAN_VERSION_CONFLICT",
        "최신 조사 계획을 다시 확인해주세요.",
      );
    }
    const active = await activeResearchJob(client, input.projectId);
    if (
      active &&
      ["queued", "running", "cancel_requested"].includes(active.operationStatus)
    ) {
      throw new ApiError(
        409,
        "PLAN_LOCKED_BY_ACTIVE_JOB",
        "자료 수집 중에는 자료를 변경할 수 없습니다.",
      );
    }
    assertResearchMaterialCapacity(plan.snapshot, ingestionMethod);
    const publishedAt = materialPublishedAt(
      input.publishedAt,
      context.cutoffAt,
      sourceType !== "USER_MATERIAL",
    );
    const canonicalUrl = stored ? null : normalizePublicResearchUrls([input.url])[0];
    const publisher =
      sourceType === "COMPANY_IR"
        ? context.companyName
        : canonicalUrl
          ? new URL(canonicalUrl).hostname
          : "사용자 제공 자료";
    if (stored && artifactId) {
      await client.query(
        `INSERT INTO artifact (
           artifact_id, project_id, artifact_kind, storage_status, bucket_name,
           object_key, object_version, sha256, byte_size, media_type,
           original_filename, retention_class, created_by_actor_type
         ) VALUES (
           $1, $2, 'source', 'accepted', $3, $4, $5, $6, $7, $8, $9,
           'evidence', 'user'
         )`,
        [
          artifactId,
          input.projectId,
          objectStoreBucket(),
          stored.objectKey,
          stored.objectVersion,
          stored.sha256,
          stored.byteSize,
          stored.mediaType,
          stored.originalFilename,
        ],
      );
    }
    await client.query(
      `INSERT INTO research_source_reference (
         source_reference_id, project_id, plan_id, source_type,
         canonical_url, artifact_id, status, ingestion_method,
         title, publisher, published_at, created_by_user_id
       ) VALUES (
         $1, $2, $3, $4, $5, $6, 'accepted', $7, $8, $9, $10, $11
       )`,
      [
        referenceId,
        input.projectId,
        plan.planId,
        sourceType,
        canonicalUrl,
        artifactId,
        ingestionMethod,
        title,
        publisher,
        publishedAt,
        input.userId,
      ],
    );
    const reference: ResearchSourceReference = {
      referenceId,
      sourceType,
      ingestionMethod,
      title,
      publisher,
      publishedAt,
      canonicalUrl,
      artifactId,
      originalFilename: stored?.originalFilename ?? null,
      mediaType: stored?.mediaType ?? null,
      byteSize: stored?.byteSize ?? null,
      sha256: stored?.sha256 ?? null,
    };
    const snapshot: ResearchPlanSnapshot = {
      ...structuredClone(plan.snapshot),
      sourceReferences: [...(plan.snapshot.sourceReferences ?? []), reference],
    };
    const created = await replacePlanSnapshot(client, {
      context,
      plan,
      userId: input.userId,
      snapshot,
    });
    return {
      version: created.version,
      sourceReferences: snapshot.sourceReferences,
      validationSummary: created.validationSummary,
      lastSavedAt: created.lastSavedAt,
    };
  });
}

export async function removeResearchMaterial(input: {
  projectId: string;
  userId: string;
  referenceId: string;
  expectedVersion: unknown;
}): Promise<unknown> {
  const expectedVersion = requireVersion(input.expectedVersion, "조사 계획");
  return withTransaction(async (client) => {
    const context = await projectContext(client, input.projectId, input.userId, true);
    const plan = await ensurePlan(client, context, input.userId);
    if (plan.version !== expectedVersion) {
      throw new ApiError(
        409,
        "PLAN_VERSION_CONFLICT",
        "최신 조사 계획을 다시 확인해주세요.",
      );
    }
    const reference = (plan.snapshot.sourceReferences ?? []).find(
      (item) => item.referenceId === input.referenceId,
    );
    if (!reference) {
      throw new ApiError(404, "SOURCE_REFERENCE_NOT_FOUND", "자료를 찾을 수 없습니다.");
    }
    await client.query(
      `UPDATE research_source_reference
       SET status = 'superseded'
       WHERE source_reference_id = $1 AND project_id = $2`,
      [input.referenceId, input.projectId],
    );
    if (reference.artifactId) {
      await client.query(
        `UPDATE artifact SET storage_status = 'superseded'
         WHERE artifact_id = $1 AND project_id = $2`,
        [reference.artifactId, input.projectId],
      );
    }
    const snapshot: ResearchPlanSnapshot = {
      ...structuredClone(plan.snapshot),
      sourceReferences: (plan.snapshot.sourceReferences ?? []).filter(
        (item) => item.referenceId !== input.referenceId,
      ),
    };
    const created = await replacePlanSnapshot(client, {
      context,
      plan,
      userId: input.userId,
      snapshot,
    });
    return {
      version: created.version,
      sourceReferences: snapshot.sourceReferences,
      validationSummary: created.validationSummary,
      lastSavedAt: created.lastSavedAt,
    };
  });
}

function workflowPayload(input: {
  context: ProjectContext;
  plan: PlanRow;
  jobId: string;
  runId: string;
  attempt: number;
  sourceReferences: Array<
    ResearchSourceReference & { objectKey: string | null }
  >;
}) {
  return {
    workflowType: "researchValidationWorkflow",
    jobId: input.jobId,
    jobAttempt: input.attempt,
    projectId: input.context.projectId,
    researchRunId: input.runId,
    approvedPlanResourceVersionId: input.plan.resourceVersionId,
    sourceInputVersionIds: [
      input.plan.resourceVersionId,
      input.context.questionSetResourceVersionId,
      input.context.workbookResourceVersionId,
      input.context.mappingSetResourceVersionId,
      input.context.setupResourceVersionId,
    ],
    companyMasterId: input.context.companyMasterId,
    companyName: input.context.companyName,
    corpCode: input.context.corpCode,
    ticker: input.context.ticker,
    exchange: input.context.exchange,
    industry: input.context.industry,
    targetYear: input.context.targetYear,
    targetQuarter: input.context.targetQuarter,
    cutoffDate: input.context.cutoffDate,
    cutoffAt: input.context.cutoffAt,
    questions: input.plan.snapshot.questions,
    excelTargets: input.plan.snapshot.excelTargets,
    userUrls: input.plan.snapshot.userUrls,
    sourceReferences: input.sourceReferences,
    researchAgentProfile: {
      version: RESEARCH_AGENT_PROFILE,
      model: "gpt-5.6-terra",
      reasoning: "medium",
    },
    validationAgentProfile: {
      version: VALIDATION_AGENT_PROFILE,
      model: "gpt-5.6-terra",
      reasoning: "medium",
    },
    validationRuleVersion: VALIDATION_RULE_VERSION,
  };
}

async function createResearchJob(
  client: TransactionClient,
  input: {
    context: ProjectContext;
    plan: PlanRow;
    userId: string;
    runKind: "initial" | "reinvestigation";
    supersedesRunId?: string | null;
  },
): Promise<{ jobId: string; runId: string }> {
  const jobId = uuidv7();
  const runId = uuidv7();
  const referenceIds = (input.plan.snapshot.sourceReferences ?? []).map(
    (reference) => reference.referenceId,
  );
  const materialRows =
    referenceIds.length === 0
      ? { rows: [] as Array<{ source_reference_id: string; object_key: string | null }> }
      : await client.query<{
          source_reference_id: string;
          object_key: string | null;
        }>(
          `SELECT rsr.source_reference_id, a.object_key
           FROM research_source_reference rsr
           LEFT JOIN artifact a ON a.artifact_id = rsr.artifact_id
           WHERE rsr.project_id = $1
             AND rsr.source_reference_id = ANY($2::uuid[])
             AND rsr.status = 'accepted'`,
          [input.context.projectId, referenceIds],
        );
  const objectKeyByReference = new Map(
    materialRows.rows.map((row) => [row.source_reference_id, row.object_key]),
  );
  const sourceReferences = (input.plan.snapshot.sourceReferences ?? []).map(
    (reference) => ({
      ...reference,
      objectKey: objectKeyByReference.get(reference.referenceId) ?? null,
    }),
  );
  if (
    sourceReferences.some(
      (reference) =>
        reference.ingestionMethod === "user_upload" && !reference.objectKey,
    )
  ) {
    throw new ApiError(
      409,
      "SOURCE_ARTIFACT_UNAVAILABLE",
      "등록한 자료 파일을 찾을 수 없습니다. 자료를 다시 올려주세요.",
    );
  }
  const payload = workflowPayload({
    context: input.context,
    plan: input.plan,
    jobId,
    runId,
    attempt: 1,
    sourceReferences,
  });
  await client.query(
    `INSERT INTO workflow_job (
       job_id, project_id, job_type, temporal_workflow_id, operation_status,
       validity_status, current_phase, progress_percent, progress_mode,
       progress_sequence, attempt, input_fingerprint, requested_by_user_id
     ) VALUES (
       $1, $2, $3, $4, 'queued', 'current', 'preparing', 0,
       'determinate', 0, 1, $5, $6
     )`,
    [
      jobId,
      input.context.projectId,
      input.runKind === "initial"
        ? "research_collection"
        : "evidence_reinvestigation",
      `reflo:${jobId}`,
      contentHash(payload),
      input.userId,
    ],
  );
  await client.query(
    `INSERT INTO workflow_job_input (job_id, input_role, resource_version_id)
     VALUES
       ($1, 'approved_research_plan', $2),
       ($1, 'hypothesis_questions', $3),
       ($1, 'source_workbook', $4),
       ($1, 'mapping_set', $5),
       ($1, 'project_setup', $6)`,
    [
      jobId,
      input.plan.resourceVersionId,
      input.context.questionSetResourceVersionId,
      input.context.workbookResourceVersionId,
      input.context.mappingSetResourceVersionId,
      input.context.setupResourceVersionId,
    ],
  );
  await pinWorkflowJobSourceSnapshot(client, { jobId });
  await client.query(
    `INSERT INTO research_run (
       research_run_id, project_id, job_id,
       approved_plan_resource_version_id, run_kind, supersedes_run_id
     ) VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      runId,
      input.context.projectId,
      jobId,
      input.plan.resourceVersionId,
      input.runKind,
      input.supersedesRunId ?? null,
    ],
  );
  await client.query(
    `INSERT INTO outbox_event (
       outbox_event_id, job_id, command_type, command_id, payload_json
     ) VALUES ($1, $2, 'start_workflow', $3, $4::jsonb)`,
    [uuidv7(), jobId, uuidv7(), JSON.stringify(payload)],
  );
  return { jobId, runId };
}

export async function approveResearchPlanAndStart(input: {
  projectId: string;
  userId: string;
  idempotencyKey: string | null;
  planId: unknown;
  expectedVersion: unknown;
}): Promise<IdempotentResult> {
  const key = requireIdempotencyKey(input.idempotencyKey);
  const expectedVersion = requireVersion(input.expectedVersion, "조사 계획");
  const requestHash = contentHash({
    planId: input.planId,
    expectedVersion,
  });
  return withTransaction(async (client) => {
    const replay = await idempotentReplay(client, {
      userId: input.userId,
      operation: "research_plan.approve_start",
      projectId: input.projectId,
      key,
      requestHash,
    });
    if (replay) return replay;
    const context = await projectContext(
      client,
      input.projectId,
      input.userId,
      true,
    );
    const plan = await ensurePlan(client, context, input.userId);
    if (plan.planId !== input.planId || plan.version !== expectedVersion) {
      throw new ApiError(
        409,
        "PLAN_VERSION_CONFLICT",
        "최신 조사 계획을 다시 확인해주세요.",
      );
    }
    const active = await activeResearchJob(client, input.projectId);
    if (
      active &&
      ["queued", "running", "cancel_requested"].includes(active.operationStatus)
    ) {
      throw new ApiError(
        409,
        "RESEARCH_JOB_ALREADY_ACTIVE",
        "이미 자료 수집 작업이 진행 중입니다.",
        { meta: { jobId: active.jobId } },
      );
    }
    const issues = validateResearchPlan(plan.snapshot, context.cutoffAt);
    if (issues.length > 0) {
      throw new ApiError(
        422,
        "PLAN_VALIDATION_FAILED",
        "조사 계획의 차단 항목을 확인해주세요.",
        {
          details: issues.map((issue) => ({
            path: issue.targetId ?? issue.category,
            code: issue.code,
            message: issue.message,
          })),
        },
      );
    }
    await client.query(
      `UPDATE research_plan_version
       SET plan_snapshot_json = $2::jsonb,
           validation_summary_json = $3::jsonb
       WHERE resource_version_id = $1`,
      [
        plan.resourceVersionId,
        JSON.stringify(plan.snapshot),
        JSON.stringify({ valid: true, issues: [] }),
      ],
    );
    await client.query(
      `UPDATE resource_version
       SET lifecycle_status = 'approved', content_hash = $2
       WHERE resource_version_id = $1`,
      [plan.resourceVersionId, contentHash(plan.snapshot)],
    );
    await client.query(
      `UPDATE research_plan_version
       SET status = 'approved', approved_by_user_id = $2, approved_at = now()
       WHERE resource_version_id = $1`,
      [plan.resourceVersionId, input.userId],
    );
    await client.query(
      `UPDATE research_plan SET status = 'approved' WHERE plan_id = $1`,
      [plan.planId],
    );
    const job = await createResearchJob(client, {
      context,
      plan: { ...plan, status: "approved" },
      userId: input.userId,
      runKind: "initial",
    });
    await client.query(
      `UPDATE project_stage_state
       SET stage_status = 'in_progress', blocker_codes = '{}', updated_at = now()
       WHERE project_id = $1 AND stage_key = 'research_plan'`,
      [input.projectId],
    );
    await client.query(
      `UPDATE project_stage_state
       SET stage_status = 'in_progress',
           blocker_codes = ARRAY['RESEARCH_IN_PROGRESS'], updated_at = now()
       WHERE project_id = $1 AND stage_key = 'validation'`,
      [input.projectId],
    );
    await client.query(
      `UPDATE project
       SET current_stage = 'validation', row_version = row_version + 1,
           updated_at = now(), last_saved_at = now()
       WHERE project_id = $1`,
      [input.projectId],
    );
    const body = {
      approvedPlanVersionId: plan.resourceVersionId,
      job: {
        jobId: job.jobId,
        researchRunId: job.runId,
        operationStatus: "queued",
        phase: "preparing",
        progressPercent: 0,
        retryable: false,
        validationRoute: processRoute(input.projectId, "validation"),
      },
    };
    await storeIdempotency(client, {
      userId: input.userId,
      operation: "research_plan.approve_start",
      projectId: input.projectId,
      key,
      requestHash,
      status: 202,
      body,
    });
    return { status: 202, body };
  });
}

export async function getResearchJob(input: {
  projectId: string;
  userId: string;
  jobId: string;
}): Promise<unknown> {
  return withTransaction(async (client) => {
    await projectContext(client, input.projectId, input.userId);
    const result = await client.query<{
      job_id: string;
    }>(
      `SELECT wj.job_id
       FROM workflow_job wj
       JOIN research_run rr ON rr.job_id = wj.job_id
       WHERE wj.job_id = $1 AND rr.project_id = $2`,
      [input.jobId, input.projectId],
    );
    if (!result.rows[0]) {
      throw new ApiError(404, "JOB_NOT_FOUND", "자료 수집 작업을 찾을 수 없습니다.");
    }
    const projection = await activeResearchJob(client, input.projectId);
    if (!projection || projection.jobId !== input.jobId) {
      const exact = await client.query<{
        research_run_id: string;
        operation_status: JobProjection["operationStatus"];
        current_phase: string | null;
        progress_percent: number;
        retryable: boolean;
        error_code: string | null;
        error_summary: string | null;
        requested_at: Date;
        heartbeat_at: Date | null;
        finished_at: Date | null;
      }>(
        `SELECT rr.research_run_id, wj.operation_status, wj.current_phase,
           wj.progress_percent, wj.retryable, wj.error_code, wj.error_summary,
           wj.requested_at, wj.heartbeat_at, wj.finished_at
         FROM workflow_job wj
         JOIN research_run rr ON rr.job_id = wj.job_id
         WHERE wj.job_id = $1`,
        [input.jobId],
      );
      const row = exact.rows[0];
      return {
        jobId: input.jobId,
        researchRunId: row.research_run_id,
        operationStatus: row.operation_status,
        phase: row.current_phase,
        progressPercent: row.progress_percent,
        retryable: row.retryable,
        error:
          row.error_code && row.error_summary
            ? { code: row.error_code, message: row.error_summary }
            : null,
        requestedAt: row.requested_at.toISOString(),
        updatedAt: (
          row.heartbeat_at ??
          row.finished_at ??
          row.requested_at
        ).toISOString(),
        validationRoute: processRoute(input.projectId, "validation"),
      };
    }
    return projection;
  });
}

export async function cancelResearchJob(input: {
  projectId: string;
  userId: string;
  jobId: string;
  idempotencyKey: string | null;
}): Promise<IdempotentResult> {
  const key = requireIdempotencyKey(input.idempotencyKey);
  const requestHash = contentHash({ jobId: input.jobId });
  return withTransaction(async (client) => {
    const replay = await idempotentReplay(client, {
      userId: input.userId,
      operation: "research_job.cancel",
      projectId: input.projectId,
      key,
      requestHash,
    });
    if (replay) return replay;
    await projectContext(client, input.projectId, input.userId, true);
    const updated = await client.query(
      `UPDATE workflow_job wj
       SET operation_status = 'cancel_requested', heartbeat_at = now()
       FROM research_run rr
       WHERE rr.job_id = wj.job_id AND rr.project_id = $1
         AND wj.job_id = $2 AND wj.operation_status IN ('queued', 'running')
       RETURNING wj.temporal_workflow_id`,
      [input.projectId, input.jobId],
    );
    if (!updated.rows[0]) {
      throw new ApiError(
        409,
        "JOB_NOT_CANCELLABLE",
        "현재 상태에서는 자료 수집을 취소할 수 없습니다.",
      );
    }
    await client.query(
      `INSERT INTO outbox_event (
         outbox_event_id, job_id, command_type, command_id, payload_json
       ) VALUES ($1, $2, 'cancel_workflow', $3, $4::jsonb)`,
      [
        uuidv7(),
        input.jobId,
        uuidv7(),
        JSON.stringify({ workflowId: updated.rows[0].temporal_workflow_id }),
      ],
    );
    const body = { jobId: input.jobId, operationStatus: "cancel_requested" };
    await storeIdempotency(client, {
      userId: input.userId,
      operation: "research_job.cancel",
      projectId: input.projectId,
      key,
      requestHash,
      status: 202,
      body,
    });
    return { status: 202, body };
  });
}

export async function retryResearchJob(input: {
  projectId: string;
  userId: string;
  jobId: string;
  idempotencyKey: string | null;
}): Promise<IdempotentResult> {
  const key = requireIdempotencyKey(input.idempotencyKey);
  const requestHash = contentHash({ jobId: input.jobId });
  return withTransaction(async (client) => {
    const replay = await idempotentReplay(client, {
      userId: input.userId,
      operation: "research_job.retry",
      projectId: input.projectId,
      key,
      requestHash,
    });
    if (replay) return replay;
    const context = await projectContext(
      client,
      input.projectId,
      input.userId,
      true,
    );
    const previous = await client.query<{
      research_run_id: string;
      retryable: boolean;
      operation_status: string;
      approved_plan_resource_version_id: string;
    }>(
      `SELECT rr.research_run_id, wj.retryable, wj.operation_status,
         rr.approved_plan_resource_version_id
       FROM research_run rr
       JOIN workflow_job wj ON wj.job_id = rr.job_id
       WHERE rr.project_id = $1 AND rr.job_id = $2`,
      [input.projectId, input.jobId],
    );
    const row = previous.rows[0];
    if (!row || row.operation_status !== "failed" || !row.retryable) {
      throw new ApiError(
        409,
        "JOB_NOT_RETRYABLE",
        "현재 작업은 같은 입력으로 재시도할 수 없습니다.",
      );
    }
    const plan = await loadPlan(client, context);
    if (!plan || plan.resourceVersionId !== row.approved_plan_resource_version_id) {
      throw new ApiError(
        409,
        "PLAN_REVALIDATION_REQUIRED",
        "최신 조사 계획을 다시 승인해주세요.",
      );
    }
    await client.query(
      `UPDATE workflow_job SET validity_status = 'obsolete' WHERE job_id = $1`,
      [input.jobId],
    );
    const created = await createResearchJob(client, {
      context,
      plan,
      userId: input.userId,
      runKind: "initial",
      supersedesRunId: row.research_run_id,
    });
    const body = {
      jobId: created.jobId,
      researchRunId: created.runId,
      operationStatus: "queued",
    };
    await storeIdempotency(client, {
      userId: input.userId,
      operation: "research_job.retry",
      projectId: input.projectId,
      key,
      requestHash,
      status: 202,
      body,
    });
    return { status: 202, body };
  });
}

function quoteNormalized(value: string): string {
  return value.normalize("NFC").replace(/\s+/g, " ").trim();
}

async function insertSourceVersion(
  client: TransactionClient,
  input: {
    projectId: string;
    runId: string;
    source: ResearchSourceSnapshot;
    obsolete: boolean;
  },
): Promise<{ resourceVersionId: string; created: boolean }> {
  const existing = await client.query<{ source_id: string }>(
    `SELECT source_id FROM research_source
     WHERE project_id = $1 AND source_type = $2 AND source_key = $3`,
    [input.projectId, input.source.sourceType, input.source.sourceKey],
  );
  const sourceId = existing.rows[0]?.source_id ?? uuidv7();
  if (!existing.rows[0]) {
    await client.query(
      `INSERT INTO research_source (
         source_id, project_id, source_type, source_key
       ) VALUES ($1, $2, $3, $4)`,
      [sourceId, input.projectId, input.source.sourceType, input.source.sourceKey],
    );
  }
  const duplicate = await client.query<{ resource_version_id: string }>(
    `SELECT resource_version_id FROM research_source_version
     WHERE source_id = $1 AND response_hash = $2`,
    [sourceId, input.source.responseHash],
  );
  if (duplicate.rows[0]) {
    return {
      resourceVersionId: duplicate.rows[0].resource_version_id,
      created: false,
    };
  }
  const resource = await client.query<{
    resource_id: string;
    version_no: string;
    resource_version_id: string;
  }>(
    `SELECT vr.resource_id, rv.version_no, rv.resource_version_id
     FROM versioned_resource vr
     LEFT JOIN LATERAL (
       SELECT version_no, resource_version_id
       FROM resource_version
       WHERE resource_id = vr.resource_id
       ORDER BY version_no DESC LIMIT 1
     ) rv ON true
     WHERE vr.project_id = $1 AND vr.resource_kind = 'research_source'
       AND vr.resource_key = $2`,
    [input.projectId, input.source.sourceKey],
  );
  const resourceId = resource.rows[0]?.resource_id ?? uuidv7();
  if (!resource.rows[0]) {
    await client.query(
      `INSERT INTO versioned_resource (
         resource_id, project_id, resource_kind, resource_key
       ) VALUES ($1, $2, 'research_source', $3)`,
      [resourceId, input.projectId, input.source.sourceKey],
    );
  }
  const resourceVersionId = uuidv7();
  const version = Number(resource.rows[0]?.version_no ?? 0) + 1;
  await client.query(
    `INSERT INTO resource_version (
       resource_version_id, resource_id, version_no, lifecycle_status,
       validity_status, supersedes_version_id, input_fingerprint, content_hash
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      resourceVersionId,
      resourceId,
      version,
      input.obsolete ? "archived" : "approved",
      input.obsolete ? "obsolete" : "current",
      resource.rows[0]?.resource_version_id ?? null,
      contentHash({
        runId: input.runId,
        sourceKey: input.source.sourceKey,
      }),
      input.source.responseHash,
    ],
  );
  await client.query(
    `INSERT INTO research_source_version (
       resource_version_id, source_id, research_run_id, source_type, title,
       publisher, canonical_url, published_at, collected_at, response_hash,
       locator_json, snapshot_json, collector_version, modified_at,
       available_at, date_precision, artifact_object_key, parser_version,
       eligibility_policy_version
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
       $11::jsonb, $12::jsonb, $13, $14, $15, $16, $17, $18, $19
     )`,
    [
      resourceVersionId,
      sourceId,
      input.runId,
      input.source.sourceType,
      input.source.title,
      input.source.publisher,
      input.source.canonicalUrl,
      input.source.publishedAt,
      input.source.collectedAt,
      input.source.responseHash,
      JSON.stringify(input.source.locator),
      JSON.stringify(input.source.content),
      input.source.collectorVersion,
      input.source.modifiedAt ?? null,
      input.source.availableAt ?? null,
      input.source.datePrecision ?? null,
      input.source.artifactObjectKey ?? null,
      input.source.parserVersion ?? null,
      input.source.eligibilityPolicyVersion ?? null,
    ],
  );
  return { resourceVersionId, created: true };
}

function validateWorkerPayload(payload: PhaseFourWorkerPayload): void {
  if (
    !payload ||
    !Array.isArray(payload.sources) ||
    !Array.isArray(payload.candidates) ||
    !Array.isArray(payload.evidence) ||
    (payload.newsDiscovery !== undefined &&
      !Array.isArray(payload.newsDiscovery)) ||
    payload.metadata?.validationRuleVersion !== VALIDATION_RULE_VERSION
  ) {
    throw new ApiError(
      422,
      "RESEARCH_RESULT_INVALID",
      "자료 수집 결과 형식이 올바르지 않습니다.",
    );
  }
  if (payload.sources.length === 0) {
    throw new ApiError(
      422,
      "RESEARCH_NO_SOURCES",
      "수집된 원문이 없어 작업을 완료할 수 없습니다.",
    );
  }
  if (payload.candidates.length === 0 || payload.evidence.length === 0) {
    throw new ApiError(
      422,
      "RESEARCH_EVIDENCE_EMPTY",
      "검증 가능한 Evidence가 없어 작업을 완료할 수 없습니다.",
    );
  }
  const sourceKeys = new Set(payload.sources.map((source) => source.sourceKey));
  const candidateKeys = new Set(
    payload.candidates.map((candidate) => candidate.candidateKey),
  );
  if (
    payload.evidence.some(
      (item) =>
        !sourceKeys.has(item.sourceKey) ||
        !candidateKeys.has(item.candidateKey) ||
        !["passed", "failed", "needs_review"].includes(item.machineStatus),
    )
  ) {
    throw new ApiError(
      422,
      "RESEARCH_RESULT_INVALID",
      "검증 결과와 원문 snapshot 연결을 확인해주세요.",
    );
  }
}

async function recomputeStageGate(
  client: TransactionClient,
  projectId: string,
  validationVersion: number,
): Promise<{
  canProceed: boolean;
  blockers: Array<{ code: string; targetId: string | null; message: string }>;
  questions: Array<{
    questionId: string;
    answer: string;
    sufficiency: string;
    supportingCount: number;
    contradictingCount: number;
    neutralCount: number;
    required: boolean;
    blockers: string[];
  }>;
}> {
  const planResult = await client.query<{
    plan_snapshot_json: ResearchPlanSnapshot;
  }>(
    `SELECT rpv.plan_snapshot_json
     FROM validation_workspace vw
     JOIN research_plan_version rpv
       ON rpv.resource_version_id = vw.approved_plan_resource_version_id
     WHERE vw.project_id = $1`,
    [projectId],
  );
  const snapshot = planResult.rows[0]?.plan_snapshot_json;
  if (!snapshot) {
    return {
      canProceed: false,
      blockers: [
        {
          code: "VALIDATION_NOT_READY",
          targetId: null,
          message: "검증 결과를 준비하고 있습니다.",
        },
      ],
      questions: [],
    };
  }
  const results = await client.query<{
    result_id: string;
    question_id: string | null;
    target_id: string | null;
    title: string;
    one_line_value: string;
    stance: "supporting" | "contradicting" | "neutral";
    machine_status: string;
    exception_status: string;
    evidence_ids: string[];
    required: boolean;
    critical_numeric: boolean;
    source_version_ids: string[];
  }>(
    `SELECT result_id, question_id, target_id, title, one_line_value, stance,
       machine_status, exception_status, evidence_ids, required, critical_numeric,
       COALESCE(ARRAY(
         SELECT DISTINCT e.source_version_id::text
         FROM evidence e
         WHERE e.evidence_id = ANY(validation_result.evidence_ids)
       ), '{}'::text[]) AS source_version_ids
     FROM validation_result
     WHERE project_id = $1
       AND exception_status <> 'SUPERSEDED'`,
    [projectId],
  );
  const conflictRows = await client.query<{
    conflict_id: string;
    result_id: string;
  }>(
    `SELECT conflict_id, result_id
     FROM validation_conflict
     WHERE project_id = $1 AND status = 'unresolved'`,
    [projectId],
  );
  const unresolvedByResult = new Map(
    conflictRows.rows.map((row) => [row.result_id, row.conflict_id]),
  );
  const questions = snapshot.questions
    .filter((question) => question.included)
    .map((question) => {
      const questionResults = results.rows.filter(
        (result) => result.question_id === question.questionId,
      );
      const usable = questionResults.filter(
        (result) =>
          result.machine_status === "passed" &&
          !["REJECTED", "REINVESTIGATING"].includes(result.exception_status),
      );
      const sufficiency = calculateQuestionSufficiency({
        requiredMetrics: question.metrics,
        coveredMetrics: usable.map((result) => result.title),
        evidenceCount: usable.reduce(
          (count, result) => count + result.evidence_ids.length,
          0,
        ),
        sourceCount: new Set(
          usable.flatMap((result) => result.source_version_ids),
        ).size,
        criticalNumericFailed: questionResults.some(
          (result) =>
            result.critical_numeric && result.machine_status !== "passed",
        ),
        unresolvedConflict: questionResults.some((result) =>
          unresolvedByResult.has(result.result_id),
        ),
        stale: questionResults.some(
          (result) => result.machine_status === "stale",
        ),
        rejectedRequired: questionResults.some(
          (result) => result.required && result.exception_status === "REJECTED",
        ),
        reinvestigating: questionResults.some(
          (result) => result.exception_status === "REINVESTIGATING",
        ),
      });
      const blockers: string[] = [];
      if (sufficiency === "insufficient") blockers.push("QUESTION_EVIDENCE_INSUFFICIENT");
      if (sufficiency === "reinvestigating") blockers.push("REINVESTIGATION_ACTIVE");
      return {
        questionId: question.questionId,
        answer:
          usable[0]?.one_line_value ?? "검증된 근거가 부족합니다.",
        sufficiency,
        supportingCount: usable.filter(
          (result) => result.stance === "supporting",
        ).length,
        contradictingCount: usable.filter(
          (result) => result.stance === "contradicting",
        ).length,
        neutralCount: usable.filter((result) => result.stance === "neutral")
          .length,
        qualifiedAccepted: false,
        required: true,
        blockers,
      };
    });
  const blockers: Array<{
    code: string;
    targetId: string | null;
    message: string;
  }> = [];
  for (const question of questions) {
    if (question.sufficiency === "insufficient") {
      blockers.push({
        code: "QUESTION_EVIDENCE_INSUFFICIENT",
        targetId: question.questionId,
        message: "필수 질문의 검증 근거가 부족합니다.",
      });
    } else if (question.sufficiency === "reinvestigating") {
      blockers.push({
        code: "REINVESTIGATION_ACTIVE",
        targetId: question.questionId,
        message: "재조사 작업이 진행 중입니다.",
      });
    } else if (question.sufficiency === "qualified") {
      const accepted = await client.query(
        `SELECT 1 FROM validation_decision
         WHERE project_id = $1 AND target_type = 'question'
           AND target_id = $2 AND action = 'ACCEPT_QUALIFIED'
           AND validation_version_after <= $3
         ORDER BY created_at DESC LIMIT 1`,
        [projectId, question.questionId, validationVersion],
      );
      question.qualifiedAccepted = accepted.rows.length > 0;
      if (!question.qualifiedAccepted) {
        blockers.push({
          code: "QUALIFIED_CONFIRMATION_REQUIRED",
          targetId: question.questionId,
          message: "조건부 근거의 한계를 확인해주세요.",
        });
      }
    }
  }
  for (const row of conflictRows.rows) {
    blockers.push({
      code: "UNRESOLVED_SOURCE_CONFLICT",
      targetId: row.conflict_id,
      message: "출처 충돌의 권위 원문을 선택해주세요.",
    });
  }
  const missingExcel = snapshot.excelTargets
    .filter((target) => target.required && target.included)
    .filter(
      (target) =>
        !results.rows.some(
          (result) =>
            result.target_id === target.targetId &&
            result.machine_status === "passed" &&
            result.exception_status !== "REJECTED",
        ),
    );
  blockers.push(
    ...missingExcel.map((target) => ({
      code: "EXCEL_EVIDENCE_MISSING",
      targetId: target.targetId,
      message: `${target.sheetName}!${target.address}의 검증 원문이 필요합니다.`,
    })),
  );
  return { canProceed: blockers.length === 0, blockers, questions };
}

export async function commitResearchValidationResult(
  jobId: string,
  payload: PhaseFourWorkerPayload,
  metadata: WorkerResultCommitMetadata,
): Promise<WorkerResultCommitOutcome> {
  validateWorkerPayload(payload);
  return withTransaction(async (client) => {
    await lockWorkflowJobLineage(client, { jobId });
    const runResult = await client.query<{
      research_run_id: string;
      project_id: string;
      approved_plan_resource_version_id: string;
      operation_status: string;
      requested_by_user_id: string;
    }>(
      `SELECT rr.research_run_id, rr.project_id,
         rr.approved_plan_resource_version_id, wj.operation_status,
         wj.requested_by_user_id
       FROM research_run rr
       JOIN workflow_job wj ON wj.job_id = rr.job_id
       WHERE rr.job_id = $1
       FOR UPDATE OF wj`,
      [jobId],
    );
    const run = runResult.rows[0];
    if (!run) {
      throw new ApiError(404, "JOB_NOT_FOUND", "자료 수집 작업을 찾을 수 없습니다.");
    }
    const snapshotDecision = await decidePinnedWorkflowJobCommit(client, {
      jobId,
      attempt: metadata.attempt,
      sequence: metadata.sequence,
      resultInputVersionIds: metadata.inputVersionIds,
      resultHash: metadata.resultHash,
    });
    if (snapshotDecision.decision === "duplicate") {
      return { applied: false, disposition: "duplicate" };
    }
    if (lateResultRequiresAuditOnly(snapshotDecision)) {
      await recordLateWorkflowJobResult(client, {
        jobId,
        metadata,
        reason: snapshotDecision.attemptMatches
          ? `WORKFLOW_JOB_${snapshotDecision.operationStatus.toUpperCase()}`
          : "WORKFLOW_JOB_ATTEMPT_MISMATCH",
      });
      return { applied: false, disposition: "obsolete" };
    }
    const obsolete = snapshotDecision.decision === "obsolete";
    const sourceVersionByKey = new Map<string, string>();
    const createdSourceVersionIds: string[] = [];
    for (const source of payload.sources) {
      const inserted = await insertSourceVersion(client, {
        projectId: run.project_id,
        runId: run.research_run_id,
        source,
        obsolete,
      });
      sourceVersionByKey.set(source.sourceKey, inserted.resourceVersionId);
      if (inserted.created) {
        createdSourceVersionIds.push(inserted.resourceVersionId);
      }
    }
    const sourceVersionByProviderResultId = new Map<string, string>();
    const sourceVersionByCanonicalUrl = new Map<string, string>();
    for (const source of payload.sources) {
      const sourceVersionId = sourceVersionByKey.get(source.sourceKey);
      const providerResultId =
        typeof source.locator.providerResultId === "string"
          ? source.locator.providerResultId
          : null;
      if (sourceVersionId && providerResultId) {
        sourceVersionByProviderResultId.set(providerResultId, sourceVersionId);
      }
      if (sourceVersionId && source.canonicalUrl) {
        sourceVersionByCanonicalUrl.set(source.canonicalUrl, sourceVersionId);
      }
    }
    const searchIdByKey = new Map<string, string>();
    for (const discovery of payload.newsDiscovery ?? []) {
      const searchKey = `${discovery.questionId}:${discovery.queryId}`;
      let searchId = searchIdByKey.get(searchKey);
      if (!searchId) {
        searchId = uuidv7();
        searchIdByKey.set(searchKey, searchId);
        await client.query(
          `INSERT INTO research_news_search (
             search_id, research_run_id, question_id, query_id, query_text,
             publication_window_json, provider_code, provider_policy_version,
             status
           ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, 'completed')`,
          [
            searchId,
            run.research_run_id,
            discovery.questionId,
            discovery.queryId,
            discovery.queryText,
            JSON.stringify(discovery.publicationWindow),
            discovery.providerCode,
            discovery.policyVersion,
          ],
        );
      }
      const sourceVersionId =
        (discovery.providerResultId
          ? sourceVersionByProviderResultId.get(discovery.providerResultId)
          : undefined) ??
        sourceVersionByCanonicalUrl.get(discovery.url) ??
        null;
      await client.query(
        `INSERT INTO research_news_search_result (
           search_result_id, search_id, provider_result_id, result_rank,
           discovered_url, title_hint, publisher_hint, published_at_hint,
           selection_status, source_version_id
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          uuidv7(),
          searchId,
          discovery.providerResultId,
          discovery.resultRank,
          discovery.url,
          discovery.titleHint,
          discovery.publisherHint,
          discovery.publishedAtHint &&
          Number.isFinite(Date.parse(discovery.publishedAtHint))
            ? discovery.publishedAtHint
            : null,
          sourceVersionId ? "captured" : "discovered",
          sourceVersionId,
        ],
      );
    }
    const validationRunId = uuidv7();
    await client.query(
      `INSERT INTO validation_run (
         validation_run_id, project_id, research_run_id, rule_version,
         agent_profile_version, status, started_at, finished_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        validationRunId,
        run.project_id,
        run.research_run_id,
        payload.metadata.validationRuleVersion,
        payload.metadata.validationAgentProfile,
        obsolete ? "obsolete" : "succeeded",
        payload.metadata.startedAt,
        payload.metadata.finishedAt,
      ],
    );
    const evidenceIdByCandidate = new Map<string, string>();
    for (const item of payload.evidence) {
      const sourceVersionId = sourceVersionByKey.get(item.sourceKey);
      if (!sourceVersionId) continue;
      const normalized = quoteNormalized(item.quoteExact);
      const evidenceId = uuidv7();
      await client.query(
        `INSERT INTO evidence (
           evidence_id, project_id, validation_run_id, source_version_id,
           quote_exact, quote_normalized, quote_hash, locator_json,
           value_original, value_normalized, unit, currency, period, scope,
           value_kind, stance, machine_status, checks_json, provenance_json,
           validated_at
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8::jsonb,
           $9, $10, $11, $12, $13, $14, $15, $16, $17,
           $18::jsonb, $19::jsonb, now()
         )`,
        [
          evidenceId,
          run.project_id,
          validationRunId,
          sourceVersionId,
          item.quoteExact,
          normalized,
          contentHash(normalized),
          JSON.stringify(item.locator),
          item.valueOriginal,
          item.valueNormalized,
          item.unit,
          item.currency,
          item.period,
          item.scope,
          item.valueKind,
          item.stance,
          item.machineStatus,
          JSON.stringify(item.checks),
          JSON.stringify({
            candidateKey: item.candidateKey,
            sourceKey: item.sourceKey,
            relations: ["normalized_from", "validated_from"],
          }),
        ],
      );
      evidenceIdByCandidate.set(item.candidateKey, evidenceId);
      const resultId = uuidv7();
      await client.query(
        `INSERT INTO validation_result (
           result_id, project_id, validation_run_id, category, question_id,
           target_id, title, one_line_value, stance, machine_status,
           exception_status, value_original, value_normalized, unit, currency,
           period, scope, value_kind, evidence_ids, required, critical_numeric,
           validated_at
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
           'AVAILABLE', $11, $12, $13, $14, $15, $16, $17,
           $18::uuid[], $19, $20, now()
         )`,
        [
          resultId,
          run.project_id,
          validationRunId,
          item.category,
          item.questionId,
          item.targetId,
          item.title,
          item.machineStatus === "passed"
            ? item.oneLineValue
            : "검증 실패",
          item.stance,
          item.machineStatus,
          item.valueOriginal,
          item.valueNormalized,
          item.unit,
          item.currency,
          item.period,
          item.scope,
          item.valueKind,
          [evidenceId],
          item.required,
          item.criticalNumeric,
        ],
      );
    }
    for (const sourceVersionId of createdSourceVersionIds) {
      await recordResourceDependencies(client, {
        projectId: run.project_id,
        dependencies: metadata.inputVersionIds.map((inputVersionId) => ({
          upstreamResourceVersionId: inputVersionId,
          downstreamResourceVersionId: sourceVersionId,
          dependencyKind: "research_validation_input",
        })),
      });
    }
    if (obsolete) {
      await client.query(
        `UPDATE workflow_job
         SET operation_status = 'succeeded', validity_status = 'obsolete',
             current_phase = 'stored_obsolete', progress_percent = 100,
             progress_sequence = GREATEST(progress_sequence, $2),
             heartbeat_at = now(), finished_at = now(), retryable = false,
             result_summary_json = $3::jsonb
         WHERE job_id = $1`,
        [
          jobId,
          metadata.sequence,
          JSON.stringify({
            sourceCount: payload.sources.length,
            evidenceCount: payload.evidence.filter(
              (item) => item.machineStatus === "passed",
            ).length,
            warningCount: payload.warnings.length,
            validationRunId,
            workerResult: {
              attempt: metadata.attempt,
              sequence: metadata.sequence,
              inputVersionIds: metadata.inputVersionIds,
              hash: metadata.resultHash,
            },
          }),
        ],
      );
      return { applied: true, disposition: "obsolete" };
    }
    const current = await client.query<{ validation_version: string }>(
      `SELECT validation_version FROM validation_workspace
       WHERE project_id = $1 FOR UPDATE`,
      [run.project_id],
    );
    const validationVersion = Number(current.rows[0]?.validation_version ?? 0) + 1;
    if (current.rows[0]) {
      await client.query(
        `UPDATE validation_result
         SET exception_status = 'SUPERSEDED'
         WHERE project_id = $1 AND validation_run_id <> $2
           AND exception_status <> 'SUPERSEDED'`,
        [run.project_id, validationRunId],
      );
      await client.query(
        `UPDATE validation_workspace
         SET research_run_id = $2, validation_run_id = $3,
             validation_version = $4, workspace_status = 'VALIDATING',
             approved_plan_resource_version_id = $5,
             cutoff_at = (
               SELECT cutoff_at FROM research_plan_version
               WHERE resource_version_id = $5
             ),
             stage_gate_json = '{"canProceed":false,"blockers":[]}'::jsonb,
             updated_at = now()
         WHERE project_id = $1`,
        [
          run.project_id,
          run.research_run_id,
          validationRunId,
          validationVersion,
          run.approved_plan_resource_version_id,
        ],
      );
    } else {
      await client.query(
        `INSERT INTO validation_workspace (
           project_id, research_run_id, validation_run_id, validation_version,
           workspace_status, approved_plan_resource_version_id, cutoff_at,
           stage_gate_json
         ) SELECT $1, $2, $3, 1, 'VALIDATING', $4, cutoff_at,
           '{"canProceed":false,"blockers":[]}'::jsonb
         FROM research_plan_version WHERE resource_version_id = $4`,
        [
          run.project_id,
          run.research_run_id,
          validationRunId,
          run.approved_plan_resource_version_id,
        ],
      );
    }
    const gate = await recomputeStageGate(
      client,
      run.project_id,
      validationVersion,
    );
    await client.query(
      `UPDATE validation_workspace
       SET workspace_status = $2, stage_gate_json = $3::jsonb, updated_at = now()
       WHERE project_id = $1`,
      [
        run.project_id,
        gate.canProceed ? "REVIEW_READY" : "REVIEW_BLOCKED",
        JSON.stringify(gate),
      ],
    );
    await client.query(
      `UPDATE workflow_job
       SET operation_status = 'succeeded', current_phase = 'publishing_projection',
           progress_percent = 100,
           progress_sequence = GREATEST(progress_sequence, $3),
           heartbeat_at = now(), finished_at = now(), retryable = false,
           result_summary_json = $2::jsonb
       WHERE job_id = $1`,
      [
        jobId,
        JSON.stringify({
          sourceCount: payload.sources.length,
          evidenceCount: payload.evidence.filter(
            (item) => item.machineStatus === "passed",
          ).length,
          warningCount: payload.warnings.length,
          validationRunId,
          workerResult: {
            attempt: metadata.attempt,
            sequence: metadata.sequence,
            inputVersionIds: metadata.inputVersionIds,
            hash: metadata.resultHash,
          },
        }),
        metadata.sequence,
      ],
    );
    const previous = await client.query<{
      stage_completion_id: string;
      completion_no: string;
    }>(
      `SELECT stage_completion_id, completion_no
       FROM stage_completion
       WHERE project_id = $1 AND stage_key = 'research_plan'
       ORDER BY completion_no DESC LIMIT 1`,
      [run.project_id],
    );
    const completionId = uuidv7();
    await client.query(
      `INSERT INTO stage_completion (
         stage_completion_id, project_id, stage_key, completion_no,
         primary_version_id, supersedes_completion_id, completed_by_user_id
       ) VALUES ($1, $2, 'research_plan', $3, $4, $5, $6)`,
      [
        completionId,
        run.project_id,
        Number(previous.rows[0]?.completion_no ?? 0) + 1,
        run.approved_plan_resource_version_id,
        previous.rows[0]?.stage_completion_id ?? null,
        run.requested_by_user_id,
      ],
    );
    await client.query(
      `UPDATE project_stage_state
       SET stage_status = 'completed', current_completion_id = $2,
           blocker_codes = '{}', completed_at = now(), updated_at = now()
       WHERE project_id = $1 AND stage_key = 'research_plan'`,
      [run.project_id, completionId],
    );
    await client.query(
      `UPDATE project_stage_state
       SET stage_status = 'in_progress', blocker_codes = $2::text[],
           updated_at = now()
       WHERE project_id = $1 AND stage_key = 'validation'`,
      [
        run.project_id,
        gate.blockers.map((blocker) => blocker.code),
      ],
    );
    return { applied: true, disposition: "current" };
  });
}

async function ownedValidationWorkspace(
  client: TransactionClient,
  projectId: string,
  userId: string,
  lock = false,
) {
  const owned = await client.query(
    `SELECT 1 FROM project
     WHERE project_id = $1 AND owner_user_id = $2 AND deleted_at IS NULL`,
    [projectId, userId],
  );
  if (owned.rows.length === 0) {
    throw new ApiError(404, "PROJECT_NOT_FOUND", "프로젝트를 찾을 수 없습니다.");
  }
  const result = await client.query<{
    research_run_id: string;
    validation_run_id: string;
    validation_version: string;
    workspace_status: string;
    approved_plan_resource_version_id: string;
    cutoff_at: Date;
    stage_gate_json: {
      canProceed: boolean;
      blockers: Array<{
        code: string;
        targetId: string | null;
        message: string;
      }>;
      questions?: unknown[];
    };
    updated_at: Date;
  }>(
    `SELECT research_run_id, validation_run_id, validation_version,
       workspace_status, approved_plan_resource_version_id, cutoff_at,
       stage_gate_json, updated_at
     FROM validation_workspace WHERE project_id = $1
     ${lock ? "FOR UPDATE" : ""}`,
    [projectId],
  );
  return result.rows[0] ?? null;
}

export async function getValidationWorkspace(
  projectId: string,
  userId: string,
): Promise<unknown> {
  return withTransaction(async (client) => {
    const owned = await client.query<{
      name: string;
      row_version: string;
      company_name: string;
      ticker: string;
      target_year: number;
      target_quarter: number;
    }>(
      `SELECT p.name, p.row_version, cm.company_name, cm.ticker,
         psv.target_year, psv.target_quarter
       FROM project p
       JOIN project_stage_state setup_state
         ON setup_state.project_id = p.project_id AND setup_state.stage_key = 'setup'
       JOIN stage_completion setup_completion
         ON setup_completion.stage_completion_id = setup_state.current_completion_id
       JOIN project_setup_version psv
         ON psv.resource_version_id = setup_completion.primary_version_id
       JOIN company_master cm ON cm.company_master_id = psv.company_master_id
       WHERE p.project_id = $1 AND p.owner_user_id = $2
         AND p.deleted_at IS NULL`,
      [projectId, userId],
    );
    if (!owned.rows[0]) {
      throw new ApiError(404, "PROJECT_NOT_FOUND", "프로젝트를 찾을 수 없습니다.");
    }
    const workspace = await ownedValidationWorkspace(client, projectId, userId);
    const job = await activeResearchJob(client, projectId);
    const stages = await workflowState(client, projectId);
    if (!workspace) {
      if (!job) {
        throw new ApiError(
          409,
          "PREREQUISITE_INCOMPLETE",
          "조사 계획을 승인하고 자료 수집을 시작해주세요.",
          {
            meta: {
              resumeRoute: resumeRouteForBlocker({
                projectId,
                fallbackStage: "research_plan",
              }),
            },
          },
        );
      }
      return {
        project: {
          projectId,
          name: owned.rows[0].name,
          companyName: owned.rows[0].company_name,
          ticker: owned.rows[0].ticker,
          targetPeriod: {
            year: owned.rows[0].target_year,
            quarter: owned.rows[0].target_quarter,
          },
        },
        workspace: {
          projectId,
          projectVersion: Number(owned.rows[0].row_version),
          researchPlanVersion: null,
          collectionRunId: job.researchRunId,
          validationRunId: null,
          validationVersion: 0,
          status:
            job.operationStatus === "failed" ? "FAILED" : "COLLECTING",
          cutoffAt: null,
          jobs: [job],
          stageGate: {
            canProceed: false,
            blockers: [
              {
                code: "RESEARCH_IN_PROGRESS",
                targetId: null,
                message: "자료 수집과 독립 검증이 진행 중입니다.",
              },
            ],
          },
        },
        questions: [],
        results: [],
        conflicts: [],
        workflow: { stageStates: stages },
        navigation: {
          previousRoute: processRoute(projectId, "research_plan"),
          nextRoute: processRoute(projectId, "valuation"),
        },
      };
    }
    const plan = await client.query<{
      version_no: string;
      plan_snapshot_json: ResearchPlanSnapshot;
    }>(
      `SELECT version_no, plan_snapshot_json
       FROM research_plan_version WHERE resource_version_id = $1`,
      [workspace.approved_plan_resource_version_id],
    );
    const resultRows = await client.query<{
      result_id: string;
      result_version: string;
      category: "hypothesis" | "excel";
      question_id: string | null;
      target_id: string | null;
      title: string;
      one_line_value: string;
      stance: "supporting" | "contradicting" | "neutral";
      machine_status: string;
      exception_status: string;
      value_original: string | null;
      value_normalized: string | null;
      unit: string | null;
      currency: string | null;
      period: string | null;
      scope: string | null;
      value_kind: string | null;
      evidence_ids: string[];
      required: boolean;
      critical_numeric: boolean;
      validated_at: Date;
    }>(
      `SELECT result_id, result_version, category, question_id, target_id,
         title, one_line_value, stance, machine_status, exception_status,
         value_original, value_normalized, unit, currency, period, scope,
         value_kind, evidence_ids, required, critical_numeric, validated_at
       FROM validation_result
       WHERE project_id = $1 AND exception_status <> 'SUPERSEDED'
       ORDER BY category, question_id NULLS LAST, validated_at`,
      [projectId],
    );
    const conflicts = await client.query<{
      conflict_id: string;
      result_id: string;
      candidate_evidence_ids: string[];
      status: string;
      selected_evidence_id: string | null;
    }>(
      `SELECT conflict_id, result_id, candidate_evidence_ids, status,
         selected_evidence_id
       FROM validation_conflict
       WHERE project_id = $1 AND status <> 'superseded'`,
      [projectId],
    );
    const gate = await recomputeStageGate(
      client,
      projectId,
      Number(workspace.validation_version),
    );
    if (JSON.stringify(gate) !== JSON.stringify(workspace.stage_gate_json)) {
      await client.query(
        `UPDATE validation_workspace SET stage_gate_json = $2::jsonb
         WHERE project_id = $1`,
        [projectId, JSON.stringify(gate)],
      );
    }
    return {
      project: {
        projectId,
        name: owned.rows[0].name,
        companyName: owned.rows[0].company_name,
        ticker: owned.rows[0].ticker,
        targetPeriod: {
          year: owned.rows[0].target_year,
          quarter: owned.rows[0].target_quarter,
        },
      },
      workspace: {
        projectId,
        projectVersion: Number(owned.rows[0].row_version),
        researchPlanVersion: Number(plan.rows[0]?.version_no ?? 0),
        collectionRunId: workspace.research_run_id,
        validationRunId: workspace.validation_run_id,
        validationVersion: Number(workspace.validation_version),
        status:
          workspace.workspace_status === "APPROVED"
            ? "APPROVED"
            : gate.canProceed
              ? "REVIEW_READY"
              : "REVIEW_BLOCKED",
        cutoffAt: workspace.cutoff_at.toISOString(),
        jobs: job ? [job] : [],
        stageGate: gate,
        updatedAt: workspace.updated_at.toISOString(),
      },
      questions: (
        plan.rows[0]?.plan_snapshot_json.questions ?? []
      ).filter((question) => question.included),
      questionAnswers: gate.questions,
      results: resultRows.rows.map((row) => ({
        resultId: row.result_id,
        resultVersion: Number(row.result_version),
        category: row.category,
        questionId: row.question_id,
        targetId: row.target_id,
        title: row.title,
        oneLineValue: row.one_line_value,
        stance: row.stance,
        machineStatus: row.machine_status,
        exceptionStatus: row.exception_status,
        valueOriginal: row.value_original,
        valueNormalized: row.value_normalized,
        unit: row.unit,
        currency: row.currency,
        period: row.period,
        scope: row.scope,
        valueKind: row.value_kind,
        evidenceIds: row.evidence_ids,
        required: row.required,
        criticalNumeric: row.critical_numeric,
        validatedAt: row.validated_at.toISOString(),
      })),
      conflicts: conflicts.rows.map((row) => ({
        conflictId: row.conflict_id,
        resultId: row.result_id,
        candidateEvidenceIds: row.candidate_evidence_ids,
        status: row.status,
        selectedEvidenceId: row.selected_evidence_id,
      })),
      workflow: { stageStates: stages },
      navigation: {
        previousRoute: processRoute(projectId, "research_plan"),
        nextRoute: processRoute(projectId, "valuation"),
      },
    };
  });
}

export async function getValidationResult(input: {
  projectId: string;
  userId: string;
  resultId: string;
}): Promise<unknown> {
  return withTransaction(async (client) => {
    await ownedValidationWorkspace(client, input.projectId, input.userId);
    const result = await client.query<{
      result_id: string;
      title: string;
      one_line_value: string;
      machine_status: string;
      exception_status: string;
      evidence_ids: string[];
    }>(
      `SELECT result_id, title, one_line_value, machine_status,
         exception_status, evidence_ids
       FROM validation_result
       WHERE project_id = $1 AND result_id = $2`,
      [input.projectId, input.resultId],
    );
    if (!result.rows[0]) {
      throw new ApiError(404, "RESULT_NOT_FOUND", "검증 결과를 찾을 수 없습니다.");
    }
    const evidenceRows = await client.query<{
      evidence_id: string;
      evidence_version: string;
      source_version_id: string;
      quote_exact: string;
      quote_normalized: string;
      locator_json: Record<string, unknown>;
      value_original: string | null;
      value_normalized: string | null;
      unit: string | null;
      currency: string | null;
      period: string | null;
      scope: string | null;
      value_kind: string | null;
      stance: string;
      machine_status: string;
      checks_json: unknown[];
      provenance_json: Record<string, unknown>;
      title: string;
      publisher: string;
      canonical_url: string | null;
      published_at: Date | null;
      source_type: string;
    }>(
      `SELECT e.evidence_id, e.evidence_version, e.source_version_id,
         e.quote_exact, e.quote_normalized, e.locator_json, e.value_original,
         e.value_normalized, e.unit, e.currency, e.period, e.scope,
         e.value_kind, e.stance, e.machine_status, e.checks_json,
         e.provenance_json, rsv.title, rsv.publisher, rsv.canonical_url,
         rsv.published_at, rsv.source_type
       FROM evidence e
       JOIN research_source_version rsv
         ON rsv.resource_version_id = e.source_version_id
       WHERE e.evidence_id = ANY($1::uuid[])`,
      [result.rows[0].evidence_ids],
    );
    return {
      result: {
        resultId: result.rows[0].result_id,
        title: result.rows[0].title,
        oneLineValue: result.rows[0].one_line_value,
        machineStatus: result.rows[0].machine_status,
        exceptionStatus: result.rows[0].exception_status,
      },
      evidence: evidenceRows.rows.map((row) => ({
        evidenceId: row.evidence_id,
        evidenceVersion: Number(row.evidence_version),
        sourceVersionId: row.source_version_id,
        sourceType: row.source_type,
        title: row.title,
        publisher: row.publisher,
        canonicalUrl: row.canonical_url,
        publishedAt: row.published_at?.toISOString() ?? null,
        quoteExact: row.quote_exact,
        quoteNormalized: row.quote_normalized,
        locator: row.locator_json,
        valueOriginal: row.value_original,
        valueNormalized: row.value_normalized,
        unit: row.unit,
        currency: row.currency,
        period: row.period,
        scope: row.scope,
        valueKind: row.value_kind,
        stance: row.stance,
        machineStatus: row.machine_status,
        checks: row.checks_json,
        provenance: row.provenance_json,
      })),
    };
  });
}

export async function getEvidenceViewer(input: {
  projectId: string;
  userId: string;
  evidenceId: string;
}): Promise<unknown> {
  return withTransaction(async (client) => {
    await ownedValidationWorkspace(client, input.projectId, input.userId);
    const result = await client.query<{
      evidence_id: string;
      source_version_id: string;
      quote_exact: string;
      locator_json: Record<string, unknown>;
      source_type: string;
      title: string;
      publisher: string;
      canonical_url: string | null;
      published_at: Date | null;
      collected_at: Date;
      response_hash: string;
      collector_version: string;
    }>(
      `SELECT e.evidence_id, e.source_version_id, e.quote_exact,
         e.locator_json, rsv.source_type, rsv.title, rsv.publisher,
         rsv.canonical_url, rsv.published_at, rsv.collected_at,
         rsv.response_hash, rsv.collector_version
       FROM evidence e
       JOIN research_source_version rsv
         ON rsv.resource_version_id = e.source_version_id
       WHERE e.project_id = $1 AND e.evidence_id = $2`,
      [input.projectId, input.evidenceId],
    );
    const row = result.rows[0];
    if (!row) {
      throw new ApiError(404, "EVIDENCE_NOT_FOUND", "원문 근거를 찾을 수 없습니다.");
    }
    return {
      evidenceId: row.evidence_id,
      sourceVersionId: row.source_version_id,
      kind:
        row.source_type === "NEWS" || row.source_type === "USER_MATERIAL"
          ? "web"
          : "structured_api",
      title: row.title,
      publisher: row.publisher,
      canonicalUrl: row.canonical_url,
      publishedAt: row.published_at?.toISOString() ?? null,
      collectedAt: row.collected_at.toISOString(),
      quoteExact: row.quote_exact,
      locator: row.locator_json,
      audit: {
        responseHash: row.response_hash,
        collectorVersion: row.collector_version,
      },
    };
  });
}

export async function getValidationWorkbook(input: {
  projectId: string;
  userId: string;
}): Promise<unknown> {
  return withTransaction(async (client) => {
    const workspace = await ownedValidationWorkspace(
      client,
      input.projectId,
      input.userId,
    );
    if (!workspace) {
      throw new ApiError(
        409,
        "WORKBOOK_VERSION_MISMATCH",
        "검증용 workbook을 아직 준비하지 못했습니다.",
      );
    }
    const result = await client.query<{
      workbook_resource_version_id: string;
      structure_hash: string;
      original_sha256: string;
      analysis_json: {
        sheets?: Array<Record<string, unknown>>;
        candidateCells?: Array<Record<string, unknown>>;
      };
      plan_snapshot_json: ResearchPlanSnapshot;
    }>(
      `SELECT rpv.workbook_resource_version_id, wv.structure_hash,
         wv.original_sha256, wv.analysis_json, rpv.plan_snapshot_json
       FROM research_plan_version rpv
       JOIN workbook_version wv
         ON wv.resource_version_id = rpv.workbook_resource_version_id
       WHERE rpv.resource_version_id = $1`,
      [workspace.approved_plan_resource_version_id],
    );
    const row = result.rows[0];
    if (!row) {
      throw new ApiError(
        409,
        "WORKBOOK_VERSION_MISMATCH",
        "승인 계획의 workbook version을 찾지 못했습니다.",
      );
    }
    const evidenceBindings = await client.query<{
      target_id: string;
      evidence_ids: string[];
      value_normalized: string | null;
      one_line_value: string;
    }>(
      `SELECT target_id, evidence_ids, value_normalized, one_line_value
       FROM validation_result
       WHERE project_id = $1 AND validation_run_id = $2
         AND category = 'excel'
         AND exception_status <> 'SUPERSEDED'`,
      [input.projectId, workspace.validation_run_id],
    );
    const preparation =
      workspace.workspace_status === "REVIEW_READY" ||
      workspace.workspace_status === "APPROVED"
        ? await readPreparedValidatedWorkbook(client, {
            projectId: input.projectId,
            userId: input.userId,
          })
        : null;
    const latestApplication = await client.query<{
      workbook_application_id: string;
      application_status: string;
      output_artifact_id: string | null;
      application_plan_json: {
        commands?: Array<{
          targetId: string;
          beforeValue: string | null;
          afterValue: string | null;
          evidenceIds: string[];
        }>;
        blocked?: Array<{ targetId: string; reasonCode: string }>;
      };
    }>(
      `SELECT workbook_application_id, application_status,
         output_artifact_id, application_plan_json
       FROM workbook_application_run
       WHERE project_id = $1
         AND source_workbook_resource_version_id = $2
         AND source_fingerprint = $3
       ORDER BY requested_at DESC
       LIMIT 1`,
      [
        input.projectId,
        row.workbook_resource_version_id,
        preparation?.context.sourceFingerprint ?? "0".repeat(64),
      ],
    );
    const application = latestApplication.rows[0] ?? null;
    const activePlan =
      application?.application_plan_json ?? preparation?.plan ?? null;
    return {
      originalWorkbookHash: row.original_sha256,
      workbookVersion: 1,
      workbookResourceVersionId: row.workbook_resource_version_id,
      structureHash: row.structure_hash,
      readOnlyReason: "validation_workspace",
      visibleSheets: (row.analysis_json.sheets ?? []).filter(
        (sheet) =>
          sheet.visibility !== "hidden" && sheet.name !== "_REFLO_BRIDGE",
      ),
      cells: row.analysis_json.candidateCells ?? [],
      validationTargets: row.plan_snapshot_json.excelTargets,
      evidenceBindings: evidenceBindings.rows.map((binding) => ({
        targetId: binding.target_id,
        evidenceIds: binding.evidence_ids,
        value: binding.value_normalized,
        formattedText: binding.one_line_value,
        beforeValue:
          activePlan?.commands?.find(
            (command) => command.targetId === binding.target_id,
          )?.beforeValue ?? null,
        afterValue:
          activePlan?.commands?.find(
            (command) => command.targetId === binding.target_id,
          )?.afterValue ?? binding.value_normalized,
        writeStatus: activePlan?.blocked?.some(
          (blocker) => blocker.targetId === binding.target_id,
        )
          ? "blocked"
          : application?.application_status === "succeeded"
            ? "applied"
            : application?.application_status === "queued" ||
                application?.application_status === "running"
              ? "applying"
              : preparation
                ? "proposed"
                : "awaiting_validation",
      })),
      validatedValueSetVersionId: preparation?.resourceVersionId ?? null,
      sourceSnapshotId: preparation?.context.sourceSnapshotId ?? null,
      sourceFingerprint: preparation?.context.sourceFingerprint ?? null,
      expectedProjectVersion: preparation?.context.projectVersion ?? null,
      workbookApplication: application
        ? {
            taskId: application.workbook_application_id,
            status: application.application_status,
          }
        : null,
      workbookApplicationPlan: preparation
        ? {
            commands: preparation.plan.commands,
            blocked: preparation.plan.blocked,
            planHash: preparation.plan.planHash,
          }
        : null,
      validatedWorkbookArtifactId:
        application?.output_artifact_id ?? null,
    };
  });
}

async function updateWorkspaceGate(
  client: TransactionClient,
  projectId: string,
  validationVersion: number,
): Promise<ReturnType<typeof recomputeStageGate> extends Promise<infer T> ? T : never> {
  const gate = await recomputeStageGate(client, projectId, validationVersion);
  await client.query(
    `UPDATE validation_workspace
     SET workspace_status = $2, stage_gate_json = $3::jsonb, updated_at = now()
     WHERE project_id = $1`,
    [
      projectId,
      gate.canProceed ? "REVIEW_READY" : "REVIEW_BLOCKED",
      JSON.stringify(gate),
    ],
  );
  await client.query(
    `UPDATE project_stage_state
     SET blocker_codes = $2::text[], updated_at = now()
     WHERE project_id = $1 AND stage_key = 'validation'`,
    [projectId, gate.blockers.map((blocker) => blocker.code)],
  );
  return gate;
}

export async function decideValidationResult(input: {
  projectId: string;
  userId: string;
  resultId: string;
  idempotencyKey: string | null;
  expectedValidationVersion: unknown;
  action: unknown;
  reason: unknown;
}): Promise<IdempotentResult> {
  const key = requireIdempotencyKey(input.idempotencyKey);
  const version = requireVersion(
    input.expectedValidationVersion,
    "검증",
  );
  if (
    input.action !== "REJECT" &&
    input.action !== "RESTORE" &&
    input.action !== "REINVESTIGATE"
  ) {
    throw new ApiError(
      422,
      "INVALID_RESULT_TRANSITION",
      "지원하지 않는 검증 결정입니다.",
    );
  }
  const action = input.action;
  const reason = cleanReason(input.reason);
  const requestHash = contentHash({
    resultId: input.resultId,
    version,
    action,
    reason,
  });
  return withTransaction(async (client) => {
    const replay = await idempotentReplay(client, {
      userId: input.userId,
      operation: "validation.result_decision",
      projectId: input.projectId,
      key,
      requestHash,
    });
    if (replay) return replay;
    const workspace = await ownedValidationWorkspace(
      client,
      input.projectId,
      input.userId,
      true,
    );
    if (!workspace || Number(workspace.validation_version) !== version) {
      throw new ApiError(
        409,
        "STALE_VALIDATION_VERSION",
        "최신 검증 결과를 다시 불러와주세요.",
        {
          meta: {
            currentVersion: Number(workspace?.validation_version ?? 0),
          },
        },
      );
    }
    if (workspace.workspace_status === "APPROVED") {
      throw new ApiError(
        422,
        "INVALID_RESULT_TRANSITION",
        "승인된 검증본은 새 버전에서만 변경할 수 있습니다.",
      );
    }
    const result = await client.query<{
      exception_status: string;
    }>(
      `SELECT exception_status FROM validation_result
       WHERE project_id = $1 AND result_id = $2
       FOR UPDATE`,
      [input.projectId, input.resultId],
    );
    const row = result.rows[0];
    if (!row) {
      throw new ApiError(404, "RESULT_NOT_FOUND", "검증 결과를 찾을 수 없습니다.");
    }
    if (
      (action === "REJECT" && row.exception_status !== "AVAILABLE") ||
      (action === "RESTORE" && row.exception_status !== "REJECTED") ||
      (action === "REINVESTIGATE" &&
        !["AVAILABLE", "REJECTED", "CONFLICT_UNRESOLVED"].includes(
          row.exception_status,
        ))
    ) {
      throw new ApiError(
        422,
        "INVALID_RESULT_TRANSITION",
        "현재 결과 상태에서 실행할 수 없는 결정입니다.",
      );
    }
    const nextVersion = version + 1;
    const decisionId = uuidv7();
    const previousDecision = await client.query<{ decision_id: string }>(
      `SELECT decision_id FROM validation_decision
       WHERE project_id = $1 AND target_type = 'result' AND target_id = $2
       ORDER BY created_at DESC LIMIT 1`,
      [input.projectId, input.resultId],
    );
    await client.query(
      `INSERT INTO validation_decision (
         decision_id, project_id, validation_version_before,
         validation_version_after, target_type, target_id, action, reason,
         created_by_user_id, supersedes_decision_id
       ) VALUES ($1, $2, $3, $4, 'result', $5, $6, $7, $8, $9)`,
      [
        decisionId,
        input.projectId,
        version,
        nextVersion,
        input.resultId,
        action,
        reason,
        input.userId,
        previousDecision.rows[0]?.decision_id ?? null,
      ],
    );
    let job: { jobId: string; runId: string } | null = null;
    if (action === "REINVESTIGATE") {
      await client.query(
        `UPDATE validation_result SET exception_status = 'REINVESTIGATING'
         WHERE result_id = $1`,
        [input.resultId],
      );
      const context = await projectContext(
        client,
        input.projectId,
        input.userId,
      );
      const plan = await loadPlan(client, context);
      if (!plan) {
        throw new ApiError(
          409,
          "PLAN_REVALIDATION_REQUIRED",
          "조사 계획을 다시 확인해주세요.",
        );
      }
      job = await createResearchJob(client, {
        context,
        plan,
        userId: input.userId,
        runKind: "reinvestigation",
        supersedesRunId: workspace.research_run_id,
      });
    } else {
      await client.query(
        `UPDATE validation_result SET exception_status = $2
         WHERE result_id = $1`,
        [input.resultId, action === "REJECT" ? "REJECTED" : "AVAILABLE"],
      );
    }
    await client.query(
      `UPDATE validation_workspace
       SET validation_version = $2, updated_at = now()
       WHERE project_id = $1`,
      [input.projectId, nextVersion],
    );
    const gate = await updateWorkspaceGate(
      client,
      input.projectId,
      nextVersion,
    );
    const body = {
      decisionId,
      validationVersion: nextVersion,
      exceptionStatus:
        action === "REJECT"
          ? "REJECTED"
          : action === "RESTORE"
            ? "AVAILABLE"
            : "REINVESTIGATING",
      jobId: job?.jobId ?? null,
      stageGate: gate,
    };
    await storeIdempotency(client, {
      userId: input.userId,
      operation: "validation.result_decision",
      projectId: input.projectId,
      key,
      requestHash,
      status: job ? 202 : 200,
      body,
    });
    return { status: job ? 202 : 200, body };
  });
}

export async function decideValidationConflict(input: {
  projectId: string;
  userId: string;
  conflictId: string;
  idempotencyKey: string | null;
  expectedValidationVersion: unknown;
  selectedEvidenceId: unknown;
  reason: unknown;
}): Promise<IdempotentResult> {
  const key = requireIdempotencyKey(input.idempotencyKey);
  const version = requireVersion(input.expectedValidationVersion, "검증");
  const reason = cleanReason(input.reason);
  if (typeof input.selectedEvidenceId !== "string") {
    throw new ApiError(422, "INVALID_RESULT_TRANSITION", "채택할 원문을 선택해주세요.");
  }
  const requestHash = contentHash({
    conflictId: input.conflictId,
    version,
    selectedEvidenceId: input.selectedEvidenceId,
    reason,
  });
  return withTransaction(async (client) => {
    const replay = await idempotentReplay(client, {
      userId: input.userId,
      operation: "validation.conflict_decision",
      projectId: input.projectId,
      key,
      requestHash,
    });
    if (replay) return replay;
    const workspace = await ownedValidationWorkspace(
      client,
      input.projectId,
      input.userId,
      true,
    );
    if (!workspace || Number(workspace.validation_version) !== version) {
      throw new ApiError(
        409,
        "STALE_VALIDATION_VERSION",
        "최신 검증 결과를 다시 불러와주세요.",
      );
    }
    const conflict = await client.query<{
      result_id: string;
      candidate_evidence_ids: string[];
      status: string;
    }>(
      `SELECT result_id, candidate_evidence_ids, status
       FROM validation_conflict
       WHERE project_id = $1 AND conflict_id = $2
       FOR UPDATE`,
      [input.projectId, input.conflictId],
    );
    const row = conflict.rows[0];
    if (!row || row.status !== "unresolved") {
      throw new ApiError(
        409,
        "CONFLICT_ALREADY_RESOLVED",
        "이미 처리된 출처 충돌입니다.",
      );
    }
    const selectedEvidenceId = input.selectedEvidenceId;
    if (
      typeof selectedEvidenceId !== "string" ||
      !row.candidate_evidence_ids.includes(selectedEvidenceId)
    ) {
      throw new ApiError(
        422,
        "INVALID_RESULT_TRANSITION",
        "이 충돌의 검증 원문만 선택할 수 있습니다.",
      );
    }
    const passed = await client.query(
      `SELECT 1 FROM evidence
       WHERE project_id = $1 AND evidence_id = $2 AND machine_status = 'passed'`,
      [input.projectId, input.selectedEvidenceId],
    );
    if (passed.rows.length === 0) {
      throw new ApiError(
        422,
        "INVALID_RESULT_TRANSITION",
        "독립 검증을 통과한 원문만 선택할 수 있습니다.",
      );
    }
    const nextVersion = version + 1;
    const decisionId = uuidv7();
    await client.query(
      `INSERT INTO validation_decision (
         decision_id, project_id, validation_version_before,
         validation_version_after, target_type, target_id, action,
         selected_evidence_id, reason, created_by_user_id
       ) VALUES ($1, $2, $3, $4, 'conflict', $5, 'SELECT_SOURCE', $6, $7, $8)`,
      [
        decisionId,
        input.projectId,
        version,
        nextVersion,
        input.conflictId,
        input.selectedEvidenceId,
        reason,
        input.userId,
      ],
    );
    await client.query(
      `UPDATE validation_conflict
       SET status = 'resolved', selected_evidence_id = $2, resolved_at = now()
       WHERE conflict_id = $1`,
      [input.conflictId, input.selectedEvidenceId],
    );
    await client.query(
      `UPDATE validation_result
       SET exception_status = 'CONFLICT_RESOLVED', evidence_ids = ARRAY[$2::uuid]
       WHERE result_id = $1`,
      [row.result_id, input.selectedEvidenceId],
    );
    await client.query(
      `UPDATE validation_workspace
       SET validation_version = $2, updated_at = now()
       WHERE project_id = $1`,
      [input.projectId, nextVersion],
    );
    const gate = await updateWorkspaceGate(
      client,
      input.projectId,
      nextVersion,
    );
    const body = {
      decisionId,
      validationVersion: nextVersion,
      selectedEvidenceId: input.selectedEvidenceId,
      stageGate: gate,
    };
    await storeIdempotency(client, {
      userId: input.userId,
      operation: "validation.conflict_decision",
      projectId: input.projectId,
      key,
      requestHash,
      status: 200,
      body,
    });
    return { status: 200, body };
  });
}

export async function saveValidationDraft(input: {
  projectId: string;
  userId: string;
  targetType: unknown;
  targetId: unknown;
  action: unknown;
  reason: unknown;
}): Promise<unknown> {
  if (
    !["result", "conflict", "question"].includes(String(input.targetType)) ||
    typeof input.targetId !== "string" ||
    typeof input.action !== "string" ||
    typeof input.reason !== "string" ||
    input.reason.length > 500
  ) {
    throw new ApiError(400, "INVALID_DECISION_REASON", "임시 결정 내용을 확인해주세요.");
  }
  return withTransaction(async (client) => {
    await ownedValidationWorkspace(client, input.projectId, input.userId);
    const draftId = uuidv7();
    const result = await client.query<{ draft_id: string; updated_at: Date }>(
      `INSERT INTO validation_decision_draft (
         draft_id, project_id, target_type, target_id, action, reason,
         updated_by_user_id
       ) VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (project_id, target_type, target_id, action)
       DO UPDATE SET reason = EXCLUDED.reason,
         updated_by_user_id = EXCLUDED.updated_by_user_id, updated_at = now()
       RETURNING draft_id, updated_at`,
      [
        draftId,
        input.projectId,
        input.targetType,
        input.targetId,
        input.action,
        input.reason,
        input.userId,
      ],
    );
    return {
      draftId: result.rows[0].draft_id,
      updatedAt: result.rows[0].updated_at.toISOString(),
    };
  });
}

export async function acceptQualifiedQuestion(input: {
  projectId: string;
  userId: string;
  questionId: string;
  idempotencyKey: string | null;
  expectedValidationVersion: unknown;
  reason: unknown;
}): Promise<IdempotentResult> {
  const key = requireIdempotencyKey(input.idempotencyKey);
  const version = requireVersion(input.expectedValidationVersion, "검증");
  const reason = cleanReason(input.reason);
  const requestHash = contentHash({
    questionId: input.questionId,
    version,
    reason,
  });
  return withTransaction(async (client) => {
    const replay = await idempotentReplay(client, {
      userId: input.userId,
      operation: "validation.accept_qualified",
      projectId: input.projectId,
      key,
      requestHash,
    });
    if (replay) return replay;
    const workspace = await ownedValidationWorkspace(
      client,
      input.projectId,
      input.userId,
      true,
    );
    if (!workspace || Number(workspace.validation_version) !== version) {
      throw new ApiError(
        409,
        "STALE_VALIDATION_VERSION",
        "최신 검증 결과를 다시 불러와주세요.",
      );
    }
    const gateBefore = await recomputeStageGate(client, input.projectId, version);
    const answer = gateBefore.questions.find(
      (question) => question.questionId === input.questionId,
    );
    if (answer?.sufficiency !== "qualified") {
      throw new ApiError(
        422,
        "INVALID_RESULT_TRANSITION",
        "조건부 근거로 판정된 질문만 확인할 수 있습니다.",
      );
    }
    const nextVersion = version + 1;
    const decisionId = uuidv7();
    await client.query(
      `INSERT INTO validation_decision (
         decision_id, project_id, validation_version_before,
         validation_version_after, target_type, target_id, action, reason,
         created_by_user_id
       ) VALUES ($1, $2, $3, $4, 'question', $5,
         'ACCEPT_QUALIFIED', $6, $7)`,
      [
        decisionId,
        input.projectId,
        version,
        nextVersion,
        input.questionId,
        reason,
        input.userId,
      ],
    );
    await client.query(
      `UPDATE validation_workspace
       SET validation_version = $2, updated_at = now()
       WHERE project_id = $1`,
      [input.projectId, nextVersion],
    );
    const gate = await updateWorkspaceGate(
      client,
      input.projectId,
      nextVersion,
    );
    const body = { decisionId, validationVersion: nextVersion, stageGate: gate };
    await storeIdempotency(client, {
      userId: input.userId,
      operation: "validation.accept_qualified",
      projectId: input.projectId,
      key,
      requestHash,
      status: 200,
      body,
    });
    return { status: 200, body };
  });
}

export async function completeValidation(input: {
  projectId: string;
  userId: string;
  idempotencyKey: string | null;
  expectedValidationVersion: unknown;
}): Promise<IdempotentResult> {
  const key = requireIdempotencyKey(input.idempotencyKey);
  const version = requireVersion(input.expectedValidationVersion, "검증");
  const requestHash = contentHash({ version });
  return withTransaction(async (client) => {
    const replay = await idempotentReplay(client, {
      userId: input.userId,
      operation: "validation.complete",
      projectId: input.projectId,
      key,
      requestHash,
    });
    if (replay) return replay;
    const workspace = await ownedValidationWorkspace(
      client,
      input.projectId,
      input.userId,
      true,
    );
    if (!workspace || Number(workspace.validation_version) !== version) {
      throw new ApiError(
        409,
        "STALE_VALIDATION_VERSION",
        "최신 검증 결과를 다시 불러와주세요.",
      );
    }
    const gate = await recomputeStageGate(client, input.projectId, version);
    if (!gate.canProceed) {
      throw new ApiError(
        409,
        "STAGE_GATE_BLOCKED",
        "검증 차단 항목을 해결한 뒤 다시 진행해주세요.",
        {
          details: gate.blockers.map((blocker) => ({
            path: blocker.targetId ?? "validation",
            code: blocker.code,
            message: blocker.message,
          })),
        },
      );
    }
    const validatedWorkbook = await assertValidatedWorkbookReady(client, {
      projectId: input.projectId,
      validationRunId: workspace.validation_run_id,
      validationVersion: version,
      approvedPlanResourceVersionId:
        workspace.approved_plan_resource_version_id,
    });
    const approvalId = uuidv7();
    await client.query(
      `INSERT INTO validation_approval (
         approval_id, project_id, validation_run_id, validation_version,
         approved_plan_resource_version_id, approved_by_user_id,
         validated_value_set_resource_version_id,
         validated_workbook_resource_version_id,
         validated_workbook_artifact_id, workbook_application_id
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        approvalId,
        input.projectId,
        workspace.validation_run_id,
        version,
        workspace.approved_plan_resource_version_id,
        input.userId,
        validatedWorkbook.validatedValueSetResourceVersionId,
        validatedWorkbook.validatedWorkbookResourceVersionId,
        validatedWorkbook.validatedWorkbookArtifactId,
        validatedWorkbook.applicationId,
      ],
    );
    await client.query(
      `UPDATE validation_workspace
       SET workspace_status = 'APPROVED', updated_at = now()
       WHERE project_id = $1`,
      [input.projectId],
    );
    const previous = await client.query<{
      stage_completion_id: string;
      completion_no: string;
    }>(
      `SELECT stage_completion_id, completion_no
       FROM stage_completion
       WHERE project_id = $1 AND stage_key = 'validation'
       ORDER BY completion_no DESC LIMIT 1`,
      [input.projectId],
    );
    const completionId = uuidv7();
    await client.query(
      `INSERT INTO stage_completion (
         stage_completion_id, project_id, stage_key, completion_no,
         primary_version_id, supersedes_completion_id, completed_by_user_id
       ) VALUES ($1, $2, 'validation', $3, $4, $5, $6)`,
      [
        completionId,
        input.projectId,
        Number(previous.rows[0]?.completion_no ?? 0) + 1,
        workspace.approved_plan_resource_version_id,
        previous.rows[0]?.stage_completion_id ?? null,
        input.userId,
      ],
    );
    await client.query(
      `UPDATE project_stage_state
       SET stage_status = 'completed', current_completion_id = $2,
           blocker_codes = '{}', completed_at = now(), updated_at = now()
       WHERE project_id = $1 AND stage_key = 'validation'`,
      [input.projectId, completionId],
    );
    await client.query(
      `UPDATE project_stage_state
       SET stage_status = 'in_progress', blocker_codes = '{}', updated_at = now()
       WHERE project_id = $1 AND stage_key = 'valuation'
         AND stage_status IN ('blocked', 'not_started')`,
      [input.projectId],
    );
    await client.query(
      `UPDATE project
       SET current_stage = 'valuation', row_version = row_version + 1,
           updated_at = now(), last_saved_at = now()
       WHERE project_id = $1`,
      [input.projectId],
    );
    const body = {
      approvalId,
      validationVersion: version,
      validatedWorkbookArtifactId:
        validatedWorkbook.validatedWorkbookArtifactId,
      approvedAt: new Date().toISOString(),
      nextRoute: processRoute(input.projectId, "valuation"),
    };
    await storeIdempotency(client, {
      userId: input.userId,
      operation: "validation.complete",
      projectId: input.projectId,
      key,
      requestHash,
      status: 200,
      body,
    });
    return { status: 200, body };
  });
}

export const phaseFourConstants = {
  validationRuleVersion: VALIDATION_RULE_VERSION,
  researchAgentProfile: RESEARCH_AGENT_PROFILE,
  validationAgentProfile: VALIDATION_AGENT_PROFILE,
  stages: STAGES,
};
