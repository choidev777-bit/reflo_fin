import type { MigrationBuilder } from "node-pg-migrate";

export function up(pgm: MigrationBuilder): void {
  pgm.sql(`
    ALTER TABLE workflow_job
      DROP CONSTRAINT workflow_job_job_type_check;
    ALTER TABLE workflow_job
      ADD CONSTRAINT workflow_job_job_type_check
      CHECK (job_type IN (
        'file_ingest', 'file_inspection', 'hypothesis_generation',
        'research_collection', 'evidence_reinvestigation', 'reconciliation',
        'workbook_application', 'report_materialization'
      ));

    ALTER TABLE report_materialization_run
      ADD COLUMN job_id uuid UNIQUE
        REFERENCES workflow_job(job_id) ON DELETE RESTRICT,
      ADD COLUMN materialization_resource_version_id uuid UNIQUE
        REFERENCES resource_version(resource_version_id) ON DELETE RESTRICT,
      ADD COLUMN materialization_version bigint NOT NULL DEFAULT 1
        CHECK (materialization_version > 0),
      ADD COLUMN required_block_count integer NOT NULL DEFAULT 0
        CHECK (required_block_count >= 0),
      ADD COLUMN ready_block_count integer NOT NULL DEFAULT 0
        CHECK (ready_block_count >= 0),
      ADD COLUMN blocker_codes text[] NOT NULL DEFAULT '{}',
      ADD CONSTRAINT report_materialization_ready_count_check
        CHECK (ready_block_count <= required_block_count);

    INSERT INTO workflow_job (
      job_id, project_id, job_type, temporal_workflow_id,
      operation_status, validity_status, current_phase,
      progress_percent, progress_mode, progress_sequence, attempt,
      input_fingerprint, source_snapshot_id, requested_by_user_id,
      requested_at, started_at, finished_at, retryable,
      error_code, error_summary
    )
    SELECT
      md5(
        'report-materialization-job:' ||
        run.materialization_run_id::text
      )::uuid,
      run.project_id,
      'report_materialization',
      'reflo:legacy-report-materialization:' ||
        run.materialization_run_id::text,
      run.operation_status,
      run.validity_status,
      CASE
        WHEN run.operation_status = 'succeeded' THEN 'completed'
        ELSE 'materializing_report'
      END,
      CASE
        WHEN run.operation_status IN ('succeeded', 'failed', 'cancelled')
          THEN 100
        WHEN run.operation_status = 'running' THEN 50
        ELSE 0
      END,
      'determinate',
      0,
      run.attempt,
      run.input_fingerprint,
      run.source_snapshot_id,
      approval.approved_by_user_id,
      run.requested_at,
      run.started_at,
      run.finished_at,
      run.operation_status = 'failed',
      run.error_code,
      run.error_summary
    FROM report_materialization_run run
    JOIN report_outline_approval approval
      ON approval.approval_id = run.report_outline_approval_id
     AND approval.project_id = run.project_id
    WHERE run.job_id IS NULL;

    UPDATE report_materialization_run run
    SET job_id = md5(
      'report-materialization-job:' ||
      run.materialization_run_id::text
    )::uuid
    WHERE run.job_id IS NULL;

    ALTER TABLE report_materialization_run
      ALTER COLUMN job_id SET NOT NULL;

    CREATE TABLE report_materialization_block (
      materialization_snapshot_id uuid PRIMARY KEY,
      materialization_run_id uuid NOT NULL,
      project_id uuid NOT NULL REFERENCES project(project_id) ON DELETE CASCADE,
      slot_id text NOT NULL CHECK (length(btrim(slot_id)) > 0),
      page_id text NOT NULL CHECK (length(btrim(page_id)) > 0),
      block_id text NOT NULL CHECK (length(btrim(block_id)) > 0),
      snapshot_kind text NOT NULL
        CHECK (snapshot_kind IN (
          'scalar', 'table', 'chart', 'composite_chart'
        )),
      snapshot_status text NOT NULL
        CHECK (snapshot_status IN ('ready', 'blocked')),
      blocker_code text,
      snapshot_hash char(64) NOT NULL
        CHECK (snapshot_hash ~ '^[0-9a-f]{64}$'),
      snapshot_json jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      FOREIGN KEY (materialization_run_id, project_id)
        REFERENCES report_materialization_run(
          materialization_run_id, project_id
        ) ON DELETE CASCADE,
      UNIQUE (materialization_run_id, slot_id),
      UNIQUE (materialization_snapshot_id, materialization_run_id)
    );

    CREATE INDEX report_materialization_block_run_status_idx
      ON report_materialization_block (
        materialization_run_id, snapshot_status, slot_id
      );

    ALTER TABLE report_version
      ADD COLUMN materialization_run_id uuid
        REFERENCES report_materialization_run(materialization_run_id)
        ON DELETE RESTRICT;

    CREATE INDEX report_version_materialization_run_idx
      ON report_version (materialization_run_id)
      WHERE materialization_run_id IS NOT NULL;

    CREATE FUNCTION enforce_report_materialization_completion_ownership()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM workflow_job job
        WHERE job.job_id = NEW.job_id
          AND job.project_id = NEW.project_id
          AND job.job_type = 'report_materialization'
      ) OR (
        NEW.materialization_resource_version_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM resource_version version
          JOIN versioned_resource resource
            ON resource.resource_id = version.resource_id
          WHERE version.resource_version_id =
              NEW.materialization_resource_version_id
            AND resource.project_id = NEW.project_id
            AND resource.resource_kind = 'report_materialization'
            AND NEW.output_artifact_id IS NOT NULL
            AND EXISTS (
              SELECT 1
              FROM resource_artifact link
              WHERE link.resource_version_id =
                  NEW.materialization_resource_version_id
                AND link.artifact_id = NEW.output_artifact_id
                AND link.artifact_role = 'report_materialization'
            )
        )
      ) OR (
        NEW.operation_status = 'succeeded'
        AND
        NEW.report_resource_version_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM report_version version
          WHERE version.resource_version_id =
              NEW.report_resource_version_id
            AND version.materialization_run_id =
              NEW.materialization_run_id
        )
      ) THEN
        RAISE EXCEPTION
          'report materialization completion references must belong to its project'
          USING ERRCODE = '23514',
            CONSTRAINT = 'report_materialization_completion_project_check';
      END IF;
      RETURN NEW;
    END;
    $$;

    CREATE TRIGGER report_materialization_completion_ownership_trigger
      BEFORE INSERT OR UPDATE ON report_materialization_run
      FOR EACH ROW
      EXECUTE FUNCTION
        enforce_report_materialization_completion_ownership();

    CREATE FUNCTION enforce_report_version_materialization_ownership()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      IF NEW.materialization_run_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM report_materialization_run run
          JOIN report
            ON report.report_id = NEW.report_id
          WHERE run.materialization_run_id = NEW.materialization_run_id
            AND run.project_id = report.project_id
            AND (
              run.report_resource_version_id IS NULL
              OR run.report_resource_version_id =
                NEW.resource_version_id
            )
        )
      THEN
        RAISE EXCEPTION
          'report version materialization must belong to its project'
          USING ERRCODE = '23514',
            CONSTRAINT = 'report_version_materialization_project_check';
      END IF;
      RETURN NEW;
    END;
    $$;

    CREATE TRIGGER report_version_materialization_ownership_trigger
      BEFORE INSERT OR UPDATE ON report_version
      FOR EACH ROW
      EXECUTE FUNCTION enforce_report_version_materialization_ownership();
  `);
}

