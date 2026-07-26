import { uuidv7 } from "../../domain/ids";
import type { StageKey } from "../../domain/project";
import type { TransactionClient } from "../database/transaction";
import { acquireProjectLineageLock } from "./source-snapshot-service";

type StageStatus =
  | "not_started"
  | "in_progress"
  | "completed"
  | "revalidation_required"
  | "blocked";

export type ResourceDependencyInput = {
  upstreamResourceVersionId: string;
  downstreamResourceVersionId: string;
  dependencyKind: string;
};

export type StageInvalidationTransition = {
  stageKey: StageKey;
  stageStatus: Extract<
    StageStatus,
    "in_progress" | "revalidation_required" | "blocked"
  >;
  blockerCodes: readonly string[];
  clearCompletion?: boolean;
  markCompletionForRevalidation?: boolean;
  eligibleStatuses?: readonly StageStatus[];
};

function cleanDependencyKind(value: string): string {
  const kind = value.trim();
  if (!kind) throw new Error("RESOURCE_DEPENDENCY_KIND_INVALID");
  return kind;
}

export async function recordResourceDependencies(
  client: TransactionClient,
  input: {
    projectId: string;
    dependencies: readonly ResourceDependencyInput[];
  },
): Promise<void> {
  const dependencies = [
    ...new Map(
      input.dependencies.map((dependency) => {
        if (
          dependency.upstreamResourceVersionId ===
          dependency.downstreamResourceVersionId
        ) {
          throw new Error("RESOURCE_DEPENDENCY_SELF_REFERENCE");
        }
        const normalized = {
          ...dependency,
          dependencyKind: cleanDependencyKind(dependency.dependencyKind),
        };
        return [
          [
            normalized.upstreamResourceVersionId,
            normalized.downstreamResourceVersionId,
            normalized.dependencyKind,
          ].join(":"),
          normalized,
        ];
      }),
    ).values(),
  ];
  if (dependencies.length === 0) return;

  await acquireProjectLineageLock(client, input.projectId);
  const versionIds = [
    ...new Set(
      dependencies.flatMap((dependency) => [
        dependency.upstreamResourceVersionId,
        dependency.downstreamResourceVersionId,
      ]),
    ),
  ];
  const ownedResult = await client.query<{ resource_version_id: string }>(
    `SELECT version.resource_version_id
     FROM resource_version version
     JOIN versioned_resource resource
       ON resource.resource_id = version.resource_id
     WHERE resource.project_id = $1
       AND version.resource_version_id = ANY($2::uuid[])`,
    [input.projectId, versionIds],
  );
  if (ownedResult.rows.length !== versionIds.length) {
    throw new Error("RESOURCE_DEPENDENCY_PROJECT_MISMATCH");
  }

  for (const dependency of dependencies) {
    const cycleResult = await client.query<{ cyclic: boolean }>(
      `WITH RECURSIVE descendants(resource_version_id) AS (
         SELECT downstream_resource_version_id
         FROM resource_dependency
         WHERE project_id = $1
           AND upstream_resource_version_id = $2
         UNION
         SELECT edge.downstream_resource_version_id
         FROM resource_dependency edge
         JOIN descendants parent
           ON edge.upstream_resource_version_id = parent.resource_version_id
         WHERE edge.project_id = $1
       )
       SELECT EXISTS (
         SELECT 1 FROM descendants WHERE resource_version_id = $3
       ) AS cyclic`,
      [
        input.projectId,
        dependency.downstreamResourceVersionId,
        dependency.upstreamResourceVersionId,
      ],
    );
    if (cycleResult.rows[0]?.cyclic) {
      throw new Error("RESOURCE_DEPENDENCY_CYCLE");
    }
    await client.query(
      `INSERT INTO resource_dependency (
         project_id, upstream_resource_version_id,
         downstream_resource_version_id, dependency_kind
       ) VALUES ($1, $2, $3, $4)
       ON CONFLICT (
         upstream_resource_version_id,
         downstream_resource_version_id,
         dependency_kind
       ) DO NOTHING`,
      [
        input.projectId,
        dependency.upstreamResourceVersionId,
        dependency.downstreamResourceVersionId,
        dependency.dependencyKind,
      ],
    );
  }
}

