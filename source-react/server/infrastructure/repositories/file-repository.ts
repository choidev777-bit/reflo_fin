import { createHash } from "node:crypto";
import { contentHash } from "../../domain/hash";
import { uuidv7 } from "../../domain/ids";
import { processRoute, STAGES } from "../../domain/project";
import { ApiError } from "../../http/api-error";
import type { TransactionClient } from "../database/transaction";
import { withTransaction } from "../database/transaction";
import {
  createUploadUrl,
  deleteObject,
  objectStoreBucket,
  putImmutableObject,
  verifyUploadedObject,
} from "../object-storage/s3";

export type FileRole = "previous_report_pdf" | "analysis_workbook";
export type JobStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancel_requested"
  | "cancelled";

const ROLE_CONFIG: Record<
  FileRole,
  { mediaType: string; maxSizeBytes: number; extension: string }
> = {
  previous_report_pdf: {
    mediaType: "application/pdf",
    maxSizeBytes: 50 * 1024 * 1024,
    extension: ".pdf",
  },
  analysis_workbook: {
    mediaType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    maxSizeBytes: 100 * 1024 * 1024,
    extension: ".xlsx",
  },
};

type OwnedProject = {
  projectId: string;
  name: string;
  rowVersion: number;
  currentStage: string;
};

type IdempotentResult = { status: number; body: unknown };

export type ArtifactDescriptor = {
  artifactRole: string;
  artifactKind: "analysis" | "diagnostic";
  objectKey: string;
  objectVersion: string;
  sha256: string;
  byteSize: number;
  mediaType: string;
};

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

function validateUuid(value: unknown, path: string): string {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    )
  ) {
    throw new ApiError(400, "INVALID_RESOURCE_ID", "요청 대상이 올바르지 않습니다.", {
      details: [{ path, code: "INVALID_ID", message: "대상을 다시 선택해주세요." }],
    });
  }
  return value;
}

function normalizeFileRequest(input: {
  role?: unknown;
  filename?: unknown;
  byteSize?: unknown;
  mediaType?: unknown;
  checksumSha256?: unknown;
}): {
  role: FileRole;
  filename: string;
  byteSize: number;
  mediaType: string;
  checksumSha256: string | null;
} {
  if (
    input.role !== "previous_report_pdf" &&
    input.role !== "analysis_workbook"
  ) {
    throw new ApiError(400, "INVALID_FILE_TYPE", "지원하지 않는 파일 역할입니다.");
  }
  const role = input.role;
  const config = ROLE_CONFIG[role];
  if (typeof input.filename !== "string") {
    throw new ApiError(400, "INVALID_FILE_TYPE", "파일 이름을 확인해주세요.");
  }
  const filename = input.filename.normalize("NFC").trim();
  if (
    filename.length < 1 ||
    filename.length > 255 ||
    /[\\/\u0000]/.test(filename) ||
    !filename.toLowerCase().endsWith(config.extension)
  ) {
    throw new ApiError(
      400,
      "INVALID_FILE_TYPE",
      role === "previous_report_pdf"
        ? "PDF 파일만 업로드할 수 있습니다."
        : "XLSX 파일만 업로드할 수 있습니다.",
    );
  }
  if (
    typeof input.byteSize !== "number" ||
    !Number.isInteger(input.byteSize) ||
    input.byteSize < 1
  ) {
    throw new ApiError(400, "INVALID_FILE_TYPE", "파일 크기를 확인해주세요.");
  }
  if (input.byteSize > config.maxSizeBytes) {
    throw new ApiError(
      413,
      "FILE_TOO_LARGE",
      `파일은 최대 ${config.maxSizeBytes / 1024 / 1024} MiB까지 업로드할 수 있습니다.`,
      { meta: { maxSizeBytes: config.maxSizeBytes } },
    );
  }
  if (input.mediaType !== config.mediaType) {
    throw new ApiError(400, "INVALID_FILE_TYPE", "파일 형식이 역할과 일치하지 않습니다.");
  }
  const checksumSha256 =
    typeof input.checksumSha256 === "string" &&
    /^[a-f0-9]{64}$/.test(input.checksumSha256)
      ? input.checksumSha256
      : null;
  if (input.checksumSha256 != null && !checksumSha256) {
    throw new ApiError(400, "INVALID_FILE_TYPE", "파일 checksum 형식이 올바르지 않습니다.");
  }
  return {
    role,
    filename,
    byteSize: input.byteSize,
    mediaType: input.mediaType,
    checksumSha256,
  };
}

async function getOwnedProject(
  client: TransactionClient,
  projectId: string,
  userId: string,
  lock = false,
): Promise<OwnedProject> {
  const result = await client.query<{
    project_id: string;
    name: string;
    row_version: string;
    current_stage: string;
  }>(
    `SELECT project_id, name, row_version, current_stage
     FROM project
     WHERE project_id = $1
       AND owner_user_id = $2
       AND deleted_at IS NULL
     ${lock ? "FOR UPDATE" : ""}`,
    [projectId, userId],
  );
  const row = result.rows[0];
  if (!row) {
    throw new ApiError(404, "PROJECT_NOT_FOUND", "프로젝트를 찾을 수 없습니다.");
  }
  return {
    projectId: row.project_id,
    name: row.name,
    rowVersion: Number(row.row_version),
    currentStage: row.current_stage,
  };
}

