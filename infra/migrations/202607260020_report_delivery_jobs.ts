import type { MigrationBuilder } from "node-pg-migrate";

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    ALTER TABLE workflow_job
      DROP CONSTRAINT workflow_job_job_type_check;
    ALTER TABLE workflow_job
      ADD CONSTRAINT workflow_job_job_type_check
      CHECK (job_type IN (
        'file_ingest', 'file_inspection', 'hypothesis_generation',
        'research_collection', 'evidence_reinvestigation', 'reconciliation',
        'workbook_application', 'report_materialization', 'report_delivery'
      ));

    ALTER TABLE report_preview
      DROP CONSTRAINT IF EXISTS report_preview_preview_status_check;
    ALTER TABLE report_preview
      ADD CONSTRAINT report_preview_preview_status_check
      CHECK (preview_status IN (
        'queued', 'rendering', 'verifying', 'ready',
        'failed', 'cancel_requested', 'cancelled', 'stale'
      )),
      ADD COLUMN job_id uuid UNIQUE
        REFERENCES workflow_job(job_id) ON DELETE RESTRICT,
      ADD COLUMN source_snapshot_id uuid,
      ADD COLUMN attempt integer NOT NULL DEFAULT 1 CHECK (attempt > 0),
      ADD COLUMN render_plan_hash text,
      ADD COLUMN error_code text,
      ADD COLUMN error_summary text,
      ADD COLUMN finished_at timestamptz,
      ADD FOREIGN KEY (source_snapshot_id, project_id)
        REFERENCES source_snapshot(source_snapshot_id, project_id)
        ON DELETE RESTRICT;

    ALTER TABLE report_validation_run
      ADD COLUMN job_id uuid UNIQUE
        REFERENCES workflow_job(job_id) ON DELETE RESTRICT,
      ADD COLUMN source_snapshot_id uuid,
      ADD COLUMN attempt integer NOT NULL DEFAULT 1 CHECK (attempt > 0),
      ADD COLUMN error_code text,
      ADD COLUMN error_summary text,
      ADD FOREIGN KEY (source_snapshot_id, project_id)
        REFERENCES source_snapshot(source_snapshot_id, project_id)
        ON DELETE RESTRICT;

    ALTER TABLE report_export
      ADD COLUMN job_id uuid UNIQUE
        REFERENCES workflow_job(job_id) ON DELETE RESTRICT,
      ADD COLUMN source_snapshot_id uuid,
      ADD COLUMN attempt integer NOT NULL DEFAULT 1 CHECK (attempt > 0),
      ADD COLUMN input_manifest_hash text,
      ADD COLUMN error_code text,
      ADD COLUMN error_summary text,
      ADD COLUMN finished_at timestamptz,
      ADD FOREIGN KEY (source_snapshot_id, project_id)
        REFERENCES source_snapshot(source_snapshot_id, project_id)
        ON DELETE RESTRICT;

    CREATE INDEX report_preview_job_status_idx
      ON report_preview (project_id, preview_status, updated_at DESC);
    CREATE INDEX report_validation_job_status_idx
      ON report_validation_run (
        project_id, validation_status, started_at DESC
      );
    CREATE INDEX report_export_job_status_idx
      ON report_export (project_id, operation_status, updated_at DESC);
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    DROP INDEX IF EXISTS report_export_job_status_idx;
    DROP INDEX IF EXISTS report_validation_job_status_idx;
    DROP INDEX IF EXISTS report_preview_job_status_idx;

    ALTER TABLE report_export
      DROP COLUMN IF EXISTS finished_at,
      DROP COLUMN IF EXISTS error_summary,
      DROP COLUMN IF EXISTS error_code,
      DROP COLUMN IF EXISTS input_manifest_hash,
      DROP COLUMN IF EXISTS attempt,
      DROP COLUMN IF EXISTS source_snapshot_id,
      DROP COLUMN IF EXISTS job_id;

    ALTER TABLE report_validation_run
      DROP COLUMN IF EXISTS error_summary,
      DROP COLUMN IF EXISTS error_code,
      DROP COLUMN IF EXISTS attempt,
      DROP COLUMN IF EXISTS source_snapshot_id,
      DROP COLUMN IF EXISTS job_id;

    ALTER TABLE report_preview
      DROP COLUMN IF EXISTS finished_at,
      DROP COLUMN IF EXISTS error_summary,
      DROP COLUMN IF EXISTS error_code,
      DROP COLUMN IF EXISTS render_plan_hash,
      DROP COLUMN IF EXISTS attempt,
      DROP COLUMN IF EXISTS source_snapshot_id,
      DROP COLUMN IF EXISTS job_id;
    ALTER TABLE report_preview
      DROP CONSTRAINT IF EXISTS report_preview_preview_status_check;
    ALTER TABLE report_preview
      ADD CONSTRAINT report_preview_preview_status_check
      CHECK (preview_status IN (
        'queued', 'rendering', 'verifying', 'ready', 'failed', 'stale'
      ));

    ALTER TABLE workflow_job
      DROP CONSTRAINT workflow_job_job_type_check;
    ALTER TABLE workflow_job
      ADD CONSTRAINT workflow_job_job_type_check
      CHECK (job_type IN (
        'file_ingest', 'file_inspection', 'hypothesis_generation',
        'research_collection', 'evidence_reinvestigation', 'reconciliation',
        'workbook_application', 'report_materialization'
      ));
  `);
}
