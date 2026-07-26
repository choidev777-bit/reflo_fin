import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import { assertValidatedWorkbookReady } from "../server/infrastructure/repositories/workbook-application-repository";
import { ApiError } from "../server/http/api-error";

const databaseUrl = process.env.REFLO_TEST_DATABASE_URL?.trim();
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);
const HASH_D = "d".repeat(64);

test(
  "Validation 완료는 새 Validated Workbook artifact가 없으면 fail closed한다",
  { skip: !databaseUrl },
  async () => {
    const pool = new Pool({ connectionString: databaseUrl });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const userId = randomUUID();
      const projectId = randomUUID();
      await client.query(
        `INSERT INTO user_account (user_id, display_name, email)
         VALUES ($1, 'Workbook Application Test', $2)`,
        [userId, `${userId}@example.test`],
      );
      await client.query(
        `INSERT INTO project (project_id, owner_user_id, name)
         VALUES ($1, $2, 'Workbook application integration')`,
        [projectId, userId],
      );

      await assert.rejects(
        () =>
          assertValidatedWorkbookReady(client, {
            projectId,
            validationRunId: randomUUID(),
            validationVersion: 1,
            approvedPlanResourceVersionId: randomUUID(),
          }),
        (error: unknown) =>
          error instanceof ApiError &&
          error.code === "VALIDATED_WORKBOOK_REQUIRED",
      );
    } finally {
      await client.query("ROLLBACK");
      client.release();
      await pool.end();
    }
  },
);

