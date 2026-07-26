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
  assertRequiredReportMaterializationsReady,
  attachTemplateGeometry,
  buildInitialOutline,
  buildReportDocument,
  compactReportMaterializations,
  generatedBandBindingsFromBridge,
  hydrateReportMaterializations,
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
  type ReportDisplayRule,
  type ReportChartType,
  type ReportBindingDefinition,
  type ReportChartSeriesBinding,
  type ReportMaterializationsBySlotId,
  type ReportMaterializationContext,
  type ReportMaterializedData,
  type ReportMappingBinding,
  type ReportRangeSource,
  type ReportTemplatePage,
  type ReportWorkbookReadModel,
} from "../../domain/report";
import {
  serializeReportMaterializationArtifact,
  type ReportMaterializationResourceRef,
  type ReportMaterializationSourceRefs,
} from "../../domain/report-materialization";
import {
  buildChartScene,
  buildScalarScene,
  buildTableScene,
  createRenderAsset,
  type ChartStyleTemplate,
} from "../../domain/report-renderer";
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
import {
  acquireProjectLineageLock,
  persistSourceSnapshot,
  type PersistedSourceSnapshot,
} from "../services/source-snapshot-service";

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
  setupResourceVersionId: string;
  sourcePdfResourceVersionId: string;
  sourceWorkbookResourceVersionId: string;
  workbookAnalysisResourceVersionId: string;
  templateResourceVersionId: string;
  templateVersion: number;
  templatePages: ReportTemplatePage[];
  templateStyles: Array<{
    resourceId: string;
    typedTemplate: Record<string, unknown>;
  }>;
  templateSourcePdfHash: string;
  mappingSetResourceVersionId: string;
  mappingVersion: number;
  mappingConfirmed: boolean;
  mappingBindings: ReportMappingBinding[];
  materializationsBySlotId: ReportMaterializationsBySlotId;
  materializationContext: Omit<
    ReportMaterializationContext,
    "sourceSnapshotId"
  >;
  validationApprovalId: string;
  validatedValueSetResourceVersionId: string;
  validatedWorkbookResourceVersionId: string;
  validationRunId: string;
  validationVersion: number;
  valuationApprovalId: string;
  valuationResourceVersionId: string;
  marketPriceResourceVersionId: string;
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
  qpdfPassed: boolean;
  warnings: PdfRenderWarning[];
};

type PdfRenderPlanResult = {
  pdfBase64: string;
  sha256: string;
  byteSize: number;
  mediaType: "application/pdf";
  renderPlanId: string;
  appliedCommandIds: string[];
  validation: {
    passed: boolean;
    profile: Record<string, unknown>;
    pages: unknown[];
  };
  qpdfPassed: boolean;
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
  materialization_run_id: string | null;
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
  const address = source?.range ?? source?.cell ?? source?.address;
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

function displayRule(value: unknown): ReportDisplayRule {
  const display = objectRecord(value);
  if (!display) return {};
  return {
    ...(typeof display.unit === "string" ? { unit: display.unit } : {}),
    ...(typeof (display.formatCode ?? display.pattern) === "string"
      ? { formatCode: String(display.formatCode ?? display.pattern) }
      : {}),
    ...(Number.isInteger(display.decimalPlaces)
      ? { decimalPlaces: Number(display.decimalPlaces) }
      : {}),
    ...(typeof display.scale === "string"
      ? { scale: display.scale }
      : {}),
    ...(typeof display.roundingIncrement === "string"
      ? { roundingIncrement: display.roundingIncrement }
      : {}),
    ...([
      "half_up",
      "half_even",
      "floor",
      "ceiling",
      "truncate",
    ].includes(String(display.roundingMode))
      ? {
          roundingMode: display.roundingMode as NonNullable<
            ReportDisplayRule["roundingMode"]
          >,
        }
      : {}),
    ...(typeof display.prefix === "string"
      ? { prefix: display.prefix }
      : {}),
    ...(typeof display.suffix === "string"
      ? { suffix: display.suffix }
      : {}),
    ...(display.negativeStyle === "minus" ||
    display.negativeStyle === "parentheses"
      ? { negativeStyle: display.negativeStyle }
      : {}),
    ...(typeof display.blankDisplay === "string"
      ? { blankDisplay: display.blankDisplay }
      : {}),
  };
}

function integerList(value: unknown): number[] {
  return Array.isArray(value)
    ? value
        .map(Number)
        .filter((item) => Number.isInteger(item) && item >= 1)
    : [];
}

function chartSeries(value: unknown): ReportChartSeriesBinding | null {
  const item = objectRecord(value);
  const source = rangeSource(item?.source);
  if (!source || typeof item?.seriesId !== "string") return null;
  const axis =
    item.axis === "primary" || item.axis === "secondary"
      ? item.axis
      : undefined;
  const roles = [
    "actual",
    "forecast",
    "target",
    "band_upper",
    "band_lower",
    "benchmark",
  ] as const;
  const estimates = [
    "actual",
    "forecast",
    "mixed",
    "not_applicable",
  ] as const;
  return {
    seriesId: item.seriesId,
    label: typeof item.label === "string" ? item.label : null,
    source,
    ...(axis ? { axis } : {}),
    ...(roles.includes(item.role as (typeof roles)[number])
      ? { role: item.role as (typeof roles)[number] }
      : {}),
    ...(typeof item.chartType === "string"
      ? { chartType: item.chartType }
      : {}),
    ...(estimates.includes(
      item.estimateType as (typeof estimates)[number],
    )
      ? {
          estimateType:
            item.estimateType as (typeof estimates)[number],
        }
      : {}),
    ...(typeof item.unit === "string" ? { unit: item.unit } : {}),
    ...(typeof item.numberFormat === "string"
      ? { numberFormat: item.numberFormat }
      : {}),
  };
}

export function parseReportBindingDefinition(
  value: unknown,
): ReportBindingDefinition | null {
  const binding = objectRecord(value);
  if (binding?.kind === "generated_range") {
    const generatedSource = objectRecord(binding.source);
    const source = rangeSource(binding.source);
    const semanticKey = objectRecord(binding.semanticKey);
    const semantic = `${semanticKey?.metric ?? ""} ${
      semanticKey?.scope ?? ""
    }`
      .toLowerCase()
      .replace(/[^a-z0-9가-힣]+/g, "");
    const bandFamily =
      semantic.includes("peband") ||
      semantic.includes("perband") ||
      semantic.includes("pe밴드") ||
      semantic.includes("per밴드") ||
      semantic.includes("figure2chart")
        ? "pe"
        : semantic.includes("pbband") ||
            semantic.includes("pbrband") ||
            semantic.includes("pb밴드") ||
            semantic.includes("pbr밴드") ||
            semantic.includes("figure3chart")
          ? "pb"
          : null;
    const generatorId = generatedSource?.generatorId;
    const sourceEvidenceIds = generatedSource?.sourceEvidenceIds;
    if (
      !source ||
      !bandFamily ||
      generatedSource?.authority !== "authoritative" ||
      source.sheetId !== "_REFLO_BRIDGE" ||
      source.sheetName !== "_REFLO_BRIDGE" ||
      typeof generatorId !== "string" ||
      !generatorId.trim() ||
      !Array.isArray(sourceEvidenceIds) ||
      sourceEvidenceIds.length === 0 ||
      sourceEvidenceIds.some(
        (evidenceId) =>
          typeof evidenceId !== "string" || !evidenceId.trim(),
      ) ||
      new Set(sourceEvidenceIds).size !== sourceEvidenceIds.length
    ) {
      return null;
    }
    return {
      kind: "generated_band_chart",
      source,
      bandFamily,
      generatorId,
      sourceEvidenceIds: sourceEvidenceIds as string[],
      styleTemplateRef:
        typeof binding.styleTemplateRef === "string"
          ? binding.styleTemplateRef
          : null,
    };
  }
  if (binding?.kind === "scalar") {
    const source = rangeSource(binding.source);
    const verificationSources = Array.isArray(binding.verificationSources)
      ? binding.verificationSources
          .map(rangeSource)
          .filter((item): item is ReportRangeSource => Boolean(item))
      : [];
    const valueTypes = [
      "decimal",
      "money",
      "percent",
      "integer",
      "date",
      "string",
      "boolean",
    ] as const;
    if (
      !source ||
      !valueTypes.includes(
        binding.valueType as (typeof valueTypes)[number],
      )
    ) {
      return null;
    }
    const semanticKey = objectRecord(binding.semanticKey);
    return {
      kind: "scalar",
      valueType: binding.valueType as (typeof valueTypes)[number],
      source,
      verificationSources,
      display: displayRule(binding.display),
      unit:
        typeof semanticKey?.unit === "string" ? semanticKey.unit : null,
      period:
        typeof semanticKey?.period === "string"
          ? semanticKey.period
          : null,
      styleTemplateRef:
        typeof binding.styleTemplateRef === "string"
          ? binding.styleTemplateRef
          : null,
    };
  }
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
      subtotalRows: integerList(binding.subtotalRows),
      unitRows: integerList(binding.unitRows),
      forecastRows: integerList(binding.forecastRows),
      styleTemplateRef:
        typeof binding.styleTemplateRef === "string"
          ? binding.styleTemplateRef
          : null,
    };
  }
  if (
    binding?.kind === "chart" ||
    binding?.kind === "composite_chart"
  ) {
    const categories = rangeSource(binding.categories);
    const rawSeries = Array.isArray(binding.series) ? binding.series : [];
    const series = rawSeries
      .map(chartSeries)
      .filter((item): item is ReportChartSeriesBinding => Boolean(item));
    if (!categories || series.length !== rawSeries.length || series.length === 0) {
      return null;
    }
    if (binding.kind === "composite_chart") {
      if (
        series.length < 2 ||
        typeof binding.styleTemplateRef !== "string"
      ) {
        return null;
      }
      return {
        kind: "composite_chart",
        categories,
        series,
        styleTemplateRef: binding.styleTemplateRef,
      };
    }
    return {
      kind: "chart",
      categories,
      series,
      styleTemplateRef:
        typeof binding.styleTemplateRef === "string"
          ? binding.styleTemplateRef
          : null,
    };
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
      const definition = parseReportBindingDefinition(value);
      return typeof slotId === "string" && definition
        ? [[slotId, definition] as const]
        : [];
    }),
  );
}

function canonicalReportMetric(metric: string): string {
  if (metric === "forward_eps") return "eps";
  if (metric === "target_per") return "per";
  return metric;
}

function templateSlotKind(
  slot: NonNullable<ReportTemplatePage["slots"]>[number],
): ReportMappingBinding["kind"] {
  return slot.valueType === "table"
    ? "table"
    : slot.valueType === "chart"
      ? "chart"
      : "scalar";
}

function styleReference(
  page: ReportTemplatePage,
  slot: NonNullable<ReportTemplatePage["slots"]>[number],
): string {
  const explicit =
    slot.styleRef ??
    page.blocks?.find((block) => block.blockId === slot.blockId)
      ?.styleTemplateRef;
  if (explicit?.trim()) return explicit.trim();
  return `template-block:${slot.blockId}`
    .replace(/[^A-Za-z0-9._:-]/g, "-")
    .slice(0, 128);
}

