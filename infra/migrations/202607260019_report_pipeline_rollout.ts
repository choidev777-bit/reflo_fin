import type { MigrationBuilder } from "node-pg-migrate";

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    CREATE TABLE project_report_pipeline (
      project_id uuid PRIMARY KEY
        REFERENCES project(project_id) ON DELETE CASCADE,
      pipeline_mode text NOT NULL DEFAULT 'legacy'
        CHECK (pipeline_mode IN ('legacy', 'render_scene_v1')),
      analysis_version text NOT NULL DEFAULT 'pdf-analysis/2.0',
      materializer_version text NOT NULL DEFAULT 'report-materializer/1.0',
      renderer_version text NOT NULL DEFAULT 'reflo-svg-1',
      rollout_percent integer NOT NULL DEFAULT 0
        CHECK (rollout_percent BETWEEN 0 AND 100),
      enabled_at timestamptz,
      enabled_by_user_id uuid REFERENCES user_account(user_id) ON DELETE RESTRICT,
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    INSERT INTO project_report_pipeline (project_id)
    SELECT project_id FROM project
    ON CONFLICT (project_id) DO NOTHING;

    CREATE TABLE report_pipeline_migration_run (
      migration_run_id uuid PRIMARY KEY,
      project_id uuid NOT NULL
        REFERENCES project(project_id) ON DELETE CASCADE,
      idempotency_key text NOT NULL
        CHECK (length(idempotency_key) BETWEEN 16 AND 128),
      mode text NOT NULL CHECK (mode IN ('dry_run', 'apply')),
      operation_status text NOT NULL DEFAULT 'queued'
        CHECK (operation_status IN (
          'queued', 'running', 'succeeded', 'failed',
          'cancel_requested', 'cancelled'
        )),
      source_pipeline_mode text NOT NULL,
      target_pipeline_mode text NOT NULL DEFAULT 'render_scene_v1',
      source_snapshot_id uuid,
      cursor_json jsonb NOT NULL DEFAULT '{}'::jsonb,
      result_json jsonb NOT NULL DEFAULT '{}'::jsonb,
      error_code text,
      error_summary text,
      requested_by_user_id uuid NOT NULL
        REFERENCES user_account(user_id) ON DELETE RESTRICT,
      requested_at timestamptz NOT NULL DEFAULT now(),
      started_at timestamptz,
      finished_at timestamptz,
      UNIQUE (project_id, idempotency_key),
      FOREIGN KEY (source_snapshot_id, project_id)
        REFERENCES source_snapshot(source_snapshot_id, project_id)
        ON DELETE RESTRICT
    );

    CREATE INDEX report_pipeline_migration_status_idx
      ON report_pipeline_migration_run (
        project_id, operation_status, requested_at DESC
      );

    CREATE OR REPLACE FUNCTION ensure_project_report_pipeline()
    RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      INSERT INTO project_report_pipeline (project_id)
      VALUES (NEW.project_id)
      ON CONFLICT (project_id) DO NOTHING;
      RETURN NEW;
    END;
    $$;

    CREATE TRIGGER project_report_pipeline_after_insert
      AFTER INSERT ON project
      FOR EACH ROW EXECUTE FUNCTION ensure_project_report_pipeline();
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    DROP TRIGGER IF EXISTS project_report_pipeline_after_insert ON project;
    DROP FUNCTION IF EXISTS ensure_project_report_pipeline();
    DROP TABLE IF EXISTS report_pipeline_migration_run;
    DROP TABLE IF EXISTS project_report_pipeline;
  `);
}
