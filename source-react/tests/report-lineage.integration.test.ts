import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import {
  decidePinnedWorkflowJobCommit,
  LineageInvariantError,
  pinWorkflowJobSourceSnapshot,
} from "../server/infrastructure/services/source-snapshot-service";
import { invalidateProjectStages } from "../server/infrastructure/services/dependency-invalidator";

const databaseUrl = process.env.REFLO_TEST_DATABASE_URL?.trim();
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

test(
  "Postgres source snapshots gate current, obsolete, duplicate, and conflicting commits",
  { skip: !databaseUrl },
  async () => {
    const pool = new Pool({ connectionString: databaseUrl });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const userId = randomUUID();
      const projectId = randomUUID();
      const resourceId = randomUUID();
      const firstVersionId = randomUUID();
      const jobId = randomUUID();
      await client.query(
        `INSERT INTO user_account (user_id, display_name, email)
         VALUES ($1, 'Lineage Test', $2)`,
        [userId, `${userId}@example.test`],
      );
      await client.query(
        `INSERT INTO project (project_id, owner_user_id, name)
         VALUES ($1, $2, 'Lineage integration')`,
        [projectId, userId],
      );
      await client.query(
        `INSERT INTO versioned_resource (
           resource_id, project_id, resource_kind, resource_key
         ) VALUES ($1, $2, 'integration_input', 'main')`,
        [resourceId, projectId],
      );
      await client.query(
        `INSERT INTO resource_version (
           resource_version_id, resource_id, version_no, lifecycle_status,
           input_fingerprint, content_hash, created_by_user_id
         ) VALUES ($1, $2, 1, 'approved', $3, $3, $4)`,
        [firstVersionId, resourceId, HASH_A, userId],
      );
      await client.query(
        `INSERT INTO workflow_job (
           job_id, project_id, job_type, temporal_workflow_id,
           input_fingerprint, requested_by_user_id
         ) VALUES ($1, $2, 'file_ingest', $3, $4, $5)`,
        [jobId, projectId, `lineage:${jobId}`, HASH_A, userId],
      );
      await client.query(
        `INSERT INTO workflow_job_input (
           job_id, input_role, resource_version_id
         ) VALUES ($1, 'source', $2)`,
        [jobId, firstVersionId],
      );

      const pinned = await pinWorkflowJobSourceSnapshot(client, { jobId });
      const current = await decidePinnedWorkflowJobCommit(client, {
        jobId,
        attempt: 1,
        sequence: 1,
        resultInputVersionIds: [firstVersionId],
        resultHash: HASH_A,
      });
      assert.equal(current.decision, "current");
      assert.equal(current.pinnedFingerprint, pinned.fingerprint);

      const secondVersionId = randomUUID();
      await client.query(
        `INSERT INTO resource_version (
           resource_version_id, resource_id, version_no, lifecycle_status,
           supersedes_version_id, input_fingerprint, content_hash,
           created_by_user_id
         ) VALUES ($1, $2, 2, 'draft', $3, $4, $4, $5)`,
        [secondVersionId, resourceId, firstVersionId, HASH_B, userId],
      );
      const obsolete = await decidePinnedWorkflowJobCommit(client, {
        jobId,
        attempt: 1,
        sequence: 1,
        resultInputVersionIds: [firstVersionId],
        resultHash: HASH_A,
      });
      assert.equal(obsolete.decision, "obsolete");
      const lateAttempt = await decidePinnedWorkflowJobCommit(client, {
        jobId,
        attempt: 2,
        sequence: 1,
        resultInputVersionIds: [firstVersionId],
        resultHash: HASH_A,
      });
      assert.equal(lateAttempt.decision, "obsolete");
      assert.equal(lateAttempt.attemptMatches, false);

      await assert.rejects(
        () =>
          decidePinnedWorkflowJobCommit(client, {
            jobId,
            attempt: 1,
            sequence: 1,
            resultInputVersionIds: [secondVersionId],
            resultHash: HASH_A,
          }),
        (error: unknown) =>
          error instanceof LineageInvariantError &&
          error.code === "WORKER_RESULT_INPUT_VERSION_MISMATCH",
      );

      await client.query(
        `UPDATE workflow_job
         SET operation_status = 'succeeded',
             result_summary_json = $2::jsonb
         WHERE job_id = $1`,
        [
          jobId,
          JSON.stringify({
            workerResult: {
              attempt: 1,
              sequence: 1,
              inputVersionIds: [firstVersionId],
              hash: HASH_A,
            },
          }),
        ],
      );
      const duplicate = await decidePinnedWorkflowJobCommit(client, {
        jobId,
        attempt: 1,
        sequence: 1,
        resultInputVersionIds: [firstVersionId],
        resultHash: HASH_A,
      });
      assert.equal(duplicate.decision, "duplicate");

      await assert.rejects(
        () =>
          decidePinnedWorkflowJobCommit(client, {
            jobId,
            attempt: 1,
            sequence: 1,
            resultInputVersionIds: [firstVersionId],
            resultHash: HASH_B,
          }),
        (error: unknown) =>
          error instanceof LineageInvariantError &&
          error.code === "WORKER_RESULT_HASH_CONFLICT",
      );
    } finally {
      await client.query("ROLLBACK");
      client.release();
      await pool.end();
    }
  },
);

