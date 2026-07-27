import { contentHash } from "../../domain/hash";
import { uuidv7 } from "../../domain/ids";
import {
  createValidatedValueSet,
  createWorkbookApplicationPlan,
  finalizeWorkbookApplicationPlan,
  mergeWorkbookApplicationCells,
  resolveWorkbookWriteDecision,
  validateWorkbookApplicationResult,
  workbookApplicationResultDisposition,
  type ValidatedValueSet,
  type ValidationTarget,
  type ValidationValueResult,
  type WorkbookApplicationCell,
  type WorkbookApplicationPlan,
  type WorkbookApplicationWorkerResult,
  type WorkbookInputBinding,
  type WorkbookPatchCommand,
  type WorkbookWriteDecisionAction,
} from "../../domain/workbook-application";
import { ApiError } from "../../http/api-error";
import type { TransactionClient } from "../database/transaction";
import { withTransaction } from "../database/transaction";
import { objectStoreBucket } from "../object-storage/s3";
import { recordResourceDependencies } from "../services/dependency-invalidator";
import {
  acquireProjectLineageLock,
  persistSourceSnapshot,
  pinWorkflowJobSourceSnapshot,
} from "../services/source-snapshot-service";
import { verifyUploadedObject } from "../object-storage/s3";
import { loadRequiredWorkbookOutputBindings } from "../services/workbook-output-bindings";

const XLSX_MEDIA_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

type IdempotentResult = { status: number; body: unknown };

type WorkbookAnalysisCell = {
  sheetId: string;
  sheetName: string;
  address: string;
  valueType: string;
  rawValue: unknown;
  displayValue?: string;
  formattedText?: string;
  formula: string | null;
  structureFingerprint?: string | null;
};

type WorkbookEditableCell = {
  sheetId: string;
  sheetName: string;
  address: string;
  classification?: string;
  valueType?: string;
  label?: string;
};

type ApplicationContext = {
  projectId: string;
  projectVersion: number;
  validationRunId: string;
  validationVersion: number;
  cutoffDate: string;
  workspaceStatus: string;
  approvedPlanResourceVersionId: string;
  sourceSnapshotId: string;
  sourceFingerprint: string;
  sourceWorkbookResourceVersionId: string;
  mappingSetResourceVersionId: string;
  structureHash: string;
  workbookAnalysis: {
    candidateCells?: WorkbookAnalysisCell[];
    editableCells?: WorkbookEditableCell[];
  };
  targets: ValidationTarget[];
  sourceWorkbookArtifactId: string;
  sourceWorkbookObjectKey: string;
  sourceWorkbookSha256: string;
  sourceWorkbookFilename: string;
};

export type ValidatedValuePreparation = {
  resourceVersionId: string;
  valueSet: ValidatedValueSet;
  context: ApplicationContext;
  plan: WorkbookApplicationPlan;
  outputBindings: Array<{
    metric: "forward_eps" | "target_per" | "target_price";
    sheetId: string;
    sheetName: string;
    address: string;
  }>;
};

export type WorkbookApplicationWorkerPayload = {
  result: WorkbookApplicationWorkerResult;
  artifact: {
    objectKey: string;
    objectVersion: string;
    sha256: string;
    byteSize: number;
    mediaType: string;
    originalFilename: string;
  };
};

type WorkbookWriteProposalDecisionRow = {
  decision_id: string;
  target_id: string;
  decision_no: string;
  action: WorkbookWriteDecisionAction;
  before_command_json: WorkbookPatchCommand;
  after_command_json: WorkbookPatchCommand | null;
  evidence_ids: string[];
  reason: string;
  decided_at: Date;
};

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
    throw new ApiError(
      400,
      "INVALID_VERSION",
      `${label} 버전이 올바르지 않습니다.`,
    );
  }
  return version;
}

function requireHash(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    throw new ApiError(
      400,
      "SOURCE_FINGERPRINT_MISMATCH",
      `${label} fingerprint가 올바르지 않습니다.`,
    );
  }
  return value;
}

