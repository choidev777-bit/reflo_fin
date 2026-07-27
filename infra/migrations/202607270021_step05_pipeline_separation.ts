import type { MigrationBuilder } from "node-pg-migrate";

export function up(pgm: MigrationBuilder): void {
  pgm.sql(`
    ALTER TABLE validation_result
      ADD COLUMN metric_id text,
      ADD COLUMN status_code text;

    WITH recovered_metric AS (
      SELECT
        result.result_id,
        evidence_metric.metric_id AS evidence_metric_id,
        plan_metric.metric_id AS plan_metric_id
      FROM validation_result result
      LEFT JOIN LATERAL (
        SELECT CASE
          WHEN count(DISTINCT metric.metric_id) = 1
            THEN min(metric.metric_id)
          ELSE NULL
        END AS metric_id
        FROM (
          SELECT NULLIF(btrim(evidence.provenance_json->>'metricId'), '') AS metric_id
          FROM unnest(result.evidence_ids) AS linked_evidence(evidence_id)
          JOIN evidence
            ON evidence.evidence_id = linked_evidence.evidence_id
        ) metric
        WHERE metric.metric_id IS NOT NULL
      ) evidence_metric ON true
      LEFT JOIN LATERAL (
        SELECT candidate.metric_id
        FROM validation_run run
        JOIN research_run research
          ON research.research_run_id = run.research_run_id
        JOIN research_plan_version plan
          ON plan.resource_version_id =
             research.approved_plan_resource_version_id
        CROSS JOIN LATERAL (
          SELECT NULLIF(btrim(target->>'metricId'), '') AS metric_id
          FROM jsonb_array_elements(
            COALESCE(plan.plan_snapshot_json->'excelTargets', '[]'::jsonb)
          ) target
          WHERE result.category = 'excel'
            AND target->>'targetId' = result.target_id
          UNION ALL
          SELECT NULLIF(btrim(metric.value), '') AS metric_id
          FROM jsonb_array_elements(
            COALESCE(plan.plan_snapshot_json->'questions', '[]'::jsonb)
          ) question
          CROSS JOIN LATERAL jsonb_array_elements_text(
            COALESCE(question->'metrics', '[]'::jsonb)
          ) metric(value)
          WHERE result.category = 'hypothesis'
            AND question->>'questionId' = result.question_id::text
            AND metric.value = result.title
        ) candidate
        WHERE run.validation_run_id = result.validation_run_id
          AND candidate.metric_id IS NOT NULL
        LIMIT 1
      ) plan_metric ON true
    )
    UPDATE validation_result result
    SET
      metric_id = COALESCE(
        recovered.evidence_metric_id,
        recovered.plan_metric_id,
        NULLIF(btrim(result.metric_id), ''),
        result.title
      ),
      status_code = CASE
        WHEN recovered.evidence_metric_id IS NULL
         AND recovered.plan_metric_id IS NULL
          THEN COALESCE(result.status_code, 'legacy_metric_unresolved')
        ELSE result.status_code
      END
    FROM recovered_metric recovered
    WHERE recovered.result_id = result.result_id;

    ALTER TABLE validation_result
      ALTER COLUMN metric_id SET NOT NULL;

    CREATE INDEX validation_result_metric_idx
      ON validation_result (project_id, validation_run_id, category, metric_id);
  `);
}

export function down(pgm: MigrationBuilder): void {
  pgm.sql(`
    DROP INDEX IF EXISTS validation_result_metric_idx;
    ALTER TABLE validation_result
      DROP COLUMN IF EXISTS status_code,
      DROP COLUMN IF EXISTS metric_id;
  `);
}
