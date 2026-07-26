import assert from "node:assert/strict";
import test from "node:test";
import { uuidv7 } from "../server/domain/ids";
import { commitFileScanResult } from "../server/infrastructure/repositories/file-repository";
import { getPool } from "../server/infrastructure/database/pool";
import {
  LineageInvariantError,
  pinWorkflowJobSourceSnapshot,
} from "../server/infrastructure/services/source-snapshot-service";

const databaseAvailable = Boolean(process.env.REFLO_DATABASE_URL);
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);

type SeededScan = {
  jobId: string;
  resourceId: string;
  fileVersionId: string;
  uploadId: string;
};

async function seedScan(
  projectId: string,
  userId: string,
  role: "previous_report_pdf" | "analysis_workbook",
  resourceKey: string = role,
): Promise<SeededScan> {
  const pool = getPool();
  const resourceId = uuidv7();
  const fileVersionId = uuidv7();
  const artifactId = uuidv7();
  const uploadId = uuidv7();
  const jobId = uuidv7();
  const mediaType =
    role === "previous_report_pdf"
      ? "application/pdf"
      : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  const extension = role === "previous_report_pdf" ? "pdf" : "xlsx";

  await pool.query(
    `INSERT INTO versioned_resource (
       resource_id, project_id, resource_kind, resource_key
     ) VALUES ($1, $2, 'project_file', $3)`,
    [resourceId, projectId, resourceKey],
  );
  await pool.query(
    `INSERT INTO artifact (
       artifact_id, project_id, artifact_kind, storage_status, bucket_name,
       object_key, object_version, sha256, byte_size, media_type,
       original_filename, retention_class, created_by_actor_type
     ) VALUES (
       $1, $2, 'upload', 'quarantined', 'integration',
       $3, 'v1', $4, 10, $5, $6, 'project', 'user'
     )`,
    [
      artifactId,
      projectId,
      `late-result/${jobId}`,
      HASH_A,
      mediaType,
      `source.${extension}`,
    ],
  );
  await pool.query(
    `INSERT INTO resource_version (
       resource_version_id, resource_id, version_no, lifecycle_status,
       input_fingerprint, content_hash, created_by_user_id
     ) VALUES ($1, $2, 1, 'draft', $3, $3, $4)`,
    [fileVersionId, resourceId, HASH_A, userId],
  );
  await pool.query(
    `INSERT INTO workflow_job (
       job_id, project_id, job_type, temporal_workflow_id, input_fingerprint,
       requested_by_user_id, current_phase
     ) VALUES ($1, $2, 'file_ingest', $3, $4, $5, 'quarantine_scan')`,
    [jobId, projectId, `integration:${jobId}`, HASH_A, userId],
  );
  await pool.query(
    `INSERT INTO project_file_version (
       resource_version_id, artifact_id, file_role, inspection_status,
       detected_filename, detected_media_type, inspection_job_id
     ) VALUES ($1, $2, $3, 'scanning', $4, $5, $6)`,
    [fileVersionId, artifactId, role, `source.${extension}`, mediaType, jobId],
  );
  await pool.query(
    `INSERT INTO resource_artifact (
       resource_version_id, artifact_role, artifact_id
     ) VALUES ($1, 'source', $2)`,
    [fileVersionId, artifactId],
  );
  await pool.query(
    `INSERT INTO upload_session (
       upload_session_id, project_id, requested_by_user_id, upload_role,
       quarantine_object_key, expected_media_types, max_byte_size,
       declared_byte_size, client_filename, expected_sha256, upload_status,
       artifact_id, file_version_id, expires_at, completed_at
     ) VALUES (
       $1, $2, $3, $4, $5, ARRAY[$6], 100, 10, $7, $8, 'scanning',
       $9, $10, now() + interval '1 hour', now()
     )`,
    [
      uploadId,
      projectId,
      userId,
      role,
      `late-result/${jobId}`,
      mediaType,
      `source.${extension}`,
      HASH_A,
      artifactId,
      fileVersionId,
    ],
  );
  await pool.query(
    `INSERT INTO workflow_job_input (
       job_id, input_role, resource_version_id
     ) VALUES ($1, 'uploaded_file', $2)`,
    [jobId, fileVersionId],
  );
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await pinWorkflowJobSourceSnapshot(client, { jobId });
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  return { jobId, resourceId, fileVersionId, uploadId };
}

const scanPayload = {
  supportStatus: "accepted" as const,
  detectedMediaType: "application/pdf",
  magicBytes: "25504446",
  encrypted: false,
  macroDetected: false,
  malwareStatus: "clean" as const,
  rejectionCodes: [],
  checks: [],
  tool: { name: "integration-scan", version: "1.0.0" },
  inspectedAt: new Date("2026-07-26T00:00:00.000Z").toISOString(),
};

