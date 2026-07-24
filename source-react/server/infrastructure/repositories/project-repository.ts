import type { TransactionClient } from "../database/transaction";
import { withTransaction } from "../database/transaction";
import { contentHash, stableJson } from "../../domain/hash";
import { uuidv7 } from "../../domain/ids";
import {
  findCachedCompany,
  rememberCompanyReference,
  searchCompanyDirectory,
} from "../company-directory/directory";
import type { DirectoryCompany } from "../company-directory/types";
import { getPool } from "../database/pool";
import {
  isValuationMethod,
  processRoute,
  STAGES,
  supportedTargetYears,
  type ValuationMethod,
  type StageKey,
} from "../../domain/project";
import { ApiError } from "../../http/api-error";

export type SetupInput = {
  companyId: string | null;
  targetPeriod: { year: number; quarter: number } | null;
  cutoffDate: string | null;
  valuationMethod: ValuationMethod;
};

type LatestSetup = {
  resourceId: string;
  resourceVersionId: string;
  versionNo: number;
  companyId: string | null;
  targetYear: number | null;
  targetQuarter: number | null;
  cutoffDate: string | null;
  companyDomain: string;
  valuationMethod: ValuationMethod;
  completionStatus: "draft" | "complete";
};

function validateIdempotencyKey(value: string | null): string {
  const key = value?.trim() ?? "";
  if (key.length < 16 || key.length > 128) {
    throw new ApiError(
      400,
      "IDEMPOTENCY_KEY_REQUIRED",
      "요청 식별자가 필요합니다. 화면을 새로고침해주세요.",
    );
  }
  return key;
}

async function lockIdempotency(
  client: TransactionClient,
  input: {
    userId: string;
    operation: string;
    projectId?: string;
    key: string;
    requestHash: string;
  },
): Promise<{ status: number; body: unknown } | null> {
  await client.query(
    "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
    [`${input.userId}\u001f${input.operation}\u001f${input.projectId ?? ""}\u001f${input.key}`],
  );
  const result = await client.query<{
    request_hash: string;
    response_status: number;
    response_json: unknown;
  }>(
    `SELECT request_hash, response_status, response_json
     FROM idempotency_record
     WHERE user_id = $1
       AND operation = $2
       AND idempotency_key = $3
       AND (($4::uuid IS NULL AND project_id IS NULL) OR project_id = $4::uuid)
       AND expires_at > now()
     ORDER BY created_at DESC
     LIMIT 1`,
    [input.userId, input.operation, input.key, input.projectId ?? null],
  );
  const existing = result.rows[0];
  if (!existing) return null;
  if (existing.request_hash.trim() !== input.requestHash) {
    throw new ApiError(
      409,
      "IDEMPOTENCY_CONFLICT",
      "같은 요청 식별자가 다른 내용에 사용되었습니다.",
    );
  }
  return { status: existing.response_status, body: existing.response_json };
}

