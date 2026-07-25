import type { MigrationBuilder } from "node-pg-migrate";

export function up(pgm: MigrationBuilder): void {
  pgm.sql(`
    CREATE TABLE valuation_workbook (
      project_id uuid PRIMARY KEY REFERENCES project(project_id) ON DELETE CASCADE,
      source_workbook_resource_version_id uuid NOT NULL
        REFERENCES workbook_version(resource_version_id) ON DELETE RESTRICT,
      source_artifact_id uuid NOT NULL REFERENCES artifact(artifact_id) ON DELETE RESTRICT,
      current_artifact_id uuid NOT NULL REFERENCES artifact(artifact_id) ON DELETE RESTRICT,
      workbook_version bigint NOT NULL DEFAULT 1 CHECK (workbook_version > 0),
      editable_cell_set_version bigint NOT NULL DEFAULT 1
        CHECK (editable_cell_set_version > 0),
      structure_hash char(64) NOT NULL,
      read_model_json jsonb NOT NULL,
      calculation_status text NOT NULL
        CHECK (calculation_status IN ('success', 'error', 'revalidation_required')),
      saved_at timestamptz NOT NULL DEFAULT now(),
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE valuation_calculation_run (
      calculation_run_id uuid PRIMARY KEY,
      project_id uuid NOT NULL REFERENCES project(project_id) ON DELETE CASCADE,
      input_workbook_version bigint NOT NULL CHECK (input_workbook_version > 0),
      output_workbook_version bigint NOT NULL CHECK (output_workbook_version > 0),
      status text NOT NULL CHECK (status IN ('success', 'failed')),
      engine_name text NOT NULL CHECK (engine_name = 'ClosedXML'),
      engine_version text NOT NULL CHECK (engine_version = '0.105.0'),
      outputs_json jsonb NOT NULL,
      errors_json jsonb NOT NULL DEFAULT '[]'::jsonb,
      result_hash char(64),
      duration_ms integer NOT NULL CHECK (duration_ms >= 0),
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE valuation_cell_change (
      cell_change_id uuid PRIMARY KEY,
      project_id uuid NOT NULL REFERENCES project(project_id) ON DELETE CASCADE,
      calculation_run_id uuid NOT NULL
        REFERENCES valuation_calculation_run(calculation_run_id) ON DELETE RESTRICT,
      request_id uuid NOT NULL,
      sheet_id text NOT NULL,
      address text NOT NULL,
      value_type text NOT NULL CHECK (value_type IN ('number', 'string', 'boolean', 'blank')),
      before_value text,
      after_value text,
      workbook_version_before bigint NOT NULL CHECK (workbook_version_before > 0),
      workbook_version_after bigint NOT NULL CHECK (workbook_version_after > 0),
      changed_by_user_id uuid NOT NULL REFERENCES user_account(user_id) ON DELETE RESTRICT,
      changed_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (project_id, request_id, sheet_id, address)
    );

    CREATE TABLE valuation_draft (
      project_id uuid PRIMARY KEY REFERENCES project(project_id) ON DELETE CASCADE,
      draft_version bigint NOT NULL DEFAULT 1 CHECK (draft_version > 0),
      workbook_version bigint NOT NULL CHECK (workbook_version > 0),
      input_mode text NOT NULL CHECK (input_mode IN ('target_per', 'target_price')),
      target_per text NOT NULL,
      requested_target_price text,
      forward_eps text NOT NULL,
      target_price text NOT NULL,
      current_price text NOT NULL,
      current_price_snapshot_resource_version_id uuid NOT NULL
        REFERENCES market_price_snapshot_version(resource_version_id) ON DELETE RESTRICT,
      upside text NOT NULL,
      status text NOT NULL CHECK (status IN ('draft', 'approved', 'revalidation_required')),
      updated_by_user_id uuid NOT NULL REFERENCES user_account(user_id) ON DELETE RESTRICT,
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE valuation_approval (
      resource_version_id uuid PRIMARY KEY
        REFERENCES resource_version(resource_version_id) ON DELETE CASCADE,
      approval_id uuid NOT NULL UNIQUE,
      project_id uuid NOT NULL REFERENCES project(project_id) ON DELETE CASCADE,
      approval_version bigint NOT NULL CHECK (approval_version > 0),
      workbook_version bigint NOT NULL CHECK (workbook_version > 0),
      draft_version bigint NOT NULL CHECK (draft_version > 0),
      calculation_run_id uuid NOT NULL
        REFERENCES valuation_calculation_run(calculation_run_id) ON DELETE RESTRICT,
      current_price_snapshot_resource_version_id uuid NOT NULL
        REFERENCES market_price_snapshot_version(resource_version_id) ON DELETE RESTRICT,
      forward_eps text NOT NULL,
      target_per text NOT NULL,
      target_price text NOT NULL,
      current_price text NOT NULL,
      upside text NOT NULL,
      status text NOT NULL CHECK (status IN ('approved', 'superseded', 'revalidation_required')),
      approved_by_user_id uuid NOT NULL REFERENCES user_account(user_id) ON DELETE RESTRICT,
      approved_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (project_id, approval_version)
    );

    CREATE INDEX valuation_cell_change_project_version_idx
      ON valuation_cell_change (project_id, workbook_version_after, changed_at);
    CREATE INDEX valuation_approval_project_status_idx
      ON valuation_approval (project_id, status, approval_version DESC);
  `);
}

export function down(pgm: MigrationBuilder): void {
  pgm.sql(`
    DROP TABLE IF EXISTS valuation_approval;
    DROP TABLE IF EXISTS valuation_draft;
    DROP TABLE IF EXISTS valuation_cell_change;
    DROP TABLE IF EXISTS valuation_calculation_run;
    DROP TABLE IF EXISTS valuation_workbook;
  `);
}
