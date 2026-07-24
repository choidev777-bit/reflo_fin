import type { MigrationBuilder } from "node-pg-migrate";

export function up(pgm: MigrationBuilder): void {
  pgm.sql(`
    CREATE TABLE upload_session (
      upload_session_id uuid PRIMARY KEY,
      project_id uuid NOT NULL REFERENCES project(project_id) ON DELETE CASCADE,
      requested_by_user_id uuid NOT NULL REFERENCES user_account(user_id) ON DELETE RESTRICT,
      upload_role text NOT NULL
        CHECK (upload_role IN ('previous_report_pdf', 'analysis_workbook')),
      quarantine_object_key text NOT NULL UNIQUE,
      expected_media_types text[] NOT NULL,
      max_byte_size bigint NOT NULL CHECK (max_byte_size > 0),
      declared_byte_size bigint NOT NULL CHECK (declared_byte_size > 0),
      client_filename text NOT NULL
        CHECK (char_length(client_filename) BETWEEN 1 AND 255),
      expected_sha256 char(64),
      upload_status text NOT NULL DEFAULT 'uploading'
        CHECK (upload_status IN (
          'uploading', 'verifying', 'scanning', 'accepted', 'rejected', 'cancelled'
        )),
      artifact_id uuid,
      file_version_id uuid,
      error_code text,
      expires_at timestamptz NOT NULL,
      completed_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE INDEX upload_session_project_role_idx
      ON upload_session (project_id, upload_role, created_at DESC);
    CREATE INDEX upload_session_expiry_idx
      ON upload_session (expires_at)
      WHERE upload_status IN ('uploading', 'verifying', 'scanning');

    CREATE TABLE artifact (
      artifact_id uuid PRIMARY KEY,
      project_id uuid NOT NULL REFERENCES project(project_id) ON DELETE CASCADE,
      artifact_kind text NOT NULL
        CHECK (artifact_kind IN (
          'upload', 'source', 'working_copy', 'analysis', 'render',
          'validation', 'agent_output', 'diagnostic', 'final'
        )),
      storage_status text NOT NULL
        CHECK (storage_status IN (
          'quarantined', 'accepted', 'temporary', 'final', 'superseded', 'deleted'
        )),
      bucket_name text NOT NULL,
      object_key text NOT NULL,
      object_version text NOT NULL DEFAULT 'null',
      sha256 char(64) NOT NULL,
      byte_size bigint NOT NULL CHECK (byte_size >= 0),
      media_type text NOT NULL,
      original_filename text,
      retention_class text NOT NULL
        CHECK (retention_class IN ('temporary', 'project', 'evidence', 'final', 'legal_hold')),
      created_by_actor_type text NOT NULL
        CHECK (created_by_actor_type IN ('user', 'worker', 'system')),
      supersedes_artifact_id uuid REFERENCES artifact(artifact_id) ON DELETE RESTRICT,
      created_at timestamptz NOT NULL DEFAULT now(),
      deleted_at timestamptz,
      UNIQUE (bucket_name, object_key, object_version)
    );

    ALTER TABLE upload_session
      ADD CONSTRAINT upload_session_artifact_fk
      FOREIGN KEY (artifact_id) REFERENCES artifact(artifact_id) ON DELETE SET NULL;

    CREATE INDEX artifact_project_hash_idx
      ON artifact (project_id, sha256, byte_size)
      WHERE deleted_at IS NULL;

    CREATE TABLE project_file_version (
      resource_version_id uuid PRIMARY KEY
        REFERENCES resource_version(resource_version_id) ON DELETE CASCADE,
      artifact_id uuid NOT NULL REFERENCES artifact(artifact_id) ON DELETE RESTRICT,
      file_role text NOT NULL
        CHECK (file_role IN ('previous_report_pdf', 'analysis_workbook')),
      inspection_status text NOT NULL
        CHECK (inspection_status IN ('scanning', 'accepted', 'rejected', 'superseded')),
      detected_filename text NOT NULL,
      detected_media_type text,
      inspection_job_id uuid,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    ALTER TABLE upload_session
      ADD CONSTRAINT upload_session_file_version_fk
      FOREIGN KEY (file_version_id)
      REFERENCES project_file_version(resource_version_id)
      ON DELETE SET NULL;

    CREATE UNIQUE INDEX project_file_current_role_idx
      ON project_file_version (file_role, resource_version_id);

    CREATE TABLE resource_artifact (
      resource_version_id uuid NOT NULL
        REFERENCES resource_version(resource_version_id) ON DELETE CASCADE,
      artifact_role text NOT NULL,
      artifact_id uuid NOT NULL REFERENCES artifact(artifact_id) ON DELETE RESTRICT,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (resource_version_id, artifact_role, artifact_id)
    );

    CREATE TABLE workflow_job (
      job_id uuid PRIMARY KEY,
      project_id uuid NOT NULL REFERENCES project(project_id) ON DELETE CASCADE,
      job_type text NOT NULL
        CHECK (job_type IN ('file_ingest', 'file_inspection', 'reconciliation')),
      temporal_workflow_id text NOT NULL UNIQUE,
      operation_status text NOT NULL DEFAULT 'queued'
        CHECK (operation_status IN (
          'queued', 'running', 'succeeded', 'failed', 'cancel_requested', 'cancelled'
        )),
      validity_status text NOT NULL DEFAULT 'current'
        CHECK (validity_status IN ('current', 'obsolete')),
      current_phase text,
      progress_percent integer NOT NULL DEFAULT 0
        CHECK (progress_percent BETWEEN 0 AND 100),
      progress_mode text NOT NULL DEFAULT 'determinate'
        CHECK (progress_mode IN ('determinate', 'indeterminate')),
      progress_sequence bigint NOT NULL DEFAULT 0 CHECK (progress_sequence >= 0),
      attempt integer NOT NULL DEFAULT 1 CHECK (attempt > 0),
      input_fingerprint char(64) NOT NULL,
      requested_by_user_id uuid REFERENCES user_account(user_id) ON DELETE RESTRICT,
      requested_at timestamptz NOT NULL DEFAULT now(),
      started_at timestamptz,
      heartbeat_at timestamptz,
      finished_at timestamptz,
      retryable boolean NOT NULL DEFAULT false,
      error_code text,
      error_summary text,
      result_summary_json jsonb NOT NULL DEFAULT '{}'::jsonb
    );

    CREATE INDEX workflow_job_project_status_idx
      ON workflow_job (project_id, operation_status, requested_at DESC);
    CREATE INDEX workflow_job_reconciliation_idx
      ON workflow_job (operation_status, heartbeat_at)
      WHERE operation_status IN ('queued', 'running', 'cancel_requested');

    CREATE TABLE workflow_job_input (
      job_id uuid NOT NULL REFERENCES workflow_job(job_id) ON DELETE CASCADE,
      input_role text NOT NULL,
      resource_version_id uuid NOT NULL
        REFERENCES resource_version(resource_version_id) ON DELETE RESTRICT,
      PRIMARY KEY (job_id, input_role)
    );

    CREATE TABLE workflow_job_output (
      job_id uuid NOT NULL REFERENCES workflow_job(job_id) ON DELETE CASCADE,
      output_role text NOT NULL,
      resource_version_id uuid NOT NULL
        REFERENCES resource_version(resource_version_id) ON DELETE RESTRICT,
      PRIMARY KEY (job_id, output_role)
    );

    CREATE TABLE workflow_job_event (
      job_event_id uuid PRIMARY KEY,
      job_id uuid NOT NULL REFERENCES workflow_job(job_id) ON DELETE CASCADE,
      sequence_no bigint NOT NULL CHECK (sequence_no > 0),
      event_type text NOT NULL,
      operation_status text,
      phase text,
      progress_percent integer CHECK (progress_percent BETWEEN 0 AND 100),
      error_code text,
      metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
      occurred_at timestamptz NOT NULL,
      received_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (job_id, sequence_no)
    );

    CREATE TABLE job_activity_attempt (
      activity_attempt_id uuid PRIMARY KEY,
      job_id uuid NOT NULL REFERENCES workflow_job(job_id) ON DELETE CASCADE,
      activity_key text NOT NULL,
      attempt_no integer NOT NULL CHECK (attempt_no > 0),
      task_queue text NOT NULL,
      operation_status text NOT NULL
        CHECK (operation_status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
      heartbeat_at timestamptz,
      started_at timestamptz,
      finished_at timestamptz,
      tool_name text,
      tool_version text,
      schema_version text,
      output_artifact_id uuid REFERENCES artifact(artifact_id) ON DELETE SET NULL,
      error_code text,
      UNIQUE (job_id, activity_key, attempt_no)
    );

    CREATE TABLE outbox_event (
      outbox_event_id uuid PRIMARY KEY,
      job_id uuid NOT NULL REFERENCES workflow_job(job_id) ON DELETE CASCADE,
      command_type text NOT NULL,
      command_id uuid NOT NULL UNIQUE,
      payload_json jsonb NOT NULL,
      schema_version text NOT NULL DEFAULT '1.0.0',
      dispatch_status text NOT NULL DEFAULT 'pending'
        CHECK (dispatch_status IN ('pending', 'dispatching', 'dispatched', 'failed')),
      attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
      next_attempt_at timestamptz NOT NULL DEFAULT now(),
      lease_owner text,
      lease_expires_at timestamptz,
      dispatched_at timestamptz,
      last_error_code text,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE INDEX outbox_dispatch_idx
      ON outbox_event (dispatch_status, next_attempt_at, lease_expires_at)
      WHERE dispatch_status IN ('pending', 'dispatching', 'failed');

    CREATE TABLE artifact_scan_result (
      scan_result_id uuid PRIMARY KEY,
      artifact_id uuid NOT NULL REFERENCES artifact(artifact_id) ON DELETE CASCADE,
      job_id uuid NOT NULL REFERENCES workflow_job(job_id) ON DELETE CASCADE,
      scan_status text NOT NULL CHECK (scan_status IN ('passed', 'failed')),
      detected_media_type text NOT NULL,
      magic_bytes text,
      encrypted boolean NOT NULL DEFAULT false,
      macro_detected boolean NOT NULL DEFAULT false,
      malware_result text NOT NULL
        CHECK (malware_result IN ('clean', 'infected', 'scan_unavailable')),
      tool_name text NOT NULL,
      tool_version text NOT NULL,
      scanned_at timestamptz NOT NULL,
      details_json jsonb NOT NULL DEFAULT '{}'::jsonb
    );

    CREATE TABLE file_inspection (
      inspection_id uuid PRIMARY KEY,
      project_id uuid NOT NULL REFERENCES project(project_id) ON DELETE CASCADE,
      job_id uuid NOT NULL UNIQUE REFERENCES workflow_job(job_id) ON DELETE CASCADE,
      pdf_file_version_id uuid NOT NULL
        REFERENCES project_file_version(resource_version_id) ON DELETE RESTRICT,
      workbook_file_version_id uuid NOT NULL
        REFERENCES project_file_version(resource_version_id) ON DELETE RESTRICT,
      outcome text CHECK (outcome IN ('passed', 'failed')),
      issues_json jsonb NOT NULL DEFAULT '[]'::jsonb,
      template_version_no bigint,
      workbook_version_no bigint,
      mapping_set_version_no bigint,
      template_resource_version_id uuid REFERENCES resource_version(resource_version_id) ON DELETE RESTRICT,
      workbook_resource_version_id uuid REFERENCES resource_version(resource_version_id) ON DELETE RESTRICT,
      mapping_set_resource_version_id uuid REFERENCES resource_version(resource_version_id) ON DELETE RESTRICT,
      mapping_status text NOT NULL DEFAULT 'pending'
        CHECK (mapping_status IN ('pending', 'confirmed', 'blocked')),
      created_at timestamptz NOT NULL DEFAULT now(),
      completed_at timestamptz
    );

    CREATE TABLE template_ir_version (
      resource_version_id uuid PRIMARY KEY
        REFERENCES resource_version(resource_version_id) ON DELETE CASCADE,
      source_file_version_id uuid NOT NULL
        REFERENCES project_file_version(resource_version_id) ON DELETE RESTRICT,
      page_count integer NOT NULL CHECK (page_count > 0),
      parser_name text NOT NULL,
      parser_version text NOT NULL,
      validation_status text NOT NULL CHECK (validation_status IN ('passed', 'failed'))
    );

    CREATE TABLE workbook_version (
      resource_version_id uuid PRIMARY KEY
        REFERENCES resource_version(resource_version_id) ON DELETE CASCADE,
      source_file_version_id uuid NOT NULL
        REFERENCES project_file_version(resource_version_id) ON DELETE RESTRICT,
      original_sha256 char(64) NOT NULL,
      structure_hash char(64) NOT NULL,
      calculation_status text NOT NULL,
      calculation_engine text NOT NULL,
      engine_version text NOT NULL,
      compatibility_status text NOT NULL CHECK (compatibility_status IN ('passed', 'failed'))
    );

    CREATE TABLE mapping_set_version (
      resource_version_id uuid PRIMARY KEY
        REFERENCES resource_version(resource_version_id) ON DELETE CASCADE,
      template_ir_version_id uuid NOT NULL
        REFERENCES template_ir_version(resource_version_id) ON DELETE RESTRICT,
      workbook_version_id uuid NOT NULL
        REFERENCES workbook_version(resource_version_id) ON DELETE RESTRICT,
      mapping_status text NOT NULL CHECK (mapping_status IN ('draft', 'confirmed', 'blocked')),
      mapping_schema_version text NOT NULL DEFAULT '1.0.0',
      validation_summary_json jsonb NOT NULL DEFAULT '{}'::jsonb
    );

    CREATE TABLE reconciliation_issue (
      reconciliation_issue_id uuid PRIMARY KEY,
      job_id uuid NOT NULL REFERENCES workflow_job(job_id) ON DELETE CASCADE,
      issue_type text NOT NULL,
      expected_state text,
      observed_state text,
      issue_status text NOT NULL DEFAULT 'open'
        CHECK (issue_status IN ('open', 'repaired', 'ignored')),
      first_seen_at timestamptz NOT NULL DEFAULT now(),
      last_seen_at timestamptz NOT NULL DEFAULT now(),
      repair_action text,
      repaired_at timestamptz
    );

    ALTER TABLE project_file_version
      ADD CONSTRAINT project_file_inspection_job_fk
      FOREIGN KEY (inspection_job_id) REFERENCES workflow_job(job_id) ON DELETE SET NULL;
  `);
}

