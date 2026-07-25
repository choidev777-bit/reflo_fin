import type { MigrationBuilder } from "node-pg-migrate";

export function up(pgm: MigrationBuilder): void {
  pgm.sql(`
    ALTER TABLE workflow_job
      DROP CONSTRAINT workflow_job_job_type_check;
    ALTER TABLE workflow_job
      ADD CONSTRAINT workflow_job_job_type_check
      CHECK (job_type IN (
        'file_ingest', 'file_inspection', 'hypothesis_generation', 'reconciliation'
      ));

    ALTER TABLE artifact
      ADD COLUMN retention_expires_at timestamptz,
      ADD COLUMN encryption_algorithm text,
      ADD COLUMN encryption_key_ref text;

    CREATE TABLE project_hypothesis (
      project_id uuid PRIMARY KEY REFERENCES project(project_id) ON DELETE CASCADE,
      resource_id uuid NOT NULL UNIQUE
        REFERENCES versioned_resource(resource_id) ON DELETE RESTRICT,
      current_resource_version_id uuid NOT NULL UNIQUE
        REFERENCES resource_version(resource_version_id) ON DELETE RESTRICT,
      draft_version bigint NOT NULL DEFAULT 1 CHECK (draft_version > 0),
      input_revision text NOT NULL CHECK (char_length(input_revision) BETWEEN 16 AND 100),
      provisional_rating text
        CHECK (provisional_rating IN ('BUY', 'HOLD', 'SELL')),
      thesis text NOT NULL DEFAULT '' CHECK (char_length(thesis) <= 500),
      current_question_set_id uuid,
      updated_by_user_id uuid NOT NULL REFERENCES user_account(user_id) ON DELETE RESTRICT,
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE project_hypothesis_version (
      resource_version_id uuid PRIMARY KEY
        REFERENCES resource_version(resource_version_id) ON DELETE CASCADE,
      project_id uuid NOT NULL REFERENCES project(project_id) ON DELETE CASCADE,
      draft_version bigint NOT NULL CHECK (draft_version > 0),
      input_revision text NOT NULL,
      provisional_rating text
        CHECK (provisional_rating IN ('BUY', 'HOLD', 'SELL')),
      thesis text NOT NULL CHECK (char_length(thesis) <= 500),
      setup_completion_id uuid
        REFERENCES stage_completion(stage_completion_id) ON DELETE RESTRICT,
      files_completion_id uuid NOT NULL
        REFERENCES stage_completion(stage_completion_id) ON DELETE RESTRICT,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (project_id, draft_version)
    );

    CREATE TABLE hypothesis_generation (
      generation_id uuid PRIMARY KEY,
      project_id uuid NOT NULL REFERENCES project(project_id) ON DELETE CASCADE,
      job_id uuid NOT NULL UNIQUE REFERENCES workflow_job(job_id) ON DELETE CASCADE,
      input_resource_version_id uuid NOT NULL
        REFERENCES project_hypothesis_version(resource_version_id) ON DELETE RESTRICT,
      input_revision text NOT NULL,
      draft_version bigint NOT NULL CHECK (draft_version > 0),
      agent_profile_version text NOT NULL,
      prompt_version text NOT NULL,
      output_schema_version text NOT NULL,
      configured_model text NOT NULL,
      provider_model text,
      input_tokens integer CHECK (input_tokens >= 0),
      output_tokens integer CHECK (output_tokens >= 0),
      latency_ms integer CHECK (latency_ms >= 0),
      raw_artifact_id uuid REFERENCES artifact(artifact_id) ON DELETE SET NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      finished_at timestamptz
    );

    CREATE INDEX hypothesis_generation_project_created_idx
      ON hypothesis_generation (project_id, created_at DESC);
    CREATE INDEX hypothesis_generation_rate_limit_idx
      ON hypothesis_generation (created_at DESC);

    CREATE TABLE hypothesis_question_set (
      question_set_id uuid PRIMARY KEY,
      project_id uuid NOT NULL REFERENCES project(project_id) ON DELETE CASCADE,
      resource_id uuid NOT NULL UNIQUE
        REFERENCES versioned_resource(resource_id) ON DELETE RESTRICT,
      current_version bigint NOT NULL CHECK (current_version > 0),
      source_generation_id uuid
        REFERENCES hypothesis_generation(generation_id) ON DELETE SET NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    ALTER TABLE project_hypothesis
      ADD CONSTRAINT project_hypothesis_question_set_fk
      FOREIGN KEY (current_question_set_id)
      REFERENCES hypothesis_question_set(question_set_id)
      ON DELETE SET NULL;

    CREATE TABLE hypothesis_question_set_version (
      resource_version_id uuid PRIMARY KEY
        REFERENCES resource_version(resource_version_id) ON DELETE CASCADE,
      question_set_id uuid NOT NULL
        REFERENCES hypothesis_question_set(question_set_id) ON DELETE CASCADE,
      version_no bigint NOT NULL CHECK (version_no > 0),
      generated_from_input_revision text NOT NULL,
      status text NOT NULL
        CHECK (status IN ('draft', 'stale', 'approved', 'obsolete')),
      prompt_version text,
      missing_context jsonb NOT NULL DEFAULT '[]'::jsonb,
      created_by_user_id uuid REFERENCES user_account(user_id) ON DELETE RESTRICT,
      created_by_actor_type text NOT NULL
        CHECK (created_by_actor_type IN ('user', 'worker', 'system')),
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (question_set_id, version_no)
    );

    CREATE TABLE hypothesis_question (
      question_set_id uuid NOT NULL
        REFERENCES hypothesis_question_set(question_set_id) ON DELETE CASCADE,
      set_version bigint NOT NULL,
      question_id uuid NOT NULL,
      display_order smallint NOT NULL CHECK (display_order BETWEEN 1 AND 5),
      question_text text NOT NULL CHECK (char_length(question_text) BETWEEN 1 AND 300),
      purpose text NOT NULL CHECK (char_length(purpose) BETWEEN 1 AND 500),
      metrics jsonb NOT NULL,
      period text NOT NULL CHECK (char_length(period) BETWEEN 1 AND 200),
      comparison text NOT NULL CHECK (char_length(comparison) BETWEEN 1 AND 300),
      suggested_source_types jsonb NOT NULL,
      origin text NOT NULL CHECK (origin IN ('agent', 'user')),
      PRIMARY KEY (question_set_id, set_version, question_id),
      UNIQUE (question_set_id, set_version, display_order),
      FOREIGN KEY (question_set_id, set_version)
        REFERENCES hypothesis_question_set_version(question_set_id, version_no)
        ON DELETE CASCADE
    );

    CREATE TABLE hypothesis_approval (
      approval_id uuid PRIMARY KEY,
      project_id uuid NOT NULL REFERENCES project(project_id) ON DELETE CASCADE,
      question_set_id uuid NOT NULL
        REFERENCES hypothesis_question_set(question_set_id) ON DELETE RESTRICT,
      question_set_version bigint NOT NULL,
      question_set_resource_version_id uuid NOT NULL
        REFERENCES hypothesis_question_set_version(resource_version_id) ON DELETE RESTRICT,
      input_revision text NOT NULL,
      approved_by_user_id uuid NOT NULL REFERENCES user_account(user_id) ON DELETE RESTRICT,
      approved_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (question_set_id, question_set_version, input_revision)
    );

    CREATE TABLE hypothesis_audit_event (
      audit_event_id uuid PRIMARY KEY,
      project_id uuid NOT NULL REFERENCES project(project_id) ON DELETE CASCADE,
      actor_user_id uuid REFERENCES user_account(user_id) ON DELETE SET NULL,
      event_type text NOT NULL,
      input_revision text,
      question_set_id uuid REFERENCES hypothesis_question_set(question_set_id) ON DELETE SET NULL,
      question_set_version bigint,
      request_id text,
      metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE INDEX hypothesis_audit_project_created_idx
      ON hypothesis_audit_event (project_id, created_at DESC);
  `);
}

export function down(pgm: MigrationBuilder): void {
  pgm.sql(`
    DROP TABLE IF EXISTS hypothesis_audit_event;
    DROP TABLE IF EXISTS hypothesis_approval;
    DROP TABLE IF EXISTS hypothesis_question;
    DROP TABLE IF EXISTS hypothesis_question_set_version;
    ALTER TABLE project_hypothesis
      DROP CONSTRAINT IF EXISTS project_hypothesis_question_set_fk;
    DROP TABLE IF EXISTS hypothesis_question_set;
    DROP TABLE IF EXISTS hypothesis_generation;
    DROP TABLE IF EXISTS project_hypothesis_version;
    DROP TABLE IF EXISTS project_hypothesis;

    ALTER TABLE artifact
      DROP COLUMN IF EXISTS encryption_key_ref,
      DROP COLUMN IF EXISTS encryption_algorithm,
      DROP COLUMN IF EXISTS retention_expires_at;

    ALTER TABLE workflow_job
      DROP CONSTRAINT workflow_job_job_type_check;
    ALTER TABLE workflow_job
      ADD CONSTRAINT workflow_job_job_type_check
      CHECK (job_type IN ('file_ingest', 'file_inspection', 'reconciliation'));
  `);
}
