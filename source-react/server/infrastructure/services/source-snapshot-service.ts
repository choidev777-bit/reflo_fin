import {
  canonicalSourceSnapshot,
  decideSnapshotCommit,
  type CanonicalSourceSnapshot,
  type SnapshotCommitDecision,
  type SourceSnapshotComponent,
  type SourceSnapshotInput,
  type SourceSnapshotScope,
} from "../../domain/report-lineage";
import { uuidv7 } from "../../domain/ids";
import type { WorkerResultCommitMetadata } from "../../domain/worker-result-contract";
import type { TransactionClient } from "../database/transaction";

type SourceSnapshotRow = {
  source_snapshot_id: string;
  project_id: string;
  snapshot_scope: SourceSnapshotScope;
  schema_version: string;
  fingerprint: string;
  components_json: unknown;
  created_at: Date;
};

type WorkflowJobSnapshotRow = {
  project_id: string;
  operation_status: string;
  validity_status: "current" | "obsolete";
  attempt: number;
  input_fingerprint: string;
  source_snapshot_id: string | null;
  fingerprint: string | null;
};

type WorkflowJobInputSnapshotRow = {
  project_id: string;
  input_role: string;
  resource_version_id: string | null;
  content_hash: string | null;
  artifact_id: string | null;
};

type WorkflowJobResultStateRow = {
  project_id: string;
  attempt: number;
  progress_sequence: string;
  operation_status: string;
  validity_status: "current" | "obsolete";
  source_snapshot_id: string | null;
  result_summary_json: unknown;
};

export type PersistedSourceSnapshot = CanonicalSourceSnapshot & {
  sourceSnapshotId: string;
  createdAt: Date;
};

export type WorkflowJobSnapshotDecision = {
  decision: SnapshotCommitDecision;
  sourceSnapshotId: string;
  pinnedFingerprint: string;
  currentFingerprint: string;
};

export type PinnedWorkflowJobCommitDecision = WorkflowJobSnapshotDecision & {
  attemptMatches: boolean;
  inputVersionIdsMatch: boolean;
  resultHashMatches: boolean | null;
  operationStatus: string;
  validityStatus: "current" | "obsolete";
};

export class LineageInvariantError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "LineageInvariantError";
  }
}

function invariant(code: string): never {
  throw new LineageInvariantError(code);
}

export async function acquireProjectLineageLock(
  client: TransactionClient,
  projectId: string,
): Promise<void> {
  await client.query(
    `SELECT pg_advisory_xact_lock(
       hashtextextended('reflo:lineage:' || $1::text, 0)
     )`,
    [projectId],
  );
}

export async function lockWorkflowJobLineage(
  client: TransactionClient,
  input: { jobId: string },
): Promise<{ projectId: string }> {
  const result = await client.query<{ project_id: string }>(
    `SELECT project_id
     FROM workflow_job
     WHERE job_id = $1`,
    [input.jobId],
  );
  const job = result.rows[0];
  if (!job) invariant("WORKFLOW_JOB_NOT_FOUND");
  await acquireProjectLineageLock(client, job.project_id);
  return { projectId: job.project_id };
}

export function lateResultRequiresAuditOnly(
  decision: Pick<
    PinnedWorkflowJobCommitDecision,
    "decision" | "attemptMatches" | "operationStatus"
  >,
): boolean {
  return (
    decision.decision !== "duplicate" &&
    (!decision.attemptMatches ||
      !["queued", "running"].includes(decision.operationStatus))
  );
}