test(
  "Postgres shared invalidator records plan revalidation and updates downstream stages",
  { skip: !databaseUrl },
  async () => {
    const pool = new Pool({ connectionString: databaseUrl });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const userId = randomUUID();
      const projectId = randomUUID();
      const resourceId = randomUUID();
      const triggerVersionId = randomUUID();
      const researchCompletionId = randomUUID();
      const validationCompletionId = randomUUID();
      await client.query(
        `INSERT INTO user_account (user_id, display_name, email)
         VALUES ($1, 'Invalidation Test', $2)`,
        [userId, `${userId}@example.test`],
      );
      await client.query(
        `INSERT INTO project (
           project_id, owner_user_id, name, project_status
         ) VALUES ($1, $2, 'Invalidation integration', 'active')`,
        [projectId, userId],
      );
      await client.query(
        `INSERT INTO versioned_resource (
           resource_id, project_id, resource_kind, resource_key
         ) VALUES ($1, $2, 'research_plan', 'main')`,
        [resourceId, projectId],
      );
      await client.query(
        `INSERT INTO resource_version (
           resource_version_id, resource_id, version_no, lifecycle_status,
           input_fingerprint, content_hash, created_by_user_id
         ) VALUES ($1, $2, 1, 'approved', $3, $3, $4)`,
        [triggerVersionId, resourceId, HASH_A, userId],
      );
      await client.query(
        `INSERT INTO stage_completion (
           stage_completion_id, project_id, stage_key, completion_no,
           primary_version_id, completed_by_user_id
         ) VALUES
           ($1, $3, 'research_plan', 1, $4, $5),
           ($2, $3, 'validation', 1, $4, $5)`,
        [
          researchCompletionId,
          validationCompletionId,
          projectId,
          triggerVersionId,
          userId,
        ],
      );
      await client.query(
        `INSERT INTO project_stage_state (
           project_id, stage_key, stage_order, stage_status,
           current_completion_id, blocker_codes, completed_at
         ) VALUES
           ($1, 'research_plan', 4, 'completed', $2, '{}', now()),
           ($1, 'validation', 5, 'completed', $3, '{}', now())`,
        [projectId, researchCompletionId, validationCompletionId],
      );

      const affected = await invalidateProjectStages(client, {
        projectId,
        triggerVersionId,
        startStageKey: "research_plan",
        reasonCode: "PLAN_REVALIDATION_REQUIRED",
        transitions: [
          {
            stageKey: "research_plan",
            stageStatus: "in_progress",
            blockerCodes: [],
            clearCompletion: true,
          },
          {
            stageKey: "validation",
            stageStatus: "blocked",
            blockerCodes: ["PLAN_REVALIDATION_REQUIRED"],
          },
        ],
        markProjectRevalidation: true,
      });
      assert.deepEqual(affected, ["research_plan", "validation"]);

      const stageResult = await client.query<{
        stage_key: string;
        stage_status: string;
        current_completion_id: string | null;
        blocker_codes: string[];
      }>(
        `SELECT stage_key, stage_status, current_completion_id, blocker_codes
         FROM project_stage_state
         WHERE project_id = $1
         ORDER BY stage_order`,
        [projectId],
      );
      assert.deepEqual(stageResult.rows, [
        {
          stage_key: "research_plan",
          stage_status: "in_progress",
          current_completion_id: null,
          blocker_codes: [],
        },
        {
          stage_key: "validation",
          stage_status: "blocked",
          current_completion_id: validationCompletionId,
          blocker_codes: ["PLAN_REVALIDATION_REQUIRED"],
        },
      ]);
      const auditResult = await client.query<{
        reason_code: string;
        affected_stage_keys: string[];
        project_status: string;
        completion_count: string;
      }>(
        `SELECT event.reason_code, event.affected_stage_keys,
           project.project_status,
           (
             SELECT COUNT(*)::text
             FROM stage_completion completion
             WHERE completion.project_id = project.project_id
               AND completion.validity_status = 'revalidation_required'
           ) AS completion_count
         FROM project_invalidation_event event
         JOIN project ON project.project_id = event.project_id
         WHERE event.project_id = $1`,
        [projectId],
      );
      assert.deepEqual(auditResult.rows[0], {
        reason_code: "PLAN_REVALIDATION_REQUIRED",
        affected_stage_keys: ["research_plan", "validation"],
        project_status: "revalidation_required",
        completion_count: "2",
      });
    } finally {
      await client.query("ROLLBACK");
      client.release();
      await pool.end();
    }
  },
);