export function down(pgm: MigrationBuilder): void {
  pgm.sql(`
    ALTER TABLE project_file_version
      DROP CONSTRAINT IF EXISTS project_file_inspection_job_fk;
    DROP TABLE IF EXISTS reconciliation_issue;
    DROP TABLE IF EXISTS mapping_set_version;
    DROP TABLE IF EXISTS workbook_version;
    DROP TABLE IF EXISTS template_ir_version;
    DROP TABLE IF EXISTS file_inspection;
    DROP TABLE IF EXISTS artifact_scan_result;
    DROP TABLE IF EXISTS outbox_event;
    DROP TABLE IF EXISTS job_activity_attempt;
    DROP TABLE IF EXISTS workflow_job_event;
    DROP TABLE IF EXISTS workflow_job_output;
    DROP TABLE IF EXISTS workflow_job_input;
    DROP TABLE IF EXISTS workflow_job;
    DROP TABLE IF EXISTS resource_artifact;
    ALTER TABLE upload_session
      DROP CONSTRAINT IF EXISTS upload_session_file_version_fk;
    DROP TABLE IF EXISTS project_file_version;
    ALTER TABLE upload_session
      DROP CONSTRAINT IF EXISTS upload_session_artifact_fk;
    DROP TABLE IF EXISTS artifact;
    DROP TABLE IF EXISTS upload_session;
  `);
}