async function storeIdempotency(
  client: TransactionClient,
  input: {
    userId: string;
    operation: string;
    projectId?: string;
    key: string;
    requestHash: string;
    status: number;
    body: unknown;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO idempotency_record (
      idempotency_id, user_id, operation, project_id, idempotency_key,
      request_hash, response_status, response_json, expires_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, now() + interval '24 hours')`,
    [
      uuidv7(),
      input.userId,
      input.operation,
      input.projectId ?? null,
      input.key,
      input.requestHash,
      input.status,
      JSON.stringify(input.body),
    ],
  );
}

export async function createProject(input: {
  userId: string;
  name: string;
  idempotencyKey: string | null;
}): Promise<{ status: number; body: unknown }> {
  const name = input.name.replace(/\s+/g, " ").trim();
  if (name.length < 1 || name.length > 60) {
    throw new ApiError(400, "INVALID_PROJECT_NAME", "프로젝트 이름은 1~60자로 입력해주세요.", {
      details: [
        {
          path: "name",
          code: "INVALID_LENGTH",
          message: "프로젝트 이름은 1~60자로 입력해주세요.",
        },
      ],
    });
  }
  const idempotencyKey = validateIdempotencyKey(input.idempotencyKey);
  const requestHash = contentHash({ name });

  return withTransaction(async (client) => {
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
      [`${input.userId}\u001fproject.create\u001f${idempotencyKey}`],
    );
    const replay = await client.query<{
      request_hash: string;
      response_status: number;
      response_json: unknown;
    }>(
      `SELECT request_hash, response_status, response_json
       FROM idempotency_record
       WHERE user_id = $1
         AND operation = 'project.create'
         AND idempotency_key = $2
         AND expires_at > now()
       ORDER BY created_at DESC
       LIMIT 1`,
      [input.userId, idempotencyKey],
    );
    if (replay.rows[0]) {
      if (replay.rows[0].request_hash.trim() !== requestHash) {
        throw new ApiError(
          409,
          "IDEMPOTENCY_CONFLICT",
          "같은 요청 식별자가 다른 프로젝트 이름에 사용되었습니다.",
        );
      }
      return {
        status: replay.rows[0].response_status,
        body: replay.rows[0].response_json,
      };
    }

    const projectId = uuidv7();
    const resourceId = uuidv7();
    const resourceVersionId = uuidv7();
    const emptySetup: SetupInput = {
      companyId: null,
      targetPeriod: null,
      cutoffDate: null,
      valuationMethod: "PER",
    };

    await client.query(
      `INSERT INTO project (
        project_id, owner_user_id, name
      ) VALUES ($1, $2, $3)`,
      [projectId, input.userId, name],
    );

    for (const stage of STAGES) {
      await client.query(
        `INSERT INTO project_stage_state (
          project_id, stage_key, stage_order, stage_status, blocker_codes
        ) VALUES ($1, $2, $3, $4, $5)`,
        [
          projectId,
          stage.key,
          stage.order,
          stage.key === "setup" ? "in_progress" : "blocked",
          stage.key === "setup" ? [] : ["PREREQUISITE_INCOMPLETE"],
        ],
      );
    }

    await client.query(
      `INSERT INTO versioned_resource (
        resource_id, project_id, resource_kind, resource_key
      ) VALUES ($1, $2, 'project_setup', 'main')`,
      [resourceId, projectId],
    );
    const emptyHash = contentHash(emptySetup);
    await client.query(
      `INSERT INTO resource_version (
        resource_version_id, resource_id, version_no, lifecycle_status,
        input_fingerprint, content_hash, created_by_user_id
      ) VALUES ($1, $2, 1, 'draft', $3, $3, $4)`,
      [resourceVersionId, resourceId, emptyHash, input.userId],
    );
    await client.query(
      `INSERT INTO project_setup_version (resource_version_id)
       VALUES ($1)`,
      [resourceVersionId],
    );

    const createdAtResult = await client.query<{ created_at: Date }>(
      "SELECT created_at FROM project WHERE project_id = $1",
      [projectId],
    );
    const body = {
      project: {
        projectId,
        name,
        status: "draft",
        currentRoute: processRoute(projectId, "setup"),
        createdAt: createdAtResult.rows[0].created_at.toISOString(),
      },
    };
    await storeIdempotency(client, {
      userId: input.userId,
      operation: "project.create",
      projectId,
      key: idempotencyKey,
      requestHash,
      status: 201,
      body,
    });
    return { status: 201, body };
  });
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

export async function listProjects(input: {
  userId: string;
  query: string;
  sort: "updated_desc" | "updated_asc" | "company_asc";
  limit: number;
}): Promise<unknown> {
  const query = input.query.replace(/\s+/g, " ").trim();
  if (query.length > 100) {
    throw new ApiError(400, "INVALID_PROJECT_QUERY", "검색어는 100자 이내로 입력해주세요.");
  }
  const orderBy = {
    updated_desc: "p.updated_at DESC, p.project_id DESC",
    updated_asc: "p.updated_at ASC, p.project_id ASC",
    company_asc: "COALESCE(cm.company_name, p.name) ASC, p.updated_at DESC",
  }[input.sort];

  return withTransaction(async (client) => {
    const result = await client.query<{
      project_id: string;
      name: string;
      row_version: string;
      project_status: string;
      current_stage: StageKey;
      created_at: Date;
      last_saved_at: Date;
      company_name: string | null;
      ticker: string | null;
      exchange_code: string | null;
      target_year: number | null;
      target_quarter: number | null;
      company_domain: string;
      valuation_method: ValuationMethod;
      completed_count: string;
      attention_codes: string[];
    }>(
      `SELECT
        p.project_id, p.name, p.row_version, p.project_status, p.current_stage,
        p.created_at, p.last_saved_at,
        cm.company_name, cm.ticker, cm.exchange_code,
        psv.target_year, psv.target_quarter, psv.company_domain,
        psv.valuation_method,
        COUNT(*) FILTER (WHERE pss.stage_status = 'completed')::text AS completed_count,
        COALESCE(array_agg(DISTINCT pss.stage_status)
          FILTER (WHERE pss.stage_status = 'revalidation_required'), '{}') AS attention_codes
       FROM project p
       LEFT JOIN project_stage_state pss ON pss.project_id = p.project_id
       LEFT JOIN LATERAL (
         SELECT setup.*
         FROM versioned_resource vr
         JOIN resource_version rv ON rv.resource_id = vr.resource_id
         JOIN project_setup_version setup ON setup.resource_version_id = rv.resource_version_id
         WHERE vr.project_id = p.project_id
           AND vr.resource_kind = 'project_setup'
         ORDER BY rv.version_no DESC
         LIMIT 1
       ) psv ON true
       LEFT JOIN company_master cm ON cm.company_master_id = psv.company_master_id
       WHERE p.owner_user_id = $1
         AND p.deleted_at IS NULL
         AND (
           $2 = '' OR
           p.name ILIKE ('%' || $2 || '%') ESCAPE '\\' OR
           COALESCE(cm.company_name, '') ILIKE ('%' || $2 || '%') ESCAPE '\\' OR
           COALESCE(cm.ticker, '') ILIKE ('%' || $2 || '%') ESCAPE '\\'
         )
       GROUP BY p.project_id, cm.company_name, cm.ticker, cm.exchange_code,
         psv.target_year, psv.target_quarter, psv.company_domain,
         psv.valuation_method
       ORDER BY ${orderBy}
       LIMIT $3`,
      [input.userId, escapeLike(query), input.limit],
    );

    const items = result.rows.map((row) => {
      const completedStageCount = Number(row.completed_count);
      const progressPercent = Math.round((completedStageCount / 7) * 100);
      const company = row.company_name
        ? {
            name: row.company_name,
            ticker: row.ticker,
            exchange: row.exchange_code,
          }
        : null;
      return {
        projectId: row.project_id,
        name: row.name,
        version: Number(row.row_version),
        company,
        targetPeriod:
          row.target_year && row.target_quarter
            ? { year: row.target_year, quarter: row.target_quarter }
            : null,
        reportType: "EARNINGS_REVIEW",
        companyDomain: row.company_domain,
        valuationMethod: row.valuation_method,
        workflow: {
          currentStage: row.current_stage,
          completedStageCount,
          totalStageCount: 7,
          progressPercent,
          resumeRoute: processRoute(row.project_id, row.current_stage),
        },
        primaryStatusCode:
          row.current_stage === "setup"
            ? "setup_required"
            : row.current_stage === "files"
              ? "file_upload_required"
              : "in_progress",
        attentionCodes:
          row.attention_codes.length > 0 ? ["revalidation_required"] : [],
        activeJob: null,
        lastSavedAt: row.last_saved_at.toISOString(),
        createdAt: row.created_at.toISOString(),
        projectionUpdatedAt: row.last_saved_at.toISOString(),
      };
    });

    return {
      items,
      pageInfo: { nextCursor: null, hasNextPage: false },
      generatedAt: new Date().toISOString(),
    };
  });
}

export async function searchCompanies(input: {
  query: string;
  limit: number;
}): Promise<unknown> {
  const query = input.query.trim();
  if (query.length < 1 || query.length > 40) {
    throw new ApiError(
      400,
      "INVALID_COMPANY_QUERY",
      "기업명 또는 종목코드를 1~40자로 입력해주세요.",
    );
  }
  const candidates = await searchCompanyDirectory(query, input.limit);
  const persisted = candidates.length
    ? await getPool().query<{
        company_master_id: string;
        corp_code: string | null;
        ticker: string;
        exchange_code: string;
      }>(
        `SELECT company_master_id, corp_code, ticker, exchange_code
         FROM company_master
         WHERE active_to IS NULL AND ticker = ANY($1::text[])`,
        [candidates.map((company) => company.ticker)],
      )
    : { rows: [] };

  const items = candidates.map((company) => {
    const existing =
      persisted.rows.find(
        (row) =>
          row.ticker === company.ticker &&
          row.exchange_code === company.exchange,
      ) ?? persisted.rows.find((row) => row.ticker === company.ticker);
    const companyId = existing?.company_master_id ?? company.companyId;
    rememberCompanyReference(companyId, company);
    return {
      ...company,
      companyId,
      corpCode: existing?.corp_code ?? null,
    };
  });
  return { query, items };
}

async function getOwnedProject(
  client: TransactionClient,
  projectId: string,
  userId: string,
  forUpdate = false,
): Promise<{
  projectId: string;
  name: string;
  status: string;
  currentStage: StageKey;
  rowVersion: number;
  updatedAt: Date;
}> {
  const result = await client.query<{
    project_id: string;
    name: string;
    project_status: string;
    current_stage: StageKey;
    row_version: string;
    updated_at: Date;
  }>(
    `SELECT project_id, name, project_status, current_stage, row_version, updated_at
     FROM project
     WHERE project_id = $1
       AND owner_user_id = $2
       AND deleted_at IS NULL
     ${forUpdate ? "FOR UPDATE" : ""}`,
    [projectId, userId],
  );
  const row = result.rows[0];
  if (!row) {
    throw new ApiError(404, "PROJECT_NOT_FOUND", "프로젝트를 찾을 수 없습니다.");
  }
  return {
    projectId: row.project_id,
    name: row.name,
    status: row.project_status,
    currentStage: row.current_stage,
    rowVersion: Number(row.row_version),
    updatedAt: row.updated_at,
  };
}

async function latestSetup(
  client: TransactionClient,
  projectId: string,
): Promise<LatestSetup> {
  const result = await client.query<{
    resource_id: string;
    resource_version_id: string;
    version_no: string;
    company_master_id: string | null;
    target_year: number | null;
    target_quarter: number | null;
    cutoff_date: string | null;
    company_domain: string;
    valuation_method: ValuationMethod;
    completion_status: "draft" | "complete";
  }>(
    `SELECT
      vr.resource_id, rv.resource_version_id, rv.version_no,
      psv.company_master_id, psv.target_year, psv.target_quarter,
      psv.cutoff_date::text, psv.company_domain, psv.valuation_method,
      psv.completion_status
     FROM versioned_resource vr
     JOIN resource_version rv ON rv.resource_id = vr.resource_id
     JOIN project_setup_version psv ON psv.resource_version_id = rv.resource_version_id
     WHERE vr.project_id = $1
       AND vr.resource_kind = 'project_setup'
       AND vr.resource_key = 'main'
     ORDER BY rv.version_no DESC
     LIMIT 1`,
    [projectId],
  );
  const row = result.rows[0];
  if (!row) throw new ApiError(500, "SETUP_LOAD_FAILED", "프로젝트 설정을 불러오지 못했습니다.");
  return {
    resourceId: row.resource_id,
    resourceVersionId: row.resource_version_id,
    versionNo: Number(row.version_no),
    companyId: row.company_master_id,
    targetYear: row.target_year,
    targetQuarter: row.target_quarter,
    cutoffDate: row.cutoff_date,
    companyDomain: row.company_domain,
    valuationMethod: row.valuation_method,
    completionStatus: row.completion_status,
  };
}

async function stageStates(client: TransactionClient, projectId: string) {
  const result = await client.query<{
    stage_key: StageKey;
    stage_order: number;
    stage_status: string;
    blocker_codes: string[];
  }>(
    `SELECT stage_key, stage_order, stage_status, blocker_codes
     FROM project_stage_state
     WHERE project_id = $1
     ORDER BY stage_order`,
    [projectId],
  );
  return result.rows.map((row) => ({
    stageKey: row.stage_key,
    stageOrder: row.stage_order,
    status: row.stage_status,
    blockerCodes: row.blocker_codes,
    route: processRoute(projectId, row.stage_key),
  }));
}

export async function getSetup(projectId: string, userId: string): Promise<unknown> {
  return withTransaction(async (client) => {
    const project = await getOwnedProject(client, projectId, userId);
    const setup = await latestSetup(client, projectId);
    const stages = await stageStates(client, projectId);
    const companyResult = setup.companyId
      ? await client.query<{
          company_master_id: string;
          company_name: string;
          ticker: string;
          exchange_code: string;
          industry_name: string;
          mvp_eligible: boolean;
        }>(
          `SELECT company_master_id, company_name, ticker, exchange_code,
            industry_name, mvp_eligible
           FROM company_master WHERE company_master_id = $1`,
          [setup.companyId],
        )
      : null;
    const company = companyResult?.rows[0];
    return {
      project: {
        projectId: project.projectId,
        name: project.name,
        status: project.status,
        currentStage: project.currentStage,
        version: project.rowVersion,
        updatedAt: project.updatedAt.toISOString(),
      },
      setup: {
        company: company
          ? {
              companyId: company.company_master_id,
              name: company.company_name,
              ticker: company.ticker,
              exchange: company.exchange_code,
              industry: company.industry_name,
              mvpEligible: company.mvp_eligible,
            }
          : null,
        targetPeriod:
          setup.targetYear && setup.targetQuarter
            ? { year: setup.targetYear, quarter: setup.targetQuarter }
            : null,
        cutoffDate: setup.cutoffDate,
        reportType: "EARNINGS_REVIEW",
        companyDomain: company?.industry_name ?? setup.companyDomain,
        valuationMethod: setup.valuationMethod,
        status: setup.completionStatus,
        version: setup.versionNo,
      },
      workflow: {
        stageStates: stages,
        allowedRoutes: stages
          .filter((stage) => stage.status !== "blocked" && stage.status !== "not_started")
          .map((stage) => stage.route),
        downstreamImpact: stages
          .filter((stage) => stage.status === "revalidation_required")
          .map((stage) => stage.stageKey),
      },
      supportedTargetYears: supportedTargetYears(),
    };
  });
}

function normalizedSetup(input: SetupInput): SetupInput {
  const companyId = input.companyId?.trim() || null;
  const targetPeriod = input.targetPeriod
    ? {
        year: Number(input.targetPeriod.year),
        quarter: Number(input.targetPeriod.quarter),
      }
    : null;
  const cutoffDate = input.cutoffDate?.trim() || null;
  const valuationMethod = input.valuationMethod;

  if (companyId && !/^[0-9a-f-]{36}$/i.test(companyId)) {
    throw new ApiError(400, "INVALID_SETUP_FIELD", "선택한 기업 정보가 올바르지 않습니다.", {
      details: [{ path: "setup.companyId", code: "INVALID_ID", message: "기업을 다시 선택해주세요." }],
    });
  }
  if (
    targetPeriod &&
    (!supportedTargetYears().includes(targetPeriod.year) ||
      !Number.isInteger(targetPeriod.quarter) ||
      targetPeriod.quarter < 1 ||
      targetPeriod.quarter > 4)
  ) {
    throw new ApiError(400, "INVALID_SETUP_FIELD", "분석 대상 기간이 올바르지 않습니다.", {
      details: [{ path: "setup.targetPeriod", code: "INVALID_PERIOD", message: "연도와 분기를 다시 선택해주세요." }],
    });
  }
  if (cutoffDate && !isValidDateOnly(cutoffDate)) {
    throw new ApiError(400, "INVALID_SETUP_FIELD", "보고서 기준일이 올바르지 않습니다.", {
      details: [{ path: "setup.cutoffDate", code: "INVALID_DATE", message: "YYYY-MM-DD 형식의 날짜를 선택해주세요." }],
    });
  }
  if (!isValuationMethod(valuationMethod)) {
    throw new ApiError(400, "INVALID_SETUP_FIELD", "밸류에이션 모델이 올바르지 않습니다.", {
      details: [{
        path: "setup.valuationMethod",
        code: "INVALID_VALUATION_METHOD",
        message: "밸류에이션 모델을 다시 선택해주세요.",
      }],
    });
  }
  return { companyId, targetPeriod, cutoffDate, valuationMethod };
}

function isValidDateOnly(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function cutoffAt(value: string | null): Date | null {
  return value ? new Date(`${value}T14:59:59.999Z`) : null;
}

async function assertEligibleCompany(
  client: TransactionClient,
  companyId: string | null,
): Promise<void> {
  if (!companyId) return;
  const result = await client.query<{ mvp_eligible: boolean; ineligibility_reason: string | null }>(
    `SELECT mvp_eligible, ineligibility_reason
     FROM company_master
     WHERE company_master_id = $1 AND active_to IS NULL`,
    [companyId],
  );
  const company = result.rows[0];
  if (!company || !company.mvp_eligible) {
    throw new ApiError(
      422,
      "UNSUPPORTED_COMPANY",
      company?.ineligibility_reason ?? "지원하지 않는 기업입니다.",
      {
        details: [
          {
            path: "setup.companyId",
            code: "UNSUPPORTED_COMPANY",
            message: company?.ineligibility_reason ?? "지원 기업을 다시 선택해주세요.",
          },
        ],
      },
    );
  }
}

async function materializeSelectedCompany(
  client: TransactionClient,
  companyId: string | null,
  directoryCompany: DirectoryCompany | undefined,
): Promise<string | null> {
  if (!companyId) return null;
  await client.query(
    "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
    [`company:${directoryCompany?.ticker ?? companyId}`],
  );

  const byId = await client.query<{ company_master_id: string }>(
    `SELECT company_master_id
     FROM company_master
     WHERE company_master_id = $1 AND active_to IS NULL`,
    [companyId],
  );
  if (byId.rows[0]) {
    if (directoryCompany) {
      await client.query(
        `UPDATE company_master
         SET company_name = $2, legal_name = $2, ticker = $3,
           exchange_code = $4, industry_name = $5, listed = true,
           mvp_eligible = true, ineligibility_reason = NULL,
           active_to = NULL, updated_at = now()
         WHERE company_master_id = $1`,
        [
          companyId,
          directoryCompany.name,
          directoryCompany.ticker,
          directoryCompany.exchange,
          directoryCompany.industry,
        ],
      );
    }
    return companyId;
  }
  if (!directoryCompany) {
    throw new ApiError(
      422,
      "COMPANY_SELECTION_EXPIRED",
      "기업 검색 정보가 만료되었습니다. 기업을 다시 검색해 선택해주세요.",
    );
  }

  const byTicker = await client.query<{ company_master_id: string }>(
    `SELECT company_master_id
     FROM company_master
     WHERE ticker = $1 AND active_to IS NULL
     ORDER BY (exchange_code = $2) DESC, updated_at DESC
     LIMIT 1`,
    [directoryCompany.ticker, directoryCompany.exchange],
  );
  if (byTicker.rows[0]) {
    await client.query(
      `UPDATE company_master
       SET company_name = $2, legal_name = $2, exchange_code = $3,
         industry_name = $4, listed = true, mvp_eligible = true,
         ineligibility_reason = NULL, active_to = NULL, updated_at = now()
       WHERE company_master_id = $1`,
      [
        byTicker.rows[0].company_master_id,
        directoryCompany.name,
        directoryCompany.exchange,
        directoryCompany.industry,
      ],
    );
    return byTicker.rows[0].company_master_id;
  }

  await client.query(
    `INSERT INTO company_master (
      company_master_id, corp_code, company_name, legal_name, ticker,
      exchange_code, industry_name, listed, mvp_eligible,
      ineligibility_reason
    ) VALUES ($1, NULL, $2, $2, $3, $4, $5, true, true, NULL)`,
    [
      companyId,
      directoryCompany.name,
      directoryCompany.ticker,
      directoryCompany.exchange,
      directoryCompany.industry,
    ],
  );
  return companyId;
}

function setupFromLatest(latest: LatestSetup): SetupInput {
  return {
    companyId: latest.companyId,
    targetPeriod:
      latest.targetYear && latest.targetQuarter
        ? { year: latest.targetYear, quarter: latest.targetQuarter }
        : null,
    cutoffDate: latest.cutoffDate,
    valuationMethod: latest.valuationMethod,
  };
}

async function appendSetupVersion(
  client: TransactionClient,
  input: {
    latest: LatestSetup;
    setup: SetupInput;
    userId: string;
    status: "draft" | "complete";
  },
): Promise<{ resourceVersionId: string; versionNo: number }> {
  const resourceVersionId = uuidv7();
  const versionNo = input.latest.versionNo + 1;
  const companyDomainResult = input.setup.companyId
    ? await client.query<{ industry_name: string }>(
        `SELECT industry_name
         FROM company_master
         WHERE company_master_id = $1 AND active_to IS NULL`,
        [input.setup.companyId],
      )
    : null;
  const companyDomain =
    companyDomainResult?.rows[0]?.industry_name?.trim() || "미선택";
  const payload = {
    ...input.setup,
    reportType: "EARNINGS_REVIEW",
    companyDomain,
    completionStatus: input.status,
  };
  const hash = contentHash(payload);

  await client.query(
    `UPDATE resource_version
     SET lifecycle_status = 'superseded'
     WHERE resource_version_id = $1
       AND lifecycle_status IN ('draft', 'approved')`,
    [input.latest.resourceVersionId],
  );
  await client.query(
    `INSERT INTO resource_version (
      resource_version_id, resource_id, version_no, lifecycle_status,
      supersedes_version_id, input_fingerprint, content_hash, created_by_user_id
    ) VALUES ($1, $2, $3, $4, $5, $6, $6, $7)`,
    [
      resourceVersionId,
      input.latest.resourceId,
      versionNo,
      input.status === "complete" ? "approved" : "draft",
      input.latest.resourceVersionId,
      hash,
      input.userId,
    ],
  );
  await client.query(
    `INSERT INTO project_setup_version (
      resource_version_id, company_master_id, target_year, target_quarter,
      cutoff_date, cutoff_at, company_domain, valuation_method,
      completion_status
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      resourceVersionId,
      input.setup.companyId,
      input.setup.targetPeriod?.year ?? null,
      input.setup.targetPeriod?.quarter ?? null,
      input.setup.cutoffDate,
      cutoffAt(input.setup.cutoffDate),
      companyDomain,
      input.setup.valuationMethod,
      input.status,
    ],
  );
  return { resourceVersionId, versionNo };
}

