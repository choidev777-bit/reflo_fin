import { createHash } from "node:crypto";
import Decimal from "decimal.js";
import { contentHash } from "../../domain/hash";
import { uuidv7 } from "../../domain/ids";
import { processRoute, type StageKey } from "../../domain/project";
import { resumeRouteForBlocker } from "../../domain/stage-blocker-policy";
import {
  canonicalTargetPer,
  canonicalTargetPrice,
  inverseTargetPer,
  sensitivityGrid,
  upside,
  valuationWorkbookLineageIsCurrent,
  type ValuationWorkbookLineage,
} from "../../domain/valuation";
import { ApiError } from "../../http/api-error";
import type { TransactionClient } from "../database/transaction";
import { withTransaction } from "../database/transaction";
import {
  createWorkerDownloadUrl,
  objectStoreBucket,
  putImmutableObject,
  readObjectBytes,
} from "../object-storage/s3";
import {
  invalidateProjectStages,
  invalidateResourceDependents,
  recordResourceDependencies,
} from "../services/dependency-invalidator";
import { loadRequiredWorkbookOutputBindings } from "../services/workbook-output-bindings";

type CellChange = {
  sheetId: string;
  address: string;
  valueType: "number" | "string" | "boolean" | "blank";
  value: string | null;
};

type WorkbookCell = {
  address: string;
  row: number;
  column: number;
  valueType: string;
  rawValue: string | null;
  formattedText: string;
  formula: string | null;
  numberFormat: string;
  label: string;
  editable: boolean;
  readOnlyReason: string | null;
  fill: string;
  fontColor: string;
  bold: boolean;
};

type EditableCell = {
  sheetId: string;
  sheetName: string;
  address: string;
  valueType: string;
  label: string;
  numberFormat: string;
  required: boolean;
  impactTypes?: string[];
  activeInCurrentMode?: boolean | null;
  downstreamOutputs?: string[];
};

type ReadModel = {
  schemaVersion: string;
  workbookHash: string;
  sheets: Array<{
    sheetId: string;
    name: string;
    index: number;
    visibility?: "visible" | "hidden" | "very_hidden";
    usedRange: string;
    freezeRows: number;
    freezeColumns: number;
    cells: WorkbookCell[];
  }>;
  editableCells: EditableCell[];
  outputs: {
    forwardEps: OutputCell | null;
    targetPer: OutputCell | null;
    targetPrice: OutputCell | null;
  };
  dependencyAnalysis?: {
    status: "complete" | "partial";
    warnings: string[];
    edges: Array<{
      outputMetric: string;
      fromSheetId: string;
      fromAddress: string;
      toSheetId: string;
      toAddress: string;
    }>;
  };
};

type OutputCell = {
  sheetId: string;
  sheetName: string;
  address: string;
  rawValue: string | null;
  formattedText: string;
};

type WorkerCalculation = {
  engineName: "ClosedXML";
  engineVersion: "0.105.0";
  workbookBase64: string;
  workbookHash: string;
  readModel: ReadModel;
  before: AppliedCell[];
  appliedChanges: AppliedCell[];
  outputs: ReadModel["outputs"];
  durationMs: number;
};

type AppliedCell = {
  sheetId: string;
  sheetName: string;
  address: string;
  valueType: string;
  rawValue: string | null;
  formattedText: string;
};

type OutputBinding = {
  metric: "forward_eps" | "target_per" | "target_price";
  sheetId: string;
  address: string;
  expectedFormulaHash: string | null;
  expectedStructureFingerprint: string | null;
};

type Context = {
  projectId: string;
  projectName: string;
  companyName: string;
  ticker: string;
  targetYear: number;
  targetQuarter: number;
  cutoffDate: string;
  validationApprovalId: string;
  validatedValueSetResourceVersionId: string;
  validatedWorkbookResourceVersionId: string;
  sourceWorkbookResourceVersionId: string;
  mappingSetResourceVersionId: string;
  structureHash: string;
  sourceArtifactId: string;
  sourceObjectKey: string;
  sourceFilename: string;
  sourceSha256: string;
  priceSnapshotId: string;
  validationInputResourceVersionIds: string[];
  currentPrice: string;
  tradingDate: string;
  inputFingerprint: string;
  outputBindings: OutputBinding[];
};

type WorkbookState = {
  validationApprovalId: string;
  validatedValueSetResourceVersionId: string;
  validatedWorkbookResourceVersionId: string;
  sourceWorkbookResourceVersionId: string;
  mappingSetResourceVersionId: string;
  structureHash: string;
  inputFingerprint: string;
  sourceArtifactId: string;
  sourceArtifactHash: string;
  workbookVersion: number;
  editableCellSetVersion: number;
  currentArtifactId: string;
  currentObjectKey: string;
  readModel: ReadModel;
  calculationStatus: string;
  savedAt: string;
};

type IdempotentResult = { status: number; body: unknown };

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function formattedMoney(value: string): string {
  return `${new Decimal(value)
    .toDecimalPlaces(0)
    .toFixed(0)
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",")}원`;
}

function formattedUpside(value: string): string {
  const percent = new Decimal(value).mul(100).toDecimalPlaces(1);
  return `${percent.gte(0) ? "+" : ""}${percent.toFixed(1)}%`;
}

function isPositiveDecimal(value: string | null | undefined): boolean {
  if (!value) return false;
  try {
    const decimal = new Decimal(value);
    return decimal.isFinite() && decimal.gt(0);
  } catch {
    return false;
  }
}

function sameDecimal(
  left: string | null | undefined,
  right: string | null | undefined,
  decimalPlaces?: number,
): boolean {
  if (!left || !right) return false;
  try {
    const a = new Decimal(left);
    const b = new Decimal(right);
    return decimalPlaces === undefined
      ? a.equals(b)
      : a.toDecimalPlaces(decimalPlaces).equals(
          b.toDecimalPlaces(decimalPlaces),
        );
  } catch {
    return false;
  }
}

function outputDelta(
  before: OutputCell | null,
  after: OutputCell | null,
) {
  return {
    before: before?.rawValue ?? null,
    after: after?.rawValue ?? null,
    beforeFormatted: before?.formattedText ?? null,
    afterFormatted: after?.formattedText ?? null,
    changed:
      (before?.rawValue ?? null) !== (after?.rawValue ?? null) ||
      (before?.formattedText ?? null) !==
        (after?.formattedText ?? null),
  };
}

function outputDiff(
  before: ReadModel["outputs"],
  after: ReadModel["outputs"],
) {
  return {
    forwardEps: outputDelta(before.forwardEps, after.forwardEps),
    targetPer: outputDelta(before.targetPer, after.targetPer),
    targetPrice: outputDelta(before.targetPrice, after.targetPrice),
  };
}

function missingRequiredCells(readModel: ReadModel) {
  const values = new Map(
    readModel.sheets.flatMap((sheet) =>
      sheet.cells.map((cell) => [
        `${sheet.sheetId}:${cell.address}`,
        cell.rawValue,
      ]),
    ),
  );
  return readModel.editableCells.filter(
    (cell) =>
      cell.required &&
      !values.get(`${cell.sheetId}:${cell.address}`)?.trim(),
  );
}

function workbookCell(
  readModel: ReadModel,
  sheetId: string,
  address: string,
) {
  return readModel.sheets
    .find((sheet) => sheet.sheetId === sheetId)
    ?.cells.find((cell) => cell.address === address);
}

function previousRowAddress(address: string): string | null {
  const match = /^([A-Z]{1,3})([1-9]\d{0,6})$/.exec(address);
  if (!match || Number(match[2]) <= 1) return null;
  return `${match[1]}${Number(match[2]) - 1}`;
}

function requireVersion(value: unknown, label: string): number {
  const version = Number(value);
  if (!Number.isInteger(version) || version < 1) {
    throw new ApiError(400, "INVALID_VERSION", `${label} 버전이 올바르지 않습니다.`);
  }
  return version;
}

function requireRequestId(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  ) {
    throw new ApiError(400, "INVALID_REQUEST_ID", "요청 식별자가 올바르지 않습니다.");
  }
  return value;
}

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

async function lockIdempotency(
  client: TransactionClient,
  input: {
    userId: string;
    operation: string;
    projectId: string;
    key: string;
  },
) {
  await client.query(
    `SELECT pg_advisory_xact_lock(
       hashtextextended($1, 0)
     )`,
    [
      [
        input.userId,
        input.operation,
        input.projectId,
        input.key,
      ].join("\u001f"),
    ],
  );
}

