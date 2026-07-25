import type { MigrationBuilder } from "node-pg-migrate";

export function up(pgm: MigrationBuilder): void {
  pgm.sql(`
    ALTER TABLE file_inspection
      DROP CONSTRAINT file_inspection_outcome_check;
    ALTER TABLE file_inspection
      ADD CONSTRAINT file_inspection_outcome_check
      CHECK (outcome IN ('passed', 'blocked', 'failed'));

    ALTER TABLE template_ir_version
      ADD COLUMN template_ir_json jsonb NOT NULL DEFAULT '{}'::jsonb,
      ADD COLUMN block_count integer NOT NULL DEFAULT 0 CHECK (block_count >= 0),
      ADD COLUMN slot_count integer NOT NULL DEFAULT 0 CHECK (slot_count >= 0),
      ADD COLUMN object_count integer NOT NULL DEFAULT 0 CHECK (object_count >= 0),
      ADD COLUMN font_count integer NOT NULL DEFAULT 0 CHECK (font_count >= 0),
      ADD COLUMN image_count integer NOT NULL DEFAULT 0 CHECK (image_count >= 0),
      ADD COLUMN table_count integer NOT NULL DEFAULT 0 CHECK (table_count >= 0),
      ADD COLUMN chart_count integer NOT NULL DEFAULT 0 CHECK (chart_count >= 0),
      ADD COLUMN warning_count integer NOT NULL DEFAULT 0 CHECK (warning_count >= 0);

    ALTER TABLE workbook_version
      ADD COLUMN analysis_json jsonb NOT NULL DEFAULT '{}'::jsonb,
      ADD COLUMN sheet_count integer NOT NULL DEFAULT 0 CHECK (sheet_count >= 0),
      ADD COLUMN hidden_sheet_count integer NOT NULL DEFAULT 0 CHECK (hidden_sheet_count >= 0),
      ADD COLUMN used_cell_count bigint NOT NULL DEFAULT 0 CHECK (used_cell_count >= 0),
      ADD COLUMN formula_count integer NOT NULL DEFAULT 0 CHECK (formula_count >= 0),
      ADD COLUMN editable_cell_count integer NOT NULL DEFAULT 0 CHECK (editable_cell_count >= 0),
      ADD COLUMN merged_range_count integer NOT NULL DEFAULT 0 CHECK (merged_range_count >= 0),
      ADD COLUMN chart_count integer NOT NULL DEFAULT 0 CHECK (chart_count >= 0),
      ADD COLUMN table_count integer NOT NULL DEFAULT 0 CHECK (table_count >= 0),
      ADD COLUMN external_link_count integer NOT NULL DEFAULT 0 CHECK (external_link_count >= 0),
      ADD COLUMN named_range_count integer NOT NULL DEFAULT 0 CHECK (named_range_count >= 0);

    ALTER TABLE mapping_set_version
      ADD COLUMN mapping_json jsonb NOT NULL DEFAULT '{}'::jsonb,
      ADD COLUMN binding_count integer NOT NULL DEFAULT 0 CHECK (binding_count >= 0),
      ADD COLUMN required_slot_count integer NOT NULL DEFAULT 0 CHECK (required_slot_count >= 0),
      ADD COLUMN confirmed_binding_count integer NOT NULL DEFAULT 0 CHECK (confirmed_binding_count >= 0),
      ADD COLUMN unmapped_required_count integer NOT NULL DEFAULT 0 CHECK (unmapped_required_count >= 0),
      ADD COLUMN base_mapping_set_version_id uuid
        REFERENCES mapping_set_version(resource_version_id) ON DELETE RESTRICT,
      ADD COLUMN confirmed_by_user_id uuid
        REFERENCES user_account(user_id) ON DELETE RESTRICT,
      ADD COLUMN confirmed_at timestamptz;

    CREATE TABLE mapping_entry (
      mapping_entry_id uuid PRIMARY KEY,
      mapping_set_version_id uuid NOT NULL
        REFERENCES mapping_set_version(resource_version_id) ON DELETE CASCADE,
      slot_id text NOT NULL,
      semantic_metric text NOT NULL,
      binding_kind text NOT NULL CHECK (binding_kind IN ('scalar', 'table', 'chart')),
      value_type text NOT NULL,
      required boolean NOT NULL,
      mapping_status text NOT NULL
        CHECK (mapping_status IN ('suggested', 'confirmed', 'unmapped', 'invalid')),
      selected_candidate_id uuid,
      confidence numeric(5,4) CHECK (confidence BETWEEN 0 AND 1),
      source_json jsonb,
      display_json jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (mapping_set_version_id, slot_id)
    );

    CREATE TABLE mapping_candidate (
      mapping_candidate_id uuid PRIMARY KEY,
      mapping_entry_id uuid NOT NULL REFERENCES mapping_entry(mapping_entry_id) ON DELETE CASCADE,
      source_type text NOT NULL CHECK (source_type IN ('cell', 'range', 'chart')),
      sheet_id text NOT NULL,
      sheet_name text NOT NULL,
      address text NOT NULL,
      label text,
      score numeric(5,4) NOT NULL CHECK (score BETWEEN 0 AND 1),
      reason_codes text[] NOT NULL DEFAULT '{}',
      source_json jsonb NOT NULL,
      candidate_order integer NOT NULL CHECK (candidate_order > 0),
      UNIQUE (mapping_entry_id, candidate_order)
    );

    ALTER TABLE mapping_entry
      ADD CONSTRAINT mapping_entry_selected_candidate_fk
      FOREIGN KEY (selected_candidate_id)
      REFERENCES mapping_candidate(mapping_candidate_id)
      ON DELETE SET NULL
      DEFERRABLE INITIALLY DEFERRED;

    CREATE INDEX mapping_entry_set_status_idx
      ON mapping_entry (mapping_set_version_id, mapping_status);
    CREATE INDEX mapping_candidate_entry_score_idx
      ON mapping_candidate (mapping_entry_id, score DESC);
  `);
}

