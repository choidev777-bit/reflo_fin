import { createHash } from "node:crypto";
import { connect } from "node:net";
import { Context } from "@temporalio/activity";
import yauzl from "yauzl";
import {
  createWorkerDownloadUrl,
  putImmutableObject,
  readObjectBytes,
} from "../../server/infrastructure/object-storage/s3";
import {
  fetchKrxClosingPrice,
  type MarketPriceSnapshot,
} from "../../server/infrastructure/market-data/krx";
import {
  validateEvidenceCandidate,
  type NewsDiscoveryResult,
  type ResearchCandidate,
  type ValidatedEvidence,
} from "../../server/domain/research-validation";
import { createWorkerResultEnvelope } from "../../server/domain/worker-result-contract";
import {
  collectResearchSources,
  type CollectionBundle,
} from "../../server/infrastructure/research-sources/adapters";
import type {
  FileIngestWorkflowInput,
  FileInspectionWorkflowInput,
  HypothesisGenerationWorkflowInput,
  ReportDeliveryWorkflowInput,
  ReportMaterializationWorkflowInput,
  ResearchValidationWorkflowInput,
  WorkbookApplicationWorkflowInput,
  PdfInspectionResult,
  WorkbookInspectionResult,
} from "./types";
import type {
  WorkbookApplicationWorkerResult,
} from "../../server/domain/workbook-application";
import { buildMappingSet } from "./mapping";
import {
  executeReportPreview,
  executeReportExport,
  executeReportValidation,
  executeReportMaterialization,
  failReportDelivery,
  failReportMaterialization,
} from "../../server/infrastructure/repositories/report-repository";

const internalApiUrl =
  process.env.REFLO_INTERNAL_API_URL?.replace(/\/$/, "") ||
  "http://127.0.0.1:3000";
const workerToken = process.env.REFLO_WORKER_TOKEN?.trim();
if (!workerToken) {
  throw new Error("REFLO_WORKER_TOKEN is required.");
}
const controlWorkerTool = { name: "reflo-control", version: "1.0.0" };