export async function invalidateResourceDependents(
  client: TransactionClient,
  input: {
    projectId: string;
    upstreamResourceVersionIds: readonly string[];
  },
): Promise<{
  resourceVersionIds: string[];
  workflowJobIds: string[];
}> {
  const roots = [...new Set(input.upstreamResourceVersionIds)];
  if (roots.length === 0) {
    return { resourceVersionIds: [], workflowJobIds: [] };
  }
  await acquireProjectLineageLock(client, input.projectId);
  const dependents = await client.query<{ resource_version_id: string }>(
    `WITH RECURSIVE dependents(resource_version_id) AS (
       SELECT downstream_resource_version_id
       FROM resource_dependency
       WHERE project_id = $1
         AND upstream_resource_version_id = ANY($2::uuid[])
       UNION
       SELECT edge.downstream_resource_version_id
       FROM resource_dependency edge
       JOIN dependents parent
         ON edge.upstream_resource_version_id = parent.resource_version_id
       WHERE edge.project_id = $1
     )
     SELECT resource_version_id FROM dependents
     ORDER BY resource_version_id`,
    [input.projectId, roots],
  );
  const resourceVersionIds = dependents.rows.map(
    (row) => row.resource_version_id,
  );
  if (resourceVersionIds.length > 0) {
    await client.query(
      `UPDATE resource_version version
       SET validity_status = 'revalidation_required'
       FROM versioned_resource resource
       WHERE version.resource_version_id = ANY($2::uuid[])
         AND resource.resource_id = version.resource_id
         AND resource.project_id = $1
         AND version.validity_status = 'current'`,
      [input.projectId, resourceVersionIds],
    );
  }
  const invalidatedInputVersionIds = [...new Set([...roots, ...resourceVersionIds])];
  const jobs = await client.query<{ job_id: string }>(
    `UPDATE workflow_job job
     SET validity_status = 'obsolete'
     WHERE job.project_id = $1
       AND job.validity_status = 'current'
       AND EXISTS (
         SELECT 1
         FROM workflow_job_input input
         WHERE input.job_id = job.job_id
           AND input.resource_version_id = ANY($2::uuid[])
       )
     RETURNING job.job_id`,
    [input.projectId, invalidatedInputVersionIds],
  );
  return {
    resourceVersionIds,
    workflowJobIds: jobs.rows.map((row) => row.job_id),
  };
}

export async function invalidateProjectStages(
  client: TransactionClient,
  input: {
    projectId: string;
    triggerVersionId: string;
    startStageKey: StageKey;
    reasonCode: string;
    transitions: readonly StageInvalidationTransition[];
    markProjectRevalidation?: boolean;
  },
): Promise<StageKey[]> {
  if (input.transitions.length === 0) return [];
  const affected = [...new Set(input.transitions.map((item) => item.stageKey))];
  await client.query(
    `INSERT INTO project_invalidation_event (
       invalidation_id, project_id, trigger_version_id, start_stage_key,
       reason_code, affected_stage_keys
     ) VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      uuidv7(),
      input.projectId,
      input.triggerVersionId,
      input.startStageKey,
      input.reasonCode,
      affected,
    ],
  );

  for (const transition of input.transitions) {
    const eligibleStatuses = transition.eligibleStatuses ?? [
      "in_progress",
      "completed",
      "revalidation_required",
    ];
    await client.query(
      `UPDATE project_stage_state
       SET stage_status = $3,
           current_completion_id = CASE
             WHEN $5::boolean THEN NULL
             ELSE current_completion_id
           END,
           completed_at = CASE
             WHEN $5::boolean THEN NULL
             ELSE completed_at
           END,
           invalidated_at = now(),
           blocker_codes = $4::text[],
           updated_at = now()
       WHERE project_id = $1
         AND stage_key = $2
         AND stage_status = ANY($6::text[])`,
      [
        input.projectId,
        transition.stageKey,
        transition.stageStatus,
        transition.blockerCodes,
        transition.clearCompletion === true,
        eligibleStatuses,
      ],
    );
    if (transition.markCompletionForRevalidation !== false) {
      await client.query(
        `UPDATE stage_completion
         SET validity_status = 'revalidation_required'
         WHERE project_id = $1
           AND stage_key = $2
           AND validity_status = 'current'`,
        [input.projectId, transition.stageKey],
      );
    }
  }
  if (input.markProjectRevalidation) {
    await client.query(
      `UPDATE project
       SET project_status = 'revalidation_required', updated_at = now()
       WHERE project_id = $1`,
      [input.projectId],
    );
  }
  return affected;
}
