import { ApiError } from "../../http/api-error";
import { uuidv7 } from "../../domain/ids";
import {
  pipelineMigrationIdempotencyKey,
  planReportPipelineMigration,
  type PipelineMigrationBinding,
  type PipelineMigrationPlan,
} from "../../domain/report-pipeline-migration";
import { withTransaction, type TransactionClient } from "../database/transaction";
import { createFileInspection } from "./file-repository";

type MigrationMode = "dry_run" | "apply";

type MigrationRow = {
  migration_run_id: string;
  project_id: string;
  mode: MigrationMode;
  operation_status:
    | "queued"
    | "running"
    | "succeeded"
    | "failed"
    | "cancel_requested"
    | "cancelled";
  source_pipeline_mode: string;
  target_pipeline_mode: "render_scene_v1";
  cursor_json: Record<string, unknown>;
  result_json: Record<string, unknown>;
  error_code: string | null;
  error_summary: string | null;
  requested_at: Date;
  started_at: Date | null;
  finished_at: Date | null;
};

async function assertOwnedProject(
  client: TransactionClient,
  projectId: string,
  userId: string,
): Promise<void> {
  const result = await client.query(
    `SELECT 1 FROM project
     WHERE project_id = $1 AND owner_user_id = $2 AND deleted_at IS NULL`,
    [projectId, userId],
  );
  if (!result.rowCount) {
    throw new ApiError(404, "PROJECT_NOT_FOUND", "프로젝트를 찾을 수 없습니다.");
  }
}

async function latestMappingSetId(
  client: TransactionClient,
  projectId: string,
): Promise<string | null> {
  const result = await client.query<{ resource_version_id: string }>(
    `SELECT msv.resource_version_id
     FROM mapping_set_version msv
     JOIN resource_version rv ON rv.resource_version_id = msv.resource_version_id
     JOIN versioned_resource vr ON vr.resource_id = rv.resource_id
     WHERE vr.project_id = $1
       AND rv.validity_status <> 'obsolete'
     ORDER BY rv.created_at DESC, rv.version_no DESC
     LIMIT 1`,
    [projectId],
  );
  return result.rows[0]?.resource_version_id ?? null;
}

async function mappingBindings(
  client: TransactionClient,
  mappingSetId: string | null,
): Promise<PipelineMigrationBinding[]> {
  if (!mappingSetId) return [];
  const result = await client.query<{
    slot_id: string;
    semantic_metric: string;
    binding_kind: string;
    value_type: string;
    source_json: Record<string, unknown> | null;
    candidate_source_json: Record<string, unknown> | null;
  }>(
    `SELECT me.slot_id, me.semantic_metric, me.binding_kind, me.value_type,
       me.source_json, mc.source_json AS candidate_source_json
     FROM mapping_entry me
     LEFT JOIN mapping_candidate mc
       ON mc.mapping_candidate_id = me.selected_candidate_id
     WHERE me.mapping_set_version_id = $1
     ORDER BY me.slot_id`,
    [mappingSetId],
  );
  return result.rows.map((row) => {
    const source = row.candidate_source_json ?? row.source_json ?? {};
    const fingerprint =
      typeof source.structureFingerprint === "string"
        ? source.structureFingerprint
        : null;
    return {
      slotId: row.slot_id,
      semanticKey: `${row.semantic_metric}:${row.binding_kind}:${row.value_type}`,
      structureFingerprint: fingerprint,
      resourceVersionId: mappingSetId,
    };
  });
}

async function buildPlan(
  client: TransactionClient,
  input: {
    projectId: string;
    sourcePipelineMode: string;
    sourceMappingSetId: string | null;
    targetMappingSetId: string | null;
  },
): Promise<PipelineMigrationPlan> {
  return planReportPipelineMigration({
    projectId: input.projectId,
    sourcePipelineMode: input.sourcePipelineMode,
    previous: await mappingBindings(client, input.sourceMappingSetId),
    target: await mappingBindings(client, input.targetMappingSetId),
  });
}

function projection(row: MigrationRow, progressPercent = 100) {
  return {
    migrationRunId: row.migration_run_id,
    mode: row.mode,
    operationStatus: row.operation_status,
    sourcePipelineMode: row.source_pipeline_mode,
    targetPipelineMode: row.target_pipeline_mode,
    progressPercent,
    cursor: row.cursor_json,
    result: row.result_json,
    error:
      row.error_code == null
        ? null
        : { code: row.error_code, message: row.error_summary },
    requestedAt: row.requested_at.toISOString(),
    startedAt: row.started_at?.toISOString() ?? null,
    finishedAt: row.finished_at?.toISOString() ?? null,
  };
}

