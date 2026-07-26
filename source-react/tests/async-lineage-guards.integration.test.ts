import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { Pool } from "pg";
import {
  decidePinnedWorkflowJobCommit,
  lateResultRequiresAuditOnly,
  pinWorkflowJobSourceSnapshot,
  recordLateWorkflowJobResult,
} from "../server/infrastructure/services/source-snapshot-service";
import { invalidateResourceDependents } from "../server/infrastructure/services/dependency-invalidator";

const databaseUrl = process.env.REFLO_TEST_DATABASE_URL?.trim();
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

type SeededJob = {
  userId: string;
  projectId: string;
  resourceId: string;
  resourceVersionId: string;
  jobId: string;
};

async function seedPinnedJob(
  pool: Pool,
  input: {
    jobType?: "file_ingest" | "research_collection";
    inputRole?: string;
  } = {},
): Promise<SeededJob> {
  const userId = randomUUID();
  const projectId = randomUUID();
  const resourceId = randomUUID();
  const resourceVersionId = randomUUID();
  const jobId = randomUUID();
  await pool.query(
    `INSERT INTO user_account (user_id, display_name, email)
     VALUES ($1, 'Async lineage guard', $2)`,
    [userId, `${userId}@example.test`],
  );
  await pool.query(
    `INSERT INTO project (project_id, owner_user_id, name)
     VALUES ($1, $2, 'Async lineage guard')`,
    [projectId, userId],
  );
  await pool.query(
    `INSERT INTO versioned_resource (
       resource_id, project_id, resource_kind, resource_key
     ) VALUES ($1, $2, 'integration_input', $3)`,
    [resourceId, projectId, resourceId],
  );
  await pool.query(
    `INSERT INTO resource_version (
       resource_version_id, resource_id, version_no, lifecycle_status,
       input_fingerprint, content_hash, created_by_user_id
     ) VALUES ($1, $2, 1, 'approved', $3, $3, $4)`,
    [resourceVersionId, resourceId, HASH_A, userId],
  );
  await pool.query(
    `INSERT INTO workflow_job (
       job_id, project_id, job_type, temporal_workflow_id,
       input_fingerprint, requested_by_user_id
     ) VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      jobId,
      projectId,
      input.jobType ?? "file_ingest",
      `lineage-guard:${jobId}`,
      HASH_A,
      userId,
    ],
  );
  await pool.query(
    `INSERT INTO workflow_job_input (
       job_id, input_role, resource_version_id
     ) VALUES ($1, $2, $3)`,
    [jobId, input.inputRole ?? "source", resourceVersionId],
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
  return { userId, projectId, resourceId, resourceVersionId, jobId };
}

async function cleanupSeed(pool: Pool, seed: SeededJob): Promise<void> {
  await pool.query("DELETE FROM project WHERE project_id = $1", [
    seed.projectId,
  ]);
  await pool.query("DELETE FROM user_account WHERE user_id = $1", [
    seed.userId,
  ]);
}

test(
  "cancelled or late-attempt results are audit-only and preserve the job state",
  { skip: !databaseUrl },
  async () => {
    const pool = new Pool({ connectionString: databaseUrl });
    const seed = await seedPinnedJob(pool);
    try {
      await pool.query(
        `UPDATE workflow_job
         SET operation_status = 'cancel_requested'
         WHERE job_id = $1`,
        [seed.jobId],
      );
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const decision = await decidePinnedWorkflowJobCommit(client, {
          jobId: seed.jobId,
          attempt: 1,
          sequence: 3,
          resultInputVersionIds: [seed.resourceVersionId],
          resultHash: HASH_B,
        });
        assert.equal(decision.decision, "obsolete");
        assert.equal(decision.operationStatus, "cancel_requested");
        assert.equal(lateResultRequiresAuditOnly(decision), true);
        await recordLateWorkflowJobResult(client, {
          jobId: seed.jobId,
          metadata: {
            attempt: 1,
            sequence: 3,
            inputVersionIds: [seed.resourceVersionId],
            resultHash: HASH_B,
          },
          reason: "WORKFLOW_JOB_CANCEL_REQUESTED",
        });
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
      const state = await pool.query<{
        operation_status: string;
        event_count: string;
      }>(
        `SELECT job.operation_status,
           (
             SELECT COUNT(*)::text
             FROM workflow_job_event event
             WHERE event.job_id = job.job_id
               AND event.event_type = 'worker_result_terminal_state'
           ) AS event_count
         FROM workflow_job job
         WHERE job.job_id = $1`,
        [seed.jobId],
      );
      assert.deepEqual(state.rows[0], {
        operation_status: "cancel_requested",
        event_count: "1",
      });
    } finally {
      await cleanupSeed(pool, seed);
      await pool.end();
    }
  },
);

test(
  "a result recheck holds the lineage lock through commit",
  { skip: !databaseUrl },
  async () => {
    const pool = new Pool({ connectionString: databaseUrl });
    const seed = await seedPinnedJob(pool);
    const resultClient = await pool.connect();
    const writerClient = await pool.connect();
    try {
      await resultClient.query("BEGIN");
      const decision = await decidePinnedWorkflowJobCommit(resultClient, {
        jobId: seed.jobId,
        attempt: 1,
        sequence: 3,
        resultInputVersionIds: [seed.resourceVersionId],
        resultHash: HASH_B,
      });
      assert.equal(decision.decision, "current");

      await writerClient.query("BEGIN");
      let writerSettled = false;
      const writer = writerClient
        .query(
          `INSERT INTO resource_version (
             resource_version_id, resource_id, version_no, lifecycle_status,
             supersedes_version_id, input_fingerprint, content_hash,
             created_by_user_id
           ) VALUES ($1, $2, 2, 'draft', $3, $4, $4, $5)`,
          [
            randomUUID(),
            seed.resourceId,
            seed.resourceVersionId,
            HASH_B,
            seed.userId,
          ],
        )
        .then(() => {
          writerSettled = true;
        });
      await delay(75);
      assert.equal(
        writerSettled,
        false,
        "a source writer must wait until the result transaction commits",
      );
      await resultClient.query("COMMIT");
      await writer;
      assert.equal(writerSettled, true);
      await writerClient.query("ROLLBACK");
    } catch (error) {
      await resultClient.query("ROLLBACK").catch(() => undefined);
      await writerClient.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      resultClient.release();
      writerClient.release();
      await cleanupSeed(pool, seed);
      await pool.end();
    }
  },
);

test(
  "a new-resource authoritative pointer switch obsoletes the running research job",
  { skip: !databaseUrl },
  async () => {
    const pool = new Pool({ connectionString: databaseUrl });
    const seed = await seedPinnedJob(pool, {
      jobType: "research_collection",
      inputRole: "hypothesis_questions",
    });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const nextResourceId = randomUUID();
      const nextResourceVersionId = randomUUID();
      await client.query(
        `INSERT INTO versioned_resource (
           resource_id, project_id, resource_kind, resource_key
         ) VALUES ($1, $2, 'hypothesis_question_set', $3)`,
        [nextResourceId, seed.projectId, nextResourceId],
      );
      await client.query(
        `INSERT INTO resource_version (
           resource_version_id, resource_id, version_no, lifecycle_status,
           input_fingerprint, content_hash, created_by_user_id
         ) VALUES ($1, $2, 1, 'draft', $3, $3, $4)`,
        [nextResourceVersionId, nextResourceId, HASH_B, seed.userId],
      );
      const invalidated = await invalidateResourceDependents(client, {
        projectId: seed.projectId,
        upstreamResourceVersionIds: [seed.resourceVersionId],
      });
      assert.deepEqual(invalidated.workflowJobIds, [seed.jobId]);
      const decision = await decidePinnedWorkflowJobCommit(client, {
        jobId: seed.jobId,
        attempt: 1,
        sequence: 8,
        resultInputVersionIds: [seed.resourceVersionId],
        resultHash: HASH_B,
      });
      assert.equal(decision.decision, "obsolete");
      assert.equal(decision.validityStatus, "obsolete");
      await client.query("ROLLBACK");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
      await cleanupSeed(pool, seed);
      await pool.end();
    }
  },
);
