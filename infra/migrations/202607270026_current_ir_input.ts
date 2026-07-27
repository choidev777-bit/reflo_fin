import type { MigrationBuilder } from "node-pg-migrate";

export function up(pgm: MigrationBuilder): void {
  pgm.sql(`
    ALTER TABLE upload_session
      DROP CONSTRAINT upload_session_upload_role_check;
    ALTER TABLE upload_session
      ADD CONSTRAINT upload_session_upload_role_check
      CHECK (
        upload_role IN (
          'previous_report_pdf',
          'analysis_workbook',
          'current_ir_pdf'
        )
      );

    ALTER TABLE project_file_version
      DROP CONSTRAINT project_file_version_file_role_check;
    ALTER TABLE project_file_version
      ADD CONSTRAINT project_file_version_file_role_check
      CHECK (
        file_role IN (
          'previous_report_pdf',
          'analysis_workbook',
          'current_ir_pdf'
        )
      );

    ALTER TABLE file_inspection
      ADD COLUMN current_ir_file_version_id uuid
        REFERENCES project_file_version(resource_version_id) ON DELETE RESTRICT,
      ADD COLUMN current_ir_resource_version_id uuid
        REFERENCES resource_version(resource_version_id) ON DELETE RESTRICT;

    CREATE TABLE current_ir_version (
      resource_version_id uuid PRIMARY KEY
        REFERENCES resource_version(resource_version_id) ON DELETE CASCADE,
      source_file_version_id uuid NOT NULL
        REFERENCES project_file_version(resource_version_id) ON DELETE RESTRICT,
      page_count integer NOT NULL CHECK (page_count > 0),
      parser_name text NOT NULL,
      parser_version text NOT NULL,
      validation_status text NOT NULL
        CHECK (validation_status IN ('passed', 'failed')),
      analysis_json jsonb NOT NULL DEFAULT '{}'::jsonb
    );

    ALTER TABLE hypothesis_question
      DROP CONSTRAINT hypothesis_question_display_order_check;
    ALTER TABLE hypothesis_question
      ADD CONSTRAINT hypothesis_question_display_order_check
      CHECK (display_order BETWEEN 1 AND 7);
    ALTER TABLE hypothesis_question
      ADD COLUMN question_role text NOT NULL DEFAULT 'DRIVER'
      CHECK (
        question_role IN (
          'PERFORMANCE',
          'DRIVER',
          'SEGMENT',
          'OUTLOOK',
          'VALUATION'
        )
      );

    ALTER TABLE research_plan_question
      DROP CONSTRAINT research_plan_question_display_order_check;
    ALTER TABLE research_plan_question
      ADD CONSTRAINT research_plan_question_display_order_check
      CHECK (display_order BETWEEN 1 AND 7);
    ALTER TABLE research_plan_question
      ADD COLUMN question_role text NOT NULL DEFAULT 'DRIVER'
      CHECK (
        question_role IN (
          'PERFORMANCE',
          'DRIVER',
          'SEGMENT',
          'OUTLOOK',
          'VALUATION'
        )
      );
  `);
}

export function down(pgm: MigrationBuilder): void {
  pgm.sql(`
    DROP TABLE IF EXISTS current_ir_version;

    ALTER TABLE research_plan_question
      DROP COLUMN IF EXISTS question_role;
    ALTER TABLE research_plan_question
      DROP CONSTRAINT research_plan_question_display_order_check;
    ALTER TABLE research_plan_question
      ADD CONSTRAINT research_plan_question_display_order_check
      CHECK (display_order BETWEEN 1 AND 5);

    ALTER TABLE hypothesis_question
      DROP COLUMN IF EXISTS question_role;
    ALTER TABLE hypothesis_question
      DROP CONSTRAINT hypothesis_question_display_order_check;
    ALTER TABLE hypothesis_question
      ADD CONSTRAINT hypothesis_question_display_order_check
      CHECK (display_order BETWEEN 1 AND 5);

    ALTER TABLE file_inspection
      DROP COLUMN IF EXISTS current_ir_resource_version_id,
      DROP COLUMN IF EXISTS current_ir_file_version_id;

    ALTER TABLE project_file_version
      DROP CONSTRAINT project_file_version_file_role_check;
    ALTER TABLE project_file_version
      ADD CONSTRAINT project_file_version_file_role_check
      CHECK (file_role IN ('previous_report_pdf', 'analysis_workbook'));

    ALTER TABLE upload_session
      DROP CONSTRAINT upload_session_upload_role_check;
    ALTER TABLE upload_session
      ADD CONSTRAINT upload_session_upload_role_check
      CHECK (upload_role IN ('previous_report_pdf', 'analysis_workbook'));
  `);
}
