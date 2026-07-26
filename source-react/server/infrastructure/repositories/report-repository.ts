import { createHash, randomUUID } from "node:crypto";
import { ApiError } from "../../http/api-error";
import { contentHash, randomToken, sha256 } from "../../domain/hash";
import { processRoute } from "../../domain/project";
import { uuidv7 } from "../../domain/ids";
import {
  blockerMeta,
  resumeRouteForBlocker,
} from "../../domain/stage-blocker-policy";
import {
  applyReportOperations,
  attachTemplateGeometry,
  buildInitialOutline,
  buildReportDocument,
  materializeReportBindings,
  normalizeOutlineContent,
  patchOutline,
  proposeReportRewrite,
  reportContentHash,
  reportFilename,
  validateOutline,
  validateReportDocument,
  type OutlineChange,
  type OutlineContent,
  type ReportDocument,
  type ReportChartType,
  type ReportBindingDefinition,
  type ReportMaterializationsBySlotId,
  type ReportMappingBinding,
  type ReportRangeSource,
  type ReportTemplatePage,
  type ReportWorkbookReadModel,
} from "../../domain/report";
import {
  withTransaction,
  type TransactionClient,
} from "../database/transaction";
import { suggestReportOutline } from "../agents/report-outline-agent";
import { suggestReportDraft } from "../agents/report-draft-agent";
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

type IdempotentResult = { status: number; body: unknown };

type StageState = {
  stageKey: string;
  stageOrder: number;
  status: string;
  blockerCodes: string[];
  route: string;
};

type Context = {
  projectId: string;
  projectName: string;
  companyName: string;
  ticker: string;
  targetYear: number;
  targetQuarter: number;
  cutoffDate: string;
  templateResourceVersionId: string;
  templateVersion: number;
  templatePages: ReportTemplatePage[];
  templateSourcePdfHash: string;
  mappingSetResourceVersionId: string;
  mappingVersion: number;
  mappingConfirmed: boolean;
  mappingBindings: ReportMappingBinding[];
  materializationsBySlotId: ReportMaterializationsBySlotId;
  validationApprovalId: string;
  validationRunId: string;
  validationVersion: number;
  valuationApprovalId: string;
  valuationResourceVersionId: string;
  valuationVersion: number;
  workbookVersion: number;
  workbookArtifactId: string;
  forwardEps: string;
  targetPer: string;
  targetPrice: string;
  currentPrice: string;
  upside: string;
  hypothesisResourceVersionId: string;
  hypothesisVersion: number;
  rating: string;
  thesis: string;
  sourcePdfArtifactId: string;
  sourcePdfFilename: string;
  sourcePdfObjectKey: string;
  sourcePdfSha256: string;
  inputFingerprint: string;
  evidence: EvidenceSummary[];
};

type EvidenceSummary = {
  evidenceId: string;
  evidenceVersion: number;
  title: string;
  oneLineValue: string;
  stance: string;
  machineStatus: string;
  quoteExact: string;
  sourceType: string;
  publisher: string;
  sourceTitle: string;
  publishedAt: string | null;
  canonicalUrl: string | null;
  locator: Record<string, unknown>;
  provenance: Record<string, unknown>;
};

type PdfRenderWarning = {
  code: string;
  message: string;
};

type PdfRenderResult = {
  pdfBase64: string;
  sha256: string;
  byteSize: number;
  mediaType: "application/pdf";
  renderPlan: {
    version: string;
    sourcePdfHash: string;
    operations: unknown[];
  };
  validation: {
    passed: boolean;
    profile: Record<string, unknown>;
    pages: unknown[];
  };
  warnings: PdfRenderWarning[];
};

type PdfInspectionResult = {
  compatible: boolean;
  issues: unknown[];
  templateIr?: {
    source?: { pdfHash?: string };
    pages?: ReportTemplatePage[];
  };
};

type OutlineRow = {
  outline_id: string;
  resource_id: string;
  current_resource_version_id: string;
  current_version: string;
  status: "editing" | "approved" | "revalidation_required";
  saved_at: Date;
  content_json: OutlineContent;
  template_resource_version_id: string;
  mapping_set_resource_version_id: string;
  validation_approval_id: string;
  valuation_approval_id: string;
  hypothesis_resource_version_id: string;
};

type ReportRow = {
  report_id: string;
  resource_id: string;
  active_resource_version_id: string;
  approved_resource_version_id: string | null;
  current_version: string;
  status: "working" | "approved" | "revalidation_required";
  updated_at: Date;
  content_json: ReportDocument;
  outline_approval_id: string;
};

async function recordReportOutlineDependencies(
  client: TransactionClient,
  context: Context,
  downstreamResourceVersionId: string,
): Promise<void> {
  await recordResourceDependencies(client, {
    projectId: context.projectId,
    dependencies: [
      {
        upstreamResourceVersionId: context.templateResourceVersionId,
        downstreamResourceVersionId,
        dependencyKind: "template_ir_to_report_outline",
      },
      {
        upstreamResourceVersionId: context.mappingSetResourceVersionId,
        downstreamResourceVersionId,
        dependencyKind: "mapping_set_to_report_outline",
      },
      {
        upstreamResourceVersionId: context.valuationResourceVersionId,
        downstreamResourceVersionId,
        dependencyKind: "valuation_approval_to_report_outline",
      },
      {
        upstreamResourceVersionId: context.hypothesisResourceVersionId,
        downstreamResourceVersionId,
        dependencyKind: "hypothesis_to_report_outline",
      },
    ],
  });
}

async function recordReportVersionDependency(
  client: TransactionClient,
  input: {
    projectId: string;
    outlineApprovalId: string;
    downstreamResourceVersionId: string;
  },
): Promise<void> {
  const approval = await client.query<{
    outline_resource_version_id: string;
  }>(
    `SELECT outline_resource_version_id
     FROM report_outline_approval
     WHERE approval_id = $1 AND project_id = $2`,
    [input.outlineApprovalId, input.projectId],
  );
  const outlineResourceVersionId =
    approval.rows[0]?.outline_resource_version_id;
  if (!outlineResourceVersionId) {
    throw new Error("REPORT_OUTLINE_APPROVAL_NOT_FOUND");
  }
  await recordResourceDependencies(client, {
    projectId: input.projectId,
    dependencies: [
      {
        upstreamResourceVersionId: outlineResourceVersionId,
        downstreamResourceVersionId: input.downstreamResourceVersionId,
        dependencyKind: "outline_to_report",
      },
    ],
  });
}