async function downstreamImpact(
  client: TransactionClient,
  projectId: string,
): Promise<StageKey[]> {
  const result = await client.query<{ stage_key: StageKey }>(
    `SELECT stage_key
     FROM project_stage_state
     WHERE project_id = $1
       AND stage_order >= 2
       AND stage_status NOT IN ('not_started', 'blocked')
     ORDER BY stage_order`,
    [projectId],
  );
  return result.rows.map((row) => row.stage_key);
}

async function applyInvalidation(
  client: TransactionClient,
  input: {
    projectId: string;
    triggerVersionId: string;
    affectedStages: StageKey[];
  },
): Promise<void> {
  if (input.affectedStages.length === 0) return;
  await client.query(
    `INSERT INTO project_invalidation_event (
      invalidation_id, project_id, trigger_version_id, start_stage_key,
      reason_code, affected_stage_keys
    ) VALUES ($1, $2, $3, 'files', 'SETUP_CHANGED', $4)`,
    [uuidv7(), input.projectId, input.triggerVersionId, input.affectedStages],
  );
  await client.query(
    `UPDATE project_stage_state
     SET stage_status = 'revalidation_required',
         invalidated_at = now(),
         blocker_codes = ARRAY['SETUP_CHANGED'],
         updated_at = now()
     WHERE project_id = $1 AND stage_key = ANY($2::text[])`,
    [input.projectId, input.affectedStages],
  );
  await client.query(
    `UPDATE stage_completion
     SET validity_status = 'revalidation_required'
     WHERE project_id = $1
       AND stage_key = ANY($2::text[])
       AND validity_status = 'current'`,
    [input.projectId, input.affectedStages],
  );
}

