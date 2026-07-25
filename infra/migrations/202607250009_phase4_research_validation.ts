import type { MigrationBuilder } from "node-pg-migrate";

export function up(pgm: MigrationBuilder): void {
  pgm.sql(`
    ALTER TABLE workflow_job
      DROP CONSTRAINT workflow_job_job_type_check;
    ALTER TABLE workflow_job
      ADD CONSTRAINT workflow_job_job_type_check
      CHECK (job_type IN (
        'file_ingest', 'file_inspection', 'hypothesis_generation',
        'research_collection', 'evidence_reinvestigation', 'reconciliation'
      ));

    CREATE TABLE research_plan (
      plan_id uuid PRIMARY KEY,
      project_id uuid NOT NULL UNIQUE REFERENCES project(project_id) ON DELETE CASCADE,
      resource_id uuid NOT NULL UNIQUE
        REFERENCES versioned_resource(resource_id) ON DELETE RESTRICT,
      current_resource_version_id uuid NOT NULL UNIQUE
        REFERENCES resource_version(resource_version_id) ON DELETE RESTRICT,
      current_version bigint NOT NULL CHECK (current_version > 0),
      status text NOT NULL
        CHECK (status IN ('draft', 'approved', 'revalidation_required')),
      updated_by_user_id uuid NOT NULL REFERENCES user_account(user_id) ON DELETE RESTRICT,
      last_saved_at timestamptz NOT NULL DEFAULT now(),
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE research_plan_version (
      resource_version_id uuid PRIMARY KEY
        REFERENCES resource_version(resource_version_id) ON DELETE CASCADE,
      plan_id uuid NOT NULL
        REFERENCES research_plan(plan_id) ON DELETE CASCADE
        DEFERRABLE INITIALLY DEFERRED,
      project_id uuid NOT NULL REFERENCES project(project_id) ON DELETE CASCADE,
      version_no bigint NOT NULL CHECK (version_no > 0),
      status text NOT NULL
        CHECK (status IN ('draft', 'approved', 'superseded', 'revalidation_required')),
      question_set_id uuid NOT NULL
        REFERENCES hypothesis_question_set(question_set_id) ON DELETE RESTRICT,
      question_set_version bigint NOT NULL CHECK (question_set_version > 0),
      question_set_resource_version_id uuid NOT NULL
        REFERENCES hypothesis_question_set_version(resource_version_id) ON DELETE RESTRICT,
      workbook_resource_version_id uuid NOT NULL
        REFERENCES workbook_version(resource_version_id) ON DELETE RESTRICT,
      workbook_structure_hash char(64) NOT NULL,
      mapping_set_resource_version_id uuid NOT NULL
        REFERENCES mapping_set_version(resource_version_id) ON DELETE RESTRICT,
      cutoff_at timestamptz NOT NULL,
      plan_snapshot_json jsonb NOT NULL,
      validation_summary_json jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_by_user_id uuid NOT NULL REFERENCES user_account(user_id) ON DELETE RESTRICT,
      approved_by_user_id uuid REFERENCES user_account(user_id) ON DELETE RESTRICT,
      approved_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (plan_id, version_no)
    );

    CREATE TABLE research_plan_question (
      plan_resource_version_id uuid NOT NULL
        REFERENCES research_plan_version(resource_version_id) ON DELETE CASCADE,
      question_id uuid NOT NULL,
      display_order smallint NOT NULL CHECK (display_order BETWEEN 1 AND 5),
      question_text text NOT NULL,
      purpose text NOT NULL,
      metrics jsonb NOT NULL,
      period text NOT NULL,
      comparison text NOT NULL,
      included boolean NOT NULL,
      source_binding_ids jsonb NOT NULL,
      collection_targets jsonb NOT NULL,
      collection_methods jsonb NOT NULL,
      PRIMARY KEY (plan_resource_version_id, question_id),
      UNIQUE (plan_resource_version_id, display_order)
    );

    CREATE TABLE research_plan_excel_target (
      plan_resource_version_id uuid NOT NULL
        REFERENCES research_plan_version(resource_version_id) ON DELETE CASCADE,
      target_id text NOT NULL,
      sheet_id text NOT NULL,
      sheet_name text NOT NULL,
      address text NOT NULL,
      metric text NOT NULL,
      period text NOT NULL,
      unit text NOT NULL,
      scope text NOT NULL,
      value_kind text NOT NULL
        CHECK (value_kind IN ('actual', 'preliminary_actual')),
      required boolean NOT NULL,
      included boolean NOT NULL,
      source_policy jsonb NOT NULL,
      mapping_slot_ids jsonb NOT NULL,
      PRIMARY KEY (plan_resource_version_id, target_id)
    );

    CREATE TABLE research_source_reference (
      source_reference_id uuid PRIMARY KEY,
      project_id uuid NOT NULL REFERENCES project(project_id) ON DELETE CASCADE,
      plan_id uuid NOT NULL REFERENCES research_plan(plan_id) ON DELETE CASCADE,
      source_type text NOT NULL
        CHECK (source_type IN (
          'DART', 'COMPANY_IR', 'NEWS', 'KRX', 'ECOS',
          'FNGUIDE_CONSENSUS', 'USER_MATERIAL'
        )),
      canonical_url text,
      artifact_id uuid REFERENCES artifact(artifact_id) ON DELETE RESTRICT,
      status text NOT NULL
        CHECK (status IN ('pending', 'accepted', 'rejected', 'superseded')),
      validation_error text,
      created_by_user_id uuid NOT NULL REFERENCES user_account(user_id) ON DELETE RESTRICT,
      created_at timestamptz NOT NULL DEFAULT now(),
      CHECK (
        (canonical_url IS NOT NULL AND artifact_id IS NULL)
        OR (canonical_url IS NULL AND artifact_id IS NOT NULL)
      )
    );

    CREATE UNIQUE INDEX research_source_reference_url_idx
      ON research_source_reference (plan_id, canonical_url)
      WHERE canonical_url IS NOT NULL AND status <> 'superseded';

    CREATE TABLE research_run (
      research_run_id uuid PRIMARY KEY,
      project_id uuid NOT NULL REFERENCES project(project_id) ON DELETE CASCADE,
      job_id uuid NOT NULL UNIQUE REFERENCES workflow_job(job_id) ON DELETE CASCADE,
      approved_plan_resource_version_id uuid NOT NULL
        REFERENCES research_plan_version(resource_version_id) ON DELETE RESTRICT,
      run_kind text NOT NULL DEFAULT 'initial'
        CHECK (run_kind IN ('initial', 'reinvestigation')),
      supersedes_run_id uuid REFERENCES research_run(research_run_id) ON DELETE RESTRICT,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE INDEX research_run_project_created_idx
      ON research_run (project_id, created_at DESC);

    CREATE TABLE research_source (
      source_id uuid PRIMARY KEY,
      project_id uuid NOT NULL REFERENCES project(project_id) ON DELETE CASCADE,
      source_type text NOT NULL,
      source_key text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (project_id, source_type, source_key)
    );

    CREATE TABLE research_source_version (
      resource_version_id uuid PRIMARY KEY
        REFERENCES resource_version(resource_version_id) ON DELETE CASCADE,
      source_id uuid NOT NULL REFERENCES research_source(source_id) ON DELETE CASCADE,
      research_run_id uuid NOT NULL REFERENCES research_run(research_run_id) ON DELETE CASCADE,
      source_type text NOT NULL,
      title text NOT NULL,
      publisher text NOT NULL,
      canonical_url text,
      published_at timestamptz,
      collected_at timestamptz NOT NULL,
      response_hash char(64) NOT NULL,
      locator_json jsonb NOT NULL,
      snapshot_json jsonb NOT NULL,
      artifact_id uuid REFERENCES artifact(artifact_id) ON DELETE RESTRICT,
      collector_version text NOT NULL,
      UNIQUE (source_id, response_hash)
    );

    CREATE TABLE validation_run (
      validation_run_id uuid PRIMARY KEY,
      project_id uuid NOT NULL REFERENCES project(project_id) ON DELETE CASCADE,
      research_run_id uuid NOT NULL REFERENCES research_run(research_run_id) ON DELETE CASCADE,
      rule_version text NOT NULL,
      agent_profile_version text NOT NULL,
      status text NOT NULL
        CHECK (status IN ('running', 'succeeded', 'failed', 'obsolete')),
      started_at timestamptz NOT NULL,
      finished_at timestamptz
    );

    CREATE TABLE evidence (
      evidence_id uuid PRIMARY KEY,
      project_id uuid NOT NULL REFERENCES project(project_id) ON DELETE CASCADE,
      validation_run_id uuid NOT NULL REFERENCES validation_run(validation_run_id) ON DELETE CASCADE,
      source_version_id uuid NOT NULL
        REFERENCES research_source_version(resource_version_id) ON DELETE RESTRICT,
      evidence_version bigint NOT NULL DEFAULT 1 CHECK (evidence_version > 0),
      quote_exact text NOT NULL,
      quote_normalized text NOT NULL,
      quote_hash char(64) NOT NULL,
      locator_json jsonb NOT NULL,
      value_original text,
      value_normalized text,
      unit text,
      currency text,
      period text,
      scope text,
      value_kind text,
      stance text NOT NULL
        CHECK (stance IN ('supporting', 'contradicting', 'neutral')),
      machine_status text NOT NULL
        CHECK (machine_status IN ('passed', 'failed', 'needs_review', 'stale')),
      checks_json jsonb NOT NULL,
      provenance_json jsonb NOT NULL,
      validated_at timestamptz NOT NULL,
      UNIQUE (validation_run_id, source_version_id, quote_hash)
    );

    CREATE TABLE validation_result (
      result_id uuid PRIMARY KEY,
      project_id uuid NOT NULL REFERENCES project(project_id) ON DELETE CASCADE,
      validation_run_id uuid NOT NULL REFERENCES validation_run(validation_run_id) ON DELETE CASCADE,
      result_version bigint NOT NULL DEFAULT 1 CHECK (result_version > 0),
      category text NOT NULL CHECK (category IN ('hypothesis', 'excel')),
      question_id uuid,
      target_id text,
      title text NOT NULL,
      one_line_value text NOT NULL,
      stance text NOT NULL
        CHECK (stance IN ('supporting', 'contradicting', 'neutral')),
      machine_status text NOT NULL
        CHECK (machine_status IN ('passed', 'failed', 'needs_review', 'stale')),
      exception_status text NOT NULL DEFAULT 'AVAILABLE'
        CHECK (exception_status IN (
          'AVAILABLE', 'REJECTED', 'REINVESTIGATION_REQUESTED',
          'REINVESTIGATING', 'CONFLICT_UNRESOLVED',
          'CONFLICT_RESOLVED', 'SUPERSEDED'
        )),
      value_original text,
      value_normalized text,
      unit text,
      currency text,
      period text,
      scope text,
      value_kind text,
      evidence_ids uuid[] NOT NULL,
      required boolean NOT NULL DEFAULT true,
      critical_numeric boolean NOT NULL DEFAULT false,
      validated_at timestamptz NOT NULL
    );

    CREATE INDEX validation_result_project_category_idx
      ON validation_result (project_id, category, validated_at DESC);
    CREATE INDEX validation_result_question_idx
      ON validation_result (project_id, question_id);

    CREATE TABLE validation_conflict (
      conflict_id uuid PRIMARY KEY,
      project_id uuid NOT NULL REFERENCES project(project_id) ON DELETE CASCADE,
      validation_run_id uuid NOT NULL REFERENCES validation_run(validation_run_id) ON DELETE CASCADE,
      result_id uuid NOT NULL REFERENCES validation_result(result_id) ON DELETE CASCADE,
      candidate_evidence_ids uuid[] NOT NULL CHECK (cardinality(candidate_evidence_ids) >= 2),
      status text NOT NULL CHECK (status IN ('unresolved', 'resolved', 'superseded')),
      selected_evidence_id uuid REFERENCES evidence(evidence_id) ON DELETE RESTRICT,
      resolved_at timestamptz
    );

    CREATE TABLE validation_workspace (
      project_id uuid PRIMARY KEY REFERENCES project(project_id) ON DELETE CASCADE,
      research_run_id uuid NOT NULL REFERENCES research_run(research_run_id) ON DELETE RESTRICT,
      validation_run_id uuid NOT NULL REFERENCES validation_run(validation_run_id) ON DELETE RESTRICT,
      validation_version bigint NOT NULL DEFAULT 1 CHECK (validation_version > 0),
      workspace_status text NOT NULL
        CHECK (workspace_status IN (
          'COLLECTING', 'VALIDATING', 'REVIEW_BLOCKED', 'REVIEW_READY',
          'APPROVING', 'APPROVED', 'REVALIDATION_REQUIRED', 'FAILED'
        )),
      approved_plan_resource_version_id uuid NOT NULL
        REFERENCES research_plan_version(resource_version_id) ON DELETE RESTRICT,
      cutoff_at timestamptz NOT NULL,
      stage_gate_json jsonb NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE validation_decision (
      decision_id uuid PRIMARY KEY,
      project_id uuid NOT NULL REFERENCES project(project_id) ON DELETE CASCADE,
      validation_version_before bigint NOT NULL CHECK (validation_version_before > 0),
      validation_version_after bigint NOT NULL CHECK (validation_version_after > 0),
      target_type text NOT NULL CHECK (target_type IN ('result', 'conflict', 'question')),
      target_id uuid NOT NULL,
      action text NOT NULL
        CHECK (action IN (
          'REJECT', 'RESTORE', 'REINVESTIGATE',
          'SELECT_SOURCE', 'ACCEPT_QUALIFIED'
        )),
      selected_evidence_id uuid REFERENCES evidence(evidence_id) ON DELETE RESTRICT,
      reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 5 AND 500),
      created_by_user_id uuid NOT NULL REFERENCES user_account(user_id) ON DELETE RESTRICT,
      supersedes_decision_id uuid REFERENCES validation_decision(decision_id) ON DELETE RESTRICT,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE INDEX validation_decision_project_target_idx
      ON validation_decision (project_id, target_type, target_id, created_at DESC);

    CREATE TABLE validation_decision_draft (
      draft_id uuid PRIMARY KEY,
      project_id uuid NOT NULL REFERENCES project(project_id) ON DELETE CASCADE,
      target_type text NOT NULL CHECK (target_type IN ('result', 'conflict', 'question')),
      target_id uuid NOT NULL,
      action text NOT NULL,
      reason text NOT NULL CHECK (char_length(reason) <= 500),
      updated_by_user_id uuid NOT NULL REFERENCES user_account(user_id) ON DELETE RESTRICT,
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (project_id, target_type, target_id, action)
    );

    CREATE TABLE validation_approval (
      approval_id uuid PRIMARY KEY,
      project_id uuid NOT NULL REFERENCES project(project_id) ON DELETE CASCADE,
      validation_run_id uuid NOT NULL REFERENCES validation_run(validation_run_id) ON DELETE RESTRICT,
      validation_version bigint NOT NULL CHECK (validation_version > 0),
      approved_plan_resource_version_id uuid NOT NULL
        REFERENCES research_plan_version(resource_version_id) ON DELETE RESTRICT,
      approved_by_user_id uuid NOT NULL REFERENCES user_account(user_id) ON DELETE RESTRICT,
      approved_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (project_id, validation_version)
    );
  `);
}