async function replay(
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

async function storeReplay(
  client: TransactionClient,
  input: {
    userId: string;
    operation: string;
    projectId: string;
    key: string;
    requestHash: string;
    body: unknown;
  },
) {
  await client.query(
    `INSERT INTO idempotency_record (
       idempotency_id, user_id, operation, project_id, idempotency_key,
       request_hash, response_status, response_json, expires_at
     ) VALUES ($1, $2, $3, $4, $5, $6, 200, $7::jsonb, now() + interval '24 hours')
     ON CONFLICT (user_id, operation, project_id, idempotency_key) DO NOTHING`,
    [
      uuidv7(),
      input.userId,
      input.operation,
      input.projectId,
      input.key,
      input.requestHash,
      JSON.stringify(input.body),
    ],
  );
}

async function projectContext(
  client: TransactionClient,
  projectId: string,
  userId: string,
): Promise<Context> {
  const result = await client.query<{
    project_id: string;
    project_name: string;
    company_name: string;
    ticker: string;
    target_year: number;
    target_quarter: number;
    cutoff_date: string;
    workbook_resource_version_id: string;
    mapping_set_resource_version_id: string;
    validation_approval_id: string;
    validation_run_id: string;
    approved_plan_resource_version_id: string;
    validated_value_set_resource_version_id: string;
    validated_workbook_resource_version_id: string;
    application_plan_json: {
      commands?: Array<{
        targetId: string;
        sheetId: string;
        address: string;
        generatedBridge: boolean;
      }>;
    };
    structure_hash: string;
    artifact_id: string;
    object_key: string;
    original_filename: string | null;
    sha256: string;
    price_snapshot_id: string | null;
    close_price: string | null;
    trading_date: string | null;
  }>(
    `SELECT p.project_id, p.name AS project_name, cm.company_name, cm.ticker,
       psv.target_year, psv.target_quarter, psv.cutoff_date::text,
       wv.resource_version_id AS workbook_resource_version_id,
       msv.resource_version_id AS mapping_set_resource_version_id,
       validation.approval_id AS validation_approval_id,
       validation.validation_run_id,
       validation.approved_plan_resource_version_id,
       validation.validated_value_set_resource_version_id,
       validation.validated_workbook_resource_version_id,
       workbook_application.application_plan_json,
       validated_workbook.structure_hash,
       a.artifact_id, a.object_key, a.original_filename,
       a.sha256, price.resource_version_id AS price_snapshot_id,
       price.close_price::text, price.trading_date::text
     FROM project p
     JOIN project_stage_state setup_state
       ON setup_state.project_id = p.project_id AND setup_state.stage_key = 'setup'
     JOIN stage_completion setup_completion
       ON setup_completion.stage_completion_id = setup_state.current_completion_id
     JOIN project_setup_version psv
       ON psv.resource_version_id = setup_completion.primary_version_id
     JOIN company_master cm ON cm.company_master_id = psv.company_master_id
     JOIN project_stage_state files_state
       ON files_state.project_id = p.project_id
      AND files_state.stage_key = 'files'
      AND files_state.stage_status = 'completed'
     JOIN stage_completion files_completion
       ON files_completion.stage_completion_id = files_state.current_completion_id
      AND files_completion.validity_status = 'current'
     JOIN project_stage_state validation_state
       ON validation_state.project_id = p.project_id
      AND validation_state.stage_key = 'validation'
      AND validation_state.stage_status = 'completed'
     JOIN stage_completion validation_completion
       ON validation_completion.stage_completion_id =
          validation_state.current_completion_id
      AND validation_completion.validity_status = 'current'
     JOIN research_plan_version approved_plan
       ON approved_plan.resource_version_id =
          validation_completion.primary_version_id
      AND approved_plan.status = 'approved'
     JOIN resource_version approved_plan_resource
       ON approved_plan_resource.resource_version_id =
          approved_plan.resource_version_id
      AND approved_plan_resource.lifecycle_status = 'approved'
      AND approved_plan_resource.validity_status = 'current'
     JOIN validation_workspace validation_workspace
       ON validation_workspace.project_id = p.project_id
      AND validation_workspace.approved_plan_resource_version_id =
          approved_plan.resource_version_id
      AND validation_workspace.workspace_status = 'APPROVED'
     JOIN validation_approval validation
       ON validation.project_id = p.project_id
      AND validation.validation_run_id =
          validation_workspace.validation_run_id
      AND validation.validation_version =
          validation_workspace.validation_version
      AND validation.approved_plan_resource_version_id =
          approved_plan.resource_version_id
     JOIN validation_run validation_run
       ON validation_run.validation_run_id = validation.validation_run_id
      AND validation_run.status = 'succeeded'
     JOIN workbook_application_run workbook_application
       ON workbook_application.workbook_application_id =
          validation.workbook_application_id
      AND workbook_application.project_id = p.project_id
      AND workbook_application.application_status = 'succeeded'
      AND workbook_application.output_workbook_resource_version_id =
          validation.validated_workbook_resource_version_id
      AND workbook_application.output_artifact_id =
          validation.validated_workbook_artifact_id
     JOIN validated_workbook_version validated_workbook
       ON validated_workbook.resource_version_id =
          validation.validated_workbook_resource_version_id
      AND validated_workbook.project_id = p.project_id
      AND validated_workbook.validated_value_set_resource_version_id =
          validation.validated_value_set_resource_version_id
      AND validated_workbook.artifact_id =
          validation.validated_workbook_artifact_id
      AND validated_workbook.calculation_status = 'success'
     JOIN mapping_set_version msv
       ON msv.resource_version_id =
          approved_plan.mapping_set_resource_version_id
      AND msv.resource_version_id = files_completion.primary_version_id
      AND msv.mapping_status = 'confirmed'
      AND msv.unmapped_required_count = 0
      AND msv.resource_version_id =
          validated_workbook.mapping_set_resource_version_id
     JOIN workbook_version wv
       ON wv.resource_version_id =
          approved_plan.workbook_resource_version_id
      AND wv.resource_version_id = msv.workbook_version_id
      AND wv.resource_version_id =
          validated_workbook.source_workbook_resource_version_id
     JOIN artifact a
       ON a.artifact_id = validated_workbook.artifact_id
      AND a.project_id = p.project_id
      AND a.storage_status = 'accepted'
     JOIN LATERAL (
       SELECT fi.market_price_snapshot_resource_version_id
       FROM file_inspection fi
       WHERE fi.project_id = p.project_id
         AND fi.outcome = 'passed'
         AND fi.mapping_status = 'confirmed'
         AND fi.workbook_resource_version_id = wv.resource_version_id
         AND fi.mapping_set_resource_version_id = msv.resource_version_id
         AND fi.market_price_snapshot_resource_version_id IS NOT NULL
       ORDER BY fi.completed_at DESC
       LIMIT 1
     ) inspection ON true
     JOIN market_price_snapshot_version price
       ON price.resource_version_id = inspection.market_price_snapshot_resource_version_id
     WHERE p.project_id = $1 AND p.owner_user_id = $2
       AND p.deleted_at IS NULL
       AND NOT EXISTS (
         SELECT 1
         FROM validation_conflict conflict
         WHERE conflict.project_id = p.project_id
           AND conflict.validation_run_id = validation.validation_run_id
           AND conflict.status = 'unresolved'
       )
     LIMIT 1`,
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
      throw new ApiError(404, "PROJECT_NOT_FOUND", "프로젝트를 찾을 수 없습니다.");
    }
    throw new ApiError(
      409,
      "VALUATION_PREREQUISITE_INCOMPLETE",
      "조사 결과 검증과 Excel 적합성 검사를 완료해주세요.",
      {
        meta: {
          resumeRoute: resumeRouteForBlocker({
            projectId,
            fallbackStage: "validation",
          }),
        },
      },
    );
  }
  if (!row.price_snapshot_id || !row.close_price || !row.trading_date) {
    throw new ApiError(
      409,
      "VALUATION_PREREQUISITE_INCOMPLETE",
      "기준일 현재주가를 확인할 수 없습니다.",
      {
        meta: {
          resumeRoute: resumeRouteForBlocker({
            projectId,
            fallbackStage: "files",
          }),
        },
      },
    );
  }
  const mappedOutputBindings = await loadRequiredWorkbookOutputBindings(
    client,
    row.mapping_set_resource_version_id,
  );
  if (mappedOutputBindings.length !== 3) {
    throw new ApiError(
      409,
      "MAPPING_REVALIDATION_REQUIRED",
      "Forward EPS, Target PER, 목표주가 매핑을 다시 확인해주세요.",
      {
        meta: {
          resumeRoute: resumeRouteForBlocker({
            projectId,
            fallbackStage: "files",
          }),
        },
      },
    );
  }
  const applicationCommands = new Map(
    (row.application_plan_json.commands ?? []).map((command) => [
      command.targetId,
      command,
    ]),
  );
  const outputBindings: OutputBinding[] = mappedOutputBindings.map(
    (binding) => {
      const command = applicationCommands.get(binding.targetId);
      return command?.generatedBridge
        ? {
            metric: binding.metric,
            sheetId: "_REFLO_BRIDGE",
            address: command.address,
            expectedFormulaHash: null,
            expectedStructureFingerprint: null,
          }
        : {
            metric: binding.metric,
            sheetId: binding.sheetId,
            address: binding.address,
            expectedFormulaHash: binding.expectedFormulaHash,
            expectedStructureFingerprint:
              binding.expectedStructureFingerprint,
          };
    },
  );
  const validatedSources = await client.query<{
    source_version_id: string;
  }>(
    `SELECT DISTINCT evidence.source_version_id
     FROM evidence
     JOIN validation_result result
       ON result.validation_run_id = evidence.validation_run_id
      AND evidence.evidence_id = ANY(result.evidence_ids)
     WHERE evidence.project_id = $1
       AND evidence.validation_run_id = $2
       AND result.machine_status = 'passed'
     ORDER BY evidence.source_version_id`,
    [projectId, row.validation_run_id],
  );
  const validationInputResourceVersionIds = [
    ...new Set([
      row.approved_plan_resource_version_id,
      row.validated_value_set_resource_version_id,
      row.validated_workbook_resource_version_id,
      ...validatedSources.rows.map((source) => source.source_version_id),
    ]),
  ].sort((left, right) => left.localeCompare(right));
  const inputFingerprint = contentHash({
    validationApprovalId: row.validation_approval_id,
    validatedValueSetResourceVersionId:
      row.validated_value_set_resource_version_id,
    validatedWorkbookResourceVersionId:
      row.validated_workbook_resource_version_id,
    validatedWorkbookArtifactId: row.artifact_id,
    validatedWorkbookSha256: row.sha256,
    validationInputResourceVersionIds,
    workbookResourceVersionId: row.workbook_resource_version_id,
    mappingSetResourceVersionId: row.mapping_set_resource_version_id,
    structureHash: row.structure_hash,
    priceSnapshotId: row.price_snapshot_id,
  });
  return {
    projectId: row.project_id,
    projectName: row.project_name,
    companyName: row.company_name,
    ticker: row.ticker,
    targetYear: row.target_year,
    targetQuarter: row.target_quarter,
    cutoffDate: row.cutoff_date,
    validationApprovalId: row.validation_approval_id,
    validatedValueSetResourceVersionId:
      row.validated_value_set_resource_version_id,
    validatedWorkbookResourceVersionId:
      row.validated_workbook_resource_version_id,
    sourceWorkbookResourceVersionId: row.workbook_resource_version_id,
    mappingSetResourceVersionId: row.mapping_set_resource_version_id,
    structureHash: row.structure_hash,
    sourceArtifactId: row.artifact_id,
    sourceObjectKey: row.object_key,
    sourceFilename: row.original_filename ?? "분석_workbook.xlsx",
    sourceSha256: row.sha256,
    priceSnapshotId: row.price_snapshot_id,
    validationInputResourceVersionIds,
    currentPrice: row.close_price,
    tradingDate: row.trading_date,
    inputFingerprint,
    outputBindings,
  };
}