export async function saveSetup(input: {
  projectId: string;
  userId: string;
  projectVersion: number;
  setup: SetupInput;
  confirmDownstreamInvalidation: boolean;
}): Promise<unknown> {
  let setup = normalizedSetup(input.setup);
  const directoryCompany = setup.companyId
    ? findCachedCompany(setup.companyId)
    : undefined;
  return withTransaction(async (client) => {
    const project = await getOwnedProject(client, input.projectId, input.userId, true);
    if (project.rowVersion !== input.projectVersion) {
      throw new ApiError(
        409,
        "STALE_PROJECT_VERSION",
        "다른 탭에서 프로젝트 설정이 변경되었습니다.",
        {
          meta: {
            currentVersion: project.rowVersion,
            resumeRoute: processRoute(input.projectId, "setup"),
          },
        },
      );
    }
    setup = {
      ...setup,
      companyId: await materializeSelectedCompany(
        client,
        setup.companyId,
        directoryCompany,
      ),
    };
    await assertEligibleCompany(client, setup.companyId);
    const latest = await latestSetup(client, input.projectId);
    const changed = stableJson(setupFromLatest(latest)) !== stableJson(setup);
    const affectedStages = changed ? await downstreamImpact(client, input.projectId) : [];
    if (affectedStages.length > 0 && !input.confirmDownstreamInvalidation) {
      throw new ApiError(
        409,
        "DOWNSTREAM_INVALIDATION_CONFIRMATION_REQUIRED",
        "변경하면 이후 단계의 재검증이 필요합니다.",
        { meta: { affectedStages } },
      );
    }

    if (!changed) {
      return {
        projectVersion: project.rowVersion,
        setupVersion: latest.versionNo,
        savedAt: project.updatedAt.toISOString(),
        setupStatus: latest.completionStatus,
        complete: latest.completionStatus === "complete",
        invalidatedStages: [],
      };
    }

    const version = await appendSetupVersion(client, {
      latest,
      setup,
      userId: input.userId,
      status: "draft",
    });
    await applyInvalidation(client, {
      projectId: input.projectId,
      triggerVersionId: version.resourceVersionId,
      affectedStages,
    });
    const projectResult = await client.query<{ row_version: string; last_saved_at: Date }>(
      `UPDATE project
       SET row_version = row_version + 1,
           project_status = CASE
             WHEN $2::boolean THEN 'revalidation_required'
             ELSE project_status
           END,
           updated_at = now(),
           last_saved_at = now()
       WHERE project_id = $1
       RETURNING row_version, last_saved_at`,
      [input.projectId, affectedStages.length > 0],
    );
    return {
      projectVersion: Number(projectResult.rows[0].row_version),
      setupVersion: version.versionNo,
      savedAt: projectResult.rows[0].last_saved_at.toISOString(),
      setupStatus: "draft",
      complete: false,
      invalidatedStages: affectedStages,
    };
  });
}