export function down(pgm: MigrationBuilder): void {
  pgm.sql(`
    DROP TABLE IF EXISTS validation_approval;
    DROP TABLE IF EXISTS validation_decision_draft;
    DROP TABLE IF EXISTS validation_decision;
    DROP TABLE IF EXISTS validation_workspace;
    DROP TABLE IF EXISTS validation_conflict;
    DROP TABLE IF EXISTS validation_result;
    DROP TABLE IF EXISTS evidence;
    DROP TABLE IF EXISTS validation_run;
    DROP TABLE IF EXISTS research_source_version;
    DROP TABLE IF EXISTS research_source;
    DROP TABLE IF EXISTS research_run;
    DROP TABLE IF EXISTS research_source_reference;
    DROP TABLE IF EXISTS research_plan_excel_target;
    DROP TABLE IF EXISTS research_plan_question;
    DROP TABLE IF EXISTS research_plan_version;
    DROP TABLE IF EXISTS research_plan;

    ALTER TABLE workflow_job
      DROP CONSTRAINT workflow_job_job_type_check;
    ALTER TABLE workflow_job
      ADD CONSTRAINT workflow_job_job_type_check
      CHECK (job_type IN (
        'file_ingest', 'file_inspection', 'hypothesis_generation', 'reconciliation'
      ));
  `);
}
