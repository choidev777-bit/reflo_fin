import {
  Client,
  Connection,
  WorkflowExecutionAlreadyStartedError,
} from "@temporalio/client";
import { uuidv7 } from "../../domain/ids";
import { getPool } from "../database/pool";
import {
  listReconciliationCandidates,
  reconcileJobProjection,
} from "../repositories/file-repository";

declare global {
  var __refloTemporalClient: Promise<Client> | undefined;
  var __refloDispatcherRunning: boolean | undefined;
}

function temporalAddress(): string {
  return process.env.REFLO_TEMPORAL_ADDRESS?.trim() || "127.0.0.1:7233";
}

function temporalNamespace(): string {
  return process.env.REFLO_TEMPORAL_NAMESPACE?.trim() || "default";
}

export async function getTemporalClient(): Promise<Client> {
  globalThis.__refloTemporalClient ??= (async () => {
    const connection = await Connection.connect({ address: temporalAddress() });
    return new Client({ connection, namespace: temporalNamespace() });
  })();
  return globalThis.__refloTemporalClient;
}

type ClaimedOutbox = {
  outboxEventId: string;
  jobId: string;
  commandType: "start_workflow" | "cancel_workflow";
  payload: Record<string, unknown>;
};

async function claimOutbox(limit: number): Promise<ClaimedOutbox[]> {
  const client = await getPool().connect();
  const leaseOwner = `web:${process.pid}:${uuidv7()}`;
  try {
    await client.query("BEGIN");
    const result = await client.query<{
      outbox_event_id: string;
      job_id: string;
      command_type: "start_workflow" | "cancel_workflow";
      payload_json: Record<string, unknown>;
    }>(
      `SELECT outbox_event_id, job_id, command_type, payload_json
       FROM outbox_event
       WHERE (
         dispatch_status IN ('pending', 'failed')
         OR (
           dispatch_status = 'dispatching'
           AND lease_expires_at < now()
         )
       )
         AND next_attempt_at <= now()
       ORDER BY created_at
       FOR UPDATE SKIP LOCKED
       LIMIT $1`,
      [limit],
    );
    if (result.rows.length > 0) {
      await client.query(
        `UPDATE outbox_event
         SET dispatch_status = 'dispatching', lease_owner = $2,
             lease_expires_at = now() + interval '30 seconds',
             attempt_count = attempt_count + 1
         WHERE outbox_event_id = ANY($1::uuid[])`,
        [result.rows.map((row) => row.outbox_event_id), leaseOwner],
      );
    }
    await client.query("COMMIT");
    return result.rows.map((row) => ({
      outboxEventId: row.outbox_event_id,
      jobId: row.job_id,
      commandType: row.command_type,
      payload: row.payload_json,
    }));
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function markDispatched(outboxEventId: string): Promise<void> {
  await getPool().query(
    `UPDATE outbox_event
     SET dispatch_status = 'dispatched', dispatched_at = now(),
         lease_owner = NULL, lease_expires_at = NULL, last_error_code = NULL
     WHERE outbox_event_id = $1`,
    [outboxEventId],
  );
}

async function markDispatchFailed(
  outboxEventId: string,
  error: unknown,
): Promise<void> {
  const code =
    error instanceof Error
      ? error.name.replace(/[^A-Za-z0-9_]/g, "_").slice(0, 100)
      : "TEMPORAL_UNAVAILABLE";
  await getPool().query(
    `UPDATE outbox_event
     SET dispatch_status = 'failed', lease_owner = NULL, lease_expires_at = NULL,
         last_error_code = $2,
         next_attempt_at = now() + (
           LEAST(60, POWER(2, LEAST(attempt_count, 6)))::text || ' seconds'
         )::interval
     WHERE outbox_event_id = $1`,
    [outboxEventId, code],
  );
}

async function dispatchOne(row: ClaimedOutbox): Promise<void> {
  const client = await getTemporalClient();
  try {
    if (row.commandType === "cancel_workflow") {
      const workflowId =
        typeof row.payload.workflowId === "string"
          ? row.payload.workflowId
          : `reflo:${row.jobId}`;
      await client.workflow.getHandle(workflowId).cancel();
    } else {
      const workflowType = row.payload.workflowType;
      if (typeof workflowType !== "string") {
        throw new Error("OUTBOX_WORKFLOW_TYPE_MISSING");
      }
      await client.workflow.start(workflowType, {
        args: [row.payload],
        taskQueue: "workflow-control",
        workflowId: `reflo:${row.jobId}`,
      });
    }
    await markDispatched(row.outboxEventId);
  } catch (error) {
    if (error instanceof WorkflowExecutionAlreadyStartedError) {
      await markDispatched(row.outboxEventId);
      return;
    }
    await markDispatchFailed(row.outboxEventId, error);
    throw error;
  }
}

export async function dispatchPendingOutbox(limit = 10): Promise<number> {
  const rows = await claimOutbox(limit);
  for (const row of rows) {
    await dispatchOne(row).catch((error) => {
      if (process.env.NODE_ENV !== "production") {
        console.error(
          "REFLO outbox dispatch failed:",
          error instanceof Error ? error.message : "Unknown error",
        );
      }
    });
  }
  return rows.length;
}

export function kickOutboxDispatcher(): void {
  if (globalThis.__refloDispatcherRunning) return;
  globalThis.__refloDispatcherRunning = true;
  setTimeout(() => {
    void dispatchPendingOutbox()
      .catch((error) => {
        if (process.env.NODE_ENV !== "production") {
          console.error(
            "REFLO outbox dispatcher unavailable:",
            error instanceof Error ? error.message : "Unknown error",
          );
        }
      })
      .finally(() => {
        globalThis.__refloDispatcherRunning = false;
      });
  }, 0);
}

export async function reconcileActiveJobs(): Promise<void> {
  const candidates = (await listReconciliationCandidates(
    new Date(Date.now() - 60_000),
  )) as {
    jobs: Array<{
      jobId: string;
      workflowId: string;
      operationStatus: string;
    }>;
  };
  const temporal = await getTemporalClient();
  for (const job of candidates.jobs) {
    try {
      const description = await temporal.workflow.getHandle(job.workflowId).describe();
      const status = description.status.name.toLowerCase();
      const repairAction =
        status === "cancelled" && job.operationStatus === "cancel_requested"
          ? "mark_cancelled"
          : "none";
      await reconcileJobProjection({
        jobId: job.jobId,
        observedState: status,
        repairAction,
      });
    } catch {
      await reconcileJobProjection({
        jobId: job.jobId,
        observedState: "missing",
        repairAction:
          job.operationStatus === "queued" ? "none" : "mark_failed",
      });
      kickOutboxDispatcher();
    }
  }
}