export async function createReportPipelineMigration(input: {
  projectId: string;
  userId: string;
  mode: MigrationMode;
  idempotencyKey: string | null;
}) {
  if (!input.idempotencyKey || input.idempotencyKey.length < 16) {
    throw new ApiError(
      400,
      "IDEMPOTENCY_KEY_REQUIRED",
      "16자 이상의 Idempotency-Key가 필요합니다.",
    );
  }
  const prepared = await withTransaction(async (client) => {
    await assertOwnedProject(client, input.projectId, input.userId);
    const existing = await client.query<MigrationRow>(
      `SELECT * FROM report_pipeline_migration_run
       WHERE project_id = $1 AND idempotency_key = $2`,
      [input.projectId, input.idempotencyKey],
    );
    if (existing.rows[0]) return { replay: existing.rows[0] };
    const pipeline = await client.query<{ pipeline_mode: string }>(
      `SELECT pipeline_mode FROM project_report_pipeline WHERE project_id = $1`,
      [input.projectId],
    );
    const sourceMappingSetId = await latestMappingSetId(client, input.projectId);
    const plan = await buildPlan(client, {
      projectId: input.projectId,
      sourcePipelineMode: pipeline.rows[0]?.pipeline_mode ?? "legacy",
      sourceMappingSetId,
      targetMappingSetId: sourceMappingSetId,
    });
    const migrationRunId = uuidv7();
    const cursor = { sourceMappingSetId };
    const status = input.mode === "dry_run" ? "succeeded" : "queued";
    const result =
      input.mode === "dry_run"
        ? {
            plan,
            generatedVersions: 0,
            destructiveChanges: 0,
            applyIdempotencyKey: pipelineMigrationIdempotencyKey(plan, "apply"),
          }
        : {};
    const inserted = await client.query<MigrationRow>(
      `INSERT INTO report_pipeline_migration_run (
         migration_run_id, project_id, idempotency_key, mode,
         operation_status, source_pipeline_mode, cursor_json, result_json,
         requested_by_user_id, started_at, finished_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9,
         CASE WHEN $4 = 'apply' THEN now() ELSE NULL END,
         CASE WHEN $4 = 'dry_run' THEN now() ELSE NULL END
       )
       RETURNING *`,
      [
        migrationRunId,
        input.projectId,
        input.idempotencyKey,
        input.mode,
        status,
        plan.sourcePipelineMode,
        JSON.stringify(cursor),
        JSON.stringify(result),
        input.userId,
      ],
    );
    return {
      replay: null,
      row: inserted.rows[0],
      sourceMappingSetId,
    };
  });
  if (prepared.replay) return projection(prepared.replay);
  if (input.mode === "dry_run") return projection(prepared.row!);

  try {
    const files = await withTransaction(async (client) => {
      const result = await client.query<{
        pdf_file_version_id: string;
        workbook_file_version_id: string;
      }>(
        `SELECT pdf_file_version_id, workbook_file_version_id
         FROM file_inspection
         WHERE project_id = $1
         ORDER BY created_at DESC
         LIMIT 1`,
        [input.projectId],
      );
      if (!result.rows[0]) {
        throw new ApiError(
          409,
          "MIGRATION_SOURCE_FILES_MISSING",
          "재분석할 기존 PDF와 XLSX가 없습니다.",
        );
      }
      return result.rows[0];
    });
    const inspection = await createFileInspection({
      projectId: input.projectId,
      userId: input.userId,
      idempotencyKey: `migration:${prepared.row!.migration_run_id}`,
      pdfFileVersionId: files.pdf_file_version_id,
      workbookFileVersionId: files.workbook_file_version_id,
    });
    const body = inspection.body as { inspectionId: string };
    const row = await withTransaction(async (client) => {
      const updated = await client.query<MigrationRow>(
        `UPDATE report_pipeline_migration_run
         SET operation_status = 'running',
             cursor_json = cursor_json || $2::jsonb
         WHERE migration_run_id = $1
         RETURNING *`,
        [
          prepared.row!.migration_run_id,
          JSON.stringify({ inspectionId: body.inspectionId }),
        ],
      );
      return updated.rows[0];
    });
    return projection(row, 5);
  } catch (error) {
    await withTransaction(async (client) => {
      await client.query(
        `UPDATE report_pipeline_migration_run
         SET operation_status = 'failed', error_code = $2,
             error_summary = $3, finished_at = now()
         WHERE migration_run_id = $1`,
        [
          prepared.row!.migration_run_id,
          error instanceof ApiError ? error.code : "MIGRATION_START_FAILED",
          error instanceof Error ? error.message : "Migration start failed",
        ],
      );
    });
    throw error;
  }
}

