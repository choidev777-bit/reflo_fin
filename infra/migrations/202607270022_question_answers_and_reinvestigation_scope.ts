import type { MigrationBuilder } from "node-pg-migrate";

export function up(pgm: MigrationBuilder): void {
  pgm.sql(`
    ALTER TABLE research_run
      ADD COLUMN scope_json jsonb NOT NULL
        DEFAULT '{"kind":"full"}'::jsonb;

    CREATE TABLE validation_question_answer (
      answer_id uuid PRIMARY KEY,
      project_id uuid NOT NULL
        REFERENCES project(project_id) ON DELETE CASCADE,
      validation_run_id uuid NOT NULL
        REFERENCES validation_run(validation_run_id) ON DELETE CASCADE,
      question_id uuid NOT NULL,
      verdict text NOT NULL
        CHECK (verdict IN ('positive', 'neutral', 'negative', 'indeterminate')),
      one_line_answer text NOT NULL,
      evidence_ids uuid[] NOT NULL,
      caveat text,
      policy_version text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (validation_run_id, question_id)
    );

    CREATE INDEX validation_question_answer_project_idx
      ON validation_question_answer (project_id, validation_run_id, question_id);
  `);
}

export function down(pgm: MigrationBuilder): void {
  pgm.sql(`
    DROP TABLE IF EXISTS validation_question_answer;
    ALTER TABLE research_run DROP COLUMN IF EXISTS scope_json;
  `);
}
