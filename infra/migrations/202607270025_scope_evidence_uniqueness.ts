import type { MigrationBuilder } from "node-pg-migrate";

export function up(pgm: MigrationBuilder): void {
  pgm.sql(`
    ALTER TABLE evidence
      DROP CONSTRAINT IF EXISTS
        evidence_validation_run_id_source_version_id_quote_hash_key;

    CREATE UNIQUE INDEX evidence_validation_source_quote_subject_idx
      ON evidence (
        validation_run_id,
        source_version_id,
        quote_hash,
        (
          COALESCE(
            provenance_json->>'targetId',
            provenance_json->>'candidateKey',
            ''
          )
        )
      );
  `);
}

export function down(pgm: MigrationBuilder): void {
  pgm.sql(`
    DROP INDEX IF EXISTS evidence_validation_source_quote_subject_idx;

    ALTER TABLE evidence
      ADD CONSTRAINT
        evidence_validation_run_id_source_version_id_quote_hash_key
      UNIQUE (validation_run_id, source_version_id, quote_hash);
  `);
}