async function internalPost(path: string, body: unknown): Promise<void> {
  const serializedBody = JSON.stringify(body);
  const idempotencyKey = createHash("sha256")
    .update(path)
    .update("\0")
    .update(serializedBody)
    .digest("hex");
  const response = await fetch(`${internalApiUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${workerToken}`,
      "Idempotency-Key": idempotencyKey,
    },
    body: serializedBody,
    signal: Context.current().cancellationSignal,
  });
  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Internal API ${response.status}: ${message.slice(0, 300)}`);
  }
}

export async function recordJobProgress(
  jobId: string,
  jobAttempt: number,
  sequence: number,
  phase: string,
  progressPercent: number,
  message: string,
): Promise<void> {
  Context.current().heartbeat({ phase, progressPercent });
  await internalPost(`/internal/v1/jobs/${jobId}/progress`, {
    schemaVersion: "1.0.0",
    attempt: jobAttempt,
    sequence,
    phase,
    progressPercent,
    operationStatus: "running",
    message,
  });
}

async function clamScan(bytes: Buffer): Promise<"clean" | "infected" | "scan_unavailable"> {
  const host = process.env.REFLO_CLAMAV_HOST?.trim();
  if (!host) {
    return process.env.NODE_ENV === "production" ? "scan_unavailable" : "clean";
  }
  const port = Number(process.env.REFLO_CLAMAV_PORT ?? "3310");
  return new Promise((resolve) => {
    const socket = connect({ host, port });
    const chunks: Buffer[] = [];
    socket.setTimeout(30_000);
    socket.on("connect", () => {
      socket.write("zINSTREAM\0");
      const size = Buffer.alloc(4);
      size.writeUInt32BE(bytes.byteLength);
      socket.write(size);
      socket.write(bytes);
      socket.write(Buffer.alloc(4));
    });
    socket.on("data", (chunk: Buffer) => chunks.push(chunk));
    socket.on("end", () => {
      const reply = Buffer.concat(chunks).toString("utf8");
      resolve(reply.includes("FOUND") ? "infected" : reply.includes("OK") ? "clean" : "scan_unavailable");
    });
    socket.on("timeout", () => {
      socket.destroy();
      resolve("scan_unavailable");
    });
    socket.on("error", () => resolve("scan_unavailable"));
  });
}

function inspectPdf(bytes: Buffer) {
  const header = bytes.subarray(0, 8).toString("ascii");
  const sample = bytes.toString("latin1");
  const rejectionCodes: string[] = [];
  if (!header.startsWith("%PDF-")) rejectionCodes.push("FILE_MAGIC_MISMATCH");
  if (/\/Encrypt\b/.test(sample)) rejectionCodes.push("FILE_ENCRYPTED");
  if (/\/EmbeddedFiles\b|\/Collection\b/.test(sample)) {
    rejectionCodes.push("PDF_EMBEDDED_FILE");
  }
  if (/\/XFA\b|\/Launch\b|\/RichMedia\b|\/JavaScript\b/.test(sample)) {
    rejectionCodes.push("PDF_UNSUPPORTED_FEATURE");
  }
  return {
    detectedMediaType: "application/pdf",
    magicBytes: bytes.subarray(0, 8).toString("hex"),
    encrypted: rejectionCodes.includes("FILE_ENCRYPTED"),
    macroDetected: false,
    rejectionCodes,
  };
}

async function zipEntryNames(bytes: Buffer): Promise<string[]> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(bytes, { lazyEntries: true, validateEntrySizes: true }, (error, zip) => {
      if (error || !zip) {
        reject(error ?? new Error("ZIP_OPEN_FAILED"));
        return;
      }
      const names: string[] = [];
      zip.readEntry();
      zip.on("entry", (entry) => {
        names.push(entry.fileName);
        if (names.length > 10_000) {
          zip.close();
          reject(new Error("ZIP_ENTRY_LIMIT_EXCEEDED"));
          return;
        }
        zip.readEntry();
      });
      zip.on("end", () => resolve(names));
      zip.on("error", reject);
    });
  });
}

async function inspectWorkbook(bytes: Buffer) {
  const rejectionCodes: string[] = [];
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    rejectionCodes.push("FILE_MAGIC_MISMATCH");
  }
  let names: string[] = [];
  try {
    names = await zipEntryNames(bytes);
  } catch {
    rejectionCodes.push("ARCHIVE_INVALID");
  }
  if (!names.includes("[Content_Types].xml") || !names.includes("xl/workbook.xml")) {
    rejectionCodes.push("XLSX_STRUCTURE_INVALID");
  }
  if (
    names.some((name) =>
      /vbaProject\.bin$|externalLinks\/|embeddings\/|activeX\//i.test(name),
    )
  ) {
    rejectionCodes.push("WORKBOOK_UNSUPPORTED_FEATURE");
  }
  return {
    detectedMediaType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    magicBytes: bytes.subarray(0, 8).toString("hex"),
    encrypted: names.includes("EncryptedPackage"),
    macroDetected: names.some((name) => /vbaProject\.bin$/i.test(name)),
    rejectionCodes,
  };
}

export async function scanUpload(input: FileIngestWorkflowInput): Promise<void> {
  await recordJobProgress(input.jobId, input.jobAttempt, 1, "quarantine_scan", 15, "파일 형식을 확인하고 있습니다.");
  const bytes = await readObjectBytes(input.objectKey);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const base =
    input.fileRole === "previous_report_pdf"
      ? inspectPdf(bytes)
      : await inspectWorkbook(bytes);
  if (sha256 !== input.sha256) base.rejectionCodes.push("CHECKSUM_MISMATCH");
  const malwareStatus = await clamScan(bytes);
  if (malwareStatus === "infected") base.rejectionCodes.push("MALWARE_DETECTED");
  if (malwareStatus === "scan_unavailable" && process.env.NODE_ENV === "production") {
    base.rejectionCodes.push("MALWARE_SCAN_UNAVAILABLE");
  }
  await recordJobProgress(input.jobId, input.jobAttempt, 2, "quarantine_scan", 80, "보안 검사 결과를 반영하고 있습니다.");
  const accepted = base.rejectionCodes.length === 0;
  const payload = {
    supportStatus: accepted ? ("accepted" as const) : ("rejected" as const),
    detectedMediaType: base.detectedMediaType,
    magicBytes: base.magicBytes,
    encrypted: base.encrypted,
    macroDetected: base.macroDetected,
    malwareStatus,
    rejectionCodes: base.rejectionCodes,
    checks: [
      {
        code: "magic_bytes",
        status: base.rejectionCodes.includes("FILE_MAGIC_MISMATCH") ? "failed" : "passed",
      },
      {
        code: "malware",
        status: malwareStatus === "clean" ? "passed" : "failed",
      },
      {
        code: "supported_features",
        status: accepted ? "passed" : "failed",
      },
    ],
    tool: { name: "reflo-file-scan", version: "1.0.0" },
    inspectedAt: new Date().toISOString(),
  };
  await internalPost(
    `/internal/v1/jobs/${input.jobId}/results`,
    createWorkerResultEnvelope({
      attempt: input.jobAttempt,
      sequence: 3,
      inputVersionIds: [input.fileVersionId],
      resultType: "file_scan",
      payload,
      result: {
        entityType: "file_scan",
        entityId: input.jobId,
        version: input.jobAttempt,
      },
      artifacts: [],
      tool: controlWorkerTool,
    }),
  );
}

async function callIsolatedWorker<T>(
  baseUrl: string,
  objectKey: string,
): Promise<T> {
  const downloadUrl = await createWorkerDownloadUrl(objectKey, 10 * 60);
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/inspect`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${workerToken}`,
    },
    body: JSON.stringify({ downloadUrl }),
    signal: Context.current().cancellationSignal,
  });
  if (!response.ok) {
    throw new Error(`Isolated worker ${response.status}: ${(await response.text()).slice(0, 300)}`);
  }
  return (await response.json()) as T;
}

export async function analyzePdf(
  input: FileInspectionWorkflowInput,
): Promise<PdfInspectionResult> {
  await recordJobProgress(input.jobId, input.jobAttempt, 2, "pdf_analysis", 35, "PDF 텍스트 구조를 분석하고 있습니다.");
  return callIsolatedWorker<PdfInspectionResult>(
    process.env.REFLO_PDF_WORKER_URL || "http://127.0.0.1:8091",
    input.pdf.objectKey,
  );
}

export async function analyzeExcel(
  input: FileInspectionWorkflowInput,
): Promise<WorkbookInspectionResult> {
  await recordJobProgress(input.jobId, input.jobAttempt, 3, "excel_analysis", 60, "Excel 수식과 구조를 분석하고 있습니다.");
  return callIsolatedWorker<WorkbookInspectionResult>(
    process.env.REFLO_EXCEL_WORKER_URL || "http://127.0.0.1:8092",
    input.workbook.objectKey,
  );
}

export async function applyAndPublishWorkbook(
  input: WorkbookApplicationWorkflowInput,
): Promise<void> {
  await recordJobProgress(
    input.jobId,
    input.jobAttempt,
    1,
    "applying_validated_values",
    20,
    "승인 Evidence 값을 Workbook 입력 셀에 반영하고 있습니다.",
  );
  const downloadUrl = await createWorkerDownloadUrl(
    input.sourceObjectKey,
    10 * 60,
  );
  const baseUrl =
    process.env.REFLO_EXCEL_WORKER_URL || "http://127.0.0.1:8092";
  const activity = Context.current();
  const heartbeatTimer = setInterval(
    () => activity.heartbeat("excel-worker-request"),
    30_000,
  );
  let response: Response;
  try {
    response = await fetch(`${baseUrl.replace(/\/$/, "")}/validation/apply`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${workerToken}`,
      },
      body: JSON.stringify({
        downloadUrl,
        expectedWorkbookHash: input.sourceWorkbookHash,
        expectedStructureHash: null,
        commands: input.plan.commands.map((command) => ({
          targetId: command.targetId,
          semanticKey: command.semanticKey,
          sheetId:
            command.generatedBridge && command.sheetId === "_REFLO_BRIDGE"
              ? null
              : command.sheetId,
          sheetName: command.sheetName,
          address: command.address,
          valueType: command.valueType,
          afterValue: command.afterValue,
          evidenceIds: command.evidenceIds,
          expectedStructureFingerprint:
            command.expectedStructureFingerprint,
          generatedBridge: command.generatedBridge,
        })),
        outputBindings: input.outputBindings,
      }),
      signal: Context.current().cancellationSignal,
    });
  } finally {
    clearInterval(heartbeatTimer);
  }
  const body = (await response.json()) as
    | WorkbookApplicationWorkerResult
    | {
        error?: {
          code?: string;
          message?: string;
          details?: unknown[];
        };
      };
  if (!response.ok || "error" in body) {
    const error = "error" in body ? body.error : undefined;
    throw new Error(
      `${error?.code ?? "WORKBOOK_APPLICATION_FAILED"}:` +
      `${error?.message ?? "Excel worker failed."}`,
    );
  }
  const result = body as WorkbookApplicationWorkerResult;
  const workbookBytes = Buffer.from(result.workbookBase64, "base64");
  const measuredHash = createHash("sha256")
    .update(workbookBytes)
    .digest("hex");
  if (measuredHash !== result.workbookHash) {
    throw new Error("WORKER_RESULT_HASH_MISMATCH");
  }
  await recordJobProgress(
    input.jobId,
    input.jobAttempt,
    2,
    "validating_workbook",
    75,
    "수식·시트·차트 구조와 재계산 결과를 확인하고 있습니다.",
  );
  const objectKey =
    `projects/${input.projectId}/validation/` +
    `workbook-${input.applicationId}-${result.workbookHash.slice(0, 12)}.xlsx`;
  let stored: { objectVersion: string };
  try {
    stored = await putImmutableObject({
      objectKey,
      body: workbookBytes,
      mediaType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      metadata: {
        project: input.projectId,
        application: input.applicationId,
        sourceSnapshot: input.validationSourceSnapshotId,
      },
    });
  } catch (error) {
    const existing = await readObjectBytes(objectKey).catch(() => null);
    if (
      !existing ||
      createHash("sha256").update(existing).digest("hex") !==
        result.workbookHash
    ) {
      throw error;
    }
    stored = { objectVersion: `sha256:${result.workbookHash}` };
  }
  await internalPost(
    `/internal/v1/workbook-applications/${input.applicationId}/result`,
    {
      attempt: input.jobAttempt,
      payload: {
        result: { ...result, workbookBase64: "" },
        artifact: {
          objectKey,
          objectVersion: stored.objectVersion,
          sha256: result.workbookHash,
          byteSize: workbookBytes.byteLength,
          mediaType:
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          originalFilename: input.sourceFilename,
        },
      },
    },
  );
}

