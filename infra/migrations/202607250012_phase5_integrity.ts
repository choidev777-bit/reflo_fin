import type { MigrationBuilder } from "node-pg-migrate";

export function up(pgm: MigrationBuilder): void {
  pgm.sql(`
    ALTER TABLE valuation_workbook
      ADD COLUMN mapping_set_resource_version_id uuid
        REFERENCES mapping_set_version(resource_version_id) ON DELETE RESTRICT,
      ADD COLUMN input_fingerprint char(64);

    UPDATE valuation_workbook vw
    SET mapping_set_resource_version_id = (
          SELECT msv.resource_version_id
          FROM mapping_set_version msv
          JOIN resource_version rv
            ON rv.resource_version_id = msv.resource_version_id
          WHERE msv.workbook_version_id = vw.source_workbook_resource_version_id
            AND msv.mapping_status = 'confirmed'
          ORDER BY rv.version_no DESC
          LIMIT 1
        ),
        input_fingerprint = repeat('0', 64);

    ALTER TABLE valuation_workbook
      ALTER COLUMN mapping_set_resource_version_id SET NOT NULL,
      ALTER COLUMN input_fingerprint SET NOT NULL;

    ALTER TABLE valuation_calculation_run
      ADD COLUMN output_artifact_id uuid
        REFERENCES artifact(artifact_id) ON DELETE RESTRICT;

    UPDATE valuation_calculation_run run
    SET output_artifact_id = vw.current_artifact_id
    FROM valuation_workbook vw
    WHERE vw.project_id = run.project_id
      AND vw.workbook_version = run.output_workbook_version;

    ALTER TABLE valuation_approval
      ADD COLUMN source_workbook_resource_version_id uuid
        REFERENCES workbook_version(resource_version_id) ON DELETE RESTRICT,
      ADD COLUMN mapping_set_resource_version_id uuid
        REFERENCES mapping_set_version(resource_version_id) ON DELETE RESTRICT,
      ADD COLUMN workbook_artifact_id uuid
        REFERENCES artifact(artifact_id) ON DELETE RESTRICT,
      ADD COLUMN structure_hash char(64),
      ADD COLUMN input_fingerprint char(64);

    UPDATE valuation_approval approval
    SET source_workbook_resource_version_id =
          vw.source_workbook_resource_version_id,
        mapping_set_resource_version_id =
          vw.mapping_set_resource_version_id,
        workbook_artifact_id = vw.current_artifact_id,
        structure_hash = vw.structure_hash,
        input_fingerprint = vw.input_fingerprint
    FROM valuation_workbook vw
    WHERE vw.project_id = approval.project_id;

    ALTER TABLE valuation_approval
      ALTER COLUMN source_workbook_resource_version_id SET NOT NULL,
      ALTER COLUMN mapping_set_resource_version_id SET NOT NULL,
      ALTER COLUMN workbook_artifact_id SET NOT NULL,
      ALTER COLUMN structure_hash SET NOT NULL,
      ALTER COLUMN input_fingerprint SET NOT NULL;

    CREATE INDEX valuation_calculation_run_project_output_idx
      ON valuation_calculation_run
        (project_id, output_workbook_version, created_at DESC);

    CREATE INDEX valuation_workbook_source_fingerprint_idx
      ON valuation_workbook
        (project_id, source_workbook_resource_version_id,
         mapping_set_resource_version_id, structure_hash);

    CREATE UNIQUE INDEX valuation_approval_exact_input_idx
      ON valuation_approval (
        project_id, workbook_version, draft_version, calculation_run_id,
        current_price_snapshot_resource_version_id
      );
  `);
}

export function down(pgm: MigrationBuilder): void {
  pgm.sql(`
    DROP INDEX IF EXISTS valuation_approval_exact_input_idx;
    DROP INDEX IF EXISTS valuation_workbook_source_fingerprint_idx;
    DROP INDEX IF EXISTS valuation_calculation_run_project_output_idx;

    ALTER TABLE valuation_approval
      DROP COLUMN IF EXISTS input_fingerprint,
      DROP COLUMN IF EXISTS structure_hash,
      DROP COLUMN IF EXISTS workbook_artifact_id,
      DROP COLUMN IF EXISTS mapping_set_resource_version_id,
      DROP COLUMN IF EXISTS source_workbook_resource_version_id;

    ALTER TABLE valuation_calculation_run
      DROP COLUMN IF EXISTS output_artifact_id;

    ALTER TABLE valuation_workbook
      DROP COLUMN IF EXISTS input_fingerprint,
      DROP COLUMN IF EXISTS mapping_set_resource_version_id;
  `);
}