function templateMaterializationBindings(
  pages: ReportTemplatePage[],
  bindings: ReportMappingBinding[],
): ReportMappingBinding[] {
  const authoritativeMetrics = new Set([
    "eps",
    "per",
    "target_price",
    "current_price",
  ]);
  return [...pages]
    .sort((left, right) => left.pageNumber - right.pageNumber)
    .flatMap((page) =>
      (page.slots ?? []).map((slot) => {
        const kind = templateSlotKind(slot);
        const metric = slot.semanticKey?.metric ?? "";
        const canonicalMetric = canonicalReportMetric(metric);
        const candidates = bindings.filter(
          (binding) =>
            binding.kind === kind &&
            canonicalReportMetric(binding.metric) === canonicalMetric,
        );
        const authoritative =
          kind === "scalar" && authoritativeMetrics.has(canonicalMetric)
            ? candidates.find((binding) =>
                [
                  "valuation_approval",
                  "market_price_snapshot",
                ].includes(binding.sourceType ?? ""),
              )
            : undefined;
        const selected =
          authoritative ??
          bindings.find(
            (binding) =>
              binding.slotId === slot.slotId &&
              binding.status === "confirmed",
          ) ??
          candidates.find((binding) => binding.status === "confirmed") ??
          bindings.find((binding) => binding.slotId === slot.slotId) ??
          candidates[0];
        const styleTemplateRef = styleReference(page, slot);
        if (!selected) {
          return {
            slotId: slot.slotId,
            metric,
            kind,
            required: slot.required,
            status: "unmapped",
            sourceLabel: null,
            sourceAddress: null,
            sourceType: null,
            pageId: page.pageId,
            blockId: slot.blockId,
            styleTemplateRef,
            definition: null,
          };
        }
        return {
          ...selected,
          slotId: slot.slotId,
          metric,
          required: slot.required,
          pageId: page.pageId,
          blockId: slot.blockId,
          styleTemplateRef,
        };
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
    setup_resource_version_id: string;
    source_pdf_resource_version_id: string;
    source_workbook_resource_version_id: string;
    workbook_analysis_resource_version_id: string;
    template_resource_version_id: string;
    template_version: string;
    template_ir_json: {
      source?: { pdfHash?: string };
      pages?: ReportTemplatePage[];
      resources?: {
        styles?: Array<{
          resourceId: string;
          typedTemplate: Record<string, unknown>;
        }>;
      };
    };
    mapping_set_resource_version_id: string;
    mapping_version: string;
    mapping_status: string;
    unmapped_required_count: number;
    mapping_json: unknown;
    validation_approval_id: string;
    validated_value_set_resource_version_id: string;
    validated_workbook_resource_version_id: string;
    validation_run_id: string;
    validation_version: string;
    valuation_approval_id: string;
    valuation_resource_version_id: string;
    market_price_resource_version_id: string;
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
       setup.resource_version_id AS setup_resource_version_id,
       template.resource_version_id AS template_resource_version_id,
       template_rv.version_no AS template_version, template.template_ir_json,
       mapping.resource_version_id AS mapping_set_resource_version_id,
       mapping_rv.version_no AS mapping_version, mapping.mapping_status,
       mapping.unmapped_required_count, mapping.mapping_json,
       validation.approval_id AS validation_approval_id,
       validation.validation_run_id, validation.validation_version,
       validation.validated_value_set_resource_version_id,
       validation.validated_workbook_resource_version_id,
       valuation.approval_id AS valuation_approval_id,
       valuation.resource_version_id AS valuation_resource_version_id,
       valuation.current_price_snapshot_resource_version_id
         AS market_price_resource_version_id,
       valuation.source_workbook_resource_version_id,
       mapping.workbook_version_id AS workbook_analysis_resource_version_id,
       valuation.approval_version AS valuation_version,
       valuation.workbook_version, valuation.workbook_artifact_id,
       report_workbook.read_model_json AS approved_workbook_read_model,
       valuation.forward_eps, valuation.target_per, valuation.target_price,
       valuation.current_price, valuation.upside,
       hypothesis.resource_version_id AS hypothesis_resource_version_id,
       hypothesis.draft_version AS hypothesis_version,
       hypothesis.provisional_rating, hypothesis.thesis,
       pdf_file.artifact_id AS source_pdf_artifact_id,
       pdf_file.resource_version_id AS source_pdf_resource_version_id,
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
     JOIN valuation_workbook report_workbook
       ON report_workbook.project_id = p.project_id
      AND report_workbook.mapping_set_resource_version_id =
          mapping.resource_version_id
      AND report_workbook.validation_approval_id =
          validation.approval_id
      AND report_workbook.validated_value_set_resource_version_id =
          validation.validated_value_set_resource_version_id
      AND report_workbook.validated_workbook_resource_version_id =
          validation.validated_workbook_resource_version_id
      AND report_workbook.source_workbook_resource_version_id =
          valuation.source_workbook_resource_version_id
      AND report_workbook.workbook_version = valuation.workbook_version
      AND report_workbook.current_artifact_id = valuation.workbook_artifact_id
      AND report_workbook.structure_hash = valuation.structure_hash
      AND report_workbook.input_fingerprint = valuation.input_fingerprint
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
        definition?.kind === "scalar" ||
        definition?.kind === "table"
          ? definition.source
          : definition?.kind === "generated_band_chart"
            ? definition.source
          : definition?.kind === "chart" ||
              definition?.kind === "composite_chart"
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
      status: "confirmed",
      sourceLabel: `투자 가설 v${row.hypothesis_version}`,
      sourceAddress: "provisional_rating",
      sourceType: "hypothesis",
    },
  ];
  const templatePages = row.template_ir_json.pages ?? [];
  const approvedWorkbookReadModel =
    row.approved_workbook_read_model?.schemaVersion === "1.2" &&
    Array.isArray(row.approved_workbook_read_model.sheets)
      ? row.approved_workbook_read_model
      : null;
  const generatedBandBindings = generatedBandBindingsFromBridge(
    templatePages,
    approvedWorkbookReadModel,
    evidence.map((item) => item.evidenceId),
  );
  const allBindings: ReportMappingBinding[] = [
    ...mappedBindings,
    ...generatedBandBindings,
    ...authoritativeBindings,
  ];
  const mappingBindings = templateMaterializationBindings(
    templatePages,
    allBindings,
  );
  const materializationContext: Omit<
    ReportMaterializationContext,
    "sourceSnapshotId"
  > = {
    mappingSetResourceVersionId: row.mapping_set_resource_version_id,
    workbookArtifactId: row.workbook_artifact_id,
    workbookVersion: Number(row.workbook_version),
    validationApprovalVersionId: row.validation_approval_id,
    valuationApprovalVersionId: row.valuation_resource_version_id,
    authoritativeScalars: [
        {
          metric: "target_price",
          sourceType: "valuation_approval",
          sourceAddress: "target_price",
          rawValue: row.target_price,
          formattedValue: `${Number(row.target_price).toLocaleString(
            "ko-KR",
          )}원`,
          valueType: "money",
          unit: "KRW",
          period: null,
          authority: "user_decision",
          sourceDecision: `valuation approval v${row.valuation_version}`,
        },
        {
          metric: "per",
          sourceType: "valuation_approval",
          sourceAddress: "target_per",
          rawValue: row.target_per,
          formattedValue: `${row.target_per}배`,
          valueType: "decimal",
          unit: "multiple",
          period: "12MF",
          authority: "user_decision",
          sourceDecision: `valuation approval v${row.valuation_version}`,
        },
        {
          metric: "eps",
          sourceType: "valuation_approval",
          sourceAddress: "forward_eps",
          rawValue: row.forward_eps,
          formattedValue: `${Number(row.forward_eps).toLocaleString(
            "ko-KR",
          )}원`,
          valueType: "money",
          unit: "KRW/share",
          period: "12MF",
          authority: "formula",
          sourceDecision: `valuation workbook v${row.workbook_version}`,
        },
        {
          metric: "current_price",
          sourceType: "market_price_snapshot",
          sourceAddress: "current_price",
          rawValue: row.current_price,
          formattedValue: `${Number(row.current_price).toLocaleString(
            "ko-KR",
          )}원`,
          valueType: "money",
          unit: "KRW",
          period: row.cutoff_date,
          authority: "user_decision",
          sourceDecision: `${row.cutoff_date} KRX cutoff snapshot`,
        },
        {
          metric: "investment_opinion",
          sourceType: "hypothesis",
          sourceAddress: "provisional_rating",
          rawValue: row.provisional_rating,
          formattedValue: row.provisional_rating,
          valueType: "string",
          unit: null,
          period: null,
          authority: "user_decision",
          sourceDecision: `hypothesis v${row.hypothesis_version}`,
        },
    ],
    readModel: approvedWorkbookReadModel,
  };
  const materializationsBySlotId = materializeReportBindings(
    mappingBindings,
    materializationContext,
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
    setupResourceVersionId: row.setup_resource_version_id,
    sourcePdfResourceVersionId: row.source_pdf_resource_version_id,
    sourceWorkbookResourceVersionId:
      row.source_workbook_resource_version_id,
    workbookAnalysisResourceVersionId:
      row.workbook_analysis_resource_version_id,
    templatePages,
    templateStyles: row.template_ir_json.resources?.styles ?? [],
    templateSourcePdfHash: row.template_ir_json.source?.pdfHash ?? "",
    mappingSetResourceVersionId: row.mapping_set_resource_version_id,
    mappingVersion: Number(row.mapping_version),
    mappingConfirmed:
      row.mapping_status === "confirmed" && row.unmapped_required_count === 0,
    mappingBindings,
    materializationsBySlotId,
    materializationContext,
    validationApprovalId: row.validation_approval_id,
    validatedValueSetResourceVersionId:
      row.validated_value_set_resource_version_id,
    validatedWorkbookResourceVersionId:
      row.validated_workbook_resource_version_id,
    validationRunId: row.validation_run_id,
    validationVersion: Number(row.validation_version),
    valuationApprovalId: row.valuation_approval_id,
    valuationResourceVersionId: row.valuation_resource_version_id,
    marketPriceResourceVersionId: row.market_price_resource_version_id,
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
    const report = await client.query<{
      report_id: string;
      materialization_run_id: string | null;
    }>(
      `SELECT report.report_id, version.materialization_run_id
       FROM report
       LEFT JOIN report_version version
         ON version.resource_version_id =
            report.active_resource_version_id
       WHERE report.project_id = $1`,
      [projectId],
    );
    const materialization = await client.query<{
      materialization_run_id: string;
      operation_status: string;
      source_snapshot_id: string;
      input_fingerprint: string;
      report_resource_version_id: string | null;
    }>(
      `SELECT materialization_run_id, operation_status,
         source_snapshot_id, input_fingerprint,
         report_resource_version_id
       FROM report_materialization_run
       WHERE project_id = $1
         AND validity_status = 'current'
       ORDER BY requested_at DESC
       LIMIT 1`,
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
      draftTask: materialization.rows[0]
        ? reportMaterializationTaskBody(projectId, {
            materializationRunId:
              materialization.rows[0].materialization_run_id,
            jobId: "",
            operationStatus: materialization.rows[0].operation_status,
            sourceSnapshotId:
              materialization.rows[0].source_snapshot_id,
            sourceFingerprint:
              materialization.rows[0].input_fingerprint,
            reportResourceVersionId:
              materialization.rows[0].report_resource_version_id,
          })
        : report.rows[0]
          ? {
              taskId: report.rows[0].report_id,
              operationStatus: "succeeded",
              reportRoute: `/projects/${projectId}/report`,
              statusUrl: null,
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
       report.outline_approval_id, version.materialization_run_id
     FROM report
     JOIN report_version version
       ON version.resource_version_id = report.active_resource_version_id
     WHERE report.project_id = $1
     ${forUpdate ? "FOR UPDATE OF report" : ""}`,
    [projectId],
  );
  const row = result.rows[0] ?? null;
  if (!row?.materialization_run_id) return row;
  const snapshots = await client.query<{
    materialization_snapshot_id: string;
    snapshot_json: ReportMaterializedData;
  }>(
    `SELECT materialization_snapshot_id, snapshot_json
     FROM report_materialization_block
     WHERE materialization_run_id = $1`,
    [row.materialization_run_id],
  );
  try {
    row.content_json = hydrateReportMaterializations(
      row.content_json,
      Object.fromEntries(
        snapshots.rows.map((snapshot) => [
          snapshot.materialization_snapshot_id,
          snapshot.snapshot_json,
        ]),
      ),
    );
  } catch {
    throw new ApiError(
      409,
      "REPORT_MATERIALIZATION_CORRUPT",
      "보고서 데이터 스냅샷을 불러올 수 없습니다.",
    );
  }
  return row;
}

function compactKnownReportMaterializations(
  document: ReportDocument,
): ReportDocument {
  const compact = structuredClone(document);
  for (const page of compact.pages) {
    for (const block of page.blocks) {
      if (!block.materializationSnapshotId) continue;
      delete block.materializedData;
    }
  }
  return compact;
}

function requiredMaterializationSlotIds(context: Context): string[] {
  return context.templatePages.flatMap((page) =>
    (page.slots ?? []).flatMap((slot) => {
      if (!slot.required) return [];
      const kind =
        slot.valueType === "table"
          ? "table"
          : slot.valueType === "chart"
            ? "chart"
            : "scalar";
      const metric = slot.semanticKey?.metric ?? "";
      const binding = context.mappingBindings.find(
        (item) =>
          item.slotId === slot.slotId ||
          (item.metric === metric && item.kind === kind),
      );
      return [binding?.slotId ?? slot.slotId];
    }),
  );
}

const REPORT_MATERIALIZER_VERSION = "report-materializer-v1";

function contextMaterializations(
  context: Context,
  sourceSnapshotId: string,
): ReportMaterializationsBySlotId {
  return materializeReportBindings(context.mappingBindings, {
    ...context.materializationContext,
    sourceSnapshotId,
  });
}

function reportSnapshotComponents(
  context: Context,
  outlineResourceVersionId: string,
) {
  return [
    {
      key: "setup",
      versionId: context.setupResourceVersionId,
      contentHash: null,
    },
    {
      key: "source_pdf",
      versionId: context.sourcePdfResourceVersionId,
      artifactId: context.sourcePdfArtifactId,
      contentHash: context.sourcePdfSha256,
    },
    {
      key: "source_workbook",
      versionId: context.sourceWorkbookResourceVersionId,
      contentHash: null,
    },
    {
      key: "template_ir",
      versionId: context.templateResourceVersionId,
      contentHash: null,
    },
    {
      key: "workbook_analysis",
      versionId: context.workbookAnalysisResourceVersionId,
      contentHash: null,
    },
    {
      key: "mapping_set",
      versionId: context.mappingSetResourceVersionId,
      contentHash: null,
    },
    {
      key: "validated_value_set",
      versionId: context.validatedValueSetResourceVersionId,
      contentHash: null,
    },
    {
      key: "validated_workbook",
      versionId: context.validatedWorkbookResourceVersionId,
      artifactId: context.workbookArtifactId,
      contentHash:
        context.materializationContext.readModel?.workbookHash ?? null,
    },
    {
      key: "market_price",
      versionId: context.marketPriceResourceVersionId,
      contentHash: null,
    },
    {
      key: "valuation_approval",
      versionId: context.valuationResourceVersionId,
      contentHash: null,
    },
    {
      key: "hypothesis",
      versionId: context.hypothesisResourceVersionId,
      contentHash: null,
    },
    {
      key: "report_outline",
      versionId: outlineResourceVersionId,
      contentHash: null,
    },
    {
      key: "style_template",
      versionId: context.templateResourceVersionId,
      contentHash: null,
    },
  ] as const;
}

async function persistReportSourceSnapshot(
  client: TransactionClient,
  context: Context,
  outlineResourceVersionId: string,
): Promise<PersistedSourceSnapshot> {
  return persistSourceSnapshot(client, {
    projectId: context.projectId,
    scope: "report_materialization",
    schemaVersion: "1",
    components: reportSnapshotComponents(
      context,
      outlineResourceVersionId,
    ),
  });
}

function assertMaterializationGate(
  context: Context,
  materializations: ReportMaterializationsBySlotId,
): void {
  try {
    assertRequiredReportMaterializationsReady(
      requiredMaterializationSlotIds(context),
      materializations,
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "REPORT_MATERIALIZATION_BLOCKED";
    throw new ApiError(
      422,
      "REPORT_MATERIALIZATION_BLOCKED",
      "필수 보고서 데이터 블록을 확정할 수 없습니다.",
      {
        details: message
          .replace(/^REPORT_MATERIALIZATION_BLOCKED:/, "")
          .split(",")
          .filter(Boolean)
          .map((blocker) => {
            const [path, code = "MATERIALIZATION_BLOCKED"] =
              blocker.split(":");
            return { path, code, message: code };
          }),
      },
    );
  }
}

type ReportMaterializationTask = {
  materializationRunId: string;
  jobId: string;
  operationStatus: string;
  sourceSnapshotId: string;
  sourceFingerprint: string;
  reportResourceVersionId: string | null;
};

export function reportMaterializationRetryDecision(
  operationStatus: string,
  attempt: number,
): { reuse: boolean; nextAttempt: number } {
  const normalizedAttempt =
    Number.isInteger(attempt) && attempt > 0 ? attempt : 1;
  return [
    "queued",
    "running",
    "cancel_requested",
    "succeeded",
  ].includes(operationStatus)
    ? { reuse: true, nextAttempt: normalizedAttempt }
    : { reuse: false, nextAttempt: normalizedAttempt + 1 };
}

function reportMaterializationTaskBody(
  projectId: string,
  task: ReportMaterializationTask,
) {
  return {
    taskId: task.materializationRunId,
    operationStatus: task.operationStatus,
    statusUrl:
      `/api/projects/${projectId}/report-materializations/` +
      task.materializationRunId,
    reportRoute: `/projects/${projectId}/report`,
    sourceSnapshotId: task.sourceSnapshotId,
    sourceFingerprint: task.sourceFingerprint,
    reportVersionId: task.reportResourceVersionId,
  };
}

function reportMaterializationWorkerError(
  code: string,
  summary: string | null,
  retryable: boolean,
  phase: string | null,
) {
  const cancelled = code === "REPORT_MATERIALIZATION_CANCELLED";
  const precondition = [
    "REPORT_MATERIALIZATION_BLOCKED",
    "OUTLINE_REVALIDATION_REQUIRED",
    "INPUT_VERSION_MISMATCH",
  ].includes(code);
  const workerCode = cancelled
    ? "CANCELLED"
    : precondition
      ? "PUBLISH_PRECONDITION_FAILED"
      : code === "AGENT_TIMEOUT" || code === "TIMEOUT"
        ? "TIMEOUT"
        : "INTERNAL_ERROR";
  return {
    schemaVersion: "1.0.0",
    code: workerCode,
    category: cancelled
      ? "cancellation"
      : precondition
        ? "validation"
        : workerCode === "TIMEOUT"
          ? "provider"
          : "internal",
    retryable,
    summary:
      summary ?? "보고서 초안을 생성하지 못했습니다. 다시 시도해주세요.",
    ...(phase ? { phase } : {}),
    details: { sourceCode: code },
  };
}

async function enqueueReportMaterialization(
  client: TransactionClient,
  input: {
    context: Context;
    outline: OutlineRow;
    outlineApprovalId: string;
    userId: string;
  },
): Promise<ReportMaterializationTask> {
  const sourceSnapshot = await persistReportSourceSnapshot(
    client,
    input.context,
    input.outline.current_resource_version_id,
  );
  const materializations = contextMaterializations(
    input.context,
    sourceSnapshot.sourceSnapshotId,
  );
  assertMaterializationGate(input.context, materializations);

  const existing = await client.query<{
    materialization_run_id: string;
    job_id: string;
    operation_status: string;
    source_snapshot_id: string;
    input_fingerprint: string;
    report_resource_version_id: string | null;
    attempt: number;
  }>(
    `SELECT materialization_run_id, job_id, operation_status,
       source_snapshot_id, input_fingerprint, report_resource_version_id,
       attempt
     FROM report_materialization_run
     WHERE project_id = $1
       AND report_outline_approval_id = $2
       AND source_snapshot_id = $3
       AND input_fingerprint = $4
       AND validity_status = 'current'
     ORDER BY requested_at DESC
     LIMIT 1`,
    [
      input.context.projectId,
      input.outlineApprovalId,
      sourceSnapshot.sourceSnapshotId,
      sourceSnapshot.fingerprint,
    ],
  );
  const prior = existing.rows[0];
  const retryDecision = reportMaterializationRetryDecision(
    prior?.operation_status ?? "missing",
    prior?.attempt ?? 0,
  );
  if (prior?.job_id && retryDecision.reuse) {
    const row = prior;
    return {
      materializationRunId: row.materialization_run_id,
      jobId: row.job_id,
      operationStatus: row.operation_status,
      sourceSnapshotId: row.source_snapshot_id,
      sourceFingerprint: row.input_fingerprint,
      reportResourceVersionId: row.report_resource_version_id,
    };
  }
  if (prior) {
    await client.query(
      `UPDATE report_materialization_run
       SET validity_status = 'obsolete'
       WHERE materialization_run_id = $1
         AND validity_status = 'current'`,
      [prior.materialization_run_id],
    );
    if (prior.job_id) {
      await client.query(
        `UPDATE workflow_job
         SET validity_status = 'obsolete'
         WHERE job_id = $1 AND validity_status = 'current'`,
        [prior.job_id],
      );
    }
  }

  const materializationRunId = uuidv7();
  const jobId = uuidv7();
  const attempt = prior ? retryDecision.nextAttempt : 1;
  const workflowPayload = {
    workflowType: "reportMaterializationWorkflow" as const,
    jobId,
    jobAttempt: attempt,
    projectId: input.context.projectId,
    materializationRunId,
    sourceSnapshotId: sourceSnapshot.sourceSnapshotId,
    sourceFingerprint: sourceSnapshot.fingerprint,
    outlineApprovalId: input.outlineApprovalId,
    requestedByUserId: input.userId,
  };
  await client.query(
    `INSERT INTO workflow_job (
       job_id, project_id, job_type, temporal_workflow_id,
       operation_status, validity_status, current_phase,
       progress_percent, progress_mode, progress_sequence, attempt,
       input_fingerprint, source_snapshot_id, requested_by_user_id
     ) VALUES ($1, $2, 'report_materialization', $3, 'queued', 'current',
       'preparing', 0, 'determinate', 0, $4, $5, $6, $7)`,
    [
      jobId,
      input.context.projectId,
      `reflo:${jobId}`,
      attempt,
      sourceSnapshot.fingerprint,
      sourceSnapshot.sourceSnapshotId,
      input.userId,
    ],
  );
  const workflowInputs = [
    ["setup", input.context.setupResourceVersionId],
    ["source_pdf", input.context.sourcePdfResourceVersionId],
    ["source_workbook", input.context.sourceWorkbookResourceVersionId],
    ["template_ir", input.context.templateResourceVersionId],
    [
      "workbook_analysis",
      input.context.workbookAnalysisResourceVersionId,
    ],
    ["mapping_set", input.context.mappingSetResourceVersionId],
    [
      "validated_value_set",
      input.context.validatedValueSetResourceVersionId,
    ],
    [
      "validated_workbook",
      input.context.validatedWorkbookResourceVersionId,
    ],
    ["market_price", input.context.marketPriceResourceVersionId],
    ["valuation_approval", input.context.valuationResourceVersionId],
    ["hypothesis", input.context.hypothesisResourceVersionId],
    ["report_outline", input.outline.current_resource_version_id],
  ] as const;
  for (const [role, versionId] of workflowInputs) {
    await client.query(
      `INSERT INTO workflow_job_input (
         job_id, input_role, resource_version_id
       ) VALUES ($1, $2, $3)`,
      [jobId, role, versionId],
    );
  }
  await client.query(
    `INSERT INTO report_materialization_run (
       materialization_run_id, project_id, source_snapshot_id,
       report_outline_approval_id, operation_status, validity_status,
       input_fingerprint, materializer_version, idempotency_key,
       attempt, job_id, materialization_version, required_block_count,
       ready_block_count
     ) VALUES ($1, $2, $3, $4, 'queued', 'current', $5, $6, $7,
       $8, $9, 1, $10, 0)`,
    [
      materializationRunId,
      input.context.projectId,
      sourceSnapshot.sourceSnapshotId,
      input.outlineApprovalId,
      sourceSnapshot.fingerprint,
      REPORT_MATERIALIZER_VERSION,
      `materialization:${input.outlineApprovalId}:` +
        sourceSnapshot.fingerprint.slice(0, 16) +
        `:attempt:${attempt}`,
      attempt,
      jobId,
      requiredMaterializationSlotIds(input.context).length,
    ],
  );
  await client.query(
    `INSERT INTO outbox_event (
       outbox_event_id, job_id, command_type, command_id, payload_json
     ) VALUES ($1, $2, 'start_workflow', $3, $4::jsonb)`,
    [uuidv7(), jobId, uuidv7(), JSON.stringify(workflowPayload)],
  );
  return {
    materializationRunId,
    jobId,
    operationStatus: "queued",
    sourceSnapshotId: sourceSnapshot.sourceSnapshotId,
    sourceFingerprint: sourceSnapshot.fingerprint,
    reportResourceVersionId: null,
  };
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
    const task = await enqueueReportMaterialization(client, {
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
      draftTask: reportMaterializationTaskBody(input.projectId, task),
    };
    await storeReplay(client, {
      userId: input.userId,
      operation: "report-outline.approve",
      projectId: input.projectId,
      key,
      requestHash,
      status: 202,
      body,
    });
    return { status: 202, body };
  });
}

type ResourceVersionMetadata = {
  resourceVersionId: string;
  version: number;
  contentHash: string;
};

async function loadResourceVersionMetadata(
  client: TransactionClient,
  versionIds: readonly string[],
): Promise<Map<string, ResourceVersionMetadata>> {
  const uniqueIds = [...new Set(versionIds)];
  const result = await client.query<{
    resource_version_id: string;
    version_no: string;
    content_hash: string;
  }>(
    `SELECT resource_version_id, version_no, content_hash
     FROM resource_version
     WHERE resource_version_id = ANY($1::uuid[])`,
    [uniqueIds],
  );
  if (result.rows.length !== uniqueIds.length) {
    throw new Error("REPORT_SOURCE_VERSION_MISSING");
  }
  return new Map(
    result.rows.map((row) => [
      row.resource_version_id,
      {
        resourceVersionId: row.resource_version_id,
        version: Number(row.version_no),
        contentHash: row.content_hash,
      },
    ]),
  );
}

function resourceRef(
  role: string,
  versionId: string,
  metadata: Map<string, ResourceVersionMetadata>,
): ReportMaterializationResourceRef {
  const value = metadata.get(versionId);
  if (!value) throw new Error(`REPORT_SOURCE_VERSION_MISSING:${role}`);
  return { role, ...value };
}

type PlannedReportVersion = {
  reportId: string;
  resourceId: string;
  resourceVersionId: string;
  version: number;
  parentResourceVersionId: string | null;
  existing: boolean;
};

type PreparedReportMaterialization = {
  projectId: string;
  userId: string;
  jobId: string;
  attempt: number;
  materializationRunId: string;
  materializationVersion: number;
  sourceSnapshot: PersistedSourceSnapshot;
  context: Context;
  outline: OutlineRow;
  outlineApprovalId: string;
  materializations: ReportMaterializationsBySlotId;
  sourceMetadata: Map<string, ResourceVersionMetadata>;
  report: PlannedReportVersion;
};

async function markReportMaterializationObsolete(
  client: TransactionClient,
  input: {
    materializationRunId: string;
    jobId: string;
    code: string;
    summary: string;
  },
): Promise<void> {
  await client.query(
    `UPDATE report_materialization_run
     SET operation_status = 'succeeded', validity_status = 'obsolete',
         error_code = $3, error_summary = $4, finished_at = now()
     WHERE materialization_run_id = $1 AND job_id = $2
       AND operation_status IN ('queued', 'running')`,
    [
      input.materializationRunId,
      input.jobId,
      input.code,
      input.summary.slice(0, 1000),
    ],
  );
  await client.query(
    `UPDATE workflow_job
     SET operation_status = 'succeeded', validity_status = 'obsolete',
         current_phase = 'obsolete', progress_percent = 100,
         retryable = false, error_code = $2, error_summary = $3,
         finished_at = now(), heartbeat_at = now()
     WHERE job_id = $1`,
    [
      input.jobId,
      input.code,
      input.summary.slice(0, 1000),
    ],
  );
}

async function prepareReportMaterialization(input: {
  materializationRunId: string;
  jobId: string;
  attempt: number;
  projectId: string;
  sourceSnapshotId: string;
  sourceFingerprint: string;
  outlineApprovalId: string;
  requestedByUserId: string;
}): Promise<PreparedReportMaterialization | null> {
  return withTransaction(async (client) => {
    await acquireProjectLineageLock(client, input.projectId);
    const run = await client.query<{
      materialization_run_id: string;
      job_id: string;
      operation_status: string;
      validity_status: string;
      attempt: number;
      materialization_version: string;
      source_snapshot_id: string;
      input_fingerprint: string;
      report_outline_approval_id: string;
      outline_resource_version_id: string;
      outline_id: string;
      resource_id: string;
      outline_version: string;
      outline_status: OutlineRow["status"];
      saved_at: Date;
      content_json: OutlineContent;
      template_resource_version_id: string;
      mapping_set_resource_version_id: string;
      validation_approval_id: string;
      valuation_approval_id: string;
      hypothesis_resource_version_id: string;
    }>(
      `SELECT run.materialization_run_id, run.job_id,
         run.operation_status, run.validity_status, run.attempt,
         run.materialization_version, run.source_snapshot_id,
         run.input_fingerprint, run.report_outline_approval_id,
         approval.outline_resource_version_id, outline.outline_id,
         outline.resource_id, version.version_no AS outline_version,
         outline.status AS outline_status, outline.saved_at,
         version.content_json, version.template_resource_version_id,
         version.mapping_set_resource_version_id,
         version.validation_approval_id, version.valuation_approval_id,
         version.hypothesis_resource_version_id
       FROM report_materialization_run run
       JOIN workflow_job job
         ON job.job_id = run.job_id
        AND job.project_id = run.project_id
       JOIN report_outline_approval approval
         ON approval.approval_id = run.report_outline_approval_id
       JOIN report_outline_version version
         ON version.resource_version_id =
            approval.outline_resource_version_id
       JOIN report_outline outline ON outline.outline_id = version.outline_id
       WHERE run.materialization_run_id = $1
         AND run.job_id = $2
         AND run.project_id = $3
       FOR UPDATE OF run, job`,
      [input.materializationRunId, input.jobId, input.projectId],
    );
    const row = run.rows[0];
    if (!row) throw new Error("REPORT_MATERIALIZATION_TASK_NOT_FOUND");
    if (
      row.operation_status === "succeeded" ||
      row.validity_status === "obsolete"
    ) {
      return null;
    }
    if (
      row.attempt !== input.attempt ||
      row.source_snapshot_id !== input.sourceSnapshotId ||
      row.input_fingerprint !== input.sourceFingerprint ||
      row.report_outline_approval_id !== input.outlineApprovalId
    ) {
      throw new Error("REPORT_MATERIALIZATION_INPUT_MISMATCH");
    }

    const context = await projectContext(
      client,
      input.projectId,
      input.requestedByUserId,
    );
    const currentOutline = await readOutline(
      client,
      input.projectId,
      true,
    );
    if (!currentOutline) {
      await markReportMaterializationObsolete(client, {
        materializationRunId: input.materializationRunId,
        jobId: input.jobId,
        code: "REPORT_OUTLINE_CHANGED",
        summary: "보고서 구성 입력이 변경되었습니다.",
      });
      return null;
    }
    const currentSnapshot = await persistReportSourceSnapshot(
      client,
      context,
      currentOutline.current_resource_version_id,
    );
    if (
      currentSnapshot.fingerprint !== input.sourceFingerprint ||
      currentSnapshot.sourceSnapshotId !== input.sourceSnapshotId
    ) {
      await markReportMaterializationObsolete(client, {
        materializationRunId: input.materializationRunId,
        jobId: input.jobId,
        code: "SOURCE_FINGERPRINT_MISMATCH",
        summary: "보고서 생성 중 입력 버전이 변경되었습니다.",
      });
      return null;
    }

    const materializations = contextMaterializations(
      context,
      input.sourceSnapshotId,
    );
    assertMaterializationGate(context, materializations);
    const existingReport = await client.query<{
      report_id: string;
      resource_id: string;
      active_resource_version_id: string | null;
      current_version: string;
    }>(
      `SELECT report_id, resource_id, active_resource_version_id,
         current_version
       FROM report
       WHERE project_id = $1
       FOR UPDATE`,
      [input.projectId],
    );
    const report = existingReport.rows[0];
    const plannedReport: PlannedReportVersion = report
      ? {
          reportId: report.report_id,
          resourceId: report.resource_id,
          resourceVersionId: uuidv7(),
          version: Number(report.current_version) + 1,
          parentResourceVersionId: report.active_resource_version_id,
          existing: true,
        }
      : {
          reportId: uuidv7(),
          resourceId: uuidv7(),
          resourceVersionId: uuidv7(),
          version: 1,
          parentResourceVersionId: null,
          existing: false,
        };
    const sourceMetadata = await loadResourceVersionMetadata(
      client,
      currentSnapshot.components.flatMap((component) =>
        component.versionId ? [component.versionId] : [],
      ),
    );
    await client.query(
      `UPDATE report_materialization_run
       SET operation_status = 'running',
           started_at = COALESCE(started_at, now()),
           error_code = NULL, error_summary = NULL
       WHERE materialization_run_id = $1`,
      [input.materializationRunId],
    );
    await client.query(
      `UPDATE workflow_job
       SET operation_status = 'running', current_phase = 'generating',
           progress_percent = 20, started_at = COALESCE(started_at, now()),
           heartbeat_at = now(), error_code = NULL, error_summary = NULL
       WHERE job_id = $1`,
      [input.jobId],
    );
    const outline: OutlineRow = {
      outline_id: row.outline_id,
      resource_id: row.resource_id,
      current_resource_version_id: row.outline_resource_version_id,
      current_version: row.outline_version,
      status: row.outline_status,
      saved_at: row.saved_at,
      content_json: normalizeOutlineContent(row.content_json),
      template_resource_version_id: row.template_resource_version_id,
      mapping_set_resource_version_id:
        row.mapping_set_resource_version_id,
      validation_approval_id: row.validation_approval_id,
      valuation_approval_id: row.valuation_approval_id,
      hypothesis_resource_version_id:
        row.hypothesis_resource_version_id,
    };
    return {
      projectId: input.projectId,
      userId: input.requestedByUserId,
      jobId: input.jobId,
      attempt: input.attempt,
      materializationRunId: input.materializationRunId,
      materializationVersion: Number(row.materialization_version),
      sourceSnapshot: currentSnapshot,
      context,
      outline,
      outlineApprovalId: input.outlineApprovalId,
      materializations,
      sourceMetadata,
      report: plannedReport,
    };
  });
}

function materializationSourceRefs(
  prepared: PreparedReportMaterialization,
  reportContentHash: string,
  createdAt: string,
): ReportMaterializationSourceRefs {
  const context = prepared.context;
  const metadata = prepared.sourceMetadata;
  return {
    snapshotId: prepared.sourceSnapshot.sourceSnapshotId,
    sourceFingerprint: prepared.sourceSnapshot.fingerprint,
    setup: resourceRef("setup", context.setupResourceVersionId, metadata),
    pdf: resourceRef(
      "source_pdf",
      context.sourcePdfResourceVersionId,
      metadata,
    ),
    xlsx: resourceRef(
      "source_workbook",
      context.sourceWorkbookResourceVersionId,
      metadata,
    ),
    templateIr: resourceRef(
      "template_ir",
      context.templateResourceVersionId,
      metadata,
    ),
    workbookAnalysis: resourceRef(
      "workbook_analysis",
      context.workbookAnalysisResourceVersionId,
      metadata,
    ),
    mappingSet: resourceRef(
      "mapping_set",
      context.mappingSetResourceVersionId,
      metadata,
    ),
    validationApproval: resourceRef(
      "validation_approval",
      context.validatedValueSetResourceVersionId,
      metadata,
    ),
    validatedWorkbook: resourceRef(
      "validated_workbook",
      context.validatedWorkbookResourceVersionId,
      metadata,
    ),
    valuationApproval: resourceRef(
      "valuation_approval",
      context.valuationResourceVersionId,
      metadata,
    ),
    outlineApproval: resourceRef(
      "outline_approval",
      prepared.outline.current_resource_version_id,
      metadata,
    ),
    styleTemplate: resourceRef(
      "style_template",
      context.templateResourceVersionId,
      metadata,
    ),
    report: {
      role: "report",
      resourceVersionId: prepared.report.resourceVersionId,
      version: prepared.report.version,
      contentHash: reportContentHash,
    },
    capturedAt: createdAt,
  };
}

type BuiltReportMaterialization = {
  prepared: PreparedReportMaterialization;
  document: ReportDocument;
  compactDocument: ReportDocument;
  snapshotIdsBySlotId: Record<string, string>;
  artifact: ReturnType<typeof serializeReportMaterializationArtifact>;
  artifactBytes: Buffer;
  objectKey: string;
  objectVersion: string;
};

async function buildReportMaterialization(
  prepared: PreparedReportMaterialization,
  signal?: AbortSignal,
): Promise<BuiltReportMaterialization> {
  const normalizedOutline = normalizeOutlineContent(
    prepared.outline.content_json,
  );
  const draftTextByBlockId = await suggestReportDraft({
    outline: normalizedOutline,
    companyName: prepared.context.companyName,
    ticker: prepared.context.ticker,
    targetYear: prepared.context.targetYear,
    targetQuarter: prepared.context.targetQuarter,
    rating: prepared.context.rating,
    thesis: prepared.context.thesis,
    targetPer: prepared.context.targetPer,
    targetPrice: prepared.context.targetPrice,
    currentPrice: prepared.context.currentPrice,
    signal,
    evidence: prepared.context.evidence.map((item) => ({
      evidenceId: item.evidenceId,
      title: item.title,
      oneLineValue: item.oneLineValue,
      quoteExact: item.quoteExact,
      stance: item.stance,
      machineStatus: item.machineStatus,
    })),
  });
  const baseDocument = buildReportDocument({
    outline: normalizedOutline,
    rating: prepared.context.rating,
    targetPer: prepared.context.targetPer,
    targetPrice: prepared.context.targetPrice,
    currentPrice: prepared.context.currentPrice,
    forwardEps: prepared.context.forwardEps,
    draftTextByBlockId,
    materializationsBySlotId: prepared.materializations,
  });
  const document = attachTemplateGeometry(
    baseDocument,
    prepared.context.templatePages,
    prepared.context.mappingBindings,
    prepared.materializations,
  );
  const issues = validateReportDocument({
    document,
    templatePageIds: [...prepared.context.templatePages]
      .sort((left, right) => left.pageNumber - right.pageNumber)
      .map((page) => page.pageId),
    evidenceIds: new Set(
      prepared.context.evidence.map((item) => item.evidenceId),
    ),
    valuationText: {
      targetPer: prepared.context.targetPer,
      targetPrice: prepared.context.targetPrice,
      forwardEps: prepared.context.forwardEps,
    },
  }).filter((issue) => issue.severity === "blocking");
  if (issues.length > 0) {
    throw new Error(
      `REPORT_DOCUMENT_INVALID:${issues
        .map((issue) => issue.code)
        .join(",")}`,
    );
  }
  const snapshotIdsBySlotId = Object.fromEntries(
    Object.keys(prepared.materializations)
      .sort()
      .map((slotId) => [slotId, uuidv7()]),
  );
  const compactDocument = compactReportMaterializations(
    document,
    snapshotIdsBySlotId,
  );
  const compactContentHash = reportContentHash(compactDocument);
  const createdAt = new Date().toISOString();
  const artifact = serializeReportMaterializationArtifact({
    materializationId: prepared.materializationRunId,
    materializationVersion: prepared.materializationVersion,
    sourceSnapshot: materializationSourceRefs(
      prepared,
      compactContentHash,
      createdAt,
    ),
    materializationsBySlotId: prepared.materializations,
    materializerVersion: REPORT_MATERIALIZER_VERSION,
    createdAt,
  });
  const artifactBytes = Buffer.from(JSON.stringify(artifact));
  const objectKey =
    `projects/${prepared.projectId}/report-materializations/` +
    `${prepared.materializationRunId}-${artifact.contentHash.slice(0, 12)}.json`;
  let stored: { objectVersion: string };
  try {
    stored = await putImmutableObject({
      objectKey,
      body: artifactBytes,
      mediaType: "application/json",
      metadata: {
        project: prepared.projectId,
        materialization: prepared.materializationRunId,
        sourceSnapshot: prepared.sourceSnapshot.sourceSnapshotId,
      },
    });
  } catch (error) {
    const existing = await readObjectBytes(objectKey).catch(() => null);
    if (
      !existing ||
      createHash("sha256").update(existing).digest("hex") !==
        createHash("sha256").update(artifactBytes).digest("hex")
    ) {
      throw error;
    }
    stored = {
      objectVersion:
        `sha256:${createHash("sha256")
          .update(artifactBytes)
          .digest("hex")}`,
    };
  }
  return {
    prepared,
    document,
    compactDocument,
    snapshotIdsBySlotId,
    artifact,
    artifactBytes,
    objectKey,
    objectVersion: stored.objectVersion,
  };
}

async function commitReportMaterialization(
  built: BuiltReportMaterialization,
): Promise<void> {
  await withTransaction(async (client) => {
    const { prepared } = built;
    await acquireProjectLineageLock(client, prepared.projectId);
    const run = await client.query<{
      operation_status: string;
      validity_status: string;
      attempt: number;
      source_snapshot_id: string;
      input_fingerprint: string;
      job_id: string;
    }>(
      `SELECT operation_status, validity_status, attempt,
         source_snapshot_id, input_fingerprint, job_id
       FROM report_materialization_run
       WHERE materialization_run_id = $1
       FOR UPDATE`,
      [prepared.materializationRunId],
    );
    const currentRun = run.rows[0];
    if (!currentRun) throw new Error("REPORT_MATERIALIZATION_TASK_NOT_FOUND");
    if (currentRun.operation_status === "succeeded") return;
    if (
      currentRun.operation_status !== "running" ||
      currentRun.validity_status !== "current" ||
      currentRun.attempt !== prepared.attempt ||
      currentRun.job_id !== prepared.jobId ||
      currentRun.source_snapshot_id !==
        prepared.sourceSnapshot.sourceSnapshotId ||
      currentRun.input_fingerprint !== prepared.sourceSnapshot.fingerprint
    ) {
      throw new Error("REPORT_MATERIALIZATION_COMMIT_REJECTED");
    }
    const context = await projectContext(
      client,
      prepared.projectId,
      prepared.userId,
    );
    const currentOutline = await readOutline(
      client,
      prepared.projectId,
      true,
    );
    if (!currentOutline) {
      await markReportMaterializationObsolete(client, {
        materializationRunId: prepared.materializationRunId,
        jobId: prepared.jobId,
        code: "REPORT_OUTLINE_CHANGED",
        summary: "보고서 구성 입력이 변경되었습니다.",
      });
      return;
    }
    const currentSnapshot = await persistReportSourceSnapshot(
      client,
      context,
      currentOutline.current_resource_version_id,
    );
    if (
      currentSnapshot.fingerprint !== prepared.sourceSnapshot.fingerprint ||
      currentSnapshot.sourceSnapshotId !==
        prepared.sourceSnapshot.sourceSnapshotId
    ) {
      await markReportMaterializationObsolete(client, {
        materializationRunId: prepared.materializationRunId,
        jobId: prepared.jobId,
        code: "SOURCE_FINGERPRINT_MISMATCH",
        summary: "보고서 생성 중 입력 버전이 변경되었습니다.",
      });
      return;
    }
    const currentReport = await client.query<{
      report_id: string;
      resource_id: string;
      active_resource_version_id: string | null;
      current_version: string;
    }>(
      `SELECT report_id, resource_id, active_resource_version_id,
         current_version
       FROM report
       WHERE project_id = $1
       FOR UPDATE`,
      [prepared.projectId],
    );
    const report = currentReport.rows[0];
    const reportChanged = prepared.report.existing
      ? !report ||
        report.report_id !== prepared.report.reportId ||
        report.resource_id !== prepared.report.resourceId ||
        report.active_resource_version_id !==
          prepared.report.parentResourceVersionId ||
        Number(report.current_version) + 1 !== prepared.report.version
      : Boolean(report);
    if (reportChanged) {
      await markReportMaterializationObsolete(client, {
        materializationRunId: prepared.materializationRunId,
        jobId: prepared.jobId,
        code: "REPORT_POINTER_CHANGED",
        summary: "보고서 생성 중 활성 보고서 버전이 변경되었습니다.",
      });
      return;
    }

    const artifactHash = createHash("sha256")
      .update(built.artifactBytes)
      .digest("hex");
    const artifactId = uuidv7();
    await client.query(
      `INSERT INTO artifact (
         artifact_id, project_id, artifact_kind, storage_status,
         bucket_name, object_key, object_version, sha256, byte_size,
         media_type, original_filename, retention_class,
         created_by_actor_type
       ) VALUES ($1, $2, 'analysis', 'accepted', $3, $4, $5, $6, $7,
         'application/json', $8, 'project', 'worker')`,
      [
        artifactId,
        prepared.projectId,
        objectStoreBucket(),
        built.objectKey,
        built.objectVersion,
        artifactHash,
        built.artifactBytes.byteLength,
        `report-materialization-${prepared.materializationRunId}.json`,
      ],
    );
    const materializationResourceId = uuidv7();
    const materializationResourceVersionId = uuidv7();
    await client.query(
      `INSERT INTO versioned_resource (
         resource_id, project_id, resource_kind, resource_key
       ) VALUES ($1, $2, 'report_materialization', $3)`,
      [
        materializationResourceId,
        prepared.projectId,
        `run:${prepared.materializationRunId}`,
      ],
    );
    await client.query(
      `INSERT INTO resource_version (
         resource_version_id, resource_id, version_no, lifecycle_status,
         validity_status, schema_version, input_fingerprint, content_hash,
         created_by_actor_type
       ) VALUES ($1, $2, $3, 'approved', 'current', '1.0', $4, $5,
         'system')`,
      [
        materializationResourceVersionId,
        materializationResourceId,
        prepared.materializationVersion,
        prepared.sourceSnapshot.fingerprint,
        built.artifact.contentHash,
      ],
    );
    await client.query(
      `INSERT INTO resource_artifact (
         resource_version_id, artifact_role, artifact_id
       ) VALUES ($1, 'report_materialization', $2)`,
      [materializationResourceVersionId, artifactId],
    );
    if (!prepared.report.existing) {
      await client.query(
        `INSERT INTO versioned_resource (
           resource_id, project_id, resource_kind, resource_key
         ) VALUES ($1, $2, 'report', 'main')`,
        [prepared.report.resourceId, prepared.projectId],
      );
      await client.query(
        `INSERT INTO report (
           project_id, report_id, resource_id, outline_approval_id,
           current_version, status
         ) VALUES ($1, $2, $3, $4, 1, 'working')`,
        [
          prepared.projectId,
          prepared.report.reportId,
          prepared.report.resourceId,
          prepared.outlineApprovalId,
        ],
      );
    }
    await client.query(
      `INSERT INTO resource_version (
         resource_version_id, resource_id, version_no, lifecycle_status,
         validity_status, supersedes_version_id, schema_version,
         input_fingerprint, content_hash, created_by_user_id,
         created_by_actor_type
       ) VALUES ($1, $2, $3, 'draft', 'current', $4, '1.0', $5, $6, $7,
         'system')`,
      [
        prepared.report.resourceVersionId,
        prepared.report.resourceId,
        prepared.report.version,
        prepared.report.parentResourceVersionId,
        prepared.sourceSnapshot.fingerprint,
        reportContentHash(built.compactDocument),
        prepared.userId,
      ],
    );
    await client.query(
      `INSERT INTO report_version (
         resource_version_id, report_id, version_no,
         parent_resource_version_id, outline_approval_id,
         version_status, content_json, saved_by_user_id,
         materialization_run_id
       ) VALUES ($1, $2, $3, $4, $5, 'working', $6::jsonb, $7, $8)`,
      [
        prepared.report.resourceVersionId,
        prepared.report.reportId,
        prepared.report.version,
        prepared.report.parentResourceVersionId,
        prepared.outlineApprovalId,
        JSON.stringify(built.compactDocument),
        prepared.userId,
        prepared.materializationRunId,
      ],
    );
    for (const [slotId, snapshot] of Object.entries(
      prepared.materializations,
    )) {
      const snapshotId = built.snapshotIdsBySlotId[slotId];
      await client.query(
        `INSERT INTO report_materialization_block (
           materialization_snapshot_id, materialization_run_id, project_id,
           slot_id, page_id, block_id, snapshot_kind, snapshot_status,
           blocker_code, snapshot_hash, snapshot_json
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)`,
        [
          snapshotId,
          prepared.materializationRunId,
          prepared.projectId,
          slotId,
          snapshot.provenance.pageId,
          snapshot.provenance.blockId,
          snapshot.kind,
          snapshot.status,
          snapshot.blockerCode,
          contentHash(snapshot),
          JSON.stringify(snapshot),
        ],
      );
    }
    if (prepared.report.parentResourceVersionId) {
      await invalidateResourceDependents(client, {
        projectId: prepared.projectId,
        upstreamResourceVersionIds: [
          prepared.report.parentResourceVersionId,
        ],
      });
      await client.query(
        `UPDATE resource_version SET lifecycle_status = 'superseded'
         WHERE resource_version_id = $1 AND lifecycle_status = 'draft'`,
        [prepared.report.parentResourceVersionId],
      );
      await client.query(
        `UPDATE report_version SET version_status = 'superseded'
         WHERE resource_version_id = $1 AND version_status = 'working'`,
        [prepared.report.parentResourceVersionId],
      );
    }
    await client.query(
      `UPDATE report
       SET active_resource_version_id = $2,
           approved_resource_version_id = NULL,
           outline_approval_id = $3, current_version = $4,
           status = 'working', updated_at = now()
       WHERE project_id = $1`,
      [
        prepared.projectId,
        prepared.report.resourceVersionId,
        prepared.outlineApprovalId,
        prepared.report.version,
      ],
    );
    await client.query(
      `UPDATE report_materialization_run
       SET operation_status = 'succeeded', validity_status = 'current',
           report_resource_version_id = $2, output_artifact_id = $3,
           materialization_resource_version_id = $4,
           ready_block_count = required_block_count,
           blocker_codes = '{}', result_hash = $5,
           finished_at = now(), error_code = NULL, error_summary = NULL
       WHERE materialization_run_id = $1`,
      [
        prepared.materializationRunId,
        prepared.report.resourceVersionId,
        artifactId,
        materializationResourceVersionId,
        built.artifact.contentHash,
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
        prepared.jobId,
        JSON.stringify({
          materializationRunId: prepared.materializationRunId,
          materializationResourceVersionId,
          reportResourceVersionId: prepared.report.resourceVersionId,
          artifactId,
          sourceSnapshotId: prepared.sourceSnapshot.sourceSnapshotId,
        }),
      ],
    );
    await client.query(
      `INSERT INTO workflow_job_output (
         job_id, output_role, resource_version_id
       ) VALUES
         ($1, 'report_materialization', $2),
         ($1, 'report', $3)
       ON CONFLICT (job_id, output_role) DO NOTHING`,
      [
        prepared.jobId,
        materializationResourceVersionId,
        prepared.report.resourceVersionId,
      ],
    );
    const sourceVersionIds = [
      ...new Set(
        prepared.sourceSnapshot.components.flatMap((component) =>
          component.versionId ? [component.versionId] : [],
        ),
      ),
    ];
    await recordResourceDependencies(client, {
      projectId: prepared.projectId,
      dependencies: [
        ...sourceVersionIds.map((sourceVersionId) => ({
          upstreamResourceVersionId: sourceVersionId,
          downstreamResourceVersionId:
            materializationResourceVersionId,
          dependencyKind: "report_materialization_input",
        })),
        {
          upstreamResourceVersionId:
            materializationResourceVersionId,
          downstreamResourceVersionId:
            prepared.report.resourceVersionId,
          dependencyKind: "materialization_to_report",
        },
      ],
    });
    await recordReportVersionDependency(client, {
      projectId: prepared.projectId,
      outlineApprovalId: prepared.outlineApprovalId,
      downstreamResourceVersionId: prepared.report.resourceVersionId,
    });
  });
}

export async function executeReportMaterialization(input: {
  materializationRunId: string;
  jobId: string;
  attempt: number;
  projectId: string;
  sourceSnapshotId: string;
  sourceFingerprint: string;
  outlineApprovalId: string;
  requestedByUserId: string;
  signal?: AbortSignal;
}): Promise<void> {
  input.signal?.throwIfAborted();
  const prepared = await prepareReportMaterialization(input);
  if (!prepared) return;
  input.signal?.throwIfAborted();
  const built = await buildReportMaterialization(prepared, input.signal);
  input.signal?.throwIfAborted();
  await commitReportMaterialization(built);
}

export async function failReportMaterialization(input: {
  materializationRunId: string;
  jobId: string;
  attempt: number;
  code: string;
  message: string;
}): Promise<void> {
  const cancelled = input.code === "REPORT_MATERIALIZATION_CANCELLED";
  const publicSummary = cancelled
    ? "보고서 초안 생성이 취소되었습니다."
    : input.code === "REPORT_MATERIALIZATION_BLOCKED"
      ? "필수 보고서 데이터를 확정하지 못했습니다."
      : input.code === "OUTLINE_REVALIDATION_REQUIRED"
        ? "입력 버전이 변경되어 보고서 구성을 다시 확인해야 합니다."
        : "보고서 초안을 생성하지 못했습니다. 다시 시도해주세요.";
  await withTransaction(async (client) => {
    await client.query(
      `UPDATE report_materialization_run
       SET operation_status = $4, error_code = $5,
           error_summary = $6, finished_at = now()
       WHERE materialization_run_id = $1 AND job_id = $2
         AND attempt = $3
         AND operation_status IN ('queued', 'running', 'cancel_requested')`,
      [
        input.materializationRunId,
        input.jobId,
        input.attempt,
        cancelled ? "cancelled" : "failed",
        input.code.slice(0, 100),
        publicSummary,
      ],
    );
  });
}

export async function getReportMaterialization(input: {
  projectId: string;
  userId: string;
  materializationRunId: string;
}) {
  return withTransaction(async (client) => {
    const result = await client.query<{
      materialization_run_id: string;
      source_snapshot_id: string;
      input_fingerprint: string;
      report_resource_version_id: string | null;
      materialization_resource_version_id: string | null;
      output_artifact_id: string | null;
      required_block_count: number;
      ready_block_count: number;
      blocker_codes: string[];
      operation_status: string;
      validity_status: string;
      error_code: string | null;
      error_summary: string | null;
      job_id: string;
      current_phase: string | null;
      progress_mode: string;
      progress_percent: number;
      attempt: number;
      retryable: boolean;
      requested_at: Date;
      started_at: Date | null;
      heartbeat_at: Date | null;
      finished_at: Date | null;
      materialized_item_count: number;
      blocker_count: number;
    }>(
      `SELECT run.materialization_run_id, run.source_snapshot_id,
         run.input_fingerprint, run.report_resource_version_id,
         run.materialization_resource_version_id, run.output_artifact_id,
         run.required_block_count, run.ready_block_count,
         run.blocker_codes, run.operation_status, run.validity_status,
         run.error_code, run.error_summary, job.job_id,
         job.current_phase, job.progress_mode, job.progress_percent,
         job.attempt, job.retryable, job.requested_at, job.started_at,
         job.heartbeat_at, job.finished_at,
         COUNT(block.materialization_snapshot_id)::integer
           AS materialized_item_count,
         COUNT(block.materialization_snapshot_id)
           FILTER (WHERE block.snapshot_status = 'blocked')::integer
           AS blocker_count
       FROM report_materialization_run run
       JOIN workflow_job job
         ON job.job_id = run.job_id
        AND job.project_id = run.project_id
       JOIN project ON project.project_id = run.project_id
       LEFT JOIN report_materialization_block block
         ON block.materialization_run_id = run.materialization_run_id
        AND block.project_id = run.project_id
       WHERE run.project_id = $1
         AND run.materialization_run_id = $2
         AND project.owner_user_id = $3
         AND project.deleted_at IS NULL
       GROUP BY run.materialization_run_id, job.job_id`,
      [
        input.projectId,
        input.materializationRunId,
        input.userId,
      ],
    );
    const row = result.rows[0];
    if (!row) {
      throw new ApiError(
        404,
        "TASK_NOT_FOUND",
        "보고서 생성 작업을 찾을 수 없습니다.",
      );
    }
    return {
      jobId: row.job_id,
      jobType: "report_materialization",
      taskId: row.materialization_run_id,
      operationStatus: row.operation_status,
      validity: row.validity_status,
      phase: row.current_phase,
      progressMode: row.progress_mode,
      progressPercent: row.progress_percent,
      attempt: row.attempt,
      retryable: row.retryable,
      error: row.error_code
        ? reportMaterializationWorkerError(
            row.error_code,
            row.error_summary,
            row.retryable,
            row.current_phase,
          )
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
      sourceFingerprint: row.input_fingerprint,
      reportVersionId: row.report_resource_version_id,
      materializationId: row.materialization_resource_version_id,
      materializedItemCount: row.materialized_item_count,
      blockerCount: row.blocker_count,
      artifact: row.materialization_resource_version_id
        ? {
            id: row.materialization_resource_version_id,
            version: 1,
            artifactId: row.output_artifact_id,
          }
        : null,
      obsoleteReason:
        row.validity_status === "obsolete"
          ? row.error_summary ?? "source_changed"
          : null,
      reportRoute:
        row.operation_status === "succeeded" &&
        row.validity_status === "current" &&
        row.report_resource_version_id
          ? `/projects/${input.projectId}/report`
          : null,
    };
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

async function latestJobs(
  client: TransactionClient,
  report: ReportRow,
  projectId: string,
) {
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
          contentUrl: preview.rows[0].source_artifact_id
            ? `/api/projects/${projectId}/artifacts/${preview.rows[0].source_artifact_id}/content`
            : undefined,
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

function attachAuthoritativeRenderAssets(
  document: ReportDocument,
  styles: Context["templateStyles"],
): ReportDocument {
  const next = structuredClone(document);
  const stylesById = new Map(
    styles.map((item) => [item.resourceId, item.typedTemplate]),
  );

  for (const block of next.pages.flatMap((page) => page.blocks)) {
    const snapshot = block.materializedData;
    const bbox = block.bbox;
    if (!snapshot || snapshot.status !== "ready" || !bbox) continue;

    if (snapshot.kind === "chart" || snapshot.kind === "composite_chart") {
      const typed = snapshot.styleTemplateRef
        ? stylesById.get(snapshot.styleTemplateRef)
        : null;
      if (typed?.templateType !== "chart") continue;
      const style = typed as ChartStyleTemplate;
      const allowed = snapshot.supportedChartTypes.filter(
        (type) =>
          type === style.chartFamily ||
          style.approvedAlternativeTypes.includes(type) ||
          (style.chartFamily === "line_band" && type === "line"),
      );
      const variants =
        allowed.length > 0 ? allowed : snapshot.supportedChartTypes.slice(0, 1);
      block.renderAssets = Object.fromEntries(
        variants.map((type) => [
          type,
          createRenderAsset(
            buildChartScene({
              bbox,
              categories: snapshot.categories.map(
                (cell) => cell.formattedText || cell.rawValue || "",
              ),
              series: snapshot.series.map((series) => ({
                seriesId: series.seriesId,
                label: series.label,
                role: series.role,
                axis: series.axis,
                chartType: series.chartType,
                unit: series.unit,
                numberFormat: series.numberFormat,
                estimateType: series.estimateType,
                values: series.values.map((cell) => cell.rawValue),
              })),
              type,
              style,
            }),
          ),
        ]),
      );
      const defaultType =
        block.chartType && block.renderAssets[block.chartType]
          ? block.chartType
          : variants[0];
      if (defaultType && block.renderAssets[defaultType]) {
        block.renderAssets.default = block.renderAssets[defaultType];
      }
      continue;
    }

    if (snapshot.kind === "scalar") {
      const typed = snapshot.styleTemplateRef
        ? stylesById.get(snapshot.styleTemplateRef)
        : null;
      if (typed?.templateType !== "scalar") continue;
      block.renderAssets = {
        default: createRenderAsset(
          buildScalarScene({
            bbox,
            formattedValue: snapshot.formattedValue,
            style: {
              fontRef: String(typed.fontRef),
              fontSizePt: Number(typed.fontSizePt),
              color: String(typed.color),
              weight: Number(typed.weight),
              alignment: String(typed.alignment),
              bbox: (typed.bbox as [number, number, number, number]) ?? bbox,
            },
          }),
        ),
      };
      continue;
    }

    if (snapshot.kind === "table") {
      const typed = snapshot.styleTemplateRef
        ? stylesById.get(snapshot.styleTemplateRef)
        : null;
      if (typed?.templateType !== "table") continue;
      const body = (typed.bodyTypography ?? {}) as Record<string, unknown>;
      const borders = Array.isArray(typed.borders)
        ? (typed.borders as Array<Record<string, unknown>>)
        : [];
      const fills = Array.isArray(typed.fills)
        ? (typed.fills as string[])
        : [];
      block.renderAssets = {
        default: createRenderAsset(
          buildTableScene({
            bbox,
            matrix: snapshot.formattedMatrix.map((row) =>
              row.map((cell) => cell ?? ""),
            ),
            style: {
              fontRef: String(body.fontRef ?? "sans-serif"),
              fontSizePt: Number(body.fontSizePt ?? 8),
              color: String(body.color ?? "#000000"),
              borderColor: String(borders[0]?.color ?? "none"),
              fill: String(fills[0] ?? "none"),
            },
          }),
        ),
      };
    }
  }
  return next;
}

export async function getReportWorkspace(projectId: string, userId: string) {
  return withTransaction(async (client) => {
    const context = await projectContext(client, projectId, userId);
    const report = await latestReportState(client, projectId);
    const session = await activeEditSession(client, report.report_id);
    const jobs = await latestJobs(client, report, projectId);
    const templatePages = await resolvedTemplatePages(context);
    const hydratedReport = attachAuthoritativeRenderAssets(
      attachTemplateGeometry(
      report.content_json,
      templatePages,
      context.mappingBindings,
      context.materializationsBySlotId,
      ),
      context.templateStyles,
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
    const storedDocument = compactKnownReportMaterializations(document);
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
        reportContentHash(storedDocument),
        input.userId,
      ],
    );
    const saved = await client.query<{ saved_at: Date }>(
      `INSERT INTO report_version (
         resource_version_id, report_id, version_no,
         parent_resource_version_id, outline_approval_id,
         version_status, content_json, saved_by_user_id,
         materialization_run_id
       ) VALUES ($1, $2, $3, $4, $5, 'working', $6::jsonb, $7, $8)
       RETURNING saved_at`,
      [
        nextResourceVersionId,
        report.report_id,
        nextVersion,
        report.active_resource_version_id,
        report.outline_approval_id,
        JSON.stringify(storedDocument),
        input.userId,
        report.materialization_run_id,
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
    const source = await client.query<{
      content_json: ReportDocument;
      materialization_run_id: string | null;
    }>(
      `SELECT content_json, materialization_run_id FROM report_version
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
         version_status, content_json, saved_by_user_id,
         materialization_run_id
       ) VALUES ($1, $2, $3, $4, $5, 'working', $6::jsonb, $7, $8)`,
      [
        nextId,
        report.report_id,
        nextVersion,
        versionId,
        report.outline_approval_id,
        JSON.stringify(source.rows[0].content_json),
        input.userId,
        source.rows[0].materialization_run_id,
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

function regionTokenHash(
  templatePage: ReportTemplatePage,
  bbox: [number, number, number, number],
): string {
  const intersects = (candidate: number[] | undefined) =>
    Boolean(
      candidate &&
        candidate.length === 4 &&
        candidate[0] < bbox[2] &&
        candidate[2] > bbox[0] &&
        candidate[1] < bbox[3] &&
        candidate[3] > bbox[1],
    );
  const text = (templatePage.objects ?? [])
    .filter((object) => object.type === "text_run" && intersects(object.bbox))
    .sort((left, right) => {
      const leftBox = left.bbox ?? [0, 0, 0, 0];
      const rightBox = right.bbox ?? [0, 0, 0, 0];
      return (
        leftBox[1] - rightBox[1] ||
        leftBox[0] - rightBox[0] ||
        left.objectId.localeCompare(right.objectId)
      );
    })
    .map((object) => object.textRun?.text ?? "")
    .filter(Boolean)
    .join("\n");
  return sha256(text);
}

async function persistReportRenderSnapshot(
  client: TransactionClient,
  context: Context,
  reportVersionId: string,
): Promise<PersistedSourceSnapshot> {
  return persistSourceSnapshot(client, {
    projectId: context.projectId,
    scope: "report_render",
    schemaVersion: "1",
    components: [
      {
        key: "source_pdf",
        versionId: context.sourcePdfResourceVersionId,
        artifactId: context.sourcePdfArtifactId,
        contentHash: context.sourcePdfSha256,
      },
      {
        key: "template_ir",
        versionId: context.templateResourceVersionId,
        contentHash: null,
      },
      {
        key: "mapping_set",
        versionId: context.mappingSetResourceVersionId,
        contentHash: null,
      },
      {
        key: "validated_workbook",
        versionId: context.validatedWorkbookResourceVersionId,
        artifactId: context.workbookArtifactId,
        contentHash: null,
      },
      {
        key: "report",
        versionId: reportVersionId,
        contentHash: null,
      },
    ],
  });
}

function reportDeliveryWorkflowPayload(input: {
  jobId: string;
  jobAttempt: number;
  projectId: string;
  operationKind: "preview" | "validation" | "export";
  operationId: string;
  reportVersionId: string;
  sourceSnapshotId: string;
  sourceFingerprint: string;
  requestedByUserId: string;
  validationRunId?: string;
}) {
  return {
    workflowType: "reportDeliveryWorkflow" as const,
    ...input,
  };
}

async function insertReportDeliveryJob(
  client: TransactionClient,
  input: {
    context: Context;
    operationKind: "preview" | "validation" | "export";
    operationId: string;
    reportVersionId: string;
    sourceSnapshot: PersistedSourceSnapshot;
    requestedByUserId: string;
    validationRunId?: string;
    attempt?: number;
  },
): Promise<{ jobId: string; attempt: number }> {
  const jobId = uuidv7();
  const attempt = input.attempt ?? 1;
  const payload = reportDeliveryWorkflowPayload({
    jobId,
    jobAttempt: attempt,
    projectId: input.context.projectId,
    operationKind: input.operationKind,
    operationId: input.operationId,
    reportVersionId: input.reportVersionId,
    sourceSnapshotId: input.sourceSnapshot.sourceSnapshotId,
    sourceFingerprint: input.sourceSnapshot.fingerprint,
    requestedByUserId: input.requestedByUserId,
    ...(input.validationRunId
      ? { validationRunId: input.validationRunId }
      : {}),
  });
  await client.query(
    `INSERT INTO workflow_job (
       job_id, project_id, job_type, temporal_workflow_id,
       operation_status, validity_status, current_phase,
       progress_percent, progress_mode, progress_sequence, attempt,
       input_fingerprint, source_snapshot_id, requested_by_user_id
     ) VALUES ($1, $2, 'report_delivery', $3, 'queued', 'current',
       'preparing', 0, 'determinate', 0, $4, $5, $6, $7)`,
    [
      jobId,
      input.context.projectId,
      `reflo:${jobId}`,
      attempt,
      input.sourceSnapshot.fingerprint,
      input.sourceSnapshot.sourceSnapshotId,
      input.requestedByUserId,
    ],
  );
  for (const component of input.sourceSnapshot.components) {
    await client.query(
      `INSERT INTO workflow_job_input (
         job_id, input_role, resource_version_id, artifact_id
       ) VALUES ($1, $2, $3, $4)`,
      [
        jobId,
        component.key,
        component.versionId,
        component.artifactId,
      ],
    );
  }
  await client.query(
    `INSERT INTO outbox_event (
       outbox_event_id, job_id, command_type, command_id, payload_json
     ) VALUES ($1, $2, 'start_workflow', $3, $4::jsonb)`,
    [uuidv7(), jobId, uuidv7(), JSON.stringify(payload)],
  );
  return { jobId, attempt };
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
  return withTransaction(async (client) => {
    const context = await projectContext(client, input.projectId, input.userId);
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
       WHERE report_resource_version_id = $1
         AND preview_status IN ('queued', 'rendering', 'verifying', 'ready')
       ORDER BY created_at DESC LIMIT 1`,
      [versionId],
    );
    const prior = existing.rows[0];
    if (prior) {
      return {
        previewId: prior.preview_id,
        status: prior.preview_status,
        artifactId: prior.source_artifact_id,
        ...(prior.source_artifact_id
          ? {
              contentUrl:
                `/api/projects/${input.projectId}/artifacts/` +
                `${prior.source_artifact_id}/content`,
            }
          : {}),
        warnings: prior.warnings_json,
        updatedAt: prior.updated_at.toISOString(),
      };
    }
    const sourceSnapshot = await persistReportRenderSnapshot(
      client,
      context,
      versionId,
    );
    const previewId = uuidv7();
    const job = await insertReportDeliveryJob(client, {
      context,
      operationKind: "preview",
      operationId: previewId,
      reportVersionId: versionId,
      sourceSnapshot,
      requestedByUserId: input.userId,
    });
    const created = await client.query<{ updated_at: Date }>(
      `INSERT INTO report_preview (
         preview_id, project_id, report_resource_version_id,
         preview_status, warnings_json, created_by_user_id,
         job_id, source_snapshot_id, attempt
       ) VALUES ($1, $2, $3, 'queued', '[]'::jsonb, $4, $5, $6, $7)
       RETURNING updated_at`,
      [
        previewId,
        input.projectId,
        versionId,
        input.userId,
        job.jobId,
        sourceSnapshot.sourceSnapshotId,
        job.attempt,
      ],
    );
    return {
      previewId,
      status: "queued",
      artifactId: null,
      warnings: [],
      updatedAt: created.rows[0].updated_at.toISOString(),
    };
  });
}

