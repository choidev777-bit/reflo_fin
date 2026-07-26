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
        'workbook_application'
      ));

    ALTER TABLE source_snapshot
      DROP CONSTRAINT source_snapshot_snapshot_scope_check;
    ALTER TABLE source_snapshot
      ADD CONSTRAINT source_snapshot_snapshot_scope_check
      CHECK (snapshot_scope IN (
        'workflow_job', 'validation_workbook',
        'report_materialization', 'report_render'
      ));

    CREATE TABLE validated_value_set_version (
      resource_version_id uuid PRIMARY KEY
        REFERENCES resource_version(resource_version_id) ON DELETE CASCADE,
      project_id uuid NOT NULL REFERENCES project(project_id) ON DELETE CASCADE,
      validation_run_id uuid NOT NULL
        REFERENCES validation_run(validation_run_id) ON DELETE RESTRICT,
      validation_version bigint NOT NULL CHECK (validation_version > 0),
      approved_plan_resource_version_id uuid NOT NULL
        REFERENCES research_plan_version(resource_version_id) ON DELETE RESTRICT,
      source_snapshot_id uuid NOT NULL,
      source_fingerprint char(64) NOT NULL
        CHECK (source_fingerprint ~ '^[0-9a-f]{64}$'),
      status text NOT NULL CHECK (status IN ('approved', 'obsolete')),
      value_set_json jsonb NOT NULL,
      content_hash char(64) NOT NULL
        CHECK (content_hash ~ '^[0-9a-f]{64}$'),
      approved_by_user_id uuid NOT NULL
        REFERENCES user_account(user_id) ON DELETE RESTRICT,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (project_id, validation_run_id, validation_version),
      UNIQUE (resource_version_id, project_id),
      FOREIGN KEY (source_snapshot_id, project_id, source_fingerprint)
        REFERENCES source_snapshot(
          source_snapshot_id, project_id, fingerprint
        ) ON DELETE RESTRICT
    );

    CREATE INDEX validated_value_set_project_status_idx
      ON validated_value_set_version (
        project_id, status, validation_version DESC
      );

    CREATE TABLE workbook_write_proposal_decision (
      decision_id uuid PRIMARY KEY,
      project_id uuid NOT NULL REFERENCES project(project_id) ON DELETE CASCADE,
      validated_value_set_resource_version_id uuid NOT NULL,
      source_workbook_resource_version_id uuid NOT NULL
        REFERENCES workbook_version(resource_version_id) ON DELETE RESTRICT,
      mapping_set_resource_version_id uuid NOT NULL
        REFERENCES mapping_set_version(resource_version_id) ON DELETE RESTRICT,
      source_snapshot_id uuid NOT NULL,
      source_fingerprint char(64) NOT NULL
        CHECK (source_fingerprint ~ '^[0-9a-f]{64}$'),
      target_id text NOT NULL,
      decision_no bigint NOT NULL CHECK (decision_no > 0),
      action text NOT NULL CHECK (action IN ('approve', 'reject', 'modify')),
      before_command_json jsonb NOT NULL,
      after_command_json jsonb,
      evidence_ids uuid[] NOT NULL CHECK (cardinality(evidence_ids) > 0),
      reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 1 AND 1000),
      supersedes_decision_id uuid
        REFERENCES workbook_write_proposal_decision(decision_id)
        ON DELETE RESTRICT,
      decided_by_user_id uuid NOT NULL
        REFERENCES user_account(user_id) ON DELETE RESTRICT,
      decided_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (
        project_id, validated_value_set_resource_version_id,
        source_workbook_resource_version_id,
        mapping_set_resource_version_id, source_fingerprint,
        target_id, decision_no
      ),
      FOREIGN KEY (
        validated_value_set_resource_version_id, project_id
      ) REFERENCES validated_value_set_version(
        resource_version_id, project_id
      ) ON DELETE RESTRICT,
      FOREIGN KEY (source_snapshot_id, project_id, source_fingerprint)
        REFERENCES source_snapshot(
          source_snapshot_id, project_id, fingerprint
        ) ON DELETE RESTRICT
    );

    CREATE INDEX workbook_write_proposal_latest_idx
      ON workbook_write_proposal_decision (
        project_id, validated_value_set_resource_version_id,
        source_workbook_resource_version_id,
        mapping_set_resource_version_id, source_fingerprint,
        target_id, decision_no DESC
      );

    CREATE TABLE workbook_application_run (
      workbook_application_id uuid PRIMARY KEY,
      project_id uuid NOT NULL REFERENCES project(project_id) ON DELETE CASCADE,
      job_id uuid NOT NULL UNIQUE
        REFERENCES workflow_job(job_id) ON DELETE CASCADE,
      validated_value_set_resource_version_id uuid NOT NULL,
      source_workbook_resource_version_id uuid NOT NULL
        REFERENCES workbook_version(resource_version_id) ON DELETE RESTRICT,
      mapping_set_resource_version_id uuid NOT NULL
        REFERENCES mapping_set_version(resource_version_id) ON DELETE RESTRICT,
      source_workbook_artifact_id uuid NOT NULL
        REFERENCES artifact(artifact_id) ON DELETE RESTRICT,
      source_snapshot_id uuid NOT NULL,
      source_fingerprint char(64) NOT NULL
        CHECK (source_fingerprint ~ '^[0-9a-f]{64}$'),
      input_workbook_version bigint NOT NULL DEFAULT 1
        CHECK (input_workbook_version > 0),
      application_plan_json jsonb NOT NULL,
      plan_hash char(64) NOT NULL CHECK (plan_hash ~ '^[0-9a-f]{64}$'),
      application_status text NOT NULL
        CHECK (application_status IN (
          'queued', 'running', 'succeeded', 'failed', 'obsolete'
        )),
      applied_cell_count integer NOT NULL DEFAULT 0
        CHECK (applied_cell_count >= 0),
      blocked_cell_count integer NOT NULL DEFAULT 0
        CHECK (blocked_cell_count >= 0),
      output_artifact_id uuid REFERENCES artifact(artifact_id) ON DELETE RESTRICT,
      calculation_report_json jsonb,
      worker_result_json jsonb,
      error_code text,
      error_summary text,
      requested_by_user_id uuid NOT NULL
        REFERENCES user_account(user_id) ON DELETE RESTRICT,
      requested_at timestamptz NOT NULL DEFAULT now(),
      started_at timestamptz,
      finished_at timestamptz,
      UNIQUE (workbook_application_id, project_id),
      FOREIGN KEY (
        validated_value_set_resource_version_id, project_id
      ) REFERENCES validated_value_set_version(
        resource_version_id, project_id
      ) ON DELETE RESTRICT,
      FOREIGN KEY (source_snapshot_id, project_id, source_fingerprint)
        REFERENCES source_snapshot(
          source_snapshot_id, project_id, fingerprint
        ) ON DELETE RESTRICT
    );

    CREATE UNIQUE INDEX workbook_application_current_input_idx
      ON workbook_application_run (
        project_id, validated_value_set_resource_version_id,
        source_workbook_resource_version_id, mapping_set_resource_version_id,
        source_fingerprint
      )
      WHERE application_status IN ('queued', 'running', 'succeeded');

    CREATE INDEX workbook_application_project_status_idx
      ON workbook_application_run (
        project_id, application_status, requested_at DESC
      );

    CREATE TABLE workbook_application_decision (
      decision_id uuid PRIMARY KEY,
      project_id uuid NOT NULL REFERENCES project(project_id) ON DELETE CASCADE,
      workbook_application_id uuid NOT NULL,
      target_id text NOT NULL,
      decision_no bigint NOT NULL CHECK (decision_no > 0),
      action text NOT NULL CHECK (action IN ('approve', 'reject', 'modify')),
      before_command_json jsonb,
      after_command_json jsonb,
      evidence_ids uuid[] NOT NULL CHECK (cardinality(evidence_ids) > 0),
      reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 1 AND 1000),
      supersedes_decision_id uuid
        REFERENCES workbook_application_decision(decision_id) ON DELETE RESTRICT,
      decided_by_user_id uuid NOT NULL
        REFERENCES user_account(user_id) ON DELETE RESTRICT,
      decided_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (workbook_application_id, target_id, decision_no),
      FOREIGN KEY (workbook_application_id, project_id)
        REFERENCES workbook_application_run(
          workbook_application_id, project_id
        ) ON DELETE CASCADE
    );

    CREATE INDEX workbook_application_decision_target_idx
      ON workbook_application_decision (
        project_id, workbook_application_id, target_id, decision_no DESC
      );

    CREATE TABLE validated_workbook_version (
      resource_version_id uuid PRIMARY KEY
        REFERENCES resource_version(resource_version_id) ON DELETE CASCADE,
      project_id uuid NOT NULL REFERENCES project(project_id) ON DELETE CASCADE,
      workbook_application_id uuid NOT NULL UNIQUE,
      source_workbook_resource_version_id uuid NOT NULL
        REFERENCES workbook_version(resource_version_id) ON DELETE RESTRICT,
      mapping_set_resource_version_id uuid NOT NULL
        REFERENCES mapping_set_version(resource_version_id) ON DELETE RESTRICT,
      validated_value_set_resource_version_id uuid NOT NULL,
      artifact_id uuid NOT NULL UNIQUE
        REFERENCES artifact(artifact_id) ON DELETE RESTRICT,
      workbook_version bigint NOT NULL CHECK (workbook_version > 0),
      structure_hash char(64) NOT NULL
        CHECK (structure_hash ~ '^[0-9a-f]{64}$'),
      formula_hash char(64) NOT NULL
        CHECK (formula_hash ~ '^[0-9a-f]{64}$'),
      calculation_status text NOT NULL
        CHECK (calculation_status IN ('success', 'failed')),
      calculation_report_json jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (resource_version_id, project_id),
      FOREIGN KEY (workbook_application_id, project_id)
        REFERENCES workbook_application_run(
          workbook_application_id, project_id
        ) ON DELETE RESTRICT,
      FOREIGN KEY (
        validated_value_set_resource_version_id, project_id
      ) REFERENCES validated_value_set_version(
        resource_version_id, project_id
      ) ON DELETE RESTRICT
    );

    ALTER TABLE workbook_application_run
      ADD COLUMN output_workbook_resource_version_id uuid
        REFERENCES validated_workbook_version(resource_version_id)
        ON DELETE RESTRICT;

    ALTER TABLE validation_approval
      ADD COLUMN validated_value_set_resource_version_id uuid
        REFERENCES validated_value_set_version(resource_version_id)
        ON DELETE RESTRICT,
      ADD COLUMN validated_workbook_resource_version_id uuid
        REFERENCES validated_workbook_version(resource_version_id)
        ON DELETE RESTRICT,
      ADD COLUMN validated_workbook_artifact_id uuid
        REFERENCES artifact(artifact_id) ON DELETE RESTRICT,
      ADD COLUMN workbook_application_id uuid
        REFERENCES workbook_application_run(workbook_application_id)
        ON DELETE RESTRICT;

    CREATE UNIQUE INDEX validation_approval_workbook_application_idx
      ON validation_approval (workbook_application_id)
      WHERE workbook_application_id IS NOT NULL;

    ALTER TABLE valuation_workbook
      ADD COLUMN validation_approval_id uuid
        REFERENCES validation_approval(approval_id) ON DELETE RESTRICT,
      ADD COLUMN validated_value_set_resource_version_id uuid
        REFERENCES validated_value_set_version(resource_version_id)
        ON DELETE RESTRICT,
      ADD COLUMN validated_workbook_resource_version_id uuid
        REFERENCES validated_workbook_version(resource_version_id)
        ON DELETE RESTRICT;
  `);
}

export function down(pgm: MigrationBuilder): void {
  pgm.sql(`
    CREATE TEMP TABLE reflo_phase3_resource_versions
      ON COMMIT DROP AS
      SELECT resource_version_id
      FROM validated_value_set_version
      UNION
      SELECT resource_version_id
      FROM validated_workbook_version;

    ALTER TABLE valuation_workbook
      DROP COLUMN IF EXISTS validated_workbook_resource_version_id,
      DROP COLUMN IF EXISTS validated_value_set_resource_version_id,
      DROP COLUMN IF EXISTS validation_approval_id;

    DROP INDEX IF EXISTS validation_approval_workbook_application_idx;
    ALTER TABLE validation_approval
      DROP COLUMN IF EXISTS workbook_application_id,
      DROP COLUMN IF EXISTS validated_workbook_artifact_id,
      DROP COLUMN IF EXISTS validated_workbook_resource_version_id,
      DROP COLUMN IF EXISTS validated_value_set_resource_version_id;

    ALTER TABLE workbook_application_run
      DROP COLUMN IF EXISTS output_workbook_resource_version_id;
    DROP TABLE IF EXISTS validated_workbook_version;
    DROP TABLE IF EXISTS workbook_application_decision;
    DROP TABLE IF EXISTS workbook_application_run;
    DROP TABLE IF EXISTS workbook_write_proposal_decision;
    DROP TABLE IF EXISTS validated_value_set_version;

    DELETE FROM workflow_job
      WHERE job_type = 'workbook_application';
    DELETE FROM workflow_job_output
      WHERE resource_version_id IN (
        SELECT resource_version_id
        FROM reflo_phase3_resource_versions
      );
    DELETE FROM resource_dependency
      WHERE upstream_resource_version_id IN (
          SELECT resource_version_id
          FROM reflo_phase3_resource_versions
        )
        OR downstream_resource_version_id IN (
          SELECT resource_version_id
          FROM reflo_phase3_resource_versions
        );
    DELETE FROM resource_artifact
      WHERE resource_version_id IN (
        SELECT resource_version_id
        FROM reflo_phase3_resource_versions
      );
    DELETE FROM resource_version
      WHERE resource_version_id IN (
        SELECT resource_version_id
        FROM reflo_phase3_resource_versions
      );
    DELETE FROM versioned_resource resource
      WHERE resource.resource_kind IN (
          'validated_value_set', 'validated_workbook'
        )
        AND NOT EXISTS (
          SELECT 1
          FROM resource_version version
          WHERE version.resource_id = resource.resource_id
        );

    UPDATE workflow_job
      SET source_snapshot_id = NULL
      WHERE source_snapshot_id IN (
        SELECT source_snapshot_id
        FROM source_snapshot
        WHERE snapshot_scope = 'validation_workbook'
      );
    DELETE FROM source_snapshot
      WHERE snapshot_scope = 'validation_workbook';
    ALTER TABLE source_snapshot
      DROP CONSTRAINT source_snapshot_snapshot_scope_check;
    ALTER TABLE source_snapshot
      ADD CONSTRAINT source_snapshot_snapshot_scope_check
      CHECK (snapshot_scope IN (
        'workflow_job', 'report_materialization', 'report_render'
      ));

    ALTER TABLE workflow_job
      DROP CONSTRAINT workflow_job_job_type_check;
    ALTER TABLE workflow_job
      ADD CONSTRAINT workflow_job_job_type_check
      CHECK (job_type IN (
        'file_ingest', 'file_inspection', 'hypothesis_generation',
        'research_collection', 'evidence_reinvestigation', 'reconciliation'
      ));
  `);
}