export async function materializeAndPublishReport(
  input: ReportMaterializationWorkflowInput,
): Promise<void> {
  const activity = Context.current();
  await recordJobProgress(
    input.jobId,
    input.jobAttempt,
    1,
    "materializing_report",
    15,
    "승인된 입력 스냅샷으로 보고서 데이터 블록을 생성하고 있습니다.",
  );
  const heartbeatTimer = setInterval(() => {
    try {
      activity.heartbeat({
        phase: "materializing_report",
        progressPercent: 15,
      });
    } catch {
      // The cancellation signal below is the authoritative stop path.
    }
  }, 20_000);
  heartbeatTimer.unref();
  try {
    await executeReportMaterialization({
      materializationRunId: input.materializationRunId,
      jobId: input.jobId,
      attempt: input.jobAttempt,
      projectId: input.projectId,
      sourceSnapshotId: input.sourceSnapshotId,
      sourceFingerprint: input.sourceFingerprint,
      outlineApprovalId: input.outlineApprovalId,
      requestedByUserId: input.requestedByUserId,
      signal: activity.cancellationSignal,
    });
  } finally {
    clearInterval(heartbeatTimer);
  }
}

export async function reportReportMaterializationFailure(
  input: ReportMaterializationWorkflowInput,
  code: string,
  message: string,
): Promise<void> {
  await failReportMaterialization({
    materializationRunId: input.materializationRunId,
    jobId: input.jobId,
    attempt: input.jobAttempt,
    code,
    message,
  });
}

