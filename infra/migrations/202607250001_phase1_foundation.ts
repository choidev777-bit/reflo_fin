import type { MigrationBuilder } from "node-pg-migrate";

export function up(pgm: MigrationBuilder): void {
  pgm.sql(`
    CREATE TABLE user_account (
      user_id uuid PRIMARY KEY,
      display_name text NOT NULL,
      email text NOT NULL,
      avatar_url text,
      account_status text NOT NULL DEFAULT 'active'
        CHECK (account_status IN ('active', 'suspended', 'deleted')),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE auth_identity (
      auth_identity_id uuid PRIMARY KEY,
      user_id uuid NOT NULL REFERENCES user_account(user_id) ON DELETE CASCADE,
      issuer text NOT NULL,
      subject text NOT NULL,
      email_at_login text NOT NULL,
      claims_updated_at timestamptz NOT NULL DEFAULT now(),
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (issuer, subject)
    );

    CREATE TABLE oauth_login_attempt (
      attempt_id uuid PRIMARY KEY,
      state_hash char(64) NOT NULL UNIQUE,
      verifier_hash char(64) NOT NULL,
      nonce_hash char(64) NOT NULL,
      return_to text NOT NULL,
      intent text,
      created_at timestamptz NOT NULL DEFAULT now(),
      expires_at timestamptz NOT NULL,
      consumed_at timestamptz
    );

    CREATE INDEX oauth_login_attempt_expiry_idx
      ON oauth_login_attempt (expires_at)
      WHERE consumed_at IS NULL;

    CREATE TABLE user_session (
      session_id uuid PRIMARY KEY,
      user_id uuid NOT NULL REFERENCES user_account(user_id) ON DELETE CASCADE,
      token_hash char(64) NOT NULL UNIQUE,
      csrf_secret_hash char(64) NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      last_seen_at timestamptz NOT NULL DEFAULT now(),
      expires_at timestamptz NOT NULL,
      revoked_at timestamptz,
      rotated_from_session_id uuid REFERENCES user_session(session_id) ON DELETE SET NULL
    );

    CREATE INDEX user_session_active_idx
      ON user_session (token_hash, expires_at)
      WHERE revoked_at IS NULL;
    CREATE INDEX user_session_expiry_idx ON user_session (expires_at);

    CREATE TABLE company_master (
      company_master_id uuid PRIMARY KEY,
      corp_code text UNIQUE,
      company_name text NOT NULL,
      legal_name text,
      ticker text NOT NULL,
      exchange_code text NOT NULL
        CHECK (exchange_code IN ('KOSPI', 'KOSDAQ')),
      industry_code text,
      industry_name text NOT NULL,
      listed boolean NOT NULL DEFAULT true,
      mvp_eligible boolean NOT NULL DEFAULT false,
      ineligibility_reason text,
      active_from date NOT NULL DEFAULT CURRENT_DATE,
      active_to date,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE UNIQUE INDEX company_master_active_ticker_idx
      ON company_master (exchange_code, ticker)
      WHERE active_to IS NULL;
    CREATE INDEX company_master_search_idx
      ON company_master (company_name, ticker)
      WHERE active_to IS NULL;

    CREATE TABLE project (
      project_id uuid PRIMARY KEY,
      owner_user_id uuid NOT NULL REFERENCES user_account(user_id) ON DELETE RESTRICT,
      name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
      project_status text NOT NULL DEFAULT 'draft'
        CHECK (project_status IN ('draft', 'active', 'revalidation_required', 'archived')),
      current_stage text NOT NULL DEFAULT 'setup'
        CHECK (current_stage IN ('setup', 'files', 'hypothesis', 'research_plan', 'validation', 'valuation', 'report_outline')),
      row_version bigint NOT NULL DEFAULT 1 CHECK (row_version > 0),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      last_saved_at timestamptz NOT NULL DEFAULT now(),
      deleted_at timestamptz
    );

    CREATE INDEX project_owner_updated_idx
      ON project (owner_user_id, updated_at DESC)
      WHERE deleted_at IS NULL;

    CREATE TABLE project_stage_state (
      project_id uuid NOT NULL REFERENCES project(project_id) ON DELETE CASCADE,
      stage_key text NOT NULL
        CHECK (stage_key IN ('setup', 'files', 'hypothesis', 'research_plan', 'validation', 'valuation', 'report_outline')),
      stage_order smallint NOT NULL CHECK (stage_order BETWEEN 1 AND 7),
      stage_status text NOT NULL
        CHECK (stage_status IN ('not_started', 'in_progress', 'completed', 'revalidation_required', 'blocked')),
      current_completion_id uuid,
      blocker_codes text[] NOT NULL DEFAULT '{}',
      invalidated_at timestamptz,
      completed_at timestamptz,
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (project_id, stage_key),
      UNIQUE (project_id, stage_order)
    );

    CREATE TABLE versioned_resource (
      resource_id uuid PRIMARY KEY,
      project_id uuid NOT NULL REFERENCES project(project_id) ON DELETE CASCADE,
      resource_kind text NOT NULL,
      resource_key text NOT NULL DEFAULT 'main',
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (project_id, resource_kind, resource_key)
    );

    CREATE TABLE resource_version (
      resource_version_id uuid PRIMARY KEY,
      resource_id uuid NOT NULL REFERENCES versioned_resource(resource_id) ON DELETE CASCADE,
      version_no bigint NOT NULL CHECK (version_no > 0),
      lifecycle_status text NOT NULL
        CHECK (lifecycle_status IN ('draft', 'approved', 'superseded', 'archived')),
      validity_status text NOT NULL DEFAULT 'current'
        CHECK (validity_status IN ('current', 'revalidation_required', 'obsolete')),
      supersedes_version_id uuid REFERENCES resource_version(resource_version_id) ON DELETE RESTRICT,
      schema_version text NOT NULL DEFAULT '1',
      input_fingerprint char(64) NOT NULL,
      content_hash char(64) NOT NULL,
      created_by_user_id uuid REFERENCES user_account(user_id) ON DELETE RESTRICT,
      created_by_actor_type text NOT NULL DEFAULT 'user'
        CHECK (created_by_actor_type IN ('user', 'system')),
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (resource_id, version_no)
    );

    CREATE INDEX resource_version_latest_idx
      ON resource_version (resource_id, version_no DESC);

    CREATE TABLE project_setup_version (
      resource_version_id uuid PRIMARY KEY REFERENCES resource_version(resource_version_id) ON DELETE CASCADE,
      company_master_id uuid REFERENCES company_master(company_master_id) ON DELETE RESTRICT,
      target_year integer,
      target_quarter smallint CHECK (target_quarter BETWEEN 1 AND 4),
      cutoff_date date,
      cutoff_at timestamptz,
      report_type text NOT NULL DEFAULT 'EARNINGS_REVIEW'
        CHECK (report_type = 'EARNINGS_REVIEW'),
      company_domain text NOT NULL DEFAULT 'IT_MANUFACTURING'
        CHECK (company_domain = 'IT_MANUFACTURING'),
      valuation_method text NOT NULL DEFAULT 'PER'
        CHECK (valuation_method = 'PER'),
      completion_status text NOT NULL DEFAULT 'draft'
        CHECK (completion_status IN ('draft', 'complete'))
    );

    CREATE TABLE stage_completion (
      stage_completion_id uuid PRIMARY KEY,
      project_id uuid NOT NULL REFERENCES project(project_id) ON DELETE CASCADE,
      stage_key text NOT NULL,
      completion_no bigint NOT NULL CHECK (completion_no > 0),
      primary_version_id uuid NOT NULL REFERENCES resource_version(resource_version_id) ON DELETE RESTRICT,
      validity_status text NOT NULL DEFAULT 'current'
        CHECK (validity_status IN ('current', 'revalidation_required', 'obsolete')),
      supersedes_completion_id uuid REFERENCES stage_completion(stage_completion_id) ON DELETE RESTRICT,
      completed_by_user_id uuid NOT NULL REFERENCES user_account(user_id) ON DELETE RESTRICT,
      completed_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (project_id, stage_key, completion_no)
    );

    ALTER TABLE project_stage_state
      ADD CONSTRAINT project_stage_state_completion_fk
      FOREIGN KEY (current_completion_id)
      REFERENCES stage_completion(stage_completion_id)
      ON DELETE SET NULL;

    CREATE TABLE project_invalidation_event (
      invalidation_id uuid PRIMARY KEY,
      project_id uuid NOT NULL REFERENCES project(project_id) ON DELETE CASCADE,
      trigger_version_id uuid NOT NULL REFERENCES resource_version(resource_version_id) ON DELETE RESTRICT,
      start_stage_key text NOT NULL,
      reason_code text NOT NULL,
      affected_stage_keys text[] NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE idempotency_record (
      idempotency_id uuid PRIMARY KEY,
      user_id uuid NOT NULL REFERENCES user_account(user_id) ON DELETE CASCADE,
      operation text NOT NULL,
      project_id uuid REFERENCES project(project_id) ON DELETE CASCADE,
      idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 16 AND 128),
      request_hash char(64) NOT NULL,
      response_status integer NOT NULL,
      response_json jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      expires_at timestamptz NOT NULL,
      UNIQUE (user_id, operation, project_id, idempotency_key)
    );

    INSERT INTO company_master (
      company_master_id, corp_code, company_name, legal_name, ticker,
      exchange_code, industry_code, industry_name, listed, mvp_eligible,
      ineligibility_reason
    ) VALUES
      ('019836a0-0000-7000-8000-000000000001', '00126380', '삼성전자', '삼성전자 주식회사', '005930', 'KOSPI', '261', 'IT 제조업 · 반도체', true, true, NULL),
      ('019836a0-0000-7000-8000-000000000002', '00126362', '삼성전기', '삼성전기 주식회사', '009150', 'KOSPI', '262', 'IT 제조업 · 전자부품', true, true, NULL),
      ('019836a0-0000-7000-8000-000000000003', '00164779', 'SK하이닉스', '에스케이하이닉스 주식회사', '000660', 'KOSPI', '261', 'IT 제조업 · 반도체', true, true, NULL),
      ('019836a0-0000-7000-8000-000000000004', '00105961', 'LG이노텍', '엘지이노텍 주식회사', '011070', 'KOSPI', '262', 'IT 제조업 · 전자부품', true, true, NULL),
      ('019836a0-0000-7000-8000-000000000005', '00266961', 'NAVER', '네이버 주식회사', '035420', 'KOSPI', '631', '소프트웨어 · 인터넷', true, false, 'MVP는 IT 제조업 상장사만 지원합니다.');
  `);
}

export function down(pgm: MigrationBuilder): void {
  pgm.sql(`
    DROP TABLE IF EXISTS idempotency_record;
    DROP TABLE IF EXISTS project_invalidation_event;
    ALTER TABLE IF EXISTS project_stage_state
      DROP CONSTRAINT IF EXISTS project_stage_state_completion_fk;
    DROP TABLE IF EXISTS stage_completion;
    DROP TABLE IF EXISTS project_setup_version;
    DROP TABLE IF EXISTS resource_version;
    DROP TABLE IF EXISTS versioned_resource;
    DROP TABLE IF EXISTS project_stage_state;
    DROP TABLE IF EXISTS project;
    DROP TABLE IF EXISTS company_master;
    DROP TABLE IF EXISTS user_session;
    DROP TABLE IF EXISTS oauth_login_attempt;
    DROP TABLE IF EXISTS auth_identity;
    DROP TABLE IF EXISTS user_account;
  `);
}
