import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { contentHash } from "../../domain/hash";
import { uuidv7 } from "../../domain/ids";
import { processRoute, STAGES, type StageKey } from "../../domain/project";
import { ApiError } from "../../http/api-error";
import type { TransactionClient } from "../database/transaction";
import { withTransaction } from "../database/transaction";
import { objectStoreBucket, putImmutableObject } from "../object-storage/s3";

export type InvestmentRating = "BUY" | "HOLD" | "SELL";
export type SourceType =
  | "filing"
  | "company"
  | "news"
  | "industry"
  | "market_data";

export type HypothesisQuestion = {
  questionId: string;
  order: number;
  text: string;
  purpose: string;
  metrics: string[];
  period: string;
  comparison: string;
  suggestedSourceTypes: SourceType[];
  origin: "agent" | "user";
};

export type AgentQuestion = {
  questionKey: string;
  text: string;
  purpose: string;
  metrics: string[];
  period: string;
  comparison: string;
  sourceTypes: SourceType[];
  priority: number;
};

export type HypothesisAgentResult = {
  schemaVersion: "1.0";
  outputType: "hypothesis_questions";
  inputVersionRefs: Array<{
    role: "hypothesis_draft";
    resourceVersionId: string;
    version: number;
    contentHash: string;
  }>;
  warnings: Array<{ code: string; message: string }>;
  questions: AgentQuestion[];
  missingContext: string[];
  metadata: {
    provider: "openai";
    model: string;
    promptVersion: string;
    outputSchemaId: string;
    startedAt: string;
    finishedAt: string;
    usage: {
      inputTokens: number;
      outputTokens: number;
      cachedInputTokens?: number;
      reasoningTokens?: number;
    };
  };
};

export type HypothesisWorkerResult = {
  output: HypothesisAgentResult;
  rawTrace?: string;
};

type ProjectContext = {
  projectId: string;
  name: string;
  rowVersion: number;
  companyName: string;
  ticker: string;
  industry: string;
  targetYear: number;
  targetQuarter: number;
  cutoffDate: string;
  reportType: string;
  setupCompletionId: string;
  filesCompletionId: string;
};

type HypothesisRow = {
  resourceId: string;
  resourceVersionId: string;
  draftVersion: number;
  inputRevision: string;
  provisionalRating: InvestmentRating | null;
  thesis: string;
  currentQuestionSetId: string | null;
  updatedAt: Date;
};

type IdempotentResult = { status: number; body: unknown };

const AGENT_PROFILE_VERSION = "hypothesis-openai-v1";
const PROMPT_VERSION = "hypothesis-v2";
const OUTPUT_SCHEMA_VERSION = "1.0.0";
const OUTPUT_SCHEMA_ID =
  "https://schemas.reflo.dev/worker/v1/agent-output.schema.json";
const CONFIGURED_MODEL = "gpt-5.6-terra";
const SOURCE_TYPES = new Set<SourceType>([
  "filing",
  "company",
  "news",
  "industry",
  "market_data",
]);

function cleanText(value: unknown, maximum: number, code: string): string {
  if (typeof value !== "string") {
    throw new ApiError(422, code, "입력 내용을 확인해주세요.");
  }
  const cleaned = value
    .normalize("NFC")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .trim();
  if (!cleaned || cleaned.length > maximum) {
    throw new ApiError(
      422,
      code,
      `입력은 1자 이상 ${maximum}자 이하로 작성해주세요.`,
    );
  }
  return cleaned;
}

function requireVersion(value: unknown, label: string): number {
  const version = Number(value);
  if (!Number.isInteger(version) || version < 1) {
    throw new ApiError(400, "INVALID_VERSION", `${label} 버전이 올바르지 않습니다.`);
  }
  return version;
}

