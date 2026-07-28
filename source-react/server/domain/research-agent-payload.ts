import type {
  ResearchExcelTarget,
  ResearchPlanQuestion,
  ResearchSourceSnapshot,
} from "./research-validation";

type ResearchAgentPlanInput = {
  company: string;
  ticker: string;
  targetPeriod: string;
  cutoffAt: string;
  questions: ResearchPlanQuestion[];
  /** 가설 축 호출은 Excel 대상을 넘기지 않는다(파이프라인 분리). */
  excelTargets?: ResearchExcelTarget[];
  approvedPlanResourceVersionId: string;
};

const DART_ROW_FIELDS = [
  "rcept_no",
  "bsns_year",
  "corp_name",
  "account_id",
  "account_nm",
  "account_detail",
  "fs_div",
  "fs_nm",
  "sj_div",
  "sj_nm",
  "thstrm_nm",
  "thstrm_amount",
  "thstrm_add_amount",
  "frmtrm_nm",
  "frmtrm_amount",
  "frmtrm_q_nm",
  "frmtrm_q_amount",
  "frmtrm_add_amount",
  "bfefrmtrm_nm",
  "bfefrmtrm_amount",
  "ord",
  "currency",
  "_reflo_period",
  "_reflo_report_type",
] as const;

const ECOS_ROW_FIELDS = [
  "STAT_CODE",
  "STAT_NAME",
  "ITEM_CODE1",
  "ITEM_NAME1",
  "ITEM_CODE2",
  "ITEM_NAME2",
  "ITEM_CODE3",
  "ITEM_NAME3",
  "UNIT_NAME",
  "TIME",
  "TIME_NAME",
  "DATA_VALUE",
] as const;

function selectedFields(
  value: unknown,
  fields: readonly string[],
): Record<string, unknown> {
  if (typeof value !== "object" || value === null) return {};
  const record = value as Record<string, unknown>;
  return Object.fromEntries(
    fields.flatMap((field) =>
      record[field] === undefined ? [] : [[field, record[field]]],
    ),
  );
}

function compactContent(source: ResearchSourceSnapshot): Record<string, unknown> {
  const content = source.content;
  if (source.sourceType === "DART") {
    const rows = Array.isArray(content.rows) ? content.rows : [];
    return {
      periods: Array.isArray(content.periods) ? content.periods : [],
      rows: rows.map((row) => selectedFields(row, DART_ROW_FIELDS)),
    };
  }
  if (source.sourceType === "ECOS") {
    const rows = Array.isArray(content.rows) ? content.rows : [];
    return {
      rows: rows.map((row) => selectedFields(row, ECOS_ROW_FIELDS)),
      latest: selectedFields(content.latest, ECOS_ROW_FIELDS),
    };
  }
  if (source.locator.kind === "pdf" && Array.isArray(content.pages)) {
    return {
      pages: content.pages.map((page) =>
        selectedFields(page, ["pageNumber", "text"]),
      ),
    };
  }
  if (source.locator.kind === "html") {
    return selectedFields(content, [
      "body",
      "title",
      "publisher",
      "publishedAt",
      "modifiedAt",
    ]);
  }
  return content;
}

function compactLocator(
  source: ResearchSourceSnapshot,
): Record<string, unknown> {
  return selectedFields(source.locator, [
    "kind",
    "canonicalUrl",
    "pageCount",
    "endpoint",
    "jsonPointer",
    "questionIds",
  ]);
}

export function compactResearchSource(
  source: ResearchSourceSnapshot,
): Record<string, unknown> {
  return {
    sourceKey: source.sourceKey,
    sourceType: source.sourceType,
    title: source.title,
    publisher: source.publisher,
    canonicalUrl: source.canonicalUrl,
    publishedAt: source.publishedAt,
    modifiedAt: source.modifiedAt ?? null,
    availableAt: source.availableAt ?? null,
    locator: compactLocator(source),
    content: compactContent(source),
  };
}

function compactQuestion(question: ResearchPlanQuestion): Record<string, unknown> {
  return {
    questionId: question.questionId,
    text: question.text,
    purpose: question.purpose,
    metrics: question.metrics,
    period: question.period,
    comparison: question.comparison,
    included: question.included,
    collectionTargets: question.collectionTargets,
    sourceBindingIds: question.sourceBindingIds,
  };
}

function compactExcelTarget(
  target: ResearchExcelTarget,
): Record<string, unknown> {
  return {
    targetId: target.targetId,
    metric: target.metric,
    period: target.period,
    unit: target.unit,
    scope: target.scope,
    valueKind: target.valueKind,
    required: target.required,
    included: target.included,
    sourcePolicy: target.sourcePolicy,
  };
}

export function buildResearchAgentInput(
  input: ResearchAgentPlanInput,
  sources: ResearchSourceSnapshot[],
): Record<string, unknown> {
  return {
    company: input.company,
    ticker: input.ticker,
    targetPeriod: input.targetPeriod,
    cutoffAt: input.cutoffAt,
    questions: input.questions
      .filter((question) => question.included)
      .map(compactQuestion),
    excelTargets: (input.excelTargets ?? [])
      .filter((target) => target.included)
      .map(compactExcelTarget),
    sources: sources.map(compactResearchSource),
    approvedPlanResourceVersionId: input.approvedPlanResourceVersionId,
  };
}
