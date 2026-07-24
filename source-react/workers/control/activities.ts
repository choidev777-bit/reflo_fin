import { createHash } from "node:crypto";
import { connect } from "node:net";
import { Context } from "@temporalio/activity";
import yauzl from "yauzl";
import {
  createWorkerDownloadUrl,
  putImmutableObject,
  readObjectBytes,
} from "../../server/infrastructure/object-storage/s3";
import type {
  FileIngestWorkflowInput,
  FileInspectionWorkflowInput,
  PdfInspectionResult,
  WorkbookInspectionResult,
} from "./types";

const internalApiUrl =
  process.env.REFLO_INTERNAL_API_URL?.replace(/\/$/, "") ||
  "http://127.0.0.1:3000";
const workerToken =
  process.env.REFLO_WORKER_TOKEN?.trim() || "reflo-local-worker-token-change-me";

async function internalPost(path: string, body: unknown): Promise<void> {
  const response = await fetch(`${internalApiUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${workerToken}`,
      "Idempotency-Key": crypto.randomUUID(),
    },
    body: JSON.stringify(body),
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
  await internalPost(`/internal/v1/jobs/${input.jobId}/results`, {
    schemaVersion: "1.0.0",
    attempt: input.jobAttempt,
    sequence: 3,
    resultType: "file_scan",
    payload: {
      supportStatus: accepted ? "accepted" : "rejected",
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
    },
  });
}

async function callIsolatedWorker<T>(
  baseUrl: string,
  objectKey: string,
): Promise<T> {
  const downloadUrl = await createWorkerDownloadUrl(objectKey, 10 * 60);
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/inspect`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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

export async function finalizeInspection(
  input: FileInspectionWorkflowInput,
  pdf: PdfInspectionResult,
  workbook: WorkbookInspectionResult,
): Promise<void> {
  const mapping = {
    status:
      pdf.compatible && workbook.compatible ? ("confirmed" as const) : ("blocked" as const),
    slotCount: pdf.compatible && workbook.compatible ? Math.max(1, Math.min(24, workbook.sheetCount)) : 0,
  };
  const prefix = `immutable/${input.projectId}/file-inspections/${input.inspectionId}`;
  const pdfBytes = Buffer.from(JSON.stringify(pdf));
  const workbookBytes = Buffer.from(JSON.stringify(workbook));
  const mappingBytes = Buffer.from(JSON.stringify(mapping));
  const [pdfObject, workbookObject, mappingObject] = await Promise.all([
    putImmutableObject({
      objectKey: `${prefix}/template-ir.json`,
      body: pdfBytes,
      mediaType: "application/json",
    }),
    putImmutableObject({
      objectKey: `${prefix}/workbook-analysis.json`,
      body: workbookBytes,
      mediaType: "application/json",
    }),
    putImmutableObject({
      objectKey: `${prefix}/mapping-set.json`,
      body: mappingBytes,
      mediaType: "application/json",
    }),
  ]);
  await internalPost(`/internal/v1/jobs/${input.jobId}/results`, {
    schemaVersion: "1.0.0",
    attempt: input.jobAttempt,
    sequence: 5,
    resultType: "file_inspection",
    payload: {
      pdf: {
        ...pdf,
        artifact: descriptor(
          "template_ir",
          `${prefix}/template-ir.json`,
          pdfBytes,
          pdfObject.objectVersion,
        ),
      },
      workbook: {
        ...workbook,
        artifact: descriptor(
          "workbook_analysis",
          `${prefix}/workbook-analysis.json`,
          workbookBytes,
          workbookObject.objectVersion,
        ),
      },
      mapping: {
        ...mapping,
        artifact: descriptor(
          "mapping_set",
          `${prefix}/mapping-set.json`,
          mappingBytes,
          mappingObject.objectVersion,
        ),
      },
    },
  });
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