test(
  "Validation 완료는 현재 run과 승인 plan에 고정된 성공 Workbook만 선택한다",
  { skip: !databaseUrl },
  async (context) => {
    const pool = new Pool({ connectionString: databaseUrl });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const fixture = await client.query<{
        project_id: string;
        owner_user_id: string;
        approved_plan_resource_version_id: string;
        workbook_resource_version_id: string;
        mapping_set_resource_version_id: string;
        source_artifact_id: string;
        plan_content_hash: string;
      }>(
        `SELECT project.project_id, project.owner_user_id,
           plan.resource_version_id AS approved_plan_resource_version_id,
           plan.workbook_resource_version_id,
           plan.mapping_set_resource_version_id,
           source_file.artifact_id AS source_artifact_id,
           plan_resource.content_hash AS plan_content_hash
         FROM project
         JOIN research_plan
           ON research_plan.project_id = project.project_id
         JOIN research_plan_version plan
           ON plan.resource_version_id =
              research_plan.current_resource_version_id
          AND plan.status = 'approved'
         JOIN resource_version plan_resource
           ON plan_resource.resource_version_id = plan.resource_version_id
         JOIN workbook_version workbook
           ON workbook.resource_version_id =
              plan.workbook_resource_version_id
         JOIN project_file_version source_file
           ON source_file.resource_version_id =
              workbook.source_file_version_id
         ORDER BY project.created_at DESC
         LIMIT 1`,
      );
      const row = fixture.rows[0];
      if (!row) {
        context.skip("승인 research plan fixture가 없습니다.");
        return;
      }

      const sourceSnapshotId = randomUUID();
      await client.query(
        `INSERT INTO source_snapshot (
           source_snapshot_id, project_id, snapshot_scope,
           schema_version, fingerprint, components_json
         ) VALUES ($1, $2, 'validation_workbook', '1', $3, $4::jsonb)`,
        [
          sourceSnapshotId,
          row.project_id,
          HASH_A,
          JSON.stringify([
            {
              key: "approved_research_plan",
              versionId: row.approved_plan_resource_version_id,
              artifactId: null,
              contentHash: row.plan_content_hash,
            },
          ]),
        ],
      );

      const researchJobId = randomUUID();
      const researchRunId = randomUUID();
      const validationRunId = randomUUID();
      await client.query(
        `INSERT INTO workflow_job (
           job_id, project_id, job_type, temporal_workflow_id,
           operation_status, validity_status, input_fingerprint,
           requested_by_user_id, source_snapshot_id
         ) VALUES ($1, $2, 'research_collection', $3, 'succeeded',
           'current', $4, $5, $6)`,
        [
          researchJobId,
          row.project_id,
          `test:${researchJobId}`,
          HASH_A,
          row.owner_user_id,
          sourceSnapshotId,
        ],
      );
      await client.query(
        `INSERT INTO research_run (
           research_run_id, project_id, job_id,
           approved_plan_resource_version_id
         ) VALUES ($1, $2, $3, $4)`,
        [
          researchRunId,
          row.project_id,
          researchJobId,
          row.approved_plan_resource_version_id,
        ],
      );
      await client.query(
        `INSERT INTO validation_run (
           validation_run_id, project_id, research_run_id, rule_version,
           agent_profile_version, status, started_at, finished_at
         ) VALUES ($1, $2, $3, 'test-rule', 'test-agent', 'succeeded',
           now(), now())`,
        [validationRunId, row.project_id, researchRunId],
      );

      const valueResourceId = randomUUID();
      const valueVersionId = randomUUID();
      await client.query(
        `INSERT INTO versioned_resource (
           resource_id, project_id, resource_kind, resource_key
         ) VALUES ($1, $2, 'validated_value_set', $3)`,
        [valueResourceId, row.project_id, `test:${valueResourceId}`],
      );
      await client.query(
        `INSERT INTO resource_version (
           resource_version_id, resource_id, version_no, lifecycle_status,
           input_fingerprint, content_hash, created_by_user_id
         ) VALUES ($1, $2, 1, 'approved', $3, $4, $5)`,
        [
          valueVersionId,
          valueResourceId,
          HASH_A,
          HASH_B,
          row.owner_user_id,
        ],
      );
      await client.query(
        `INSERT INTO validated_value_set_version (
           resource_version_id, project_id, validation_run_id,
           validation_version, approved_plan_resource_version_id,
           source_snapshot_id, source_fingerprint, status, value_set_json,
           content_hash, approved_by_user_id
         ) VALUES ($1, $2, $3, 1, $4, $5, $6, 'approved',
           '{}'::jsonb, $7, $8)`,
        [
          valueVersionId,
          row.project_id,
          validationRunId,
          row.approved_plan_resource_version_id,
          sourceSnapshotId,
          HASH_A,
          HASH_B,
          row.owner_user_id,
        ],
      );

      const applicationJobId = randomUUID();
      const applicationId = randomUUID();
      await client.query(
        `INSERT INTO workflow_job (
           job_id, project_id, job_type, temporal_workflow_id,
           operation_status, validity_status, input_fingerprint,
           requested_by_user_id, source_snapshot_id
         ) VALUES ($1, $2, 'workbook_application', $3, 'succeeded',
           'current', $4, $5, $6)`,
        [
          applicationJobId,
          row.project_id,
          `test:${applicationJobId}`,
          HASH_A,
          row.owner_user_id,
          sourceSnapshotId,
        ],
      );
      await client.query(
        `INSERT INTO workbook_application_run (
           workbook_application_id, project_id, job_id,
           validated_value_set_resource_version_id,
           source_workbook_resource_version_id,
           mapping_set_resource_version_id, source_workbook_artifact_id,
           source_snapshot_id, source_fingerprint, application_plan_json,
           plan_hash, application_status, requested_by_user_id
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9,
           '{}'::jsonb, $10, 'running', $11)`,
        [
          applicationId,
          row.project_id,
          applicationJobId,
          valueVersionId,
          row.workbook_resource_version_id,
          row.mapping_set_resource_version_id,
          row.source_artifact_id,
          sourceSnapshotId,
          HASH_A,
          HASH_C,
          row.owner_user_id,
        ],
      );

      const outputArtifactId = randomUUID();
      await client.query(
        `INSERT INTO artifact (
           artifact_id, project_id, artifact_kind, storage_status,
           bucket_name, object_key, object_version, sha256, byte_size,
           media_type, original_filename, retention_class,
           created_by_actor_type, supersedes_artifact_id
         ) VALUES ($1, $2, 'working_copy', 'accepted', 'test',
           $3, '1', $4, 1,
           'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
           'validated.xlsx', 'project', 'worker', $5)`,
        [
          outputArtifactId,
          row.project_id,
          `test/${outputArtifactId}.xlsx`,
          HASH_D,
          row.source_artifact_id,
        ],
      );
      const workbookResourceId = randomUUID();
      const workbookVersionId = randomUUID();
      await client.query(
        `INSERT INTO versioned_resource (
           resource_id, project_id, resource_kind, resource_key
         ) VALUES ($1, $2, 'validated_workbook', $3)`,
        [
          workbookResourceId,
          row.project_id,
          `test:${workbookResourceId}`,
        ],
      );
      await client.query(
        `INSERT INTO resource_version (
           resource_version_id, resource_id, version_no, lifecycle_status,
           input_fingerprint, content_hash, created_by_actor_type
         ) VALUES ($1, $2, 1, 'approved', $3, $4, 'system')`,
        [workbookVersionId, workbookResourceId, HASH_A, HASH_D],
      );
      await client.query(
        `INSERT INTO validated_workbook_version (
           resource_version_id, project_id, workbook_application_id,
           source_workbook_resource_version_id,
           mapping_set_resource_version_id,
           validated_value_set_resource_version_id, artifact_id,
           workbook_version, structure_hash, formula_hash,
           calculation_status, calculation_report_json
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, 1, $8, $9,
           'success', '{}'::jsonb)`,
        [
          workbookVersionId,
          row.project_id,
          applicationId,
          row.workbook_resource_version_id,
          row.mapping_set_resource_version_id,
          valueVersionId,
          outputArtifactId,
          HASH_B,
          HASH_C,
        ],
      );
      await client.query(
        `UPDATE workbook_application_run
         SET application_status = 'succeeded',
             output_artifact_id = $2,
             output_workbook_resource_version_id = $3,
             finished_at = now()
         WHERE workbook_application_id = $1`,
        [applicationId, outputArtifactId, workbookVersionId],
      );

      await assert.rejects(
        () =>
          assertValidatedWorkbookReady(client, {
            projectId: row.project_id,
            validationRunId: randomUUID(),
            validationVersion: 1,
            approvedPlanResourceVersionId:
              row.approved_plan_resource_version_id,
          }),
        (error: unknown) =>
          error instanceof ApiError &&
          error.code === "VALIDATED_WORKBOOK_REQUIRED",
      );
      assert.deepEqual(
        await assertValidatedWorkbookReady(client, {
          projectId: row.project_id,
          validationRunId,
          validationVersion: 1,
          approvedPlanResourceVersionId:
            row.approved_plan_resource_version_id,
        }),
        {
          applicationId,
          validatedValueSetResourceVersionId: valueVersionId,
          validatedWorkbookResourceVersionId: workbookVersionId,
          validatedWorkbookArtifactId: outputArtifactId,
        },
      );

    } finally {
      await client.query("ROLLBACK").catch(() => undefined);
      client.release();
      await pool.end();
    }
  },
);