async function callPdfWorker<T>(path: string, body: unknown): Promise<T> {
  const base =
    process.env.REFLO_PDF_WORKER_URL?.trim() || "http://127.0.0.1:8091";
  let response: Response;
  try {
    response = await fetch(`${base.replace(/\/$/, "")}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });
  } catch {
    throw new ApiError(
      503,
      "PDF_RENDER_SERVICE_UNAVAILABLE",
      "PDF 미리보기 생성 서비스에 연결하지 못했습니다.",
      { retryable: true },
    );
  }
  const payload = (await response.json()) as T & { error?: string };
  if (!response.ok) {
    const message =
      typeof payload.error === "string"
        ? payload.error
        : "PDF 미리보기를 생성하지 못했습니다.";
    throw new ApiError(
      response.status === 422 ? 422 : 503,
      message.startsWith("BLOCK_OVERFLOW")
        ? "REPORT_BLOCK_OVERFLOW"
        : "PDF_RENDER_FAILED",
      message.startsWith("BLOCK_OVERFLOW")
        ? "수정한 문장이 원본 PDF 영역을 벗어납니다. 문장을 줄여주세요."
        : message,
      { retryable: response.status >= 500 },
    );
  }
  return payload;
}

async function resolvedTemplatePages(
  context: Context,
): Promise<ReportTemplatePage[]> {
  if (
    context.templatePages.length > 0 &&
    context.templateSourcePdfHash === context.sourcePdfSha256
  ) {
    return context.templatePages;
  }
  const downloadUrl = await createWorkerDownloadUrl(
    context.sourcePdfObjectKey,
    10 * 60,
  );
  const inspected = await callPdfWorker<PdfInspectionResult>("/inspect", {
    downloadUrl,
  });
  const pages = inspected.templateIr?.pages;
  if (!inspected.compatible || !Array.isArray(pages) || pages.length === 0) {
    throw new ApiError(
      422,
      "SOURCE_PDF_TEMPLATE_INCOMPATIBLE",
      "업로드한 PDF의 편집 가능한 텍스트 구조를 확인하지 못했습니다.",
      { details: Array.isArray(inspected.issues) ? (inspected.issues as never[]) : [] },
    );
  }
  return pages;
}

async function hydrateReportDocument(
  context: Context,
  document: ReportDocument,
): Promise<ReportDocument> {
  return attachTemplateGeometry(
    document,
    await resolvedTemplatePages(context),
    context.mappingBindings,
    context.materializationsBySlotId,
  );
}

function requireVersion(value: unknown, label = "version"): number {
  const version = Number(value);
  if (!Number.isInteger(version) || version < 1) {
    throw new ApiError(
      400,
      "INVALID_VERSION",
      `${label}이 올바르지 않습니다.`,
    );
  }
  return version;
}

function requireUuidValue(value: unknown, code = "INVALID_ID"): string {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    )
  ) {
    throw new ApiError(400, code, "요청 식별자가 올바르지 않습니다.");
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
  await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [
    [input.userId, input.operation, input.projectId, input.key].join("\u001f"),
  ]);
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

async function storeReplay(
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
) {
  await client.query(
    `INSERT INTO idempotency_record (
       idempotency_id, user_id, operation, project_id, idempotency_key,
       request_hash, response_status, response_json, expires_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb,
       now() + interval '24 hours')
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

async function stages(
  client: TransactionClient,
  projectId: string,
): Promise<StageState[]> {
  const result = await client.query<{
    stage_key: string;
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

async function loadEvidence(
  client: TransactionClient,
  projectId: string,
  validationRunId: string,
): Promise<EvidenceSummary[]> {
  const result = await client.query<{
    evidence_id: string;
    evidence_version: string;
    title: string;
    one_line_value: string;
    stance: string;
    machine_status: string;
    quote_exact: string;
    source_type: string;
    publisher: string;
    source_title: string;
    published_at: Date | null;
    canonical_url: string | null;
    locator_json: Record<string, unknown>;
    provenance_json: Record<string, unknown>;
  }>(
    `SELECT DISTINCT ON (e.evidence_id)
       e.evidence_id, e.evidence_version, result.title,
       result.one_line_value, e.stance, e.machine_status, e.quote_exact,
       source_version.source_type, source_version.publisher,
       source_version.title AS source_title, source_version.published_at,
       source_version.canonical_url, e.locator_json, e.provenance_json
     FROM evidence e
     JOIN validation_result result
       ON result.validation_run_id = e.validation_run_id
      AND e.evidence_id = ANY(result.evidence_ids)
     JOIN research_source_version source_version
       ON source_version.resource_version_id = e.source_version_id
     WHERE e.project_id = $1 AND e.validation_run_id = $2
     ORDER BY e.evidence_id, e.evidence_version DESC`,
    [projectId, validationRunId],
  );
  return result.rows.map((row) => ({
    evidenceId: row.evidence_id,
    evidenceVersion: Number(row.evidence_version),
    title: row.title,
    oneLineValue: row.one_line_value,
    stance: row.stance,
    machineStatus: row.machine_status,
    quoteExact: row.quote_exact,
    sourceType: row.source_type,
    publisher: row.publisher,
    sourceTitle: row.source_title,
    publishedAt: row.published_at?.toISOString() ?? null,
    canonicalUrl: row.canonical_url,
    locator: row.locator_json,
    provenance: row.provenance_json,
  }));
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function rangeSource(value: unknown): ReportRangeSource | null {
  const source = objectRecord(value);
  const sheetId = source?.sheetId;
  const sheetName = source?.sheet ?? source?.sheetName;
  const address = source?.range ?? source?.address;
  if (
    typeof sheetId !== "string" ||
    typeof sheetName !== "string" ||
    typeof address !== "string"
  ) {
    return null;
  }
  return {
    sheetId,
    sheetName,
    address,
    structureFingerprint:
      typeof source?.structureFingerprint === "string"
        ? source.structureFingerprint
        : null,
  };
}

function bindingDefinition(value: unknown): ReportBindingDefinition | null {
  const binding = objectRecord(value);
  if (binding?.kind === "table") {
    const source = rangeSource(binding.source);
    const rowKeyColumn = binding.rowKeyColumn;
    const columnHeaderRow = Number(binding.columnHeaderRow);
    const expectedRows = Number(binding.expectedRows);
    const expectedColumns = Number(binding.expectedColumns);
    if (
      !source ||
      typeof rowKeyColumn !== "string" ||
      !/^[A-Za-z]{1,3}$/.test(rowKeyColumn) ||
      !Number.isInteger(columnHeaderRow) ||
      !Number.isInteger(expectedRows) ||
      !Number.isInteger(expectedColumns)
    ) {
      return null;
    }
    return {
      kind: "table",
      source,
      rowKeyColumn,
      columnHeaderRow,
      expectedRows,
      expectedColumns,
    };
  }
  if (binding?.kind === "chart") {
    const categories = rangeSource(binding.categories);
    const rawSeries = Array.isArray(binding.series) ? binding.series : [];
    const series = rawSeries.flatMap((value) => {
      const item = objectRecord(value);
      const source = rangeSource(item?.source);
      if (!source || typeof item?.seriesId !== "string") return [];
      return [
        {
          seriesId: item.seriesId,
          label: typeof item?.label === "string" ? item.label : null,
          source,
        },
      ];
    });
    if (!categories || series.length !== rawSeries.length || series.length === 0) {
      return null;
    }
    return { kind: "chart", categories, series };
  }
  return null;
}

function mappingDefinitions(value: unknown): Map<string, ReportBindingDefinition> {
  const mapping = objectRecord(value);
  const bindings = Array.isArray(mapping?.bindings) ? mapping.bindings : [];
  return new Map(
    bindings.flatMap((value) => {
      const binding = objectRecord(value);
      const slotId = binding?.slotId;
      const definition = bindingDefinition(value);
      return typeof slotId === "string" && definition
        ? [[slotId, definition] as const]
        : [];
    }),
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
    template_resource_version_id: string;
    template_version: string;
    template_ir_json: {
      source?: { pdfHash?: string };
      pages?: ReportTemplatePage[];
    };
    mapping_set_resource_version_id: string;
    mapping_version: string;
    mapping_status: string;
    unmapped_required_count: number;
    mapping_json: unknown;
    validation_approval_id: string;
    validation_run_id: string;
    validation_version: string;
    valuation_approval_id: string;
    valuation_resource_version_id: string;
    valuation_version: string;
    workbook_version: string;
    workbook_artifact_id: string;
    approved_workbook_read_model: ReportWorkbookReadModel | null;
    forward_eps: string;
    target_per: string;
    target_price: string;
    current_price: string;
    upside: string;
    hypothesis_resource_version_id: string;
    hypothesis_version: string;
    provisional_rating: string;
    thesis: string;
    source_pdf_artifact_id: string;
    source_pdf_filename: string | null;
    source_pdf_object_key: string;
    source_pdf_sha256: string;
  }>(
    `SELECT p.project_id, p.name AS project_name, company.company_name,
       company.ticker, setup.target_year, setup.target_quarter,
       setup.cutoff_date::text,
       template.resource_version_id AS template_resource_version_id,
       template_rv.version_no AS template_version, template.template_ir_json,
       mapping.resource_version_id AS mapping_set_resource_version_id,
       mapping_rv.version_no AS mapping_version, mapping.mapping_status,
       mapping.unmapped_required_count, mapping.mapping_json,
       validation.approval_id AS validation_approval_id,
       validation.validation_run_id, validation.validation_version,
       valuation.approval_id AS valuation_approval_id,
       valuation.resource_version_id AS valuation_resource_version_id,
       valuation.approval_version AS valuation_version,
       valuation.workbook_version, valuation.workbook_artifact_id,
       report_workbook.read_model_json AS approved_workbook_read_model,
       valuation.forward_eps, valuation.target_per, valuation.target_price,
       valuation.current_price, valuation.upside,
       hypothesis.resource_version_id AS hypothesis_resource_version_id,
       hypothesis.draft_version AS hypothesis_version,
       hypothesis.provisional_rating, hypothesis.thesis,
       pdf_file.artifact_id AS source_pdf_artifact_id,
       pdf_artifact.original_filename AS source_pdf_filename,
       pdf_artifact.object_key AS source_pdf_object_key,
       pdf_artifact.sha256 AS source_pdf_sha256
     FROM project p
     JOIN project_stage_state setup_state
       ON setup_state.project_id = p.project_id
      AND setup_state.stage_key = 'setup'
      AND setup_state.stage_status = 'completed'
     JOIN stage_completion setup_completion
       ON setup_completion.stage_completion_id = setup_state.current_completion_id
      AND setup_completion.validity_status = 'current'
     JOIN project_setup_version setup
       ON setup.resource_version_id = setup_completion.primary_version_id
     JOIN company_master company
       ON company.company_master_id = setup.company_master_id
     JOIN project_stage_state files_state
       ON files_state.project_id = p.project_id
      AND files_state.stage_key = 'files'
      AND files_state.stage_status = 'completed'
     JOIN stage_completion files_completion
       ON files_completion.stage_completion_id = files_state.current_completion_id
      AND files_completion.validity_status = 'current'
     JOIN mapping_set_version mapping
       ON mapping.resource_version_id = files_completion.primary_version_id
     JOIN resource_version mapping_rv
       ON mapping_rv.resource_version_id = mapping.resource_version_id
      AND mapping_rv.validity_status = 'current'
     JOIN template_ir_version template
       ON template.resource_version_id = mapping.template_ir_version_id
     JOIN resource_version template_rv
       ON template_rv.resource_version_id = template.resource_version_id
      AND template_rv.validity_status = 'current'
     JOIN project_file_version pdf_file
       ON pdf_file.resource_version_id = template.source_file_version_id
      AND pdf_file.inspection_status = 'accepted'
     JOIN artifact pdf_artifact
       ON pdf_artifact.artifact_id = pdf_file.artifact_id
      AND pdf_artifact.storage_status = 'accepted'
     JOIN project_stage_state validation_state
       ON validation_state.project_id = p.project_id
      AND validation_state.stage_key = 'validation'
      AND validation_state.stage_status = 'completed'
     JOIN validation_workspace validation_workspace
       ON validation_workspace.project_id = p.project_id
      AND validation_workspace.workspace_status = 'APPROVED'
     JOIN validation_approval validation
       ON validation.approval_id = (
         SELECT approval.approval_id
         FROM validation_approval approval
         WHERE approval.project_id = p.project_id
           AND approval.validation_run_id = validation_workspace.validation_run_id
         ORDER BY approval.validation_version DESC LIMIT 1
       )
     JOIN validation_run validation_run
       ON validation_run.validation_run_id = validation.validation_run_id
      AND validation_run.status = 'succeeded'
     JOIN project_stage_state valuation_state
       ON valuation_state.project_id = p.project_id
      AND valuation_state.stage_key = 'valuation'
      AND valuation_state.stage_status = 'completed'
     JOIN stage_completion valuation_completion
       ON valuation_completion.stage_completion_id =
          valuation_state.current_completion_id
      AND valuation_completion.validity_status = 'current'
     JOIN valuation_approval valuation
       ON valuation.resource_version_id = valuation_completion.primary_version_id
      AND valuation.status = 'approved'
      AND valuation.mapping_set_resource_version_id =
          mapping.resource_version_id
     LEFT JOIN valuation_workbook report_workbook
       ON report_workbook.project_id = p.project_id
      AND report_workbook.mapping_set_resource_version_id =
          mapping.resource_version_id
      AND report_workbook.workbook_version = valuation.workbook_version
      AND report_workbook.current_artifact_id = valuation.workbook_artifact_id
      AND report_workbook.calculation_status = 'success'
     JOIN LATERAL (
       SELECT hypothesis_version.*
       FROM project_hypothesis_version hypothesis_version
       WHERE hypothesis_version.project_id = p.project_id
       ORDER BY hypothesis_version.draft_version DESC LIMIT 1
     ) hypothesis ON true
     WHERE p.project_id = $1 AND p.owner_user_id = $2
       AND p.deleted_at IS NULL
       AND mapping.mapping_status = 'confirmed'
       AND mapping.unmapped_required_count = 0
       AND NOT EXISTS (
         SELECT 1 FROM validation_conflict conflict
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
      throw new ApiError(
        404,
        "PROJECT_NOT_FOUND",
        "프로젝트를 찾을 수 없습니다.",
      );
    }
    throw new ApiError(
      409,
      "REPORT_PREREQUISITE_INCOMPLETE",
      "밸류에이션 승인과 선행 검증을 완료해주세요.",
      { meta: blockerMeta({ projectId, requiredStage: "valuation" }) },
    );
  }
  const evidence = await loadEvidence(
    client,
    projectId,
    row.validation_run_id,
  );
  if (evidence.length === 0 || evidence.some((item) => item.machineStatus !== "passed")) {
    throw new ApiError(
      409,
      "REPORT_PREREQUISITE_INCOMPLETE",
      "보고서에 사용할 검증 근거를 확인해주세요.",
      { meta: blockerMeta({ projectId, requiredStage: "validation" }) },
    );
  }
  const mappingResult = await client.query<{
    slot_id: string;
    semantic_metric: string;
    binding_kind: "scalar" | "table" | "chart";
    mapping_status: "confirmed" | "suggested" | "unmapped" | "invalid";
    source_type: string | null;
    sheet_id: string | null;
    sheet_name: string | null;
    address: string | null;
    label: string | null;
  }>(
    `SELECT entry.slot_id, entry.semantic_metric, entry.binding_kind,
       entry.mapping_status, candidate.source_type, candidate.sheet_id,
       candidate.sheet_name,
       candidate.address, candidate.label
     FROM mapping_entry entry
     LEFT JOIN mapping_candidate candidate
       ON candidate.mapping_candidate_id = entry.selected_candidate_id
     WHERE entry.mapping_set_version_id = $1`,
    [row.mapping_set_resource_version_id],
  );
  const definitions = mappingDefinitions(row.mapping_json);
  const mappedBindings: ReportMappingBinding[] = mappingResult.rows.map(
    (item) => {
      const definition = definitions.get(item.slot_id) ?? null;
      const primarySource =
        definition?.kind === "table"
          ? definition.source
          : definition?.kind === "chart"
            ? definition.categories
            : null;
      const sourceAddress = item.address ?? primarySource?.address ?? null;
      const sourceSheetName =
        item.sheet_name ?? primarySource?.sheetName ?? null;
      return {
        slotId: item.slot_id,
        metric: item.semantic_metric,
        kind: item.binding_kind,
        status: item.mapping_status,
        sourceLabel:
          item.label ??
          (sourceSheetName && sourceAddress
            ? `${sourceSheetName} ${sourceAddress}`
            : null),
        sourceAddress,
        sourceType: item.source_type,
        sourceSheetId: item.sheet_id ?? primarySource?.sheetId ?? null,
        sourceSheetName,
        definition,
      };
    },
  );
  const authoritativeBindings: ReportMappingBinding[] = [
    {
      slotId: `valuation:${row.valuation_approval_id}:target_price`,
      metric: "target_price",
      kind: "scalar",
      status: "confirmed",
      sourceLabel: `밸류에이션 승인 v${row.valuation_version}`,
      sourceAddress: "target_price",
      sourceType: "valuation_approval",
    },
    {
      slotId: `valuation:${row.valuation_approval_id}:per`,
      metric: "per",
      kind: "scalar",
      status: "confirmed",
      sourceLabel: `밸류에이션 승인 v${row.valuation_version}`,
      sourceAddress: "target_per",
      sourceType: "valuation_approval",
    },
    {
      slotId: `valuation:${row.valuation_approval_id}:eps`,
      metric: "eps",
      kind: "scalar",
      status: "confirmed",
      sourceLabel: `밸류에이션 승인 v${row.valuation_version}`,
      sourceAddress: "forward_eps",
      sourceType: "valuation_approval",
    },
    {
      slotId: `market-price:${row.cutoff_date}:current_price`,
      metric: "current_price",
      kind: "scalar",
      status: "confirmed",
      sourceLabel: `${row.cutoff_date} 현재주가 스냅샷`,
      sourceAddress: "current_price",
      sourceType: "market_price_snapshot",
    },
    {
      slotId: `hypothesis:${row.hypothesis_resource_version_id}:investment_opinion`,
      metric: "investment_opinion",
      kind: "scalar",
      status: "suggested",
      sourceLabel: `투자 가설 v${row.hypothesis_version}`,
      sourceAddress: "provisional_rating",
      sourceType: "hypothesis",
    },
  ];
  const authoritativeMetrics = new Set(
    authoritativeBindings.map((binding) => `${binding.metric}:${binding.kind}`),
  );
  const mappingBindings: ReportMappingBinding[] = [
    ...mappedBindings.filter(
      (binding) => !authoritativeMetrics.has(`${binding.metric}:${binding.kind}`),
    ),
    ...authoritativeBindings,
  ];
  const approvedWorkbookReadModel =
    row.approved_workbook_read_model?.schemaVersion === "1.2" &&
    Array.isArray(row.approved_workbook_read_model.sheets)
      ? row.approved_workbook_read_model
      : null;
  const materializationsBySlotId = materializeReportBindings(
    mappingBindings,
    {
      mappingSetResourceVersionId: row.mapping_set_resource_version_id,
      workbookArtifactId: row.workbook_artifact_id,
      workbookVersion: Number(row.workbook_version),
      readModel: approvedWorkbookReadModel,
    },
  );
  const refs = {
    templateResourceVersionId: row.template_resource_version_id,
    mappingSetResourceVersionId: row.mapping_set_resource_version_id,
    validationApprovalId: row.validation_approval_id,
    valuationApprovalId: row.valuation_approval_id,
    hypothesisResourceVersionId: row.hypothesis_resource_version_id,
  };
  return {
    projectId: row.project_id,
    projectName: row.project_name,
    companyName: row.company_name,
    ticker: row.ticker,
    targetYear: row.target_year,
    targetQuarter: row.target_quarter,
    cutoffDate: row.cutoff_date,
    templateResourceVersionId: row.template_resource_version_id,
    templateVersion: Number(row.template_version),
    templatePages: row.template_ir_json.pages ?? [],
    templateSourcePdfHash: row.template_ir_json.source?.pdfHash ?? "",
    mappingSetResourceVersionId: row.mapping_set_resource_version_id,
    mappingVersion: Number(row.mapping_version),
    mappingConfirmed:
      row.mapping_status === "confirmed" && row.unmapped_required_count === 0,
    mappingBindings,
    materializationsBySlotId,
    validationApprovalId: row.validation_approval_id,
    validationRunId: row.validation_run_id,
    validationVersion: Number(row.validation_version),
    valuationApprovalId: row.valuation_approval_id,
    valuationResourceVersionId: row.valuation_resource_version_id,
    valuationVersion: Number(row.valuation_version),
    workbookVersion: Number(row.workbook_version),
    workbookArtifactId: row.workbook_artifact_id,
    forwardEps: row.forward_eps,
    targetPer: row.target_per,
    targetPrice: row.target_price,
    currentPrice: row.current_price,
    upside: row.upside,
    hypothesisResourceVersionId: row.hypothesis_resource_version_id,
    hypothesisVersion: Number(row.hypothesis_version),
    rating: row.provisional_rating,
    thesis: row.thesis,
    sourcePdfArtifactId: row.source_pdf_artifact_id,
    sourcePdfFilename: row.source_pdf_filename ?? "previous-report.pdf",
    sourcePdfObjectKey: row.source_pdf_object_key,
    sourcePdfSha256: row.source_pdf_sha256,
    inputFingerprint: contentHash(refs),
    evidence,
  };
}

function refsMatch(row: OutlineRow, context: Context): boolean {
  return (
    row.template_resource_version_id === context.templateResourceVersionId &&
    row.mapping_set_resource_version_id === context.mappingSetResourceVersionId &&
    row.validation_approval_id === context.validationApprovalId &&
    row.valuation_approval_id === context.valuationApprovalId &&
    row.hypothesis_resource_version_id === context.hypothesisResourceVersionId
  );
}

async function readOutline(
  client: TransactionClient,
  projectId: string,
  forUpdate = false,
): Promise<OutlineRow | null> {
  const result = await client.query<OutlineRow>(
    `SELECT outline.outline_id, outline.resource_id,
       outline.current_resource_version_id, outline.current_version,
       outline.status, outline.saved_at, version.content_json,
       version.template_resource_version_id,
       version.mapping_set_resource_version_id,
       version.validation_approval_id, version.valuation_approval_id,
       version.hypothesis_resource_version_id
     FROM report_outline outline
     JOIN report_outline_version version
       ON version.resource_version_id = outline.current_resource_version_id
     WHERE outline.project_id = $1
     ${forUpdate ? "FOR UPDATE OF outline" : ""}`,
    [projectId],
  );
  const row = result.rows[0] ?? null;
  if (row) row.content_json = normalizeOutlineContent(row.content_json);
  return row;
}

async function ensureOutline(
  client: TransactionClient,
  context: Context,
  userId: string,
): Promise<OutlineRow> {
  const existing = await readOutline(client, context.projectId);
  if (existing) {
    if (!refsMatch(existing, context)) {
      await invalidateResourceDependents(client, {
        projectId: context.projectId,
        upstreamResourceVersionIds: [existing.current_resource_version_id],
      });
      await invalidateProjectStages(client, {
        projectId: context.projectId,
        triggerVersionId: existing.current_resource_version_id,
        startStageKey: "report_outline",
        reasonCode: "REPORT_OUTLINE_CHANGED",
        transitions: [
          {
            stageKey: "report_outline",
            stageStatus: "revalidation_required",
            blockerCodes: ["REPORT_OUTLINE_CHANGED"],
            clearCompletion: true,
            eligibleStatuses: [
              "in_progress",
              "completed",
              "revalidation_required",
            ],
          },
        ],
        markProjectRevalidation: true,
      });
      await client.query(
        `UPDATE report_outline
         SET status = 'revalidation_required' WHERE project_id = $1`,
        [context.projectId],
      );
      throw new ApiError(
        409,
        "OUTLINE_REVALIDATION_REQUIRED",
        "선행 데이터가 변경되어 페이지 구성을 다시 확인해야 합니다.",
        {
          meta: {
            resumeRoute: resumeRouteForBlocker({
              projectId: context.projectId,
              fallbackStage: "report_outline",
            }),
          },
        },
      );
    }
    await recordReportOutlineDependencies(
      client,
      context,
      existing.current_resource_version_id,
    );
    return existing;
  }

  const outlineId = uuidv7();
  const resourceId = uuidv7();
  const resourceVersionId = uuidv7();
  const content = await buildSuggestedOutline(context);
  await client.query(
    `INSERT INTO versioned_resource (
       resource_id, project_id, resource_kind, resource_key
     ) VALUES ($1, $2, 'report_outline', 'main')`,
    [resourceId, context.projectId],
  );
  await client.query(
    `INSERT INTO resource_version (
       resource_version_id, resource_id, version_no, lifecycle_status,
       validity_status, schema_version, input_fingerprint, content_hash,
       created_by_user_id, created_by_actor_type
     ) VALUES ($1, $2, 1, 'draft', 'current', '2.0', $3, $4, $5, 'system')`,
    [
      resourceVersionId,
      resourceId,
      context.inputFingerprint,
      contentHash(content),
      userId,
    ],
  );
  await client.query(
    `INSERT INTO report_outline (
       project_id, outline_id, resource_id, current_resource_version_id,
       current_version, status
     ) VALUES ($1, $2, $3, $4, 1, 'editing')`,
    [context.projectId, outlineId, resourceId, resourceVersionId],
  );
  await client.query(
    `INSERT INTO report_outline_version (
       resource_version_id, outline_id, version_no,
       template_resource_version_id, mapping_set_resource_version_id,
       validation_approval_id, valuation_approval_id,
       hypothesis_resource_version_id, generator_profile_version,
       content_json, created_by_user_id
     ) VALUES ($1, $2, 1, $3, $4, $5, $6, $7,
       'report-outline-structured-v2', $8::jsonb, $9)`,
    [
      resourceVersionId,
      outlineId,
      context.templateResourceVersionId,
      context.mappingSetResourceVersionId,
      context.validationApprovalId,
      context.valuationApprovalId,
      context.hypothesisResourceVersionId,
      JSON.stringify(content),
      userId,
    ],
  );
  await recordReportOutlineDependencies(
    client,
    context,
    resourceVersionId,
  );
  return (await readOutline(client, context.projectId))!;
}

async function buildSuggestedOutline(context: Context): Promise<OutlineContent> {
  const fallback = buildInitialOutline(context.templatePages, {
    companyName: context.companyName,
    targetYear: context.targetYear,
    targetQuarter: context.targetQuarter,
    thesis: context.thesis,
    rating: context.rating,
    targetPer: context.targetPer,
    targetPrice: context.targetPrice,
    currentPrice: context.currentPrice,
    mappingConfirmed: context.mappingConfirmed,
    mappingBindings: context.mappingBindings,
    evidence: context.evidence,
  });
  return suggestReportOutline({
    outline: fallback,
    companyName: context.companyName,
    ticker: context.ticker,
    targetYear: context.targetYear,
    targetQuarter: context.targetQuarter,
    rating: context.rating,
    thesis: context.thesis,
    targetPer: context.targetPer,
    targetPrice: context.targetPrice,
    currentPrice: context.currentPrice,
    evidence: context.evidence,
  });
}

function contextVersions(context: Context) {
  return {
    templateVersion: context.templateVersion,
    templateResourceVersionId: context.templateResourceVersionId,
    mappingSetVersion: context.mappingVersion,
    mappingSetResourceVersionId: context.mappingSetResourceVersionId,
    validationVersion: context.validationVersion,
    validationApprovalId: context.validationApprovalId,
    valuationVersion: context.valuationVersion,
    valuationApprovalId: context.valuationApprovalId,
    workbookVersion: context.workbookVersion,
    hypothesisVersion: context.hypothesisVersion,
  };
}

async function reviewedPageIds(
  client: TransactionClient,
  outlineId: string,
  version: number,
): Promise<string[]> {
  const result = await client.query<{ page_id: string }>(
    `SELECT page_id FROM report_outline_page_review
     WHERE outline_id = $1 AND reviewed_version = $2`,
    [outlineId, version],
  );
  return result.rows.map((row) => row.page_id);
}

export async function getReportOutlineWorkspace(
  projectId: string,
  userId: string,
) {
  return withTransaction(async (client) => {
    const context = await projectContext(client, projectId, userId);
    const outline = await ensureOutline(client, context, userId);
    const reviewed = await reviewedPageIds(
      client,
      outline.outline_id,
      Number(outline.current_version),
    );
    const stageStates = await stages(client, projectId);
    const report = await client.query<{ report_id: string }>(
      `SELECT report_id FROM report WHERE project_id = $1`,
      [projectId],
    );
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
        currentStage: "report_outline",
      },
      prerequisites: {
        ready: true,
        revalidationRequired: outline.status === "revalidation_required",
        blockingItems: [],
      },
      inputVersions: contextVersions(context),
      outline: {
        outlineId: outline.outline_id,
        version: Number(outline.current_version),
        status: outline.status,
        savedAt: outline.saved_at.toISOString(),
        generationSource: outline.content_json.generationSource,
        pages: outline.content_json.pages.map((page) => ({
          ...page,
          reviewStatus: reviewed.includes(page.pageId)
            ? "reviewed"
            : "needs-review",
        })),
      },
      mainHypothesis: {
        rating: context.rating,
        thesis: context.thesis,
        targetPer: context.targetPer,
        targetPrice: context.targetPrice,
        currentPrice: context.currentPrice,
        upside: context.upside,
      },
      evidenceSummary: context.evidence,
      draftTask: report.rows[0]
        ? {
            taskId: report.rows[0].report_id,
            operationStatus: "succeeded",
            reportRoute: `/projects/${projectId}/report`,
          }
        : null,
      workflow: { stageStates },
      navigation: {
        previousRoute: processRoute(projectId, "valuation"),
        reportRoute: `/projects/${projectId}/report`,
      },
    };
  });
}

export async function patchReportOutline(input: {
  projectId: string;
  userId: string;
  expectedVersion: unknown;
  requestId: unknown;
  changes: unknown;
}) {
  const expectedVersion = requireVersion(input.expectedVersion, "outline version");
  const requestId = requireUuidValue(input.requestId, "INVALID_REQUEST_ID");
  if (!Array.isArray(input.changes) || input.changes.length === 0) {
    throw new ApiError(
      400,
      "OUTLINE_VALUE_INVALID",
      "저장할 변경사항이 없습니다.",
    );
  }
  const changes = input.changes.map((value) => {
    const item = value as Record<string, unknown>;
    const field = String(item.field ?? "") as OutlineChange["field"];
    if (
      typeof item.pageId !== "string" ||
      typeof item.blockId !== "string" ||
      typeof item.value !== "string" ||
      !["value", "subtitle", "summary"].includes(field)
    ) {
      throw new ApiError(
        400,
        "OUTLINE_VALUE_INVALID",
        "페이지 입력값이 올바르지 않습니다.",
      );
    }
    return {
      pageId: item.pageId,
      blockId: item.blockId,
      field,
      value: item.value,
    };
  });
  return withTransaction(async (client) => {
    const context = await projectContext(
      client,
      input.projectId,
      input.userId,
    );
    const existingMutation = await client.query<{
      response_json: {
        outlineVersion: number;
        savedAt: string;
        invalidatedPageIds: string[];
        validationErrors: unknown[];
      };
    }>(
      `SELECT response_json FROM idempotency_record
       WHERE user_id = $1 AND operation = 'report-outline.patch'
         AND project_id = $2 AND idempotency_key = $3`,
      [input.userId, input.projectId, requestId],
    );
    if (existingMutation.rows[0]) return existingMutation.rows[0].response_json;
    const outline = await readOutline(client, input.projectId, true);
    if (!outline || !refsMatch(outline, context)) {
      throw new ApiError(
        409,
        "OUTLINE_REVALIDATION_REQUIRED",
        "페이지 구성 기준이 변경되었습니다.",
      );
    }
    if (
      Number(outline.current_version) !== expectedVersion ||
      outline.status !== "editing"
    ) {
      throw new ApiError(
        409,
        "OUTLINE_VERSION_CONFLICT",
        "다른 탭의 최신 페이지 구성을 다시 불러와주세요.",
      );
    }
    let patched;
    try {
      patched = patchOutline(outline.content_json, changes);
    } catch (error) {
      const code =
        error instanceof Error ? error.message : "OUTLINE_VALUE_INVALID";
      throw new ApiError(
        code === "OUTLINE_SLOT_READ_ONLY" ? 409 : 422,
        code,
        code === "OUTLINE_SLOT_READ_ONLY"
          ? "원본 고정 영역은 수정할 수 없습니다."
          : "입력값의 길이와 형식을 확인해주세요.",
      );
    }
    const nextVersion = expectedVersion + 1;
    const resourceVersionId = uuidv7();
    await client.query(
      `UPDATE resource_version
       SET lifecycle_status = 'superseded'
       WHERE resource_version_id = $1 AND lifecycle_status = 'draft'`,
      [outline.current_resource_version_id],
    );
    await client.query(
      `INSERT INTO resource_version (
         resource_version_id, resource_id, version_no, lifecycle_status,
         validity_status, supersedes_version_id, schema_version,
         input_fingerprint, content_hash, created_by_user_id,
         created_by_actor_type
       ) VALUES ($1, $2, $3, 'draft', 'current', $4, '2.0', $5, $6, $7, 'user')`,
      [
        resourceVersionId,
        outline.resource_id,
        nextVersion,
        outline.current_resource_version_id,
        context.inputFingerprint,
        contentHash(patched.content),
        input.userId,
      ],
    );
    await client.query(
      `INSERT INTO report_outline_version (
         resource_version_id, outline_id, version_no,
         template_resource_version_id, mapping_set_resource_version_id,
         validation_approval_id, valuation_approval_id,
         hypothesis_resource_version_id, generator_profile_version,
         content_json, created_by_user_id
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8,
         'report-outline-structured-v2', $9::jsonb, $10)`,
      [
        resourceVersionId,
        outline.outline_id,
        nextVersion,
        context.templateResourceVersionId,
        context.mappingSetResourceVersionId,
        context.validationApprovalId,
        context.valuationApprovalId,
        context.hypothesisResourceVersionId,
        JSON.stringify(patched.content),
        input.userId,
      ],
    );
    await invalidateResourceDependents(client, {
      projectId: input.projectId,
      upstreamResourceVersionIds: [outline.current_resource_version_id],
    });
    await recordReportOutlineDependencies(
      client,
      context,
      resourceVersionId,
    );
    const saved = await client.query<{ saved_at: Date }>(
      `UPDATE report_outline SET current_resource_version_id = $2,
         current_version = $3, saved_at = now()
       WHERE project_id = $1 RETURNING saved_at`,
      [input.projectId, resourceVersionId, nextVersion],
    );
    await client.query(
      `DELETE FROM report_outline_page_review
       WHERE outline_id = $1 AND page_id = ANY($2::text[])`,
      [outline.outline_id, patched.invalidatedPageIds],
    );
    const body = {
      outlineVersion: nextVersion,
      savedAt: saved.rows[0].saved_at.toISOString(),
      invalidatedPageIds: patched.invalidatedPageIds,
      validationErrors: [],
    };
    await storeReplay(client, {
      userId: input.userId,
      operation: "report-outline.patch",
      projectId: input.projectId,
      key: requestId,
      requestHash: contentHash({ expectedVersion, changes }),
      status: 200,
      body,
    });
    return body;
  });
}

export async function reviewReportOutlinePage(input: {
  projectId: string;
  userId: string;
  pageId: string;
  expectedOutlineVersion: unknown;
}) {
  const expectedVersion = requireVersion(
    input.expectedOutlineVersion,
    "outline version",
  );
  return withTransaction(async (client) => {
    const context = await projectContext(
      client,
      input.projectId,
      input.userId,
    );
    const outline = await readOutline(client, input.projectId, true);
    if (
      !outline ||
      !refsMatch(outline, context) ||
      Number(outline.current_version) !== expectedVersion
    ) {
      throw new ApiError(
        409,
        "OUTLINE_VERSION_CONFLICT",
        "최신 페이지 구성을 다시 불러와주세요.",
      );
    }
    const page = outline.content_json.pages.find(
      (item) => item.pageId === input.pageId,
    );
    if (!page) {
      throw new ApiError(404, "PAGE_NOT_FOUND", "페이지를 찾을 수 없습니다.");
    }
    if (
      (page.recommendedTitle && !page.recommendedTitle.value.trim()) ||
      page.narrativeBlocks.some(
        (block) => !block.subtitle.trim() || !block.summary.trim(),
      )
    ) {
      throw new ApiError(
        422,
        "PAGE_OUTLINE_INVALID",
        "필수 작성 방향을 모두 입력해주세요.",
      );
    }
    if (page.visualSlots.some((slot) => slot.bindingStatus !== "confirmed")) {
      throw new ApiError(
        422,
        "PAGE_OUTLINE_INVALID",
        "표·차트 Excel 연결을 다시 확인해주세요.",
      );
    }
    await client.query(
      `INSERT INTO report_outline_page_review (
         outline_id, page_id, reviewed_version, reviewed_by_user_id
       ) VALUES ($1, $2, $3, $4)
       ON CONFLICT (outline_id, page_id) DO UPDATE SET
         reviewed_version = EXCLUDED.reviewed_version,
         reviewed_by_user_id = EXCLUDED.reviewed_by_user_id,
         reviewed_at = now()`,
      [outline.outline_id, input.pageId, expectedVersion, input.userId],
    );
    return {
      pageId: input.pageId,
      reviewStatus: "reviewed",
      reviewedVersion: expectedVersion,
    };
  });
}

export async function regenerateReportOutline(input: {
  projectId: string;
  userId: string;
  idempotencyKey: string | null;
  expectedOutlineVersion: unknown;
  expectedInputVersions: unknown;
  mode: unknown;
}): Promise<IdempotentResult> {
  const key = requireIdempotencyKey(input.idempotencyKey);
  const expectedVersion = requireVersion(
    input.expectedOutlineVersion,
    "outline version",
  );
  if (input.mode !== "reset" && input.mode !== "initial") {
    throw new ApiError(
      400,
      "INVALID_GENERATION_MODE",
      "페이지 구성 생성 방식을 확인해주세요.",
    );
  }
  const requestHash = contentHash({
    expectedVersion,
    expectedInputVersions: input.expectedInputVersions,
    mode: input.mode,
  });
  return withTransaction(async (client) => {
    await lockIdempotency(client, {
      userId: input.userId,
      operation: "report-outline.generate",
      projectId: input.projectId,
      key,
    });
    const replayed = await replay(client, {
      userId: input.userId,
      operation: "report-outline.generate",
      projectId: input.projectId,
      key,
      requestHash,
    });
    if (replayed) return replayed;
    const context = await projectContext(
      client,
      input.projectId,
      input.userId,
    );
    if (
      contentHash(input.expectedInputVersions) !==
      contentHash(contextVersions(context))
    ) {
      throw new ApiError(
        409,
        "OUTLINE_REVALIDATION_REQUIRED",
        "페이지 구성 입력 버전이 변경되었습니다.",
      );
    }
    const outline = await readOutline(client, input.projectId, true);
    if (!outline || Number(outline.current_version) !== expectedVersion) {
      throw new ApiError(
        409,
        "OUTLINE_VERSION_CONFLICT",
        "최신 페이지 구성을 다시 불러와주세요.",
      );
    }
    const content = await buildSuggestedOutline(context);
    const nextVersion = expectedVersion + 1;
    const resourceVersionId = uuidv7();
    await client.query(
      `UPDATE resource_version SET lifecycle_status = 'superseded'
       WHERE resource_version_id = $1
         AND lifecycle_status IN ('draft', 'approved')`,
      [outline.current_resource_version_id],
    );
    await client.query(
      `INSERT INTO resource_version (
         resource_version_id, resource_id, version_no, lifecycle_status,
         validity_status, supersedes_version_id, schema_version,
         input_fingerprint, content_hash, created_by_user_id,
         created_by_actor_type
       ) VALUES ($1, $2, $3, 'draft', 'current', $4, '2.0', $5, $6, $7, 'system')`,
      [
        resourceVersionId,
        outline.resource_id,
        nextVersion,
        outline.current_resource_version_id,
        context.inputFingerprint,
        contentHash(content),
        input.userId,
      ],
    );
    await client.query(
      `INSERT INTO report_outline_version (
         resource_version_id, outline_id, version_no,
         template_resource_version_id, mapping_set_resource_version_id,
         validation_approval_id, valuation_approval_id,
         hypothesis_resource_version_id, generator_profile_version,
         content_json, created_by_user_id
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8,
         'report-outline-structured-v2', $9::jsonb, $10)`,
      [
        resourceVersionId,
        outline.outline_id,
        nextVersion,
        context.templateResourceVersionId,
        context.mappingSetResourceVersionId,
        context.validationApprovalId,
        context.valuationApprovalId,
        context.hypothesisResourceVersionId,
        JSON.stringify(content),
        input.userId,
      ],
    );
    await invalidateResourceDependents(client, {
      projectId: input.projectId,
      upstreamResourceVersionIds: [outline.current_resource_version_id],
    });
    await recordReportOutlineDependencies(
      client,
      context,
      resourceVersionId,
    );
    if (outline.status === "approved") {
      await invalidateProjectStages(client, {
        projectId: input.projectId,
        triggerVersionId: resourceVersionId,
        startStageKey: "report_outline",
        reasonCode: "REPORT_OUTLINE_CHANGED",
        transitions: [
          {
            stageKey: "report_outline",
            stageStatus: "in_progress",
            blockerCodes: [],
            clearCompletion: true,
            eligibleStatuses: [
              "in_progress",
              "completed",
              "revalidation_required",
            ],
          },
        ],
        markProjectRevalidation: true,
      });
    }
    const saved = await client.query<{ saved_at: Date }>(
      `UPDATE report_outline SET current_resource_version_id = $2,
         current_version = $3, status = 'editing', saved_at = now()
       WHERE project_id = $1 RETURNING saved_at`,
      [input.projectId, resourceVersionId, nextVersion],
    );
    await client.query(
      `DELETE FROM report_outline_page_review WHERE outline_id = $1`,
      [outline.outline_id],
    );
    const body = {
      taskId: resourceVersionId,
      operationStatus: "succeeded",
      outlineVersion: nextVersion,
      savedAt: saved.rows[0].saved_at.toISOString(),
      generationSource: content.generationSource,
      pages: content.pages.map((page) => ({
        ...page,
        reviewStatus: "needs-review",
      })),
    };
    await storeReplay(client, {
      userId: input.userId,
      operation: "report-outline.generate",
      projectId: input.projectId,
      key,
      requestHash,
      status: 202,
      body,
    });
    return { status: 202, body };
  });
}

async function readReport(
  client: TransactionClient,
  projectId: string,
  forUpdate = false,
): Promise<ReportRow | null> {
  const result = await client.query<ReportRow>(
    `SELECT report.report_id, report.resource_id,
       report.active_resource_version_id,
       report.approved_resource_version_id, report.current_version,
       report.status, report.updated_at, version.content_json,
       report.outline_approval_id
     FROM report
     JOIN report_version version
       ON version.resource_version_id = report.active_resource_version_id
     WHERE report.project_id = $1
     ${forUpdate ? "FOR UPDATE OF report" : ""}`,
    [projectId],
  );
  return result.rows[0] ?? null;
}

async function createReport(
  client: TransactionClient,
  input: {
    context: Context;
    outline: OutlineRow;
    outlineApprovalId: string;
    userId: string;
  },
): Promise<ReportRow> {
  const existing = await readReport(client, input.context.projectId);
  if (existing) {
    await recordReportVersionDependency(client, {
      projectId: input.context.projectId,
      outlineApprovalId: existing.outline_approval_id,
      downstreamResourceVersionId: existing.active_resource_version_id,
    });
    return existing;
  }
  const reportId = uuidv7();
  const resourceId = uuidv7();
  const resourceVersionId = uuidv7();
  const normalizedOutline = normalizeOutlineContent(input.outline.content_json);
  const draftTextByBlockId = await suggestReportDraft({
    outline: normalizedOutline,
    companyName: input.context.companyName,
    ticker: input.context.ticker,
    targetYear: input.context.targetYear,
    targetQuarter: input.context.targetQuarter,
    rating: input.context.rating,
    thesis: input.context.thesis,
    targetPer: input.context.targetPer,
    targetPrice: input.context.targetPrice,
    currentPrice: input.context.currentPrice,
    evidence: input.context.evidence.map((item) => ({
      evidenceId: item.evidenceId,
      title: item.title,
      oneLineValue: item.oneLineValue,
      quoteExact: item.quoteExact,
      stance: item.stance,
      machineStatus: item.machineStatus,
    })),
  });
  const document = buildReportDocument({
    outline: normalizedOutline,
    rating: input.context.rating,
    targetPer: input.context.targetPer,
    targetPrice: input.context.targetPrice,
    currentPrice: input.context.currentPrice,
    forwardEps: input.context.forwardEps,
    draftTextByBlockId,
    materializationsBySlotId: input.context.materializationsBySlotId,
  });
  await client.query(
    `INSERT INTO versioned_resource (
       resource_id, project_id, resource_kind, resource_key
     ) VALUES ($1, $2, 'report', 'main')`,
    [resourceId, input.context.projectId],
  );
  await client.query(
    `INSERT INTO report (
       project_id, report_id, resource_id, outline_approval_id,
       current_version, status
     ) VALUES ($1, $2, $3, $4, 1, 'working')`,
    [
      input.context.projectId,
      reportId,
      resourceId,
      input.outlineApprovalId,
    ],
  );
  await client.query(
    `INSERT INTO resource_version (
       resource_version_id, resource_id, version_no, lifecycle_status,
       validity_status, schema_version, input_fingerprint, content_hash,
       created_by_user_id, created_by_actor_type
     ) VALUES ($1, $2, 1, 'draft', 'current', '1.0', $3, $4, $5, 'system')`,
    [
      resourceVersionId,
      resourceId,
      input.context.inputFingerprint,
      reportContentHash(document),
      input.userId,
    ],
  );
  await client.query(
    `INSERT INTO report_version (
       resource_version_id, report_id, version_no, outline_approval_id,
       version_status, content_json, saved_by_user_id
     ) VALUES ($1, $2, 1, $3, 'working', $4::jsonb, $5)`,
    [
      resourceVersionId,
      reportId,
      input.outlineApprovalId,
      JSON.stringify(document),
      input.userId,
    ],
  );
  await client.query(
    `UPDATE report SET active_resource_version_id = $2 WHERE project_id = $1`,
    [input.context.projectId, resourceVersionId],
  );
  await recordReportVersionDependency(client, {
    projectId: input.context.projectId,
    outlineApprovalId: input.outlineApprovalId,
    downstreamResourceVersionId: resourceVersionId,
  });
  return (await readReport(client, input.context.projectId))!;
}

export async function approveReportOutline(input: {
  projectId: string;
  userId: string;
  idempotencyKey: string | null;
  expectedOutlineVersion: unknown;
  expectedInputVersions: unknown;
}): Promise<IdempotentResult> {
  const key = requireIdempotencyKey(input.idempotencyKey);
  const expectedVersion = requireVersion(
    input.expectedOutlineVersion,
    "outline version",
  );
  const requestHash = contentHash({
    expectedVersion,
    expectedInputVersions: input.expectedInputVersions,
  });
  return withTransaction(async (client) => {
    await lockIdempotency(client, {
      userId: input.userId,
      operation: "report-outline.approve",
      projectId: input.projectId,
      key,
    });
    const replayed = await replay(client, {
      userId: input.userId,
      operation: "report-outline.approve",
      projectId: input.projectId,
      key,
      requestHash,
    });
    if (replayed) return replayed;
    const context = await projectContext(
      client,
      input.projectId,
      input.userId,
    );
    if (
      contentHash(input.expectedInputVersions) !==
      contentHash(contextVersions(context))
    ) {
      throw new ApiError(
        409,
        "OUTLINE_REVALIDATION_REQUIRED",
        "승인하려는 입력 버전이 최신 상태와 다릅니다.",
      );
    }
    const outline = await readOutline(client, input.projectId, true);
    if (
      !outline ||
      !refsMatch(outline, context) ||
      Number(outline.current_version) !== expectedVersion
    ) {
      throw new ApiError(
        409,
        "OUTLINE_VERSION_CONFLICT",
        "최신 페이지 구성을 다시 불러와주세요.",
      );
    }
    const reviewed = await reviewedPageIds(
      client,
      outline.outline_id,
      expectedVersion,
    );
    const issues = validateOutline({
      outline: outline.content_json,
      templatePageIds: context.templatePages
        .sort((a, b) => a.pageNumber - b.pageNumber)
        .map((page) => page.pageId),
      mappingConfirmed: context.mappingConfirmed,
      evidencePassed: context.evidence.every(
        (item) => item.machineStatus === "passed",
      ),
      allPageIdsReviewed: reviewed,
    });
    if (issues.length > 0) {
      throw new ApiError(
        422,
        "OUTLINE_APPROVAL_BLOCKED",
        "확인하지 않은 페이지 또는 연결 오류가 있습니다.",
        {
          details: issues.map((issue) => ({
            path: issue.pageId ? `pages.${issue.pageId}` : "outline",
            code: issue.code,
            message: issue.message,
          })),
        },
      );
    }
    let approval = await client.query<{
      approval_id: string;
      approved_at: Date;
    }>(
      `SELECT approval_id, approved_at FROM report_outline_approval
       WHERE outline_resource_version_id = $1`,
      [outline.current_resource_version_id],
    );
    if (!approval.rows[0]) {
      const approvalId = uuidv7();
      approval = await client.query(
        `INSERT INTO report_outline_approval (
           approval_id, project_id, outline_id, outline_resource_version_id,
           outline_version, input_versions_json, approved_by_user_id
         ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
         RETURNING approval_id, approved_at`,
        [
          approvalId,
          input.projectId,
          outline.outline_id,
          outline.current_resource_version_id,
          expectedVersion,
          JSON.stringify(contextVersions(context)),
          input.userId,
        ],
      );
      await client.query(
        `UPDATE report_outline SET status = 'approved' WHERE project_id = $1`,
        [input.projectId],
      );
      await client.query(
        `UPDATE resource_version SET lifecycle_status = 'approved'
         WHERE resource_version_id = $1`,
        [outline.current_resource_version_id],
      );
    }
    const report = await createReport(client, {
      context,
      outline,
      outlineApprovalId: approval.rows[0].approval_id,
      userId: input.userId,
    });
    const completion = await client.query<{
      current_completion_id: string | null;
      completion_no: string;
    }>(
      `SELECT state.current_completion_id,
         COALESCE(MAX(completion.completion_no), 0)::text AS completion_no
       FROM project_stage_state state
       LEFT JOIN stage_completion completion
         ON completion.project_id = state.project_id
        AND completion.stage_key = state.stage_key
       WHERE state.project_id = $1 AND state.stage_key = 'report_outline'
       GROUP BY state.current_completion_id`,
      [input.projectId],
    );
    if (!completion.rows[0]?.current_completion_id) {
      const completionId = uuidv7();
      await client.query(
        `INSERT INTO stage_completion (
           stage_completion_id, project_id, stage_key, completion_no,
           primary_version_id, completed_by_user_id
         ) VALUES ($1, $2, 'report_outline', $3, $4, $5)`,
        [
          completionId,
          input.projectId,
          Number(completion.rows[0]?.completion_no ?? 0) + 1,
          outline.current_resource_version_id,
          input.userId,
        ],
      );
      await client.query(
        `UPDATE project_stage_state
         SET stage_status = 'completed', current_completion_id = $2,
           blocker_codes = '{}', completed_at = now(), updated_at = now()
         WHERE project_id = $1 AND stage_key = 'report_outline'`,
        [input.projectId, completionId],
      );
      await client.query(
        `UPDATE project SET row_version = row_version + 1,
           last_saved_at = now(), updated_at = now()
         WHERE project_id = $1`,
        [input.projectId],
      );
    }
    const body = {
      outline: {
        outlineId: outline.outline_id,
        version: expectedVersion,
        status: "approved",
        approvedAt: approval.rows[0].approved_at.toISOString(),
      },
      draftTask: {
        taskId: report.report_id,
        operationStatus: "succeeded",
        reportRoute: `/projects/${input.projectId}/report`,
      },
    };
    await storeReplay(client, {
      userId: input.userId,
      operation: "report-outline.approve",
      projectId: input.projectId,
      key,
      requestHash,
      status: 200,
      body,
    });
    return { status: 200, body };
  });
}

export async function hasGeneratedReport(
  projectId: string,
  userId: string,
): Promise<boolean> {
  return withTransaction(async (client) => {
    const result = await client.query(
      `SELECT 1 FROM report
       JOIN project ON project.project_id = report.project_id
       WHERE report.project_id = $1 AND project.owner_user_id = $2
         AND project.deleted_at IS NULL`,
      [projectId, userId],
    );
    return Boolean(result.rows[0]);
  });
}

async function activeEditSession(client: TransactionClient, reportId: string) {
  await client.query(
    `UPDATE report_edit_session SET session_status = 'expired'
     WHERE report_id = $1 AND session_status = 'active'
       AND lease_expires_at <= now()`,
    [reportId],
  );
  const result = await client.query<{
    edit_session_id: string;
    user_id: string;
    report_resource_version_id: string;
    lease_expires_at: Date;
    heartbeat_at: Date;
  }>(
    `SELECT edit_session_id, user_id, report_resource_version_id,
       lease_expires_at, heartbeat_at
     FROM report_edit_session
     WHERE report_id = $1 AND session_status = 'active' LIMIT 1`,
    [reportId],
  );
  return result.rows[0] ?? null;
}

async function latestReportState(
  client: TransactionClient,
  projectId: string,
) {
  const report = await readReport(client, projectId);
  if (!report) {
    throw new ApiError(
      409,
      "REPORT_PREREQUISITE_INCOMPLETE",
      "페이지 구성을 승인하고 보고서 초안을 생성해주세요.",
      {
        meta: {
          resumeRoute: resumeRouteForBlocker({
            projectId,
            fallbackStage: "report_outline",
          }),
        },
      },
    );
  }
  return report;
}

function reportVersionView(report: ReportRow) {
  return {
    reportId: report.report_id,
    activeVersionId: report.active_resource_version_id,
    version: Number(report.current_version),
    status: report.status,
    pageCount: report.content_json.pageCount,
    lastSavedAt: report.updated_at.toISOString(),
  };
}

async function latestJobs(client: TransactionClient, report: ReportRow) {
  const preview = await client.query<{
    preview_id: string;
    preview_status: string;
    source_artifact_id: string | null;
    warnings_json: unknown[];
    updated_at: Date;
  }>(
    `SELECT preview_id, preview_status, source_artifact_id,
       warnings_json, updated_at
     FROM report_preview WHERE report_resource_version_id = $1
     ORDER BY created_at DESC LIMIT 1`,
    [report.active_resource_version_id],
  );
  const validation = await client.query<{
    validation_run_id: string;
    validation_status: string;
    issues_json: unknown[];
    started_at: Date;
    finished_at: Date | null;
  }>(
    `SELECT validation_run_id, validation_status, issues_json,
       started_at, finished_at
     FROM report_validation_run WHERE report_resource_version_id = $1
     ORDER BY started_at DESC LIMIT 1`,
    [report.active_resource_version_id],
  );
  const approval = await client.query<{
    approval_id: string;
    approved_at: Date;
  }>(
    `SELECT approval_id, approved_at FROM report_approval
     WHERE report_resource_version_id = $1`,
    [report.active_resource_version_id],
  );
  const exportResult = approval.rows[0]
    ? await client.query<{
        export_id: string;
        operation_status: string;
        outcome: string;
        requested_at: Date;
      }>(
        `SELECT export_id, operation_status, outcome, requested_at
         FROM report_export WHERE report_approval_id = $1`,
        [approval.rows[0].approval_id],
      )
    : { rows: [] };
  return {
    preview: preview.rows[0]
      ? {
          previewId: preview.rows[0].preview_id,
          status: preview.rows[0].preview_status,
          artifactId: preview.rows[0].source_artifact_id,
          warnings: preview.rows[0].warnings_json,
          updatedAt: preview.rows[0].updated_at.toISOString(),
        }
      : null,
    validation: validation.rows[0]
      ? {
          validationRunId: validation.rows[0].validation_run_id,
          status: validation.rows[0].validation_status,
          issues: validation.rows[0].issues_json,
          startedAt: validation.rows[0].started_at.toISOString(),
          finishedAt: validation.rows[0].finished_at?.toISOString() ?? null,
        }
      : null,
    approval: approval.rows[0]
      ? {
          approvalId: approval.rows[0].approval_id,
          approvedAt: approval.rows[0].approved_at.toISOString(),
        }
      : null,
    export: exportResult.rows[0]
      ? {
          exportId: exportResult.rows[0].export_id,
          operationStatus: exportResult.rows[0].operation_status,
          outcome: exportResult.rows[0].outcome,
          requestedAt: exportResult.rows[0].requested_at.toISOString(),
        }
      : null,
  };
}

export async function getReportWorkspace(projectId: string, userId: string) {
  return withTransaction(async (client) => {
    const context = await projectContext(client, projectId, userId);
    const report = await latestReportState(client, projectId);
    const session = await activeEditSession(client, report.report_id);
    const jobs = await latestJobs(client, report);
    const templatePages = await resolvedTemplatePages(context);
    const hydratedReport = attachTemplateGeometry(
      report.content_json,
      templatePages,
      context.mappingBindings,
      context.materializationsBySlotId,
    );
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
      report: {
        ...reportVersionView(report),
        pageCount: hydratedReport.pageCount,
        validationStatus: jobs.validation?.status ?? "not_run",
        previewStatus: jobs.preview?.status ?? "not_created",
      },
      permissions: {
        canView: true,
        canEdit: report.status === "working",
        canApprove:
          report.status === "working" && jobs.validation?.status === "passed",
        canExport: Boolean(jobs.approval),
      },
      editSession: session
        ? {
            status: "locked",
            editSessionId: session.edit_session_id,
            expiresAt: session.lease_expires_at.toISOString(),
            heartbeatAt: session.heartbeat_at.toISOString(),
            ownedByCurrentUser: session.user_id === userId,
          }
        : null,
      pages: hydratedReport.pages,
      sourcePdf: {
        artifactId: context.sourcePdfArtifactId,
        filename: context.sourcePdfFilename,
        contentUrl: `/api/projects/${projectId}/artifacts/${context.sourcePdfArtifactId}/content`,
      },
      provenanceSummary: {
        evidenceCount: context.evidence.length,
        validationVersion: context.validationVersion,
        valuationVersion: context.valuationVersion,
        outlineVersion: Number(
          (
            await client.query<{ outline_version: string }>(
              `SELECT outline_version FROM report_outline_approval
               WHERE approval_id = $1`,
              [report.outline_approval_id],
            )
          ).rows[0]?.outline_version ?? 0,
        ),
      },
      jobs,
      navigation: {
        processRoute: processRoute(projectId, "report_outline"),
        valuationRoute: processRoute(projectId, "valuation"),
      },
    };
  });
}

export async function getReportPage(
  projectId: string,
  userId: string,
  pageId: string,
) {
  const workspace = await getReportWorkspace(projectId, userId);
  const page = workspace.pages.find((item) => item.pageId === pageId);
  if (!page) throw new ApiError(404, "PAGE_NOT_FOUND", "페이지를 찾을 수 없습니다.");
  return page;
}

export async function getReportVersions(projectId: string, userId: string) {
  return withTransaction(async (client) => {
    await projectContext(client, projectId, userId);
    const report = await latestReportState(client, projectId);
    const result = await client.query<{
      resource_version_id: string;
      version_no: string;
      version_status: string;
      saved_at: Date;
      saved_by_user_id: string;
      content_json: ReportDocument;
    }>(
      `SELECT resource_version_id, version_no, version_status, saved_at,
         saved_by_user_id, content_json
       FROM report_version WHERE report_id = $1
       ORDER BY version_no DESC`,
      [report.report_id],
    );
    return {
      versions: result.rows.map((row) => ({
        versionId: row.resource_version_id,
        version: Number(row.version_no),
        status: row.version_status,
        savedAt: row.saved_at.toISOString(),
        pageCount: row.content_json.pageCount,
        active: row.resource_version_id === report.active_resource_version_id,
      })),
    };
  });
}

export async function createReportEditSession(input: {
  projectId: string;
  userId: string;
  reportVersionId: unknown;
}) {
  const reportVersionId = requireUuidValue(
    input.reportVersionId,
    "INVALID_REPORT_VERSION",
  );
  return withTransaction(async (client) => {
    await projectContext(client, input.projectId, input.userId);
    const report = await latestReportState(client, input.projectId);
    await client.query(
      `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
      [report.report_id],
    );
    if (
      report.status !== "working" ||
      report.active_resource_version_id !== reportVersionId
    ) {
      throw new ApiError(
        409,
        "REPORT_VERSION_CONFLICT",
        "최신 작업 버전을 다시 불러와주세요.",
      );
    }
    const active = await activeEditSession(client, report.report_id);
    if (active) {
      throw new ApiError(
        409,
        "EDIT_SESSION_CONFLICT",
        "다른 탭에서 이 보고서를 편집하고 있습니다.",
        {
          meta: {
            editSessionId: active.edit_session_id,
            expiresAt: active.lease_expires_at.toISOString(),
          },
        },
      );
    }
    const editSessionId = uuidv7();
    const leaseToken = randomToken();
    const created = await client.query<{ lease_expires_at: Date }>(
      `INSERT INTO report_edit_session (
         edit_session_id, report_id, report_resource_version_id,
         user_id, session_status, lease_token_hash, lease_expires_at
       ) VALUES ($1, $2, $3, $4, 'active', $5,
         now() + interval '120 seconds')
       RETURNING lease_expires_at`,
      [
        editSessionId,
        report.report_id,
        reportVersionId,
        input.userId,
        sha256(leaseToken),
      ],
    );
    return {
      editSessionId,
      leaseToken,
      reportVersionId,
      expiresAt: created.rows[0].lease_expires_at.toISOString(),
      heartbeatSeconds: 30,
    };
  });
}

async function requireEditSession(
  client: TransactionClient,
  input: {
    report: ReportRow;
    editSessionId: string;
    leaseToken: string | null;
    userId: string;
  },
) {
  const token = input.leaseToken?.trim() ?? "";
  if (!token) {
    throw new ApiError(
      409,
      "EDIT_SESSION_CONFLICT",
      "편집 session을 다시 시작해주세요.",
    );
  }
  const result = await client.query<{
    report_resource_version_id: string;
    lease_expires_at: Date;
  }>(
    `SELECT report_resource_version_id, lease_expires_at
     FROM report_edit_session
     WHERE edit_session_id = $1 AND report_id = $2 AND user_id = $3
       AND session_status = 'active' AND lease_token_hash = $4
       AND lease_expires_at > now()
     FOR UPDATE`,
    [
      input.editSessionId,
      input.report.report_id,
      input.userId,
      sha256(token),
    ],
  );
  const session = result.rows[0];
  if (!session) {
    throw new ApiError(
      409,
      "EDIT_SESSION_CONFLICT",
      "편집권이 만료되었거나 다른 탭으로 이동했습니다.",
    );
  }
  if (
    session.report_resource_version_id !==
    input.report.active_resource_version_id
  ) {
    throw new ApiError(
      409,
      "REPORT_VERSION_CONFLICT",
      "최신 작업 버전을 다시 불러와주세요.",
    );
  }
  return session;
}

export async function heartbeatReportEditSession(input: {
  projectId: string;
  userId: string;
  editSessionId: string;
  leaseToken: string | null;
}) {
  return withTransaction(async (client) => {
    await projectContext(client, input.projectId, input.userId);
    const report = await latestReportState(client, input.projectId);
    await requireEditSession(client, { report, ...input });
    const updated = await client.query<{ lease_expires_at: Date }>(
      `UPDATE report_edit_session
       SET heartbeat_at = now(), lease_expires_at = now() + interval '120 seconds'
       WHERE edit_session_id = $1 RETURNING lease_expires_at`,
      [input.editSessionId],
    );
    return {
      editSessionId: input.editSessionId,
      expiresAt: updated.rows[0].lease_expires_at.toISOString(),
    };
  });
}

export async function releaseReportEditSession(input: {
  projectId: string;
  userId: string;
  editSessionId: string;
  leaseToken: string | null;
}) {
  return withTransaction(async (client) => {
    await projectContext(client, input.projectId, input.userId);
    const report = await latestReportState(client, input.projectId);
    await requireEditSession(client, { report, ...input });
    await client.query(
      `UPDATE report_edit_session SET session_status = 'released',
         lease_expires_at = now()
       WHERE edit_session_id = $1`,
      [input.editSessionId],
    );
  });
}

export async function takeoverReportEditSession(input: {
  projectId: string;
  userId: string;
  editSessionId: string;
}) {
  return withTransaction(async (client) => {
    await projectContext(client, input.projectId, input.userId);
    const report = await latestReportState(client, input.projectId);
    await client.query(
      `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
      [report.report_id],
    );
    const target = await client.query<{ lease_expires_at: Date }>(
      `SELECT lease_expires_at FROM report_edit_session
       WHERE edit_session_id = $1 AND report_id = $2
       FOR UPDATE`,
      [input.editSessionId, report.report_id],
    );
    if (
      target.rows[0] &&
      target.rows[0].lease_expires_at.getTime() > Date.now()
    ) {
      throw new ApiError(
        409,
        "EDIT_SESSION_CONFLICT",
        "기존 편집권이 아직 유지 중입니다.",
        { meta: { expiresAt: target.rows[0].lease_expires_at.toISOString() } },
      );
    }
    await client.query(
      `UPDATE report_edit_session SET session_status = 'expired'
       WHERE report_id = $1 AND session_status = 'active'`,
      [report.report_id],
    );
    const editSessionId = uuidv7();
    const leaseToken = randomToken();
    const created = await client.query<{ lease_expires_at: Date }>(
      `INSERT INTO report_edit_session (
         edit_session_id, report_id, report_resource_version_id,
         user_id, session_status, lease_token_hash, lease_expires_at
       ) VALUES ($1, $2, $3, $4, 'active', $5,
         now() + interval '120 seconds')
       RETURNING lease_expires_at`,
      [
        editSessionId,
        report.report_id,
        report.active_resource_version_id,
        input.userId,
        sha256(leaseToken),
      ],
    );
    return {
      editSessionId,
      leaseToken,
      reportVersionId: report.active_resource_version_id,
      expiresAt: created.rows[0].lease_expires_at.toISOString(),
      heartbeatSeconds: 30,
    };
  });
}

export async function patchReportVersion(input: {
  projectId: string;
  userId: string;
  reportVersionId: string;
  expectedVersion: unknown;
  editSessionId: unknown;
  leaseToken: string | null;
  clientMutationId: unknown;
  operations: unknown;
}) {
  const expectedVersion = requireVersion(input.expectedVersion);
  const reportVersionId = requireUuidValue(
    input.reportVersionId,
    "INVALID_REPORT_VERSION",
  );
  const editSessionId = requireUuidValue(
    input.editSessionId,
    "INVALID_EDIT_SESSION",
  );
  const clientMutationId = requireUuidValue(
    input.clientMutationId,
    "INVALID_CLIENT_MUTATION",
  );
  if (!Array.isArray(input.operations) || input.operations.length === 0) {
    throw new ApiError(
      400,
      "INVALID_REPORT_OPERATION",
      "저장할 편집 내용이 없습니다.",
    );
  }
  const operations = input.operations.map((raw) => {
    const value = raw as Record<string, unknown>;
    const type = String(value.type);
    if (
      type === "replace_chart_type" &&
      typeof value.blockId === "string" &&
      ["line", "bar", "area", "combo"].includes(String(value.chartType))
    ) {
      return {
        type,
        blockId: value.blockId,
        baseBlockRevision: requireVersion(
          value.baseBlockRevision,
          "block revision",
        ),
        chartType: value.chartType as ReportChartType,
      } as const;
    }
    if (
      !["replace_text", "replace_block_text"].includes(type) ||
      typeof value.blockId !== "string" ||
      typeof value.text !== "string"
    ) {
      throw new ApiError(
        400,
        "INVALID_REPORT_OPERATION",
        "편집 요청 형식이 올바르지 않습니다.",
      );
    }
    return {
      type: type as "replace_text" | "replace_block_text",
      blockId: value.blockId,
      baseBlockRevision: requireVersion(
        value.baseBlockRevision,
        "block revision",
      ),
      text: value.text,
    };
  });
  return withTransaction(async (client) => {
    const context = await projectContext(
      client,
      input.projectId,
      input.userId,
    );
    const report = await readReport(client, input.projectId, true);
    if (!report) {
      throw new ApiError(
        409,
        "REPORT_PREREQUISITE_INCOMPLETE",
        "보고서 초안을 먼저 생성해주세요.",
      );
    }
    const replayed = await client.query<{
      result_resource_version_id: string;
      version_no: string;
      saved_at: Date;
      content_json: ReportDocument;
    }>(
      `SELECT operation.result_resource_version_id, version.version_no,
         version.saved_at, version.content_json
       FROM report_edit_operation operation
       JOIN report_version version
         ON version.resource_version_id = operation.result_resource_version_id
       WHERE operation.report_id = $1 AND operation.client_mutation_id = $2`,
      [report.report_id, clientMutationId],
    );
    if (replayed.rows[0]) {
      return {
        reportVersionId: replayed.rows[0].result_resource_version_id,
        version: Number(replayed.rows[0].version_no),
        savedAt: replayed.rows[0].saved_at.toISOString(),
        pages: replayed.rows[0].content_json.pages,
      };
    }
    if (
      report.status !== "working" ||
      report.active_resource_version_id !== reportVersionId ||
      Number(report.current_version) !== expectedVersion
    ) {
      throw new ApiError(
        409,
        "REPORT_VERSION_CONFLICT",
        "다른 탭의 최신 보고서를 다시 불러와주세요.",
      );
    }
    await requireEditSession(client, {
      report,
      editSessionId,
      leaseToken: input.leaseToken,
      userId: input.userId,
    });
    let document;
    try {
      document = applyReportOperations(
        await hydrateReportDocument(context, report.content_json),
        operations,
      );
    } catch (error) {
      const code =
        error instanceof Error ? error.message : "INVALID_REPORT_OPERATION";
      const status =
        code === "REPORT_BLOCK_CONFLICT" ? 409 : code === "BLOCK_OVERFLOW" ? 422 : 400;
      throw new ApiError(
        status,
        code === "REPORT_BLOCK_CONFLICT" ? "REPORT_VERSION_CONFLICT" : code,
        code === "BLOCK_OVERFLOW"
          ? "문장이 원본 영역의 허용 길이를 넘었습니다."
          : code === "REPORT_BLOCK_CONFLICT"
            ? "편집한 문단의 최신 내용을 다시 불러와주세요."
            : "이 영역은 직접 편집할 수 없습니다.",
      );
    }
    const nextVersion = expectedVersion + 1;
    const nextResourceVersionId = uuidv7();
    await invalidateResourceDependents(client, {
      projectId: input.projectId,
      upstreamResourceVersionIds: [report.active_resource_version_id],
    });
    await client.query(
      `UPDATE resource_version SET lifecycle_status = 'superseded'
       WHERE resource_version_id = $1 AND lifecycle_status = 'draft'`,
      [report.active_resource_version_id],
    );
    await client.query(
      `UPDATE report_version SET version_status = 'superseded'
       WHERE resource_version_id = $1 AND version_status = 'working'`,
      [report.active_resource_version_id],
    );
    await client.query(
      `INSERT INTO resource_version (
         resource_version_id, resource_id, version_no, lifecycle_status,
         validity_status, supersedes_version_id, schema_version,
         input_fingerprint, content_hash, created_by_user_id,
         created_by_actor_type
       ) VALUES ($1, $2, $3, 'draft', 'current', $4, '1.0', $5, $6, $7, 'user')`,
      [
        nextResourceVersionId,
        report.resource_id,
        nextVersion,
        report.active_resource_version_id,
        context.inputFingerprint,
        reportContentHash(document),
        input.userId,
      ],
    );
    const saved = await client.query<{ saved_at: Date }>(
      `INSERT INTO report_version (
         resource_version_id, report_id, version_no,
         parent_resource_version_id, outline_approval_id,
         version_status, content_json, saved_by_user_id
       ) VALUES ($1, $2, $3, $4, $5, 'working', $6::jsonb, $7)
       RETURNING saved_at`,
      [
        nextResourceVersionId,
        report.report_id,
        nextVersion,
        report.active_resource_version_id,
        report.outline_approval_id,
        JSON.stringify(document),
        input.userId,
      ],
    );
    await client.query(
      `UPDATE report SET active_resource_version_id = $2,
         current_version = $3, updated_at = now()
       WHERE project_id = $1`,
      [input.projectId, nextResourceVersionId, nextVersion],
    );
    await recordReportVersionDependency(client, {
      projectId: input.projectId,
      outlineApprovalId: report.outline_approval_id,
      downstreamResourceVersionId: nextResourceVersionId,
    });
    await client.query(
      `UPDATE report_edit_session SET report_resource_version_id = $2,
         heartbeat_at = now(), lease_expires_at = now() + interval '120 seconds'
       WHERE edit_session_id = $1`,
      [editSessionId, nextResourceVersionId],
    );
    await client.query(
      `INSERT INTO report_edit_operation (
         operation_id, report_id, base_resource_version_id,
         result_resource_version_id, edit_session_id, client_mutation_id,
         operations_json, created_by_user_id
       ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)`,
      [
        uuidv7(),
        report.report_id,
        report.active_resource_version_id,
        nextResourceVersionId,
        editSessionId,
        clientMutationId,
        JSON.stringify(operations),
        input.userId,
      ],
    );
    await client.query(
      `UPDATE report_preview SET preview_status = 'stale', updated_at = now()
       WHERE report_resource_version_id = $1 AND preview_status = 'ready'`,
      [report.active_resource_version_id],
    );
    return {
      reportVersionId: nextResourceVersionId,
      version: nextVersion,
      savedAt: saved.rows[0].saved_at.toISOString(),
      pages: document.pages,
    };
  });
}

export async function restoreReportVersion(input: {
  projectId: string;
  userId: string;
  versionId: string;
  idempotencyKey: string | null;
}): Promise<IdempotentResult> {
  const key = requireIdempotencyKey(input.idempotencyKey);
  const versionId = requireUuidValue(input.versionId, "INVALID_REPORT_VERSION");
  const requestHash = contentHash({ versionId });
  return withTransaction(async (client) => {
    const context = await projectContext(
      client,
      input.projectId,
      input.userId,
    );
    await lockIdempotency(client, {
      userId: input.userId,
      operation: "report.restore",
      projectId: input.projectId,
      key,
    });
    const replayed = await replay(client, {
      userId: input.userId,
      operation: "report.restore",
      projectId: input.projectId,
      key,
      requestHash,
    });
    if (replayed) return replayed;
    const report = await readReport(client, input.projectId, true);
    if (!report) throw new ApiError(404, "REPORT_NOT_FOUND", "보고서를 찾을 수 없습니다.");
    const source = await client.query<{ content_json: ReportDocument }>(
      `SELECT content_json FROM report_version
       WHERE resource_version_id = $1 AND report_id = $2`,
      [versionId, report.report_id],
    );
    if (!source.rows[0]) {
      throw new ApiError(404, "REPORT_VERSION_NOT_FOUND", "보고서 버전을 찾을 수 없습니다.");
    }
    const nextVersion = Number(report.current_version) + 1;
    const nextId = uuidv7();
    await invalidateResourceDependents(client, {
      projectId: input.projectId,
      upstreamResourceVersionIds: [report.active_resource_version_id],
    });
    await client.query(
      `UPDATE resource_version SET lifecycle_status = 'superseded'
       WHERE resource_version_id = $1
         AND lifecycle_status IN ('draft', 'approved')`,
      [report.active_resource_version_id],
    );
    await client.query(
      `UPDATE report_version SET version_status = 'superseded'
       WHERE resource_version_id = $1
         AND version_status IN ('working', 'approved')`,
      [report.active_resource_version_id],
    );
    await client.query(
      `INSERT INTO resource_version (
         resource_version_id, resource_id, version_no, lifecycle_status,
         validity_status, supersedes_version_id, schema_version,
         input_fingerprint, content_hash, created_by_user_id,
         created_by_actor_type
       ) VALUES ($1, $2, $3, 'draft', 'current', $4, '1.0', $5, $6, $7, 'user')`,
      [
        nextId,
        report.resource_id,
        nextVersion,
        report.active_resource_version_id,
        context.inputFingerprint,
        reportContentHash(source.rows[0].content_json),
        input.userId,
      ],
    );
    await client.query(
      `INSERT INTO report_version (
         resource_version_id, report_id, version_no,
         parent_resource_version_id, outline_approval_id,
         version_status, content_json, saved_by_user_id
       ) VALUES ($1, $2, $3, $4, $5, 'working', $6::jsonb, $7)`,
      [
        nextId,
        report.report_id,
        nextVersion,
        versionId,
        report.outline_approval_id,
        JSON.stringify(source.rows[0].content_json),
        input.userId,
      ],
    );
    await client.query(
      `UPDATE report SET active_resource_version_id = $2,
         approved_resource_version_id = NULL,
         current_version = $3, status = 'working', updated_at = now()
       WHERE project_id = $1`,
      [input.projectId, nextId, nextVersion],
    );
    await recordReportVersionDependency(client, {
      projectId: input.projectId,
      outlineApprovalId: report.outline_approval_id,
      downstreamResourceVersionId: nextId,
    });
    const body = { reportVersionId: nextId, version: nextVersion, status: "working" };
    await storeReplay(client, {
      userId: input.userId,
      operation: "report.restore",
      projectId: input.projectId,
      key,
      requestHash,
      status: 201,
      body,
    });
    return { status: 201, body };
  });
}

export async function createReportAiProposal(input: {
  projectId: string;
  userId: string;
  reportVersionId: unknown;
  blockId: unknown;
  prompt: unknown;
}) {
  const reportVersionId = requireUuidValue(
    input.reportVersionId,
    "INVALID_REPORT_VERSION",
  );
  if (
    typeof input.blockId !== "string" ||
    typeof input.prompt !== "string" ||
    !input.prompt.trim() ||
    input.prompt.length > 500
  ) {
    throw new ApiError(
      400,
      "INVALID_REPORT_OPERATION",
      "AI 수정 범위와 요청을 확인해주세요.",
    );
  }
  const blockId = input.blockId;
  const prompt = input.prompt.trim();
  return withTransaction(async (client) => {
    const context = await projectContext(
      client,
      input.projectId,
      input.userId,
    );
    const report = await latestReportState(client, input.projectId);
    if (
      report.status !== "working" ||
      report.active_resource_version_id !== reportVersionId
    ) {
      throw new ApiError(
        409,
        "REPORT_VERSION_CONFLICT",
        "최신 작업 버전에서 다시 요청해주세요.",
      );
    }
    const hydrated = await hydrateReportDocument(
      context,
      report.content_json,
    );
    const block = hydrated.pages
      .flatMap((page) => page.blocks)
      .find((item) => item.blockId === blockId);
    if (!block?.editable) {
      throw new ApiError(
        400,
        "INVALID_REPORT_OPERATION",
        "이 영역은 AI 문장 수정 대상이 아닙니다.",
      );
    }
    const proposalId = uuidv7();
    const proposedText = proposeReportRewrite(block.text, prompt);
    await client.query(
      `INSERT INTO report_ai_proposal (
         proposal_id, project_id, report_id, base_resource_version_id,
         block_id, prompt, original_text, proposed_text, proposal_status,
         model_profile_version, created_by_user_id
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'ready',
         'report-rewrite-structured-v1', $9)`,
      [
        proposalId,
        input.projectId,
        report.report_id,
        reportVersionId,
        blockId,
        prompt,
        block.text,
        proposedText,
        input.userId,
      ],
    );
    return {
      proposalId,
      status: "ready",
      blockId,
      originalText: block.text,
      proposedText,
      checks: {
        numbersPreserved: true,
        evidencePreserved: true,
        judgementPreserved: true,
      },
    };
  });
}

export async function getReportAiProposal(
  projectId: string,
  userId: string,
  proposalId: string,
) {
  return withTransaction(async (client) => {
    await projectContext(client, projectId, userId);
    const result = await client.query<{
      proposal_id: string;
      base_resource_version_id: string;
      block_id: string;
      original_text: string;
      proposed_text: string;
      proposal_status: string;
      created_at: Date;
    }>(
      `SELECT proposal_id, base_resource_version_id, block_id,
         original_text, proposed_text, proposal_status, created_at
       FROM report_ai_proposal
       WHERE proposal_id = $1 AND project_id = $2`,
      [proposalId, projectId],
    );
    const row = result.rows[0];
    if (!row) throw new ApiError(404, "PROPOSAL_NOT_FOUND", "AI 제안을 찾을 수 없습니다.");
    return {
      proposalId: row.proposal_id,
      reportVersionId: row.base_resource_version_id,
      blockId: row.block_id,
      originalText: row.original_text,
      proposedText: row.proposed_text,
      status: row.proposal_status,
      createdAt: row.created_at.toISOString(),
    };
  });
}

export async function applyReportAiProposal(input: {
  projectId: string;
  userId: string;
  proposalId: string;
  expectedVersion: unknown;
  editSessionId: unknown;
  leaseToken: string | null;
  clientMutationId: unknown;
}) {
  const proposal = await getReportAiProposal(
    input.projectId,
    input.userId,
    input.proposalId,
  );
  if (proposal.status !== "ready") {
    throw new ApiError(409, "PROPOSAL_STALE", "이미 처리됐거나 오래된 AI 제안입니다.");
  }
  const workspace = await getReportWorkspace(input.projectId, input.userId);
  const block = workspace.pages
    .flatMap((page) => page.blocks)
    .find((item) => item.blockId === proposal.blockId);
  if (
    workspace.report.activeVersionId !== proposal.reportVersionId ||
    !block ||
    block.text !== proposal.originalText
  ) {
    await withTransaction((client) =>
      client.query(
        `UPDATE report_ai_proposal SET proposal_status = 'stale'
         WHERE proposal_id = $1`,
        [input.proposalId],
      ),
    );
    throw new ApiError(409, "PROPOSAL_STALE", "문단이 변경되어 AI 제안을 다시 받아야 합니다.");
  }
  const result = await patchReportVersion({
    projectId: input.projectId,
    userId: input.userId,
    reportVersionId: proposal.reportVersionId,
    expectedVersion: input.expectedVersion,
    editSessionId: input.editSessionId,
    leaseToken: input.leaseToken,
    clientMutationId: input.clientMutationId,
    operations: [
      {
        type: "replace_block_text",
        blockId: proposal.blockId,
        baseBlockRevision: block.revision,
        text: proposal.proposedText,
      },
    ],
  });
  await withTransaction((client) =>
    client.query(
      `UPDATE report_ai_proposal SET proposal_status = 'applied',
         applied_at = now() WHERE proposal_id = $1`,
      [input.proposalId],
    ),
  );
  return result;
}

export async function getReportProvenance(
  projectId: string,
  userId: string,
  blockId: string,
) {
  return withTransaction(async (client) => {
    const context = await projectContext(client, projectId, userId);
    const report = await latestReportState(client, projectId);
    const hydrated = await hydrateReportDocument(
      context,
      report.content_json,
    );
    const block = hydrated.pages
      .flatMap((page) => page.blocks)
      .find((item) => item.blockId === blockId);
    if (!block) throw new ApiError(404, "BLOCK_NOT_FOUND", "보고서 영역을 찾을 수 없습니다.");
    return {
      block: {
        blockId: block.blockId,
        pageId: block.pageId,
        label: block.label,
        numericAuthority: block.numericAuthority,
      },
      binding: block.dataBinding ?? null,
      materialization: block.materializedData ?? null,
      evidence: context.evidence.filter((item) =>
        block.evidenceIds.includes(item.evidenceId),
      ),
      calculation:
        block.numericAuthority === "valuation_approval"
          ? {
              workbookVersion: context.workbookVersion,
              forwardEps: context.forwardEps,
              targetPer: context.targetPer,
              targetPrice: context.targetPrice,
              path: "검증 입력 → Forward EPS → Target PER → 목표주가",
            }
          : null,
    };
  });
}

export async function createReportPreview(input: {
  projectId: string;
  userId: string;
  reportVersionId: unknown;
}) {
  const versionId = requireUuidValue(
    input.reportVersionId,
    "INVALID_REPORT_VERSION",
  );
  const snapshot = await withTransaction(async (client) => {
    const context = await projectContext(
      client,
      input.projectId,
      input.userId,
    );
    const report = await latestReportState(client, input.projectId);
    if (report.active_resource_version_id !== versionId) {
      throw new ApiError(
        409,
        "REPORT_VERSION_CONFLICT",
        "저장된 최신 보고서로 미리보기를 생성해주세요.",
      );
    }
    const existing = await client.query<{
      preview_id: string;
      preview_status: string;
      source_artifact_id: string | null;
      warnings_json: PdfRenderWarning[];
      updated_at: Date;
    }>(
      `SELECT preview_id, preview_status, source_artifact_id,
         warnings_json, updated_at
       FROM report_preview
       WHERE report_resource_version_id = $1 AND preview_status = 'ready'
       ORDER BY created_at DESC LIMIT 1`,
      [versionId],
    );
    if (
      existing.rows[0]?.source_artifact_id &&
      existing.rows[0].source_artifact_id !== context.sourcePdfArtifactId
    ) {
      return {
        existing: {
        previewId: existing.rows[0].preview_id,
        status: existing.rows[0].preview_status,
          artifactId: existing.rows[0].source_artifact_id,
          contentUrl:
            `/api/projects/${input.projectId}/artifacts/` +
            `${existing.rows[0].source_artifact_id}/content`,
          warnings: existing.rows[0].warnings_json,
          updatedAt: existing.rows[0].updated_at.toISOString(),
        },
        context,
        report,
      };
    }
    return {
      existing: null,
      context,
      report,
    };
  });
  if (snapshot.existing) return snapshot.existing;

  const templatePages = await resolvedTemplatePages(snapshot.context);
  const document = attachTemplateGeometry(
    snapshot.report.content_json,
    templatePages,
    snapshot.context.mappingBindings,
    snapshot.context.materializationsBySlotId,
  );
  const patches = document.pages.flatMap((page) =>
    page.blocks
      .filter(
        (block) =>
          block.editable &&
          block.bbox &&
          block.patchStrategy !== "fixed" &&
          block.sourceCoverage !== "review_required",
      )
      .map((block) => ({
        blockId: block.blockId,
        pageNumber: page.pageNumber,
        bbox: block.bbox,
        text: block.text,
        role: block.role,
        templateBlockId: block.templateBlockId,
        sourceObjectIds: block.sourceObjectIds,
      })),
  );
  const skippedBlocks = document.pages.flatMap((page) =>
    page.blocks
      .filter(
        (block) =>
          block.editable &&
          (!block.bbox || block.sourceCoverage === "review_required"),
      )
      .map((block) => ({
        code:
          block.sourceCoverage === "review_required"
            ? "SOURCE_TEXT_COVERAGE_INCOMPLETE"
            : "EDITABLE_BLOCK_WITHOUT_SOURCE_GEOMETRY",
        message:
          block.sourceCoverage === "review_required"
            ? `${page.pageNumber}페이지 ${block.label}의 원문 범위가 불완전해 원본을 유지했습니다.`
            : `${page.pageNumber}페이지 ${block.label}의 원본 좌표를 찾지 못해 PDF에 반영하지 않았습니다.`,
      })),
  );
  const downloadUrl = await createWorkerDownloadUrl(
    snapshot.context.sourcePdfObjectKey,
    10 * 60,
  );
  const rendered = await callPdfWorker<PdfRenderResult>("/render", {
    downloadUrl,
    patches,
    skipOverflow: true,
  });
  const pdfBytes = Buffer.from(rendered.pdfBase64, "base64");
  if (
    rendered.mediaType !== "application/pdf" ||
    rendered.byteSize !== pdfBytes.byteLength ||
    rendered.sha256 !== createHash("sha256").update(pdfBytes).digest("hex") ||
    !rendered.validation?.passed
  ) {
    throw new ApiError(
      503,
      "PDF_RENDER_INTEGRITY_FAILED",
      "생성된 PDF의 무결성 또는 고정 영역 검증에 실패했습니다.",
      { retryable: true },
    );
  }

  const artifactId = uuidv7();
  const previewId = uuidv7();
  const objectKey =
    `projects/${input.projectId}/report/previews/` +
    `${versionId}-${previewId}-${rendered.sha256.slice(0, 12)}.pdf`;
  const stored = await putImmutableObject({
    objectKey,
    body: pdfBytes,
    mediaType: "application/pdf",
    metadata: {
      project: input.projectId,
      reportVersion: versionId,
      sourcePdfHash: rendered.renderPlan.sourcePdfHash,
      renderPlanVersion: rendered.renderPlan.version,
    },
  });
  const warnings = [...rendered.warnings, ...skippedBlocks];
  const filename = snapshot.context.sourcePdfFilename.replace(
    /\.pdf$/i,
    "-preview.pdf",
  );
  return withTransaction(async (client) => {
    const context = await projectContext(
      client,
      input.projectId,
      input.userId,
    );
    const current = await latestReportState(client, input.projectId);
    if (current.active_resource_version_id !== versionId) {
      throw new ApiError(
        409,
        "REPORT_VERSION_CONFLICT",
        "PDF 생성 중 보고서가 변경되었습니다. 최신 버전으로 다시 생성해주세요.",
      );
    }
    await client.query(
      `UPDATE report_preview
       SET preview_status = 'stale', updated_at = now()
       WHERE report_resource_version_id = $1
         AND preview_status = 'ready'`,
      [versionId],
    );
    await client.query(
      `INSERT INTO artifact (
         artifact_id, project_id, artifact_kind, storage_status, bucket_name,
         object_key, object_version, sha256, byte_size, media_type,
         original_filename, retention_class, created_by_actor_type,
         supersedes_artifact_id
       ) VALUES ($1, $2, 'render', 'accepted', $3, $4, $5, $6, $7,
         'application/pdf', $8, 'project', 'system', $9)`,
      [
        artifactId,
        input.projectId,
        objectStoreBucket(),
        objectKey,
        stored.objectVersion,
        rendered.sha256,
        pdfBytes.byteLength,
        filename,
        context.sourcePdfArtifactId,
      ],
    );
    const created = await client.query<{ updated_at: Date }>(
      `INSERT INTO report_preview (
         preview_id, project_id, report_resource_version_id,
         preview_status, source_artifact_id, warnings_json, created_by_user_id
       ) VALUES ($1, $2, $3, 'ready', $4, $5::jsonb, $6)
       RETURNING updated_at`,
      [
        previewId,
        input.projectId,
        versionId,
        artifactId,
        JSON.stringify(warnings),
        input.userId,
      ],
    );
    return {
      previewId,
      status: "ready",
      artifactId,
      contentUrl: `/api/projects/${input.projectId}/artifacts/${artifactId}/content`,
      warnings,
      updatedAt: created.rows[0].updated_at.toISOString(),
    };
  });
}

export async function getReportPreview(
  projectId: string,
  userId: string,
  previewId: string,
) {
  return withTransaction(async (client) => {
    await projectContext(client, projectId, userId);
    const result = await client.query<{
      preview_id: string;
      report_resource_version_id: string;
      preview_status: string;
      source_artifact_id: string | null;
      warnings_json: unknown[];
      updated_at: Date;
    }>(
      `SELECT preview_id, report_resource_version_id, preview_status,
         source_artifact_id, warnings_json, updated_at
       FROM report_preview WHERE preview_id = $1 AND project_id = $2`,
      [previewId, projectId],
    );
    const row = result.rows[0];
    if (!row) throw new ApiError(404, "PREVIEW_NOT_FOUND", "미리보기를 찾을 수 없습니다.");
    return {
      previewId: row.preview_id,
      reportVersionId: row.report_resource_version_id,
      status: row.preview_status,
      artifactId: row.source_artifact_id,
      contentUrl: row.source_artifact_id
        ? `/api/projects/${projectId}/artifacts/${row.source_artifact_id}/content`
        : null,
      warnings: row.warnings_json,
      updatedAt: row.updated_at.toISOString(),
    };
  });
}

export async function createReportValidation(input: {
  projectId: string;
  userId: string;
  reportVersionId: unknown;
}) {
  const versionId = requireUuidValue(
    input.reportVersionId,
    "INVALID_REPORT_VERSION",
  );
  return withTransaction(async (client) => {
    const context = await projectContext(
      client,
      input.projectId,
      input.userId,
    );
    const report = await latestReportState(client, input.projectId);
    if (report.active_resource_version_id !== versionId) {
      throw new ApiError(
        409,
        "VALIDATION_STALE",
        "최신 저장 버전으로 다시 검증해주세요.",
      );
    }
    const templatePages = await resolvedTemplatePages(context);
    const hydrated = attachTemplateGeometry(
      report.content_json,
      templatePages,
      context.mappingBindings,
      context.materializationsBySlotId,
    );
    const issues = validateReportDocument({
      document: hydrated,
      templatePageIds: [...templatePages]
        .sort((a, b) => a.pageNumber - b.pageNumber)
        .map((page) => page.pageId),
      evidenceIds: new Set(context.evidence.map((item) => item.evidenceId)),
      valuationText: {
        targetPer: context.targetPer,
        targetPrice: context.targetPrice,
        forwardEps: context.forwardEps,
      },
    });
    const validationRunId = uuidv7();
    const status = issues.some((issue) => issue.severity === "blocking")
      ? "failed"
      : "passed";
    const created = await client.query<{ started_at: Date; finished_at: Date }>(
      `INSERT INTO report_validation_run (
         validation_run_id, project_id, report_resource_version_id,
         validation_status, issues_json, rule_version, created_by_user_id,
         finished_at
       ) VALUES ($1, $2, $3, $4, $5::jsonb, 'report-validation-v1', $6, now())
       RETURNING started_at, finished_at`,
      [
        validationRunId,
        input.projectId,
        versionId,
        status,
        JSON.stringify(issues),
        input.userId,
      ],
    );
    return {
      validationRunId,
      status,
      issues,
      startedAt: created.rows[0].started_at.toISOString(),
      finishedAt: created.rows[0].finished_at.toISOString(),
    };
  });
}

export async function getReportValidation(
  projectId: string,
  userId: string,
  validationRunId: string,
) {
  return withTransaction(async (client) => {
    await projectContext(client, projectId, userId);
    const result = await client.query<{
      validation_run_id: string;
      report_resource_version_id: string;
      validation_status: string;
      issues_json: unknown[];
      acknowledged_warning_codes: string[];
      started_at: Date;
      finished_at: Date | null;
    }>(
      `SELECT validation_run_id, report_resource_version_id,
         validation_status, issues_json, acknowledged_warning_codes,
         started_at, finished_at
       FROM report_validation_run
       WHERE validation_run_id = $1 AND project_id = $2`,
      [validationRunId, projectId],
    );
    const row = result.rows[0];
    if (!row) throw new ApiError(404, "VALIDATION_NOT_FOUND", "검증 결과를 찾을 수 없습니다.");
    return {
      validationRunId: row.validation_run_id,
      reportVersionId: row.report_resource_version_id,
      status: row.validation_status,
      issues: row.issues_json,
      acknowledgedWarningCodes: row.acknowledged_warning_codes,
      startedAt: row.started_at.toISOString(),
      finishedAt: row.finished_at?.toISOString() ?? null,
    };
  });
}

const allowedWarnings = new Set([
  "FONT_SUBSTITUTED_WITHIN_METRIC_TOLERANCE",
  "LOW_RESOLUTION_SOURCE_IMAGE",
  "OPTIONAL_SOURCE_LINK_UNAVAILABLE",
  "MINOR_DYNAMIC_PIXEL_DIFF",
]);

export async function acknowledgeReportWarnings(input: {
  projectId: string;
  userId: string;
  validationRunId: string;
  warningCodes: unknown;
}) {
  if (
    !Array.isArray(input.warningCodes) ||
    input.warningCodes.some(
      (code) => typeof code !== "string" || !allowedWarnings.has(code),
    )
  ) {
    throw new ApiError(
      400,
      "INVALID_WARNING_ACKNOWLEDGEMENT",
      "확인할 수 없는 검증 경고입니다.",
    );
  }
  return withTransaction(async (client) => {
    await projectContext(client, input.projectId, input.userId);
    const updated = await client.query<{
      validation_status: string;
      acknowledged_warning_codes: string[];
    }>(
      `UPDATE report_validation_run
       SET acknowledged_warning_codes = $3::text[],
         validation_status = CASE
           WHEN validation_status = 'passed_with_warnings' THEN 'passed_with_warnings'
           ELSE validation_status END
       WHERE validation_run_id = $1 AND project_id = $2
       RETURNING validation_status, acknowledged_warning_codes`,
      [input.validationRunId, input.projectId, input.warningCodes],
    );
    if (!updated.rows[0]) {
      throw new ApiError(404, "VALIDATION_NOT_FOUND", "검증 결과를 찾을 수 없습니다.");
    }
    return {
      validationRunId: input.validationRunId,
      status: updated.rows[0].validation_status,
      acknowledgedWarningCodes: updated.rows[0].acknowledged_warning_codes,
    };
  });
}

export async function approveReportVersion(input: {
  projectId: string;
  userId: string;
  versionId: string;
  validationRunId: unknown;
  idempotencyKey: string | null;
}): Promise<IdempotentResult> {
  const key = requireIdempotencyKey(input.idempotencyKey);
  const versionId = requireUuidValue(input.versionId, "INVALID_REPORT_VERSION");
  const validationRunId = requireUuidValue(
    input.validationRunId,
    "INVALID_VALIDATION_RUN",
  );
  const requestHash = contentHash({ versionId, validationRunId });
  return withTransaction(async (client) => {
    await projectContext(client, input.projectId, input.userId);
    await lockIdempotency(client, {
      userId: input.userId,
      operation: "report.approve",
      projectId: input.projectId,
      key,
    });
    const replayed = await replay(client, {
      userId: input.userId,
      operation: "report.approve",
      projectId: input.projectId,
      key,
      requestHash,
    });
    if (replayed) return replayed;
    const report = await readReport(client, input.projectId, true);
    if (
      !report ||
      report.status !== "working" ||
      report.active_resource_version_id !== versionId
    ) {
      throw new ApiError(
        409,
        "APPROVAL_VERSION_MISMATCH",
        "승인하려는 보고서 버전이 최신 상태와 다릅니다.",
      );
    }
    const validation = await client.query<{
      validation_status: string;
      report_resource_version_id: string;
      issues_json: Array<{ severity?: string }>;
    }>(
      `SELECT validation_status, report_resource_version_id, issues_json
       FROM report_validation_run
       WHERE validation_run_id = $1 AND project_id = $2`,
      [validationRunId, input.projectId],
    );
    const validated = validation.rows[0];
    if (
      !validated ||
      validated.report_resource_version_id !== versionId ||
      !["passed", "passed_with_warnings"].includes(validated.validation_status) ||
      validated.issues_json.some((issue) => issue.severity === "blocking")
    ) {
      throw new ApiError(
        409,
        "VALIDATION_STALE",
        "최신 보고서의 검증을 통과한 뒤 승인해주세요.",
      );
    }
    const approvalId = uuidv7();
    const approved = await client.query<{ approved_at: Date }>(
      `INSERT INTO report_approval (
         approval_id, project_id, report_resource_version_id,
         validation_run_id, approved_by_user_id
       ) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (report_resource_version_id) DO UPDATE SET
         report_resource_version_id = EXCLUDED.report_resource_version_id
       RETURNING approved_at`,
      [
        approvalId,
        input.projectId,
        versionId,
        validationRunId,
        input.userId,
      ],
    );
    const storedApproval = await client.query<{ approval_id: string }>(
      `SELECT approval_id FROM report_approval
       WHERE report_resource_version_id = $1`,
      [versionId],
    );
    await client.query(
      `UPDATE report_version SET version_status = 'approved'
       WHERE resource_version_id = $1`,
      [versionId],
    );
    await client.query(
      `UPDATE resource_version SET lifecycle_status = 'approved'
       WHERE resource_version_id = $1`,
      [versionId],
    );
    await client.query(
      `UPDATE report SET status = 'approved',
         approved_resource_version_id = $2, updated_at = now()
       WHERE project_id = $1`,
      [input.projectId, versionId],
    );
    await client.query(
      `UPDATE report_edit_session SET session_status = 'released',
         lease_expires_at = now()
       WHERE report_id = $1 AND session_status = 'active'`,
      [report.report_id],
    );
    const body = {
      approvalId: storedApproval.rows[0].approval_id,
      reportVersionId: versionId,
      validationRunId,
      status: "approved",
      approvedAt: approved.rows[0].approved_at.toISOString(),
    };
    await storeReplay(client, {
      userId: input.userId,
      operation: "report.approve",
      projectId: input.projectId,
      key,
      requestHash,
      status: 200,
      body,
    });
    return { status: 200, body };
  });
}

async function exportView(
  client: TransactionClient,
  context: Context,
  exportId: string,
) {
  const result = await client.query<{
    export_id: string;
    operation_status: string;
    outcome: string;
    requested_at: Date;
    updated_at: Date;
    approval_id: string;
    report_resource_version_id: string;
    approved_at: Date;
    artifact_type: "pdf" | "xlsx";
    source_artifact_id: string | null;
    artifact_status: string;
    attempt_no: number;
    retryable: boolean;
    error_code: string | null;
    error_message: string | null;
    byte_size: string | null;
  }>(
    `SELECT export.export_id, export.operation_status, export.outcome,
       export.requested_at, export.updated_at, approval.approval_id,
       approval.report_resource_version_id, approval.approved_at,
       file.artifact_type, file.source_artifact_id, file.artifact_status,
       file.attempt_no, file.retryable, file.error_code, file.error_message,
       artifact.byte_size
     FROM report_export export
     JOIN report_approval approval
       ON approval.approval_id = export.report_approval_id
     JOIN report_export_artifact file ON file.export_id = export.export_id
     LEFT JOIN artifact ON artifact.artifact_id = file.source_artifact_id
     WHERE export.export_id = $1 AND export.project_id = $2
     ORDER BY file.artifact_type`,
    [exportId, context.projectId],
  );
  if (result.rows.length === 0) {
    throw new ApiError(404, "EXPORT_NOT_FOUND", "내보내기 작업을 찾을 수 없습니다.");
  }
  const first = result.rows[0];
  const reportVersion = await client.query<{ version_no: string }>(
    `SELECT version_no FROM report_version WHERE resource_version_id = $1`,
    [first.report_resource_version_id],
  );
  const version = Number(reportVersion.rows[0]?.version_no ?? 1);
  return {
    exportId: first.export_id,
    operationStatus: first.operation_status,
    outcome: first.outcome,
    approvedReportVersionId: first.report_resource_version_id,
    requestedAt: first.requested_at.toISOString(),
    updatedAt: first.updated_at.toISOString(),
    artifacts: result.rows.map((row) => ({
      type: row.artifact_type,
      artifactId: row.source_artifact_id,
      status: row.artifact_status,
      attempt: row.attempt_no,
      retryable: row.retryable,
      error:
        row.error_code && row.error_message
          ? { code: row.error_code, message: row.error_message }
          : null,
      filename: reportFilename({
        companyName: context.companyName,
        ticker: context.ticker,
        year: context.targetYear,
        quarter: context.targetQuarter,
        reportVersion: version,
        approvedAt: first.approved_at,
        extension: row.artifact_type,
      }),
      byteSize: row.byte_size ? Number(row.byte_size) : null,
      downloadPath:
        row.artifact_status === "ready" && row.source_artifact_id
          ? `/api/projects/${context.projectId}/artifacts/${row.source_artifact_id}/download?exportId=${exportId}&type=${row.artifact_type}`
          : null,
    })),
  };
}

export async function createReportExport(input: {
  projectId: string;
  userId: string;
  approvedReportVersionId: unknown;
  validationRunId: unknown;
  artifactTypes: unknown;
  idempotencyKey: string | null;
}): Promise<IdempotentResult> {
  const key = requireIdempotencyKey(input.idempotencyKey);
  const versionId = requireUuidValue(
    input.approvedReportVersionId,
    "INVALID_REPORT_VERSION",
  );
  const validationRunId = requireUuidValue(
    input.validationRunId,
    "INVALID_VALIDATION_RUN",
  );
  if (
    !Array.isArray(input.artifactTypes) ||
    input.artifactTypes.length !== 2 ||
    !input.artifactTypes.includes("pdf") ||
    !input.artifactTypes.includes("xlsx")
  ) {
    throw new ApiError(
      400,
      "INVALID_EXPORT_TYPES",
      "PDF와 XLSX를 함께 내보내야 합니다.",
    );
  }
  const requestHash = contentHash({
    versionId,
    validationRunId,
    artifactTypes: ["pdf", "xlsx"],
  });
  return withTransaction(async (client) => {
    const context = await projectContext(
      client,
      input.projectId,
      input.userId,
    );
    await lockIdempotency(client, {
      userId: input.userId,
      operation: "report.export",
      projectId: input.projectId,
      key,
    });
    const replayed = await replay(client, {
      userId: input.userId,
      operation: "report.export",
      projectId: input.projectId,
      key,
      requestHash,
    });
    if (replayed) return replayed;
    const approval = await client.query<{ approval_id: string }>(
      `SELECT approval_id FROM report_approval
       WHERE project_id = $1 AND report_resource_version_id = $2
         AND validation_run_id = $3`,
      [input.projectId, versionId, validationRunId],
    );
    if (!approval.rows[0]) {
      throw new ApiError(
        409,
        "APPROVAL_VERSION_MISMATCH",
        "검증을 통과해 승인된 보고서만 내보낼 수 있습니다.",
      );
    }
    let exportResult = await client.query<{ export_id: string }>(
      `SELECT export_id FROM report_export WHERE report_approval_id = $1`,
      [approval.rows[0].approval_id],
    );
    if (!exportResult.rows[0]) {
      const exportId = uuidv7();
      await client.query(
        `INSERT INTO report_export (
           export_id, project_id, report_approval_id, operation_status,
           outcome, requested_by_user_id
         ) VALUES ($1, $2, $3, 'succeeded', 'complete', $4)`,
        [exportId, input.projectId, approval.rows[0].approval_id, input.userId],
      );
      await client.query(
        `INSERT INTO report_export_artifact (
           export_artifact_id, export_id, artifact_type,
           source_artifact_id, artifact_status
         ) VALUES
           ($1, $2, 'pdf', $3, 'ready'),
           ($4, $2, 'xlsx', $5, 'ready')`,
        [
          uuidv7(),
          exportId,
          context.sourcePdfArtifactId,
          uuidv7(),
          context.workbookArtifactId,
        ],
      );
      exportResult = { rows: [{ export_id: exportId }] } as typeof exportResult;
    }
    const body = await exportView(
      client,
      context,
      exportResult.rows[0].export_id,
    );
    await storeReplay(client, {
      userId: input.userId,
      operation: "report.export",
      projectId: input.projectId,
      key,
      requestHash,
      status: 202,
      body,
    });
    return { status: 202, body };
  });
}

export async function getReportExport(
  projectId: string,
  userId: string,
  exportId: string,
) {
  return withTransaction(async (client) => {
    const context = await projectContext(client, projectId, userId);
    return exportView(client, context, exportId);
  });
}

export async function retryReportExport(input: {
  projectId: string;
  userId: string;
  exportId: string;
  artifactTypes: unknown;
}) {
  if (
    !Array.isArray(input.artifactTypes) ||
    input.artifactTypes.some(
      (type) => type !== "pdf" && type !== "xlsx",
    )
  ) {
    throw new ApiError(
      400,
      "INVALID_EXPORT_TYPES",
      "재시도할 파일을 선택해주세요.",
    );
  }
  return withTransaction(async (client) => {
    const context = await projectContext(
      client,
      input.projectId,
      input.userId,
    );
    await client.query(
      `UPDATE report_export_artifact SET
         artifact_status = CASE
           WHEN source_artifact_id IS NOT NULL THEN 'ready'
           ELSE 'failed' END,
         attempt_no = attempt_no + 1,
         retryable = source_artifact_id IS NULL,
         error_code = CASE WHEN source_artifact_id IS NULL
           THEN 'ARTIFACT_SOURCE_MISSING' ELSE NULL END,
         error_message = CASE WHEN source_artifact_id IS NULL
           THEN '승인 산출물 원본을 찾을 수 없습니다.' ELSE NULL END,
         updated_at = now()
       WHERE export_id = $1 AND artifact_type = ANY($2::text[])
         AND artifact_status = 'failed'`,
      [input.exportId, input.artifactTypes],
    );
    await client.query(
      `UPDATE report_export export SET
         operation_status = CASE
           WHEN EXISTS (
             SELECT 1 FROM report_export_artifact file
             WHERE file.export_id = export.export_id
               AND file.artifact_status = 'failed'
           ) THEN 'failed' ELSE 'succeeded' END,
         outcome = CASE
           WHEN EXISTS (
             SELECT 1 FROM report_export_artifact file
             WHERE file.export_id = export.export_id
               AND file.artifact_status = 'failed'
           ) THEN 'partial' ELSE 'complete' END,
         updated_at = now()
       WHERE export.export_id = $1 AND export.project_id = $2`,
      [input.exportId, input.projectId],
    );
    return exportView(client, context, input.exportId);
  });
}

export async function cancelReportExport(input: {
  projectId: string;
  userId: string;
  exportId: string;
}) {
  return withTransaction(async (client) => {
    const context = await projectContext(
      client,
      input.projectId,
      input.userId,
    );
    await client.query(
      `UPDATE report_export_artifact SET artifact_status = 'cancelled',
         updated_at = now()
       WHERE export_id = $1
         AND artifact_status IN ('pending', 'generating', 'verifying', 'publishing')`,
      [input.exportId],
    );
    await client.query(
      `UPDATE report_export SET operation_status = 'cancelled',
         outcome = CASE
           WHEN EXISTS (
             SELECT 1 FROM report_export_artifact file
             WHERE file.export_id = report_export.export_id
               AND file.artifact_status = 'ready'
           ) THEN 'partial' ELSE 'pending' END,
         updated_at = now()
       WHERE export_id = $1 AND project_id = $2
         AND operation_status IN ('queued', 'running', 'cancel_requested')`,
      [input.exportId, input.projectId],
    );
    return exportView(client, context, input.exportId);
  });
}

async function authorizedArtifact(
  client: TransactionClient,
  input: {
    projectId: string;
    userId: string;
    artifactId: string;
    exportId?: string | null;
    type?: string | null;
  },
) {
  const context = await projectContext(client, input.projectId, input.userId);
  let allowed =
    input.artifactId === context.sourcePdfArtifactId ||
    input.artifactId === context.workbookArtifactId;
  if (!allowed) {
    const preview = await client.query(
      `SELECT 1 FROM report_preview
       WHERE project_id = $1 AND source_artifact_id = $2
         AND preview_status = 'ready'
       LIMIT 1`,
      [input.projectId, input.artifactId],
    );
    allowed = Boolean(preview.rows[0]);
  }
  if (!allowed) {
    throw new ApiError(404, "ARTIFACT_NOT_FOUND", "파일을 찾을 수 없습니다.");
  }
  let exportFilename: string | null = null;
  if (input.exportId) {
    const exportFile = await client.query<{
      artifact_type: "pdf" | "xlsx";
      version_no: string;
      approved_at: Date;
    }>(
      `SELECT file.artifact_type, version.version_no, approval.approved_at
       FROM report_export export
       JOIN report_export_artifact file ON file.export_id = export.export_id
       JOIN report_approval approval
         ON approval.approval_id = export.report_approval_id
       JOIN report_version version
         ON version.resource_version_id = approval.report_resource_version_id
       WHERE export.export_id = $1 AND export.project_id = $2
         AND file.source_artifact_id = $3 AND file.artifact_status = 'ready'
         AND ($4::text IS NULL OR file.artifact_type = $4)`,
      [input.exportId, input.projectId, input.artifactId, input.type ?? null],
    );
    if (!exportFile.rows[0]) {
      throw new ApiError(404, "ARTIFACT_NOT_FOUND", "내보낸 파일을 찾을 수 없습니다.");
    }
    const file = exportFile.rows[0];
    exportFilename = reportFilename({
      companyName: context.companyName,
      ticker: context.ticker,
      year: context.targetYear,
      quarter: context.targetQuarter,
      reportVersion: Number(file.version_no),
      approvedAt: file.approved_at,
      extension: file.artifact_type,
    });
  }
  const result = await client.query<{
    object_key: string;
    media_type: string;
    original_filename: string | null;
    byte_size: string;
  }>(
    `SELECT object_key, media_type, original_filename, byte_size
     FROM artifact WHERE artifact_id = $1 AND project_id = $2
       AND storage_status = 'accepted' AND deleted_at IS NULL`,
    [input.artifactId, input.projectId],
  );
  const row = result.rows[0];
  if (!row) throw new ApiError(404, "ARTIFACT_NOT_FOUND", "파일을 찾을 수 없습니다.");
  return { context, row, exportFilename };
}

export async function getReportArtifactBytes(input: {
  projectId: string;
  userId: string;
  artifactId: string;
  exportId?: string | null;
  type?: string | null;
}) {
  const authorized = await withTransaction((client) =>
    authorizedArtifact(client, input),
  );
  return {
    mediaType: authorized.row.media_type,
    filename:
      authorized.exportFilename ??
      authorized.row.original_filename ??
      "reflo-artifact",
    byteSize: Number(authorized.row.byte_size),
    bytes: await readObjectBytes(authorized.row.object_key),
  };
}

export const reportConstants = {
  editLeaseSeconds: 120,
  heartbeatSeconds: 30,
  validationRuleVersion: "report-validation-v1",
  outlineGeneratorVersion: "report-outline-structured-v2",
  reportGeneratorVersion: "report-draft-structured-v1",
  aiProposalVersion: "report-rewrite-structured-v1",
  requestId: randomUUID,
};