export function down(pgm: MigrationBuilder): void {
  pgm.sql(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM report_materialization_run
        WHERE job_id IS NOT NULL
      ) OR EXISTS (
        SELECT 1
        FROM report_version
        WHERE materialization_run_id IS NOT NULL
      ) THEN
        RAISE EXCEPTION
          'cannot roll back report materialization completion with persisted data';
      END IF;
    END;
    $$;

    DROP TRIGGER IF EXISTS
      report_version_materialization_ownership_trigger
      ON report_version;
    DROP FUNCTION IF EXISTS
      enforce_report_version_materialization_ownership();
    DROP TRIGGER IF EXISTS
      report_materialization_completion_ownership_trigger
      ON report_materialization_run;
    DROP FUNCTION IF EXISTS
      enforce_report_materialization_completion_ownership();

    DROP INDEX IF EXISTS report_version_materialization_run_idx;
    ALTER TABLE report_version
      DROP COLUMN IF EXISTS materialization_run_id;

    DROP TABLE IF EXISTS report_materialization_block;

    DELETE FROM report_materialization_run
      WHERE job_id IN (
        SELECT job_id FROM workflow_job
        WHERE job_type = 'report_materialization'
      );

    ALTER TABLE report_materialization_run
      DROP CONSTRAINT IF EXISTS report_materialization_ready_count_check,
      DROP COLUMN IF EXISTS blocker_codes,
      DROP COLUMN IF EXISTS ready_block_count,
      DROP COLUMN IF EXISTS required_block_count,
      DROP COLUMN IF EXISTS materialization_version,
      DROP COLUMN IF EXISTS materialization_resource_version_id,
      DROP COLUMN IF EXISTS job_id;

    DELETE FROM workflow_job
      WHERE job_type = 'report_materialization';

    ALTER TABLE workflow_job
      DROP CONSTRAINT workflow_job_job_type_check;
    ALTER TABLE workflow_job
      ADD CONSTRAINT workflow_job_job_type_check
      CHECK (job_type IN (
        'file_ingest', 'file_inspection', 'hypothesis_generation',
        'research_collection', 'evidence_reinvestigation', 'reconciliation',
        'workbook_application'
      ));
  `);
}
