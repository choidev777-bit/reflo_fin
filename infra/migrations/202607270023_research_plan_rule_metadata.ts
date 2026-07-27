import type { MigrationBuilder } from "node-pg-migrate";

export function up(pgm: MigrationBuilder): void {
  pgm.sql(`
    ALTER TABLE research_plan_question
      ADD COLUMN verdict_policy jsonb;

    ALTER TABLE research_plan_excel_target
      ADD COLUMN metric_id text,
      ADD COLUMN period_spec jsonb,
      ADD COLUMN target_unit text,
      ADD COLUMN scope_code text,
      ADD COLUMN dart_rule_id text,
      ADD COLUMN write_authority text NOT NULL DEFAULT 'user'
        CHECK (write_authority IN ('user', 'system')),
      ADD COLUMN excluded_reason text;

    UPDATE research_plan_excel_target
    SET metric_id = metric
    WHERE metric_id IS NULL;

    ALTER TABLE research_plan_excel_target
      ALTER COLUMN metric_id SET NOT NULL;
  `);
}

export function down(pgm: MigrationBuilder): void {
  pgm.sql(`
    ALTER TABLE research_plan_excel_target
      DROP COLUMN IF EXISTS excluded_reason,
      DROP COLUMN IF EXISTS write_authority,
      DROP COLUMN IF EXISTS dart_rule_id,
      DROP COLUMN IF EXISTS scope_code,
      DROP COLUMN IF EXISTS target_unit,
      DROP COLUMN IF EXISTS period_spec,
      DROP COLUMN IF EXISTS metric_id;

    ALTER TABLE research_plan_question
      DROP COLUMN IF EXISTS verdict_policy;
  `);
}