export async function runReportDelivery(
  input: ReportDeliveryWorkflowInput,
): Promise<void> {
  const activity = Context.current();
  await recordJobProgress(
    input.jobId,
    input.jobAttempt,
    1,
    input.operationKind,
    10,
    "보고서 결과물을 생성하고 검증하고 있습니다.",
  );
  if (input.operationKind === "preview") {
    await executeReportPreview({
      projectId: input.projectId,
      userId: input.requestedByUserId,
      reportVersionId: input.reportVersionId,
      previewId: input.operationId,
      jobId: input.jobId,
      jobAttempt: input.jobAttempt,
      sourceSnapshotId: input.sourceSnapshotId,
    });
    return;
  }
  if (input.operationKind === "validation") {
    await executeReportValidation({
      projectId: input.projectId,
      userId: input.requestedByUserId,
      reportVersionId: input.reportVersionId,
      validationRunId: input.operationId,
      jobId: input.jobId,
      jobAttempt: input.jobAttempt,
      sourceSnapshotId: input.sourceSnapshotId,
    });
    return;
  }
  if (input.operationKind === "export") {
    if (!input.validationRunId) {
      throw new Error("REPORT_EXPORT_VALIDATION_MISSING");
    }
    await executeReportExport({
      projectId: input.projectId,
      userId: input.requestedByUserId,
      approvedReportVersionId: input.reportVersionId,
      validationRunId: input.validationRunId,
      artifactTypes: ["pdf", "xlsx"],
      idempotencyKey: `report-delivery:${input.operationId}:${input.jobAttempt}`,
      exportId: input.operationId,
      jobId: input.jobId,
      jobAttempt: input.jobAttempt,
      sourceSnapshotId: input.sourceSnapshotId,
    });
    return;
  }
  activity.heartbeat({
    phase: input.operationKind,
    progressPercent: 10,
  });
  throw new Error(`REPORT_DELIVERY_KIND_NOT_IMPLEMENTED:${input.operationKind}`);
}

export async function reportReportDeliveryFailure(
  input: ReportDeliveryWorkflowInput,
  code: string,
  message: string,
  cancelled: boolean,
): Promise<void> {
  await failReportDelivery({
    projectId: input.projectId,
    operationKind: input.operationKind,
    operationId: input.operationId,
    jobId: input.jobId,
    jobAttempt: input.jobAttempt,
    code,
    message,
    cancelled,
  });
}

export async function inspectAndFinalize(
  input: FileInspectionWorkflowInput,
): Promise<void> {
  await recordJobProgress(
    input.jobId,
    input.jobAttempt,
    1,
    "analysis_started",
    10,
    "PDF와 Excel 상세 분석을 시작합니다.",
  );
  const pdfPromise = callIsolatedWorker<PdfInspectionResult>(
    process.env.REFLO_PDF_WORKER_URL || "http://127.0.0.1:8091",
    input.pdf.objectKey,
  );
  const workbookPromise = callIsolatedWorker<WorkbookInspectionResult>(
    process.env.REFLO_EXCEL_WORKER_URL || "http://127.0.0.1:8092",
    input.workbook.objectKey,
  );
  await recordJobProgress(
    input.jobId,
    input.jobAttempt,
    2,
    "structure_analysis",
    35,
    "PDF 레이아웃과 Excel 계산 모델을 분석하고 있습니다.",
  );
  const marketPricePromise = fetchKrxClosingPrice(input.marketData);
  const [pdf, workbook, marketPrice] = await Promise.all([
    pdfPromise,
    workbookPromise,
    marketPricePromise,
  ]);
  await recordJobProgress(
    input.jobId,
    input.jobAttempt,
    3,
    "mapping",
    80,
    "PDF 슬롯과 Excel 원본 후보를 의미 단위로 매핑하고 있습니다.",
  );
  await finalizeInspection(input, pdf, workbook, marketPrice);
}