export async function getReportPipelineMigration(input: {
  projectId: string;
  userId: string;
  migrationRunId: string;
}) {
  return withTransaction(async (client) => {
    await assertOwnedProject(client, input.projectId, input.userId);
    const result = await client.query<MigrationRow>(
      `SELECT * FROM report_pipeline_migration_run
       WHERE migration_run_id = $1 AND project_id = $2
       FOR UPDATE`,
      [input.migrationRunId, input.projectId],
    );
    let row = result.rows[0];
    if (!row) {
      throw new ApiError(
        404,
        "MIGRATION_RUN_NOT_FOUND",
        "마이그레이션 실행 기록을 찾을 수 없습니다.",
      );
    }
    if (row.operation_status !== "running") return projection(row);
    const inspectionId =
      typeof row.cursor_json.inspectionId === "string"
        ? row.cursor_json.inspectionId
        : null;
    if (!inspectionId) return projection(row, 5);
    const inspection = await client.query<{
      operation_status: string;
      progress_percent: number;
      error_code: string | null;
      error_summary: string | null;
      mapping_set_resource_version_id: string | null;
    }>(
      `SELECT wj.operation_status, wj.progress_percent, wj.error_code,
         wj.error_summary, fi.mapping_set_resource_version_id
       FROM file_inspection fi
       JOIN workflow_job wj ON wj.job_id = fi.job_id
       WHERE fi.inspection_id = $1 AND fi.project_id = $2`,
      [inspectionId, input.projectId],
    );
    const task = inspection.rows[0];
    if (!task) return projection(row, 5);
    if (task.operation_status === "succeeded") {
      const sourceMappingSetId =
        typeof row.cursor_json.sourceMappingSetId === "string"
          ? row.cursor_json.sourceMappingSetId
          : null;
      const plan = await buildPlan(client, {
        projectId: input.projectId,
        sourcePipelineMode: row.source_pipeline_mode,
        sourceMappingSetId,
        targetMappingSetId: task.mapping_set_resource_version_id,
      });
      await client.query(
        `UPDATE report
         SET status = 'revalidation_required', updated_at = now()
         WHERE project_id = $1 AND status = 'working'`,
        [input.projectId],
      );
      await client.query(
        `UPDATE report_outline
         SET status = 'revalidation_required', saved_at = now()
         WHERE project_id = $1 AND status = 'editing'`,
        [input.projectId],
      );
      await client.query(
        `UPDATE project_report_pipeline
         SET pipeline_mode = 'render_scene_v1', rollout_percent = 100,
             enabled_at = now(), enabled_by_user_id = $2, updated_at = now()
         WHERE project_id = $1`,
        [input.projectId, input.userId],
      );
      const completed = await client.query<MigrationRow>(
        `UPDATE report_pipeline_migration_run
         SET operation_status = 'succeeded', finished_at = now(),
             result_json = $2::jsonb
         WHERE migration_run_id = $1
         RETURNING *`,
        [
          input.migrationRunId,
          JSON.stringify({
            plan,
            inspectionId,
            targetMappingSetId: task.mapping_set_resource_version_id,
            previousApprovalsPreserved: true,
            previousExportsPreserved: true,
            workingReportRevalidationRequired: true,
          }),
        ],
      );
      row = completed.rows[0];
      return projection(row);
    }
    if (["failed", "cancelled"].includes(task.operation_status)) {
      const failed = await client.query<MigrationRow>(
        `UPDATE report_pipeline_migration_run
         SET operation_status = $2, error_code = $3, error_summary = $4,
             finished_at = now()
         WHERE migration_run_id = $1
         RETURNING *`,
        [
          input.migrationRunId,
          task.operation_status,
          task.error_code ?? "MIGRATION_REANALYSIS_FAILED",
          task.error_summary ?? "재분석 작업이 완료되지 못했습니다.",
        ],
      );
      return projection(failed.rows[0]);
    }
    return projection(row, Math.max(5, task.progress_percent));
  });
}

export async function rollbackReportPipeline(input: {
  projectId: string;
  userId: string;
}) {
  return withTransaction(async (client) => {
    await assertOwnedProject(client, input.projectId, input.userId);
    const result = await client.query<{
      pipeline_mode: string;
      updated_at: Date;
    }>(
      `UPDATE project_report_pipeline
       SET pipeline_mode = 'legacy', rollout_percent = 0,
           enabled_at = NULL, enabled_by_user_id = NULL, updated_at = now()
       WHERE project_id = $1
       RETURNING pipeline_mode, updated_at`,
      [input.projectId],
    );
    await client.query(
      `UPDATE report
       SET status = 'revalidation_required', updated_at = now()
       WHERE project_id = $1 AND status = 'working'`,
      [input.projectId],
    );
    return {
      projectId: input.projectId,
      pipelineMode: result.rows[0]?.pipeline_mode ?? "legacy",
      historicalVersionsPreserved: true,
      rolledBackAt: result.rows[0]?.updated_at.toISOString() ?? null,
    };
  });
}
