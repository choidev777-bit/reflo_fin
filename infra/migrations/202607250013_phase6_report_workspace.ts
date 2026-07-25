import type { MigrationBuilder } from "node-pg-migrate";

export function up(pgm: MigrationBuilder): void {
  pgm.sql(`
    CREATE TABLE report_outline (
      project_id uuid PRIMARY KEY REFERENCES project(project_id) ON DELETE CASCADE,
      outline_id uuid NOT NULL UNIQUE,
      resource_id uuid NOT NULL UNIQUE
        REFERENCES versioned_resource(resource_id) ON DELETE RESTRICT,
      current_resource_version_id uuid NOT NULL
        REFERENCES resource_version(resource_version_id) ON DELETE RESTRICT,
      current_version bigint NOT NULL CHECK (current_version > 0),
      status text NOT NULL
        CHECK (status IN ('editing', 'approved', 'revalidation_required')),
      saved_at timestamptz NOT NULL DEFAULT now(),
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE report_outline_version (
      resource_version_id uuid PRIMARY KEY
        REFERENCES resource_version(resource_version_id) ON DELETE CASCADE,
      outline_id uuid NOT NULL REFERENCES report_outline(outline_id) ON DELETE CASCADE,
      version_no bigint NOT NULL CHECK (version_no > 0),
      template_resource_version_id uuid NOT NULL
        REFERENCES template_ir_version(resource_version_id) ON DELETE RESTRICT,
      mapping_set_resource_version_id uuid NOT NULL
        REFERENCES mapping_set_version(resource_version_id) ON DELETE RESTRICT,
      validation_approval_id uuid NOT NULL
        REFERENCES validation_approval(approval_id) ON DELETE RESTRICT,
      valuation_approval_id uuid NOT NULL
        REFERENCES valuation_approval(approval_id) ON DELETE RESTRICT,
      hypothesis_resource_version_id uuid NOT NULL
        REFERENCES project_hypothesis_version(resource_version_id) ON DELETE RESTRICT,
      generator_profile_version text NOT NULL,
      content_json jsonb NOT NULL,
      created_by_user_id uuid NOT NULL
        REFERENCES user_account(user_id) ON DELETE RESTRICT,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (outline_id, version_no)
    );

    CREATE TABLE report_outline_page_review (
      outline_id uuid NOT NULL REFERENCES report_outline(outline_id) ON DELETE CASCADE,
      page_id text NOT NULL,
      reviewed_version bigint NOT NULL CHECK (reviewed_version > 0),
      reviewed_by_user_id uuid NOT NULL
        REFERENCES user_account(user_id) ON DELETE RESTRICT,
      reviewed_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (outline_id, page_id)
    );

    CREATE TABLE report_outline_approval (
      approval_id uuid PRIMARY KEY,
      project_id uuid NOT NULL REFERENCES project(project_id) ON DELETE CASCADE,
      outline_id uuid NOT NULL REFERENCES report_outline(outline_id) ON DELETE RESTRICT,
      outline_resource_version_id uuid NOT NULL UNIQUE
        REFERENCES report_outline_version(resource_version_id) ON DELETE RESTRICT,
      outline_version bigint NOT NULL CHECK (outline_version > 0),
      input_versions_json jsonb NOT NULL,
      approved_by_user_id uuid NOT NULL
        REFERENCES user_account(user_id) ON DELETE RESTRICT,
      approved_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (project_id, outline_id, outline_version)
    );

    CREATE TABLE report (
      project_id uuid PRIMARY KEY REFERENCES project(project_id) ON DELETE CASCADE,
      report_id uuid NOT NULL UNIQUE,
      resource_id uuid NOT NULL UNIQUE
        REFERENCES versioned_resource(resource_id) ON DELETE RESTRICT,
      outline_approval_id uuid NOT NULL
        REFERENCES report_outline_approval(approval_id) ON DELETE RESTRICT,
      active_resource_version_id uuid
        REFERENCES resource_version(resource_version_id) ON DELETE RESTRICT,
      approved_resource_version_id uuid
        REFERENCES resource_version(resource_version_id) ON DELETE RESTRICT,
      current_version bigint NOT NULL DEFAULT 1 CHECK (current_version > 0),
      status text NOT NULL
        CHECK (status IN ('working', 'approved', 'revalidation_required')),
      updated_at timestamptz NOT NULL DEFAULT now(),
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE report_version (
      resource_version_id uuid PRIMARY KEY
        REFERENCES resource_version(resource_version_id) ON DELETE CASCADE,
      report_id uuid NOT NULL REFERENCES report(report_id) ON DELETE CASCADE,
      version_no bigint NOT NULL CHECK (version_no > 0),
      parent_resource_version_id uuid
        REFERENCES report_version(resource_version_id) ON DELETE RESTRICT,
      outline_approval_id uuid NOT NULL
        REFERENCES report_outline_approval(approval_id) ON DELETE RESTRICT,
      version_status text NOT NULL
        CHECK (version_status IN ('working', 'approved', 'superseded')),
      content_json jsonb NOT NULL,
      saved_by_user_id uuid NOT NULL
        REFERENCES user_account(user_id) ON DELETE RESTRICT,
      saved_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (report_id, version_no)
    );

    CREATE TABLE report_edit_session (
      edit_session_id uuid PRIMARY KEY,
      report_id uuid NOT NULL REFERENCES report(report_id) ON DELETE CASCADE,
      report_resource_version_id uuid NOT NULL
        REFERENCES report_version(resource_version_id) ON DELETE CASCADE,
      user_id uuid NOT NULL REFERENCES user_account(user_id) ON DELETE CASCADE,
      session_status text NOT NULL
        CHECK (session_status IN ('active', 'expired', 'released')),
      lease_token_hash char(64) NOT NULL,
      lease_expires_at timestamptz NOT NULL,
      heartbeat_at timestamptz NOT NULL DEFAULT now(),
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE UNIQUE INDEX report_edit_session_active_idx
      ON report_edit_session (report_id)
      WHERE session_status = 'active';

    CREATE TABLE report_edit_operation (
      operation_id uuid PRIMARY KEY,
      report_id uuid NOT NULL REFERENCES report(report_id) ON DELETE CASCADE,
      base_resource_version_id uuid NOT NULL
        REFERENCES report_version(resource_version_id) ON DELETE RESTRICT,
      result_resource_version_id uuid NOT NULL
        REFERENCES report_version(resource_version_id) ON DELETE RESTRICT,
      edit_session_id uuid NOT NULL
        REFERENCES report_edit_session(edit_session_id) ON DELETE RESTRICT,
      client_mutation_id uuid NOT NULL,
      operations_json jsonb NOT NULL,
      created_by_user_id uuid NOT NULL
        REFERENCES user_account(user_id) ON DELETE RESTRICT,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (report_id, client_mutation_id)
    );

    CREATE TABLE report_ai_proposal (
      proposal_id uuid PRIMARY KEY,
      project_id uuid NOT NULL REFERENCES project(project_id) ON DELETE CASCADE,
      report_id uuid NOT NULL REFERENCES report(report_id) ON DELETE CASCADE,
      base_resource_version_id uuid NOT NULL
        REFERENCES report_version(resource_version_id) ON DELETE RESTRICT,
      block_id text NOT NULL,
      prompt text NOT NULL,
      original_text text NOT NULL,
      proposed_text text NOT NULL,
      proposal_status text NOT NULL
        CHECK (proposal_status IN ('ready', 'applied', 'discarded', 'stale', 'failed')),
      model_profile_version text NOT NULL,
      created_by_user_id uuid NOT NULL
        REFERENCES user_account(user_id) ON DELETE RESTRICT,
      created_at timestamptz NOT NULL DEFAULT now(),
      applied_at timestamptz
    );

    CREATE TABLE report_preview (
      preview_id uuid PRIMARY KEY,
      project_id uuid NOT NULL REFERENCES project(project_id) ON DELETE CASCADE,
      report_resource_version_id uuid NOT NULL
        REFERENCES report_version(resource_version_id) ON DELETE CASCADE,
      preview_status text NOT NULL
        CHECK (preview_status IN ('queued', 'rendering', 'verifying', 'ready', 'failed', 'stale')),
      source_artifact_id uuid REFERENCES artifact(artifact_id) ON DELETE RESTRICT,
      warnings_json jsonb NOT NULL DEFAULT '[]'::jsonb,
      created_by_user_id uuid NOT NULL
        REFERENCES user_account(user_id) ON DELETE RESTRICT,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE report_validation_run (
      validation_run_id uuid PRIMARY KEY,
      project_id uuid NOT NULL REFERENCES project(project_id) ON DELETE CASCADE,
      report_resource_version_id uuid NOT NULL
        REFERENCES report_version(resource_version_id) ON DELETE CASCADE,
      validation_status text NOT NULL
        CHECK (validation_status IN ('queued', 'running', 'passed', 'passed_with_warnings', 'failed', 'cancelled')),
      issues_json jsonb NOT NULL DEFAULT '[]'::jsonb,
      rule_version text NOT NULL,
      acknowledged_warning_codes text[] NOT NULL DEFAULT '{}',
      created_by_user_id uuid NOT NULL
        REFERENCES user_account(user_id) ON DELETE RESTRICT,
      started_at timestamptz NOT NULL DEFAULT now(),
      finished_at timestamptz
    );

    CREATE TABLE report_approval (
      approval_id uuid PRIMARY KEY,
      project_id uuid NOT NULL REFERENCES project(project_id) ON DELETE CASCADE,
      report_resource_version_id uuid NOT NULL UNIQUE
        REFERENCES report_version(resource_version_id) ON DELETE RESTRICT,
      validation_run_id uuid NOT NULL UNIQUE
        REFERENCES report_validation_run(validation_run_id) ON DELETE RESTRICT,
      approved_by_user_id uuid NOT NULL
        REFERENCES user_account(user_id) ON DELETE RESTRICT,
      approved_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE report_export (
      export_id uuid PRIMARY KEY,
      project_id uuid NOT NULL REFERENCES project(project_id) ON DELETE CASCADE,
      report_approval_id uuid NOT NULL
        REFERENCES report_approval(approval_id) ON DELETE RESTRICT,
      operation_status text NOT NULL
        CHECK (operation_status IN ('queued', 'running', 'succeeded', 'failed', 'cancel_requested', 'cancelled')),
      outcome text NOT NULL CHECK (outcome IN ('pending', 'complete', 'partial')),
      requested_by_user_id uuid NOT NULL
        REFERENCES user_account(user_id) ON DELETE RESTRICT,
      requested_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (report_approval_id)
    );

    CREATE TABLE report_export_artifact (
      export_artifact_id uuid PRIMARY KEY,
      export_id uuid NOT NULL REFERENCES report_export(export_id) ON DELETE CASCADE,
      artifact_type text NOT NULL CHECK (artifact_type IN ('pdf', 'xlsx')),
      source_artifact_id uuid REFERENCES artifact(artifact_id) ON DELETE RESTRICT,
      artifact_status text NOT NULL
        CHECK (artifact_status IN ('pending', 'generating', 'verifying', 'publishing', 'ready', 'failed', 'cancelled')),
      attempt_no integer NOT NULL DEFAULT 1 CHECK (attempt_no > 0),
      retryable boolean NOT NULL DEFAULT false,
      error_code text,
      error_message text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (export_id, artifact_type)
    );

    CREATE INDEX report_outline_version_outline_idx
      ON report_outline_version (outline_id, version_no DESC);
    CREATE INDEX report_version_report_idx
      ON report_version (report_id, version_no DESC);
    CREATE INDEX report_preview_version_idx
      ON report_preview (report_resource_version_id, created_at DESC);
    CREATE INDEX report_validation_version_idx
      ON report_validation_run (report_resource_version_id, started_at DESC);
  `);
}

export function down(pgm: MigrationBuilder): void {
  pgm.sql(`
    DROP TABLE IF EXISTS report_export_artifact;
    DROP TABLE IF EXISTS report_export;
    DROP TABLE IF EXISTS report_approval;
    DROP TABLE IF EXISTS report_validation_run;
    DROP TABLE IF EXISTS report_preview;
    DROP TABLE IF EXISTS report_ai_proposal;
    DROP TABLE IF EXISTS report_edit_operation;
    DROP TABLE IF EXISTS report_edit_session;
    DROP TABLE IF EXISTS report_version;
    DROP TABLE IF EXISTS report;
    DROP TABLE IF EXISTS report_outline_approval;
    DROP TABLE IF EXISTS report_outline_page_review;
    DROP TABLE IF EXISTS report_outline_version;
    DROP TABLE IF EXISTS report_outline;
  `);
}
