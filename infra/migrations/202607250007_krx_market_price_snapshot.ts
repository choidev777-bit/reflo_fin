import type { MigrationBuilder } from "node-pg-migrate";

export function up(pgm: MigrationBuilder): void {
  pgm.sql(`
    ALTER TABLE mapping_candidate
      DROP CONSTRAINT mapping_candidate_source_type_check;
    ALTER TABLE mapping_candidate
      ADD CONSTRAINT mapping_candidate_source_type_check
      CHECK (source_type IN ('cell', 'range', 'chart', 'market_data'));

    CREATE TABLE market_price_snapshot_version (
      resource_version_id uuid PRIMARY KEY
        REFERENCES resource_version(resource_version_id) ON DELETE CASCADE,
      company_master_id uuid NOT NULL
        REFERENCES company_master(company_master_id) ON DELETE RESTRICT,
      ticker text NOT NULL,
      exchange_code text NOT NULL,
      requested_date date NOT NULL,
      trading_date date,
      close_price numeric(24,6),
      currency_code char(3) NOT NULL DEFAULT 'KRW',
      provider text NOT NULL CHECK (provider = 'KRX_OPEN_API'),
      source_api_id text,
      lookup_status text NOT NULL
        CHECK (lookup_status IN ('available', 'unavailable')),
      retrieved_at timestamptz NOT NULL,
      source_payload_hash char(64),
      error_code text,
      evidence_json jsonb NOT NULL,
      CHECK (
        (lookup_status = 'available'
          AND trading_date IS NOT NULL
          AND close_price > 0
          AND source_payload_hash IS NOT NULL)
        OR
        (lookup_status = 'unavailable'
          AND trading_date IS NULL
          AND close_price IS NULL)
      )
    );

    CREATE INDEX market_price_snapshot_company_date_idx
      ON market_price_snapshot_version
      (company_master_id, requested_date DESC, trading_date DESC);

    ALTER TABLE file_inspection
      ADD COLUMN market_price_snapshot_resource_version_id uuid
        REFERENCES market_price_snapshot_version(resource_version_id)
        ON DELETE RESTRICT;
  `);
}

export function down(pgm: MigrationBuilder): void {
  pgm.sql(`
    ALTER TABLE file_inspection
      DROP COLUMN IF EXISTS market_price_snapshot_resource_version_id;
    DROP TABLE IF EXISTS market_price_snapshot_version;

    ALTER TABLE mapping_candidate
      DROP CONSTRAINT mapping_candidate_source_type_check;
    ALTER TABLE mapping_candidate
      ADD CONSTRAINT mapping_candidate_source_type_check
      CHECK (source_type IN ('cell', 'range', 'chart'));
  `);
}