export function down(pgm: MigrationBuilder): void {
  pgm.sql(`
    ALTER TABLE IF EXISTS mapping_entry
      DROP CONSTRAINT IF EXISTS mapping_entry_selected_candidate_fk;
    DROP TABLE IF EXISTS mapping_candidate;
    DROP TABLE IF EXISTS mapping_entry;

    ALTER TABLE mapping_set_version
      DROP COLUMN IF EXISTS confirmed_at,
      DROP COLUMN IF EXISTS confirmed_by_user_id,
      DROP COLUMN IF EXISTS base_mapping_set_version_id,
      DROP COLUMN IF EXISTS unmapped_required_count,
      DROP COLUMN IF EXISTS confirmed_binding_count,
      DROP COLUMN IF EXISTS required_slot_count,
      DROP COLUMN IF EXISTS binding_count,
      DROP COLUMN IF EXISTS mapping_json;

    ALTER TABLE workbook_version
      DROP COLUMN IF EXISTS named_range_count,
      DROP COLUMN IF EXISTS external_link_count,
      DROP COLUMN IF EXISTS table_count,
      DROP COLUMN IF EXISTS chart_count,
      DROP COLUMN IF EXISTS merged_range_count,
      DROP COLUMN IF EXISTS editable_cell_count,
      DROP COLUMN IF EXISTS formula_count,
      DROP COLUMN IF EXISTS used_cell_count,
      DROP COLUMN IF EXISTS hidden_sheet_count,
      DROP COLUMN IF EXISTS sheet_count,
      DROP COLUMN IF EXISTS analysis_json;

    ALTER TABLE template_ir_version
      DROP COLUMN IF EXISTS warning_count,
      DROP COLUMN IF EXISTS chart_count,
      DROP COLUMN IF EXISTS table_count,
      DROP COLUMN IF EXISTS image_count,
      DROP COLUMN IF EXISTS font_count,
      DROP COLUMN IF EXISTS object_count,
      DROP COLUMN IF EXISTS slot_count,
      DROP COLUMN IF EXISTS block_count,
      DROP COLUMN IF EXISTS template_ir_json;

    UPDATE file_inspection SET outcome = 'failed' WHERE outcome = 'blocked';
    ALTER TABLE file_inspection
      DROP CONSTRAINT file_inspection_outcome_check;
    ALTER TABLE file_inspection
      ADD CONSTRAINT file_inspection_outcome_check
      CHECK (outcome IN ('passed', 'failed'));
  `);
}