export async function generateHypothesisQuestions(
  input: HypothesisGenerationWorkflowInput,
): Promise<void> {
  await recordJobProgress(
    input.jobId,
    input.jobAttempt,
    1,
    "agent_started",
    15,
    "투자 가설을 조사 가능한 질문으로 나누고 있습니다.",
  );
  const timeout = AbortSignal.timeout(input.agentProfile.timeoutSeconds * 1_000);
  const signal = AbortSignal.any([
    timeout,
    Context.current().cancellationSignal,
  ]);
  const response = await fetch(
    `${(process.env.REFLO_LLM_WORKER_URL || "http://127.0.0.1:8093").replace(/\/$/, "")}/hypothesis/questions`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input: {
          company: input.company,
          ticker: input.ticker,
          sector: input.sector,
          targetPeriod: input.targetPeriod,
          asOfDate: input.asOfDate,
          reportType: input.reportType,
          rating: input.rating,
          hypothesis: input.hypothesis,
          knownFacts: input.knownFacts,
          availableSourceTypes: input.availableSourceTypes,
          optionalContext: input.optionalContext,
          inputRevision: input.inputRevision,
          inputResourceVersionId: input.inputResourceVersionId,
          inputDraftVersion: input.inputDraftVersion,
          inputContentHash: input.inputContentHash,
        },
        profile: input.agentProfile,
      }),
      signal,
    },
  );
  if (!response.ok) {
    throw new Error(
      `LLM worker ${response.status}: ${(await response.text()).slice(0, 300)}`,
    );
  }
  await recordJobProgress(
    input.jobId,
    input.jobAttempt,
    2,
    "output_validation",
    80,
    "질문 형식과 조사 가능성을 검증하고 있습니다.",
  );
  const responseBody = (await response.json()) as {
    output?: unknown;
  };
  if (!responseBody.output) {
    throw new Error("LLM worker response is missing output");
  }
  const payload = responseBody.output;
  await internalPost(
    `/internal/v1/jobs/${input.jobId}/results`,
    createWorkerResultEnvelope({
      attempt: input.jobAttempt,
      sequence: 3,
      inputVersionIds: input.sourceInputVersionIds,
      resultType: "hypothesis_questions",
      payload,
      result: {
        entityType: "hypothesis_questions",
        entityId: input.generationId,
        version: input.jobAttempt,
      },
      artifacts: [],
      tool: controlWorkerTool,
    }),
  );
}

async function callResearchAgent(
  input: ResearchValidationWorkflowInput,
  sources: Awaited<ReturnType<typeof collectResearchSources>>["sources"],
): Promise<ResearchCandidate[]> {
  const response = await fetch(
    `${(process.env.REFLO_LLM_WORKER_URL || "http://127.0.0.1:8093").replace(/\/$/, "")}/research/candidates`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input: {
          company: input.companyName,
          ticker: input.ticker,
          targetPeriod: `${input.targetYear}년 ${input.targetQuarter}분기`,
          cutoffAt: input.cutoffAt,
          questions: input.questions,
          excelTargets: input.excelTargets,
          sources,
          approvedPlanResourceVersionId:
            input.approvedPlanResourceVersionId,
        },
        profile: input.researchAgentProfile,
      }),
      signal: AbortSignal.any([
        AbortSignal.timeout(120_000),
        Context.current().cancellationSignal,
      ]),
    },
  );
  if (!response.ok) {
    throw new Error(
      `Research Agent ${response.status}: ${(await response.text()).slice(0, 300)}`,
    );
  }
  const payload = (await response.json()) as {
    candidates?: ResearchCandidate[];
  };
  if (!Array.isArray(payload.candidates)) {
    throw new Error("RESEARCH_AGENT_OUTPUT_INVALID");
  }
  return payload.candidates;
}

async function callNewsSearchAgent(
  input: ResearchValidationWorkflowInput,
): Promise<NewsDiscoveryResult[]> {
  const questions = input.questions
    .filter(
      (question) =>
        question.included && question.sourceBindingIds.includes("NEWS"),
    )
    .map((question) => {
      if (!question.newsSearchPolicy) {
        throw new Error(`NEWS_SEARCH_POLICY_INVALID:${question.questionId}`);
      }
      return {
        questionId: question.questionId,
        text: question.text,
        purpose: question.purpose,
        metrics: question.metrics,
        period: question.period,
        comparison: question.comparison,
        publicationWindows: question.newsSearchPolicy.publicationWindows.map(
          (window) => ({
            startAt: window.startAt,
            endAt: window.endAt,
          }),
        ),
        queryLimit: question.newsSearchPolicy.queryLimit,
        discoverLimit: question.newsSearchPolicy.discoverLimit,
        providerCode: question.newsSearchPolicy.providerCode,
        policyVersion: question.newsSearchPolicy.policyVersion,
      };
    });
  if (questions.length === 0) return [];
  const response = await fetch(
    `${(process.env.REFLO_LLM_WORKER_URL || "http://127.0.0.1:8093").replace(/\/$/, "")}/research/news-search`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input: {
          company: input.companyName,
          ticker: input.ticker,
          industry: input.industry,
          cutoffAt: input.cutoffAt,
          questions,
          approvedPlanResourceVersionId:
            input.approvedPlanResourceVersionId,
        },
        profile: input.researchAgentProfile,
      }),
      signal: AbortSignal.any([
        AbortSignal.timeout(120_000),
        Context.current().cancellationSignal,
      ]),
    },
  );
  if (!response.ok) {
    const code =
      response.status === 429
        ? "NEWS_SEARCH_RATE_LIMITED"
        : "NEWS_SEARCH_PROVIDER_UNAVAILABLE";
    throw new Error(`${code}:${(await response.text()).slice(0, 300)}`);
  }
  const payload = (await response.json()) as {
    results?: NewsDiscoveryResult[];
  };
  if (!Array.isArray(payload.results)) {
    throw new Error("NEWS_QUERY_PLAN_INVALID");
  }
  const questionById = new Map(
    questions.map((question) => [question.questionId, question]),
  );
  const queryIdsByQuestion = new Map<string, Set<string>>();
  const resultCountByQuestion = new Map<string, number>();
  for (const result of payload.results) {
    const question = questionById.get(result.questionId);
    if (
      !question ||
      result.providerCode !== question.providerCode ||
      result.policyVersion !== question.policyVersion ||
      !question.publicationWindows.some(
        (window) =>
          window.startAt === result.publicationWindow?.startAt &&
          window.endAt === result.publicationWindow?.endAt,
      )
    ) {
      throw new Error("NEWS_QUERY_PLAN_INVALID");
    }
    if (
      typeof result.queryId !== "string" ||
      typeof result.queryText !== "string" ||
      typeof result.url !== "string" ||
      !Number.isInteger(result.resultRank)
    ) {
      throw new Error("NEWS_QUERY_PLAN_INVALID");
    }
    const queryIds =
      queryIdsByQuestion.get(result.questionId) ?? new Set<string>();
    queryIds.add(result.queryId);
    queryIdsByQuestion.set(result.questionId, queryIds);
    resultCountByQuestion.set(
      result.questionId,
      (resultCountByQuestion.get(result.questionId) ?? 0) + 1,
    );
  }
  for (const question of questions) {
    const queryCount = queryIdsByQuestion.get(question.questionId)?.size ?? 0;
    const resultCount = resultCountByQuestion.get(question.questionId) ?? 0;
    if (
      (resultCount > 0 && queryCount < 2) ||
      queryCount > question.queryLimit ||
      resultCount > question.discoverLimit
    ) {
      throw new Error("NEWS_QUERY_PLAN_INVALID");
    }
  }
  return payload.results;
}