async function callExcel<T>(
  path: string,
  body: unknown,
): Promise<T> {
  const base =
    process.env.REFLO_EXCEL_WORKER_URL?.trim() || "http://127.0.0.1:8092";
  const response = await fetch(`${base.replace(/\/$/, "")}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${requireWorkerToken()}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });
  const payload = (await response.json()) as {
    error?: { code?: string; message?: string; details?: unknown[] };
  };
  if (!response.ok) {
    const code = payload.error?.code ?? "FORMULA_CALCULATION_FAILED";
    throw new ApiError(
      response.status === 422 ? 422 : 503,
      code,
      payload.error?.message ?? "Excel 계산 서비스가 응답하지 않았습니다.",
      {
        retryable: response.status >= 500,
        details: Array.isArray(payload.error?.details)
          ? (payload.error?.details as never[])
          : [],
      },
    );
  }
  return payload as T;
}

function requireWorkerToken(): string {
  const value = process.env.REFLO_WORKER_TOKEN?.trim();
  if (!value) {
    throw new ApiError(
      503,
      "WORKER_CONFIGURATION_REQUIRED",
      "Excel 계산 서비스 인증 설정이 필요합니다.",
      { retryable: false },
    );
  }
  return value;
}

async function readWorkbookState(
  client: TransactionClient,
  projectId: string,
  lock = false,
): Promise<WorkbookState | null> {
  const result = await client.query<{
    validation_approval_id: string;
    validated_value_set_resource_version_id: string;
    validated_workbook_resource_version_id: string;
    source_workbook_resource_version_id: string;
    mapping_set_resource_version_id: string;
    structure_hash: string;
    input_fingerprint: string;
    source_artifact_id: string;
    source_artifact_hash: string;
    workbook_version: string;
    editable_cell_set_version: string;
    current_artifact_id: string;
    object_key: string;
    read_model_json: ReadModel;
    calculation_status: string;
    saved_at: Date;
  }>(
    `SELECT vw.validation_approval_id,
       vw.validated_value_set_resource_version_id,
       vw.validated_workbook_resource_version_id,
       vw.source_workbook_resource_version_id,
       vw.mapping_set_resource_version_id, vw.structure_hash,
       vw.input_fingerprint, vw.workbook_version,
       vw.editable_cell_set_version,
       vw.source_artifact_id, source_artifact.sha256
         AS source_artifact_hash,
       vw.current_artifact_id, current_artifact.object_key,
       vw.read_model_json,
       vw.calculation_status, vw.saved_at
     FROM valuation_workbook vw
     JOIN artifact current_artifact
       ON current_artifact.artifact_id = vw.current_artifact_id
     JOIN artifact source_artifact
       ON source_artifact.artifact_id = vw.source_artifact_id
     WHERE vw.project_id = $1
     ${lock ? "FOR UPDATE OF vw" : ""}`,
    [projectId],
  );
  const row = result.rows[0];
  return row
    ? {
        validationApprovalId: row.validation_approval_id,
        validatedValueSetResourceVersionId:
          row.validated_value_set_resource_version_id,
        validatedWorkbookResourceVersionId:
          row.validated_workbook_resource_version_id,
        sourceWorkbookResourceVersionId:
          row.source_workbook_resource_version_id,
        mappingSetResourceVersionId: row.mapping_set_resource_version_id,
        structureHash: row.structure_hash,
        inputFingerprint: row.input_fingerprint,
        sourceArtifactId: row.source_artifact_id,
        sourceArtifactHash: row.source_artifact_hash,
        workbookVersion: Number(row.workbook_version),
        editableCellSetVersion: Number(row.editable_cell_set_version),
        currentArtifactId: row.current_artifact_id,
        currentObjectKey: row.object_key,
        readModel: row.read_model_json,
        calculationStatus: row.calculation_status,
        savedAt: row.saved_at.toISOString(),
      }
    : null;
}

function workbookInputsMatch(state: WorkbookState, context: Context) {
  const stateLineage: ValuationWorkbookLineage = {
    validationApprovalId: state.validationApprovalId,
    validatedValueSetResourceVersionId:
      state.validatedValueSetResourceVersionId,
    validatedWorkbookResourceVersionId:
      state.validatedWorkbookResourceVersionId,
    sourceWorkbookResourceVersionId:
      state.sourceWorkbookResourceVersionId,
    mappingSetResourceVersionId: state.mappingSetResourceVersionId,
    workbookArtifactId: state.sourceArtifactId,
    workbookHash: state.sourceArtifactHash,
    structureHash: state.structureHash,
    inputFingerprint: state.inputFingerprint,
  };
  const currentLineage: ValuationWorkbookLineage = {
    validationApprovalId: context.validationApprovalId,
    validatedValueSetResourceVersionId:
      context.validatedValueSetResourceVersionId,
    validatedWorkbookResourceVersionId:
      context.validatedWorkbookResourceVersionId,
    sourceWorkbookResourceVersionId:
      context.sourceWorkbookResourceVersionId,
    mappingSetResourceVersionId: context.mappingSetResourceVersionId,
    workbookArtifactId: context.sourceArtifactId,
    workbookHash: context.sourceSha256,
    structureHash: context.structureHash,
    inputFingerprint: context.inputFingerprint,
  };
  return valuationWorkbookLineageIsCurrent(stateLineage, currentLineage);
}

function workbookMatchesContext(state: WorkbookState, context: Context) {
  return (
    workbookInputsMatch(state, context) &&
    state.calculationStatus === "success" &&
    state.readModel.schemaVersion === "1.2"
  );
}

function mergeEditableCellMetadata(
  authoritative: EditableCell[],
  analyzed: EditableCell[],
): EditableCell[] {
  const analyzedByKey = new Map(
    analyzed.map((cell) => [
      `${cell.sheetId}:${cell.address}`,
      cell,
    ]),
  );
  return authoritative.map((cell) => {
    const next = analyzedByKey.get(`${cell.sheetId}:${cell.address}`);
    return {
      ...cell,
      impactTypes: next?.impactTypes ?? cell.impactTypes ?? ["unmapped"],
      activeInCurrentMode:
        next?.activeInCurrentMode ?? cell.activeInCurrentMode ?? null,
      downstreamOutputs:
        next?.downstreamOutputs ?? cell.downstreamOutputs ?? [],
    };
  });
}

async function ensureWorkbook(
  projectId: string,
  userId: string,
): Promise<{ context: Context; state: WorkbookState }> {
  const found = await withTransaction(async (client) => {
    const context = await projectContext(client, projectId, userId);
    return { context, state: await readWorkbookState(client, projectId) };
  });
  if (found.state && workbookMatchesContext(found.state, found.context)) {
    return { context: found.context, state: found.state };
  }

  const refreshCurrentReadModel =
    found.state &&
    workbookInputsMatch(found.state, found.context) &&
    found.state.calculationStatus === "success";
  const downloadUrl = await createWorkerDownloadUrl(
    refreshCurrentReadModel && found.state
      ? found.state.currentObjectKey
      : found.context.sourceObjectKey,
    10 * 60,
  );
  const readModel = await callExcel<ReadModel>("/valuation/read-model", {
    downloadUrl,
    outputBindings: found.context.outputBindings,
  });
  return withTransaction(async (client) => {
    await client.query(
      `SELECT pg_advisory_xact_lock(
         hashtextextended($1, 0)
       )`,
      [`valuation.initialize:${projectId}`],
    );
    const context = await projectContext(client, projectId, userId);
    const current = await readWorkbookState(client, projectId, true);
    if (current && workbookMatchesContext(current, context)) {
      return { context, state: current };
    }
    if (context.inputFingerprint !== found.context.inputFingerprint) {
      throw new ApiError(
        409,
        "VALUATION_PREREQUISITE_CHANGED",
        "선행 단계가 변경되었습니다. 최신 결과를 다시 불러와주세요.",
        {
          meta: {
            resumeRoute: resumeRouteForBlocker({
              projectId,
              fallbackStage: "validation",
            }),
          },
        },
      );
    }
    const metadataRefresh =
      current &&
      workbookInputsMatch(current, context) &&
      current.calculationStatus === "success";
    const workbookVersion = metadataRefresh
      ? current.workbookVersion
      : current
        ? current.workbookVersion + 1
        : 1;
    const editableCellSetVersion = metadataRefresh
      ? current.editableCellSetVersion
      : current
        ? current.editableCellSetVersion + 1
        : 1;
    const currentArtifactId = metadataRefresh
      ? current.currentArtifactId
      : context.sourceArtifactId;
    let persistedReadModel = readModel;
    if (metadataRefresh) {
      const calculation = await client.query<{
        outputs_json: ReadModel["outputs"];
      }>(
        `SELECT outputs_json
         FROM valuation_calculation_run
         WHERE project_id = $1
           AND output_workbook_version = $2
           AND output_artifact_id = $3
           AND status = 'success'
         ORDER BY created_at DESC
         LIMIT 1`,
        [projectId, current.workbookVersion, current.currentArtifactId],
      );
      const editableKeys = new Set(
        current.readModel.editableCells.map(
          (cell) => `${cell.sheetId}:${cell.address}`,
        ),
      );
      persistedReadModel = {
        ...readModel,
        editableCells: mergeEditableCellMetadata(
          current.readModel.editableCells,
          readModel.editableCells,
        ),
        outputs:
          calculation.rows[0]?.outputs_json ?? current.readModel.outputs,
        sheets: readModel.sheets.map((sheet) => ({
          ...sheet,
          cells: sheet.cells.map((cell) => {
            const editable = editableKeys.has(
              `${sheet.sheetId}:${cell.address}`,
            );
            return {
              ...cell,
              editable,
              readOnlyReason: editable ? null : "NOT_ALLOWLISTED",
            };
          }),
        })),
      };
    }
    await client.query(
      `INSERT INTO valuation_workbook (
         project_id, source_workbook_resource_version_id, source_artifact_id,
         current_artifact_id, workbook_version, editable_cell_set_version,
         structure_hash, read_model_json, calculation_status,
         mapping_set_resource_version_id, input_fingerprint,
         validation_approval_id,
         validated_value_set_resource_version_id,
         validated_workbook_resource_version_id
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, 'success',
         $9, $10, $11, $12, $13)
       ON CONFLICT (project_id) DO UPDATE SET
         source_workbook_resource_version_id =
           EXCLUDED.source_workbook_resource_version_id,
         source_artifact_id = EXCLUDED.source_artifact_id,
         current_artifact_id = EXCLUDED.current_artifact_id,
         workbook_version = EXCLUDED.workbook_version,
         editable_cell_set_version = EXCLUDED.editable_cell_set_version,
         structure_hash = EXCLUDED.structure_hash,
         read_model_json = EXCLUDED.read_model_json,
         calculation_status = 'success',
         mapping_set_resource_version_id =
           EXCLUDED.mapping_set_resource_version_id,
         input_fingerprint = EXCLUDED.input_fingerprint,
         validation_approval_id = EXCLUDED.validation_approval_id,
         validated_value_set_resource_version_id =
           EXCLUDED.validated_value_set_resource_version_id,
         validated_workbook_resource_version_id =
           EXCLUDED.validated_workbook_resource_version_id,
         saved_at = now()`,
      [
        projectId,
        context.sourceWorkbookResourceVersionId,
        context.sourceArtifactId,
        currentArtifactId,
        workbookVersion,
        editableCellSetVersion,
        context.structureHash,
        JSON.stringify(persistedReadModel),
        context.mappingSetResourceVersionId,
        context.inputFingerprint,
        context.validationApprovalId,
        context.validatedValueSetResourceVersionId,
        context.validatedWorkbookResourceVersionId,
      ],
    );
    const state = await readWorkbookState(client, projectId);
    if (!state) throw new Error("VALUATION_WORKBOOK_INITIALIZATION_FAILED");
    if (!metadataRefresh) {
      await client.query(
        `INSERT INTO valuation_calculation_run (
           calculation_run_id, project_id, input_workbook_version,
           output_workbook_version, status, engine_name, engine_version,
           outputs_json, result_hash, duration_ms, output_artifact_id
         ) VALUES ($1, $2, $3, $3, 'success', 'ClosedXML', '0.105.0',
           $4::jsonb, $5, 0, $6)`,
        [
          uuidv7(),
          projectId,
          workbookVersion,
          JSON.stringify(readModel.outputs),
          readModel.workbookHash || context.sourceSha256,
          context.sourceArtifactId,
        ],
      );
    }
    if (current && !metadataRefresh) {
      await invalidateValuationAndDownstream(client, context, [
        "UPSTREAM_INPUT_CHANGED",
      ]);
    }
    return { context, state };
  });
}

function normalizeChanges(value: unknown): CellChange[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 500) {
    throw new ApiError(
      400,
      "INVALID_CELL_VALUE",
      "1개 이상 500개 이하 셀 변경이 필요합니다.",
    );
  }
  const seen = new Set<string>();
  return value.map((item) => {
    const change = item as Partial<CellChange>;
    if (
      typeof change.sheetId !== "string" ||
      typeof change.address !== "string" ||
      !/^[A-Z]{1,3}[1-9]\d{0,6}$/.test(change.address) ||
      !["number", "string", "boolean", "blank"].includes(change.valueType ?? "") ||
      (change.valueType !== "blank" && typeof change.value !== "string") ||
      (change.valueType === "blank" &&
        change.value !== null &&
        change.value !== undefined)
    ) {
      throw new ApiError(400, "INVALID_CELL_VALUE", "셀 입력 형식이 올바르지 않습니다.");
    }
    const key = `${change.sheetId}:${change.address}`;
    if (seen.has(key)) {
      throw new ApiError(
        400,
        "DUPLICATE_CELL_ADDRESS",
        "한 요청에서 같은 셀을 두 번 변경할 수 없습니다.",
      );
    }
    seen.add(key);
    if (
      change.valueType === "string" &&
      /^(?:=|\+|-|@)/.test(change.value ?? "")
    ) {
      throw new ApiError(
        400,
        "FORMULA_INPUT_NOT_ALLOWED",
        "수식 입력은 허용되지 않습니다.",
      );
    }
    if (
      change.valueType === "string" &&
      (change.value?.length ?? 0) > 2_000
    ) {
      throw new ApiError(
        400,
        "INVALID_CELL_VALUE",
        "문자열 셀은 2,000자 이하로 입력해주세요.",
      );
    }
    if (change.valueType === "boolean" && !/^(?:true|false)$/.test(change.value!)) {
      throw new ApiError(
        400,
        "INVALID_CELL_VALUE",
        "불리언 셀은 true 또는 false만 사용할 수 있습니다.",
      );
    }
    if (change.valueType === "number") {
      try {
        const number = new Decimal(change.value!);
        if (!number.isFinite() || number.abs().gt("1e15")) throw new Error();
      } catch {
        throw new ApiError(
          400,
          "INVALID_CELL_VALUE",
          "숫자 셀 값이 올바르지 않습니다.",
        );
      }
    }
    return {
      sheetId: change.sheetId,
      address: change.address,
      valueType: change.valueType as CellChange["valueType"],
      value: change.valueType === "blank" ? null : change.value!,
    };
  });
}

async function invalidateValuationAndDownstream(
  client: TransactionClient,
  context: Context,
  reasonCodes: string[],
) {
  await client.query(
    `UPDATE valuation_draft
     SET status = 'revalidation_required', updated_at = now()
     WHERE project_id = $1 AND status <> 'revalidation_required'`,
    [context.projectId],
  );
  const invalidatedApprovals = await client.query<{
    resource_version_id: string;
  }>(
    `UPDATE resource_version resource
     SET validity_status = 'revalidation_required',
         lifecycle_status = 'superseded'
     FROM valuation_approval approval
     WHERE approval.resource_version_id = resource.resource_version_id
       AND approval.project_id = $1
       AND approval.status = 'approved'
     RETURNING resource.resource_version_id`,
    [context.projectId],
  );
  await invalidateResourceDependents(client, {
    projectId: context.projectId,
    upstreamResourceVersionIds: invalidatedApprovals.rows.map(
      (row) => row.resource_version_id,
    ),
  });
  await client.query(
    `UPDATE valuation_approval
     SET status = 'superseded'
     WHERE project_id = $1 AND status = 'approved'`,
    [context.projectId],
  );
  await invalidateProjectStages(client, {
    projectId: context.projectId,
    triggerVersionId: context.sourceWorkbookResourceVersionId,
    startStageKey: "valuation",
    reasonCode: reasonCodes.join("+"),
    transitions: [
      {
        stageKey: "valuation",
        stageStatus: "in_progress",
        blockerCodes: ["VALUATION_REAPPROVAL_REQUIRED"],
        clearCompletion: true,
        eligibleStatuses: ["completed", "revalidation_required"],
      },
      {
        stageKey: "report_outline",
        stageStatus: "revalidation_required",
        blockerCodes: ["VALUATION_CHANGED"],
        clearCompletion: true,
        eligibleStatuses: [
          "in_progress",
          "completed",
          "revalidation_required",
        ],
      },
    ],
  });
  await client.query(
    `UPDATE project
     SET current_stage = 'valuation', row_version = row_version + 1,
         updated_at = now(), last_saved_at = now()
     WHERE project_id = $1 AND current_stage = 'report_outline'`,
    [context.projectId],
  );
}

async function calculateAndSave(
  client: TransactionClient,
  input: {
    context: Context;
    state: WorkbookState;
    userId: string;
    requestId: string;
    changes: CellChange[];
  },
) {
  const editable = new Map(
    input.state.readModel.editableCells.map(
      (cell) => [`${cell.sheetId}:${cell.address}`, cell],
    ),
  );
  for (const change of input.changes) {
    const allowed = editable.get(`${change.sheetId}:${change.address}`);
    if (!allowed) {
      throw new ApiError(
        422,
        "READ_ONLY_CELL",
        "읽기 전용 셀이 포함되어 전체 변경을 취소했습니다.",
      );
    }
    const typeMatches =
      change.valueType === "blank"
        ? !allowed.required
        : allowed.valueType === "decimal" ||
            allowed.valueType === "integer"
          ? change.valueType === "number"
          : allowed.valueType === "boolean"
            ? change.valueType === "boolean"
            : change.valueType === "string";
    if (!typeMatches) {
      throw new ApiError(
        422,
        "CELL_VALUE_TYPE_MISMATCH",
        `${allowed.sheetName}!${allowed.address} 셀 형식과 입력값 형식이 다릅니다.`,
      );
    }
  }

  const downloadUrl = await createWorkerDownloadUrl(
    input.state.currentObjectKey,
    10 * 60,
  );
  const result = await callExcel<WorkerCalculation>("/valuation/calculate", {
    downloadUrl,
    changes: input.changes,
    allowedCells: input.state.readModel.editableCells.map((cell) => ({
      sheetId: cell.sheetId,
      address: cell.address,
      valueType: cell.valueType,
      required: cell.required,
    })),
    outputBindings: input.context.outputBindings,
  });
  const allowedKeys = new Set(editable.keys());
  const nextReadModel: ReadModel = {
    ...result.readModel,
    editableCells: mergeEditableCellMetadata(
      input.state.readModel.editableCells,
      result.readModel.editableCells,
    ),
    sheets: result.readModel.sheets.map((sheet) => ({
      ...sheet,
      cells: sheet.cells.map((cell) => {
        const isEditable = allowedKeys.has(`${sheet.sheetId}:${cell.address}`);
        return {
          ...cell,
          editable: isEditable,
          readOnlyReason: isEditable
            ? null
            : cell.formula
              ? "수식 결과"
              : "읽기 전용",
        };
      }),
    })),
  };
  const workbookBytes = Buffer.from(result.workbookBase64, "base64");
  if (sha256(workbookBytes) !== result.workbookHash) {
    throw new ApiError(
      503,
      "CALCULATION_SESSION_UNAVAILABLE",
      "Excel 계산 결과 무결성을 확인하지 못했습니다.",
      { retryable: true },
    );
  }
  const nextVersion = input.state.workbookVersion + 1;
  const objectKey =
    `projects/${input.context.projectId}/valuation/` +
    `workbook-v${nextVersion}-${result.workbookHash.slice(0, 12)}.xlsx`;
  const stored = await putImmutableObject({
    objectKey,
    body: workbookBytes,
    mediaType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    metadata: {
      project: input.context.projectId,
      workbookVersion: String(nextVersion),
      engine: "ClosedXML-0.105.0",
    },
  });
  const artifactId = uuidv7();
  await client.query(
    `INSERT INTO artifact (
       artifact_id, project_id, artifact_kind, storage_status, bucket_name,
       object_key, object_version, sha256, byte_size, media_type,
       original_filename, retention_class, created_by_actor_type,
       supersedes_artifact_id
     ) VALUES ($1, $2, 'working_copy', 'accepted', $3, $4, $5, $6, $7,
       $8, $9, 'project', 'system', $10)`,
    [
      artifactId,
      input.context.projectId,
      objectStoreBucket(),
      objectKey,
      stored.objectVersion,
      result.workbookHash,
      workbookBytes.byteLength,
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      input.context.sourceFilename,
      input.state.currentArtifactId,
    ],
  );
  const calculationRunId = uuidv7();
  await client.query(
    `INSERT INTO valuation_calculation_run (
       calculation_run_id, project_id, input_workbook_version,
       output_workbook_version, status, engine_name, engine_version,
       outputs_json, result_hash, duration_ms, output_artifact_id
     ) VALUES ($1, $2, $3, $4, 'success', 'ClosedXML', '0.105.0',
       $5::jsonb, $6, $7, $8)`,
    [
      calculationRunId,
      input.context.projectId,
      input.state.workbookVersion,
      nextVersion,
      JSON.stringify(nextReadModel.outputs),
      result.workbookHash,
      result.durationMs,
      artifactId,
    ],
  );
  for (const [index, change] of input.changes.entries()) {
    const before = result.before[index];
    const after =
      result.appliedChanges.find(
        (cell) =>
          cell.sheetId === change.sheetId && cell.address === change.address,
      ) ?? null;
    await client.query(
      `INSERT INTO valuation_cell_change (
         cell_change_id, project_id, calculation_run_id, request_id,
         sheet_id, address, value_type, before_value, after_value,
         workbook_version_before, workbook_version_after, changed_by_user_id
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        uuidv7(),
        input.context.projectId,
        calculationRunId,
        input.requestId,
        change.sheetId,
        change.address,
        change.valueType,
        before?.rawValue ?? null,
        after?.rawValue ?? change.value,
        input.state.workbookVersion,
        nextVersion,
        input.userId,
      ],
    );
  }
  await client.query(
    `UPDATE valuation_workbook
     SET current_artifact_id = $2, workbook_version = $3,
       read_model_json = $4::jsonb, calculation_status = 'success',
       saved_at = now()
     WHERE project_id = $1`,
    [
      input.context.projectId,
      artifactId,
      nextVersion,
      JSON.stringify(nextReadModel),
    ],
  );
  await invalidateValuationAndDownstream(client, input.context, [
    "VALUATION_WORKBOOK_CHANGED",
  ]);
  const state = await readWorkbookState(client, input.context.projectId);
  const previousFormulaValues = new Map(
    input.state.readModel.sheets.flatMap((sheet) =>
      sheet.cells
        .filter((cell) => cell.formula)
        .map((cell) => [
          `${sheet.sheetId}:${cell.address}`,
          `${cell.rawValue ?? ""}\u001f${cell.formattedText}`,
        ]),
    ),
  );
  const affectedCells = nextReadModel.sheets.flatMap((sheet) =>
    sheet.cells.filter((cell) => {
      if (!cell.formula) return false;
      return (
        previousFormulaValues.get(`${sheet.sheetId}:${cell.address}`) !==
        `${cell.rawValue ?? ""}\u001f${cell.formattedText}`
      );
    }),
  );
  return {
    workbookVersion: nextVersion,
    state,
    calculationRunId,
    appliedChanges: result.appliedChanges,
    affectedCells,
    outputDiff: outputDiff(
      input.state.readModel.outputs,
      nextReadModel.outputs,
    ),
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

export async function getValuationWorkspace(
  projectId: string,
  userId: string,
) {
  const { context, state } = await ensureWorkbook(projectId, userId);
  return withTransaction(async (client) => {
    const draft = await client.query<{
      draft_version: string;
      workbook_version: string;
      input_mode: "target_per" | "target_price";
      target_per: string;
      requested_target_price: string | null;
      forward_eps: string;
      target_price: string;
      current_price: string;
      current_price_snapshot_resource_version_id: string;
      upside: string;
      status: string;
      updated_at: Date;
    }>(
      `SELECT draft_version, workbook_version, input_mode, target_per,
         requested_target_price, forward_eps, target_price, current_price,
         current_price_snapshot_resource_version_id,
         upside, status, updated_at
       FROM valuation_draft WHERE project_id = $1`,
      [projectId],
    );
    const approval = await client.query<{
      approval_version: string;
      workbook_version: string;
      draft_version: string;
      target_per: string;
      target_price: string;
      forward_eps: string;
      current_price: string;
      upside: string;
      status: string;
      approved_at: Date;
      calculation_run_id: string;
      current_price_snapshot_resource_version_id: string;
      source_workbook_resource_version_id: string;
      mapping_set_resource_version_id: string;
      workbook_artifact_id: string;
      structure_hash: string;
      input_fingerprint: string;
    }>(
      `SELECT approval_version, workbook_version, draft_version, target_per,
         target_price, forward_eps, current_price, upside, status, approved_at,
         calculation_run_id, current_price_snapshot_resource_version_id,
         source_workbook_resource_version_id, mapping_set_resource_version_id,
         workbook_artifact_id, structure_hash, input_fingerprint
       FROM valuation_approval
       WHERE project_id = $1
       ORDER BY approval_version DESC LIMIT 1`,
      [projectId],
    );
    const latestRun = await client.query<{
      calculation_run_id: string;
      status: string;
      outputs_json: ReadModel["outputs"];
      output_artifact_id: string | null;
      created_at: Date;
    }>(
      `SELECT calculation_run_id, status, outputs_json, output_artifact_id,
         created_at
       FROM valuation_calculation_run
       WHERE project_id = $1 AND output_workbook_version = $2
       ORDER BY created_at DESC LIMIT 1`,
      [projectId, state.workbookVersion],
    );
    const currentDraft = draft.rows[0] ?? null;
    const currentApproval = approval.rows[0] ?? null;
    const currentRun = latestRun.rows[0] ?? null;
    const requiredMissing = missingRequiredCells(state.readModel);
    const outputsValid =
      isPositiveDecimal(state.readModel.outputs.forwardEps?.rawValue) &&
      isPositiveDecimal(state.readModel.outputs.targetPer?.rawValue) &&
      isPositiveDecimal(state.readModel.outputs.targetPrice?.rawValue);
    const calculationCurrent =
      state.calculationStatus === "success" &&
      currentRun?.status === "success" &&
      currentRun.output_artifact_id === state.currentArtifactId;
    const draftCurrent =
      Boolean(currentDraft) &&
      currentDraft?.status !== "revalidation_required" &&
      Number(currentDraft?.workbook_version) === state.workbookVersion &&
      currentDraft?.current_price_snapshot_resource_version_id ===
        context.priceSnapshotId;
    const draftMatchesOutputs =
      draftCurrent &&
      sameDecimal(
        currentDraft?.forward_eps,
        state.readModel.outputs.forwardEps?.rawValue,
      ) &&
      sameDecimal(
        currentDraft?.target_per,
        state.readModel.outputs.targetPer?.rawValue,
        1,
      ) &&
      sameDecimal(
        currentDraft?.target_price,
        state.readModel.outputs.targetPrice?.rawValue,
      ) &&
      sameDecimal(currentDraft?.current_price, context.currentPrice);
    const approvalCurrent =
      currentApproval?.status === "approved" &&
      Number(currentApproval.workbook_version) === state.workbookVersion &&
      Number(currentApproval.draft_version) ===
        Number(currentDraft?.draft_version ?? 0) &&
      currentApproval.calculation_run_id === currentRun?.calculation_run_id &&
      currentApproval.current_price_snapshot_resource_version_id ===
        context.priceSnapshotId &&
      currentApproval.source_workbook_resource_version_id ===
        context.sourceWorkbookResourceVersionId &&
      currentApproval.mapping_set_resource_version_id ===
        context.mappingSetResourceVersionId &&
      currentApproval.workbook_artifact_id === state.currentArtifactId &&
      currentApproval.structure_hash === context.structureHash &&
      currentApproval.input_fingerprint === context.inputFingerprint;
    const invariantBlockers = [
      ...(workbookMatchesContext(state, context)
        ? []
        : ["VALUATION_PREREQUISITE_CHANGED"]),
      ...(calculationCurrent ? [] : ["CALCULATION_NOT_CURRENT"]),
      ...(outputsValid ? [] : ["VALUATION_OUTPUT_INVALID"]),
      ...(requiredMissing.length === 0
        ? []
        : ["REQUIRED_INPUT_MISSING"]),
      ...(currentDraft ? [] : ["VALUATION_DRAFT_REQUIRED"]),
      ...(draftCurrent ? [] : ["DRAFT_REVALIDATION_REQUIRED"]),
      ...(draftMatchesOutputs ? [] : ["DRAFT_OUTPUT_MISMATCH"]),
    ];
    const canApprove =
      invariantBlockers.length === 0 &&
      currentDraft?.status === "draft";
    const canComplete =
      invariantBlockers.length === 0 &&
      currentDraft?.status === "approved" &&
      approvalCurrent;
    const blockers = [
      ...invariantBlockers,
      ...(canComplete ? [] : ["VALUATION_NOT_APPROVED"]),
    ];
    return {
      project: {
        projectId,
        name: context.projectName,
        companyName: context.companyName,
        ticker: context.ticker,
        targetPeriod: {
          year: context.targetYear,
          quarter: context.targetQuarter,
        },
        cutoffDate: context.cutoffDate,
      },
      workbook: {
        artifactId: state.currentArtifactId,
        originalWorkbookHash: context.sourceSha256,
        workbookVersion: state.workbookVersion,
        editableCellSetVersion: state.editableCellSetVersion,
        displayName: context.sourceFilename,
        readModelUrl: `/api/projects/${projectId}/valuation/workbook?version=${state.workbookVersion}`,
        visibleSheets: state.readModel.sheets
          .filter((sheet) => (sheet.visibility ?? "visible") === "visible")
          .map((sheet) => ({
            sheetId: sheet.sheetId,
            name: sheet.name,
            index: sheet.index,
            visibility: "visible" as const,
            usedRange: sheet.usedRange,
          })),
        savedAt: state.savedAt,
      },
      permissions: {
        editableCellSetVersion: state.editableCellSetVersion,
        editableCells: state.readModel.editableCells,
        requiredEditableCells: state.readModel.editableCells.filter(
          (cell) => cell.required,
        ),
      },
      calculation: {
        calculationRunId: latestRun.rows[0]?.calculation_run_id ?? null,
        status: state.calculationStatus,
        forwardEps: state.readModel.outputs.forwardEps,
        targetPerCell: state.readModel.outputs.targetPer,
        targetPrice: state.readModel.outputs.targetPrice,
        calculatedAt: latestRun.rows[0]?.created_at.toISOString() ?? state.savedAt,
      },
      references: state.readModel.outputs.targetPer
        ? [
            {
              label: "Excel 기준값",
              rawValue: state.readModel.outputs.targetPer.rawValue,
              formattedText: state.readModel.outputs.targetPer.formattedText,
              source: `${state.readModel.outputs.targetPer.sheetName}!${state.readModel.outputs.targetPer.address}`,
            },
          ]
        : [],
      currentPrice: {
        snapshotId: context.priceSnapshotId,
        rawValue: context.currentPrice,
        formattedText: `${new Decimal(context.currentPrice)
          .toFixed(0)
          .replace(/\B(?=(\d{3})+(?!\d))/g, ",")}원`,
        tradingDate: context.tradingDate,
        currency: "KRW",
        provider: "KRX",
      },
      valuationDraft: currentDraft
        ? {
            draftVersion: Number(currentDraft.draft_version),
            workbookVersion: Number(currentDraft.workbook_version),
            inputMode: currentDraft.input_mode,
            targetPer: currentDraft.target_per,
            requestedTargetPrice: currentDraft.requested_target_price,
            targetPrice: currentDraft.target_price,
            formattedTargetPrice: formattedMoney(currentDraft.target_price),
            forwardEps: currentDraft.forward_eps,
            currentPrice: currentDraft.current_price,
            upside: currentDraft.upside,
            formattedUpside: formattedUpside(currentDraft.upside),
            status: currentDraft.status,
            updatedAt: currentDraft.updated_at.toISOString(),
          }
        : null,
      approval: approvalCurrent && currentApproval
        ? {
            approvalVersion: Number(currentApproval.approval_version),
            workbookVersion: Number(currentApproval.workbook_version),
            draftVersion: Number(currentApproval.draft_version),
            targetPer: currentApproval.target_per,
            targetPrice: currentApproval.target_price,
            forwardEps: currentApproval.forward_eps,
            currentPrice: currentApproval.current_price,
            upside: currentApproval.upside,
            status: currentApproval.status,
            approvedAt: currentApproval.approved_at.toISOString(),
          }
        : null,
      completion: { canApprove, canComplete, blockers },
      workflow: { stageStates: await workflowState(client, projectId) },
      navigation: {
        previousRoute: processRoute(projectId, "validation"),
        nextRoute: processRoute(projectId, "report_outline"),
      },
    };
  });
}

export async function getValuationWorkbook(
  projectId: string,
  userId: string,
  version: unknown,
) {
  const expected = requireVersion(version, "workbook");
  const { state } = await ensureWorkbook(projectId, userId);
  if (state.workbookVersion !== expected) {
    throw new ApiError(
      409,
      "WORKBOOK_VERSION_MISMATCH",
      "최신 workbook을 다시 불러와주세요.",
    );
  }
  return {
    workbookVersion: state.workbookVersion,
    editableCellSetVersion: state.editableCellSetVersion,
    ...state.readModel,
  };
}

export async function patchValuationCells(input: {
  projectId: string;
  userId: string;
  workbookVersion: unknown;
  editableCellSetVersion: unknown;
  requestId: unknown;
  changes: unknown;
}) {
  await ensureWorkbook(input.projectId, input.userId);
  const workbookVersion = requireVersion(input.workbookVersion, "workbook");
  const editableVersion = requireVersion(
    input.editableCellSetVersion,
    "편집 권한",
  );
  const requestId = requireRequestId(input.requestId);
  const changes = normalizeChanges(input.changes);
  const requestHash = contentHash({
    workbookVersion,
    editableVersion,
    changes,
  });
  return withTransaction(async (client) => {
    await lockIdempotency(client, {
      userId: input.userId,
      operation: "valuation.cells.patch",
      projectId: input.projectId,
      key: requestId,
    });
    const prior = await replay(client, {
      userId: input.userId,
      operation: "valuation.cells.patch",
      projectId: input.projectId,
      key: requestId,
      requestHash,
    });
    if (prior) return prior.body;
    const context = await projectContext(client, input.projectId, input.userId);
    const state = await readWorkbookState(client, input.projectId, true);
    if (
      !state ||
      !workbookMatchesContext(state, context) ||
      state.workbookVersion !== workbookVersion
    ) {
      throw new ApiError(
        409,
        "STALE_WORKBOOK_VERSION",
        "최신 workbook을 불러온 뒤 다시 입력해주세요.",
      );
    }
    if (state.editableCellSetVersion !== editableVersion) {
      throw new ApiError(
        409,
        "EDITABLE_CELL_SET_CHANGED",
        "편집 가능한 셀 목록이 변경되었습니다.",
      );
    }
    const result = await calculateAndSave(client, {
      context,
      state,
      userId: input.userId,
      requestId,
      changes,
    });
    const body = {
      workbookVersion: result.workbookVersion,
      calculationRunId: result.calculationRunId,
      appliedChanges: result.appliedChanges,
      affectedCells: result.affectedCells,
      outputs: result.state?.readModel.outputs,
      outputDiff: result.outputDiff,
      affectedReportBindings: [],
      invalidatedResults: [
        "valuation_approval",
        "report_outline",
        "report_validation",
      ],
      savedAt: result.state?.savedAt,
    };
    await storeReplay(client, {
      userId: input.userId,
      operation: "valuation.cells.patch",
      projectId: input.projectId,
      key: requestId,
      requestHash,
      body,
    });
    return body;
  });
}

export async function updateValuationDraft(input: {
  projectId: string;
  userId: string;
  workbookVersion: unknown;
  draftVersion: unknown;
  requestId: unknown;
  inputMode: unknown;
  targetPer?: unknown;
  targetPrice?: unknown;
}) {
  await ensureWorkbook(input.projectId, input.userId);
  const workbookVersion = requireVersion(input.workbookVersion, "workbook");
  const expectedDraftVersion =
    input.draftVersion === null || input.draftVersion === undefined
      ? 0
      : Number(input.draftVersion);
  if (!Number.isInteger(expectedDraftVersion) || expectedDraftVersion < 0) {
    throw new ApiError(
      400,
      "INVALID_VERSION",
      "밸류에이션 draft 버전이 올바르지 않습니다.",
    );
  }
  const requestId = requireRequestId(input.requestId);
  if (input.inputMode !== "target_per" && input.inputMode !== "target_price") {
    throw new ApiError(
      400,
      "INVALID_VALUATION_INPUT_MODE",
      "입력 기준이 올바르지 않습니다.",
    );
  }
  const requestHash = contentHash({
    workbookVersion,
    expectedDraftVersion,
    inputMode: input.inputMode,
    targetPer: input.targetPer ?? null,
    targetPrice: input.targetPrice ?? null,
  });
  return withTransaction(async (client) => {
    await lockIdempotency(client, {
      userId: input.userId,
      operation: "valuation.draft.update",
      projectId: input.projectId,
      key: requestId,
    });
    const prior = await replay(client, {
      userId: input.userId,
      operation: "valuation.draft.update",
      projectId: input.projectId,
      key: requestId,
      requestHash,
    });
    if (prior) return prior.body;
    const context = await projectContext(client, input.projectId, input.userId);
    const state = await readWorkbookState(client, input.projectId, true);
    if (
      !state ||
      !workbookMatchesContext(state, context) ||
      state.workbookVersion !== workbookVersion
    ) {
      throw new ApiError(
        409,
        "STALE_WORKBOOK_VERSION",
        "최신 workbook을 불러온 뒤 다시 입력해주세요.",
      );
    }
    const draft = await client.query<{ draft_version: string }>(
      `SELECT draft_version FROM valuation_draft
       WHERE project_id = $1 FOR UPDATE`,
      [input.projectId],
    );
    const currentDraftVersion = Number(draft.rows[0]?.draft_version ?? 0);
    if (currentDraftVersion !== expectedDraftVersion) {
      throw new ApiError(
        409,
        "VALUATION_VERSION_CONFLICT",
        "최신 밸류에이션 입력값을 다시 불러와주세요.",
      );
    }
    const eps = state.readModel.outputs.forwardEps?.rawValue;
    if (!eps || new Decimal(eps).lte(0)) {
      throw new ApiError(
        422,
        "VALUATION_APPROVAL_BLOCKED",
        "Forward EPS 계산을 먼저 완료해주세요.",
      );
    }
    const requestedTargetPrice =
      input.inputMode === "target_price"
        ? canonicalTargetPrice(input.targetPrice)
        : null;
    const targetPer =
      input.inputMode === "target_per"
        ? canonicalTargetPer(input.targetPer)
        : inverseTargetPer(requestedTargetPrice!, eps);
    const targetPerBinding = context.outputBindings.find(
      (binding) => binding.metric === "target_per",
    );
    const targetPerOutput = targetPerBinding
      ? workbookCell(
          state.readModel,
          targetPerBinding.sheetId,
          targetPerBinding.address,
        )
      : null;
    const targetInputAddress = targetPerBinding
      ? previousRowAddress(targetPerBinding.address)
      : null;
    const targetCell = state.readModel.editableCells.find(
      (cell) =>
        cell.sheetId === targetPerBinding?.sheetId &&
        cell.address === targetInputAddress &&
        (cell.valueType === "decimal" || cell.valueType === "integer"),
    );
    const modeAddress = targetPerOutput?.formula
      ? /IF\(\s*([A-Z]{1,3}[1-9]\d{0,6})\s*=/i.exec(
          targetPerOutput.formula,
        )?.[1]?.toUpperCase()
      : null;
    const modeCell = state.readModel.editableCells.find(
      (cell) =>
        cell.sheetId === targetPerBinding?.sheetId &&
        cell.address === modeAddress &&
        cell.valueType === "string",
    );
    if (!targetCell || !modeCell) {
      throw new ApiError(
        409,
        "MAPPING_REVALIDATION_REQUIRED",
        "MappingSet과 Target PER 입력 구조를 다시 확인해주세요.",
        {
          meta: {
            resumeRoute: resumeRouteForBlocker({
              projectId: input.projectId,
              fallbackStage: "files",
            }),
          },
        },
      );
    }
    const calculated = await calculateAndSave(client, {
      context,
      state,
      userId: input.userId,
      requestId,
      changes: [
        {
          sheetId: modeCell.sheetId,
          address: modeCell.address,
          valueType: "string" as const,
          value: "직접 입력",
        },
        {
          sheetId: targetCell.sheetId,
          address: targetCell.address,
          valueType: "number",
          value: targetPer,
        },
      ],
    });
    const nextState = calculated.state;
    const forwardEps = nextState?.readModel.outputs.forwardEps?.rawValue;
    const targetPrice = nextState?.readModel.outputs.targetPrice?.rawValue;
    if (!nextState || !forwardEps || !targetPrice) {
      throw new ApiError(
        422,
        "FORMULA_CALCULATION_FAILED",
        "Excel에서 목표주가 계산 결과를 찾지 못했습니다.",
      );
    }
    const nextDraftVersion = currentDraftVersion + 1;
    const upsideValue = upside(targetPrice, context.currentPrice);
    await client.query(
      `INSERT INTO valuation_draft (
         project_id, draft_version, workbook_version, input_mode, target_per,
         requested_target_price, forward_eps, target_price, current_price,
         current_price_snapshot_resource_version_id, upside, status,
         updated_by_user_id
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
         'draft', $12)
       ON CONFLICT (project_id) DO UPDATE SET
         draft_version = EXCLUDED.draft_version,
         workbook_version = EXCLUDED.workbook_version,
         input_mode = EXCLUDED.input_mode,
         target_per = EXCLUDED.target_per,
         requested_target_price = EXCLUDED.requested_target_price,
         forward_eps = EXCLUDED.forward_eps,
         target_price = EXCLUDED.target_price,
         current_price = EXCLUDED.current_price,
         current_price_snapshot_resource_version_id =
           EXCLUDED.current_price_snapshot_resource_version_id,
         upside = EXCLUDED.upside,
         status = 'draft',
         updated_by_user_id = EXCLUDED.updated_by_user_id,
         updated_at = now()`,
      [
        input.projectId,
        nextDraftVersion,
        nextState.workbookVersion,
        input.inputMode,
        targetPer,
        requestedTargetPrice,
        forwardEps,
        targetPrice,
        context.currentPrice,
        context.priceSnapshotId,
        upsideValue,
        input.userId,
      ],
    );
    const body = {
      workbookVersion: nextState.workbookVersion,
      draftVersion: nextDraftVersion,
      inputMode: input.inputMode,
      targetPer,
      requestedTargetPrice,
      targetPrice,
      formattedTargetPrice: formattedMoney(targetPrice),
      forwardEps,
      currentPrice: context.currentPrice,
      upside: upsideValue,
      formattedUpside: formattedUpside(upsideValue),
      calculationRunId: calculated.calculationRunId,
      savedAt: nextState.savedAt,
      invalidatedResults: [
        "valuation_approval",
        "report_outline",
        "report_validation",
      ],
    };
    await storeReplay(client, {
      userId: input.userId,
      operation: "valuation.draft.update",
      projectId: input.projectId,
      key: requestId,
      requestHash,
      body,
    });
    return body;
  });
}

export async function approveValuation(input: {
  projectId: string;
  userId: string;
  idempotencyKey: string | null;
  requestId: unknown;
  workbookVersion: unknown;
  draftVersion: unknown;
  calculationRunId: unknown;
  currentPriceSnapshotId: unknown;
}) {
  const key = requireIdempotencyKey(input.idempotencyKey);
  const traceRequestId = requireRequestId(input.requestId);
  const workbookVersion = requireVersion(input.workbookVersion, "workbook");
  const draftVersion = requireVersion(input.draftVersion, "draft");
  const calculationRunId = requireRequestId(input.calculationRunId);
  const currentPriceSnapshotId = requireRequestId(input.currentPriceSnapshotId);
  const requestHash = contentHash({
    workbookVersion,
    draftVersion,
    calculationRunId,
    currentPriceSnapshotId,
    traceRequestId,
  });
  return withTransaction(async (client) => {
    await lockIdempotency(client, {
      userId: input.userId,
      operation: "valuation.approve",
      projectId: input.projectId,
      key,
    });
    const prior = await replay(client, {
      userId: input.userId,
      operation: "valuation.approve",
      projectId: input.projectId,
      key,
      requestHash,
    });
    if (prior) return prior;
    const context = await projectContext(
      client,
      input.projectId,
      input.userId,
    );
    const state = await readWorkbookState(client, input.projectId, true);
    const draft = await client.query<{
      draft_version: string;
      workbook_version: string;
      target_per: string;
      target_price: string;
      forward_eps: string;
      current_price: string;
      current_price_snapshot_resource_version_id: string;
      upside: string;
      status: string;
    }>(
      `SELECT draft_version, workbook_version, target_per, target_price,
         forward_eps, current_price, current_price_snapshot_resource_version_id,
         upside, status
       FROM valuation_draft WHERE project_id = $1 FOR UPDATE`,
      [input.projectId],
    );
    const value = draft.rows[0];
    const stateCurrent =
      Boolean(state) &&
      workbookMatchesContext(state!, context) &&
      state!.workbookVersion === workbookVersion &&
      Number(value?.workbook_version) === workbookVersion &&
      Number(value?.draft_version) === draftVersion &&
      value?.current_price_snapshot_resource_version_id ===
        currentPriceSnapshotId &&
      currentPriceSnapshotId === context.priceSnapshotId;
    const draftOutputsCurrent =
      stateCurrent &&
      missingRequiredCells(state!.readModel).length === 0 &&
      isPositiveDecimal(state!.readModel.outputs.forwardEps?.rawValue) &&
      isPositiveDecimal(state!.readModel.outputs.targetPer?.rawValue) &&
      isPositiveDecimal(state!.readModel.outputs.targetPrice?.rawValue) &&
      sameDecimal(
        value?.forward_eps,
        state!.readModel.outputs.forwardEps?.rawValue,
      ) &&
      sameDecimal(
        value?.target_per,
        state!.readModel.outputs.targetPer?.rawValue,
        1,
      ) &&
      sameDecimal(
        value?.target_price,
        state!.readModel.outputs.targetPrice?.rawValue,
      ) &&
      sameDecimal(value?.current_price, context.currentPrice);
    if (stateCurrent && draftOutputsCurrent && value?.status === "approved") {
      const existing = await client.query<{
        approval_version: string;
        approval_id: string;
        resource_version_id: string;
        approved_at: Date;
      }>(
        `SELECT approval_version, approval_id, resource_version_id, approved_at
         FROM valuation_approval
         WHERE project_id = $1 AND workbook_version = $2
           AND draft_version = $3 AND calculation_run_id = $4
           AND current_price_snapshot_resource_version_id = $5
           AND status = 'approved'
         LIMIT 1`,
        [
          input.projectId,
          workbookVersion,
          draftVersion,
          calculationRunId,
          currentPriceSnapshotId,
        ],
      );
      if (existing.rows[0]) {
        const body = {
          valuationApprovalVersion: Number(
            existing.rows[0].approval_version,
          ),
          approvalId: existing.rows[0].approval_id,
          resourceVersionId: existing.rows[0].resource_version_id,
          workbookVersion,
          draftVersion,
          targetPer: value.target_per,
          forwardEps: value.forward_eps,
          targetPrice: value.target_price,
          currentPrice: value.current_price,
          upside: value.upside,
          approvedAt: existing.rows[0].approved_at.toISOString(),
          canComplete: true,
        };
        await storeReplay(client, {
          userId: input.userId,
          operation: "valuation.approve",
          projectId: input.projectId,
          key,
          requestHash,
          body,
        });
        return { status: 200, body };
      }
    }
    if (
      !stateCurrent ||
      !draftOutputsCurrent ||
      value?.status !== "draft"
    ) {
      throw new ApiError(
        409,
        "CALCULATION_STALE",
        "최신 계산값을 다시 확인해주세요.",
      );
    }
    const run = await client.query<{ output_artifact_id: string | null }>(
      `SELECT output_artifact_id FROM valuation_calculation_run
       WHERE calculation_run_id = $1 AND project_id = $2
         AND output_workbook_version = $3 AND status = 'success'
         AND output_artifact_id = $4`,
      [
        calculationRunId,
        input.projectId,
        workbookVersion,
        state!.currentArtifactId,
      ],
    );
    if (!run.rows[0]) {
      throw new ApiError(
        409,
        "CALCULATION_STALE",
        "최신 Excel 계산을 다시 실행해주세요.",
      );
    }
    const previous = await client.query<{
      approval_version: string;
      resource_version_id: string;
    }>(
      `SELECT approval_version, resource_version_id FROM valuation_approval
       WHERE project_id = $1 ORDER BY approval_version DESC LIMIT 1`,
      [input.projectId],
    );
    const approvalVersion = Number(previous.rows[0]?.approval_version ?? 0) + 1;
    const approvalInputFingerprint = contentHash({
      upstream: context.inputFingerprint,
      workbookVersion,
      draftVersion,
      calculationRunId,
      workbookArtifactId: state!.currentArtifactId,
    });
    const resource = await client.query<{ resource_id: string }>(
      `SELECT resource_id FROM versioned_resource
       WHERE project_id = $1 AND resource_kind = 'valuation_approval'
         AND resource_key = 'main'`,
      [input.projectId],
    );
    const resourceId = resource.rows[0]?.resource_id ?? uuidv7();
    if (!resource.rows[0]) {
      await client.query(
        `INSERT INTO versioned_resource (
           resource_id, project_id, resource_kind, resource_key
         ) VALUES ($1, $2, 'valuation_approval', 'main')`,
        [resourceId, input.projectId],
      );
    }
    const resourceVersionId = uuidv7();
    const approvalId = uuidv7();
    await client.query(
      `UPDATE resource_version resource
       SET lifecycle_status = 'superseded',
           validity_status = 'revalidation_required'
       FROM valuation_approval approval
       WHERE approval.resource_version_id = resource.resource_version_id
         AND approval.project_id = $1
         AND approval.status = 'approved'`,
      [input.projectId],
    );
    await client.query(
      `UPDATE valuation_approval SET status = 'superseded'
       WHERE project_id = $1 AND status = 'approved'`,
      [input.projectId],
    );
    await client.query(
      `INSERT INTO resource_version (
         resource_version_id, resource_id, version_no, lifecycle_status,
         input_fingerprint, content_hash, created_by_user_id
       ) VALUES ($1, $2, $3, 'approved', $4, $5, $6)`,
      [
        resourceVersionId,
        resourceId,
        approvalVersion,
        approvalInputFingerprint,
        contentHash(value),
        input.userId,
      ],
    );
    await client.query(
      `INSERT INTO valuation_approval (
         resource_version_id, approval_id, project_id, approval_version,
         workbook_version, draft_version, calculation_run_id,
         current_price_snapshot_resource_version_id, forward_eps, target_per,
         target_price, current_price, upside, status, approved_by_user_id,
         source_workbook_resource_version_id,
         mapping_set_resource_version_id, workbook_artifact_id,
         structure_hash, input_fingerprint
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
         $13, 'approved', $14, $15, $16, $17, $18, $19)`,
      [
        resourceVersionId,
        approvalId,
        input.projectId,
        approvalVersion,
        workbookVersion,
        draftVersion,
        calculationRunId,
        currentPriceSnapshotId,
        value.forward_eps,
        value.target_per,
        value.target_price,
        value.current_price,
        value.upside,
        input.userId,
        context.sourceWorkbookResourceVersionId,
        context.mappingSetResourceVersionId,
        state!.currentArtifactId,
        context.structureHash,
        context.inputFingerprint,
      ],
    );
    await invalidateResourceDependents(client, {
      projectId: input.projectId,
      upstreamResourceVersionIds: previous.rows[0]
        ? [previous.rows[0].resource_version_id]
        : [],
    });
    await recordResourceDependencies(client, {
      projectId: input.projectId,
      dependencies: [
        ...context.validationInputResourceVersionIds.map(
          (upstreamResourceVersionId) => ({
            upstreamResourceVersionId,
            downstreamResourceVersionId: resourceVersionId,
            dependencyKind: "validation_approval_input",
          }),
        ),
        {
          upstreamResourceVersionId:
            context.sourceWorkbookResourceVersionId,
          downstreamResourceVersionId: resourceVersionId,
          dependencyKind: "workbook_analysis_to_valuation",
        },
        {
          upstreamResourceVersionId: context.mappingSetResourceVersionId,
          downstreamResourceVersionId: resourceVersionId,
          dependencyKind: "mapping_set_to_valuation",
        },
        {
          upstreamResourceVersionId: currentPriceSnapshotId,
          downstreamResourceVersionId: resourceVersionId,
          dependencyKind: "market_price_to_valuation",
        },
      ],
    });
    await client.query(
      `UPDATE valuation_draft SET status = 'approved', updated_at = now()
       WHERE project_id = $1`,
      [input.projectId],
    );
    const body = {
      valuationApprovalVersion: approvalVersion,
      approvalId,
      resourceVersionId,
      workbookVersion,
      draftVersion,
      targetPer: value.target_per,
      forwardEps: value.forward_eps,
      targetPrice: value.target_price,
      currentPrice: value.current_price,
      upside: value.upside,
      approvedAt: new Date().toISOString(),
      canComplete: true,
    };
    await storeReplay(client, {
      userId: input.userId,
      operation: "valuation.approve",
      projectId: input.projectId,
      key,
      requestHash,
      body,
    });
    return { status: 200, body };
  });
}

export async function getSensitivity(input: {
  projectId: string;
  userId: string;
  workbookVersion: unknown;
  draftVersion: unknown;
}) {
  const workbookVersion = requireVersion(input.workbookVersion, "workbook");
  const draftVersion = requireVersion(input.draftVersion, "draft");
  await ensureWorkbook(input.projectId, input.userId);
  return withTransaction(async (client) => {
    const context = await projectContext(
      client,
      input.projectId,
      input.userId,
    );
    const state = await readWorkbookState(client, input.projectId);
    const draft = await client.query<{
      workbook_version: string;
      draft_version: string;
      forward_eps: string;
      target_per: string;
      current_price_snapshot_resource_version_id: string;
      status: string;
    }>(
      `SELECT workbook_version, draft_version, forward_eps, target_per,
         current_price_snapshot_resource_version_id, status
       FROM valuation_draft WHERE project_id = $1`,
      [input.projectId],
    );
    const value = draft.rows[0];
    if (
      !state ||
      !workbookMatchesContext(state, context) ||
      state.workbookVersion !== workbookVersion ||
      Number(value?.workbook_version) !== workbookVersion ||
      Number(value?.draft_version) !== draftVersion ||
      value?.status === "revalidation_required" ||
      value?.current_price_snapshot_resource_version_id !==
        context.priceSnapshotId
    ) {
      throw new ApiError(
        409,
        "SENSITIVITY_INPUT_INVALID",
        "최신 밸류에이션 입력값을 다시 불러와주세요.",
      );
    }
    return {
      workbookVersion,
      draftVersion,
      ...sensitivityGrid({
        forwardEps: value.forward_eps,
        targetPer: value.target_per,
      }),
    };
  });
}

export async function completeValuation(input: {
  projectId: string;
  userId: string;
  idempotencyKey: string | null;
  requestId: unknown;
  valuationApprovalVersion: unknown;
}) {
  const key = requireIdempotencyKey(input.idempotencyKey);
  const traceRequestId = requireRequestId(input.requestId);
  const approvalVersion = requireVersion(
    input.valuationApprovalVersion,
    "승인",
  );
  const requestHash = contentHash({ approvalVersion, traceRequestId });
  return withTransaction(async (client) => {
    await lockIdempotency(client, {
      userId: input.userId,
      operation: "valuation.complete",
      projectId: input.projectId,
      key,
    });
    const prior = await replay(client, {
      userId: input.userId,
      operation: "valuation.complete",
      projectId: input.projectId,
      key,
      requestHash,
    });
    if (prior) return prior;
    const context = await projectContext(
      client,
      input.projectId,
      input.userId,
    );
    const approval = await client.query<{
      resource_version_id: string;
      workbook_version: string;
      draft_version: string;
      calculation_run_id: string;
      current_price_snapshot_resource_version_id: string;
      source_workbook_resource_version_id: string;
      mapping_set_resource_version_id: string;
      workbook_artifact_id: string;
      structure_hash: string;
      input_fingerprint: string;
    }>(
      `SELECT resource_version_id, workbook_version, draft_version,
         calculation_run_id, current_price_snapshot_resource_version_id,
         source_workbook_resource_version_id, mapping_set_resource_version_id,
         workbook_artifact_id, structure_hash, input_fingerprint
       FROM valuation_approval
       WHERE project_id = $1 AND approval_version = $2
         AND status = 'approved' FOR UPDATE`,
      [input.projectId, approvalVersion],
    );
    const state = await readWorkbookState(client, input.projectId, true);
    const approved = approval.rows[0];
    const draft = await client.query<{
      draft_version: string;
      workbook_version: string;
      current_price_snapshot_resource_version_id: string;
      forward_eps: string;
      target_per: string;
      target_price: string;
      current_price: string;
      status: string;
    }>(
      `SELECT draft_version, workbook_version,
         current_price_snapshot_resource_version_id, forward_eps,
         target_per, target_price, current_price, status
       FROM valuation_draft
       WHERE project_id = $1 FOR UPDATE`,
      [input.projectId],
    );
    const currentDraft = draft.rows[0];
    const run = approved
      ? await client.query<{ output_artifact_id: string | null }>(
          `SELECT output_artifact_id
           FROM valuation_calculation_run
           WHERE calculation_run_id = $1 AND project_id = $2
             AND output_workbook_version = $3
             AND output_artifact_id = $4
             AND status = 'success'`,
          [
            approved.calculation_run_id,
            input.projectId,
            approved.workbook_version,
            approved.workbook_artifact_id,
          ],
        )
      : null;
    if (
      !approved ||
      !state ||
      !workbookMatchesContext(state, context) ||
      Number(approved.workbook_version) !== state.workbookVersion ||
      Number(approved.draft_version) !==
        Number(currentDraft?.draft_version ?? 0) ||
      currentDraft?.status !== "approved" ||
      Number(currentDraft.workbook_version) !== state.workbookVersion ||
      approved.calculation_run_id === "" ||
      !run?.rows[0] ||
      approved.current_price_snapshot_resource_version_id !==
        context.priceSnapshotId ||
      currentDraft.current_price_snapshot_resource_version_id !==
        context.priceSnapshotId ||
      approved.source_workbook_resource_version_id !==
        context.sourceWorkbookResourceVersionId ||
      approved.mapping_set_resource_version_id !==
        context.mappingSetResourceVersionId ||
      approved.workbook_artifact_id !== state.currentArtifactId ||
      approved.structure_hash !== context.structureHash ||
      approved.input_fingerprint !== context.inputFingerprint ||
      state.calculationStatus !== "success" ||
      missingRequiredCells(state.readModel).length > 0 ||
      !isPositiveDecimal(state.readModel.outputs.forwardEps?.rawValue) ||
      !isPositiveDecimal(state.readModel.outputs.targetPer?.rawValue) ||
      !isPositiveDecimal(state.readModel.outputs.targetPrice?.rawValue) ||
      !sameDecimal(
        currentDraft.forward_eps,
        state.readModel.outputs.forwardEps?.rawValue,
      ) ||
      !sameDecimal(
        currentDraft.target_per,
        state.readModel.outputs.targetPer?.rawValue,
        1,
      ) ||
      !sameDecimal(
        currentDraft.target_price,
        state.readModel.outputs.targetPrice?.rawValue,
      ) ||
      !sameDecimal(currentDraft.current_price, context.currentPrice)
    ) {
      throw new ApiError(
        409,
        "STALE_VALUATION_VERSION",
        "최신 밸류에이션을 다시 승인해주세요.",
      );
    }
    const body = {
      currentStage: "report_outline",
      nextRoute: processRoute(input.projectId, "report_outline"),
    };
    const alreadyCompleted = await client.query(
      `SELECT 1
       FROM project_stage_state state
       JOIN stage_completion completion
         ON completion.stage_completion_id = state.current_completion_id
       WHERE state.project_id = $1 AND state.stage_key = 'valuation'
         AND state.stage_status = 'completed'
         AND completion.validity_status = 'current'
         AND completion.primary_version_id = $2`,
      [input.projectId, approved.resource_version_id],
    );
    if (alreadyCompleted.rows[0]) {
      await storeReplay(client, {
        userId: input.userId,
        operation: "valuation.complete",
        projectId: input.projectId,
        key,
        requestHash,
        body,
      });
      return { status: 200, body };
    }
    const previous = await client.query<{
      stage_completion_id: string;
      completion_no: string;
    }>(
      `SELECT stage_completion_id, completion_no FROM stage_completion
       WHERE project_id = $1 AND stage_key = 'valuation'
       ORDER BY completion_no DESC LIMIT 1`,
      [input.projectId],
    );
    const completionId = uuidv7();
    await client.query(
      `INSERT INTO stage_completion (
         stage_completion_id, project_id, stage_key, completion_no,
         primary_version_id, supersedes_completion_id, completed_by_user_id
       ) VALUES ($1, $2, 'valuation', $3, $4, $5, $6)`,
      [
        completionId,
        input.projectId,
        Number(previous.rows[0]?.completion_no ?? 0) + 1,
        approved.resource_version_id,
        previous.rows[0]?.stage_completion_id ?? null,
        input.userId,
      ],
    );
    await client.query(
      `UPDATE project_stage_state
       SET stage_status = 'completed', current_completion_id = $2,
         blocker_codes = '{}', completed_at = now(), invalidated_at = NULL,
         updated_at = now()
       WHERE project_id = $1 AND stage_key = 'valuation'`,
      [input.projectId, completionId],
    );
    await client.query(
      `UPDATE project_stage_state
       SET stage_status = 'in_progress', blocker_codes = '{}',
         current_completion_id = NULL, completed_at = NULL,
         invalidated_at = NULL, updated_at = now()
       WHERE project_id = $1 AND stage_key = 'report_outline'
         AND stage_status IN (
           'blocked', 'not_started', 'revalidation_required'
         )`,
      [input.projectId],
    );
    await client.query(
      `UPDATE project SET current_stage = 'report_outline',
         row_version = row_version + 1, updated_at = now(), last_saved_at = now()
       WHERE project_id = $1`,
      [input.projectId],
    );
    await storeReplay(client, {
      userId: input.userId,
      operation: "valuation.complete",
      projectId: input.projectId,
      key,
      requestHash,
      body,
    });
    return { status: 200, body };
  });
}

export async function getValuationWorkbookBytes(
  projectId: string,
  userId: string,
  approvalVersion?: unknown,
) {
  const { context, state } = await ensureWorkbook(projectId, userId);
  const expectedApprovalVersion =
    approvalVersion === null || approvalVersion === undefined
      ? null
      : requireVersion(approvalVersion, "승인");
  const approvedArtifact = await withTransaction(async (client) => {
    const result = await client.query<{
      approval_version: string;
      workbook_version: string;
      object_key: string;
    }>(
      `SELECT approval.approval_version, approval.workbook_version,
         artifact.object_key
       FROM valuation_approval approval
       JOIN artifact
         ON artifact.artifact_id = approval.workbook_artifact_id
       WHERE approval.project_id = $1
         AND approval.status = 'approved'
         AND approval.source_workbook_resource_version_id = $2
         AND approval.mapping_set_resource_version_id = $3
         AND approval.structure_hash = $4
         AND approval.input_fingerprint = $5
         AND ($6::bigint IS NULL OR approval.approval_version = $6)
       ORDER BY approval.approval_version DESC
       LIMIT 1`,
      [
        projectId,
        context.sourceWorkbookResourceVersionId,
        context.mappingSetResourceVersionId,
        context.structureHash,
        context.inputFingerprint,
        expectedApprovalVersion,
      ],
    );
    return result.rows[0] ?? null;
  });
  if (expectedApprovalVersion && !approvedArtifact) {
    throw new ApiError(
      404,
      "VALUATION_APPROVAL_NOT_FOUND",
      "승인된 workbook을 찾을 수 없습니다.",
    );
  }
  return {
    filename: context.sourceFilename,
    workbookVersion: approvedArtifact
      ? Number(approvedArtifact.workbook_version)
      : state.workbookVersion,
    approvalVersion: approvedArtifact
      ? Number(approvedArtifact.approval_version)
      : null,
    bytes: await readObjectBytes(
      approvedArtifact?.object_key ?? state.currentObjectKey,
    ),
  };
}