async function assertFilesPrerequisite(
  client: TransactionClient,
  projectId: string,
): Promise<void> {
  const result = await client.query<{ stage_status: string }>(
    `SELECT stage_status
     FROM project_stage_state
     WHERE project_id = $1 AND stage_key = 'setup'`,
    [projectId],
  );
  if (result.rows[0]?.stage_status !== "completed") {
    throw new ApiError(
      409,
      "FILES_PREREQUISITE_INCOMPLETE",
      "프로젝트 설정을 먼저 완료해 주세요.",
      { meta: { requiredStage: "setup", resumeRoute: processRoute(projectId, "setup") } },
    );
  }
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
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
    `${input.userId}\u001f${input.operation}\u001f${input.projectId}\u001f${input.key}`,
  ]);
  const result = await client.query<{
    request_hash: string;
    response_status: number;
    response_json: unknown;
  }>(
    `SELECT request_hash, response_status, response_json
     FROM idempotency_record
     WHERE user_id = $1
       AND operation = $2
       AND project_id = $3
       AND idempotency_key = $4
       AND expires_at > now()
     ORDER BY created_at DESC
     LIMIT 1`,
    [input.userId, input.operation, input.projectId, input.key],
  );
  const row = result.rows[0];
  if (!row) return null;
  if (row.request_hash.trim() !== input.requestHash) {
    throw new ApiError(
      409,
      "IDEMPOTENCY_CONFLICT",
      "같은 요청 식별자가 다른 작업에 사용되었습니다.",
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
    expiresIn?: string;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO idempotency_record (
      idempotency_id, user_id, operation, project_id, idempotency_key,
      request_hash, response_status, response_json, expires_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, now() + $9::interval)`,
    [
      uuidv7(),
      input.userId,
      input.operation,
      input.projectId,
      input.key,
      input.requestHash,
      input.status,
      JSON.stringify(input.body),
      input.expiresIn ?? "24 hours",
    ],
  );
}

export async function createFileUploadSession(input: {
  projectId: string;
  userId: string;
  idempotencyKey: string | null;
  request: {
    role?: unknown;
    filename?: unknown;
    byteSize?: unknown;
    mediaType?: unknown;
    checksumSha256?: unknown;
  };
}): Promise<IdempotentResult> {
  const request = normalizeFileRequest(input.request);
  const key = validateIdempotencyKey(input.idempotencyKey);
  const requestHash = contentHash(request);
  const uploadId = uuidv7();
  const objectKey = `quarantine/${input.projectId}/${uploadId}`;
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
  const upload = await createUploadUrl({
    objectKey,
    mediaType: request.mediaType,
    filename: request.filename,
    checksumSha256: request.checksumSha256,
    expiresInSeconds: 15 * 60,
  });

  return withTransaction(async (client) => {
    const replay = await idempotentReplay(client, {
      userId: input.userId,
      operation: "file.upload.create",
      projectId: input.projectId,
      key,
      requestHash,
    });
    if (replay) return replay;
    await getOwnedProject(client, input.projectId, input.userId);
    await assertFilesPrerequisite(client, input.projectId);
    await client.query(
      `INSERT INTO upload_session (
        upload_session_id, project_id, requested_by_user_id, upload_role,
        quarantine_object_key, expected_media_types, max_byte_size,
        declared_byte_size, client_filename, expected_sha256, expires_at
      ) VALUES ($1, $2, $3, $4, $5, ARRAY[$6], $7, $8, $9, $10, $11)`,
      [
        uploadId,
        input.projectId,
        input.userId,
        request.role,
        objectKey,
        request.mediaType,
        ROLE_CONFIG[request.role].maxSizeBytes,
        request.byteSize,
        request.filename,
        request.checksumSha256,
        expiresAt,
      ],
    );
    const body = {
      uploadId,
      uploadUrl: upload.uploadUrl,
      method: "PUT",
      headers: upload.headers,
      expiresAt: expiresAt.toISOString(),
      maxSizeBytes: ROLE_CONFIG[request.role].maxSizeBytes,
    };
    await storeIdempotency(client, {
      userId: input.userId,
      operation: "file.upload.create",
      projectId: input.projectId,
      key,
      requestHash,
      status: 201,
      body,
      expiresIn: "15 minutes",
    });
    return { status: 201, body };
  });
}

async function latestResourceVersion(
  client: TransactionClient,
  projectId: string,
  resourceKind: string,
  resourceKey: string,
): Promise<{ resourceId: string; versionNo: number } | null> {
  const result = await client.query<{ resource_id: string; version_no: string }>(
    `SELECT vr.resource_id, COALESCE(MAX(rv.version_no), 0) AS version_no
     FROM versioned_resource vr
     LEFT JOIN resource_version rv ON rv.resource_id = vr.resource_id
     WHERE vr.project_id = $1 AND vr.resource_kind = $2 AND vr.resource_key = $3
     GROUP BY vr.resource_id`,
    [projectId, resourceKind, resourceKey],
  );
  const row = result.rows[0];
  return row ? { resourceId: row.resource_id, versionNo: Number(row.version_no) } : null;
}

async function ensureResource(
  client: TransactionClient,
  projectId: string,
  resourceKind: string,
  resourceKey: string,
): Promise<{ resourceId: string; versionNo: number }> {
  const existing = await latestResourceVersion(
    client,
    projectId,
    resourceKind,
    resourceKey,
  );
  if (existing) return existing;
  const resourceId = uuidv7();
  await client.query(
    `INSERT INTO versioned_resource (resource_id, project_id, resource_kind, resource_key)
     VALUES ($1, $2, $3, $4)`,
    [resourceId, projectId, resourceKind, resourceKey],
  );
  return { resourceId, versionNo: 0 };
}

async function rejectUpload(
  projectId: string,
  userId: string,
  uploadId: string,
  errorCode: string,
): Promise<void> {
  await withTransaction(async (client) => {
    await getOwnedProject(client, projectId, userId);
    await client.query(
      `UPDATE upload_session
       SET upload_status = 'rejected', error_code = $4, completed_at = now()
       WHERE upload_session_id = $1 AND project_id = $2 AND requested_by_user_id = $3`,
      [uploadId, projectId, userId, errorCode],
    );
  });
}

export async function completeFileUpload(input: {
  projectId: string;
  uploadId: string;
  userId: string;
  idempotencyKey: string | null;
  checksumSha256?: unknown;
}): Promise<IdempotentResult> {
  const key = validateIdempotencyKey(input.idempotencyKey);
  const checksumSha256 =
    typeof input.checksumSha256 === "string" &&
    /^[a-f0-9]{64}$/.test(input.checksumSha256)
      ? input.checksumSha256
      : null;
  if (input.checksumSha256 != null && !checksumSha256) {
    throw new ApiError(400, "CHECKSUM_MISMATCH", "checksum 형식이 올바르지 않습니다.");
  }
  const session = await withTransaction(async (client) => {
    await getOwnedProject(client, input.projectId, input.userId);
    const result = await client.query<{
      upload_role: FileRole;
      quarantine_object_key: string;
      declared_byte_size: string;
      expected_media_types: string[];
      client_filename: string;
      expected_sha256: string | null;
      upload_status: string;
      expires_at: Date;
      file_version_id: string | null;
    }>(
      `SELECT upload_role, quarantine_object_key, declared_byte_size,
         expected_media_types, client_filename, expected_sha256, upload_status,
         expires_at, file_version_id
       FROM upload_session
       WHERE upload_session_id = $1 AND project_id = $2
       FOR UPDATE`,
      [input.uploadId, input.projectId],
    );
    const row = result.rows[0];
    if (!row) {
      throw new ApiError(404, "UPLOAD_NOT_FOUND", "업로드를 찾을 수 없습니다.");
    }
    if (row.expires_at.getTime() <= Date.now() && row.upload_status === "uploading") {
      await client.query(
        `UPDATE upload_session SET upload_status = 'rejected', error_code = 'UPLOAD_EXPIRED'
         WHERE upload_session_id = $1`,
        [input.uploadId],
      );
      throw new ApiError(410, "UPLOAD_EXPIRED", "업로드 시간이 만료되었습니다.");
    }
    return row;
  });

  const requestHash = contentHash({
    uploadId: input.uploadId,
    checksumSha256: checksumSha256 ?? session.expected_sha256,
  });
  if (["scanning", "accepted"].includes(session.upload_status)) {
    const body = await uploadStatus(input.projectId, input.uploadId, input.userId);
    return { status: 202, body };
  }
  if (session.upload_status !== "uploading" && session.upload_status !== "verifying") {
    throw new ApiError(
      409,
      "UPLOAD_ALREADY_COMMITTED",
      "이미 종료된 업로드입니다.",
    );
  }

  let verified: Awaited<ReturnType<typeof verifyUploadedObject>>;
  try {
    verified = await verifyUploadedObject({
      objectKey: session.quarantine_object_key,
      expectedByteSize: Number(session.declared_byte_size),
      expectedMediaType: session.expected_media_types[0],
      expectedSha256: checksumSha256 ?? session.expected_sha256,
    });
  } catch (error) {
    const code =
      error instanceof Error && error.message === "OBJECT_SIZE_MISMATCH"
        ? "FILE_SIZE_MISMATCH"
        : error instanceof Error && error.message === "OBJECT_MEDIA_TYPE_MISMATCH"
          ? "INVALID_FILE_TYPE"
          : "CHECKSUM_MISMATCH";
    await rejectUpload(input.projectId, input.userId, input.uploadId, code);
    throw new ApiError(
      code === "FILE_SIZE_MISMATCH" ? 400 : 422,
      code,
      code === "CHECKSUM_MISMATCH"
        ? "업로드한 파일의 checksum이 일치하지 않습니다."
        : "업로드한 파일 정보가 요청과 일치하지 않습니다.",
    );
  }

  return withTransaction(async (client) => {
    const replay = await idempotentReplay(client, {
      userId: input.userId,
      operation: "file.upload.complete",
      projectId: input.projectId,
      key,
      requestHash,
    });
    if (replay) return replay;
    await getOwnedProject(client, input.projectId, input.userId, true);
    const locked = await client.query<{
      upload_status: string;
      upload_role: FileRole;
      client_filename: string;
      quarantine_object_key: string;
    }>(
      `SELECT upload_status, upload_role, client_filename, quarantine_object_key
       FROM upload_session
       WHERE upload_session_id = $1 AND project_id = $2
       FOR UPDATE`,
      [input.uploadId, input.projectId],
    );
    const row = locked.rows[0];
    if (!row) {
      throw new ApiError(404, "UPLOAD_NOT_FOUND", "업로드를 찾을 수 없습니다.");
    }
    if (row.upload_status !== "uploading" && row.upload_status !== "verifying") {
      const body = await uploadStatusWithClient(client, input.projectId, input.uploadId);
      return { status: 202, body };
    }

    const artifactId = uuidv7();
    const fileVersionId = uuidv7();
    const jobId = uuidv7();
    const commandId = uuidv7();
    const resource = await ensureResource(
      client,
      input.projectId,
      "project_file",
      row.upload_role,
    );
    const versionNo = resource.versionNo + 1;
    const fingerprint = contentHash({
      role: row.upload_role,
      sha256: verified.sha256,
      byteSize: verified.byteSize,
    });
    await client.query(
      `INSERT INTO artifact (
        artifact_id, project_id, artifact_kind, storage_status, bucket_name,
        object_key, object_version, sha256, byte_size, media_type,
        original_filename, retention_class, created_by_actor_type
      ) VALUES ($1, $2, 'upload', 'quarantined', $3, $4, $5, $6, $7, $8, $9, 'project', 'user')`,
      [
        artifactId,
        input.projectId,
        objectStoreBucket(),
        row.quarantine_object_key,
        verified.objectVersion,
        verified.sha256,
        verified.byteSize,
        verified.mediaType,
        row.client_filename,
      ],
    );
    await client.query(
      `INSERT INTO resource_version (
        resource_version_id, resource_id, version_no, lifecycle_status,
        input_fingerprint, content_hash, created_by_user_id
      ) VALUES ($1, $2, $3, 'draft', $4, $4, $5)`,
      [fileVersionId, resource.resourceId, versionNo, fingerprint, input.userId],
    );
    await client.query(
      `INSERT INTO workflow_job (
        job_id, project_id, job_type, temporal_workflow_id, input_fingerprint,
        requested_by_user_id, current_phase
      ) VALUES ($1, $2, 'file_ingest', $3, $4, $5, 'quarantine_scan')`,
      [jobId, input.projectId, `reflo:${jobId}`, fingerprint, input.userId],
    );
    await client.query(
      `INSERT INTO project_file_version (
        resource_version_id, artifact_id, file_role, inspection_status,
        detected_filename, detected_media_type, inspection_job_id
      ) VALUES ($1, $2, $3, 'scanning', $4, $5, $6)`,
      [
        fileVersionId,
        artifactId,
        row.upload_role,
        row.client_filename,
        verified.mediaType,
        jobId,
      ],
    );
    await client.query(
      `INSERT INTO resource_artifact (resource_version_id, artifact_role, artifact_id)
       VALUES ($1, 'source', $2)`,
      [fileVersionId, artifactId],
    );
    await client.query(
      `INSERT INTO workflow_job_input (job_id, input_role, resource_version_id)
       VALUES ($1, 'uploaded_file', $2)`,
      [jobId, fileVersionId],
    );
    const payload = {
      workflowType: "fileIngestWorkflow",
      jobId,
      jobAttempt: 1,
      projectId: input.projectId,
      uploadId: input.uploadId,
      fileVersionId,
      artifactId,
      fileRole: row.upload_role,
      objectKey: row.quarantine_object_key,
      sha256: verified.sha256,
      byteSize: verified.byteSize,
      declaredMediaType: verified.mediaType,
    };
    await client.query(
      `INSERT INTO outbox_event (
        outbox_event_id, job_id, command_type, command_id, payload_json
      ) VALUES ($1, $2, 'start_workflow', $3, $4::jsonb)`,
      [uuidv7(), jobId, commandId, JSON.stringify(payload)],
    );
    await client.query(
      `UPDATE upload_session
       SET upload_status = 'scanning', artifact_id = $2, file_version_id = $3,
           completed_at = now()
       WHERE upload_session_id = $1`,
      [input.uploadId, artifactId, fileVersionId],
    );
    const body = {
      uploadId: input.uploadId,
      status: "scanning",
      fileVersion: {
        fileVersionId,
        role: row.upload_role,
        fileName: row.client_filename,
        mediaType: verified.mediaType,
        sizeBytes: verified.byteSize,
        status: "scanning",
        version: versionNo,
      },
      job: {
        jobId,
        operationStatus: "queued",
        phase: "quarantine_scan",
        progressPercent: 0,
        retryable: false,
        pollUrl: `/api/projects/${input.projectId}/process/files`,
        acceptedAt: new Date().toISOString(),
      },
    };
    await storeIdempotency(client, {
      userId: input.userId,
      operation: "file.upload.complete",
      projectId: input.projectId,
      key,
      requestHash,
      status: 202,
      body,
    });
    return { status: 202, body };
  });
}

async function uploadStatusWithClient(
  client: TransactionClient,
  projectId: string,
  uploadId: string,
): Promise<unknown> {
  const result = await client.query<{
    upload_status: string;
    file_version_id: string | null;
    upload_role: FileRole;
    client_filename: string;
    declared_byte_size: string;
    detected_media_type: string | null;
    version_no: string | null;
    inspection_job_id: string | null;
    operation_status: JobStatus | null;
    current_phase: string | null;
    progress_percent: number | null;
    retryable: boolean | null;
  }>(
    `SELECT us.upload_status, us.file_version_id, us.upload_role, us.client_filename,
       us.declared_byte_size, pf.detected_media_type, rv.version_no,
       pf.inspection_job_id, wj.operation_status, wj.current_phase,
       wj.progress_percent, wj.retryable
     FROM upload_session us
     LEFT JOIN project_file_version pf ON pf.resource_version_id = us.file_version_id
     LEFT JOIN resource_version rv ON rv.resource_version_id = us.file_version_id
     LEFT JOIN workflow_job wj ON wj.job_id = pf.inspection_job_id
     WHERE us.upload_session_id = $1 AND us.project_id = $2`,
    [uploadId, projectId],
  );
  const row = result.rows[0];
  if (!row) throw new ApiError(404, "UPLOAD_NOT_FOUND", "업로드를 찾을 수 없습니다.");
  const publicStatus =
    row.upload_status === "accepted"
      ? "accepted"
      : row.upload_status === "rejected"
        ? "rejected"
        : "scanning";
  return {
    uploadId,
    status: publicStatus,
    fileVersion: row.file_version_id
      ? {
          fileVersionId: row.file_version_id,
          role: row.upload_role,
          fileName: row.client_filename,
          mediaType: row.detected_media_type,
          sizeBytes: Number(row.declared_byte_size),
          status: publicStatus,
          version: Number(row.version_no),
        }
      : null,
    job: row.inspection_job_id
      ? {
          jobId: row.inspection_job_id,
          operationStatus: row.operation_status,
          phase: row.current_phase,
          progressPercent: row.progress_percent,
          retryable: row.retryable,
          pollUrl: `/api/projects/${projectId}/process/files`,
        }
      : null,
  };
}

export async function uploadStatus(
  projectId: string,
  uploadId: string,
  userId: string,
): Promise<unknown> {
  return withTransaction(async (client) => {
    await getOwnedProject(client, projectId, userId);
    return uploadStatusWithClient(client, projectId, uploadId);
  });
}

export async function cancelFileUpload(input: {
  projectId: string;
  uploadId: string;
  userId: string;
  idempotencyKey: string | null;
}): Promise<void> {
  validateIdempotencyKey(input.idempotencyKey);
  const objectKey = await withTransaction(async (client) => {
    await getOwnedProject(client, input.projectId, input.userId);
    const result = await client.query<{
      quarantine_object_key: string;
      upload_status: string;
    }>(
      `SELECT quarantine_object_key, upload_status
       FROM upload_session
       WHERE upload_session_id = $1 AND project_id = $2
       FOR UPDATE`,
      [input.uploadId, input.projectId],
    );
    const row = result.rows[0];
    if (!row) throw new ApiError(404, "UPLOAD_NOT_FOUND", "업로드를 찾을 수 없습니다.");
    if (!["uploading", "verifying"].includes(row.upload_status)) {
      throw new ApiError(
        409,
        "UPLOAD_ALREADY_COMMITTED",
        "검사가 시작된 업로드는 취소할 수 없습니다.",
      );
    }
    await client.query(
      `UPDATE upload_session
       SET upload_status = 'cancelled', completed_at = now()
       WHERE upload_session_id = $1`,
      [input.uploadId],
    );
    return row.quarantine_object_key;
  });
  await deleteObject(objectKey).catch(() => undefined);
}

type FileSummaryRow = {
  resource_version_id: string;
  file_role: FileRole;
  detected_filename: string;
  detected_media_type: string | null;
  inspection_status: string;
  byte_size: string;
  version_no: string;
};

function fileSummary(row: FileSummaryRow | undefined) {
  if (!row) return null;
  return {
    fileVersionId: row.resource_version_id,
    role: row.file_role,
    fileName: row.detected_filename,
    mediaType: row.detected_media_type,
    sizeBytes: Number(row.byte_size),
    status: row.inspection_status,
    version: Number(row.version_no),
  };
}

async function inspectionProjection(
  client: TransactionClient,
  projectId: string,
  inspectionId?: string,
): Promise<unknown | null> {
  const result = await client.query<{
    inspection_id: string;
    job_id: string;
    operation_status: JobStatus;
    validity_status: "current" | "obsolete";
    current_phase: string | null;
    progress_percent: number;
    progress_mode: "determinate" | "indeterminate";
    heartbeat_at: Date | null;
    retryable: boolean;
    started_at: Date | null;
    finished_at: Date | null;
    error_code: string | null;
    error_summary: string | null;
    outcome: "passed" | "blocked" | "failed" | null;
    issues_json: unknown;
    mapping_set_resource_version_id: string | null;
    template_version_no: string | null;
    workbook_version_no: string | null;
    mapping_set_version_no: string | null;
    mapping_status: string;
    attempt: number;
    pdf_page_count: number | null;
    pdf_block_count: number | null;
    pdf_slot_count: number | null;
    pdf_object_count: number | null;
    pdf_font_count: number | null;
    pdf_image_count: number | null;
    pdf_table_count: number | null;
    pdf_chart_count: number | null;
    pdf_warning_count: number | null;
    workbook_sheet_count: number | null;
    workbook_hidden_sheet_count: number | null;
    workbook_used_cell_count: string | null;
    workbook_formula_count: number | null;
    workbook_editable_cell_count: number | null;
    workbook_merged_range_count: number | null;
    workbook_chart_count: number | null;
    workbook_table_count: number | null;
    workbook_external_link_count: number | null;
    workbook_named_range_count: number | null;
    mapping_binding_count: number | null;
    mapping_required_slot_count: number | null;
    mapping_confirmed_binding_count: number | null;
    mapping_unmapped_required_count: number | null;
  }>(
    `SELECT fi.inspection_id, fi.job_id, wj.operation_status,
       wj.validity_status, wj.current_phase, wj.progress_percent,
       wj.progress_mode, wj.heartbeat_at, wj.retryable, wj.started_at,
       wj.finished_at, wj.error_code, wj.error_summary, wj.attempt,
       fi.outcome, fi.issues_json, fi.mapping_set_resource_version_id,
       fi.template_version_no, fi.workbook_version_no,
       fi.mapping_set_version_no, fi.mapping_status,
       tiv.page_count AS pdf_page_count,
       tiv.block_count AS pdf_block_count,
       tiv.slot_count AS pdf_slot_count,
       tiv.object_count AS pdf_object_count,
       tiv.font_count AS pdf_font_count,
       tiv.image_count AS pdf_image_count,
       tiv.table_count AS pdf_table_count,
       tiv.chart_count AS pdf_chart_count,
       tiv.warning_count AS pdf_warning_count,
       wv.sheet_count AS workbook_sheet_count,
       wv.hidden_sheet_count AS workbook_hidden_sheet_count,
       wv.used_cell_count AS workbook_used_cell_count,
       wv.formula_count AS workbook_formula_count,
       wv.editable_cell_count AS workbook_editable_cell_count,
       wv.merged_range_count AS workbook_merged_range_count,
       wv.chart_count AS workbook_chart_count,
       wv.table_count AS workbook_table_count,
       wv.external_link_count AS workbook_external_link_count,
       wv.named_range_count AS workbook_named_range_count,
       msv.binding_count AS mapping_binding_count,
       msv.required_slot_count AS mapping_required_slot_count,
       msv.confirmed_binding_count AS mapping_confirmed_binding_count,
       msv.unmapped_required_count AS mapping_unmapped_required_count
     FROM file_inspection fi
     JOIN workflow_job wj ON wj.job_id = fi.job_id
     LEFT JOIN template_ir_version tiv
       ON tiv.resource_version_id = fi.template_resource_version_id
     LEFT JOIN workbook_version wv
       ON wv.resource_version_id = fi.workbook_resource_version_id
     LEFT JOIN mapping_set_version msv
       ON msv.resource_version_id = fi.mapping_set_resource_version_id
     WHERE fi.project_id = $1
       AND ($2::uuid IS NULL OR fi.inspection_id = $2)
     ORDER BY fi.created_at DESC
     LIMIT 1`,
    [projectId, inspectionId ?? null],
  );
  const row = result.rows[0];
  if (!row) return null;
  const mappingRows = row.mapping_set_resource_version_id
    ? await client.query<{
        mapping_entry_id: string;
        slot_id: string;
        semantic_metric: string;
        binding_kind: "scalar" | "table" | "chart";
        value_type: string;
        required: boolean;
        mapping_status: "suggested" | "confirmed" | "unmapped" | "invalid";
        selected_candidate_id: string | null;
        confidence: string | null;
        source_json: unknown;
        mapping_candidate_id: string | null;
        source_type: "cell" | "range" | "chart" | "market_data" | null;
        sheet_id: string | null;
        sheet_name: string | null;
        address: string | null;
        label: string | null;
        score: string | null;
        reason_codes: string[] | null;
        candidate_source_json: unknown;
      }>(
        `SELECT me.mapping_entry_id, me.slot_id, me.semantic_metric,
           me.binding_kind, me.value_type, me.required, me.mapping_status,
           me.selected_candidate_id, me.confidence, me.source_json,
           mc.mapping_candidate_id, mc.source_type, mc.sheet_id, mc.sheet_name,
           mc.address, mc.label, mc.score, mc.reason_codes,
           mc.source_json AS candidate_source_json
         FROM mapping_entry me
         LEFT JOIN mapping_candidate mc
           ON mc.mapping_entry_id = me.mapping_entry_id
         WHERE me.mapping_set_version_id = $1
         ORDER BY me.required DESC, me.semantic_metric, mc.candidate_order`,
        [row.mapping_set_resource_version_id],
      )
    : null;
  const mappingEntries = new Map<
    string,
    {
      entryId: string;
      slotId: string;
      metric: string;
      kind: "scalar" | "table" | "chart";
      valueType: string;
      required: boolean;
      status: "suggested" | "confirmed" | "unmapped" | "invalid";
      confidence: number | null;
      source: unknown;
      selectedCandidateId: string | null;
      candidates: Array<{
        candidateId: string;
        sourceType: "cell" | "range" | "chart" | "market_data";
        sheetId: string;
        sheetName: string;
        address: string;
        label: string | null;
        score: number;
        reasonCodes: string[];
        source: unknown;
        selected: boolean;
      }>;
    }
  >();
  for (const item of mappingRows?.rows ?? []) {
    let entry = mappingEntries.get(item.mapping_entry_id);
    if (!entry) {
      entry = {
        entryId: item.mapping_entry_id,
        slotId: item.slot_id,
        metric: item.semantic_metric,
        kind: item.binding_kind,
        valueType: item.value_type,
        required: item.required,
        status: item.mapping_status,
        confidence: item.confidence == null ? null : Number(item.confidence),
        source: item.source_json,
        selectedCandidateId: item.selected_candidate_id,
        candidates: [],
      };
      mappingEntries.set(item.mapping_entry_id, entry);
    }
    if (
      item.mapping_candidate_id &&
      item.source_type &&
      item.sheet_id &&
      item.sheet_name &&
      item.address &&
      item.score != null
    ) {
      entry.candidates.push({
        candidateId: item.mapping_candidate_id,
        sourceType: item.source_type,
        sheetId: item.sheet_id,
        sheetName: item.sheet_name,
        address: item.address,
        label: item.label,
        score: Number(item.score),
        reasonCodes: item.reason_codes ?? [],
        source: item.candidate_source_json,
        selected: item.mapping_candidate_id === item.selected_candidate_id,
      });
    }
  }
  return {
    inspectionId: row.inspection_id,
    jobId: row.job_id,
    jobType: "file_inspection",
    operationStatus: row.operation_status,
    validity: row.validity_status,
    phase: row.current_phase,
    progressMode: row.progress_mode,
    progressPercent: row.progress_percent,
    heartbeatAt: row.heartbeat_at?.toISOString() ?? null,
    retryable: row.retryable,
    attempt: row.attempt,
    startedAt: row.started_at?.toISOString() ?? null,
    finishedAt: row.finished_at?.toISOString() ?? null,
    outcome: row.outcome,
    issues: row.issues_json,
    mappingSet: row.mapping_set_resource_version_id
      ? {
          versionId: row.mapping_set_resource_version_id,
          version: Number(row.mapping_set_version_no),
          status: row.mapping_status,
          summary: {
            bindingCount: row.mapping_binding_count ?? 0,
            requiredSlotCount: row.mapping_required_slot_count ?? 0,
            confirmedBindingCount: row.mapping_confirmed_binding_count ?? 0,
            unmappedRequiredCount: row.mapping_unmapped_required_count ?? 0,
          },
          entries: [...mappingEntries.values()],
        }
      : null,
    analysis: row.pdf_page_count
      ? {
          pdf: {
            pageCount: row.pdf_page_count,
            blockCount: row.pdf_block_count ?? 0,
            slotCount: row.pdf_slot_count ?? 0,
            objectCount: row.pdf_object_count ?? 0,
            fontCount: row.pdf_font_count ?? 0,
            imageCount: row.pdf_image_count ?? 0,
            tableCount: row.pdf_table_count ?? 0,
            chartCount: row.pdf_chart_count ?? 0,
            warningCount: row.pdf_warning_count ?? 0,
          },
          workbook: {
            sheetCount: row.workbook_sheet_count ?? 0,
            hiddenSheetCount: row.workbook_hidden_sheet_count ?? 0,
            usedCellCount: Number(row.workbook_used_cell_count ?? 0),
            formulaCount: row.workbook_formula_count ?? 0,
            editableCellCount: row.workbook_editable_cell_count ?? 0,
            mergedRangeCount: row.workbook_merged_range_count ?? 0,
            chartCount: row.workbook_chart_count ?? 0,
            tableCount: row.workbook_table_count ?? 0,
            externalLinkCount: row.workbook_external_link_count ?? 0,
            namedRangeCount: row.workbook_named_range_count ?? 0,
          },
        }
      : null,
    resultVersions:
      row.template_version_no &&
      row.workbook_version_no &&
      row.mapping_set_version_no
        ? {
            template: Number(row.template_version_no),
            workbook: Number(row.workbook_version_no),
            mappingSet: Number(row.mapping_set_version_no),
          }
        : null,
    error: row.error_code
      ? {
          code: row.error_code,
          message: row.error_summary,
          retryable: row.retryable,
        }
      : null,
    links: {
      self: `/api/projects/${projectId}/file-inspections/${row.inspection_id}`,
    },
  };
}

export async function getFilesWorkspace(
  projectId: string,
  userId: string,
): Promise<unknown> {
  return withTransaction(async (client) => {
    const project = await getOwnedProject(client, projectId, userId);
    await assertFilesPrerequisite(client, projectId);
    const setup = await client.query<{
      company_name: string;
      ticker: string;
      target_year: number;
      target_quarter: number;
      cutoff_date: string;
    }>(
      `SELECT cm.company_name, cm.ticker, psv.target_year, psv.target_quarter,
         psv.cutoff_date::text
       FROM versioned_resource vr
       JOIN resource_version rv ON rv.resource_id = vr.resource_id
       JOIN project_setup_version psv ON psv.resource_version_id = rv.resource_version_id
       JOIN company_master cm ON cm.company_master_id = psv.company_master_id
       WHERE vr.project_id = $1 AND vr.resource_kind = 'project_setup'
         AND psv.completion_status = 'complete'
       ORDER BY rv.version_no DESC LIMIT 1`,
      [projectId],
    );
    const files = await client.query<FileSummaryRow>(
      `SELECT DISTINCT ON (pf.file_role)
         pf.resource_version_id, pf.file_role, pf.detected_filename,
         pf.detected_media_type, pf.inspection_status, a.byte_size, rv.version_no
       FROM project_file_version pf
       JOIN resource_version rv ON rv.resource_version_id = pf.resource_version_id
       JOIN versioned_resource vr ON vr.resource_id = rv.resource_id
       JOIN artifact a ON a.artifact_id = pf.artifact_id
       WHERE vr.project_id = $1
       ORDER BY pf.file_role, rv.version_no DESC`,
      [projectId],
    );
    const latest = new Map(files.rows.map((row) => [row.file_role, row]));
    const setupRow = setup.rows[0];
    const stageResult = await client.query<{
      stage_key: string;
      stage_status: string;
    }>(
      `SELECT stage_key, stage_status
       FROM project_stage_state
       WHERE project_id = $1
       ORDER BY stage_order`,
      [projectId],
    );
    const stageStatus = new Map(
      stageResult.rows.map((row) => [row.stage_key, row.stage_status]),
    );
    const stageStates = STAGES.map((stage) => ({
      stageKey: stage.key,
      status: stageStatus.get(stage.key) ?? "blocked",
      route: processRoute(projectId, stage.key),
    }));
    return {
      projectId,
      projectVersion: project.rowVersion,
      project: {
        name: project.name,
        company: setupRow
          ? {
              name: setupRow.company_name,
              ticker: setupRow.ticker,
              targetPeriod: {
                year: setupRow.target_year,
                quarter: setupRow.target_quarter,
              },
              cutoffDate: setupRow.cutoff_date,
            }
          : null,
      },
      slots: (Object.keys(ROLE_CONFIG) as FileRole[]).map((role) => {
        const current = fileSummary(latest.get(role));
        return {
          role,
          required: true,
          status:
            current?.status === "accepted"
              ? "ready"
              : current?.status === "scanning"
                ? "scanning"
                : current?.status === "rejected"
                  ? "rejected"
                  : "empty",
          currentFile: current,
          maxSizeBytes: ROLE_CONFIG[role].maxSizeBytes,
          acceptedMediaType: ROLE_CONFIG[role].mediaType,
        };
      }),
      inspection: await inspectionProjection(client, projectId),
      workflow: {
        stageStates,
        allowedRoutes: stageStates
          .filter(
            (stage) =>
              stage.status !== "blocked" && stage.status !== "not_started",
          )
          .map((stage) => stage.route),
      },
    };
  });
}

async function acceptedFile(
  client: TransactionClient,
  projectId: string,
  fileVersionId: string,
  role: FileRole,
): Promise<{ fileVersionId: string; artifactId: string; objectKey: string; sha256: string }> {
  const result = await client.query<{
    resource_version_id: string;
    artifact_id: string;
    object_key: string;
    sha256: string;
  }>(
    `SELECT pf.resource_version_id, pf.artifact_id, a.object_key, a.sha256
     FROM project_file_version pf
     JOIN resource_version rv ON rv.resource_version_id = pf.resource_version_id
     JOIN versioned_resource vr ON vr.resource_id = rv.resource_id
     JOIN artifact a ON a.artifact_id = pf.artifact_id
     WHERE pf.resource_version_id = $1
       AND vr.project_id = $2
       AND pf.file_role = $3
       AND pf.inspection_status = 'accepted'
       AND rv.lifecycle_status = 'approved'
       AND rv.validity_status = 'current'`,
    [fileVersionId, projectId, role],
  );
  const row = result.rows[0];
  if (!row) {
    throw new ApiError(
      409,
      "FILE_NOT_ACCEPTED",
      "검사를 통과한 최신 파일을 선택해주세요.",
    );
  }
  return {
    fileVersionId: row.resource_version_id,
    artifactId: row.artifact_id,
    objectKey: row.object_key,
    sha256: row.sha256.trim(),
  };
}

export async function createFileInspection(input: {
  projectId: string;
  userId: string;
  idempotencyKey: string | null;
  pdfFileVersionId: unknown;
  workbookFileVersionId: unknown;
}): Promise<IdempotentResult> {
  const key = validateIdempotencyKey(input.idempotencyKey);
  const pdfFileVersionId = validateUuid(input.pdfFileVersionId, "pdfFileVersionId");
  const workbookFileVersionId = validateUuid(
    input.workbookFileVersionId,
    "workbookFileVersionId",
  );
  const requestHash = contentHash({ pdfFileVersionId, workbookFileVersionId });
  return withTransaction(async (client) => {
    const replay = await idempotentReplay(client, {
      userId: input.userId,
      operation: "file.inspection.create",
      projectId: input.projectId,
      key,
      requestHash,
    });
    if (replay) return replay;
    await getOwnedProject(client, input.projectId, input.userId);
    const setupResult = await client.query<{
      company_master_id: string;
      ticker: string;
      exchange_code: "KOSPI" | "KOSDAQ" | "KONEX" | "KRX";
      cutoff_date: string;
    }>(
      `SELECT psv.company_master_id, cm.ticker, cm.exchange_code,
         psv.cutoff_date::text
       FROM versioned_resource vr
       JOIN resource_version rv ON rv.resource_id = vr.resource_id
       JOIN project_setup_version psv
         ON psv.resource_version_id = rv.resource_version_id
       JOIN company_master cm ON cm.company_master_id = psv.company_master_id
       WHERE vr.project_id = $1
         AND vr.resource_kind = 'project_setup'
         AND psv.completion_status = 'complete'
         AND rv.lifecycle_status = 'approved'
         AND rv.validity_status = 'current'
       ORDER BY rv.version_no DESC
       LIMIT 1`,
      [input.projectId],
    );
    const setup = setupResult.rows[0];
    if (!setup) {
      throw new ApiError(
        409,
        "FILES_PREREQUISITE_INCOMPLETE",
        "기업과 보고서 기준일 설정을 먼저 완료해 주세요.",
      );
    }
    const pdf = await acceptedFile(
      client,
      input.projectId,
      pdfFileVersionId,
      "previous_report_pdf",
    );
    const workbook = await acceptedFile(
      client,
      input.projectId,
      workbookFileVersionId,
      "analysis_workbook",
    );
    const active = await client.query(
      `SELECT 1 FROM workflow_job
       WHERE project_id = $1 AND job_type = 'file_inspection'
         AND operation_status IN ('queued', 'running', 'cancel_requested')
       LIMIT 1`,
      [input.projectId],
    );
    if (active.rowCount) {
      throw new ApiError(
        409,
        "INSPECTION_ALREADY_ACTIVE",
        "이미 파일 검사가 진행 중입니다.",
      );
    }
    const inspectionId = uuidv7();
    const jobId = uuidv7();
    const fingerprint = contentHash({
      pdf: pdf.sha256,
      workbook: workbook.sha256,
      marketData: setup,
    });
    await client.query(
      `INSERT INTO workflow_job (
        job_id, project_id, job_type, temporal_workflow_id, input_fingerprint,
        requested_by_user_id, current_phase
      ) VALUES ($1, $2, 'file_inspection', $3, $4, $5, 'queued')`,
      [jobId, input.projectId, `reflo:${jobId}`, fingerprint, input.userId],
    );
    await client.query(
      `INSERT INTO workflow_job_input (job_id, input_role, resource_version_id)
       VALUES ($1, 'pdf_file', $2), ($1, 'workbook_file', $3)`,
      [jobId, pdf.fileVersionId, workbook.fileVersionId],
    );
    await client.query(
      `INSERT INTO file_inspection (
        inspection_id, project_id, job_id, pdf_file_version_id,
        workbook_file_version_id
      ) VALUES ($1, $2, $3, $4, $5)`,
      [
        inspectionId,
        input.projectId,
        jobId,
        pdf.fileVersionId,
        workbook.fileVersionId,
      ],
    );
    const payload = {
      workflowType: "fileInspectionWorkflow",
      jobId,
      jobAttempt: 1,
      projectId: input.projectId,
      inspectionId,
      pdf,
      workbook,
      marketData: {
        companyMasterId: setup.company_master_id,
        ticker: setup.ticker,
        exchange: setup.exchange_code,
        cutoffDate: setup.cutoff_date,
      },
    };
    await client.query(
      `INSERT INTO outbox_event (
        outbox_event_id, job_id, command_type, command_id, payload_json
      ) VALUES ($1, $2, 'start_workflow', $3, $4::jsonb)`,
      [uuidv7(), jobId, uuidv7(), JSON.stringify(payload)],
    );
    const body = {
      inspectionId,
      operationStatus: "queued",
      outcome: "pending",
      validity: "current",
      statusUrl: `/api/projects/${input.projectId}/file-inspections/${inspectionId}`,
    };
    await storeIdempotency(client, {
      userId: input.userId,
      operation: "file.inspection.create",
      projectId: input.projectId,
      key,
      requestHash,
      status: 202,
      body,
    });
    return { status: 202, body };
  });
}

export async function getFileInspection(input: {
  projectId: string;
  inspectionId: string;
  userId: string;
}): Promise<unknown> {
  return withTransaction(async (client) => {
    await getOwnedProject(client, input.projectId, input.userId);
    const projection = await inspectionProjection(
      client,
      input.projectId,
      input.inspectionId,
    );
    if (!projection) {
      throw new ApiError(404, "INSPECTION_NOT_FOUND", "검사 작업을 찾을 수 없습니다.");
    }
    return projection;
  });
}

export async function requestInspectionCancellation(input: {
  projectId: string;
  inspectionId: string;
  userId: string;
  idempotencyKey: string | null;
}): Promise<unknown> {
  validateIdempotencyKey(input.idempotencyKey);
  return withTransaction(async (client) => {
    await getOwnedProject(client, input.projectId, input.userId);
    const result = await client.query<{ job_id: string; operation_status: JobStatus }>(
      `SELECT wj.job_id, wj.operation_status
       FROM file_inspection fi
       JOIN workflow_job wj ON wj.job_id = fi.job_id
       WHERE fi.inspection_id = $1 AND fi.project_id = $2
       FOR UPDATE OF wj`,
      [input.inspectionId, input.projectId],
    );
    const row = result.rows[0];
    if (!row) {
      throw new ApiError(404, "INSPECTION_NOT_FOUND", "검사 작업을 찾을 수 없습니다.");
    }
    if (!["queued", "running"].includes(row.operation_status)) {
      throw new ApiError(
        409,
        "JOB_NOT_CANCELLABLE",
        "완료된 검사는 취소할 수 없습니다.",
      );
    }
    await client.query(
      `UPDATE workflow_job
       SET operation_status = 'cancel_requested', current_phase = 'cancelling',
           heartbeat_at = now()
       WHERE job_id = $1`,
      [row.job_id],
    );
    await client.query(
      `INSERT INTO outbox_event (
        outbox_event_id, job_id, command_type, command_id, payload_json
      ) VALUES ($1, $2, 'cancel_workflow', $3, $4::jsonb)`,
      [
        uuidv7(),
        row.job_id,
        uuidv7(),
        JSON.stringify({ jobId: row.job_id, workflowId: `reflo:${row.job_id}` }),
      ],
    );
    return inspectionProjection(client, input.projectId, input.inspectionId);
  });
}

export async function retryFileInspection(input: {
  projectId: string;
  inspectionId: string;
  userId: string;
  idempotencyKey: string | null;
}): Promise<IdempotentResult> {
  const previous = await withTransaction(async (client) => {
    await getOwnedProject(client, input.projectId, input.userId);
    const result = await client.query<{
      pdf_file_version_id: string;
      workbook_file_version_id: string;
      operation_status: JobStatus;
      retryable: boolean;
    }>(
      `SELECT fi.pdf_file_version_id, fi.workbook_file_version_id,
         wj.operation_status, wj.retryable
       FROM file_inspection fi
       JOIN workflow_job wj ON wj.job_id = fi.job_id
       WHERE fi.inspection_id = $1 AND fi.project_id = $2`,
      [input.inspectionId, input.projectId],
    );
    const row = result.rows[0];
    if (!row) {
      throw new ApiError(404, "INSPECTION_NOT_FOUND", "검사 작업을 찾을 수 없습니다.");
    }
    if (row.operation_status !== "failed" || !row.retryable) {
      throw new ApiError(
        409,
        "JOB_NOT_RETRYABLE",
        "이 오류는 파일을 교체한 뒤 다시 검사해야 합니다.",
      );
    }
    return row;
  });
  return createFileInspection({
    projectId: input.projectId,
    userId: input.userId,
    idempotencyKey: input.idempotencyKey,
    pdfFileVersionId: previous.pdf_file_version_id,
    workbookFileVersionId: previous.workbook_file_version_id,
  });
}

export async function completeFilesStage(input: {
  projectId: string;
  userId: string;
  idempotencyKey: string | null;
  inspectionId: unknown;
  templateVersion: unknown;
  workbookVersion: unknown;
  mappingSetVersion: unknown;
  expectedProjectVersion: unknown;
}): Promise<IdempotentResult> {
  const key = validateIdempotencyKey(input.idempotencyKey);
  const inspectionId = validateUuid(input.inspectionId, "inspectionId");
  const versions = {
    templateVersion: Number(input.templateVersion),
    workbookVersion: Number(input.workbookVersion),
    mappingSetVersion: Number(input.mappingSetVersion),
    expectedProjectVersion: Number(input.expectedProjectVersion),
  };
  if (Object.values(versions).some((value) => !Number.isInteger(value) || value < 1)) {
    throw new ApiError(400, "INVALID_VERSION", "검사 결과 버전이 올바르지 않습니다.");
  }
  const requestHash = contentHash({ inspectionId, ...versions });
  return withTransaction(async (client) => {
    const replay = await idempotentReplay(client, {
      userId: input.userId,
      operation: "files.complete",
      projectId: input.projectId,
      key,
      requestHash,
    });
    if (replay) return replay;
    const project = await getOwnedProject(client, input.projectId, input.userId, true);
    if (project.rowVersion !== versions.expectedProjectVersion) {
      throw new ApiError(
        409,
        "STALE_PROJECT_VERSION",
        "다른 탭에서 프로젝트가 변경되었습니다.",
        { meta: { currentVersion: project.rowVersion } },
      );
    }
    const result = await client.query<{
      outcome: string | null;
      mapping_status: string;
      template_version_no: string | null;
      workbook_version_no: string | null;
      mapping_set_version_no: string | null;
      mapping_set_resource_version_id: string | null;
      pdf_file_version_id: string;
      workbook_file_version_id: string;
    }>(
      `SELECT outcome, mapping_status, template_version_no, workbook_version_no,
         mapping_set_version_no, mapping_set_resource_version_id,
         pdf_file_version_id, workbook_file_version_id
       FROM file_inspection
       WHERE inspection_id = $1 AND project_id = $2`,
      [inspectionId, input.projectId],
    );
    const inspection = result.rows[0];
    if (!inspection || inspection.outcome !== "passed") {
      throw new ApiError(
        409,
        "INSPECTION_NOT_PASSED",
        "모든 파일 검사를 통과한 뒤 계속할 수 있습니다.",
      );
    }
    if (inspection.mapping_status !== "confirmed") {
      throw new ApiError(
        409,
        "MAPPING_NOT_CONFIRMED",
        "PDF와 Excel 연결을 확인해주세요.",
      );
    }
    if (
      Number(inspection.template_version_no) !== versions.templateVersion ||
      Number(inspection.workbook_version_no) !== versions.workbookVersion ||
      Number(inspection.mapping_set_version_no) !== versions.mappingSetVersion
    ) {
      throw new ApiError(
        409,
        "STALE_FILE_VERSION",
        "최신 검사 결과를 다시 확인해주세요.",
      );
    }
    const previous = await client.query<{
      stage_completion_id: string;
      completion_no: string;
    }>(
      `SELECT stage_completion_id, completion_no
       FROM stage_completion
       WHERE project_id = $1 AND stage_key = 'files'
       ORDER BY completion_no DESC LIMIT 1`,
      [input.projectId],
    );
    const completionId = uuidv7();
    await client.query(
      `INSERT INTO stage_completion (
        stage_completion_id, project_id, stage_key, completion_no,
        primary_version_id, supersedes_completion_id, completed_by_user_id
      ) VALUES ($1, $2, 'files', $3, $4, $5, $6)`,
      [
        completionId,
        input.projectId,
        Number(previous.rows[0]?.completion_no ?? 0) + 1,
        inspection.mapping_set_resource_version_id,
        previous.rows[0]?.stage_completion_id ?? null,
        input.userId,
      ],
    );
    await client.query(
      `UPDATE project_stage_state
       SET stage_status = 'completed', current_completion_id = $2,
           completed_at = now(), blocker_codes = '{}', updated_at = now()
       WHERE project_id = $1 AND stage_key = 'files'`,
      [input.projectId, completionId],
    );
    await client.query(
      `UPDATE project_stage_state
       SET stage_status = 'in_progress', blocker_codes = '{}', updated_at = now()
       WHERE project_id = $1 AND stage_key = 'hypothesis'`,
      [input.projectId],
    );
    const updated = await client.query<{ row_version: string }>(
      `UPDATE project
       SET row_version = row_version + 1, current_stage = 'hypothesis',
           updated_at = now(), last_saved_at = now()
       WHERE project_id = $1
       RETURNING row_version`,
      [input.projectId],
    );
    const body = {
      completedStage: "files",
      nextStage: "hypothesis",
      nextUrl: processRoute(input.projectId, "hypothesis"),
      projectVersion: Number(updated.rows[0].row_version),
      completedAt: new Date().toISOString(),
    };
    await storeIdempotency(client, {
      userId: input.userId,
      operation: "files.complete",
      projectId: input.projectId,
      key,
      requestHash,
      status: 200,
      body,
    });
    return { status: 200, body };
  });
}

export type WorkerProgressCommand = {
  attempt: number;
  sequence: number;
  phase: string;
  progressPercent: number;
  operationStatus?: "running" | "cancelled";
  message?: string;
};

export async function recordWorkerProgress(
  jobId: string,
  command: WorkerProgressCommand,
): Promise<void> {
  if (
    !Number.isInteger(command.attempt) ||
    !Number.isInteger(command.sequence) ||
    command.sequence < 1 ||
    !Number.isInteger(command.progressPercent) ||
    command.progressPercent < 0 ||
    command.progressPercent > 100 ||
    typeof command.phase !== "string"
  ) {
    throw new ApiError(400, "INVALID_WORKER_COMMAND", "진행 상태 형식이 올바르지 않습니다.");
  }
  await withTransaction(async (client) => {
    const result = await client.query<{
      attempt: number;
      progress_sequence: string;
      operation_status: JobStatus;
    }>(
      `SELECT attempt, progress_sequence, operation_status
       FROM workflow_job WHERE job_id = $1 FOR UPDATE`,
      [jobId],
    );
    const job = result.rows[0];
    if (!job || job.attempt !== command.attempt) {
      throw new ApiError(409, "JOB_ATTEMPT_MISMATCH", "작업 시도가 일치하지 않습니다.");
    }
    if (["succeeded", "failed", "cancelled"].includes(job.operation_status)) return;
    if (command.sequence <= Number(job.progress_sequence)) return;
    const operationStatus =
      command.operationStatus === "cancelled" ? "cancelled" : "running";
    await client.query(
      `UPDATE workflow_job
       SET operation_status = $2, current_phase = $3, progress_percent = $4,
           progress_sequence = $5, heartbeat_at = now(),
           started_at = COALESCE(started_at, now()),
           finished_at = CASE WHEN $2 = 'cancelled' THEN now() ELSE finished_at END
       WHERE job_id = $1`,
      [jobId, operationStatus, command.phase, command.progressPercent, command.sequence],
    );
    await client.query(
      `INSERT INTO workflow_job_event (
        job_event_id, job_id, sequence_no, event_type, operation_status,
        phase, progress_percent, metadata_json, occurred_at
      ) VALUES ($1, $2, $3, 'progress', $4, $5, $6, $7::jsonb, now())`,
      [
        uuidv7(),
        jobId,
        command.sequence,
        operationStatus,
        command.phase,
        command.progressPercent,
        JSON.stringify({ message: command.message ?? null }),
      ],
    );
  });
}

type MappingRevisionSelection = {
  entryId: string;
  candidateId: string | null;
};

type MappingRevisionEntry = {
  entryId: string;
  slotId: string;
  metric: string;
  kind: "scalar" | "table" | "chart";
  valueType: string;
  required: boolean;
  selectedCandidateId: string | null;
  candidates: Array<{
    candidateId: string;
    sourceType: "cell" | "range" | "chart" | "market_data";
    sheetId: string;
    sheetName: string;
    address: string;
    label: string | null;
    score: number;
    reasonCodes: string[];
    source: Record<string, unknown>;
  }>;
};

function parseMappingSelections(input: unknown): MappingRevisionSelection[] {
  if (!Array.isArray(input) || input.length > 500) {
    throw new ApiError(
      400,
      "MAPPING_SELECTION_INVALID",
      "매핑 선택 목록을 확인해 주세요.",
    );
  }
  const seen = new Set<string>();
  return input.map((item, index) => {
    if (!item || typeof item !== "object") {
      throw new ApiError(
        400,
        "MAPPING_SELECTION_INVALID",
        "매핑 선택 항목을 확인해 주세요.",
        {
          details: [
            {
              path: `selections[${index}]`,
              code: "INVALID_VALUE",
              message: "선택 항목 형식이 올바르지 않습니다.",
            },
          ],
        },
      );
    }
    const value = item as { entryId?: unknown; candidateId?: unknown };
    const entryId = validateUuid(value.entryId, `selections[${index}].entryId`);
    if (seen.has(entryId)) {
      throw new ApiError(
        400,
        "MAPPING_SELECTION_DUPLICATED",
        "같은 슬롯을 두 번 선택할 수 없습니다.",
      );
    }
    seen.add(entryId);
    const candidateId =
      value.candidateId === null
        ? null
        : validateUuid(value.candidateId, `selections[${index}].candidateId`);
    return { entryId, candidateId };
  });
}

function mappingRangeDimensions(address: string): {
  firstColumn: string;
  firstRow: number;
  rows: number;
  columns: number;
} {
  const parts = address.split(":");
  const parse = (value: string) => {
    const match = /^([A-Z]+)(\d+)$/i.exec(value);
    if (!match) return { column: "A", columnNo: 1, row: 1 };
    const columnNo = [...match[1].toUpperCase()].reduce(
      (total, character) => total * 26 + character.charCodeAt(0) - 64,
      0,
    );
    return { column: match[1].toUpperCase(), columnNo, row: Number(match[2]) };
  };
  const first = parse(parts[0]);
  const last = parse(parts[1] ?? parts[0]);
  return {
    firstColumn: first.column,
    firstRow: first.row,
    rows: Math.max(1, last.row - first.row + 1),
    columns: Math.max(1, last.columnNo - first.columnNo + 1),
  };
}

function mappingBinding(
  entry: MappingRevisionEntry,
  candidate: MappingRevisionEntry["candidates"][number],
) {
  if (entry.kind === "table") {
    const dimensions = mappingRangeDimensions(candidate.address);
    return {
      bindingId: `binding_${entry.entryId.replaceAll("-", "")}`,
      slotId: entry.slotId,
      kind: "table",
      source: candidate.source,
      rowKeyColumn: dimensions.firstColumn,
      columnHeaderRow: dimensions.firstRow,
      expectedRows: dimensions.rows,
      expectedColumns: dimensions.columns,
      subtotalRows: [],
      unitRows: [],
      display: {},
      status: "confirmed",
    };
  }
  return {
    bindingId: `binding_${entry.entryId.replaceAll("-", "")}`,
    slotId: entry.slotId,
    kind: entry.kind,
    valueType: entry.valueType,
    source: candidate.source,
    verificationSources: [],
    display: {},
    status: "confirmed",
  };
}

export async function createMappingRevision(input: {
  projectId: string;
  mappingSetVersionId: string;
  userId: string;
  idempotencyKey: string | null;
  expectedVersion: unknown;
  selections: unknown;
}): Promise<IdempotentResult> {
  const key = validateIdempotencyKey(input.idempotencyKey);
  const expectedVersion = Number(input.expectedVersion);
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
    throw new ApiError(
      400,
      "INVALID_VERSION",
      "매핑 버전을 확인해 주세요.",
    );
  }
  const selections = parseMappingSelections(input.selections);
  const requestHash = contentHash({
    mappingSetVersionId: input.mappingSetVersionId,
    expectedVersion,
    selections,
  });
  const replay = await withTransaction(async (client) => {
    await getOwnedProject(client, input.projectId, input.userId);
    return idempotentReplay(client, {
      userId: input.userId,
      operation: "mapping.revision.create",
      projectId: input.projectId,
      key,
      requestHash,
    });
  });
  if (replay) return replay;
  const snapshot = await withTransaction(async (client) => {
    await getOwnedProject(client, input.projectId, input.userId);
    const mappingResult = await client.query<{
      resource_version_id: string;
      version_no: string;
      lifecycle_status: string;
      template_ir_version_id: string;
      workbook_version_id: string;
      mapping_json: Record<string, unknown>;
      inspection_id: string;
      job_id: string;
    }>(
      `SELECT msv.resource_version_id, rv.version_no, rv.lifecycle_status,
         msv.template_ir_version_id, msv.workbook_version_id, msv.mapping_json,
         fi.inspection_id, fi.job_id
       FROM mapping_set_version msv
       JOIN resource_version rv
         ON rv.resource_version_id = msv.resource_version_id
       JOIN versioned_resource vr ON vr.resource_id = rv.resource_id
       JOIN file_inspection fi
         ON fi.mapping_set_resource_version_id = msv.resource_version_id
       WHERE msv.resource_version_id = $1
         AND vr.project_id = $2`,
      [input.mappingSetVersionId, input.projectId],
    );
    const mapping = mappingResult.rows[0];
    if (!mapping) {
      throw new ApiError(
        404,
        "MAPPING_SET_NOT_FOUND",
        "매핑 결과를 찾을 수 없습니다.",
      );
    }
    if (
      mapping.lifecycle_status !== "approved" ||
      Number(mapping.version_no) !== expectedVersion
    ) {
      throw new ApiError(
        409,
        "STALE_MAPPING_VERSION",
        "최신 매핑 결과를 다시 불러와 주세요.",
        { meta: { currentVersion: Number(mapping.version_no) } },
      );
    }
    const rows = await client.query<{
      mapping_entry_id: string;
      slot_id: string;
      semantic_metric: string;
      binding_kind: "scalar" | "table" | "chart";
      value_type: string;
      required: boolean;
      selected_candidate_id: string | null;
      mapping_candidate_id: string | null;
      source_type: "cell" | "range" | "chart" | "market_data" | null;
      sheet_id: string | null;
      sheet_name: string | null;
      address: string | null;
      label: string | null;
      score: string | null;
      reason_codes: string[] | null;
      source_json: Record<string, unknown> | null;
    }>(
      `SELECT me.mapping_entry_id, me.slot_id, me.semantic_metric,
         me.binding_kind, me.value_type, me.required, me.selected_candidate_id,
         mc.mapping_candidate_id, mc.source_type, mc.sheet_id, mc.sheet_name,
         mc.address, mc.label, mc.score, mc.reason_codes, mc.source_json
       FROM mapping_entry me
       LEFT JOIN mapping_candidate mc
         ON mc.mapping_entry_id = me.mapping_entry_id
       WHERE me.mapping_set_version_id = $1
       ORDER BY me.semantic_metric, mc.candidate_order`,
      [input.mappingSetVersionId],
    );
    const entries = new Map<string, MappingRevisionEntry>();
    for (const row of rows.rows) {
      let entry = entries.get(row.mapping_entry_id);
      if (!entry) {
        entry = {
          entryId: row.mapping_entry_id,
          slotId: row.slot_id,
          metric: row.semantic_metric,
          kind: row.binding_kind,
          valueType: row.value_type,
          required: row.required,
          selectedCandidateId: row.selected_candidate_id,
          candidates: [],
        };
        entries.set(row.mapping_entry_id, entry);
      }
      if (
        row.mapping_candidate_id &&
        row.source_type &&
        row.sheet_id &&
        row.sheet_name &&
        row.address &&
        row.score != null &&
        row.source_json
      ) {
        entry.candidates.push({
          candidateId: row.mapping_candidate_id,
          sourceType: row.source_type,
          sheetId: row.sheet_id,
          sheetName: row.sheet_name,
          address: row.address,
          label: row.label,
          score: Number(row.score),
          reasonCodes: row.reason_codes ?? [],
          source: row.source_json,
        });
      }
    }
    return {
      ...mapping,
      versionNo: Number(mapping.version_no),
      entries: [...entries.values()],
    };
  });
  const selectionMap = new Map(
    selections.map((selection) => [selection.entryId, selection.candidateId]),
  );
  for (const selection of selections) {
    const entry = snapshot.entries.find((item) => item.entryId === selection.entryId);
    if (!entry) {
      throw new ApiError(
        400,
        "MAPPING_ENTRY_NOT_FOUND",
        "선택한 매핑 슬롯을 찾을 수 없습니다.",
      );
    }
    if (
      selection.candidateId &&
      !entry.candidates.some(
        (candidate) => candidate.candidateId === selection.candidateId,
      )
    ) {
      throw new ApiError(
        400,
        "MAPPING_CANDIDATE_NOT_FOUND",
        "선택한 Excel 원본 후보를 찾을 수 없습니다.",
      );
    }
  }
  const revisedEntries = snapshot.entries.map((entry) => {
    const selectedCandidateId = selectionMap.has(entry.entryId)
      ? selectionMap.get(entry.entryId) ?? null
      : entry.selectedCandidateId;
    return { ...entry, selectedCandidateId };
  });
  const bindings = revisedEntries.flatMap((entry) => {
    const candidate = entry.candidates.find(
      (item) => item.candidateId === entry.selectedCandidateId,
    );
    return candidate ? [mappingBinding(entry, candidate)] : [];
  });
  const candidates = revisedEntries.flatMap((entry) =>
    entry.candidates.map((candidate) => ({
      candidateId: candidate.candidateId,
      slotId: entry.slotId,
      kind: candidate.sourceType,
      source: candidate.source,
      label: candidate.label ?? `${candidate.sheetName}!${candidate.address}`,
      score: candidate.score,
      reasonCodes: candidate.reasonCodes,
      selected: candidate.candidateId === entry.selectedCandidateId,
    })),
  );
  const unmappedRequiredSlots = revisedEntries
    .filter((entry) => entry.required && !entry.selectedCandidateId)
    .map((entry) => entry.slotId);
  const mappingStatus =
    unmappedRequiredSlots.length === 0 ? ("confirmed" as const) : ("blocked" as const);
  const originalMapping = snapshot.mapping_json ?? {};
  const revisedMapping = {
    ...originalMapping,
    schemaVersion: "1.0",
    mappingSetVersion: snapshot.versionNo + 1,
    status: mappingStatus === "confirmed" ? "confirmed" : "suggested",
    bindings,
    candidates,
    unmappedRequiredSlots,
    warnings:
      unmappedRequiredSlots.length > 0
        ? [
            {
              code: "REQUIRED_MAPPING_UNRESOLVED",
              message: `필수 슬롯 ${unmappedRequiredSlots.length}개의 Excel 원본을 확인해야 합니다.`,
            },
          ]
        : [],
  };
  const revisionId = uuidv7();
  const objectKey = `immutable/${input.projectId}/mapping-sets/${input.mappingSetVersionId}/revisions/${revisionId}.json`;
  const bytes = Buffer.from(JSON.stringify(revisedMapping));
  const stored = await putImmutableObject({
    objectKey,
    body: bytes,
    mediaType: "application/json",
  });
  try {
    return await withTransaction(async (client) => {
      const replay = await idempotentReplay(client, {
        userId: input.userId,
        operation: "mapping.revision.create",
        projectId: input.projectId,
        key,
        requestHash,
      });
      if (replay) return replay;
      await getOwnedProject(client, input.projectId, input.userId, true);
      const current = await client.query<{
        lifecycle_status: string;
        version_no: string;
      }>(
      `SELECT rv.lifecycle_status, rv.version_no
       FROM resource_version rv
       JOIN versioned_resource vr ON vr.resource_id = rv.resource_id
       WHERE rv.resource_version_id = $1 AND vr.project_id = $2
       FOR UPDATE OF rv`,
      [input.mappingSetVersionId, input.projectId],
    );
    if (
      current.rows[0]?.lifecycle_status !== "approved" ||
      Number(current.rows[0]?.version_no) !== expectedVersion
    ) {
      throw new ApiError(
        409,
        "STALE_MAPPING_VERSION",
        "다른 화면에서 매핑이 변경되었습니다. 최신 결과를 다시 불러와 주세요.",
      );
    }
    const created = await createAnalysisVersion(client, {
      projectId: input.projectId,
      userId: input.userId,
      resourceKind: "mapping_set",
      resourceKey: "main",
      payload: revisedMapping,
      artifact: {
        artifactRole: "mapping_set",
        artifactKind: "analysis",
        objectKey,
        objectVersion: stored.objectVersion,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        byteSize: bytes.byteLength,
        mediaType: "application/json",
      },
    });
    await client.query(
      `INSERT INTO mapping_set_version (
        resource_version_id, template_ir_version_id, workbook_version_id,
        mapping_status, mapping_schema_version, validation_summary_json,
        mapping_json, binding_count, required_slot_count,
        confirmed_binding_count, unmapped_required_count,
        base_mapping_set_version_id, confirmed_by_user_id, confirmed_at
      ) VALUES (
        $1, $2, $3, $4, '1.0.0', $5::jsonb, $6::jsonb, $7, $8, $9, $10,
        $11, $12, CASE WHEN $4 = 'confirmed' THEN now() ELSE NULL END
      )`,
      [
        created.resourceVersionId,
        snapshot.template_ir_version_id,
        snapshot.workbook_version_id,
        mappingStatus,
        JSON.stringify({
          slotCount: revisedEntries.length,
          userCorrected: true,
        }),
        JSON.stringify(revisedMapping),
        bindings.length,
        revisedEntries.filter((entry) => entry.required).length,
        bindings.length,
        unmappedRequiredSlots.length,
        input.mappingSetVersionId,
        mappingStatus === "confirmed" ? input.userId : null,
      ],
    );
    for (const entry of revisedEntries) {
      const entryId = uuidv7();
      const selected = entry.candidates.find(
        (candidate) => candidate.candidateId === entry.selectedCandidateId,
      );
      await client.query(
        `INSERT INTO mapping_entry (
          mapping_entry_id, mapping_set_version_id, slot_id, semantic_metric,
          binding_kind, value_type, required, mapping_status, confidence,
          source_json, display_json
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, '{}'::jsonb)`,
        [
          entryId,
          created.resourceVersionId,
          entry.slotId,
          entry.metric,
          entry.kind,
          entry.valueType,
          entry.required,
          selected ? "confirmed" : "unmapped",
          selected?.score ?? entry.candidates[0]?.score ?? null,
          selected ? JSON.stringify(selected.source) : null,
        ],
      );
      let selectedId: string | null = null;
      for (const [index, candidate] of entry.candidates.entries()) {
        const candidateId = uuidv7();
        if (candidate.candidateId === entry.selectedCandidateId) {
          selectedId = candidateId;
        }
        await client.query(
          `INSERT INTO mapping_candidate (
            mapping_candidate_id, mapping_entry_id, source_type, sheet_id,
            sheet_name, address, label, score, reason_codes, source_json,
            candidate_order
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9::text[], $10::jsonb, $11
          )`,
          [
            candidateId,
            entryId,
            candidate.sourceType,
            candidate.sheetId,
            candidate.sheetName,
            candidate.address,
            candidate.label,
            candidate.score,
            candidate.reasonCodes,
            JSON.stringify(candidate.source),
            index + 1,
          ],
        );
      }
      if (selectedId) {
        await client.query(
          `UPDATE mapping_entry
           SET selected_candidate_id = $2
           WHERE mapping_entry_id = $1`,
          [entryId, selectedId],
        );
      }
    }
    const inspectionState = await client.query<{
      issues_json: Array<{ code: string; severity: string; message: string }>;
      pdf_status: string;
      workbook_status: string;
    }>(
      `SELECT fi.issues_json,
         tiv.validation_status AS pdf_status,
         wv.compatibility_status AS workbook_status
       FROM file_inspection fi
       JOIN template_ir_version tiv
         ON tiv.resource_version_id = fi.template_resource_version_id
       JOIN workbook_version wv
         ON wv.resource_version_id = fi.workbook_resource_version_id
       WHERE fi.inspection_id = $1
       FOR UPDATE OF fi`,
      [snapshot.inspection_id],
    );
    const retainedIssues = (inspectionState.rows[0]?.issues_json ?? []).filter(
      (issue) =>
        !["REQUIRED_MAPPING_UNRESOLVED", "MAPPING_INPUT_UNAVAILABLE"].includes(
          issue.code,
        ),
    );
    if (mappingStatus === "blocked") {
      retainedIssues.push({
        code: "REQUIRED_MAPPING_UNRESOLVED",
        severity: "blocking",
        message: `필수 슬롯 ${unmappedRequiredSlots.length}개의 Excel 원본을 확인해야 합니다.`,
      });
    }
    const passed =
      mappingStatus === "confirmed" &&
      inspectionState.rows[0]?.pdf_status === "passed" &&
      inspectionState.rows[0]?.workbook_status === "passed" &&
      !retainedIssues.some((issue) => issue.severity === "blocking");
    await client.query(
      `UPDATE file_inspection
       SET mapping_set_resource_version_id = $2,
           mapping_set_version_no = $3,
           mapping_status = $4,
           outcome = $5,
           issues_json = $6::jsonb,
           completed_at = now()
       WHERE inspection_id = $1`,
      [
        snapshot.inspection_id,
        created.resourceVersionId,
        created.versionNo,
        mappingStatus,
        passed ? "passed" : "blocked",
        JSON.stringify(retainedIssues),
      ],
    );
    await client.query(
      `UPDATE workflow_job_output
       SET resource_version_id = $2
       WHERE job_id = $1 AND output_role = 'mapping_set'`,
      [snapshot.job_id, created.resourceVersionId],
    );
    const body = {
      mappingSet: {
        versionId: created.resourceVersionId,
        version: created.versionNo,
        status: mappingStatus,
        summary: {
          bindingCount: bindings.length,
          requiredSlotCount: revisedEntries.filter((entry) => entry.required).length,
          confirmedBindingCount: bindings.length,
          unmappedRequiredCount: unmappedRequiredSlots.length,
        },
      },
      outcome: passed ? "passed" : "blocked",
    };
    await storeIdempotency(client, {
      userId: input.userId,
      operation: "mapping.revision.create",
      projectId: input.projectId,
      key,
      requestHash,
      status: 201,
      body,
    });
    return { status: 201, body };
    });
  } catch (error) {
    await deleteObject(objectKey).catch(() => undefined);
    throw error;
  }
}

type FileScanPayload = {
  supportStatus: "accepted" | "rejected";
  detectedMediaType: string;
  magicBytes: string;
  encrypted: boolean;
  macroDetected: boolean;
  malwareStatus: "clean" | "infected" | "scan_unavailable";
  rejectionCodes: string[];
  checks: unknown[];
  tool: { name: string; version: string };
  inspectedAt: string;
};

export async function commitFileScanResult(
  jobId: string,
  payload: FileScanPayload,
): Promise<void> {
  await withTransaction(async (client) => {
    const result = await client.query<{
      artifact_id: string;
      resource_version_id: string;
      upload_session_id: string;
      project_id: string;
      file_role: FileRole;
    }>(
      `SELECT pf.artifact_id, pf.resource_version_id, us.upload_session_id,
         us.project_id, pf.file_role
       FROM workflow_job_input wi
       JOIN project_file_version pf ON pf.resource_version_id = wi.resource_version_id
       JOIN upload_session us ON us.file_version_id = pf.resource_version_id
       WHERE wi.job_id = $1 AND wi.input_role = 'uploaded_file'
       FOR UPDATE OF pf, us`,
      [jobId],
    );
    const row = result.rows[0];
    if (!row) {
      throw new ApiError(404, "JOB_NOT_FOUND", "작업 입력을 찾을 수 없습니다.");
    }
    const passed = payload.supportStatus === "accepted";
    await client.query(
      `INSERT INTO artifact_scan_result (
        scan_result_id, artifact_id, job_id, scan_status, detected_media_type,
        magic_bytes, encrypted, macro_detected, malware_result, tool_name,
        tool_version, scanned_at, details_json
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb)`,
      [
        uuidv7(),
        row.artifact_id,
        jobId,
        passed ? "passed" : "failed",
        payload.detectedMediaType,
        payload.magicBytes,
        payload.encrypted,
        payload.macroDetected,
        payload.malwareStatus,
        payload.tool.name,
        payload.tool.version,
        payload.inspectedAt,
        JSON.stringify({
          rejectionCodes: payload.rejectionCodes,
          checks: payload.checks,
        }),
      ],
    );
    if (passed) {
      await client.query(
        `UPDATE resource_version
         SET lifecycle_status = 'superseded'
         WHERE resource_id = (
           SELECT resource_id FROM resource_version WHERE resource_version_id = $1
         )
           AND resource_version_id <> $1
           AND lifecycle_status = 'approved'`,
        [row.resource_version_id],
      );
      await client.query(
        `UPDATE project_file_version pf
         SET inspection_status = 'superseded'
         FROM resource_version rv, resource_version current_rv
         WHERE current_rv.resource_version_id = $1
           AND rv.resource_id = current_rv.resource_id
           AND pf.resource_version_id = rv.resource_version_id
           AND pf.resource_version_id <> $1
           AND pf.inspection_status = 'accepted'`,
        [row.resource_version_id],
      );
      await client.query(
        `UPDATE resource_version SET lifecycle_status = 'approved'
         WHERE resource_version_id = $1`,
        [row.resource_version_id],
      );
    } else {
      await client.query(
        `UPDATE resource_version SET lifecycle_status = 'archived'
         WHERE resource_version_id = $1`,
        [row.resource_version_id],
      );
    }
    await client.query(
      `UPDATE artifact SET storage_status = $2 WHERE artifact_id = $1`,
      [row.artifact_id, passed ? "accepted" : "quarantined"],
    );
    await client.query(
      `UPDATE project_file_version
       SET inspection_status = $2, detected_media_type = $3
       WHERE resource_version_id = $1`,
      [row.resource_version_id, passed ? "accepted" : "rejected", payload.detectedMediaType],
    );
    await client.query(
      `UPDATE upload_session
       SET upload_status = $2, error_code = $3
       WHERE upload_session_id = $1`,
      [
        row.upload_session_id,
        passed ? "accepted" : "rejected",
        passed ? null : payload.rejectionCodes[0] ?? "FILE_REJECTED",
      ],
    );
    await client.query(
      `UPDATE workflow_job
       SET operation_status = 'succeeded', current_phase = 'complete',
           progress_percent = 100, finished_at = now(), heartbeat_at = now(),
           result_summary_json = $2::jsonb
       WHERE job_id = $1`,
      [jobId, JSON.stringify({ outcome: passed ? "accepted" : "rejected" })],
    );
  });
}

export type InspectionResultPayload = {
  pdf: {
    pageCount: number;
    textLayer: boolean;
    compatible: boolean;
    issues: Array<{ code: string; severity: string; message: string }>;
    parserName: string;
    parserVersion: string;
    templateIr: {
      templateId: string;
      templateVersion: number;
      pages: Array<{
        blocks: Array<{ blockId: string; role: string }>;
        slots: Array<{
          slotId: string;
          valueType: string;
          semanticKey: { metric: string };
          required: boolean;
        }>;
        objects: Array<{ objectId: string; type: string }>;
      }>;
      resources: { fonts: unknown[]; images: unknown[] };
      analysisWarnings: unknown[];
    } | null;
    summary: {
      blockCount?: number;
      slotCount?: number;
      requiredSlotCount?: number;
      objectCount?: number;
      fontCount?: number;
      imageCount?: number;
      tableCount?: number;
      chartCount?: number;
      warningCount?: number;
    };
    artifact: ArtifactDescriptor;
  };
  workbook: {
    sheetCount: number;
    usedCellCount: number;
    structureHash: string;
    originalSha256: string;
    compatible: boolean;
    issues: Array<{ code: string; severity: string; message: string }>;
    engineName: string;
    engineVersion: string;
    workbookAnalysis: {
      calculationStatus: string;
      candidateCells: unknown[];
      candidateRanges: unknown[];
      sheets: unknown[];
      editableCells: unknown[];
      externalLinks: unknown[];
      namedRanges?: unknown[];
      warnings: unknown[];
    } | null;
    summary: {
      sheetCount?: number;
      hiddenSheetCount?: number;
      usedCellCount?: number;
      formulaCount?: number;
      editableCellCount?: number;
      mergedRangeCount?: number;
      chartCount?: number;
      tableCount?: number;
      externalLinkCount?: number;
      namedRangeCount?: number;
    };
    artifact: ArtifactDescriptor;
  };
  marketPrice: {
    schemaVersion: "1.0";
    provider: "KRX_OPEN_API";
    status: "available" | "unavailable";
    companyMasterId: string;
    ticker: string;
    exchange: "KOSPI" | "KOSDAQ" | "KONEX" | "KRX";
    requestedDate: string;
    tradingDate: string | null;
    closePrice: number | null;
    currency: "KRW";
    sourceApiId: string | null;
    retrievedAt: string;
    sourcePayloadHash: string | null;
    errorCode: string | null;
    errorMessage: string | null;
    artifact: ArtifactDescriptor;
  };
  mapping: {
    status: "confirmed" | "blocked";
    slotCount: number;
    requiredSlotCount: number;
    bindingCount: number;
    confirmedBindingCount: number;
    unmappedRequiredCount: number;
    issues: Array<{ code: string; severity: string; message: string }>;
    mappingSet: {
      status: string;
      bindings: Array<{
        slotId: string;
        kind: string;
        valueType?: string;
        source: Record<string, unknown>;
        display?: Record<string, unknown>;
        status: string;
      }>;
      candidates: Array<{
        candidateId: string;
        slotId: string;
        kind: "cell" | "range" | "chart" | "market_data";
        source: {
          sheetId: string;
          sheet: string;
          address?: string;
          range?: string;
          [key: string]: unknown;
        };
        label?: string;
        score: number;
        reasonCodes: string[];
        selected: boolean;
      }>;
      unmappedRequiredSlots: string[];
      [key: string]: unknown;
    } | null;
    artifact: ArtifactDescriptor;
  };
};

async function createAnalysisVersion(
  client: TransactionClient,
  input: {
    projectId: string;
    userId: string | null;
    resourceKind: string;
    resourceKey: string;
    payload: unknown;
    artifact: ArtifactDescriptor;
  },
): Promise<{
  resourceVersionId: string;
  versionNo: number;
  artifactId: string;
}> {
  const resource = await ensureResource(
    client,
    input.projectId,
    input.resourceKind,
    input.resourceKey,
  );
  const resourceVersionId = uuidv7();
  const artifactId = uuidv7();
  const versionNo = resource.versionNo + 1;
  await client.query(
    `UPDATE resource_version
     SET lifecycle_status = 'superseded'
     WHERE resource_id = $1 AND lifecycle_status = 'approved'`,
    [resource.resourceId],
  );
  await client.query(
    `INSERT INTO artifact (
      artifact_id, project_id, artifact_kind, storage_status, bucket_name,
      object_key, object_version, sha256, byte_size, media_type,
      retention_class, created_by_actor_type
    ) VALUES ($1, $2, $3, 'accepted', $4, $5, $6, $7, $8, $9, 'project', 'worker')`,
    [
      artifactId,
      input.projectId,
      input.artifact.artifactKind,
      objectStoreBucket(),
      input.artifact.objectKey,
      input.artifact.objectVersion,
      input.artifact.sha256,
      input.artifact.byteSize,
      input.artifact.mediaType,
    ],
  );
  const hash = contentHash(input.payload);
  await client.query(
    `INSERT INTO resource_version (
      resource_version_id, resource_id, version_no, lifecycle_status,
      input_fingerprint, content_hash, created_by_user_id, created_by_actor_type
    ) VALUES ($1, $2, $3, 'approved', $4, $4, $5, 'system')`,
    [resourceVersionId, resource.resourceId, versionNo, hash, input.userId],
  );
  await client.query(
    `INSERT INTO resource_artifact (resource_version_id, artifact_role, artifact_id)
     VALUES ($1, $2, $3)`,
    [resourceVersionId, input.artifact.artifactRole, artifactId],
  );
  return { resourceVersionId, versionNo, artifactId };
}

export async function commitInspectionResult(
  jobId: string,
  payload: InspectionResultPayload,
): Promise<void> {
  await withTransaction(async (client) => {
    const result = await client.query<{
      project_id: string;
      requested_by_user_id: string | null;
      inspection_id: string;
      pdf_file_version_id: string;
      workbook_file_version_id: string;
      operation_status: JobStatus;
    }>(
      `SELECT wj.project_id, wj.requested_by_user_id, wj.operation_status,
         fi.inspection_id, fi.pdf_file_version_id, fi.workbook_file_version_id
       FROM workflow_job wj
       JOIN file_inspection fi ON fi.job_id = wj.job_id
       WHERE wj.job_id = $1
       FOR UPDATE OF wj, fi`,
      [jobId],
    );
    const job = result.rows[0];
    if (!job) throw new ApiError(404, "JOB_NOT_FOUND", "검사 작업을 찾을 수 없습니다.");
    if (job.operation_status === "succeeded") return;
    if (job.operation_status === "cancel_requested" || job.operation_status === "cancelled") {
      throw new ApiError(409, "JOB_TERMINAL", "취소된 작업 결과는 반영할 수 없습니다.");
    }
    const pdf = await createAnalysisVersion(client, {
      projectId: job.project_id,
      userId: job.requested_by_user_id,
      resourceKind: "template_ir",
      resourceKey: "main",
      payload: payload.pdf.templateIr ?? payload.pdf.summary,
      artifact: payload.pdf.artifact,
    });
    const workbook = await createAnalysisVersion(client, {
      projectId: job.project_id,
      userId: job.requested_by_user_id,
      resourceKind: "workbook_analysis",
      resourceKey: "main",
      payload: payload.workbook.workbookAnalysis ?? payload.workbook.summary,
      artifact: payload.workbook.artifact,
    });
    const marketPrice = await createAnalysisVersion(client, {
      projectId: job.project_id,
      userId: job.requested_by_user_id,
      resourceKind: "market_price_snapshot",
      resourceKey: "krx-close",
      payload: payload.marketPrice,
      artifact: payload.marketPrice.artifact,
    });
    const mapping = await createAnalysisVersion(client, {
      projectId: job.project_id,
      userId: job.requested_by_user_id,
      resourceKind: "mapping_set",
      resourceKey: "main",
      payload: payload.mapping.mappingSet ?? {
        status: payload.mapping.status,
        issues: payload.mapping.issues,
      },
      artifact: payload.mapping.artifact,
    });
    await client.query(
      `INSERT INTO template_ir_version (
        resource_version_id, source_file_version_id, page_count,
        parser_name, parser_version, validation_status, template_ir_json,
        block_count, slot_count, object_count, font_count, image_count,
        table_count, chart_count, warning_count
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7::jsonb,
        $8, $9, $10, $11, $12, $13, $14, $15
      )`,
      [
        pdf.resourceVersionId,
        job.pdf_file_version_id,
        payload.pdf.pageCount,
        payload.pdf.parserName,
        payload.pdf.parserVersion,
        payload.pdf.compatible ? "passed" : "failed",
        JSON.stringify(payload.pdf.templateIr ?? {}),
        payload.pdf.summary.blockCount ?? 0,
        payload.pdf.summary.slotCount ?? 0,
        payload.pdf.summary.objectCount ?? 0,
        payload.pdf.summary.fontCount ?? 0,
        payload.pdf.summary.imageCount ?? 0,
        payload.pdf.summary.tableCount ?? 0,
        payload.pdf.summary.chartCount ?? 0,
        payload.pdf.summary.warningCount ?? 0,
      ],
    );
    await client.query(
      `INSERT INTO workbook_version (
        resource_version_id, source_file_version_id, original_sha256,
        structure_hash, calculation_status, calculation_engine,
        engine_version, compatibility_status, analysis_json, sheet_count,
        hidden_sheet_count, used_cell_count, formula_count, editable_cell_count,
        merged_range_count, chart_count, table_count, external_link_count,
        named_range_count
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb,
        $10, $11, $12, $13, $14, $15, $16, $17, $18, $19
      )`,
      [
        workbook.resourceVersionId,
        job.workbook_file_version_id,
        payload.workbook.originalSha256,
        payload.workbook.structureHash,
        payload.workbook.workbookAnalysis?.calculationStatus ?? "unsupported",
        payload.workbook.engineName,
        payload.workbook.engineVersion,
        payload.workbook.compatible ? "passed" : "failed",
        JSON.stringify(payload.workbook.workbookAnalysis ?? {}),
        payload.workbook.summary.sheetCount ?? payload.workbook.sheetCount,
        payload.workbook.summary.hiddenSheetCount ?? 0,
        payload.workbook.summary.usedCellCount ?? payload.workbook.usedCellCount,
        payload.workbook.summary.formulaCount ?? 0,
        payload.workbook.summary.editableCellCount ?? 0,
        payload.workbook.summary.mergedRangeCount ?? 0,
        payload.workbook.summary.chartCount ?? 0,
        payload.workbook.summary.tableCount ?? 0,
        payload.workbook.summary.externalLinkCount ?? 0,
        payload.workbook.summary.namedRangeCount ?? 0,
      ],
    );
    await client.query(
      `INSERT INTO market_price_snapshot_version (
        resource_version_id, company_master_id, ticker, exchange_code,
        requested_date, trading_date, close_price, currency_code, provider,
        source_api_id, lookup_status, retrieved_at, source_payload_hash,
        error_code, evidence_json
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
        $15::jsonb
      )`,
      [
        marketPrice.resourceVersionId,
        payload.marketPrice.companyMasterId,
        payload.marketPrice.ticker,
        payload.marketPrice.exchange,
        payload.marketPrice.requestedDate,
        payload.marketPrice.tradingDate,
        payload.marketPrice.closePrice,
        payload.marketPrice.currency,
        payload.marketPrice.provider,
        payload.marketPrice.sourceApiId,
        payload.marketPrice.status,
        payload.marketPrice.retrievedAt,
        payload.marketPrice.sourcePayloadHash,
        payload.marketPrice.errorCode,
        JSON.stringify(payload.marketPrice),
      ],
    );
    await client.query(
      `INSERT INTO mapping_set_version (
        resource_version_id, template_ir_version_id, workbook_version_id,
        mapping_status, validation_summary_json, mapping_json, binding_count,
        required_slot_count, confirmed_binding_count, unmapped_required_count
      ) VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, $9, $10)`,
      [
        mapping.resourceVersionId,
        pdf.resourceVersionId,
        workbook.resourceVersionId,
        payload.mapping.status,
        JSON.stringify({
          slotCount: payload.mapping.slotCount,
          issues: payload.mapping.issues,
        }),
        JSON.stringify(payload.mapping.mappingSet ?? {}),
        payload.mapping.bindingCount,
        payload.mapping.requiredSlotCount,
        payload.mapping.confirmedBindingCount,
        payload.mapping.unmappedRequiredCount,
      ],
    );
    if (payload.mapping.mappingSet && payload.pdf.templateIr) {
      const bindings = new Map(
        payload.mapping.mappingSet.bindings.map((binding) => [
          binding.slotId,
          binding,
        ]),
      );
      const candidatesBySlot = new Map<string, typeof payload.mapping.mappingSet.candidates>();
      for (const candidate of payload.mapping.mappingSet.candidates) {
        const list = candidatesBySlot.get(candidate.slotId) ?? [];
        list.push(candidate);
        candidatesBySlot.set(candidate.slotId, list);
      }
      const slots = payload.pdf.templateIr.pages.flatMap((page) => page.slots);
      for (const slot of slots) {
        const entryId = uuidv7();
        const binding = bindings.get(slot.slotId);
        await client.query(
          `INSERT INTO mapping_entry (
            mapping_entry_id, mapping_set_version_id, slot_id, semantic_metric,
            binding_kind, value_type, required, mapping_status, confidence,
            source_json, display_json
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb)`,
          [
            entryId,
            mapping.resourceVersionId,
            slot.slotId,
            slot.semanticKey.metric,
            slot.valueType === "table"
              ? "table"
              : slot.valueType === "chart"
                ? "chart"
                : "scalar",
            slot.valueType,
            slot.required,
            binding ? "confirmed" : "unmapped",
            candidatesBySlot.get(slot.slotId)?.[0]?.score ?? null,
            binding ? JSON.stringify(binding.source) : null,
            JSON.stringify(binding?.display ?? {}),
          ],
        );
        const candidateIds = new Map<string, string>();
        const candidates = candidatesBySlot.get(slot.slotId) ?? [];
        for (const [index, candidate] of candidates.entries()) {
          const candidateId = uuidv7();
          candidateIds.set(candidate.candidateId, candidateId);
          await client.query(
            `INSERT INTO mapping_candidate (
              mapping_candidate_id, mapping_entry_id, source_type, sheet_id,
              sheet_name, address, label, score, reason_codes, source_json,
              candidate_order
            ) VALUES (
              $1, $2, $3, $4, $5, $6, $7, $8, $9::text[], $10::jsonb, $11
            )`,
            [
              candidateId,
              entryId,
              candidate.kind,
              candidate.source.sheetId,
              candidate.source.sheet,
              candidate.source.address ?? candidate.source.range ?? "",
              candidate.label ?? null,
              candidate.score,
              candidate.reasonCodes,
              JSON.stringify(candidate.source),
              index + 1,
            ],
          );
        }
        const selected = candidates.find((candidate) => candidate.selected);
        if (selected) {
          await client.query(
            `UPDATE mapping_entry
             SET selected_candidate_id = $2
             WHERE mapping_entry_id = $1`,
            [entryId, candidateIds.get(selected.candidateId)],
          );
        }
      }
    }
    const issues = [
      ...payload.pdf.issues,
      ...payload.workbook.issues,
      ...payload.mapping.issues,
    ];
    const passed =
      payload.pdf.compatible &&
      payload.workbook.compatible &&
      payload.mapping.status === "confirmed" &&
      !issues.some((issue) => issue.severity === "blocking");
    await client.query(
      `UPDATE file_inspection
       SET outcome = $2, issues_json = $3::jsonb,
           template_version_no = $4, workbook_version_no = $5,
           mapping_set_version_no = $6, template_resource_version_id = $7,
           workbook_resource_version_id = $8, mapping_set_resource_version_id = $9,
           mapping_status = $10,
           market_price_snapshot_resource_version_id = $11,
           completed_at = now()
       WHERE job_id = $1`,
      [
        jobId,
        passed ? "passed" : "blocked",
        JSON.stringify(issues),
        pdf.versionNo,
        workbook.versionNo,
        mapping.versionNo,
        pdf.resourceVersionId,
        workbook.resourceVersionId,
        mapping.resourceVersionId,
        payload.mapping.status,
        marketPrice.resourceVersionId,
      ],
    );
    await client.query(
      `INSERT INTO workflow_job_output (job_id, output_role, resource_version_id)
       VALUES
         ($1, 'template_ir', $2),
         ($1, 'workbook', $3),
         ($1, 'mapping_set', $4),
         ($1, 'market_price_snapshot', $5)`,
      [
        jobId,
        pdf.resourceVersionId,
        workbook.resourceVersionId,
        mapping.resourceVersionId,
        marketPrice.resourceVersionId,
      ],
    );
    await client.query(
      `UPDATE workflow_job
       SET operation_status = 'succeeded', current_phase = 'complete',
           progress_percent = 100, heartbeat_at = now(), finished_at = now(),
           retryable = false, result_summary_json = $2::jsonb
       WHERE job_id = $1`,
      [jobId, JSON.stringify({ outcome: passed ? "passed" : "blocked" })],
    );
  });
}

export async function failWorkerJob(
  jobId: string,
  input: { errorCode: string; message: string; retryable: boolean },
): Promise<void> {
  await withTransaction(async (client) => {
    await client.query(
      `UPDATE workflow_job
       SET operation_status = 'failed', current_phase = 'failed',
           retryable = $2, error_code = $3, error_summary = $4,
           heartbeat_at = now(), finished_at = now()
       WHERE job_id = $1
         AND operation_status NOT IN ('succeeded', 'cancelled')`,
      [jobId, input.retryable, input.errorCode, input.message.slice(0, 1000)],
    );
  });
}

export async function listReconciliationCandidates(olderThan: Date): Promise<unknown> {
  return withTransaction(async (client) => {
    const result = await client.query<{
      job_id: string;
      temporal_workflow_id: string;
      operation_status: JobStatus;
      heartbeat_at: Date | null;
    }>(
      `SELECT job_id, temporal_workflow_id, operation_status, heartbeat_at
       FROM workflow_job
       WHERE operation_status IN ('queued', 'running', 'cancel_requested')
         AND COALESCE(heartbeat_at, requested_at) < $1
       ORDER BY requested_at
       LIMIT 100`,
      [olderThan],
    );
    return {
      jobs: result.rows.map((row) => ({
        jobId: row.job_id,
        workflowId: row.temporal_workflow_id,
        operationStatus: row.operation_status,
        heartbeatAt: row.heartbeat_at?.toISOString() ?? null,
      })),
    };
  });
}

export async function reconcileJobProjection(input: {
  jobId: string;
  observedState: string;
  repairAction: "none" | "mark_failed" | "mark_cancelled";
}): Promise<void> {
  await withTransaction(async (client) => {
    const job = await client.query<{ operation_status: JobStatus }>(
      "SELECT operation_status FROM workflow_job WHERE job_id = $1 FOR UPDATE",
      [input.jobId],
    );
    if (!job.rows[0]) throw new ApiError(404, "JOB_NOT_FOUND", "작업을 찾을 수 없습니다.");
    if (input.repairAction === "mark_failed") {
      await client.query(
        `UPDATE workflow_job
         SET operation_status = 'failed', current_phase = 'reconciliation_required',
             retryable = true, error_code = 'WORKFLOW_EXECUTION_MISSING',
             error_summary = '작업 실행 이력을 확인할 수 없습니다.', finished_at = now()
         WHERE job_id = $1 AND operation_status IN ('queued', 'running')`,
        [input.jobId],
      );
    } else if (input.repairAction === "mark_cancelled") {
      await client.query(
        `UPDATE workflow_job
         SET operation_status = 'cancelled', current_phase = 'cancelled',
             finished_at = now()
         WHERE job_id = $1 AND operation_status = 'cancel_requested'`,
        [input.jobId],
      );
    }
    await client.query(
      `INSERT INTO reconciliation_issue (
        reconciliation_issue_id, job_id, issue_type, expected_state,
        observed_state, issue_status, repair_action, repaired_at
      ) VALUES ($1, $2, 'projection_workflow_mismatch', $3, $4, $5, $6, $7)`,
      [
        uuidv7(),
        input.jobId,
        job.rows[0].operation_status,
        input.observedState,
        input.repairAction === "none" ? "open" : "repaired",
        input.repairAction,
        input.repairAction === "none" ? null : new Date(),
      ],
    );
  });
}