async function callValidationAgent(
  input: ResearchValidationWorkflowInput,
  sources: Awaited<ReturnType<typeof collectResearchSources>>["sources"],
  candidates: ResearchCandidate[],
): Promise<ResearchCandidate[]> {
  const response = await fetch(
    `${(process.env.REFLO_LLM_WORKER_URL || "http://127.0.0.1:8093").replace(/\/$/, "")}/validation/evidence`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input: {
          company: input.companyName,
          ticker: input.ticker,
          targetPeriod: `${input.targetYear}년 ${input.targetQuarter}분기`,
          cutoffAt: input.cutoffAt,
          sources,
          candidates,
        },
        profile: input.validationAgentProfile,
      }),
      signal: AbortSignal.any([
        AbortSignal.timeout(120_000),
        Context.current().cancellationSignal,
      ]),
    },
  );
  if (!response.ok) {
    throw new Error(
      `Validation Agent ${response.status}: ${(await response.text()).slice(0, 300)}`,
    );
  }
  const payload = (await response.json()) as {
    candidates?: ResearchCandidate[];
  };
  if (!Array.isArray(payload.candidates)) {
    throw new Error("VALIDATION_AGENT_OUTPUT_INVALID");
  }
  return payload.candidates;
}

export async function planNewsSearch(
  input: ResearchValidationWorkflowInput,
): Promise<NewsDiscoveryResult[]> {
  await recordJobProgress(
    input.jobId,
    input.jobAttempt,
    1,
    "preparing",
    10,
    "승인한 계획과 입력 version을 고정하고 있습니다.",
  );
  const hasNews = input.questions.some(
    (question) =>
      question.included && question.sourceBindingIds.includes("NEWS"),
  );
  if (!hasNews) return [];
  if (
    process.env.REFLO_RESEARCH_TEST_FIXTURE === "1" ||
    process.env.REFLO_LLM_TEST_FIXTURE === "1"
  ) {
    return [];
  }
  await recordJobProgress(
    input.jobId,
    input.jobAttempt,
    2,
    "planning_news_search",
    18,
    "Research Agent가 질문별 뉴스 검색어를 계획하고 있습니다.",
  );
  await recordJobProgress(
    input.jobId,
    input.jobAttempt,
    3,
    "searching_news",
    30,
    "설정된 기간 안에서 실제 뉴스 원문을 검색하고 있습니다.",
  );
  return callNewsSearchAgent(input);
}

export async function collectResearchBundle(
  input: ResearchValidationWorkflowInput,
  newsDiscoveryResults: NewsDiscoveryResult[],
): Promise<CollectionBundle> {
  const hasNews = input.questions.some(
    (question) =>
      question.included && question.sourceBindingIds.includes("NEWS"),
  );
  await recordJobProgress(
    input.jobId,
    input.jobAttempt,
    4,
    hasNews ? "capturing_news" : "collecting_code_sources",
    45,
    hasNews
      ? "기사 원문과 발행일을 확인하고 공식 자료를 함께 수집하고 있습니다."
      : "공식 API와 공개 원문을 수집하고 있습니다.",
  );
  return collectResearchSources({
    projectId: input.projectId,
    companyMasterId: input.companyMasterId,
    companyName: input.companyName,
    corpCode: input.corpCode,
    ticker: input.ticker,
    exchange: input.exchange,
    targetYear: input.targetYear,
    targetQuarter: input.targetQuarter,
    cutoffDate: input.cutoffDate,
    cutoffAt: input.cutoffAt,
    questions: input.questions,
    excelTargets: input.excelTargets,
    userUrls: input.userUrls,
    sourceReferences: input.sourceReferences ?? [],
    newsDiscoveryResults,
    cancellationSignal: Context.current().cancellationSignal,
  });
}

export async function extractResearchCandidates(
  input: ResearchValidationWorkflowInput,
  bundle: CollectionBundle,
): Promise<ResearchCandidate[]> {
  await recordJobProgress(
    input.jobId,
    input.jobAttempt,
    5,
    "extracting_candidates",
    65,
    "Research Agent가 원문에서 조사 후보를 구조화하고 있습니다.",
  );
  const researchCandidates =
    bundle.candidates.length > 0
      ? bundle.candidates
      : await callResearchAgent(input, bundle.sources);
  if (researchCandidates.length === 0) {
    throw new Error("RESEARCH_CANDIDATES_EMPTY");
  }
  return researchCandidates;
}

