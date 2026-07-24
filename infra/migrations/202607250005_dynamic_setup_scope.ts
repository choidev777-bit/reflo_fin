import type { MigrationBuilder } from "node-pg-migrate";

export function up(pgm: MigrationBuilder): void {
  pgm.sql(`
    ALTER TABLE project_setup_version
      DROP CONSTRAINT IF EXISTS project_setup_version_company_domain_check,
      DROP CONSTRAINT IF EXISTS project_setup_version_valuation_method_check;

    ALTER TABLE project_setup_version
      ALTER COLUMN company_domain SET DEFAULT '미선택';

    UPDATE project_setup_version setup
    SET company_domain = COALESCE(NULLIF(company.industry_name, ''), '미선택')
    FROM company_master company
    WHERE company.company_master_id = setup.company_master_id;

    ALTER TABLE project_setup_version
      ADD CONSTRAINT project_setup_version_valuation_method_check
      CHECK (valuation_method IN ('PER', 'PBR', 'EV_EBITDA', 'DCF'));
  `);
}

export function down(pgm: MigrationBuilder): void {
  pgm.sql(`
    UPDATE project_setup_version
    SET company_domain = 'IT_MANUFACTURING',
        valuation_method = 'PER';

    ALTER TABLE project_setup_version
      DROP CONSTRAINT IF EXISTS project_setup_version_valuation_method_check;

    ALTER TABLE project_setup_version
      ALTER COLUMN company_domain SET DEFAULT 'IT_MANUFACTURING',
      ADD CONSTRAINT project_setup_version_company_domain_check
        CHECK (company_domain = 'IT_MANUFACTURING'),
      ADD CONSTRAINT project_setup_version_valuation_method_check
        CHECK (valuation_method = 'PER');
  `);
}