async function replayIdempotency(
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
       AND idempotency_key = $4`,
    [
      input.userId,
      input.operation,
      input.projectId,
      input.key,
    ],
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
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb,
       now() + interval '24 hours')
     ON CONFLICT (user_id, operation, project_id, idempotency_key)
     DO NOTHING`,
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

function requireProposalAction(
  value: unknown,
): WorkbookWriteDecisionAction {
  if (
    value !== "approve" &&
    value !== "reject" &&
    value !== "modify"
  ) {
    throw new ApiError(
      422,
      "INVALID_WORKBOOK_WRITE_DECISION",
      "Workbook 반영 결정이 올바르지 않습니다.",
    );
  }
  return value;
}

function requireProposalReason(value: unknown): string {
  const reason = typeof value === "string" ? value.trim() : "";
  if (reason.length < 5 || reason.length > 1000) {
    throw new ApiError(
      422,
      "INVALID_WORKBOOK_WRITE_DECISION",
      "Workbook 반영 결정 사유를 5~1000자로 입력해주세요.",
    );
  }
  return reason;
}

async function latestProposalDecisions(
  client: TransactionClient,
  input: {
    projectId: string;
    validatedValueSetResourceVersionId: string;
    sourceWorkbookResourceVersionId: string;
    mappingSetResourceVersionId: string;
    sourceFingerprint: string;
  },
): Promise<Map<string, WorkbookWriteProposalDecisionRow>> {
  const result = await client.query<WorkbookWriteProposalDecisionRow>(
    `SELECT DISTINCT ON (target_id)
       decision_id, target_id, decision_no, action,
       before_command_json, after_command_json, evidence_ids,
       reason, decided_at
     FROM workbook_write_proposal_decision
     WHERE project_id = $1
       AND validated_value_set_resource_version_id = $2
       AND source_workbook_resource_version_id = $3
       AND mapping_set_resource_version_id = $4
       AND source_fingerprint = $5
     ORDER BY target_id, decision_no DESC`,
    [
      input.projectId,
      input.validatedValueSetResourceVersionId,
      input.sourceWorkbookResourceVersionId,
      input.mappingSetResourceVersionId,
      input.sourceFingerprint,
    ],
  );
  return new Map(result.rows.map((row) => [row.target_id, row]));
}

async function applicationContext(
  client: TransactionClient,
  projectId: string,
  userId: string,
  lock = false,
): Promise<ApplicationContext> {
  const result = await client.query<{
    project_id: string;
    row_version: string;
    validation_run_id: string;
    validation_version: string;
    cutoff_at: Date;
    workspace_status: string;
    approved_plan_resource_version_id: string;
    source_snapshot_id: string | null;
    source_fingerprint: string | null;
    workbook_resource_version_id: string;
    mapping_set_resource_version_id: string;
    structure_hash: string;
    analysis_json: ApplicationContext["workbookAnalysis"];
    plan_snapshot_json: { excelTargets?: ValidationTarget[] };
    artifact_id: string;
    object_key: string;
    sha256: string;
    original_filename: string | null;
  }>(
    `SELECT p.project_id, p.row_version, workspace.validation_run_id,
       workspace.validation_version, workspace.cutoff_at,
       workspace.workspace_status,
       workspace.approved_plan_resource_version_id,
       COALESCE(
         current_values.source_snapshot_id,
         research_job.source_snapshot_id
       ) AS source_snapshot_id,
       source_snapshot.fingerprint AS source_fingerprint,
       plan.workbook_resource_version_id,
       plan.mapping_set_resource_version_id,
       workbook.structure_hash, workbook.analysis_json,
       plan.plan_snapshot_json, artifact.artifact_id, artifact.object_key,
       artifact.sha256, artifact.original_filename
     FROM project p
     JOIN validation_workspace workspace
       ON workspace.project_id = p.project_id
     JOIN research_run research
       ON research.research_run_id = workspace.research_run_id
      AND research.approved_plan_resource_version_id =
          workspace.approved_plan_resource_version_id
     JOIN workflow_job research_job ON research_job.job_id = research.job_id
     LEFT JOIN validated_value_set_version current_values
       ON current_values.project_id = p.project_id
      AND current_values.validation_run_id = workspace.validation_run_id
      AND current_values.validation_version = workspace.validation_version
      AND current_values.status = 'approved'
     LEFT JOIN source_snapshot
       ON source_snapshot.source_snapshot_id = COALESCE(
         current_values.source_snapshot_id,
         research_job.source_snapshot_id
       )
      AND source_snapshot.project_id = p.project_id
     JOIN research_plan_version plan
       ON plan.resource_version_id =
          workspace.approved_plan_resource_version_id
     JOIN workbook_version workbook
       ON workbook.resource_version_id =
          plan.workbook_resource_version_id
     JOIN project_file_version source_file
       ON source_file.resource_version_id = workbook.source_file_version_id
     JOIN artifact ON artifact.artifact_id = source_file.artifact_id
     WHERE p.project_id = $1 AND p.owner_user_id = $2
       AND p.deleted_at IS NULL
     ${lock ? "FOR UPDATE OF p, workspace" : ""}`,
    [projectId, userId],
  );
  const row = result.rows[0];
  if (!row) {
    const owned = await client.query(
      `SELECT 1 FROM project
       WHERE project_id = $1 AND owner_user_id = $2 AND deleted_at IS NULL`,
      [projectId, userId],
    );
    if (!owned.rows[0]) {
      throw new ApiError(
        404,
        "PROJECT_NOT_FOUND",
        "프로젝트를 찾을 수 없습니다.",
      );
    }
    throw new ApiError(
      409,
      "VALIDATION_WORKSPACE_NOT_READY",
      "검증 Workbook을 아직 준비하지 못했습니다.",
    );
  }
  if (!row.source_snapshot_id || !row.source_fingerprint) {
    throw new ApiError(
      409,
      "SOURCE_SNAPSHOT_REQUIRED",
      "자료 수집 source snapshot을 확인할 수 없습니다.",
    );
  }
  return {
    projectId: row.project_id,
    projectVersion: Number(row.row_version),
    validationRunId: row.validation_run_id,
    validationVersion: Number(row.validation_version),
    cutoffDate: row.cutoff_at.toISOString().slice(0, 10),
    workspaceStatus: row.workspace_status,
    approvedPlanResourceVersionId: row.approved_plan_resource_version_id,
    sourceSnapshotId: row.source_snapshot_id,
    sourceFingerprint: row.source_fingerprint,
    sourceWorkbookResourceVersionId: row.workbook_resource_version_id,
    mappingSetResourceVersionId: row.mapping_set_resource_version_id,
    structureHash: row.structure_hash,
    workbookAnalysis: row.analysis_json,
    targets: row.plan_snapshot_json.excelTargets ?? [],
    sourceWorkbookArtifactId: row.artifact_id,
    sourceWorkbookObjectKey: row.object_key,
    sourceWorkbookSha256: row.sha256,
    sourceWorkbookFilename:
      row.original_filename ?? "검증_workbook.xlsx",
  };
}

function authoritySourceType(
  sourceType: string,
): ValidationValueResult["authoritySource"]["sourceType"] {
  if (sourceType === "DART") return "filing";
  if (sourceType === "COMPANY_IR") return "company";
  if (
    sourceType === "KRX" ||
    sourceType === "ECOS" ||
    sourceType === "FNGUIDE_CONSENSUS"
  ) {
    return "market_data";
  }
  return "user_decision";
}

async function validationValueResults(
  client: TransactionClient,
  context: ApplicationContext,
): Promise<{
  results: ValidationValueResult[];
  evidenceSourceVersionIds: string[];
}> {
  const result = await client.query<{
    result_id: string;
    target_id: string;
    machine_status: ValidationValueResult["machineStatus"];
    exception_status: string;
    value_original: string | null;
    value_normalized: string | null;
    unit: string | null;
    period: string | null;
    scope: string | null;
    value_kind: string | null;
    evidence_ids: string[];
    conflict_id: string | null;
    conflict_status: string | null;
    selected_evidence_id: string | null;
    authority_source_version_id: string | null;
    authority_source_type: string | null;
    conflict_reason: string | null;
  }>(
    `SELECT result.result_id, result.target_id, result.machine_status,
       result.exception_status, result.value_original,
       result.value_normalized, result.unit, result.period, result.scope,
       result.value_kind, result.evidence_ids, conflict.conflict_id,
       conflict.status AS conflict_status, conflict.selected_evidence_id,
       authority.source_version_id AS authority_source_version_id,
       authority.source_type AS authority_source_type,
       decision.reason AS conflict_reason
     FROM validation_result result
     LEFT JOIN validation_conflict conflict
       ON conflict.result_id = result.result_id
      AND conflict.validation_run_id = result.validation_run_id
      AND conflict.status <> 'superseded'
     LEFT JOIN LATERAL (
       SELECT evidence.source_version_id, source.source_type
       FROM evidence
       JOIN research_source_version source
         ON source.resource_version_id = evidence.source_version_id
       WHERE evidence.evidence_id = COALESCE(
         conflict.selected_evidence_id, result.evidence_ids[1]
       )
       LIMIT 1
     ) authority ON true
     LEFT JOIN LATERAL (
       SELECT validation_decision.reason
       FROM validation_decision
       WHERE validation_decision.project_id = result.project_id
         AND validation_decision.target_type = 'conflict'
         AND validation_decision.target_id = conflict.conflict_id
         AND validation_decision.action = 'SELECT_SOURCE'
       ORDER BY validation_decision.created_at DESC
       LIMIT 1
     ) decision ON true
     WHERE result.project_id = $1
       AND result.validation_run_id = $2
       AND result.category = 'excel'
       AND result.exception_status <> 'SUPERSEDED'
     ORDER BY result.target_id, result.validated_at DESC`,
    [context.projectId, context.validationRunId],
  );
  const results = result.rows.map((row): ValidationValueResult => {
    if (!row.target_id || !row.authority_source_version_id) {
      throw new ApiError(
        409,
        "VALIDATED_VALUE_INCOMPLETE",
        "Excel 검증 값의 권위 출처를 확인할 수 없습니다.",
      );
    }
    const selectedEvidenceIds = row.selected_evidence_id
      ? [row.selected_evidence_id]
      : row.evidence_ids;
    return {
      resultId: row.result_id,
      targetId: row.target_id,
      machineStatus: row.machine_status,
      exceptionStatus: row.exception_status,
      valueOriginal: row.value_original,
      valueNormalized: row.value_normalized,
      unit: row.unit,
      period: row.period,
      scope: row.scope,
      valueKind: row.value_kind,
      evidenceIds: selectedEvidenceIds,
      authoritySource: {
        sourceType: authoritySourceType(row.authority_source_type ?? ""),
        sourceId: row.authority_source_version_id,
      },
      conflictDecision: row.conflict_id
        ? {
            status:
              row.conflict_status === "resolved"
                ? "selected_authority"
                : "unresolved",
            reason:
              row.conflict_reason ??
              (row.conflict_status === "resolved"
                ? "선택한 권위 출처 사용"
                : "권위 출처 미선택"),
            discardedEvidenceIds: row.evidence_ids.filter(
              (evidenceId) => evidenceId !== row.selected_evidence_id,
            ),
          }
        : {
            status: "no_conflict",
            reason: "검증된 단일 권위 출처",
            discardedEvidenceIds: [],
      },
    };
  });
  const selectedEvidenceIds = [
    ...new Set(results.flatMap((item) => item.evidenceIds)),
  ];
  const evidenceSources = await client.query<{
    source_version_id: string;
  }>(
    `SELECT DISTINCT source_version_id
     FROM evidence
     WHERE project_id = $1
       AND evidence_id = ANY($2::uuid[])
     ORDER BY source_version_id`,
    [
      context.projectId,
      selectedEvidenceIds,
    ],
  );
  return {
    results,
    evidenceSourceVersionIds: evidenceSources.rows.map(
      (row) => row.source_version_id,
    ),
  };
}

async function persistValidationSourceSnapshot(
  client: TransactionClient,
  context: ApplicationContext,
  evidenceSourceVersionIds: string[],
): Promise<{ sourceSnapshotId: string; sourceFingerprint: string }> {
  const roleVersions = [
    {
      key: "approved_research_plan",
      versionId: context.approvedPlanResourceVersionId,
    },
    {
      key: "source_workbook",
      versionId: context.sourceWorkbookResourceVersionId,
    },
    {
      key: "mapping_set",
      versionId: context.mappingSetResourceVersionId,
    },
    ...evidenceSourceVersionIds.map((versionId, index) => ({
      key: `evidence_source:${String(index + 1).padStart(4, "0")}`,
      versionId,
    })),
  ];
  const versionIds = [
    ...new Set(roleVersions.map((component) => component.versionId)),
  ];
  const result = await client.query<{
    resource_version_id: string;
    content_hash: string;
    artifact_id: string | null;
  }>(
    `SELECT version.resource_version_id, version.content_hash,
       MIN(resource_artifact.artifact_id::text) AS artifact_id
     FROM resource_version version
     JOIN versioned_resource resource
       ON resource.resource_id = version.resource_id
     LEFT JOIN resource_artifact
       ON resource_artifact.resource_version_id =
          version.resource_version_id
     WHERE resource.project_id = $1
       AND version.resource_version_id = ANY($2::uuid[])
     GROUP BY version.resource_version_id, version.content_hash`,
    [context.projectId, versionIds],
  );
  const resources = new Map(
    result.rows.map((row) => [row.resource_version_id, row]),
  );
  if (resources.size !== versionIds.length) {
    throw new ApiError(
      409,
      "SOURCE_SNAPSHOT_REQUIRED",
      "검증 Workbook source version을 모두 고정하지 못했습니다.",
    );
  }
  const snapshot = await persistSourceSnapshot(client, {
    projectId: context.projectId,
    scope: "validation_workbook",
    schemaVersion: "1",
    components: roleVersions.map((component) => {
      const resource = resources.get(component.versionId);
      if (!resource) {
        throw new ApiError(
          409,
          "SOURCE_SNAPSHOT_REQUIRED",
          "검증 Workbook source version을 찾을 수 없습니다.",
        );
      }
      return {
        key: component.key,
        versionId: component.versionId,
        artifactId: resource.artifact_id,
        contentHash: resource.content_hash,
      };
    }),
  });
  return {
    sourceSnapshotId: snapshot.sourceSnapshotId,
    sourceFingerprint: snapshot.fingerprint,
  };
}

function valueSetRow(
  row:
    | {
        resource_version_id: string;
        value_set_json: ValidatedValueSet;
      }
    | undefined,
): { resourceVersionId: string; valueSet: ValidatedValueSet } | null {
  return row
    ? {
        resourceVersionId: row.resource_version_id,
        valueSet: row.value_set_json,
      }
    : null;
}

async function findValidatedValueSet(
  client: TransactionClient,
  context: ApplicationContext,
): Promise<{
  resourceVersionId: string;
  valueSet: ValidatedValueSet;
} | null> {
  const existing = await client.query<{
    resource_version_id: string;
    value_set_json: ValidatedValueSet;
  }>(
    `SELECT value_set.resource_version_id, value_set.value_set_json
     FROM validated_value_set_version value_set
     JOIN resource_version version
       ON version.resource_version_id = value_set.resource_version_id
      AND version.validity_status = 'current'
     WHERE value_set.project_id = $1
       AND value_set.validation_run_id = $2
       AND value_set.validation_version = $3
       AND value_set.approved_plan_resource_version_id = $4
       AND value_set.status = 'approved'`,
    [
      context.projectId,
      context.validationRunId,
      context.validationVersion,
      context.approvedPlanResourceVersionId,
    ],
  );
  return valueSetRow(existing.rows[0]);
}

async function ensureValidatedValueSet(
  client: TransactionClient,
  context: ApplicationContext,
  userId: string,
): Promise<{
  resourceVersionId: string;
  valueSet: ValidatedValueSet;
}> {
  if (
    context.workspaceStatus !== "REVIEW_READY" &&
    context.workspaceStatus !== "APPROVED"
  ) {
    throw new ApiError(
      409,
      "VALIDATED_VALUE_SET_NOT_APPROVED",
      "검증 차단 항목을 해결한 뒤 Workbook 반영을 준비해주세요.",
    );
  }
  await client.query(
    `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
    [`validated-value-set:${context.projectId}`],
  );
  const current = await findValidatedValueSet(client, context);
  if (current) return current;

  const sourceValues = await validationValueResults(client, context);
  const validationSnapshot = await persistValidationSourceSnapshot(
    client,
    context,
    sourceValues.evidenceSourceVersionIds,
  );
  const valueSetResourceId = uuidv7();
  const valueSetResourceVersionId = uuidv7();
  const valueSet = createValidatedValueSet({
    validatedValueSetId: valueSetResourceVersionId,
    validationVersion: context.validationVersion,
    sourceSnapshotId: validationSnapshot.sourceSnapshotId,
    sourceFingerprint: validationSnapshot.sourceFingerprint,
    cutoffDate: context.cutoffDate,
    targets: context.targets,
    results: sourceValues.results,
  });
  await client.query(
    `INSERT INTO versioned_resource (
       resource_id, project_id, resource_kind, resource_key
     ) VALUES ($1, $2, 'validated_value_set', $3)`,
    [
      valueSetResourceId,
      context.projectId,
      `validation:${context.validationRunId}:${context.validationVersion}`,
    ],
  );
  await client.query(
    `INSERT INTO resource_version (
       resource_version_id, resource_id, version_no, lifecycle_status,
       validity_status, schema_version, input_fingerprint, content_hash,
       created_by_user_id, created_by_actor_type
     ) VALUES ($1, $2, 1, 'approved', 'current', '1.0', $3, $4, $5, 'user')`,
    [
      valueSetResourceVersionId,
      valueSetResourceId,
      validationSnapshot.sourceFingerprint,
      valueSet.contentHash,
      userId,
    ],
  );
  await client.query(
    `INSERT INTO validated_value_set_version (
       resource_version_id, project_id, validation_run_id,
       validation_version, approved_plan_resource_version_id,
       source_snapshot_id, source_fingerprint, status, value_set_json,
       content_hash, approved_by_user_id
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'approved', $8::jsonb, $9, $10)`,
    [
      valueSetResourceVersionId,
      context.projectId,
      context.validationRunId,
      context.validationVersion,
      context.approvedPlanResourceVersionId,
      validationSnapshot.sourceSnapshotId,
      validationSnapshot.sourceFingerprint,
      JSON.stringify(valueSet),
      valueSet.contentHash,
      userId,
    ],
  );
  await recordResourceDependencies(client, {
    projectId: context.projectId,
    dependencies: [
      {
        upstreamResourceVersionId:
          context.approvedPlanResourceVersionId,
        downstreamResourceVersionId: valueSetResourceVersionId,
        dependencyKind: "validation_plan_to_validated_values",
      },
      ...sourceValues.evidenceSourceVersionIds.map((sourceVersionId) => ({
        upstreamResourceVersionId: sourceVersionId,
        downstreamResourceVersionId: valueSetResourceVersionId,
        dependencyKind: "evidence_to_validated_values",
      })),
    ],
  });
  return { resourceVersionId: valueSetResourceVersionId, valueSet };
}

function canonicalCellValue(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  return String(value);
}

function buildPlan(
  context: ApplicationContext,
  valueSet: ValidatedValueSet,
  applicationId: string,
): WorkbookApplicationPlan {
  const editableCells = context.workbookAnalysis.editableCells ?? [];
  const candidates = context.workbookAnalysis.candidateCells ?? [];
  const editableKeys = new Set(
    editableCells.map(
      (cell) => `${cell.sheetId}:${cell.address.toUpperCase()}`,
    ),
  );
  const systemWritableKeys = new Set(
    context.targets
      .filter(
        (target) =>
          target.writeAuthority === "system" &&
          target.sheetId &&
          target.address,
      )
      .map(
        (target) =>
          `${target.sheetId}:${target.address!.toUpperCase()}`,
      ),
  );
  const cells = mergeWorkbookApplicationCells(
    editableCells.map((cell): WorkbookApplicationCell => ({
      sheetId: cell.sheetId,
      sheetName: cell.sheetName,
      address: cell.address,
      valueType: cell.valueType ?? "blank",
      rawValue: null,
      formattedText: "",
      formula: null,
      editable: true,
      structureFingerprint: null,
    })),
    candidates.map((cell): WorkbookApplicationCell => ({
      sheetId: cell.sheetId,
      sheetName: cell.sheetName,
      address: cell.address,
      valueType: cell.valueType,
      rawValue: canonicalCellValue(cell.rawValue),
      formattedText:
        cell.formattedText ??
        cell.displayValue ??
        canonicalCellValue(cell.rawValue) ??
        "",
      formula: cell.formula,
      editable:
        !cell.formula &&
        cell.valueType !== "formula" &&
        (editableKeys.has(`${cell.sheetId}:${cell.address.toUpperCase()}`) ||
          systemWritableKeys.has(
            `${cell.sheetId}:${cell.address.toUpperCase()}`,
          )),
      structureFingerprint: cell.structureFingerprint ?? null,
    })),
  );
  const bindings: WorkbookInputBinding[] = context.targets.flatMap(
    (target) => {
      if (!target.sheetId || !target.sheetName || !target.address) return [];
      const targetAddress = target.address.toUpperCase();
      const key = `${target.sheetId}:${targetAddress}`;
      if (!editableKeys.has(key) && !systemWritableKeys.has(key)) return [];
      const cell = cells.find(
        (candidate) =>
          candidate.sheetId === target.sheetId &&
          candidate.address === targetAddress,
      );
      if (cell?.formula || cell?.valueType === "formula") return [];
      return [
        {
          targetId: target.targetId,
          purpose: "workbook_input" as const,
          sheetId: target.sheetId,
          sheetName: target.sheetName,
          address: targetAddress,
          expectedStructureFingerprint:
            cell?.structureFingerprint ?? null,
        },
      ];
    },
  );
  return createWorkbookApplicationPlan({
    applicationId,
    sourceSnapshotId: context.sourceSnapshotId,
    sourceFingerprint: context.sourceFingerprint,
    sourceWorkbookResourceVersionId:
      context.sourceWorkbookResourceVersionId,
    sourceWorkbookArtifactId: context.sourceWorkbookArtifactId,
    inputWorkbookVersion: 1,
    structureHash: context.structureHash,
    validatedValueSet: valueSet,
    bindings,
    cells,
    bridgeFallback: true,
  });
}

async function outputBindings(
  client: TransactionClient,
  context: ApplicationContext,
  plan: WorkbookApplicationPlan,
): Promise<ValidatedValuePreparation["outputBindings"]> {
  const bindings = await loadRequiredWorkbookOutputBindings(
    client,
    context.mappingSetResourceVersionId,
  );
  if (bindings.length !== 3) {
    throw new ApiError(
      409,
      "WORKBOOK_REQUIRED_OUTPUT_MISSING",
      "EPS·PER·목표주가 mapping을 모두 확인해주세요.",
    );
  }
  const commandByTarget = new Map(
    plan.commands.map((command) => [command.targetId, command]),
  );
  return bindings.map((binding) => {
    const command = commandByTarget.get(binding.targetId);
    return command?.generatedBridge
      ? {
          metric: binding.metric,
          sheetId: "_REFLO_BRIDGE",
          sheetName: "_REFLO_BRIDGE",
          address: command.address,
        }
      : {
          metric: binding.metric,
          sheetId: binding.sheetId,
          sheetName: binding.sheetName,
          address: binding.address,
        };
  });
}

export async function prepareValidatedWorkbook(
  client: TransactionClient,
  input: {
    projectId: string;
    userId: string;
    applicationId?: string;
  },
): Promise<ValidatedValuePreparation> {
  const context = await applicationContext(
    client,
    input.projectId,
    input.userId,
  );
  const valueSet = await ensureValidatedValueSet(
    client,
    context,
    input.userId,
  );
  const effectiveContext: ApplicationContext = {
    ...context,
    sourceSnapshotId: valueSet.valueSet.sourceSnapshotId,
    sourceFingerprint: valueSet.valueSet.sourceFingerprint,
  };
  const plan = buildPlan(
    effectiveContext,
    valueSet.valueSet,
    input.applicationId ?? uuidv7(),
  );
  return {
    ...valueSet,
    context: effectiveContext,
    plan,
    outputBindings: await outputBindings(client, effectiveContext, plan),
  };
}

export async function readPreparedValidatedWorkbook(
  client: TransactionClient,
  input: {
    projectId: string;
    userId: string;
    applicationId?: string;
  },
): Promise<ValidatedValuePreparation | null> {
  const context = await applicationContext(
    client,
    input.projectId,
    input.userId,
  );
  const valueSet = await findValidatedValueSet(client, context);
  if (!valueSet) return null;
  const effectiveContext: ApplicationContext = {
    ...context,
    sourceSnapshotId: valueSet.valueSet.sourceSnapshotId,
    sourceFingerprint: valueSet.valueSet.sourceFingerprint,
  };
  const plan = buildPlan(
    effectiveContext,
    valueSet.valueSet,
    input.applicationId ?? uuidv7(),
  );
  return {
    ...valueSet,
    context: effectiveContext,
    plan,
    outputBindings: await outputBindings(client, effectiveContext, plan),
  };
}

export async function getWorkbookWriteProposals(input: {
  projectId: string;
  userId: string;
}): Promise<unknown> {
  return withTransaction(async (client) => {
    const preparation = await readPreparedValidatedWorkbook(client, {
      projectId: input.projectId,
      userId: input.userId,
    });
    if (!preparation) {
      throw new ApiError(
        409,
        "VALIDATED_VALUE_SET_PREPARATION_REQUIRED",
        "Workbook 반영 제안을 먼저 준비해주세요.",
      );
    }
    const { context, plan } = preparation;
    const decisions = await latestProposalDecisions(client, {
      projectId: input.projectId,
      validatedValueSetResourceVersionId:
        preparation.resourceVersionId,
      sourceWorkbookResourceVersionId:
        context.sourceWorkbookResourceVersionId,
      mappingSetResourceVersionId:
        context.mappingSetResourceVersionId,
      sourceFingerprint: context.sourceFingerprint,
    });
    const targetById = new Map(
      context.targets.map((target) => [target.targetId, target]),
    );
    const proposals = plan.commands.map((command) => {
      const decision = decisions.get(command.targetId);
      const target = targetById.get(command.targetId);
      return {
        proposalId: command.targetId,
        targetId: command.targetId,
        sheetId: command.sheetId,
        sheetName: command.sheetName,
        address: command.address,
        beforeValue: command.beforeValue,
        afterValue: command.afterValue,
        valueType: command.valueType,
        evidenceIds: command.evidenceIds,
        generatedBridge: command.generatedBridge,
        required: target?.required ?? true,
        decision: decision
          ? {
              decisionId: decision.decision_id,
              decisionNo: Number(decision.decision_no),
              action: decision.action,
              reason: decision.reason,
              proposedAfterValue:
                decision.after_command_json?.afterValue ?? null,
              decidedAt: decision.decided_at.toISOString(),
            }
          : null,
        status: decision?.action ?? "proposed",
      };
    });
    return {
      validatedValueSetVersionId: preparation.resourceVersionId,
      expectedWorkbookVersion: plan.inputWorkbookVersion,
      expectedProjectVersion: context.projectVersion,
      sourceSnapshotId: context.sourceSnapshotId,
      sourceFingerprint: context.sourceFingerprint,
      structureHash: context.structureHash,
      planHash: plan.planHash,
      reviewStatus: proposals.some(
        (proposal) => proposal.required && proposal.status === "reject",
      )
        ? "rejected"
        : proposals.length > 0 &&
            proposals.every((proposal) => proposal.status !== "proposed")
          ? "approved"
          : "proposed",
      proposals,
      blockers: plan.blocked,
    };
  });
}

export async function prepareWorkbookWriteProposals(input: {
  projectId: string;
  userId: string;
}): Promise<unknown> {
  return withTransaction(async (client) => {
    await prepareValidatedWorkbook(client, input);
    const preparation = await readPreparedValidatedWorkbook(client, input);
    if (!preparation) {
      throw new ApiError(
        409,
        "VALIDATED_VALUE_SET_PREPARATION_REQUIRED",
        "Workbook 반영 제안을 준비하지 못했습니다.",
      );
    }
    const { context, plan } = preparation;
    const decisions = await latestProposalDecisions(client, {
      projectId: input.projectId,
      validatedValueSetResourceVersionId: preparation.resourceVersionId,
      sourceWorkbookResourceVersionId:
        context.sourceWorkbookResourceVersionId,
      mappingSetResourceVersionId: context.mappingSetResourceVersionId,
      sourceFingerprint: context.sourceFingerprint,
    });
    const targetById = new Map(
      context.targets.map((target) => [target.targetId, target]),
    );
    const proposals = plan.commands.map((command) => ({
      proposalId: command.targetId,
      targetId: command.targetId,
      sheetId: command.sheetId,
      sheetName: command.sheetName,
      address: command.address,
      beforeValue: command.beforeValue,
      afterValue: command.afterValue,
      valueType: command.valueType,
      evidenceIds: command.evidenceIds,
      generatedBridge: command.generatedBridge,
      required: targetById.get(command.targetId)?.required ?? true,
      status: decisions.get(command.targetId)?.action ?? "proposed",
    }));
    return {
      validatedValueSetVersionId: preparation.resourceVersionId,
      expectedWorkbookVersion: plan.inputWorkbookVersion,
      expectedProjectVersion: context.projectVersion,
      sourceSnapshotId: context.sourceSnapshotId,
      sourceFingerprint: context.sourceFingerprint,
      structureHash: context.structureHash,
      planHash: plan.planHash,
      reviewStatus: proposals.some(
        (proposal) => proposal.required && proposal.status === "reject",
      )
        ? "rejected"
        : proposals.length > 0 &&
            proposals.every((proposal) => proposal.status !== "proposed")
          ? "approved"
          : "proposed",
      proposals,
      blockers: plan.blocked,
    };
  });
}

export async function decideWorkbookWriteProposal(input: {
  projectId: string;
  userId: string;
  proposalId: string;
  idempotencyKey: string | null;
  validatedValueSetVersionId: unknown;
  expectedWorkbookVersion: unknown;
  expectedProjectVersion: unknown;
  sourceSnapshotId: unknown;
  sourceFingerprint: unknown;
  action: unknown;
  proposedAfterValue: unknown;
  reason: unknown;
}): Promise<IdempotentResult> {
  const key = requireIdempotencyKey(input.idempotencyKey);
  const expectedWorkbookVersion = requireVersion(
    input.expectedWorkbookVersion,
    "Workbook",
  );
  const expectedProjectVersion = requireVersion(
    input.expectedProjectVersion,
    "프로젝트",
  );
  const action = requireProposalAction(input.action);
  const reason = requireProposalReason(input.reason);
  if (
    typeof input.validatedValueSetVersionId !== "string" ||
    typeof input.sourceSnapshotId !== "string"
  ) {
    throw new ApiError(
      400,
      "VALIDATED_VALUE_SET_NOT_APPROVED",
      "검증 값 집합을 다시 준비해주세요.",
    );
  }
  if (
    input.proposedAfterValue !== undefined &&
    input.proposedAfterValue !== null &&
    typeof input.proposedAfterValue !== "string"
  ) {
    throw new ApiError(
      422,
      "INVALID_WORKBOOK_WRITE_DECISION",
      "Workbook 반영 값 형식이 올바르지 않습니다.",
    );
  }
  const sourceFingerprint = requireHash(
    input.sourceFingerprint,
    "source",
  );
  const requestHash = contentHash({
    proposalId: input.proposalId,
    validatedValueSetVersionId: input.validatedValueSetVersionId,
    expectedWorkbookVersion,
    expectedProjectVersion,
    sourceSnapshotId: input.sourceSnapshotId,
    sourceFingerprint,
    action,
    proposedAfterValue: input.proposedAfterValue ?? null,
    reason,
  });
  return withTransaction(async (client) => {
    const replay = await replayIdempotency(client, {
      userId: input.userId,
      operation: "validation.workbook_write_proposal.decision",
      projectId: input.projectId,
      key,
      requestHash,
    });
    if (replay) return replay;
    await client.query(
      `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
      [`workbook-application:${input.projectId}`],
    );
    const lockedReplay = await replayIdempotency(client, {
      userId: input.userId,
      operation: "validation.workbook_write_proposal.decision",
      projectId: input.projectId,
      key,
      requestHash,
    });
    if (lockedReplay) return lockedReplay;
    const context = await applicationContext(
      client,
      input.projectId,
      input.userId,
      true,
    );
    const preparation = await prepareValidatedWorkbook(client, {
      projectId: input.projectId,
      userId: input.userId,
    });
    if (
      context.projectVersion !== expectedProjectVersion ||
      expectedWorkbookVersion !== preparation.plan.inputWorkbookVersion
    ) {
      throw new ApiError(
        409,
        "WORKBOOK_VERSION_MISMATCH",
        "최신 검증 Workbook을 다시 불러와주세요.",
      );
    }
    if (
      context.sourceSnapshotId !== input.sourceSnapshotId ||
      context.sourceFingerprint !== sourceFingerprint
    ) {
      throw new ApiError(
        409,
        "SOURCE_FINGERPRINT_MISMATCH",
        "검증 입력이 변경되었습니다. 최신 결과를 다시 불러와주세요.",
      );
    }
    if (
      preparation.resourceVersionId !==
      input.validatedValueSetVersionId
    ) {
      throw new ApiError(
        409,
        "VALIDATED_VALUE_SET_NOT_APPROVED",
        "최신 승인 값 집합을 다시 불러와주세요.",
      );
    }
    const command = preparation.plan.commands.find(
      (candidate) => candidate.targetId === input.proposalId,
    );
    if (!command) {
      throw new ApiError(
        404,
        "WORKBOOK_WRITE_PROPOSAL_NOT_FOUND",
        "Workbook 반영 제안을 찾을 수 없습니다.",
      );
    }
    const started = await client.query(
      `SELECT 1
       FROM workbook_application_run
       WHERE project_id = $1
         AND validated_value_set_resource_version_id = $2
         AND source_workbook_resource_version_id = $3
         AND mapping_set_resource_version_id = $4
         AND source_fingerprint = $5
         AND application_status IN ('queued', 'running', 'succeeded')
       LIMIT 1`,
      [
        input.projectId,
        preparation.resourceVersionId,
        context.sourceWorkbookResourceVersionId,
        context.mappingSetResourceVersionId,
        context.sourceFingerprint,
      ],
    );
    if (started.rows[0]) {
      throw new ApiError(
        409,
        "WORKBOOK_APPLICATION_ALREADY_STARTED",
        "이미 반영을 시작한 제안은 새 검증 버전에서 변경해주세요.",
      );
    }
    const resolved = resolveWorkbookWriteDecision(command, {
      action,
      proposedAfterValue:
        typeof input.proposedAfterValue === "string" ||
        input.proposedAfterValue === null
          ? input.proposedAfterValue
          : undefined,
    });
    const previous = await client.query<{
      decision_id: string;
      decision_no: string;
    }>(
      `SELECT decision_id, decision_no
       FROM workbook_write_proposal_decision
       WHERE project_id = $1
         AND validated_value_set_resource_version_id = $2
         AND source_workbook_resource_version_id = $3
         AND mapping_set_resource_version_id = $4
         AND source_fingerprint = $5
         AND target_id = $6
       ORDER BY decision_no DESC
       LIMIT 1`,
      [
        input.projectId,
        preparation.resourceVersionId,
        context.sourceWorkbookResourceVersionId,
        context.mappingSetResourceVersionId,
        context.sourceFingerprint,
        command.targetId,
      ],
    );
    const decisionId = uuidv7();
    const decisionNo = Number(previous.rows[0]?.decision_no ?? 0) + 1;
    await client.query(
      `INSERT INTO workbook_write_proposal_decision (
         decision_id, project_id,
         validated_value_set_resource_version_id,
         source_workbook_resource_version_id,
         mapping_set_resource_version_id, source_snapshot_id,
         source_fingerprint, target_id, decision_no, action,
         before_command_json, after_command_json, evidence_ids, reason,
         supersedes_decision_id, decided_by_user_id
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
         $11::jsonb, $12::jsonb, $13::uuid[], $14, $15, $16)`,
      [
        decisionId,
        input.projectId,
        preparation.resourceVersionId,
        context.sourceWorkbookResourceVersionId,
        context.mappingSetResourceVersionId,
        context.sourceSnapshotId,
        context.sourceFingerprint,
        command.targetId,
        decisionNo,
        resolved.action,
        JSON.stringify(command),
        resolved.effectiveCommand
          ? JSON.stringify(resolved.effectiveCommand)
          : null,
        command.evidenceIds,
        reason,
        previous.rows[0]?.decision_id ?? null,
        input.userId,
      ],
    );
    const body = {
      decisionId,
      proposalId: command.targetId,
      decisionNo,
      action: resolved.action,
      status: resolved.action,
    };
    await storeIdempotency(client, {
      userId: input.userId,
      operation: "validation.workbook_write_proposal.decision",
      projectId: input.projectId,
      key,
      requestHash,
      status: 200,
      body,
    });
    return { status: 200, body };
  });
}