export async function completeSetup(input: {
  projectId: string;
  userId: string;
  projectVersion: number;
  setup: SetupInput;
  confirmDownstreamInvalidation: boolean;
  idempotencyKey: string | null;
}): Promise<{ status: number; body: unknown }> {
  let setup = normalizedSetup(input.setup);
  const directoryCompany = setup.companyId
    ? findCachedCompany(setup.companyId)
    : undefined;
  const missing = [
    !setup.companyId ? "setup.companyId" : null,
    !setup.targetPeriod ? "setup.targetPeriod" : null,
    !setup.cutoffDate ? "setup.cutoffDate" : null,
  ].filter((value): value is string => Boolean(value));
  if (missing.length > 0) {
    throw new ApiError(422, "SETUP_INCOMPLETE", "필수 설정을 모두 입력해주세요.", {
      details: missing.map((path) => ({
        path,
        code: "REQUIRED",
        message: "필수 입력입니다.",
      })),
    });
  }
  const idempotencyKey = validateIdempotencyKey(input.idempotencyKey);
  const requestHash = contentHash({
    projectVersion: input.projectVersion,
    setup,
    confirmDownstreamInvalidation: input.confirmDownstreamInvalidation,
  });

  return withTransaction(async (client) => {
    const replay = await lockIdempotency(client, {
      userId: input.userId,
      operation: "setup.complete",
      projectId: input.projectId,
      key: idempotencyKey,
      requestHash,
    });
    if (replay) return replay;

    const project = await getOwnedProject(client, input.projectId, input.userId, true);
    if (project.rowVersion !== input.projectVersion) {
      throw new ApiError(
        409,
        "STALE_PROJECT_VERSION",
        "다른 탭에서 프로젝트 설정이 변경되었습니다.",
        {
          meta: {
            currentVersion: project.rowVersion,
            resumeRoute: processRoute(input.projectId, "setup"),
          },
        },
      );
    }
    setup = {
      ...setup,
      companyId: await materializeSelectedCompany(
        client,
        setup.companyId,
        directoryCompany,
      ),
    };
    await assertEligibleCompany(client, setup.companyId);
    const latest = await latestSetup(client, input.projectId);
    if (
      project.currentStage !== "setup" &&
      latest.completionStatus === "complete" &&
      stableJson(setupFromLatest(latest)) === stableJson(setup)
    ) {
      const body = {
        projectVersion: project.rowVersion,
        setupVersion: latest.versionNo,
        setupStatus: "complete",
        currentStage: project.currentStage,
        currentRoute: processRoute(input.projectId, project.currentStage),
        invalidatedStages: [],
      };
      await storeIdempotency(client, {
        userId: input.userId,
        operation: "setup.complete",
        projectId: input.projectId,
        key: idempotencyKey,
        requestHash,
        status: 200,
        body,
      });
      return { status: 200, body };
    }
    const affectedStages =
      stableJson(setupFromLatest(latest)) !== stableJson(setup)
        ? await downstreamImpact(client, input.projectId)
        : [];
    if (affectedStages.length > 0 && !input.confirmDownstreamInvalidation) {
      throw new ApiError(
        409,
        "DOWNSTREAM_INVALIDATION_CONFIRMATION_REQUIRED",
        "변경하면 이후 단계의 재검증이 필요합니다.",
        { meta: { affectedStages } },
      );
    }

    const version = await appendSetupVersion(client, {
      latest,
      setup,
      userId: input.userId,
      status: "complete",
    });
    await applyInvalidation(client, {
      projectId: input.projectId,
      triggerVersionId: version.resourceVersionId,
      affectedStages,
    });

    const previousCompletion = await client.query<{
      stage_completion_id: string;
      completion_no: string;
    }>(
      `SELECT stage_completion_id, completion_no
       FROM stage_completion
       WHERE project_id = $1 AND stage_key = 'setup'
       ORDER BY completion_no DESC
       LIMIT 1`,
      [input.projectId],
    );
    const completionId = uuidv7();
    const completionNo = Number(previousCompletion.rows[0]?.completion_no ?? 0) + 1;
    await client.query(
      `INSERT INTO stage_completion (
        stage_completion_id, project_id, stage_key, completion_no,
        primary_version_id, supersedes_completion_id, completed_by_user_id
      ) VALUES ($1, $2, 'setup', $3, $4, $5, $6)`,
      [
        completionId,
        input.projectId,
        completionNo,
        version.resourceVersionId,
        previousCompletion.rows[0]?.stage_completion_id ?? null,
        input.userId,
      ],
    );
    await client.query(
      `UPDATE project_stage_state
       SET stage_status = 'completed',
           current_completion_id = $2,
           completed_at = now(),
           blocker_codes = '{}',
           updated_at = now()
       WHERE project_id = $1 AND stage_key = 'setup'`,
      [input.projectId, completionId],
    );
    await client.query(
      `UPDATE project_stage_state
       SET stage_status = CASE
             WHEN stage_status = 'revalidation_required' THEN stage_status
             ELSE 'in_progress'
           END,
           blocker_codes = CASE
             WHEN stage_status = 'revalidation_required' THEN blocker_codes
             ELSE '{}'
           END,
           updated_at = now()
       WHERE project_id = $1 AND stage_key = 'files'`,
      [input.projectId],
    );
    const projectResult = await client.query<{ row_version: string }>(
      `UPDATE project
       SET row_version = row_version + 1,
           project_status = CASE
             WHEN $2::boolean THEN 'revalidation_required'
             ELSE 'active'
           END,
           current_stage = 'files',
           updated_at = now(),
           last_saved_at = now()
       WHERE project_id = $1
       RETURNING row_version`,
      [input.projectId, affectedStages.length > 0],
    );
    const body = {
      projectVersion: Number(projectResult.rows[0].row_version),
      setupVersion: version.versionNo,
      setupStatus: "complete",
      currentStage: "files",
      currentRoute: processRoute(input.projectId, "files"),
      invalidatedStages: affectedStages,
    };
    await storeIdempotency(client, {
      userId: input.userId,
      operation: "setup.complete",
      projectId: input.projectId,
      key: idempotencyKey,
      requestHash,
      status: 200,
      body,
    });
    return { status: 200, body };
  });
}

export async function getProjectAccess(input: {
  projectId: string;
  userId: string;
}): Promise<{
  currentStage: StageKey;
  allowedRoutes: string[];
  canonicalRoute: string;
}> {
  return withTransaction(async (client) => {
    const project = await getOwnedProject(client, input.projectId, input.userId);
    const stages = await stageStates(client, input.projectId);
    const allowedRoutes = stages
      .filter((stage) => stage.status !== "blocked" && stage.status !== "not_started")
      .map((stage) => stage.route);
    return {
      currentStage: project.currentStage,
      allowedRoutes,
      canonicalRoute: processRoute(input.projectId, project.currentStage),
    };
  });
}
