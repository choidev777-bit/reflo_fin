import type { MigrationBuilder } from "node-pg-migrate";

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    ALTER TABLE research_source_reference
      ADD COLUMN ingestion_method text,
      ADD COLUMN title text,
      ADD COLUMN publisher text,
      ADD COLUMN published_at timestamptz;

    ALTER TABLE research_source_reference
      ADD CONSTRAINT research_source_reference_ingestion_method_check
      CHECK (ingestion_method IN ('user_upload', 'user_url'));

    UPDATE company_master
       SET corp_code = CASE ticker
         WHEN '095340' THEN '00572905'
         WHEN '005930' THEN '00126380'
         ELSE corp_code
       END
     WHERE ticker IN ('095340', '005930')
       AND corp_code IS NULL;
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    ALTER TABLE research_source_reference
      DROP CONSTRAINT IF EXISTS research_source_reference_ingestion_method_check,
      DROP COLUMN IF EXISTS published_at,
      DROP COLUMN IF EXISTS publisher,
      DROP COLUMN IF EXISTS title,
      DROP COLUMN IF EXISTS ingestion_method;
  `);
}
