import type { MigrationBuilder } from "node-pg-migrate";

export function up(pgm: MigrationBuilder): void {
  pgm.sql(`
    ALTER TABLE company_master
      DROP CONSTRAINT IF EXISTS company_master_exchange_code_check;
    ALTER TABLE company_master
      ADD CONSTRAINT company_master_exchange_code_check
      CHECK (exchange_code IN ('KOSPI', 'KOSDAQ', 'KONEX', 'KRX'));

    CREATE TABLE company_directory_sync (
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

export function down(pgm: MigrationBuilder): void {
  pgm.sql(`
    DROP TABLE IF EXISTS company_directory_sync;

    ALTER TABLE company_master
      DROP CONSTRAINT IF EXISTS company_master_exchange_code_check;
    ALTER TABLE company_master
      ADD CONSTRAINT company_master_exchange_code_check
      CHECK (exchange_code IN ('KOSPI', 'KOSDAQ', 'KONEX', 'KRX'));
  `);
}
