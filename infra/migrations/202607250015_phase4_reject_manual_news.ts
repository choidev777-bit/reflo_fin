import type { MigrationBuilder } from "node-pg-migrate";

export function up(pgm: MigrationBuilder): void {
  pgm.sql(`
    CREATE FUNCTION reject_manual_news_source_reference()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      IF NEW.source_type = 'NEWS' THEN
        RAISE EXCEPTION 'NEWS_MANUAL_MATERIAL_UNSUPPORTED'
          USING ERRCODE = 'check_violation';
      END IF;
      RETURN NEW;
    END;
    $$;

    CREATE TRIGGER research_source_reference_reject_manual_news
      BEFORE INSERT OR UPDATE OF source_type
      ON research_source_reference
      FOR EACH ROW
      EXECUTE FUNCTION reject_manual_news_source_reference();
  `);
}

export function down(pgm: MigrationBuilder): void {
  pgm.sql(`
    DROP TRIGGER IF EXISTS research_source_reference_reject_manual_news
      ON research_source_reference;
    DROP FUNCTION IF EXISTS reject_manual_news_source_reference();
  `);
}
