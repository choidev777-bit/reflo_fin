import type { MigrationBuilder } from "node-pg-migrate";

export function up(pgm: MigrationBuilder): void {
  pgm.sql(`
    DELETE FROM company_master company
    WHERE NOT EXISTS (
      SELECT 1
      FROM project_setup_version setup
      WHERE setup.company_master_id = company.company_master_id
    );

    DROP TABLE IF EXISTS company_directory_sync;
  `);
}

export function down(pgm: MigrationBuilder): void {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS company_directory_sync (
      source text PRIMARY KEY CHECK (source IN ('opendart')),
      sync_status text NOT NULL
        CHECK (sync_status IN ('running', 'succeeded', 'failed')),
      company_count integer NOT NULL DEFAULT 0 CHECK (company_count >= 0),
      last_started_at timestamptz NOT NULL,
      last_completed_at timestamptz,
      last_error text,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
  `);
}