function validateIdempotencyKey(value: string | null): string {
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

function revisionFor(input: {
  projectId: string;
  setupCompletionId: string;
  filesCompletionId: string;
  provisionalRating: InvestmentRating | null;
  thesis: string;
}): { revision: string; fingerprint: string } {
  const fingerprint = contentHash(input);
  return { revision: `hir_${fingerprint.slice(0, 48)}`, fingerprint };
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
    company_name: string;
    ticker: string;
    industry_name: string;
    target_year: number;
    target_quarter: number;
    cutoff_date: string;
    report_type: string;
    setup_completion_id: string | null;
    files_completion_id: string | null;
    setup_status: string;
    files_status: string;
  }>(
    `SELECT p.project_id, p.name, p.row_version,
       cm.company_name, cm.ticker, cm.industry_name,
       psv.target_year, psv.target_quarter, psv.cutoff_date::text,
       psv.report_type,
       setup_state.current_completion_id AS setup_completion_id,
       files_state.current_completion_id AS files_completion_id,
       setup_state.stage_status AS setup_status,
       files_state.stage_status AS files_status
     FROM project p
     JOIN project_stage_state setup_state
       ON setup_state.project_id = p.project_id AND setup_state.stage_key = 'setup'
     JOIN project_stage_state files_state
       ON files_state.project_id = p.project_id AND files_state.stage_key = 'files'
     JOIN stage_completion setup_completion
       ON setup_completion.stage_completion_id = setup_state.current_completion_id
     JOIN project_setup_version psv
       ON psv.resource_version_id = setup_completion.primary_version_id
     JOIN company_master cm ON cm.company_master_id = psv.company_master_id
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
      "HYPOTHESIS_PREREQUISITE_INCOMPLETE",
      "프로젝트 설정과 파일 검사를 먼저 완료해주세요.",
      {
        meta: {
          requiredStage: "setup",
          resumeRoute: processRoute(projectId, "setup"),
        },
      },
    );
  }
  if (
    row.setup_status !== "completed" ||
    row.files_status !== "completed" ||
    !row.setup_completion_id ||
    !row.files_completion_id
  ) {
    const requiredStage = row.setup_status !== "completed" ? "setup" : "files";
    throw new ApiError(
      409,
      "HYPOTHESIS_PREREQUISITE_INCOMPLETE",
      "필수 선행 단계를 먼저 완료해주세요.",
      {
        meta: {
          requiredStage,
          resumeRoute: processRoute(projectId, requiredStage),
        },
      },
    );
  }
  return {
    projectId: row.project_id,
    name: row.name,
    rowVersion: Number(row.row_version),
    companyName: row.company_name,
    ticker: row.ticker,
    industry: row.industry_name,
    targetYear: row.target_year,
    targetQuarter: row.target_quarter,
    cutoffDate: row.cutoff_date,
    reportType: row.report_type,
    setupCompletionId: row.setup_completion_id,
    filesCompletionId: row.files_completion_id,
  };
}

async function ensureHypothesis(
  client: TransactionClient,
  context: ProjectContext,
  userId: string,
): Promise<HypothesisRow> {
  const existing = await client.query<{
    resource_id: string;
    current_resource_version_id: string;
    draft_version: string;
    input_revision: string;
    provisional_rating: InvestmentRating | null;
    thesis: string;
    current_question_set_id: string | null;
    updated_at: Date;
  }>(
    `SELECT resource_id, current_resource_version_id, draft_version,
       input_revision, provisional_rating, thesis, current_question_set_id,
       updated_at
     FROM project_hypothesis WHERE project_id = $1`,
    [context.projectId],
  );
  const row = existing.rows[0];
  if (row) {
    return {
      resourceId: row.resource_id,
      resourceVersionId: row.current_resource_version_id,
      draftVersion: Number(row.draft_version),
      inputRevision: row.input_revision,
      provisionalRating: row.provisional_rating,
      thesis: row.thesis,
      currentQuestionSetId: row.current_question_set_id,
      updatedAt: row.updated_at,
    };
  }

  const resourceId = uuidv7();
  const resourceVersionId = uuidv7();
  const revision = revisionFor({
    projectId: context.projectId,
    setupCompletionId: context.setupCompletionId,
    filesCompletionId: context.filesCompletionId,
    provisionalRating: null,
    thesis: "",
  });
  await client.query(
    `INSERT INTO versioned_resource (
       resource_id, project_id, resource_kind, resource_key
     ) VALUES ($1, $2, 'project_hypothesis', 'main')`,
    [resourceId, context.projectId],
  );
  await client.query(
    `INSERT INTO resource_version (
       resource_version_id, resource_id, version_no, lifecycle_status,
       input_fingerprint, content_hash, created_by_user_id
     ) VALUES ($1, $2, 1, 'draft', $3, $4, $5)`,
    [
      resourceVersionId,
      resourceId,
      revision.fingerprint,
      contentHash({ provisionalRating: null, thesis: "" }),
      userId,
    ],
  );
  await client.query(
    `INSERT INTO project_hypothesis (
       project_id, resource_id, current_resource_version_id, draft_version,
       input_revision, provisional_rating, thesis, updated_by_user_id
     ) VALUES ($1, $2, $3, 1, $4, NULL, '', $5)`,
    [context.projectId, resourceId, resourceVersionId, revision.revision, userId],
  );
  await client.query(
    `INSERT INTO project_hypothesis_version (
       resource_version_id, project_id, draft_version, input_revision,
       provisional_rating, thesis, setup_completion_id, files_completion_id
     ) VALUES ($1, $2, 1, $3, NULL, '', $4, $5)`,
    [
      resourceVersionId,
      context.projectId,
      revision.revision,
      context.setupCompletionId,
      context.filesCompletionId,
    ],
  );
  return {
    resourceId,
    resourceVersionId,
    draftVersion: 1,
    inputRevision: revision.revision,
    provisionalRating: null,
    thesis: "",
    currentQuestionSetId: null,
    updatedAt: new Date(),
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
     FROM project_stage_state WHERE project_id = $1 ORDER BY stage_order`,
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

async function loadQuestionSet(
  client: TransactionClient,
  questionSetId: string | null,
): Promise<null | {
  questionSetId: string;
  version: number;
  generatedFromInputRevision: string;
  status: "draft" | "stale" | "approved" | "obsolete";
  promptVersion: string | null;
  missingContext: string[];
  approvedAt: string | null;
  approvedBy: string | null;
  questions: HypothesisQuestion[];
}> {
  if (!questionSetId) return null;
  const versionResult = await client.query<{
    question_set_id: string;
    version_no: string;
    generated_from_input_revision: string;
    status: "draft" | "stale" | "approved" | "obsolete";
    prompt_version: string | null;
    missing_context: string[];
    approved_at: Date | null;
    approved_by: string | null;
  }>(
    `SELECT qsv.question_set_id, qsv.version_no,
       qsv.generated_from_input_revision, qsv.status, qsv.prompt_version,
       qsv.missing_context,
       approval.approved_at, approval.approved_by_user_id AS approved_by
     FROM hypothesis_question_set qs
     JOIN hypothesis_question_set_version qsv
       ON qsv.question_set_id = qs.question_set_id
      AND qsv.version_no = qs.current_version
     LEFT JOIN LATERAL (
       SELECT approved_at, approved_by_user_id
       FROM hypothesis_approval
       WHERE question_set_id = qs.question_set_id
         AND question_set_version = qs.current_version
       ORDER BY approved_at DESC LIMIT 1
     ) approval ON true
     WHERE qs.question_set_id = $1`,
    [questionSetId],
  );
  const version = versionResult.rows[0];
  if (!version) return null;
  const questions = await client.query<{
    question_id: string;
    display_order: number;
    question_text: string;
    purpose: string;
    metrics: string[];
    period: string;
    comparison: string;
    suggested_source_types: SourceType[];
    origin: "agent" | "user";
  }>(
    `SELECT question_id, display_order, question_text, purpose, metrics,
       period, comparison, suggested_source_types, origin
     FROM hypothesis_question
     WHERE question_set_id = $1 AND set_version = $2
     ORDER BY display_order`,
    [questionSetId, version.version_no],
  );
  return {
    questionSetId: version.question_set_id,
    version: Number(version.version_no),
    generatedFromInputRevision: version.generated_from_input_revision,
    status: version.status,
    promptVersion: version.prompt_version,
    missingContext: version.missing_context ?? [],
    approvedAt: version.approved_at?.toISOString() ?? null,
    approvedBy: version.approved_by,
    questions: questions.rows.map((row) => ({
      questionId: row.question_id,
      order: row.display_order,
      text: row.question_text,
      purpose: row.purpose,
      metrics: row.metrics,
      period: row.period,
      comparison: row.comparison,
      suggestedSourceTypes: row.suggested_source_types,
      origin: row.origin,
    })),
  };
}

async function activeGeneration(client: TransactionClient, projectId: string) {
  const result = await client.query<{
    generation_id: string;
    operation_status: string;
    validity_status: string;
    current_phase: string | null;
    progress_percent: number;
    retryable: boolean;
    error_code: string | null;
    error_summary: string | null;
    requested_at: Date;
    finished_at: Date | null;
  }>(
    `SELECT hg.generation_id, wj.operation_status, wj.validity_status,
       wj.current_phase, wj.progress_percent, wj.retryable, wj.error_code,
       wj.error_summary, wj.requested_at, wj.finished_at
     FROM hypothesis_generation hg
     JOIN workflow_job wj ON wj.job_id = hg.job_id
     WHERE hg.project_id = $1
     ORDER BY wj.requested_at DESC LIMIT 1`,
    [projectId],
  );
  const row = result.rows[0];
  return row
    ? {
        generationId: row.generation_id,
        operationStatus: row.operation_status,
        validity: row.validity_status,
        phase: row.current_phase,
        progressPercent: row.progress_percent,
        retryable: row.retryable,
        error:
          row.error_code && row.error_summary
            ? { code: row.error_code, message: row.error_summary }
            : null,
        requestedAt: row.requested_at.toISOString(),
        finishedAt: row.finished_at?.toISOString() ?? null,
      }
    : null;
}

export async function getHypothesisWorkspace(
  projectId: string,
  userId: string,
): Promise<unknown> {
  return withTransaction(async (client) => {
    const context = await projectContext(client, projectId, userId, true);
    const hypothesis = await ensureHypothesis(client, context, userId);
    const stages = await workflowState(client, projectId);
    const questionSet = await loadQuestionSet(
      client,
      hypothesis.currentQuestionSetId,
    );
    const generation = await activeGeneration(client, projectId);
    const canContinue =
      questionSet?.status === "approved" &&
      questionSet.generatedFromInputRevision === hypothesis.inputRevision;
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
        reportType: context.reportType,
        currentStage: "hypothesis",
      },
      prerequisites: {
        setup: "completed",
        files: "completed",
        filesCompletionId: context.filesCompletionId,
      },
      draft: {
        draftVersion: hypothesis.draftVersion,
        inputRevision: hypothesis.inputRevision,
        provisionalRating: hypothesis.provisionalRating,
        thesis: hypothesis.thesis,
        updatedAt: hypothesis.updatedAt.toISOString(),
      },
      questionSet,
      generation,
      workflow: {
        stageStates: stages,
        allowedRoutes: stages
          .filter((stage) => stage.status !== "blocked" && stage.status !== "not_started")
          .map((stage) => stage.route),
      },
      navigation: {
        previousRoute: processRoute(projectId, "files"),
        nextRoute: processRoute(projectId, "research_plan"),
        canContinue,
      },
    };
  });
}

async function markDownstreamRevalidation(
  client: TransactionClient,
  projectId: string,
  triggerVersionId: string,
): Promise<StageKey[]> {
  const progressed = await client.query<{ stage_key: StageKey }>(
    `SELECT stage_key
     FROM project_stage_state
     WHERE project_id = $1 AND stage_order >= 4
       AND stage_status NOT IN ('not_started', 'blocked')
     ORDER BY stage_order`,
    [projectId],
  );
  const affected = progressed.rows.map((row) => row.stage_key);
  if (affected.length === 0) return affected;
  await client.query(
    `UPDATE project_stage_state
     SET stage_status = 'revalidation_required', invalidated_at = now(),
         blocker_codes = ARRAY['HYPOTHESIS_CHANGED'], updated_at = now()
     WHERE project_id = $1 AND stage_key = ANY($2::text[])`,
    [projectId, affected],
  );
  await client.query(
    `INSERT INTO project_invalidation_event (
       invalidation_id, project_id, trigger_version_id, start_stage_key,
       reason_code, affected_stage_keys
     ) VALUES ($1, $2, $3, 'research_plan', 'HYPOTHESIS_CHANGED', $4)`,
    [uuidv7(), projectId, triggerVersionId, affected],
  );
  await client.query(
    `UPDATE project SET project_status = 'revalidation_required',
       updated_at = now() WHERE project_id = $1`,
    [projectId],
  );
  return affected;
}