export async function validateAndPublishResearch(
  input: ResearchValidationWorkflowInput,
  bundle: CollectionBundle,
  researchCandidates: ResearchCandidate[],
  newsDiscoveryResults: NewsDiscoveryResult[],
): Promise<void> {
  const startedAt = new Date().toISOString();
  await recordJobProgress(
    input.jobId,
    input.jobAttempt,
    6,
    "validating_evidence",
    85,
    "Validation Agent와 결정적 코드가 원문을 독립 검증하고 있습니다.",
  );
  const agentValidated =
    process.env.REFLO_RESEARCH_TEST_FIXTURE === "1" ||
    process.env.REFLO_LLM_TEST_FIXTURE === "1"
      ? researchCandidates
      : await callValidationAgent(input, bundle.sources, researchCandidates);
  const sourceByKey = new Map(
    bundle.sources.map((source) => [source.sourceKey, source]),
  );
  const evidence: ValidatedEvidence[] = agentValidated.map((candidate) => {
    const source = sourceByKey.get(candidate.sourceKey);
    if (!source) throw new Error("VALIDATION_SOURCE_MISSING");
    return validateEvidenceCandidate(candidate, source, input.cutoffAt);
  });
  if (evidence.length === 0) {
    throw new Error("RESEARCH_EVIDENCE_EMPTY");
  }
  await recordJobProgress(
    input.jobId,
    input.jobAttempt,
    7,
    "publishing_projection",
    95,
    "검증된 근거와 원문 연결을 게시하고 있습니다.",
  );
  const payload = {
      sources: bundle.sources,
      candidates: researchCandidates,
      evidence,
      newsDiscovery: newsDiscoveryResults,
      warnings: bundle.warnings,
      metadata: {
        researchAgentProfile: input.researchAgentProfile.version,
        validationAgentProfile: input.validationAgentProfile.version,
        validationRuleVersion: input.validationRuleVersion,
        startedAt,
        finishedAt: new Date().toISOString(),
      },
    };
  await internalPost(
    `/internal/v1/jobs/${input.jobId}/results`,
    createWorkerResultEnvelope({
      attempt: input.jobAttempt,
      sequence: 8,
      inputVersionIds: input.sourceInputVersionIds,
      resultType: "research_validation",
      payload,
      result: {
        entityType: "research_validation",
        entityId: input.researchRunId,
        version: input.jobAttempt,
      },
      artifacts: [],
      tool: controlWorkerTool,
    }),
  );
}

export async function runResearchValidation(
  input: ResearchValidationWorkflowInput,
): Promise<void> {
  const newsDiscoveryResults = await planNewsSearch(input);
  const bundle = await collectResearchBundle(input, newsDiscoveryResults);
  const researchCandidates = await extractResearchCandidates(input, bundle);
  await validateAndPublishResearch(
    input,
    bundle,
    researchCandidates,
    newsDiscoveryResults,
  );
}

function descriptor(
  role: string,
  objectKey: string,
  bytes: Buffer,
  objectVersion: string,
) {
  return {
    artifactRole: role,
    artifactKind: "analysis" as const,
    objectKey,
    objectVersion,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    byteSize: bytes.byteLength,
    mediaType: "application/json",
  };
}

async function putInspectionArtifact(
  objectKey: string,
  bytes: Buffer,
  options: { reuseExistingOnConflict?: boolean } = {},
): Promise<{ objectVersion: string; bytes: Buffer }> {
  const expectedHash = createHash("sha256").update(bytes).digest("hex");
  try {
    await putImmutableObject({
      objectKey,
      body: bytes,
      mediaType: "application/json",
    });
    return {
      objectVersion: `sha256:${expectedHash}`,
      bytes,
    };
  } catch (error) {
    let existing: Buffer;
    try {
      existing = await readObjectBytes(objectKey);
    } catch {
      throw error;
    }
    const existingHash = createHash("sha256").update(existing).digest("hex");
    if (expectedHash !== existingHash && !options.reuseExistingOnConflict) {
      throw new Error(`IMMUTABLE_ARTIFACT_CONFLICT:${objectKey}`, {
        cause: error,
      });
    }
    return {
      objectVersion: `sha256:${existingHash}`,
      bytes: existing,
    };
  }
}