export async function createValidationWorkbookApplication(input: {
  projectId: string;
  userId: string;
  idempotencyKey: string | null;
  validatedValueSetVersionId: unknown;
  expectedWorkbookVersion: unknown;
  expectedProjectVersion: unknown;
  sourceSnapshotId: unknown;
  sourceFingerprint: unknown;
}): Promise<IdempotentResult> {
  const key = requireIdempotencyKey(input.idempotencyKey);
  const expectedWorkbookVersion = requireVersion(
    input.expectedWorkbookVersion,
    "Workbook",
  );
  const expectedProjectVersion = requireVersion(
    input.expectedProjectVersion,
    "프로젝트",
  );
  if (
    typeof input.validatedValueSetVersionId !== "string" ||
    typeof input.sourceSnapshotId !== "string"
  ) {
    throw new ApiError(
      400,
      "VALIDATED_VALUE_SET_NOT_APPROVED",
      "검증 값 집합을 다시 준비해주세요.",
    );
  }
  const sourceFingerprint = requireHash(
    input.sourceFingerprint,
    "source",
  );
  const requestHash = contentHash({
    validatedValueSetVersionId: input.validatedValueSetVersionId,
    expectedWorkbookVersion,
    expectedProjectVersion,
    sourceSnapshotId: input.sourceSnapshotId,
    sourceFingerprint,
  });
  return withTransaction(async (client) => {
    const replay = await replayIdempotency(client, {
      userId: input.userId,
      operation: "validation.workbook_application.create",
      projectId: input.projectId,
      key,
      requestHash,
    });
    if (replay) return replay;
    await client.query(
      `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
      [`workbook-application:${input.projectId}`],
    );
    const lockedReplay = await replayIdempotency(client, {
      userId: input.userId,
      operation: "validation.workbook_application.create",
      projectId: input.projectId,
      key,
      requestHash,
    });
    if (lockedReplay) return lockedReplay;
    const context = await applicationContext(
      client,
      input.projectId,
      input.userId,
      true,
    );
    if (
      context.projectVersion !== expectedProjectVersion ||
      expectedWorkbookVersion !== 1
    ) {
      throw new ApiError(
        409,
        "WORKBOOK_VERSION_MISMATCH",
        "최신 검증 Workbook을 다시 불러와주세요.",
      );
    }
    if (
      context.sourceSnapshotId !== input.sourceSnapshotId ||
      context.sourceFingerprint !== sourceFingerprint
    ) {
      throw new ApiError(
        409,
        "SOURCE_FINGERPRINT_MISMATCH",
        "검증 입력이 변경되었습니다. 최신 결과를 다시 불러와주세요.",
      );
    }
    const applicationId = uuidv7();
    const preparation = await prepareValidatedWorkbook(client, {
      projectId: input.projectId,
      userId: input.userId,
      applicationId,
    });
    if (
      preparation.resourceVersionId !==
      input.validatedValueSetVersionId
    ) {
      throw new ApiError(
        409,
        "VALIDATED_VALUE_SET_NOT_APPROVED",
        "최신 승인 값 집합을 다시 불러와주세요.",
      );
    }
    if (preparation.plan.blocked.length > 0) {
      throw new ApiError(
        409,
        "WORKBOOK_APPLICATION_BLOCKED",
        "Workbook에 안전하게 반영할 수 없는 값이 있습니다.",
        {
          details: preparation.plan.blocked.map((blocker) => ({
            path: blocker.targetId,
            code: blocker.reasonCode,
            message: "Workbook 입력 위치를 다시 확인해주세요.",
          })),
        },
      );
    }
    const existing = await client.query<{
      workbook_application_id: string;
      job_id: string;
      application_status: string;
    }>(
      `SELECT workbook_application_id, job_id, application_status
       FROM workbook_application_run
       WHERE project_id = $1
         AND validated_value_set_resource_version_id = $2
         AND source_workbook_resource_version_id = $3
         AND mapping_set_resource_version_id = $4
         AND source_fingerprint = $5
         AND application_status IN ('queued', 'running', 'succeeded')
       ORDER BY requested_at DESC LIMIT 1`,
      [
        input.projectId,
        preparation.resourceVersionId,
        context.sourceWorkbookResourceVersionId,
        context.mappingSetResourceVersionId,
        context.sourceFingerprint,
      ],
    );
    if (existing.rows[0]) {
      const current = existing.rows[0];
      const body = {
        taskId: current.workbook_application_id,
        operationStatus:
          current.application_status === "succeeded"
            ? "succeeded"
            : current.application_status,
        validity: "current",
        statusUrl:
          `/api/projects/${input.projectId}/validation/` +
          `workbook-applications/${current.workbook_application_id}`,
        sourceSnapshotId: context.sourceSnapshotId,
        sourceFingerprint: context.sourceFingerprint,
      };
      await storeIdempotency(client, {
        userId: input.userId,
        operation: "validation.workbook_application.create",
        projectId: input.projectId,
        key,
        requestHash,
        status: current.application_status === "succeeded" ? 200 : 202,
        body,
      });
      return {
        status: current.application_status === "succeeded" ? 200 : 202,
        body,
      };
    }

    const proposalDecisionMap = await latestProposalDecisions(client, {
      projectId: input.projectId,
      validatedValueSetResourceVersionId:
        preparation.resourceVersionId,
      sourceWorkbookResourceVersionId:
        context.sourceWorkbookResourceVersionId,
      mappingSetResourceVersionId:
        context.mappingSetResourceVersionId,
      sourceFingerprint: context.sourceFingerprint,
    });
    const targetById = new Map(
      context.targets.map((target) => [target.targetId, target]),
    );
    const finalizedPlan = finalizeWorkbookApplicationPlan({
      plan: preparation.plan,
      decisions: preparation.plan.commands.map((command) => {
        const target = targetById.get(command.targetId);
        if (!target) {
          throw new ApiError(
            409,
            "WORKBOOK_TARGET_POLICY_MISSING",
            "Workbook 반영 대상의 필수 여부를 확인할 수 없습니다.",
          );
        }
        const decision = proposalDecisionMap.get(command.targetId);
        return {
          targetId: command.targetId,
          required: target.required && target.included,
          action: decision?.action ?? null,
          proposedAfterValue:
            decision?.after_command_json?.afterValue ?? undefined,
        };
      }),
    });
    const applicationDecisions: Array<{
      originalCommand: WorkbookPatchCommand;
      command: WorkbookPatchCommand;
      action: "approve" | "modify";
      reason: string;
    }> = finalizedPlan.resolutions.flatMap((resolution) => {
      if (
        !resolution.effectiveCommand ||
        resolution.action === "reject"
      ) {
        return [];
      }
      const decision = proposalDecisionMap.get(
        resolution.originalCommand.targetId,
      );
      if (!decision) {
        throw new ApiError(
          409,
          "WORKBOOK_WRITE_PROPOSAL_DECISION_REQUIRED",
          "Workbook 반영 제안 결정을 찾을 수 없습니다.",
        );
      }
      return [
        {
          originalCommand: resolution.originalCommand,
          command: resolution.effectiveCommand,
          action: resolution.action,
          reason: decision.reason,
        },
      ];
    });

    const jobId = uuidv7();
    const workflowPayload = {
      workflowType: "workbookApplicationWorkflow" as const,
      jobId,
      jobAttempt: 1,
      projectId: input.projectId,
      applicationId,
      validationSourceSnapshotId: context.sourceSnapshotId,
      sourceFingerprint: context.sourceFingerprint,
      sourceWorkbookResourceVersionId:
        context.sourceWorkbookResourceVersionId,
      mappingSetResourceVersionId:
        context.mappingSetResourceVersionId,
      validatedValueSetResourceVersionId:
        preparation.resourceVersionId,
      sourceArtifactId: context.sourceWorkbookArtifactId,
      sourceObjectKey: context.sourceWorkbookObjectKey,
      sourceWorkbookHash: context.sourceWorkbookSha256,
      sourceFilename: context.sourceWorkbookFilename,
      plan: finalizedPlan.plan,
      outputBindings: preparation.outputBindings,
      inputVersionIds: [
        context.approvedPlanResourceVersionId,
        context.sourceWorkbookResourceVersionId,
        context.mappingSetResourceVersionId,
        preparation.resourceVersionId,
      ].sort(),
    };
    await client.query(
      `INSERT INTO workflow_job (
         job_id, project_id, job_type, temporal_workflow_id,
         operation_status, validity_status, current_phase,
         progress_percent, progress_mode, progress_sequence, attempt,
         input_fingerprint, requested_by_user_id
       ) VALUES ($1, $2, 'workbook_application', $3, 'queued', 'current',
         'preparing', 0, 'determinate', 0, 1, $4, $5)`,
      [
        jobId,
        input.projectId,
        `reflo:${jobId}`,
        contentHash(workflowPayload),
        input.userId,
      ],
    );
    await client.query(
      `INSERT INTO workflow_job_input (
         job_id, input_role, resource_version_id
       ) VALUES
         ($1, 'approved_research_plan', $2),
         ($1, 'source_workbook', $3),
         ($1, 'mapping_set', $4),
         ($1, 'validated_value_set', $5)`,
      [
        jobId,
        context.approvedPlanResourceVersionId,
        context.sourceWorkbookResourceVersionId,
        context.mappingSetResourceVersionId,
        preparation.resourceVersionId,
      ],
    );
    await pinWorkflowJobSourceSnapshot(client, { jobId });
    await client.query(
      `INSERT INTO workbook_application_run (
         workbook_application_id, project_id, job_id,
         validated_value_set_resource_version_id,
         source_workbook_resource_version_id,
         mapping_set_resource_version_id, source_workbook_artifact_id,
         source_snapshot_id, source_fingerprint, input_workbook_version,
         application_plan_json, plan_hash, application_status,
         applied_cell_count, blocked_cell_count, requested_by_user_id
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 1,
         $10::jsonb, $11, 'queued', 0, 0, $12)`,
      [
        applicationId,
        input.projectId,
        jobId,
        preparation.resourceVersionId,
        context.sourceWorkbookResourceVersionId,
        context.mappingSetResourceVersionId,
        context.sourceWorkbookArtifactId,
        context.sourceSnapshotId,
        context.sourceFingerprint,
        JSON.stringify(finalizedPlan.plan),
        finalizedPlan.plan.planHash,
        input.userId,
      ],
    );
    for (const decision of applicationDecisions) {
      const command = decision.command;
      await client.query(
        `INSERT INTO workbook_application_decision (
           decision_id, project_id, workbook_application_id, target_id,
           decision_no, action, before_command_json, after_command_json,
           evidence_ids, reason, decided_by_user_id
         ) VALUES ($1, $2, $3, $4, 1, $5, $6::jsonb, $7::jsonb,
           $8::uuid[], $9, $10)`,
        [
          uuidv7(),
          input.projectId,
          applicationId,
          command.targetId,
          decision.action,
          JSON.stringify(decision.originalCommand),
          JSON.stringify(command),
          command.evidenceIds,
          decision.reason,
          input.userId,
        ],
      );
    }
    await client.query(
      `INSERT INTO outbox_event (
         outbox_event_id, job_id, command_type, command_id, payload_json
       ) VALUES ($1, $2, 'start_workflow', $3, $4::jsonb)`,
      [
        uuidv7(),
        jobId,
        uuidv7(),
        JSON.stringify(workflowPayload),
      ],
    );
    const body = {
      taskId: applicationId,
      operationStatus: "queued",
      validity: "current",
      statusUrl:
        `/api/projects/${input.projectId}/validation/` +
        `workbook-applications/${applicationId}`,
      sourceSnapshotId: context.sourceSnapshotId,
      sourceFingerprint: context.sourceFingerprint,
    };
    await storeIdempotency(client, {
      userId: input.userId,
      operation: "validation.workbook_application.create",
      projectId: input.projectId,
      key,
      requestHash,
      status: 202,
      body,
    });
    return { status: 202, body };
  });
}

export async function getValidationWorkbookApplication(input: {
  projectId: string;
  userId: string;
  applicationId: string;
}): Promise<unknown> {
  return withTransaction(async (client) => {
    const result = await client.query<{
      workbook_application_id: string;
      source_snapshot_id: string;
      source_fingerprint: string;
      input_workbook_version: string;
      application_status: string;
      applied_cell_count: number;
      blocked_cell_count: number;
      output_workbook_resource_version_id: string | null;
      output_artifact_id: string | null;
      error_code: string | null;
      error_summary: string | null;
      job_id: string;
      job_type: string;
      operation_status: string;
      validity_status: string;
      current_phase: string | null;
      progress_mode: string;
      progress_percent: number;
      attempt: number;
      retryable: boolean;
      requested_at: Date;
      started_at: Date | null;
      heartbeat_at: Date | null;
      finished_at: Date | null;
    }>(
      `SELECT application.workbook_application_id,
         application.source_snapshot_id, application.source_fingerprint,
         application.input_workbook_version,
         application.application_status, application.applied_cell_count,
         application.blocked_cell_count,
         application.output_workbook_resource_version_id,
         application.output_artifact_id, application.error_code,
         application.error_summary, job.job_id, job.job_type,
         job.operation_status, job.validity_status, job.current_phase,
         job.progress_mode, job.progress_percent, job.attempt,
         job.retryable, job.requested_at, job.started_at,
         job.heartbeat_at, job.finished_at
       FROM workbook_application_run application
       JOIN workflow_job job ON job.job_id = application.job_id
       JOIN project ON project.project_id = application.project_id
       WHERE application.project_id = $1
         AND application.workbook_application_id = $2
         AND project.owner_user_id = $3
         AND project.deleted_at IS NULL`,
      [input.projectId, input.applicationId, input.userId],
    );
    const row = result.rows[0];
    if (!row) {
      throw new ApiError(
        404,
        "TASK_NOT_FOUND",
        "Workbook 반영 작업을 찾을 수 없습니다.",
      );
    }
    return {
      jobId: row.job_id,
      jobType: row.job_type,
      taskId: row.workbook_application_id,
      operationStatus: row.operation_status,
      validity: row.validity_status,
      phase: row.current_phase,
      progressMode: row.progress_mode,
      progressPercent: row.progress_percent,
      attempt: row.attempt,
      retryable: row.retryable,
      error: row.error_code
        ? { code: row.error_code, message: row.error_summary }
        : null,
      requestedAt: row.requested_at.toISOString(),
      startedAt: row.started_at?.toISOString() ?? null,
      finishedAt: row.finished_at?.toISOString() ?? null,
      heartbeatAt: row.heartbeat_at?.toISOString() ?? null,
      updatedAt:
        row.finished_at?.toISOString() ??
        row.heartbeat_at?.toISOString() ??
        row.requested_at.toISOString(),
      sourceSnapshotId: row.source_snapshot_id,
      sourceFingerprint: row.source_fingerprint,
      inputWorkbookVersion: Number(row.input_workbook_version),
      appliedCellCount: row.applied_cell_count,
      blockedCellCount: row.blocked_cell_count,
      outputWorkbook: row.output_workbook_resource_version_id
        ? {
            id: row.output_workbook_resource_version_id,
            version: 1,
            artifactId: row.output_artifact_id,
          }
        : null,
      obsoleteReason:
        row.application_status === "obsolete"
          ? row.error_summary ?? "source_changed"
          : null,
    };
  });
}

export async function commitWorkbookApplicationResult(
  applicationId: string,
  payload: WorkbookApplicationWorkerPayload,
  attempt: number,
): Promise<{ applied: boolean }> {
  return withTransaction(async (client) => {
    const application = await client.query<{ project_id: string }>(
      `SELECT project_id
       FROM workbook_application_run
       WHERE workbook_application_id = $1`,
      [applicationId],
    );
    if (!application.rows[0]) {
      throw new ApiError(
        404,
        "TASK_NOT_FOUND",
        "Workbook 반영 작업을 찾을 수 없습니다.",
      );
    }
    await acquireProjectLineageLock(
      client,
      application.rows[0].project_id,
    );
    const current = await client.query<{
      project_id: string;
      job_id: string;
      validated_value_set_resource_version_id: string;
      source_workbook_resource_version_id: string;
      mapping_set_resource_version_id: string;
      source_workbook_artifact_id: string;
      source_snapshot_id: string;
      source_fingerprint: string;
      application_plan_json: WorkbookApplicationPlan;
      application_status: string;
      operation_status: string;
      job_attempt: number;
      job_validity_status: string;
      current_source_fingerprint: string | null;
      current_value_status: string;
      current_value_validity_status: string;
      current_validation_run_id: string | null;
      current_validation_version: string | null;
      current_approved_plan_resource_version_id: string | null;
      value_validation_run_id: string;
      value_validation_version: string;
      value_approved_plan_resource_version_id: string;
    }>(
      `SELECT application.project_id, application.job_id,
         application.validated_value_set_resource_version_id,
         application.source_workbook_resource_version_id,
         application.mapping_set_resource_version_id,
         application.source_workbook_artifact_id,
         application.source_snapshot_id, application.source_fingerprint,
         application.application_plan_json, application.application_status,
         job.operation_status, job.attempt AS job_attempt,
         job.validity_status AS job_validity_status,
          snapshot.fingerprint AS current_source_fingerprint,
          value_set.status AS current_value_status,
          value_resource.validity_status AS current_value_validity_status,
          workspace.validation_run_id AS current_validation_run_id,
          workspace.validation_version AS current_validation_version,
          workspace.approved_plan_resource_version_id
            AS current_approved_plan_resource_version_id,
          value_set.validation_run_id AS value_validation_run_id,
          value_set.validation_version AS value_validation_version,
          value_set.approved_plan_resource_version_id
            AS value_approved_plan_resource_version_id
        FROM workbook_application_run application
       JOIN workflow_job job ON job.job_id = application.job_id
        JOIN validated_value_set_version value_set
          ON value_set.resource_version_id =
             application.validated_value_set_resource_version_id
        JOIN resource_version value_resource
          ON value_resource.resource_version_id =
             value_set.resource_version_id
        LEFT JOIN validation_workspace workspace
          ON workspace.project_id = application.project_id
       LEFT JOIN source_snapshot snapshot
         ON snapshot.source_snapshot_id = application.source_snapshot_id
        AND snapshot.project_id = application.project_id
       WHERE application.workbook_application_id = $1
       FOR UPDATE OF application, job`,
      [applicationId],
    );
    const row = current.rows[0];
    if (!row) {
      throw new ApiError(
        404,
        "TASK_NOT_FOUND",
        "Workbook 반영 작업을 찾을 수 없습니다.",
      );
    }
    const disposition = workbookApplicationResultDisposition({
      applicationStatus: row.application_status,
      jobStatus: row.operation_status,
      jobAttempt: row.job_attempt,
      resultAttempt: attempt,
      jobValidity: row.job_validity_status,
      valueStatus: row.current_value_status,
      valueValidity: row.current_value_validity_status,
      sourceFingerprint: row.source_fingerprint,
      currentSourceFingerprint: row.current_source_fingerprint,
      validationRunId: row.value_validation_run_id,
      currentValidationRunId: row.current_validation_run_id,
      validationVersion: Number(row.value_validation_version),
      currentValidationVersion: row.current_validation_version
        ? Number(row.current_validation_version)
        : null,
      approvedPlanResourceVersionId:
        row.value_approved_plan_resource_version_id,
      currentApprovedPlanResourceVersionId:
        row.current_approved_plan_resource_version_id,
    });
    if (disposition === "duplicate" || disposition === "terminal") {
      return { applied: false };
    }
    if (disposition === "obsolete") {
      await client.query(
        `UPDATE workbook_application_run
         SET application_status = 'obsolete',
             error_code = 'SOURCE_FINGERPRINT_MISMATCH',
             error_summary = '작업 중 검증 입력이 변경되었습니다.',
             finished_at = now()
         WHERE workbook_application_id = $1`,
        [applicationId],
      );
      await client.query(
        `UPDATE workflow_job
         SET operation_status = 'succeeded', validity_status = 'obsolete',
             current_phase = 'obsolete', progress_percent = 100,
             finished_at = now()
         WHERE job_id = $1`,
        [row.job_id],
      );
      return { applied: false };
    }
    if (
      payload.artifact.sha256 !== payload.result.workbookHash ||
      payload.artifact.mediaType !== XLSX_MEDIA_TYPE
    ) {
      throw new ApiError(
        409,
        "WORKER_RESULT_HASH_MISMATCH",
        "Workbook artifact와 worker 결과 hash가 다릅니다.",
      );
    }
    const verified = validateWorkbookApplicationResult(
      row.application_plan_json,
      payload.result,
    );
    const expectedObjectKey =
      `projects/${row.project_id}/validation/` +
      `workbook-${applicationId}-${verified.outputWorkbookHash.slice(0, 12)}.xlsx`;
    if (payload.artifact.objectKey !== expectedObjectKey) {
      throw new ApiError(
        409,
        "WORKER_RESULT_ARTIFACT_MISMATCH",
        "Workbook artifact 경로가 작업과 일치하지 않습니다.",
      );
    }
    try {
      await verifyUploadedObject({
        objectKey: expectedObjectKey,
        expectedByteSize: payload.artifact.byteSize,
        expectedMediaType: XLSX_MEDIA_TYPE,
        expectedSha256: payload.artifact.sha256,
        expectedMetadata: {
          project: row.project_id,
          application: applicationId,
          sourceSnapshot: row.source_snapshot_id,
        },
      });
    } catch {
      throw new ApiError(
        409,
        "WORKER_RESULT_ARTIFACT_MISMATCH",
        "Workbook artifact의 실제 내용과 작업 결과가 일치하지 않습니다.",
      );
    }
    const artifactId = uuidv7();
    await client.query(
      `INSERT INTO artifact (
         artifact_id, project_id, artifact_kind, storage_status,
         bucket_name, object_key, object_version, sha256, byte_size,
         media_type, original_filename, retention_class,
         created_by_actor_type, supersedes_artifact_id
       ) VALUES ($1, $2, 'working_copy', 'accepted', $3, $4, $5, $6,
         $7, $8, $9, 'project', 'worker', $10)`,
      [
        artifactId,
        row.project_id,
        objectStoreBucket(),
        payload.artifact.objectKey,
        payload.artifact.objectVersion,
        payload.artifact.sha256,
        payload.artifact.byteSize,
        payload.artifact.mediaType,
        payload.artifact.originalFilename,
        row.source_workbook_artifact_id,
      ],
    );
    const resourceId = uuidv7();
    const resourceVersionId = uuidv7();
    const resultContentHash = contentHash({
      applicationId,
      workbookHash: payload.result.workbookHash,
      formulaHash: payload.result.formulaHashAfter,
      outputs: payload.result.outputs,
    });
    await client.query(
      `INSERT INTO versioned_resource (
         resource_id, project_id, resource_kind, resource_key
       ) VALUES ($1, $2, 'validated_workbook', $3)`,
      [resourceId, row.project_id, `application:${applicationId}`],
    );
    await client.query(
      `INSERT INTO resource_version (
         resource_version_id, resource_id, version_no, lifecycle_status,
         validity_status, schema_version, input_fingerprint, content_hash,
         created_by_actor_type
       ) VALUES ($1, $2, 1, 'approved', 'current', '1.0', $3, $4,
         'system')`,
      [
        resourceVersionId,
        resourceId,
        row.source_fingerprint,
        resultContentHash,
      ],
    );
    const calculationReport = {
      outputs: payload.result.outputs,
      calculationErrors: payload.result.calculationErrors,
      unsupportedFunctions: payload.result.unsupportedFunctions,
      engine: verified.engine,
      appliedCellCount: verified.appliedCellCount,
    };
    await client.query(
      `INSERT INTO validated_workbook_version (
         resource_version_id, project_id, workbook_application_id,
         source_workbook_resource_version_id,
         mapping_set_resource_version_id,
         validated_value_set_resource_version_id, artifact_id,
         workbook_version, structure_hash, formula_hash,
         calculation_status, calculation_report_json
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, 1, $8, $9, 'success',
         $10::jsonb)`,
      [
        resourceVersionId,
        row.project_id,
        applicationId,
        row.source_workbook_resource_version_id,
        row.mapping_set_resource_version_id,
        row.validated_value_set_resource_version_id,
        artifactId,
        payload.result.structureHashAfter,
        payload.result.formulaHashAfter,
        JSON.stringify(calculationReport),
      ],
    );
    await client.query(
      `INSERT INTO resource_artifact (
         resource_version_id, artifact_role, artifact_id
       ) VALUES ($1, 'validated_workbook', $2)`,
      [resourceVersionId, artifactId],
    );
    await client.query(
      `UPDATE workbook_application_run
       SET application_status = 'succeeded', applied_cell_count = $2,
           blocked_cell_count = 0, output_artifact_id = $3,
           output_workbook_resource_version_id = $4,
           calculation_report_json = $5::jsonb,
           worker_result_json = $6::jsonb, started_at = COALESCE(started_at, now()),
           finished_at = now()
       WHERE workbook_application_id = $1`,
      [
        applicationId,
        verified.appliedCellCount,
        artifactId,
        resourceVersionId,
        JSON.stringify(calculationReport),
        JSON.stringify({
          ...payload.result,
          workbookBase64: undefined,
        }),
      ],
    );
    await client.query(
      `UPDATE workflow_job
       SET operation_status = 'succeeded', current_phase = 'completed',
           progress_percent = 100, heartbeat_at = now(), finished_at = now(),
           retryable = false, error_code = NULL, error_summary = NULL,
           result_summary_json = $2::jsonb
       WHERE job_id = $1`,
      [
        row.job_id,
        JSON.stringify({
          applicationId,
          artifactId,
          resourceVersionId,
          workbookHash: verified.outputWorkbookHash,
        }),
      ],
    );
    await client.query(
      `INSERT INTO workflow_job_output (
         job_id, output_role, resource_version_id
       ) VALUES ($1, 'validated_workbook', $2)
       ON CONFLICT (job_id, output_role) DO NOTHING`,
      [row.job_id, resourceVersionId],
    );
    await recordResourceDependencies(client, {
      projectId: row.project_id,
      dependencies: [
        {
          upstreamResourceVersionId:
            row.validated_value_set_resource_version_id,
          downstreamResourceVersionId: resourceVersionId,
          dependencyKind: "validated_values_to_workbook",
        },
        {
          upstreamResourceVersionId:
            row.source_workbook_resource_version_id,
          downstreamResourceVersionId: resourceVersionId,
          dependencyKind: "source_workbook_to_validated_workbook",
        },
        {
          upstreamResourceVersionId:
            row.mapping_set_resource_version_id,
          downstreamResourceVersionId: resourceVersionId,
          dependencyKind: "workbook_input_mapping",
        },
      ],
    });
    return { applied: true };
  });
}

export async function failWorkbookApplication(input: {
  applicationId: string;
  attempt: number;
  code: string;
  message: string;
}): Promise<void> {
  await withTransaction(async (client) => {
    await client.query(
      `UPDATE workbook_application_run application
       SET application_status = 'failed', error_code = $3,
           error_summary = $4, finished_at = now()
       FROM workflow_job job
       WHERE application.workbook_application_id = $1
         AND job.job_id = application.job_id
         AND job.attempt = $2
         AND application.application_status IN ('queued', 'running')`,
      [
        input.applicationId,
        input.attempt,
        input.code,
        input.message.slice(0, 1000),
      ],
    );
  });
}

export async function assertValidatedWorkbookReady(
  client: TransactionClient,
  input: {
    projectId: string;
    validationRunId: string;
    validationVersion: number;
    approvedPlanResourceVersionId: string;
  },
): Promise<{
  applicationId: string;
  validatedValueSetResourceVersionId: string;
  validatedWorkbookResourceVersionId: string;
  validatedWorkbookArtifactId: string;
}> {
  const result = await client.query<{
    workbook_application_id: string;
    validated_value_set_resource_version_id: string;
    output_workbook_resource_version_id: string;
    output_artifact_id: string;
  }>(
    `SELECT application.workbook_application_id,
       application.validated_value_set_resource_version_id,
       application.output_workbook_resource_version_id,
       application.output_artifact_id
     FROM workbook_application_run application
     JOIN validated_value_set_version value_set
       ON value_set.resource_version_id =
          application.validated_value_set_resource_version_id
      AND value_set.project_id = application.project_id
     JOIN validated_workbook_version workbook
       ON workbook.resource_version_id =
          application.output_workbook_resource_version_id
      AND workbook.artifact_id = application.output_artifact_id
      AND workbook.project_id = application.project_id
     JOIN artifact
       ON artifact.artifact_id = application.output_artifact_id
      AND artifact.project_id = application.project_id
      AND artifact.storage_status = 'accepted'
     WHERE application.project_id = $1
       AND value_set.validation_run_id = $2
       AND value_set.validation_version = $3
       AND value_set.approved_plan_resource_version_id = $4
       AND value_set.status = 'approved'
       AND application.application_status = 'succeeded'
       AND workbook.calculation_status = 'success'
       AND application.output_workbook_resource_version_id IS NOT NULL
       AND application.output_artifact_id IS NOT NULL
     ORDER BY application.finished_at DESC
     LIMIT 1`,
    [
      input.projectId,
      input.validationRunId,
      input.validationVersion,
      input.approvedPlanResourceVersionId,
    ],
  );
  const row = result.rows[0];
  if (!row) {
    throw new ApiError(
      409,
      "VALIDATED_WORKBOOK_REQUIRED",
      "승인 Evidence를 반영한 새 Workbook을 먼저 생성해주세요.",
    );
  }
  return {
    applicationId: row.workbook_application_id,
    validatedValueSetResourceVersionId:
      row.validated_value_set_resource_version_id,
    validatedWorkbookResourceVersionId:
      row.output_workbook_resource_version_id,
    validatedWorkbookArtifactId: row.output_artifact_id,
  };
}
