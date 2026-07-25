import type { MigrationBuilder } from "node-pg-migrate";

export function up(pgm: MigrationBuilder): void {
  pgm.sql(`
    ALTER TABLE research_source_version
      ADD COLUMN modified_at timestamptz,
      ADD COLUMN available_at timestamptz,
      ADD COLUMN date_precision text
        CHECK (date_precision IN ('second', 'minute', 'day')),
      ADD COLUMN artifact_object_key text,
      ADD COLUMN parser_version text,
      ADD COLUMN eligibility_policy_version text;

    CREATE TABLE research_news_search (
      search_id uuid PRIMARY KEY,
      research_run_id uuid NOT NULL
        REFERENCES research_run(research_run_id) ON DELETE CASCADE,
      question_id uuid NOT NULL,
      query_id text NOT NULL,
      query_text text NOT NULL,
      publication_window_json jsonb NOT NULL,
      provider_code text NOT NULL,
      provider_policy_version text NOT NULL,
      status text NOT NULL
        CHECK (status IN ('completed', 'failed')),
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (research_run_id, question_id, query_id)
    );

    CREATE INDEX research_news_search_run_question_idx
      ON research_news_search (research_run_id, question_id, created_at);

    CREATE TABLE research_news_search_result (
      search_result_id uuid PRIMARY KEY,
      search_id uuid NOT NULL
        REFERENCES research_news_search(search_id) ON DELETE CASCADE,
      provider_result_id text,
      result_rank integer NOT NULL CHECK (result_rank > 0),
      discovered_url text NOT NULL,
      title_hint text,
      publisher_hint text,
      published_at_hint timestamptz,
      selection_status text NOT NULL
        CHECK (selection_status IN ('discovered', 'captured', 'rejected')),
      rejection_code text,
      source_version_id uuid
        REFERENCES research_source_version(resource_version_id) ON DELETE SET NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (search_id, discovered_url)
    );

    CREATE INDEX research_news_search_result_source_idx
      ON research_news_search_result (source_version_id)
      WHERE source_version_id IS NOT NULL;
  `);
}

export function down(pgm: MigrationBuilder): void {
  pgm.sql(`
    DROP TABLE IF EXISTS research_news_search_result;
    DROP TABLE IF EXISTS research_news_search;

    ALTER TABLE research_source_version
      DROP COLUMN IF EXISTS eligibility_policy_version,
      DROP COLUMN IF EXISTS parser_version,
      DROP COLUMN IF EXISTS artifact_object_key,
      DROP COLUMN IF EXISTS date_precision,
      DROP COLUMN IF EXISTS available_at,
      DROP COLUMN IF EXISTS modified_at;
  `);
}