export async function saveHypothesis(input: {
  projectId: string;
  userId: string;
  expectedDraftVersion: unknown;
  provisionalRating?: unknown;
  thesis?: unknown;
  requestId?: unknown;
}): Promise<unknown> {
  const expectedDraftVersion = requireVersion(
    input.expectedDraftVersion,
    "가설 초안",
  );
  const hasRating = input.provisionalRating !== undefined;
  const hasThesis = input.thesis !== undefined;
  if (!hasRating && !hasThesis) {
    throw new ApiError(400, "INVALID_REQUEST", "저장할 변경 내용이 없습니다.");
  }
  const rating = hasRating
    ? input.provisionalRating === "BUY" ||
      input.provisionalRating === "HOLD" ||
      input.provisionalRating === "SELL"
      ? input.provisionalRating
      : (() => {
          throw new ApiError(
            422,
            "INVALID_RATING",
            "BUY, HOLD, SELL 중 하나를 선택해주세요.",
          );
        })()
    : undefined;
  const thesis = hasThesis
    ? cleanText(input.thesis, 500, "INVALID_THESIS")
    : undefined;
  const requestId =
    typeof input.requestId === "string" ? input.requestId.slice(0, 128) : null;

  return withTransaction(async (client) => {
    const context = await projectContext(
      client,
      input.projectId,
      input.userId,
      true,
    );
    const current = await ensureHypothesis(client, context, input.userId);
    if (current.draftVersion !== expectedDraftVersion) {
      throw new ApiError(
        409,
        "VERSION_CONFLICT",
        "다른 탭에서 최신 가설이 저장되었습니다.",
        {
          meta: {
            currentVersion: current.draftVersion,
            updatedAt: current.updatedAt.toISOString(),
          },
        },
      );
    }
    const nextRating = rating ?? current.provisionalRating;
    const nextThesis = thesis ?? current.thesis;
    if (
      nextRating === current.provisionalRating &&
      nextThesis === current.thesis
    ) {
      return {
        draftVersion: current.draftVersion,
        inputRevision: current.inputRevision,
        provisionalRating: current.provisionalRating,
        thesis: current.thesis,
        questionSetBecameStale: false,
        downstreamInvalidations: [],
      };
    }
    const nextVersion = current.draftVersion + 1;
    const nextResourceVersionId = uuidv7();
    const revision = revisionFor({
      projectId: input.projectId,
      setupCompletionId: context.setupCompletionId,
      filesCompletionId: context.filesCompletionId,
      provisionalRating: nextRating,
      thesis: nextThesis,
    });
    await client.query(
      `UPDATE resource_version SET lifecycle_status = 'superseded'
       WHERE resource_version_id = $1`,
      [current.resourceVersionId],
    );
    await client.query(
      `INSERT INTO resource_version (
         resource_version_id, resource_id, version_no, lifecycle_status,
         supersedes_version_id, input_fingerprint, content_hash,
         created_by_user_id
       ) VALUES ($1, $2, $3, 'draft', $4, $5, $6, $7)`,
      [
        nextResourceVersionId,
        current.resourceId,
        nextVersion,
        current.resourceVersionId,
        revision.fingerprint,
        contentHash({ provisionalRating: nextRating, thesis: nextThesis }),
        input.userId,
      ],
    );
    await client.query(
      `INSERT INTO project_hypothesis_version (
         resource_version_id, project_id, draft_version, input_revision,
         provisional_rating, thesis, setup_completion_id, files_completion_id
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        nextResourceVersionId,
        input.projectId,
        nextVersion,
        revision.revision,
        nextRating,
        nextThesis,
        context.setupCompletionId,
        context.filesCompletionId,
      ],
    );
    await client.query(
      `UPDATE project_hypothesis
       SET current_resource_version_id = $2, draft_version = $3,
           input_revision = $4, provisional_rating = $5, thesis = $6,
           updated_by_user_id = $7, updated_at = now()
       WHERE project_id = $1`,
      [
        input.projectId,
        nextResourceVersionId,
        nextVersion,
        revision.revision,
        nextRating,
        nextThesis,
        input.userId,
      ],
    );
    let questionSetBecameStale = false;
    if (current.currentQuestionSetId) {
      const changed = await client.query(
        `UPDATE hypothesis_question_set_version qsv
         SET status = 'stale'
         FROM hypothesis_question_set qs
         WHERE qs.question_set_id = $1
           AND qsv.question_set_id = qs.question_set_id
           AND qsv.version_no = qs.current_version
           AND qsv.generated_from_input_revision <> $2
           AND qsv.status <> 'obsolete'
         RETURNING qsv.question_set_id`,
        [current.currentQuestionSetId, revision.revision],
      );
      questionSetBecameStale = changed.rows.length > 0;
    }
    const reopened = await client.query(
      `UPDATE project_stage_state
       SET stage_status = 'in_progress', current_completion_id = NULL,
           completed_at = NULL, updated_at = now()
       WHERE project_id = $1 AND stage_key = 'hypothesis'
         AND stage_status = 'completed'
       RETURNING stage_key`,
      [input.projectId],
    );
    if (reopened.rows.length > 0) {
      await client.query(
        `UPDATE project SET current_stage = 'hypothesis',
           row_version = row_version + 1, updated_at = now()
         WHERE project_id = $1`,
        [input.projectId],
      );
    }
    await client.query(
      `UPDATE workflow_job wj SET validity_status = 'obsolete'
       FROM hypothesis_generation hg
       WHERE hg.job_id = wj.job_id AND hg.project_id = $1
         AND hg.input_revision <> $2
         AND wj.operation_status IN ('queued', 'running')`,
      [input.projectId, revision.revision],
    );
    const downstreamInvalidations = await markDownstreamRevalidation(
      client,
      input.projectId,
      nextResourceVersionId,
    );
    await client.query(
      `INSERT INTO hypothesis_audit_event (
         audit_event_id, project_id, actor_user_id, event_type,
         input_revision, request_id, metadata_json
       ) VALUES ($1, $2, $3, 'hypothesis_saved', $4, $5, $6)`,
      [
        uuidv7(),
        input.projectId,
        input.userId,
        revision.revision,
        requestId,
        JSON.stringify({ draftVersion: nextVersion, downstreamInvalidations }),
      ],
    );
    return {
      draftVersion: nextVersion,
      inputRevision: revision.revision,
      provisionalRating: nextRating,
      thesis: nextThesis,
      questionSetBecameStale,
      downstreamInvalidations,
      updatedAt: new Date().toISOString(),
    };
  });
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
       AND idempotency_key = $4 AND expires_at > now()
     FOR UPDATE`,
    [input.userId, input.operation, input.projectId, input.key],
  );
  const row = result.rows[0];
  if (!row) return null;
  if (row.request_hash !== input.requestHash) {
    throw new ApiError(
      409,
      "IDEMPOTENCY_CONFLICT",
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
    responseStatus: number;
    response: unknown;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO idempotency_record (
       idempotency_id, user_id, operation, project_id, idempotency_key,
       request_hash, response_status, response_json, expires_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now() + interval '24 hours')`,
    [
      uuidv7(),
      input.userId,
      input.operation,
      input.projectId,
      input.key,
      input.requestHash,
      input.responseStatus,
      JSON.stringify(input.response),
    ],
  );
}

export async function createHypothesisGeneration(input: {
  projectId: string;
  userId: string;
  idempotencyKey: string | null;
  expectedDraftVersion: unknown;
  inputRevision: unknown;
  requestId?: unknown;
}): Promise<IdempotentResult> {
  const key = validateIdempotencyKey(input.idempotencyKey);
  const expectedDraftVersion = requireVersion(
    input.expectedDraftVersion,
    "가설 초안",
  );
  const inputRevision =
    typeof input.inputRevision === "string" ? input.inputRevision : "";
  const requestId =
    typeof input.requestId === "string" ? input.requestId.slice(0, 128) : "";
  const requestHash = contentHash({
    expectedDraftVersion,
    inputRevision,
    requestId,
  });
  return withTransaction(async (client) => {
    const replay = await idempotentReplay(client, {
      userId: input.userId,
      operation: "hypothesis.generate",
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
    const hypothesis = await ensureHypothesis(client, context, input.userId);
    if (
      hypothesis.draftVersion !== expectedDraftVersion ||
      hypothesis.inputRevision !== inputRevision
    ) {
      throw new ApiError(
        409,
        "INPUT_REVISION_CHANGED",
        "최신 저장 내용을 확인한 뒤 질문을 다시 만들어주세요.",
      );
    }
    if (!hypothesis.provisionalRating || !hypothesis.thesis) {
      throw new ApiError(
        422,
        "INVALID_HYPOTHESIS",
        "잠정 투자의견과 투자 가설을 먼저 저장해주세요.",
      );
    }
    const active = await client.query(
      `SELECT 1 FROM workflow_job
       WHERE project_id = $1
         AND job_type = 'hypothesis_generation'
         AND operation_status IN ('queued', 'running')
         AND validity_status = 'current'`,
      [input.projectId],
    );
    if (active.rows.length > 0) {
      throw new ApiError(
        409,
        "GENERATION_ALREADY_RUNNING",
        "현재 입력의 질문을 만들고 있습니다.",
      );
    }
    const rate = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM hypothesis_generation
       WHERE project_id = $1 AND created_at > now() - interval '1 hour'`,
      [input.projectId],
    );
    if (Number(rate.rows[0]?.count ?? 0) >= 20) {
      throw new ApiError(
        429,
        "RATE_LIMITED",
        "질문 생성 한도를 초과했습니다. 잠시 후 다시 시도해주세요.",
        { retryable: true },
      );
    }
    const generationId = uuidv7();
    const jobId = uuidv7();
    await client.query(
      `INSERT INTO workflow_job (
         job_id, project_id, job_type, temporal_workflow_id,
         input_fingerprint, requested_by_user_id
       ) VALUES ($1, $2, 'hypothesis_generation', $3, $4, $5)`,
      [
        jobId,
        input.projectId,
        `reflo:${jobId}`,
        contentHash({
          inputRevision,
          agentProfileVersion: AGENT_PROFILE_VERSION,
          promptVersion: PROMPT_VERSION,
        }),
        input.userId,
      ],
    );
    await client.query(
      `INSERT INTO workflow_job_input (job_id, input_role, resource_version_id)
       VALUES ($1, 'hypothesis_input', $2)`,
      [jobId, hypothesis.resourceVersionId],
    );
    await client.query(
      `INSERT INTO hypothesis_generation (
         generation_id, project_id, job_id, input_resource_version_id,
         input_revision, draft_version, agent_profile_version, prompt_version,
         output_schema_version, configured_model
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        generationId,
        input.projectId,
        jobId,
        hypothesis.resourceVersionId,
        inputRevision,
        hypothesis.draftVersion,
        AGENT_PROFILE_VERSION,
        PROMPT_VERSION,
        OUTPUT_SCHEMA_VERSION,
        CONFIGURED_MODEL,
      ],
    );
    const payload = {
      workflowType: "hypothesisGenerationWorkflow",
      jobId,
      jobAttempt: 1,
      projectId: input.projectId,
      generationId,
      inputResourceVersionId: hypothesis.resourceVersionId,
      inputDraftVersion: hypothesis.draftVersion,
      inputContentHash: contentHash({
        provisionalRating: hypothesis.provisionalRating,
        thesis: hypothesis.thesis,
      }),
      inputRevision,
      company: context.companyName,
      ticker: context.ticker,
      sector: context.industry,
      targetPeriod: `${context.targetYear}년 ${context.targetQuarter}분기`,
      asOfDate: context.cutoffDate,
      reportType: context.reportType,
      rating: hypothesis.provisionalRating,
      hypothesis: hypothesis.thesis,
      knownFacts: [],
      availableSourceTypes: Array.from(SOURCE_TYPES),
      optionalContext: null,
      agentProfile: {
        version: AGENT_PROFILE_VERSION,
        promptVersion: PROMPT_VERSION,
        outputSchemaVersion: OUTPUT_SCHEMA_VERSION,
        model: CONFIGURED_MODEL,
        reasoning: "medium",
        inputTokenLimit: 50_000,
        outputTokenLimit: 8_000,
        timeoutSeconds: 120,
        costLimitUsd: 1,
      },
    };
    await client.query(
      `INSERT INTO outbox_event (
         outbox_event_id, job_id, command_type, command_id, payload_json
       ) VALUES ($1, $2, 'start_workflow', $3, $4)`,
      [uuidv7(), jobId, uuidv7(), JSON.stringify(payload)],
    );
    const body = {
      generationId,
      operationStatus: "queued",
      validity: "current",
      statusUrl: `/api/projects/${input.projectId}/hypothesis/generations/${generationId}`,
    };
    await storeIdempotency(client, {
      userId: input.userId,
      operation: "hypothesis.generate",
      projectId: input.projectId,
      key,
      requestHash,
      responseStatus: 202,
      response: body,
    });
    await client.query(
      `INSERT INTO hypothesis_audit_event (
         audit_event_id, project_id, actor_user_id, event_type,
         input_revision, request_id, metadata_json
       ) VALUES ($1, $2, $3, 'generation_requested', $4, $5, $6)`,
      [
        uuidv7(),
        input.projectId,
        input.userId,
        inputRevision,
        requestId,
        JSON.stringify({ generationId, jobId }),
      ],
    );
    return { status: 202, body };
  });
}

export async function getHypothesisGeneration(input: {
  projectId: string;
  userId: string;
  generationId: string;
}): Promise<unknown> {
  return withTransaction(async (client) => {
    await projectContext(client, input.projectId, input.userId);
    const result = await client.query<{
      operation_status: string;
      validity_status: string;
      current_phase: string | null;
      progress_percent: number;
      retryable: boolean;
      error_code: string | null;
      error_summary: string | null;
      requested_at: Date;
      started_at: Date | null;
      finished_at: Date | null;
      current_question_set_id: string | null;
    }>(
      `SELECT wj.operation_status, wj.validity_status, wj.current_phase,
         wj.progress_percent, wj.retryable, wj.error_code, wj.error_summary,
         wj.requested_at, wj.started_at, wj.finished_at,
         CASE WHEN hg.input_revision = ph.input_revision
           THEN ph.current_question_set_id ELSE NULL END AS current_question_set_id
       FROM hypothesis_generation hg
       JOIN workflow_job wj ON wj.job_id = hg.job_id
       JOIN project_hypothesis ph ON ph.project_id = hg.project_id
       WHERE hg.generation_id = $1 AND hg.project_id = $2`,
      [input.generationId, input.projectId],
    );
    const row = result.rows[0];
    if (!row) {
      throw new ApiError(
        404,
        "GENERATION_NOT_FOUND",
        "질문 생성 작업을 찾을 수 없습니다.",
      );
    }
    return {
      generationId: input.generationId,
      operationStatus: row.operation_status,
      validity: row.validity_status,
      phase: row.current_phase,
      progressPercent: row.progress_percent,
      retryable: row.retryable,
      error:
        row.error_code && row.error_summary
          ? { code: row.error_code, message: row.error_summary }
          : null,
      requestedAt: row.requested_at.toISOString(),
      startedAt: row.started_at?.toISOString() ?? null,
      finishedAt: row.finished_at?.toISOString() ?? null,
      questionSet: await loadQuestionSet(client, row.current_question_set_id),
    };
  });
}

export function validateHypothesisAgentOutput(
  result: HypothesisAgentResult,
): AgentQuestion[] {
  if (
    !result ||
    result.schemaVersion !== "1.0" ||
    result.outputType !== "hypothesis_questions" ||
    result.metadata?.provider !== "openai" ||
    result.metadata?.promptVersion !== PROMPT_VERSION ||
    result.metadata?.outputSchemaId !== OUTPUT_SCHEMA_ID ||
    !Array.isArray(result.inputVersionRefs) ||
    result.inputVersionRefs.length !== 1 ||
    result.inputVersionRefs[0]?.role !== "hypothesis_draft" ||
    !Array.isArray(result.warnings) ||
    !Array.isArray(result.questions) ||
    result.questions.length < 3 ||
    result.questions.length > 5
  ) {
    throw new ApiError(
      422,
      "AGENT_OUTPUT_INVALID",
      "질문 생성 결과 형식이 올바르지 않습니다.",
    );
  }
  const normalized = new Set<string>();
  const priorities = new Set<number>();
  for (const question of result.questions) {
    const text = cleanText(question.text, 300, "AGENT_OUTPUT_INVALID");
    const normalizedText = text.replace(/\s+/g, " ").toLocaleLowerCase("ko-KR");
    if (normalized.has(normalizedText)) {
      throw new ApiError(
        422,
        "AGENT_OUTPUT_INVALID",
        "중복된 조사 질문이 생성되었습니다.",
      );
    }
    normalized.add(normalizedText);
    if (
      !cleanText(question.purpose, 500, "AGENT_OUTPUT_INVALID") ||
      !cleanText(question.period, 200, "AGENT_OUTPUT_INVALID") ||
      !cleanText(question.comparison, 300, "AGENT_OUTPUT_INVALID") ||
      !Array.isArray(question.metrics) ||
      question.metrics.length < 1 ||
      !Array.isArray(question.sourceTypes) ||
      question.sourceTypes.length < 1 ||
      question.sourceTypes.some((source) => !SOURCE_TYPES.has(source)) ||
      !Number.isInteger(question.priority) ||
      priorities.has(question.priority)
    ) {
      throw new ApiError(
        422,
        "AGENT_OUTPUT_INVALID",
        "질문 metadata를 검증하지 못했습니다.",
      );
    }
    priorities.add(question.priority);
  }
  const expected = Array.from(
    { length: result.questions.length },
    (_, index) => index + 1,
  );
  if (expected.some((priority) => !priorities.has(priority))) {
    throw new ApiError(
      422,
      "AGENT_OUTPUT_INVALID",
      "질문 우선순위가 연속적이지 않습니다.",
    );
  }
  return [...result.questions].sort((a, b) => a.priority - b.priority);
}

function artifactEncryptionKey(): Buffer {
  const configured = process.env.REFLO_AGENT_ARTIFACT_KEY?.trim();
  if (configured) {
    const decoded = Buffer.from(configured, "base64");
    if (decoded.byteLength !== 32) {
      throw new Error("REFLO_AGENT_ARTIFACT_KEY must be a 32-byte base64 key");
    }
    return decoded;
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("REFLO_AGENT_ARTIFACT_KEY is required in production");
  }
  return createHash("sha256")
    .update(
      process.env.REFLO_WORKER_TOKEN ||
        "reflo-local-worker-token-change-me",
    )
    .digest();
}

async function storeRawTrace(
  projectId: string,
  generationId: string,
  rawTrace: string | undefined,
): Promise<null | {
  artifactId: string;
  objectKey: string;
  objectVersion: string;
  sha256: string;
  byteSize: number;
  keyRef: string;
}> {
  if (!rawTrace) return null;
  const key = artifactEncryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(Buffer.from(rawTrace, "utf8")),
    cipher.final(),
  ]);
  const body = Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
  const objectKey = `temporary/${projectId}/agent/${generationId}/raw-trace.enc`;
  const stored = await putImmutableObject({
    objectKey,
    body,
    mediaType: "application/octet-stream",
    metadata: {
      encryption: "AES-256-GCM",
      retentionDays: "30",
    },
  });
  return {
    artifactId: uuidv7(),
    objectKey,
    objectVersion: stored.objectVersion,
    sha256: createHash("sha256").update(body).digest("hex"),
    byteSize: body.byteLength,
    keyRef: process.env.REFLO_AGENT_ARTIFACT_KEY_REF || "local-derived-v1",
  };
}

export async function commitHypothesisGenerationResult(
  jobId: string,
  workerResult: HypothesisWorkerResult,
): Promise<void> {
  const result = workerResult.output;
  const questions = validateHypothesisAgentOutput(result);
  const lookup = await withTransaction(async (client) => {
    const generation = await client.query<{
      generation_id: string;
      project_id: string;
      input_revision: string;
      input_resource_version_id: string;
      operation_status: string;
      validity_status: string;
    }>(
      `SELECT hg.generation_id, hg.project_id, hg.input_revision,
         hg.input_resource_version_id, wj.operation_status, wj.validity_status
       FROM hypothesis_generation hg
       JOIN workflow_job wj ON wj.job_id = hg.job_id
       WHERE hg.job_id = $1`,
      [jobId],
    );
    const row = generation.rows[0];
    if (!row) {
      throw new ApiError(404, "JOB_NOT_FOUND", "생성 작업을 찾을 수 없습니다.");
    }
    return row;
  });
  if (lookup.operation_status === "succeeded") return;
  const rawArtifact = await storeRawTrace(
    lookup.project_id,
    lookup.generation_id,
    workerResult.rawTrace,
  );
  await withTransaction(async (client) => {
    const generation = await client.query<{
      generation_id: string;
      project_id: string;
      input_revision: string;
      input_resource_version_id: string;
      operation_status: string;
      validity_status: string;
      current_input_revision: string;
      current_question_set_id: string | null;
      draft_version: string;
      input_content_hash: string;
    }>(
      `SELECT hg.generation_id, hg.project_id, hg.input_revision,
         hg.input_resource_version_id, wj.operation_status, wj.validity_status,
         ph.input_revision AS current_input_revision,
         ph.current_question_set_id, hg.draft_version,
         rv.content_hash AS input_content_hash
       FROM hypothesis_generation hg
       JOIN workflow_job wj ON wj.job_id = hg.job_id
       JOIN project_hypothesis ph ON ph.project_id = hg.project_id
       JOIN resource_version rv
         ON rv.resource_version_id = hg.input_resource_version_id
       WHERE hg.job_id = $1 FOR UPDATE OF wj, ph`,
      [jobId],
    );
    const row = generation.rows[0];
    if (!row) {
      throw new ApiError(404, "JOB_NOT_FOUND", "생성 작업을 찾을 수 없습니다.");
    }
    if (row.operation_status === "succeeded") return;
    const inputRef = result.inputVersionRefs[0];
    if (
      inputRef.resourceVersionId !== row.input_resource_version_id ||
      inputRef.version !== Number(row.draft_version) ||
      inputRef.contentHash !== row.input_content_hash
    ) {
      throw new ApiError(
        422,
        "AGENT_OUTPUT_INVALID",
        "Agent 입력 버전이 실행 기록과 일치하지 않습니다.",
      );
    }
    const obsolete =
      row.validity_status === "obsolete" ||
      row.input_revision !== row.current_input_revision;
    if (rawArtifact) {
      await client.query(
        `INSERT INTO artifact (
           artifact_id, project_id, artifact_kind, storage_status,
           bucket_name, object_key, object_version, sha256, byte_size,
           media_type, retention_class, created_by_actor_type,
           retention_expires_at, encryption_algorithm, encryption_key_ref
         ) VALUES ($1, $2, 'agent_output', 'temporary', $3, $4, $5, $6, $7,
           'application/octet-stream', 'temporary', 'worker',
           now() + interval '30 days', 'AES-256-GCM', $8)`,
        [
          rawArtifact.artifactId,
          row.project_id,
          objectStoreBucket(),
          rawArtifact.objectKey,
          rawArtifact.objectVersion,
          rawArtifact.sha256,
          rawArtifact.byteSize,
          rawArtifact.keyRef,
        ],
      );
    }
    const questionSetId = uuidv7();
    const resourceId = uuidv7();
    const resourceVersionId = uuidv7();
    await client.query(
      `INSERT INTO versioned_resource (
         resource_id, project_id, resource_kind, resource_key
       ) VALUES ($1, $2, 'hypothesis_question_set', $3)`,
      [resourceId, row.project_id, questionSetId],
    );
    const outputContent = {
      questions,
      missingContext: result.missingContext ?? [],
      promptVersion: result.metadata.promptVersion,
    };
    await client.query(
      `INSERT INTO resource_version (
         resource_version_id, resource_id, version_no, lifecycle_status,
         validity_status, input_fingerprint, content_hash,
         created_by_actor_type
       ) VALUES ($1, $2, 1, 'draft', $3, $4, $5, 'system')`,
      [
        resourceVersionId,
        resourceId,
        obsolete ? "obsolete" : "current",
        contentHash({
          inputRevision: row.input_revision,
          promptVersion: result.metadata.promptVersion,
        }),
        contentHash(outputContent),
      ],
    );
    await client.query(
      `INSERT INTO hypothesis_question_set (
         question_set_id, project_id, resource_id, current_version,
         source_generation_id
       ) VALUES ($1, $2, $3, 1, $4)`,
      [questionSetId, row.project_id, resourceId, row.generation_id],
    );
    await client.query(
      `INSERT INTO hypothesis_question_set_version (
         resource_version_id, question_set_id, version_no,
         generated_from_input_revision, status, prompt_version,
         missing_context, created_by_actor_type
       ) VALUES ($1, $2, 1, $3, $4, $5, $6, 'worker')`,
      [
        resourceVersionId,
        questionSetId,
        row.input_revision,
        obsolete ? "obsolete" : "draft",
        result.metadata.promptVersion,
        JSON.stringify(result.missingContext ?? []),
      ],
    );
    for (const [index, question] of questions.entries()) {
      await client.query(
        `INSERT INTO hypothesis_question (
           question_set_id, set_version, question_id, display_order,
           question_text, purpose, metrics, period, comparison,
           suggested_source_types, origin
         ) VALUES ($1, 1, $2, $3, $4, $5, $6, $7, $8, $9, 'agent')`,
        [
          questionSetId,
          uuidv7(),
          index + 1,
          question.text.trim(),
          question.purpose.trim(),
          JSON.stringify(question.metrics),
          question.period.trim(),
          question.comparison.trim(),
          JSON.stringify(question.sourceTypes),
        ],
      );
    }
    if (!obsolete) {
      if (row.current_question_set_id) {
        await client.query(
          `UPDATE hypothesis_question_set_version qsv
           SET status = 'obsolete'
           FROM hypothesis_question_set qs
           WHERE qs.question_set_id = $1
             AND qsv.question_set_id = qs.question_set_id
             AND qsv.version_no = qs.current_version`,
          [row.current_question_set_id],
        );
      }
      await client.query(
        `UPDATE project_hypothesis SET current_question_set_id = $2,
           updated_at = now() WHERE project_id = $1`,
        [row.project_id, questionSetId],
      );
    }
    await client.query(
      `UPDATE workflow_job
       SET operation_status = 'succeeded', validity_status = $2,
           current_phase = 'completed', progress_percent = 100,
           finished_at = now(), heartbeat_at = now(), retryable = false,
           result_summary_json = $3
       WHERE job_id = $1`,
      [
        jobId,
        obsolete ? "obsolete" : "current",
        JSON.stringify({ questionSetId, questionCount: questions.length }),
      ],
    );
    const started = new Date(result.metadata.startedAt).getTime();
    const finished = new Date(result.metadata.finishedAt).getTime();
    await client.query(
      `UPDATE hypothesis_generation
       SET provider_model = $2, input_tokens = $3, output_tokens = $4,
           latency_ms = $5, raw_artifact_id = $6, finished_at = now()
       WHERE job_id = $1`,
      [
        jobId,
        result.metadata.model,
        result.metadata.usage.inputTokens,
        result.metadata.usage.outputTokens,
        Number.isFinite(finished - started) ? Math.max(0, finished - started) : 0,
        rawArtifact?.artifactId ?? null,
      ],
    );
    await client.query(
      `INSERT INTO workflow_job_output (job_id, output_role, resource_version_id)
       VALUES ($1, 'hypothesis_questions', $2)`,
      [jobId, resourceVersionId],
    );
    await client.query(
      `INSERT INTO hypothesis_audit_event (
         audit_event_id, project_id, event_type, input_revision,
         question_set_id, question_set_version, metadata_json
       ) VALUES ($1, $2, $3, $4, $5, 1, $6)`,
      [
        uuidv7(),
        row.project_id,
        obsolete ? "generation_obsolete" : "generation_succeeded",
        row.input_revision,
        questionSetId,
        JSON.stringify({
          jobId,
          model: result.metadata.model,
          usage: result.metadata.usage,
        }),
      ],
    );
  });
}

async function mutableQuestionSet(
  client: TransactionClient,
  projectId: string,
  userId: string,
  questionSetId: string,
  expectedVersion: unknown,
): Promise<{
  context: ProjectContext;
  hypothesis: HypothesisRow;
  version: number;
  resourceId: string;
  resourceVersionId: string;
  generatedFromInputRevision: string;
  promptVersion: string | null;
  missingContext: string[];
  questions: HypothesisQuestion[];
}> {
  const context = await projectContext(client, projectId, userId, true);
  const hypothesis = await ensureHypothesis(client, context, userId);
  if (hypothesis.currentQuestionSetId !== questionSetId) {
    throw new ApiError(
      404,
      "QUESTION_SET_NOT_FOUND",
      "현재 질문 세트를 찾을 수 없습니다.",
    );
  }
  const expected = requireVersion(expectedVersion, "질문 세트");
  const result = await client.query<{
    current_version: string;
    resource_id: string;
    resource_version_id: string;
    generated_from_input_revision: string;
    prompt_version: string | null;
    missing_context: string[];
  }>(
    `SELECT qs.current_version, qs.resource_id, qsv.resource_version_id,
       qsv.generated_from_input_revision, qsv.prompt_version,
       qsv.missing_context
     FROM hypothesis_question_set qs
     JOIN hypothesis_question_set_version qsv
       ON qsv.question_set_id = qs.question_set_id
      AND qsv.version_no = qs.current_version
     WHERE qs.question_set_id = $1 AND qs.project_id = $2
     FOR UPDATE OF qs`,
    [questionSetId, projectId],
  );
  const row = result.rows[0];
  if (!row) {
    throw new ApiError(
      404,
      "QUESTION_SET_NOT_FOUND",
      "질문 세트를 찾을 수 없습니다.",
    );
  }
  const currentVersion = Number(row.current_version);
  if (currentVersion !== expected) {
    throw new ApiError(
      409,
      "VERSION_CONFLICT",
      "다른 탭에서 질문이 변경되었습니다.",
      { meta: { currentVersion } },
    );
  }
  const loaded = await loadQuestionSet(client, questionSetId);
  if (!loaded) {
    throw new ApiError(
      404,
      "QUESTION_SET_NOT_FOUND",
      "질문 세트를 찾을 수 없습니다.",
    );
  }
  return {
    context,
    hypothesis,
    version: currentVersion,
    resourceId: row.resource_id,
    resourceVersionId: row.resource_version_id,
    generatedFromInputRevision: row.generated_from_input_revision,
    promptVersion: row.prompt_version,
    missingContext: row.missing_context,
    questions: loaded.questions,
  };
}

function inferQuestionMetadata(
  text: string,
  context: ProjectContext,
): Omit<HypothesisQuestion, "questionId" | "order" | "text" | "origin"> {
  const companyMentioned =
    text.includes(context.companyName) || text.includes(context.ticker);
  const periodMatch = text.match(
    /(?:20\d{2}년?(?:\s*[1-4](?:분기|Q)|\s*(?:상반기|하반기))?|[1-4]Q\d{2})/,
  );
  const comparisonMatch = text.match(
    /(전년\s*동기|전분기|직전\s*분기|회사\s*계획|시장\s*(?:예상|전망|컨센서스)|과거\s*\d+년|업종\s*평균|경쟁사)/,
  );
  const metricMatches = Array.from(
    text.matchAll(
      /(매출|영업이익률?|순이익|ASP|평균\s*판매가격|판매량|출하량|수율|가동률|원가|비용|재고|수주|점유율|가격|마진|현금흐름)/g,
    ),
    (match) => match[0].replace(/\s+/g, " "),
  );
  const metrics = Array.from(new Set(metricMatches)).slice(0, 10);
  if (!companyMentioned || !periodMatch || !comparisonMatch || metrics.length === 0) {
    throw new ApiError(
      422,
      "QUESTION_METADATA_INVALID",
      "질문에 기업, 대상 기간, 비교 기준과 관찰 지표를 구체적으로 적어주세요.",
    );
  }
  const sourceTypes: SourceType[] = ["filing", "company"];
  if (/시장|업종|경쟁사|점유율/.test(text)) sourceTypes.push("industry");
  if (/주가|시가총액|밸류에이션/.test(text)) sourceTypes.push("market_data");
  if (/뉴스|이슈|사건/.test(text)) sourceTypes.push("news");
  return {
    purpose: `${metrics[0]} 변화 확인`,
    metrics,
    period: periodMatch[0],
    comparison: comparisonMatch[0],
    suggestedSourceTypes: Array.from(new Set(sourceTypes)),
  };
}

export function normalizeHypothesisQuestionText(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLocaleLowerCase("ko-KR");
}

async function createQuestionSetVersion(
  client: TransactionClient,
  input: {
    projectId: string;
    userId: string;
    questionSetId: string;
    currentVersion: number;
    resourceId: string;
    currentResourceVersionId: string;
    generatedFromInputRevision: string;
    promptVersion: string | null;
    missingContext: string[];
    questions: HypothesisQuestion[];
    eventType: string;
    requestId: string | null;
  },
): Promise<Awaited<ReturnType<typeof loadQuestionSet>>> {
  const nextVersion = input.currentVersion + 1;
  const resourceVersionId = uuidv7();
  const reindexed = input.questions.map((question, index) => ({
    ...question,
    order: index + 1,
  }));
  await client.query(
    `UPDATE resource_version SET lifecycle_status = 'superseded'
     WHERE resource_version_id = $1`,
    [input.currentResourceVersionId],
  );
  const reopened = await client.query(
    `UPDATE project_stage_state
     SET stage_status = 'in_progress', current_completion_id = NULL,
         completed_at = NULL, updated_at = now()
     WHERE project_id = $1 AND stage_key = 'hypothesis'
       AND stage_status = 'completed'
     RETURNING stage_key`,
    [input.projectId],
  );
  if (reopened.rows.length > 0) {
    await markDownstreamRevalidation(
      client,
      input.projectId,
      resourceVersionId,
    );
    await client.query(
      `UPDATE project SET current_stage = 'hypothesis',
         row_version = row_version + 1, updated_at = now()
       WHERE project_id = $1`,
      [input.projectId],
    );
  }
  await client.query(
    `INSERT INTO resource_version (
       resource_version_id, resource_id, version_no, lifecycle_status,
       supersedes_version_id, input_fingerprint, content_hash,
       created_by_user_id
     ) VALUES ($1, $2, $3, 'draft', $4, $5, $6, $7)`,
    [
      resourceVersionId,
      input.resourceId,
      nextVersion,
      input.currentResourceVersionId,
      contentHash({
        inputRevision: input.generatedFromInputRevision,
        promptVersion: input.promptVersion,
      }),
      contentHash(reindexed),
      input.userId,
    ],
  );
  await client.query(
    `INSERT INTO hypothesis_question_set_version (
       resource_version_id, question_set_id, version_no,
       generated_from_input_revision, status, prompt_version,
       missing_context, created_by_user_id, created_by_actor_type
     ) VALUES ($1, $2, $3, $4, 'draft', $5, $6, $7, 'user')`,
    [
      resourceVersionId,
      input.questionSetId,
      nextVersion,
      input.generatedFromInputRevision,
      input.promptVersion,
      JSON.stringify(input.missingContext),
      input.userId,
    ],
  );
  for (const question of reindexed) {
    await client.query(
      `INSERT INTO hypothesis_question (
         question_set_id, set_version, question_id, display_order,
         question_text, purpose, metrics, period, comparison,
         suggested_source_types, origin
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        input.questionSetId,
        nextVersion,
        question.questionId,
        question.order,
        question.text,
        question.purpose,
        JSON.stringify(question.metrics),
        question.period,
        question.comparison,
        JSON.stringify(question.suggestedSourceTypes),
        question.origin,
      ],
    );
  }
  await client.query(
    `UPDATE hypothesis_question_set SET current_version = $2
     WHERE question_set_id = $1`,
    [input.questionSetId, nextVersion],
  );
  await client.query(
    `INSERT INTO hypothesis_audit_event (
       audit_event_id, project_id, actor_user_id, event_type,
       input_revision, question_set_id, question_set_version,
       request_id
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      uuidv7(),
      input.projectId,
      input.userId,
      input.eventType,
      input.generatedFromInputRevision,
      input.questionSetId,
      nextVersion,
      input.requestId,
    ],
  );
  return loadQuestionSet(client, input.questionSetId);
}

export async function addHypothesisQuestion(input: {
  projectId: string;
  userId: string;
  questionSetId: string;
  expectedQuestionSetVersion: unknown;
  text: unknown;
  requestId?: unknown;
}): Promise<unknown> {
  const text = cleanText(input.text, 300, "QUESTION_TEXT_INVALID");
  return withTransaction(async (client) => {
    const current = await mutableQuestionSet(
      client,
      input.projectId,
      input.userId,
      input.questionSetId,
      input.expectedQuestionSetVersion,
    );
    if (current.questions.length >= 5) {
      throw new ApiError(
        422,
        "QUESTION_COUNT_INVALID",
        "질문은 최대 5개까지 추가할 수 있습니다.",
      );
    }
    if (
      current.questions.some(
        (question) =>
          normalizeHypothesisQuestionText(question.text) ===
          normalizeHypothesisQuestionText(text),
      )
    ) {
      throw new ApiError(
        422,
        "QUESTION_TEXT_INVALID",
        "같은 내용의 질문이 이미 있습니다.",
      );
    }
    const metadata = inferQuestionMetadata(text, current.context);
    const questionSet = await createQuestionSetVersion(client, {
      projectId: input.projectId,
      userId: input.userId,
      questionSetId: input.questionSetId,
      currentVersion: current.version,
      resourceId: current.resourceId,
      currentResourceVersionId: current.resourceVersionId,
      generatedFromInputRevision: current.generatedFromInputRevision,
      promptVersion: current.promptVersion,
      missingContext: current.missingContext,
      questions: [
        ...current.questions,
        {
          questionId: uuidv7(),
          order: current.questions.length + 1,
          text,
          origin: "user",
          ...metadata,
        },
      ],
      eventType: "question_added",
      requestId:
        typeof input.requestId === "string" ? input.requestId.slice(0, 128) : null,
    });
    return { questionSet };
  });
}

export async function updateHypothesisQuestion(input: {
  projectId: string;
  userId: string;
  questionSetId: string;
  questionId: string;
  expectedQuestionSetVersion: unknown;
  text: unknown;
  requestId?: unknown;
}): Promise<unknown> {
  const text = cleanText(input.text, 300, "QUESTION_TEXT_INVALID");
  return withTransaction(async (client) => {
    const current = await mutableQuestionSet(
      client,
      input.projectId,
      input.userId,
      input.questionSetId,
      input.expectedQuestionSetVersion,
    );
    if (!current.questions.some((question) => question.questionId === input.questionId)) {
      throw new ApiError(
        404,
        "QUESTION_NOT_FOUND",
        "수정할 질문을 찾을 수 없습니다.",
      );
    }
    if (
      current.questions.some(
        (question) =>
          question.questionId !== input.questionId &&
          normalizeHypothesisQuestionText(question.text) ===
          normalizeHypothesisQuestionText(text),
      )
    ) {
      throw new ApiError(
        422,
        "QUESTION_TEXT_INVALID",
        "같은 내용의 질문이 이미 있습니다.",
      );
    }
    const metadata = inferQuestionMetadata(text, current.context);
    const questionSet = await createQuestionSetVersion(client, {
      projectId: input.projectId,
      userId: input.userId,
      questionSetId: input.questionSetId,
      currentVersion: current.version,
      resourceId: current.resourceId,
      currentResourceVersionId: current.resourceVersionId,
      generatedFromInputRevision: current.generatedFromInputRevision,
      promptVersion: current.promptVersion,
      missingContext: current.missingContext,
      questions: current.questions.map((question) =>
        question.questionId === input.questionId
          ? { ...question, text, ...metadata }
          : question,
      ),
      eventType: "question_updated",
      requestId:
        typeof input.requestId === "string" ? input.requestId.slice(0, 128) : null,
    });
    return { questionSet };
  });
}

export async function deleteHypothesisQuestion(input: {
  projectId: string;
  userId: string;
  questionSetId: string;
  questionId: string;
  expectedQuestionSetVersion: unknown;
  requestId?: unknown;
}): Promise<unknown> {
  return withTransaction(async (client) => {
    const current = await mutableQuestionSet(
      client,
      input.projectId,
      input.userId,
      input.questionSetId,
      input.expectedQuestionSetVersion,
    );
    const questions = current.questions.filter(
      (question) => question.questionId !== input.questionId,
    );
    if (questions.length === current.questions.length) {
      throw new ApiError(
        404,
        "QUESTION_NOT_FOUND",
        "삭제할 질문을 찾을 수 없습니다.",
      );
    }
    const questionSet = await createQuestionSetVersion(client, {
      projectId: input.projectId,
      userId: input.userId,
      questionSetId: input.questionSetId,
      currentVersion: current.version,
      resourceId: current.resourceId,
      currentResourceVersionId: current.resourceVersionId,
      generatedFromInputRevision: current.generatedFromInputRevision,
      promptVersion: current.promptVersion,
      missingContext: current.missingContext,
      questions,
      eventType: "question_deleted",
      requestId:
        typeof input.requestId === "string" ? input.requestId.slice(0, 128) : null,
    });
    return { questionSet };
  });
}

export async function reorderHypothesisQuestions(input: {
  projectId: string;
  userId: string;
  questionSetId: string;
  expectedQuestionSetVersion: unknown;
  questionIds: unknown;
  requestId?: unknown;
}): Promise<unknown> {
  return withTransaction(async (client) => {
    const current = await mutableQuestionSet(
      client,
      input.projectId,
      input.userId,
      input.questionSetId,
      input.expectedQuestionSetVersion,
    );
    if (
      !Array.isArray(input.questionIds) ||
      input.questionIds.length !== current.questions.length ||
      new Set(input.questionIds).size !== input.questionIds.length ||
      input.questionIds.some(
        (id) =>
          typeof id !== "string" ||
          !current.questions.some((question) => question.questionId === id),
      )
    ) {
      throw new ApiError(
        422,
        "QUESTION_ORDER_INVALID",
        "질문 순서가 현재 목록과 일치하지 않습니다.",
      );
    }
    const byId = new Map(
      current.questions.map((question) => [question.questionId, question]),
    );
    const questionSet = await createQuestionSetVersion(client, {
      projectId: input.projectId,
      userId: input.userId,
      questionSetId: input.questionSetId,
      currentVersion: current.version,
      resourceId: current.resourceId,
      currentResourceVersionId: current.resourceVersionId,
      generatedFromInputRevision: current.generatedFromInputRevision,
      promptVersion: current.promptVersion,
      missingContext: current.missingContext,
      questions: (input.questionIds as string[]).map((id) => byId.get(id)!),
      eventType: "questions_reordered",
      requestId:
        typeof input.requestId === "string" ? input.requestId.slice(0, 128) : null,
    });
    return { questionSet };
  });
}

function validateQuestionSetForApproval(
  current: Awaited<ReturnType<typeof mutableQuestionSet>>,
  inputRevision: string,
): void {
  if (current.questions.length < 3 || current.questions.length > 5) {
    throw new ApiError(
      422,
      "QUESTION_COUNT_INVALID",
      "질문은 3개 이상 5개 이하여야 합니다.",
    );
  }
  if (
    current.generatedFromInputRevision !== inputRevision ||
    current.hypothesis.inputRevision !== inputRevision
  ) {
    throw new ApiError(
      409,
      "INPUT_REVISION_CHANGED",
      "현재 입력으로 질문을 다시 만든 뒤 승인해주세요.",
    );
  }
  const unique = new Set(
    current.questions.map((question) =>
      normalizeHypothesisQuestionText(question.text),
    ),
  );
  if (
    unique.size !== current.questions.length ||
    current.questions.some(
      (question) =>
        !question.purpose ||
        !question.period ||
        !question.comparison ||
        question.metrics.length === 0 ||
        question.suggestedSourceTypes.length === 0,
    )
  ) {
    throw new ApiError(
      422,
      "QUESTION_METADATA_INVALID",
      "모든 질문의 기업, 기간, 비교 기준과 관찰 지표를 확인해주세요.",
    );
  }
}

export async function approveHypothesisQuestionSet(input: {
  projectId: string;
  userId: string;
  questionSetId: string;
  idempotencyKey: string | null;
  expectedQuestionSetVersion: unknown;
  inputRevision: unknown;
  requestId?: unknown;
}): Promise<IdempotentResult> {
  const key = validateIdempotencyKey(input.idempotencyKey);
  const expectedVersion = requireVersion(
    input.expectedQuestionSetVersion,
    "질문 세트",
  );
  const inputRevision =
    typeof input.inputRevision === "string" ? input.inputRevision : "";
  const requestId =
    typeof input.requestId === "string" ? input.requestId.slice(0, 128) : "";
  const requestHash = contentHash({
    questionSetId: input.questionSetId,
    expectedVersion,
    inputRevision,
    requestId,
  });
  return withTransaction(async (client) => {
    const replay = await idempotentReplay(client, {
      userId: input.userId,
      operation: "hypothesis.approve",
      projectId: input.projectId,
      key,
      requestHash,
    });
    if (replay) return replay;
    const current = await mutableQuestionSet(
      client,
      input.projectId,
      input.userId,
      input.questionSetId,
      expectedVersion,
    );
    validateQuestionSetForApproval(current, inputRevision);
    await client.query(
      `UPDATE hypothesis_question_set_version
       SET status = 'approved'
       WHERE question_set_id = $1 AND version_no = $2`,
      [input.questionSetId, expectedVersion],
    );
    await client.query(
      `UPDATE resource_version SET lifecycle_status = 'approved'
       WHERE resource_version_id = $1`,
      [current.resourceVersionId],
    );
    const approvalId = uuidv7();
    await client.query(
      `INSERT INTO hypothesis_approval (
         approval_id, project_id, question_set_id, question_set_version,
         question_set_resource_version_id, input_revision, approved_by_user_id
       ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        approvalId,
        input.projectId,
        input.questionSetId,
        expectedVersion,
        current.resourceVersionId,
        inputRevision,
        input.userId,
      ],
    );
    const previous = await client.query<{
      stage_completion_id: string;
      completion_no: string;
    }>(
      `SELECT stage_completion_id, completion_no
       FROM stage_completion
       WHERE project_id = $1 AND stage_key = 'hypothesis'
       ORDER BY completion_no DESC LIMIT 1`,
      [input.projectId],
    );
    const completionId = uuidv7();
    await client.query(
      `INSERT INTO stage_completion (
         stage_completion_id, project_id, stage_key, completion_no,
         primary_version_id, supersedes_completion_id, completed_by_user_id
       ) VALUES ($1, $2, 'hypothesis', $3, $4, $5, $6)`,
      [
        completionId,
        input.projectId,
        Number(previous.rows[0]?.completion_no ?? 0) + 1,
        current.resourceVersionId,
        previous.rows[0]?.stage_completion_id ?? null,
        input.userId,
      ],
    );
    await client.query(
      `UPDATE project_stage_state
       SET stage_status = 'completed', current_completion_id = $2,
           blocker_codes = '{}', completed_at = now(), updated_at = now()
       WHERE project_id = $1 AND stage_key = 'hypothesis'`,
      [input.projectId, completionId],
    );
    await client.query(
      `UPDATE project_stage_state
       SET stage_status = 'in_progress', blocker_codes = '{}', updated_at = now()
       WHERE project_id = $1 AND stage_key = 'research_plan'
         AND stage_status IN ('blocked', 'not_started')`,
      [input.projectId],
    );
    await client.query(
      `UPDATE project
       SET current_stage = 'research_plan', row_version = row_version + 1,
           project_status = 'active', updated_at = now(), last_saved_at = now()
       WHERE project_id = $1`,
      [input.projectId],
    );
    await client.query(
      `INSERT INTO hypothesis_audit_event (
         audit_event_id, project_id, actor_user_id, event_type,
         input_revision, question_set_id, question_set_version, request_id
       ) VALUES ($1, $2, $3, 'question_set_approved', $4, $5, $6, $7)`,
      [
        uuidv7(),
        input.projectId,
        input.userId,
        inputRevision,
        input.questionSetId,
        expectedVersion,
        requestId,
      ],
    );
    const questionSet = await loadQuestionSet(client, input.questionSetId);
    const body = {
      questionSet,
      approvalId,
      nextRoute: processRoute(input.projectId, "research_plan"),
    };
    await storeIdempotency(client, {
      userId: input.userId,
      operation: "hypothesis.approve",
      projectId: input.projectId,
      key,
      requestHash,
      responseStatus: 200,
      response: body,
    });
    return { status: 200, body };
  });
}

export const hypothesisConstants = {
  agentProfileVersion: AGENT_PROFILE_VERSION,
  promptVersion: PROMPT_VERSION,
  outputSchemaVersion: OUTPUT_SCHEMA_VERSION,
  outputSchemaId: OUTPUT_SCHEMA_ID,
  configuredModel: CONFIGURED_MODEL,
  stages: STAGES,
};