export async function executeReportPreview(input: {
  projectId: string;
  userId: string;
  reportVersionId: string;
  previewId: string;
  jobId: string;
  jobAttempt: number;
  sourceSnapshotId: string;
}) {
  const versionId = input.reportVersionId;
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
    const claimed = await client.query<{ preview_id: string }>(
      `SELECT preview.preview_id
       FROM report_preview preview
       JOIN workflow_job job ON job.job_id = preview.job_id
       WHERE preview.preview_id = $1
         AND preview.project_id = $2
         AND preview.report_resource_version_id = $3
         AND preview.source_snapshot_id = $4
         AND preview.attempt = $5
         AND preview.preview_status IN ('queued', 'rendering')
         AND job.job_id = $6
         AND job.attempt = $5
         AND job.validity_status = 'current'
         AND job.operation_status IN ('queued', 'running')
       FOR UPDATE OF preview, job`,
      [
        input.previewId,
        input.projectId,
        versionId,
        input.sourceSnapshotId,
        input.jobAttempt,
        input.jobId,
      ],
    );
    if (!claimed.rows[0]) {
      throw new Error("REPORT_PREVIEW_JOB_OBSOLETE");
    }
    await client.query(
      `UPDATE report_preview
       SET preview_status = 'rendering', updated_at = now()
       WHERE preview_id = $1`,
      [input.previewId],
    );
    await client.query(
      `UPDATE workflow_job
       SET operation_status = 'running', current_phase = 'rendering',
           progress_percent = 10, heartbeat_at = now(), started_at = COALESCE(started_at, now())
       WHERE job_id = $1`,
      [input.jobId],
    );
    return {
      context,
      report,
    };
  });

  const templatePages = await resolvedTemplatePages(snapshot.context);
  const document = attachAuthoritativeRenderAssets(
    attachTemplateGeometry(
      snapshot.report.content_json,
      templatePages,
      snapshot.context.mappingBindings,
      snapshot.context.materializationsBySlotId,
    ),
    snapshot.context.templateStyles,
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
  const renderPlanId = uuidv7();
  const placements: Record<
    string,
    { pageNumber: number; bbox: [number, number, number, number] }
  > = {};
  const vectorAssetPayloads: Record<string, string> = {};
  const commands = document.pages.flatMap((page) => {
    const templatePage = templatePages.find(
      (item) => item.pageNumber === page.pageNumber,
    );
    if (!templatePage) return [];
    return page.blocks.flatMap((block) => {
      const slotId = block.dataBinding?.slotId;
      const asset =
        (block.chartType
          ? block.renderAssets?.[block.chartType]
          : undefined) ?? block.renderAssets?.default;
      if (
        !slotId ||
        !block.bbox ||
        !asset ||
        block.patchStrategy === "fixed" ||
        block.sourceObjectIds.length === 0
      ) {
        return [];
      }
      placements[block.blockId] = {
        pageNumber: page.pageNumber,
        bbox: block.bbox,
      };
      vectorAssetPayloads[asset.assetHash] = asset.svg;
      return [
        {
          commandId: uuidv7(),
          pageId: page.pageId,
          blockId: block.blockId,
          slotId,
          strategy: block.patchStrategy,
          targetObjectIds: block.sourceObjectIds,
          expectedTokenHashes: [regionTokenHash(templatePage, block.bbox)],
          vectorAssetHash: asset.assetHash,
          validationMaskIds: [],
        },
      ];
    });
  });
  const renderPlan = {
    schemaVersion: "1.0",
    artifactType: "render_plan",
    renderPlanId,
    renderPlanVersion: 1,
    inputs: {
      templateIrVersionId: snapshot.context.templateResourceVersionId,
      templateIrHash: contentHash({
        pages: templatePages,
        styles: snapshot.context.templateStyles,
      }),
      mappingSetVersionId: snapshot.context.mappingSetResourceVersionId,
      mappingSetHash: contentHash(snapshot.context.mappingBindings),
      workbookCalculationVersionId:
        snapshot.context.validatedWorkbookResourceVersionId,
      workbookCalculationHash: contentHash({
        artifactId: snapshot.context.workbookArtifactId,
        version: snapshot.context.workbookVersion,
      }),
      evidenceVersionIds: snapshot.context.evidence.map(
        (item) => item.evidenceId,
      ),
      reportVersionId: versionId,
    },
    values: [],
    commands,
    vectorAssets: commands.map((command) => {
      const block = document.pages
        .flatMap((page) => page.blocks)
        .find((item) => item.blockId === command.blockId);
      const kind = block?.materializedData?.kind;
      return {
        slotId: command.slotId,
        assetKind:
          kind === "composite_chart"
            ? "composite_chart"
            : kind === "scalar" || kind === "table" || kind === "chart"
              ? kind
              : "chart",
        sha256: command.vectorAssetHash,
        mediaType: "image/svg+xml",
      };
    }),
    validationMaskIds: [],
    createdAt: new Date().toISOString(),
    warnings: [],
  };
  const rendered =
    commands.length > 0
      ? await callPdfWorker<PdfRenderPlanResult>("/render-plan", {
          downloadUrl,
          renderPlan,
          placements,
          vectorAssetPayloads,
          textPatches: patches,
        })
      : await callPdfWorker<PdfRenderResult>("/render", {
          downloadUrl,
          patches,
          skipOverflow: true,
        });
  const pdfBytes = Buffer.from(rendered.pdfBase64, "base64");
  if (
    rendered.mediaType !== "application/pdf" ||
    rendered.byteSize !== pdfBytes.byteLength ||
    rendered.sha256 !== createHash("sha256").update(pdfBytes).digest("hex") ||
    !rendered.validation?.passed ||
    !rendered.qpdfPassed
  ) {
    throw new ApiError(
      503,
      "PDF_RENDER_INTEGRITY_FAILED",
      "생성된 PDF의 무결성 또는 고정 영역 검증에 실패했습니다.",
      { retryable: true },
    );
  }

  const artifactId = uuidv7();
  const previewId = input.previewId;
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
      sourcePdfHash: snapshot.context.sourcePdfSha256,
      renderPlanVersion:
        "renderPlan" in rendered
          ? rendered.renderPlan.version
          : "typed-render-plan-v1",
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
    const job = await client.query<{ operation_status: string }>(
      `SELECT operation_status
       FROM workflow_job
       WHERE job_id = $1 AND project_id = $2
         AND attempt = $3 AND source_snapshot_id = $4
         AND validity_status = 'current'
       FOR UPDATE`,
      [
        input.jobId,
        input.projectId,
        input.jobAttempt,
        input.sourceSnapshotId,
      ],
    );
    if (!["queued", "running"].includes(job.rows[0]?.operation_status ?? "")) {
      throw new Error("REPORT_PREVIEW_JOB_OBSOLETE");
    }
    await client.query(
      `UPDATE report_preview
       SET preview_status = 'stale', updated_at = now()
       WHERE report_resource_version_id = $1
         AND preview_status = 'ready' AND preview_id <> $2`,
      [versionId, previewId],
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
      `UPDATE report_preview
       SET preview_status = 'ready', source_artifact_id = $2,
           warnings_json = $3::jsonb, render_plan_hash = $4,
           error_code = NULL, error_summary = NULL,
           finished_at = now(), updated_at = now()
       WHERE preview_id = $1 AND project_id = $5
         AND job_id = $6 AND attempt = $7
       RETURNING updated_at`,
      [
        previewId,
        artifactId,
        JSON.stringify(warnings),
        contentHash(renderPlan),
        input.projectId,
        input.jobId,
        input.jobAttempt,
      ],
    );
    if (!created.rows[0]) {
      throw new Error("REPORT_PREVIEW_JOB_OBSOLETE");
    }
    await client.query(
      `UPDATE workflow_job
       SET operation_status = 'succeeded', current_phase = 'completed',
           progress_percent = 100, progress_sequence = progress_sequence + 1,
           heartbeat_at = now(), finished_at = now(),
           result_summary_json = $2::jsonb
       WHERE job_id = $1 AND attempt = $3`,
      [
        input.jobId,
        JSON.stringify({ previewId, artifactId, sha256: rendered.sha256 }),
        input.jobAttempt,
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

export async function failReportDelivery(input: {
  projectId: string;
  operationKind: "preview" | "validation" | "export";
  operationId: string;
  jobId: string;
  jobAttempt: number;
  code: string;
  message: string;
  cancelled: boolean;
}) {
  return withTransaction(async (client) => {
    const terminalStatus = input.cancelled ? "cancelled" : "failed";
    await client.query(
      `UPDATE workflow_job
       SET operation_status = $2, current_phase = $3,
           error_code = $4, error_summary = $5,
           heartbeat_at = now(), finished_at = now()
       WHERE job_id = $1 AND project_id = $6 AND attempt = $7
         AND operation_status IN ('queued', 'running', 'cancel_requested')`,
      [
        input.jobId,
        terminalStatus,
        terminalStatus,
        input.code,
        input.message,
        input.projectId,
        input.jobAttempt,
      ],
    );
    if (input.operationKind === "preview") {
      await client.query(
        `UPDATE report_preview
         SET preview_status = $2, error_code = $3, error_summary = $4,
             finished_at = now(), updated_at = now()
         WHERE preview_id = $1 AND job_id = $5 AND attempt = $6
           AND preview_status IN (
             'queued', 'rendering', 'verifying', 'cancel_requested'
           )`,
        [
          input.operationId,
          terminalStatus,
          input.code,
          input.message,
          input.jobId,
          input.jobAttempt,
        ],
      );
    } else if (input.operationKind === "validation") {
      await client.query(
        `UPDATE report_validation_run
         SET validation_status = $2, error_code = $3, error_summary = $4,
             finished_at = now()
         WHERE validation_run_id = $1 AND job_id = $5 AND attempt = $6
           AND validation_status IN ('queued', 'running')`,
        [
          input.operationId,
          terminalStatus,
          input.code,
          input.message,
          input.jobId,
          input.jobAttempt,
        ],
      );
    } else {
      await client.query(
        `UPDATE report_export
         SET operation_status = $2, error_code = $3, error_summary = $4,
             finished_at = now(), updated_at = now()
         WHERE export_id = $1 AND job_id = $5 AND attempt = $6
           AND operation_status IN (
             'queued', 'running', 'cancel_requested'
           )`,
        [
          input.operationId,
          terminalStatus,
          input.code,
          input.message,
          input.jobId,
          input.jobAttempt,
        ],
      );
    }
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
    const existing = await client.query<{
      validation_run_id: string;
      validation_status: string;
      issues_json: unknown[];
      started_at: Date;
      finished_at: Date | null;
    }>(
      `SELECT validation_run_id, validation_status, issues_json,
         started_at, finished_at
       FROM report_validation_run
       WHERE project_id = $1 AND report_resource_version_id = $2
         AND validation_status IN ('queued', 'running', 'passed', 'passed_with_warnings')
       ORDER BY started_at DESC LIMIT 1`,
      [input.projectId, versionId],
    );
    const prior = existing.rows[0];
    if (prior) {
      return {
        validationRunId: prior.validation_run_id,
        status: prior.validation_status,
        issues: prior.issues_json,
        startedAt: prior.started_at.toISOString(),
        finishedAt: prior.finished_at?.toISOString() ?? null,
      };
    }
    const sourceSnapshot = await persistReportRenderSnapshot(
      client,
      context,
      versionId,
    );
    const validationRunId = uuidv7();
    const job = await insertReportDeliveryJob(client, {
      context,
      operationKind: "validation",
      operationId: validationRunId,
      reportVersionId: versionId,
      sourceSnapshot,
      requestedByUserId: input.userId,
    });
    const created = await client.query<{ started_at: Date }>(
      `INSERT INTO report_validation_run (
         validation_run_id, project_id, report_resource_version_id,
         validation_status, issues_json, rule_version, created_by_user_id,
         job_id, source_snapshot_id, attempt
       ) VALUES ($1, $2, $3, 'queued', '[]'::jsonb,
         'report-validation-v1', $4, $5, $6, $7)
       RETURNING started_at`,
      [
        validationRunId,
        input.projectId,
        versionId,
        input.userId,
        job.jobId,
        sourceSnapshot.sourceSnapshotId,
        job.attempt,
      ],
    );
    return {
      validationRunId,
      status: "queued",
      issues: [],
      startedAt: created.rows[0].started_at.toISOString(),
      finishedAt: null,
    };
  });
}

export async function executeReportValidation(input: {
  projectId: string;
  userId: string;
  reportVersionId: string;
  validationRunId: string;
  jobId: string;
  jobAttempt: number;
  sourceSnapshotId: string;
}) {
  const versionId = input.reportVersionId;
  return withTransaction(async (client) => {
    const context = await projectContext(
      client,
      input.projectId,
      input.userId,
    );
    const report = await latestReportState(client, input.projectId);
    if (report.active_resource_version_id !== versionId) {
      throw new Error("VALIDATION_STALE");
    }
    const claimed = await client.query<{ validation_run_id: string }>(
      `SELECT validation.validation_run_id
       FROM report_validation_run validation
       JOIN workflow_job job ON job.job_id = validation.job_id
       WHERE validation.validation_run_id = $1
         AND validation.project_id = $2
         AND validation.report_resource_version_id = $3
         AND validation.source_snapshot_id = $4
         AND validation.attempt = $5
         AND validation.validation_status IN ('queued', 'running')
         AND job.job_id = $6 AND job.attempt = $5
         AND job.validity_status = 'current'
         AND job.operation_status IN ('queued', 'running')
       FOR UPDATE OF validation, job`,
      [
        input.validationRunId,
        input.projectId,
        versionId,
        input.sourceSnapshotId,
        input.jobAttempt,
        input.jobId,
      ],
    );
    if (!claimed.rows[0]) throw new Error("REPORT_VALIDATION_JOB_OBSOLETE");
    await client.query(
      `UPDATE report_validation_run
       SET validation_status = 'running'
       WHERE validation_run_id = $1`,
      [input.validationRunId],
    );
    await client.query(
      `UPDATE workflow_job
       SET operation_status = 'running', current_phase = 'validating',
           progress_percent = 20, heartbeat_at = now(),
           started_at = COALESCE(started_at, now())
       WHERE job_id = $1`,
      [input.jobId],
    );
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
    const status = issues.some((issue) => issue.severity === "blocking")
      ? "failed"
      : "passed";
    const created = await client.query<{ started_at: Date; finished_at: Date }>(
      `UPDATE report_validation_run
       SET validation_status = $2, issues_json = $3::jsonb,
           error_code = NULL, error_summary = NULL, finished_at = now()
       WHERE validation_run_id = $1 AND project_id = $4
         AND job_id = $5 AND attempt = $6
       RETURNING started_at, finished_at`,
      [
        input.validationRunId,
        status,
        JSON.stringify(issues),
        input.projectId,
        input.jobId,
        input.jobAttempt,
      ],
    );
    if (!created.rows[0]) throw new Error("REPORT_VALIDATION_JOB_OBSOLETE");
    await client.query(
      `UPDATE workflow_job
       SET operation_status = 'succeeded', current_phase = 'completed',
           progress_percent = 100, progress_sequence = progress_sequence + 1,
           heartbeat_at = now(), finished_at = now(),
           result_summary_json = $2::jsonb
       WHERE job_id = $1 AND attempt = $3`,
      [
        input.jobId,
        JSON.stringify({
          validationRunId: input.validationRunId,
          status,
          issueCount: issues.length,
        }),
        input.jobAttempt,
      ],
    );
    return {
      validationRunId: input.validationRunId,
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
    const context = await projectContext(client, input.projectId, input.userId);
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
    const renderedPreview = await client.query<{ source_artifact_id: string }>(
      `SELECT source_artifact_id
       FROM report_preview
       WHERE project_id = $1 AND report_resource_version_id = $2
         AND preview_status = 'ready' AND source_artifact_id IS NOT NULL
       ORDER BY updated_at DESC LIMIT 1`,
      [input.projectId, versionId],
    );
    if (
      !renderedPreview.rows[0]?.source_artifact_id ||
      renderedPreview.rows[0].source_artifact_id === context.sourcePdfArtifactId
    ) {
      throw new ApiError(
        409,
        "RENDERED_PDF_REQUIRED",
        "승인된 보고서 버전의 새 PDF 미리보기를 생성한 뒤 내보내주세요.",
      );
    }
    const existing = await client.query<{ export_id: string }>(
      `SELECT export_id FROM report_export WHERE report_approval_id = $1`,
      [approval.rows[0].approval_id],
    );
    let exportId = existing.rows[0]?.export_id;
    if (!exportId) {
      exportId = uuidv7();
      const sourceSnapshot = await persistReportRenderSnapshot(
        client,
        context,
        versionId,
      );
      const job = await insertReportDeliveryJob(client, {
        context,
        operationKind: "export",
        operationId: exportId,
        reportVersionId: versionId,
        sourceSnapshot,
        requestedByUserId: input.userId,
        validationRunId,
      });
      await client.query(
        `INSERT INTO report_export (
           export_id, project_id, report_approval_id, operation_status,
           outcome, requested_by_user_id, job_id, source_snapshot_id, attempt
         ) VALUES ($1, $2, $3, 'queued', 'pending', $4, $5, $6, $7)`,
        [
          exportId,
          input.projectId,
          approval.rows[0].approval_id,
          input.userId,
          job.jobId,
          sourceSnapshot.sourceSnapshotId,
          job.attempt,
        ],
      );
      await client.query(
        `INSERT INTO report_export_artifact (
           export_artifact_id, export_id, artifact_type, artifact_status
         ) VALUES
           ($1, $2, 'pdf', 'pending'),
           ($3, $2, 'xlsx', 'pending')`,
        [uuidv7(), exportId, uuidv7()],
      );
    }
    const body = await exportView(client, context, exportId);
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

export async function executeReportExport(input: {
  projectId: string;
  userId: string;
  approvedReportVersionId: unknown;
  validationRunId: unknown;
  artifactTypes: unknown;
  idempotencyKey: string | null;
  exportId?: string;
  jobId?: string;
  jobAttempt?: number;
  sourceSnapshotId?: string;
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
    const renderedPreview = await client.query<{
      source_artifact_id: string;
    }>(
      `SELECT source_artifact_id
       FROM report_preview
       WHERE project_id = $1
         AND report_resource_version_id = $2
         AND preview_status = 'ready'
         AND source_artifact_id IS NOT NULL
       ORDER BY updated_at DESC
       LIMIT 1`,
      [input.projectId, versionId],
    );
    const renderedPdfArtifactId =
      renderedPreview.rows[0]?.source_artifact_id;
    if (
      !renderedPdfArtifactId ||
      renderedPdfArtifactId === context.sourcePdfArtifactId
    ) {
      throw new ApiError(
        409,
        "RENDERED_PDF_REQUIRED",
        "승인된 보고서 버전의 새 PDF 미리보기를 생성한 뒤 내보내주세요.",
      );
    }
    let exportResult = await client.query<{ export_id: string }>(
      `SELECT export_id FROM report_export WHERE report_approval_id = $1`,
      [approval.rows[0].approval_id],
    );
    if (
      input.exportId &&
      input.jobId &&
      input.jobAttempt &&
      input.sourceSnapshotId
    ) {
      if (exportResult.rows[0]?.export_id !== input.exportId) {
        throw new Error("REPORT_EXPORT_JOB_OBSOLETE");
      }
      const claimed = await client.query<{ export_id: string }>(
        `SELECT export.export_id
         FROM report_export export
         JOIN workflow_job job ON job.job_id = export.job_id
         WHERE export.export_id = $1 AND export.project_id = $2
           AND export.source_snapshot_id = $3
           AND export.attempt = $4
           AND export.operation_status IN ('queued', 'running')
           AND job.job_id = $5 AND job.attempt = $4
           AND job.validity_status = 'current'
           AND job.operation_status IN ('queued', 'running')
         FOR UPDATE OF export, job`,
        [
          input.exportId,
          input.projectId,
          input.sourceSnapshotId,
          input.jobAttempt,
          input.jobId,
        ],
      );
      if (!claimed.rows[0]) throw new Error("REPORT_EXPORT_JOB_OBSOLETE");
      await client.query(
        `UPDATE report_export_artifact
         SET source_artifact_id = CASE artifact_type
               WHEN 'pdf' THEN $2
               ELSE $3
             END,
             artifact_status = 'ready', retryable = false,
             error_code = NULL, error_message = NULL, updated_at = now()
         WHERE export_id = $1`,
        [
          input.exportId,
          renderedPdfArtifactId,
          context.workbookArtifactId,
        ],
      );
      const manifestHash = contentHash({
        sourceSnapshotId: input.sourceSnapshotId,
        reportVersionId: versionId,
        validationRunId,
        pdfArtifactId: renderedPdfArtifactId,
        workbookArtifactId: context.workbookArtifactId,
      });
      await client.query(
        `UPDATE report_export
         SET operation_status = 'succeeded', outcome = 'complete',
             input_manifest_hash = $2, error_code = NULL,
             error_summary = NULL, finished_at = now(), updated_at = now()
         WHERE export_id = $1`,
        [input.exportId, manifestHash],
      );
      await client.query(
        `UPDATE workflow_job
         SET operation_status = 'succeeded', current_phase = 'completed',
             progress_percent = 100, progress_sequence = progress_sequence + 1,
             heartbeat_at = now(), finished_at = now(),
             result_summary_json = $2::jsonb
         WHERE job_id = $1 AND attempt = $3`,
        [
          input.jobId,
          JSON.stringify({
            exportId: input.exportId,
            manifestHash,
            pdfArtifactId: renderedPdfArtifactId,
            workbookArtifactId: context.workbookArtifactId,
          }),
          input.jobAttempt,
        ],
      );
    }
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
          renderedPdfArtifactId,
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
    const current = await client.query<{
      report_resource_version_id: string;
      validation_run_id: string;
      operation_status: string;
      attempt: number;
    }>(
      `SELECT approval.report_resource_version_id,
         approval.validation_run_id, export.operation_status, export.attempt
       FROM report_export export
       JOIN report_approval approval
         ON approval.approval_id = export.report_approval_id
       WHERE export.export_id = $1 AND export.project_id = $2
       FOR UPDATE OF export`,
      [input.exportId, input.projectId],
    );
    const exportRow = current.rows[0];
    if (!exportRow) {
      throw new ApiError(404, "EXPORT_NOT_FOUND", "내보내기 작업을 찾을 수 없습니다.");
    }
    if (!["failed", "cancelled"].includes(exportRow.operation_status)) {
      throw new ApiError(
        409,
        "EXPORT_RETRY_NOT_ALLOWED",
        "실패하거나 취소된 내보내기만 재시도할 수 있습니다.",
      );
    }
    const nextAttempt = exportRow.attempt + 1;
    const sourceSnapshot = await persistReportRenderSnapshot(
      client,
      context,
      exportRow.report_resource_version_id,
    );
    const job = await insertReportDeliveryJob(client, {
      context,
      operationKind: "export",
      operationId: input.exportId,
      reportVersionId: exportRow.report_resource_version_id,
      sourceSnapshot,
      requestedByUserId: input.userId,
      validationRunId: exportRow.validation_run_id,
      attempt: nextAttempt,
    });
    await client.query(
      `UPDATE report_export
       SET operation_status = 'queued', outcome = 'pending',
           job_id = $2, source_snapshot_id = $3, attempt = $4,
           error_code = NULL, error_summary = NULL, finished_at = NULL,
           updated_at = now()
       WHERE export_id = $1`,
      [
        input.exportId,
        job.jobId,
        sourceSnapshot.sourceSnapshotId,
        nextAttempt,
      ],
    );
    await client.query(
      `UPDATE report_export_artifact
       SET artifact_status = 'pending', source_artifact_id = NULL,
           attempt_no = $3, retryable = false, error_code = NULL,
           error_message = NULL, updated_at = now()
       WHERE export_id = $1 AND artifact_type = ANY($2::text[])`,
      [input.exportId, input.artifactTypes, nextAttempt],
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
    const current = await client.query<{ job_id: string | null }>(
      `SELECT job_id FROM report_export
       WHERE export_id = $1 AND project_id = $2
       FOR UPDATE`,
      [input.exportId, input.projectId],
    );
    if (!current.rows[0]) {
      throw new ApiError(404, "EXPORT_NOT_FOUND", "내보내기 작업을 찾을 수 없습니다.");
    }
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
    const jobId = current.rows[0].job_id;
    if (jobId) {
      const cancelled = await client.query<{ temporal_workflow_id: string }>(
        `UPDATE workflow_job
         SET operation_status = 'cancel_requested',
             current_phase = 'cancel_requested', heartbeat_at = now()
         WHERE job_id = $1
           AND operation_status IN ('queued', 'running')
         RETURNING temporal_workflow_id`,
        [jobId],
      );
      if (cancelled.rows[0]) {
        await client.query(
          `INSERT INTO outbox_event (
             outbox_event_id, job_id, command_type, command_id, payload_json
           ) VALUES ($1, $2, 'cancel_workflow', $3, $4::jsonb)`,
          [
            uuidv7(),
            jobId,
            uuidv7(),
            JSON.stringify({
              workflowId: cancelled.rows[0].temporal_workflow_id,
            }),
          ],
        );
      }
    }
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
