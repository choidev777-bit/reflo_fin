import type { MigrationBuilder } from "node-pg-migrate";

/**
 * 보고서 편집으로 파생된 version이 원본 materialization run을 그대로 물려받을
 * 수 있게 한다.
 *
 * 기존 trigger는 `report_materialization_run.report_resource_version_id`가
 * NULL이거나 **삽입되는 version과 정확히 같을 때만** 통과시켰다. 초안 생성 시
 * 만들어진 version 1에는 맞지만, 사용자가 본문을 한 글자라도 고치면
 * `patchReportVersion`이 같은 `materialization_run_id`를 가진 version 2를
 * 만들면서 이 검사에 걸려 `23514`로 실패했다. 즉 STEP 07 편집 저장이 항상 500.
 *
 * 프로젝트 소유권 검사는 그대로 두고, run이 **같은 보고서의 다른 version**을
 * 가리키는 경우(편집 계보)를 허용한다.
 */
export function up(pgm: MigrationBuilder): void {
  pgm.sql(`
    CREATE OR REPLACE FUNCTION
      enforce_report_version_materialization_ownership()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      IF NEW.materialization_run_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM report_materialization_run run
          JOIN report
            ON report.report_id = NEW.report_id
          WHERE run.materialization_run_id = NEW.materialization_run_id
            AND run.project_id = report.project_id
            AND (
              run.report_resource_version_id IS NULL
              OR run.report_resource_version_id =
                NEW.resource_version_id
              OR EXISTS (
                SELECT 1
                FROM report_version origin
                WHERE origin.resource_version_id =
                    run.report_resource_version_id
                  AND origin.report_id = NEW.report_id
              )
            )
        )
      THEN
        RAISE EXCEPTION
          'report version materialization must belong to its project'
          USING ERRCODE = '23514',
            CONSTRAINT = 'report_version_materialization_project_check';
      END IF;
      RETURN NEW;
    END;
    $$;
  `);
}

export function down(pgm: MigrationBuilder): void {
  pgm.sql(`
    CREATE OR REPLACE FUNCTION
      enforce_report_version_materialization_ownership()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      IF NEW.materialization_run_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM report_materialization_run run
          JOIN report
            ON report.report_id = NEW.report_id
          WHERE run.materialization_run_id = NEW.materialization_run_id
            AND run.project_id = report.project_id
            AND (
              run.report_resource_version_id IS NULL
              OR run.report_resource_version_id =
                NEW.resource_version_id
            )
        )
      THEN
        RAISE EXCEPTION
          'report version materialization must belong to its project'
          USING ERRCODE = '23514',
            CONSTRAINT = 'report_version_materialization_project_check';
      END IF;
      RETURN NEW;
    END;
    $$;
  `);
}