test(
  "file scan commit is current once, duplicate thereafter, and stale inputs stay obsolete",
  { skip: !databaseAvailable },
  async () => {
    const pool = getPool();
    const userId = uuidv7();
    const projectId = uuidv7();
    await pool.query(
      `INSERT INTO user_account (user_id, display_name, email)
       VALUES ($1, 'Late Result Test', $2)`,
      [userId, `${userId}@example.invalid`],
    );
    await pool.query(
      `INSERT INTO project (project_id, owner_user_id, name)
       VALUES ($1, $2, 'Late result integration')`,
      [projectId, userId],
    );

    try {
      const current = await seedScan(
        projectId,
        userId,
        "previous_report_pdf",
      );
      const priorFileVersionId = uuidv7();
      const dependentResourceId = uuidv7();
      const dependentVersionId = uuidv7();
      await pool.query(
        `UPDATE resource_version
         SET version_no = 2
         WHERE resource_version_id = $1`,
        [current.fileVersionId],
      );
      await pool.query(
        `INSERT INTO resource_version (
           resource_version_id, resource_id, version_no, lifecycle_status,
           input_fingerprint, content_hash, created_by_user_id
         ) VALUES ($1, $2, 1, 'approved', $3, $3, $4)`,
        [priorFileVersionId, current.resourceId, HASH_C, userId],
      );
      await pool.query(
        `UPDATE resource_version
         SET supersedes_version_id = $2
         WHERE resource_version_id = $1`,
        [current.fileVersionId, priorFileVersionId],
      );
      await pool.query(
        `INSERT INTO versioned_resource (
           resource_id, project_id, resource_kind, resource_key
         ) VALUES ($1, $2, 'integration_derived', $3)`,
        [dependentResourceId, projectId, dependentResourceId],
      );
      await pool.query(
        `INSERT INTO resource_version (
           resource_version_id, resource_id, version_no, lifecycle_status,
           input_fingerprint, content_hash, created_by_user_id
         ) VALUES ($1, $2, 1, 'approved', $3, $3, $4)`,
        [dependentVersionId, dependentResourceId, HASH_C, userId],
      );
      await pool.query(
        `INSERT INTO resource_dependency (
           project_id, upstream_resource_version_id,
           downstream_resource_version_id, dependency_kind
         ) VALUES ($1, $2, $3, 'file_replacement_test')`,
        [projectId, priorFileVersionId, dependentVersionId],
      );
      const currentMetadata = {
        attempt: 1,
        sequence: 3,
        inputVersionIds: [current.fileVersionId],
        resultHash: HASH_B,
      };
      assert.deepEqual(
        await commitFileScanResult(
          current.jobId,
          scanPayload,
          currentMetadata,
        ),
        { applied: true, disposition: "current" },
      );
      assert.deepEqual(
        await commitFileScanResult(
          current.jobId,
          scanPayload,
          currentMetadata,
        ),
        { applied: false, disposition: "duplicate" },
      );
      const currentRows = await pool.query<{
        scan_count: string;
        operation_status: string;
        validity_status: string;
        upload_status: string;
      }>(
        `SELECT
           (SELECT COUNT(*)::text FROM artifact_scan_result WHERE job_id = $1)
             AS scan_count,
           job.operation_status, job.validity_status, upload.upload_status
         FROM workflow_job job
         JOIN upload_session upload ON upload.upload_session_id = $2
         WHERE job.job_id = $1`,
        [current.jobId, current.uploadId],
      );
      assert.deepEqual(currentRows.rows[0], {
        scan_count: "1",
        operation_status: "succeeded",
        validity_status: "current",
        upload_status: "accepted",
      });
      const invalidated = await pool.query<{
        validity_status: string;
      }>(
        `SELECT validity_status
         FROM resource_version
         WHERE resource_version_id = $1`,
        [dependentVersionId],
      );
      assert.equal(
        invalidated.rows[0]?.validity_status,
        "revalidation_required",
      );

      const stale = await seedScan(projectId, userId, "analysis_workbook");
      await pool.query(
        `INSERT INTO resource_version (
           resource_version_id, resource_id, version_no, lifecycle_status,
           input_fingerprint, content_hash, created_by_user_id
         ) VALUES ($1, $2, 2, 'draft', $3, $3, $4)`,
        [uuidv7(), stale.resourceId, HASH_C, userId],
      );
      const staleMetadata = {
        attempt: 1,
        sequence: 3,
        inputVersionIds: [stale.fileVersionId],
        resultHash: HASH_C,
      };
      assert.deepEqual(
        await commitFileScanResult(stale.jobId, scanPayload, staleMetadata),
        { applied: false, disposition: "obsolete" },
      );
      const staleRows = await pool.query<{
        lifecycle_status: string;
        validity_status: string;
        upload_status: string;
        error_code: string;
      }>(
        `SELECT version.lifecycle_status, version.validity_status,
           upload.upload_status, upload.error_code
         FROM resource_version version
         JOIN upload_session upload ON upload.file_version_id =
           version.resource_version_id
         WHERE version.resource_version_id = $1`,
        [stale.fileVersionId],
      );
      assert.deepEqual(staleRows.rows[0], {
        lifecycle_status: "archived",
        validity_status: "obsolete",
        upload_status: "rejected",
        error_code: "SOURCE_SNAPSHOT_OBSOLETE",
      });
      await assert.rejects(
        commitFileScanResult(stale.jobId, scanPayload, {
          ...staleMetadata,
          resultHash: HASH_B,
        }),
        (error: unknown) =>
          error instanceof LineageInvariantError &&
          error.code === "WORKER_RESULT_HASH_CONFLICT",
      );

      const lateAttempt = await seedScan(
        projectId,
        userId,
        "analysis_workbook",
        "analysis_workbook_late_attempt",
      );
      await pool.query(
        "UPDATE workflow_job SET attempt = 2 WHERE job_id = $1",
        [lateAttempt.jobId],
      );
      const lateAttemptMetadata = {
        attempt: 1,
        sequence: 3,
        inputVersionIds: [lateAttempt.fileVersionId],
        resultHash: HASH_B,
      };
      assert.deepEqual(
        await commitFileScanResult(
          lateAttempt.jobId,
          scanPayload,
          lateAttemptMetadata,
        ),
        { applied: false, disposition: "obsolete" },
      );
      assert.deepEqual(
        await commitFileScanResult(
          lateAttempt.jobId,
          scanPayload,
          lateAttemptMetadata,
        ),
        { applied: false, disposition: "obsolete" },
      );
      const lateAttemptRows = await pool.query<{
        operation_status: string;
        validity_status: string;
        scan_count: string;
        event_count: string;
      }>(
        `SELECT job.operation_status, job.validity_status,
           (SELECT COUNT(*)::text FROM artifact_scan_result
             WHERE job_id = job.job_id) AS scan_count,
           (SELECT COUNT(*)::text FROM workflow_job_event
             WHERE job_id = job.job_id
               AND event_type = 'worker_result_late_attempt') AS event_count
         FROM workflow_job job
         WHERE job.job_id = $1`,
        [lateAttempt.jobId],
      );
      assert.deepEqual(lateAttemptRows.rows[0], {
        operation_status: "queued",
        validity_status: "current",
        scan_count: "0",
        event_count: "1",
      });

      for (const terminalStatus of ["cancel_requested", "failed"] as const) {
        const terminal = await seedScan(
          projectId,
          userId,
          "analysis_workbook",
          `analysis_workbook_${terminalStatus}`,
        );
        await pool.query(
          `UPDATE workflow_job
           SET operation_status = $2
           WHERE job_id = $1`,
          [terminal.jobId, terminalStatus],
        );
        const terminalMetadata = {
          attempt: 1,
          sequence: 3,
          inputVersionIds: [terminal.fileVersionId],
          resultHash: HASH_B,
        };
        assert.deepEqual(
          await commitFileScanResult(
            terminal.jobId,
            scanPayload,
            terminalMetadata,
          ),
          { applied: false, disposition: "obsolete" },
        );
        const terminalRows = await pool.query<{
          operation_status: string;
          validity_status: string;
          scan_count: string;
          event_count: string;
        }>(
          `SELECT job.operation_status, job.validity_status,
             (SELECT COUNT(*)::text FROM artifact_scan_result
               WHERE job_id = job.job_id) AS scan_count,
             (SELECT COUNT(*)::text FROM workflow_job_event
               WHERE job_id = job.job_id
                 AND event_type = 'worker_result_terminal_state') AS event_count
           FROM workflow_job job
           WHERE job.job_id = $1`,
          [terminal.jobId],
        );
        assert.deepEqual(terminalRows.rows[0], {
          operation_status: terminalStatus,
          validity_status: "current",
          scan_count: "0",
          event_count: "1",
        });
      }
    } finally {
      try {
        await pool.query(
          `DELETE FROM resource_artifact artifact
           USING resource_version version, versioned_resource resource
           WHERE artifact.resource_version_id = version.resource_version_id
             AND version.resource_id = resource.resource_id
             AND resource.project_id = $1`,
          [projectId],
        );
        await pool.query(
          `DELETE FROM project_file_version file
           USING resource_version version, versioned_resource resource
           WHERE file.resource_version_id = version.resource_version_id
             AND version.resource_id = resource.resource_id
             AND resource.project_id = $1`,
          [projectId],
        );
        await pool.query("DELETE FROM project WHERE project_id = $1", [
          projectId,
        ]);
        await pool.query("DELETE FROM user_account WHERE user_id = $1", [
          userId,
        ]);
      } finally {
        await pool.end();
      }
    }
  },
);