export async function finalizeInspection(
  input: FileInspectionWorkflowInput,
  pdf: PdfInspectionResult,
  workbook: WorkbookInspectionResult,
  marketPrice: MarketPriceSnapshot,
): Promise<void> {
  const prefix = `immutable/${input.projectId}/file-inspections/${input.inspectionId}`;
  const marketPriceKey = `${prefix}/market-price-snapshot.json`;
  const marketPriceObject = await putInspectionArtifact(
    marketPriceKey,
    Buffer.from(JSON.stringify(marketPrice)),
    { reuseExistingOnConflict: true },
  );
  let stableMarketPrice: MarketPriceSnapshot;
  try {
    stableMarketPrice = JSON.parse(
      marketPriceObject.bytes.toString("utf8"),
    ) as MarketPriceSnapshot;
  } catch (error) {
    throw new Error(`INVALID_MARKET_PRICE_ARTIFACT:${marketPriceKey}`, {
      cause: error,
    });
  }
  const builtMapping =
    pdf.compatible &&
    workbook.compatible &&
    pdf.templateIr &&
    workbook.workbookAnalysis
      ? buildMappingSet(
          pdf.templateIr,
          workbook.workbookAnalysis,
          stableMarketPrice,
        )
      : null;
  const mapping = builtMapping
    ? {
        ...builtMapping.summary,
        mappingSet: builtMapping.mappingSet,
        issues: [
          ...(builtMapping.summary.unmappedRequiredCount > 0
            ? [
                {
                  code: "REQUIRED_MAPPING_UNRESOLVED",
                  severity: "blocking" as const,
                  message: `필수 슬롯 ${builtMapping.summary.unmappedRequiredCount}개의 Excel 원본을 확인해야 합니다.`,
                },
              ]
            : []),
          ...(stableMarketPrice.status === "unavailable"
            ? [
                {
                  code:
                    stableMarketPrice.errorCode ??
                    "KRX_MARKET_PRICE_UNAVAILABLE",
                  severity: "warning" as const,
                  message:
                    stableMarketPrice.errorMessage ??
                    "KRX 기준일 종가를 조회하지 못해 Excel 값을 사용했습니다.",
                },
              ]
            : []),
        ],
      }
    : {
        status: "blocked" as const,
        slotCount: pdf.summary.slotCount ?? 0,
        requiredSlotCount: pdf.summary.requiredSlotCount ?? 0,
        bindingCount: 0,
        confirmedBindingCount: 0,
        unmappedRequiredCount: pdf.summary.requiredSlotCount ?? 0,
        mappingSet: null,
        issues: [
          {
            code: "MAPPING_INPUT_UNAVAILABLE",
            severity: "blocking" as const,
            message: "PDF 또는 Excel 분석이 차단되어 매핑을 생성하지 못했습니다.",
          },
        ],
      };
  const pdfBytes = Buffer.from(JSON.stringify(pdf.templateIr));
  const workbookBytes = Buffer.from(JSON.stringify(workbook.workbookAnalysis));
  const mappingBytes = Buffer.from(JSON.stringify(mapping.mappingSet));
  const marketPriceBytes = marketPriceObject.bytes;
  const [pdfObject, workbookObject, mappingObject] = await Promise.all([
    putInspectionArtifact(`${prefix}/template-ir.json`, pdfBytes),
    putInspectionArtifact(`${prefix}/workbook-analysis.json`, workbookBytes),
    putInspectionArtifact(`${prefix}/mapping-set.json`, mappingBytes),
  ]);
  const pdfArtifact = descriptor(
    "template_ir",
    `${prefix}/template-ir.json`,
    pdfBytes,
    pdfObject.objectVersion,
  );
  const workbookArtifact = descriptor(
    "workbook_analysis",
    `${prefix}/workbook-analysis.json`,
    workbookBytes,
    workbookObject.objectVersion,
  );
  const marketPriceArtifact = descriptor(
    "market_price_snapshot",
    marketPriceKey,
    marketPriceBytes,
    marketPriceObject.objectVersion,
  );
  const mappingArtifact = descriptor(
    "mapping_set",
    `${prefix}/mapping-set.json`,
    mappingBytes,
    mappingObject.objectVersion,
  );
  const payload = {
    pdf: { ...pdf, artifact: pdfArtifact },
    workbook: { ...workbook, artifact: workbookArtifact },
    marketPrice: { ...stableMarketPrice, artifact: marketPriceArtifact },
    mapping: { ...mapping, artifact: mappingArtifact },
  };
  await internalPost(
    `/internal/v1/jobs/${input.jobId}/results`,
    createWorkerResultEnvelope({
      attempt: input.jobAttempt,
      sequence: 5,
      inputVersionIds: [
        input.setupResourceVersionId,
        input.pdf.fileVersionId,
        input.workbook.fileVersionId,
      ],
      resultType: "file_inspection",
      payload,
      result: {
        entityType: "file_inspection",
        entityId: input.inspectionId,
        version: input.jobAttempt,
      },
      artifacts: [
        pdfArtifact,
        workbookArtifact,
        marketPriceArtifact,
        mappingArtifact,
      ],
      tool: controlWorkerTool,
    }),
  );
}

export async function reportFailure(
  jobId: string,
  jobAttempt: number,
  errorCode: string,
  message: string,
  retryable: boolean,
): Promise<void> {
  await internalPost(`/internal/v1/jobs/${jobId}/terminal`, {
    schemaVersion: "1.0.0",
    attempt: jobAttempt,
    terminalStatus: "failed",
    errorCode,
    message,
    retryable,
  });
}

export async function reportWorkbookApplicationFailure(
  applicationId: string,
  attempt: number,
  code: string,
  message: string,
): Promise<void> {
  await internalPost(
    `/internal/v1/workbook-applications/${applicationId}/failure`,
    { attempt, code, message },
  );
}

export async function reportCancellation(
  jobId: string,
  jobAttempt: number,
): Promise<void> {
  await internalPost(`/internal/v1/jobs/${jobId}/progress`, {
    schemaVersion: "1.0.0",
    attempt: jobAttempt,
    sequence: 999999,
    phase: "cancelled",
    progressPercent: 0,
    operationStatus: "cancelled",
    message: "사용자 요청으로 검사를 취소했습니다.",
  });
}