export async function recordLateWorkflowJobResult(
  client: TransactionClient,
  input: {
    jobId: string;
    metadata: WorkerResultCommitMetadata;
    reason: string;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO workflow_job_event (
       job_event_id, job_id, sequence_no, event_type, operation_status,
       phase, metadata_json, occurred_at
     )
     SELECT $1, job.job_id,
       9000000000000000000 + COALESCE((
         SELECT COUNT(*)
         FROM workflow_job_event event
         WHERE event.job_id = job.job_id
           AND event.sequence_no >= 9000000000000000000
       ), 0) + 1,
       CASE
         WHEN job.attempt <> $3 THEN 'worker_result_late_attempt'
         ELSE 'worker_result_terminal_state'
       END,
       job.operation_status, job.current_phase, $4::jsonb, now()
     FROM workflow_job job
     WHERE job.job_id = $2
       AND NOT EXISTS (
         SELECT 1
         FROM workflow_job_event event
         WHERE event.job_id = job.job_id
           AND event.metadata_json #>> '{workerResult,hash}' = $5
           AND event.metadata_json #>> '{workerResult,attempt}' = $3::text
           AND event.metadata_json #>> '{workerResult,sequence}' = $6::text
       )`,
    [
      uuidv7(),
      input.jobId,
      input.metadata.attempt,
      JSON.stringify({
        reason: input.reason,
        workerResult: {
          attempt: input.metadata.attempt,
          sequence: input.metadata.sequence,
          inputVersionIds: input.metadata.inputVersionIds,
          hash: input.metadata.resultHash,
        },
      }),
      input.metadata.resultHash,
      input.metadata.sequence,
    ],
  );
}

function componentsFromJson(value: unknown): SourceSnapshotComponent[] {
  if (!Array.isArray(value)) invariant("SOURCE_SNAPSHOT_COMPONENTS_CORRUPT");
  return value.map((component) => {
    if (typeof component !== "object" || component === null) {
      return invariant("SOURCE_SNAPSHOT_COMPONENTS_CORRUPT");
    }
    const candidate = component as Record<string, unknown>;
    if (
      typeof candidate.key !== "string" ||
      (candidate.versionId !== null &&
        typeof candidate.versionId !== "string") ||
      (candidate.artifactId !== null &&
        typeof candidate.artifactId !== "string") ||
      (candidate.contentHash !== null &&
        typeof candidate.contentHash !== "string")
    ) {
      return invariant("SOURCE_SNAPSHOT_COMPONENTS_CORRUPT");
    }
    return {
      key: candidate.key,
      versionId: candidate.versionId,
      artifactId: candidate.artifactId,
      contentHash: candidate.contentHash,
    };
  });
}

function snapshotFromRow(row: SourceSnapshotRow): PersistedSourceSnapshot {
  const canonical = canonicalSourceSnapshot({
    projectId: row.project_id,
    scope: row.snapshot_scope,
    schemaVersion: row.schema_version,
    components: componentsFromJson(row.components_json),
  });
  const storedFingerprint = row.fingerprint.trim().toLowerCase();
  if (canonical.fingerprint !== storedFingerprint) {
    invariant("SOURCE_SNAPSHOT_FINGERPRINT_CORRUPT");
  }
  return {
    ...canonical,
    sourceSnapshotId: row.source_snapshot_id,
    createdAt: row.created_at,
  };
}

export async function persistSourceSnapshot(
  client: TransactionClient,
  input: SourceSnapshotInput,
): Promise<PersistedSourceSnapshot> {
  const snapshot = canonicalSourceSnapshot(input);
  const result = await client.query<SourceSnapshotRow>(
    `INSERT INTO source_snapshot (
       source_snapshot_id, project_id, snapshot_scope, schema_version,
       fingerprint, components_json
     ) VALUES ($1, $2, $3, $4, $5, $6::jsonb)
     ON CONFLICT (project_id, snapshot_scope, schema_version, fingerprint)
     DO UPDATE SET fingerprint = EXCLUDED.fingerprint
     RETURNING source_snapshot_id, project_id, snapshot_scope,
       schema_version, fingerprint, components_json, created_at`,
    [
      uuidv7(),
      snapshot.projectId,
      snapshot.scope,
      snapshot.schemaVersion,
      snapshot.fingerprint,
      JSON.stringify(snapshot.components),
    ],
  );
  return snapshotFromRow(result.rows[0]);
}

export async function loadSourceSnapshot(
  client: TransactionClient,
  sourceSnapshotId: string,
  options: { lock?: boolean } = {},
): Promise<PersistedSourceSnapshot | null> {
  const result = await client.query<SourceSnapshotRow>(
    `SELECT source_snapshot_id, project_id, snapshot_scope, schema_version,
       fingerprint, components_json, created_at
     FROM source_snapshot
     WHERE source_snapshot_id = $1
     ${options.lock ? "FOR UPDATE" : ""}`,
    [sourceSnapshotId],
  );
  return result.rows[0] ? snapshotFromRow(result.rows[0]) : null;
}

export async function attachSourceSnapshotToWorkflowJob(
  client: TransactionClient,
  input: { jobId: string; sourceSnapshotId: string },
): Promise<void> {
  const result = await client.query<{ source_snapshot_id: string }>(
    `UPDATE workflow_job job
     SET source_snapshot_id = snapshot.source_snapshot_id
     FROM source_snapshot snapshot
     WHERE job.job_id = $1
       AND snapshot.source_snapshot_id = $2
       AND snapshot.project_id = job.project_id
       AND job.input_fingerprint = snapshot.fingerprint
       AND (
         job.source_snapshot_id IS NULL
         OR job.source_snapshot_id = snapshot.source_snapshot_id
       )
     RETURNING job.source_snapshot_id`,
    [input.jobId, input.sourceSnapshotId],
  );
  if (!result.rows[0]) {
    invariant("WORKFLOW_JOB_SOURCE_SNAPSHOT_CONFLICT");
  }
}

async function workflowJobSourceSnapshotInput(
  client: TransactionClient,
  input: { jobId: string; currentVersions: boolean },
): Promise<SourceSnapshotInput> {
  const result = await client.query<WorkflowJobInputSnapshotRow>(
    `WITH pinned AS (
       SELECT job.project_id, input.input_role, version.resource_id,
         version.resource_version_id, version.content_hash
       FROM workflow_job job
       JOIN workflow_job_input input ON input.job_id = job.job_id
       JOIN resource_version version
         ON version.resource_version_id = input.resource_version_id
       WHERE job.job_id = $1
     ),
     current_version AS (
       SELECT DISTINCT ON (version.resource_id)
         version.resource_id, version.resource_version_id, version.content_hash
       FROM resource_version version
       WHERE version.lifecycle_status IN ('draft', 'approved')
         AND version.validity_status <> 'obsolete'
       ORDER BY version.resource_id, version.version_no DESC
     )
     SELECT pinned.project_id, pinned.input_role,
       CASE WHEN $2::boolean
         THEN current.resource_version_id
         ELSE pinned.resource_version_id
       END AS resource_version_id,
       CASE WHEN $2::boolean
         THEN current.content_hash
         ELSE pinned.content_hash
       END AS content_hash,
       (
         SELECT MIN(artifact.artifact_id::text)
         FROM resource_artifact artifact
         WHERE artifact.resource_version_id = CASE WHEN $2::boolean
           THEN current.resource_version_id
           ELSE pinned.resource_version_id
         END
       ) AS artifact_id
     FROM pinned
     LEFT JOIN current_version current
       ON current.resource_id = pinned.resource_id
     ORDER BY pinned.input_role`,
    [input.jobId, input.currentVersions],
  );
  if (result.rows.length === 0) {
    invariant("WORKFLOW_JOB_INPUTS_MISSING");
  }
  const projectId = result.rows[0].project_id;
  if (result.rows.some((row) => row.project_id !== projectId)) {
    invariant("WORKFLOW_JOB_INPUT_PROJECT_MISMATCH");
  }
  return {
    projectId,
    scope: "workflow_job",
    schemaVersion: "1",
    components: result.rows.map((row) => ({
      key: row.input_role,
      versionId: row.resource_version_id,
      artifactId: row.artifact_id,
      contentHash: row.content_hash,
    })),
  };
}

export async function pinWorkflowJobSourceSnapshot(
  client: TransactionClient,
  input: { jobId: string },
): Promise<PersistedSourceSnapshot> {
  await lockWorkflowJobLineage(client, input);
  const snapshotInput = await workflowJobSourceSnapshotInput(client, {
    jobId: input.jobId,
    currentVersions: false,
  });
  const snapshot = await persistSourceSnapshot(client, snapshotInput);
  const updated = await client.query<{ job_id: string }>(
    `UPDATE workflow_job
     SET input_fingerprint = $2
     WHERE job_id = $1
       AND (source_snapshot_id IS NULL OR source_snapshot_id = $3)
     RETURNING job_id`,
    [input.jobId, snapshot.fingerprint, snapshot.sourceSnapshotId],
  );
  if (!updated.rows[0]) {
    invariant("WORKFLOW_JOB_SOURCE_SNAPSHOT_CONFLICT");
  }
  await attachSourceSnapshotToWorkflowJob(client, {
    jobId: input.jobId,
    sourceSnapshotId: snapshot.sourceSnapshotId,
  });
  return snapshot;
}

function workerResultState(value: unknown): {
  hash: string | null;
  sequence: number | null;
} {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { hash: null, sequence: null };
  }
  const workerResult = (value as Record<string, unknown>).workerResult;
  if (
    typeof workerResult !== "object" ||
    workerResult === null ||
    Array.isArray(workerResult)
  ) {
    return { hash: null, sequence: null };
  }
  const record = workerResult as Record<string, unknown>;
  return {
    hash:
      typeof record.hash === "string" && /^[a-f0-9]{64}$/.test(record.hash)
        ? record.hash
        : null,
    sequence:
      Number.isInteger(record.sequence) && Number(record.sequence) > 0
        ? Number(record.sequence)
        : null,
  };
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return rightSet.size === right.length && left.every((value) => rightSet.has(value));
}

export function snapshotInputVersionIds(
  components: readonly Pick<SourceSnapshotComponent, "versionId">[],
): string[] {
  return [
    ...new Set(
      components.flatMap((component) =>
        component.versionId === null ? [] : [component.versionId],
      ),
    ),
  ].sort((left, right) => left.localeCompare(right));
}

export async function decidePinnedWorkflowJobCommit(
  client: TransactionClient,
  input: {
    jobId: string;
    attempt: number;
    sequence: number;
    resultInputVersionIds: readonly string[];
    resultHash: string;
  },
): Promise<PinnedWorkflowJobCommitDecision> {
  await lockWorkflowJobLineage(client, { jobId: input.jobId });
  const jobResult = await client.query<WorkflowJobResultStateRow>(
    `SELECT project_id, attempt, progress_sequence, operation_status,
       validity_status, source_snapshot_id, result_summary_json
     FROM workflow_job
     WHERE job_id = $1
     FOR UPDATE`,
    [input.jobId],
  );
  const job = jobResult.rows[0];
  if (!job) invariant("WORKFLOW_JOB_NOT_FOUND");
  if (!job.source_snapshot_id) {
    invariant("WORKFLOW_JOB_SOURCE_SNAPSHOT_MISSING");
  }
  const pinned = await loadSourceSnapshot(client, job.source_snapshot_id);
  if (!pinned) invariant("SOURCE_SNAPSHOT_NOT_FOUND");

  const pinnedVersionIds = snapshotInputVersionIds(pinned.components);
  const inputVersionIdsMatch = sameStringSet(
    pinnedVersionIds,
    input.resultInputVersionIds,
  );
  if (!inputVersionIdsMatch) {
    invariant("WORKER_RESULT_INPUT_VERSION_MISMATCH");
  }
  if (!/^[a-f0-9]{64}$/.test(input.resultHash)) {
    invariant("WORKER_RESULT_HASH_INVALID");
  }

  const attemptMatches = job.attempt === input.attempt;
  const compareWithCommittedResult =
    attemptMatches &&
    ["queued", "running", "succeeded"].includes(job.operation_status);
  const priorResult = workerResultState(job.result_summary_json);
  const resultHashMatches =
    !compareWithCommittedResult || priorResult.hash === null
      ? null
      : priorResult.hash === input.resultHash;
  if (
    compareWithCommittedResult &&
    priorResult.hash !== null &&
    !resultHashMatches
  ) {
    invariant("WORKER_RESULT_HASH_CONFLICT");
  }
  if (
    compareWithCommittedResult &&
    ((priorResult.sequence !== null &&
      input.sequence < priorResult.sequence) ||
      (priorResult.sequence === null &&
        input.sequence <= Number(job.progress_sequence)))
  ) {
    invariant("WORKER_RESULT_SEQUENCE_OUT_OF_ORDER");
  }

  const currentSnapshot = await workflowJobSourceSnapshotInput(client, {
    jobId: input.jobId,
    currentVersions: true,
  });
  const resultAlreadyCommitted =
    resultHashMatches === true ||
    (attemptMatches &&
      job.operation_status === "succeeded" &&
      priorResult.hash === null);
  const decision = await decideWorkflowJobSnapshotCommit(client, {
    jobId: input.jobId,
    attempt: input.attempt,
    currentSnapshot,
    resultAlreadyCommitted,
  });
  return {
    ...decision,
    attemptMatches,
    inputVersionIdsMatch,
    resultHashMatches,
    operationStatus: job.operation_status,
    validityStatus: job.validity_status,
  };
}

export async function decideWorkflowJobSnapshotCommit(
  client: TransactionClient,
  input: {
    jobId: string;
    attempt: number;
    currentSnapshot: SourceSnapshotInput;
    resultAlreadyCommitted?: boolean;
  },
): Promise<WorkflowJobSnapshotDecision> {
  await lockWorkflowJobLineage(client, { jobId: input.jobId });
  const jobResult = await client.query<WorkflowJobSnapshotRow>(
    `SELECT job.project_id, job.operation_status, job.validity_status,
       job.attempt, job.input_fingerprint, job.source_snapshot_id,
       snapshot.fingerprint
     FROM workflow_job job
     LEFT JOIN source_snapshot snapshot
       ON snapshot.source_snapshot_id = job.source_snapshot_id
     WHERE job.job_id = $1
     FOR UPDATE OF job`,
    [input.jobId],
  );
  const job = jobResult.rows[0];
  if (!job) invariant("WORKFLOW_JOB_NOT_FOUND");
  if (!job.source_snapshot_id || !job.fingerprint) {
    invariant("WORKFLOW_JOB_SOURCE_SNAPSHOT_MISSING");
  }

  const current = canonicalSourceSnapshot(input.currentSnapshot);
  if (current.projectId !== job.project_id) {
    invariant("WORKFLOW_JOB_SOURCE_SNAPSHOT_PROJECT_MISMATCH");
  }
  const pinnedFingerprint = job.fingerprint.trim().toLowerCase();
  if (job.input_fingerprint.trim().toLowerCase() !== pinnedFingerprint) {
    invariant("WORKFLOW_JOB_INPUT_FINGERPRINT_MISMATCH");
  }
  const attemptMismatch = job.attempt !== input.attempt;
  const duplicate =
    !attemptMismatch &&
    (input.resultAlreadyCommitted === true ||
      job.operation_status === "succeeded");
  const invalidJobState =
    job.validity_status === "obsolete" ||
    !["queued", "running", "succeeded"].includes(job.operation_status);
  let decision: SnapshotCommitDecision;
  if (attemptMismatch) {
    decision = "obsolete";
  } else if (duplicate) {
    decision = "duplicate";
  } else if (invalidJobState) {
    decision = "obsolete";
  } else {
    decision = decideSnapshotCommit({
      pinnedFingerprint,
      currentFingerprint: current.fingerprint,
      resultAlreadyCommitted: false,
    });
  }

  return {
    decision,
    sourceSnapshotId: job.source_snapshot_id,
    pinnedFingerprint,
    currentFingerprint: current.fingerprint,
  };
}

export async function decideSourceSnapshotCommit(
  client: TransactionClient,
  input: {
    sourceSnapshotId: string;
    currentSnapshot: SourceSnapshotInput;
    resultAlreadyCommitted?: boolean;
  },
): Promise<WorkflowJobSnapshotDecision> {
  const pinned = await loadSourceSnapshot(client, input.sourceSnapshotId, {
    lock: true,
  });
  if (!pinned) invariant("SOURCE_SNAPSHOT_NOT_FOUND");
  const current = canonicalSourceSnapshot(input.currentSnapshot);
  if (pinned.projectId !== current.projectId) {
    invariant("SOURCE_SNAPSHOT_PROJECT_MISMATCH");
  }
  return {
    decision: decideSnapshotCommit({
      pinnedFingerprint: pinned.fingerprint,
      currentFingerprint: current.fingerprint,
      resultAlreadyCommitted: input.resultAlreadyCommitted === true,
    }),
    sourceSnapshotId: pinned.sourceSnapshotId,
    pinnedFingerprint: pinned.fingerprint,
    currentFingerprint: current.fingerprint,
  };
}
