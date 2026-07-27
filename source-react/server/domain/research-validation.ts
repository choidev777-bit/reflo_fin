import { isIP } from "node:net";
import Decimal from "decimal.js";
import { ApiError } from "../http/api-error";

export const RESEARCH_SOURCE_TYPES = [
  "DART",
  "COMPANY_IR",
  "NEWS",
  "KRX",
  "ECOS",
  "FNGUIDE_CONSENSUS",
  "USER_MATERIAL",
] as const;

export type ResearchSourceType = (typeof RESEARCH_SOURCE_TYPES)[number];
export type CollectionMethod = "code" | "research_agent" | "code_then_agent";
export type ExpectedResultType =
  | "number"
  | "table"
  | "statement"
  | "event"
  | "comparison";

export const NEWS_SEARCH_POLICY_VERSION = "news-policy-v1";

export type NewsSearchPolicy = {
  mode: "agent_web_search";
  publicationWindows: Array<{
    purpose: "current_period" | "historical_comparison";
    startAt: string;
    endAt: string;
  }>;
  subjectPeriods: string[];
  timezone: "Asia/Seoul";
  queryLimit: number;
  discoverLimit: number;
  fetchLimit: number;
  retainLimit: number;
  perPublisherLimit: number;
  languages: string[];
  providerCode: string;
  policyVersion: string;
};

export type ResearchPlanQuestion = {
  questionId: string;
  order: number;
  role: "PERFORMANCE" | "DRIVER" | "SEGMENT" | "OUTLOOK" | "VALUATION";
  text: string;
  purpose: string;
  metrics: string[];
  period: string;
  comparison: string;
  suggestedSourceTypes: ResearchSourceType[];
  included: boolean;
  collectionTargets: Array<{
    label: string;
    resultTypes: ExpectedResultType[];
  }>;
  sourceBindingIds: ResearchSourceType[];
  collectionMethods: Partial<Record<ResearchSourceType, CollectionMethod>>;
  verdictPolicy?: {
    version: "stance-balance-v1";
    positive: "supporting_without_contradiction";
    negative: "contradicting_without_support";
    neutral: "mixed_or_neutral";
    indeterminate: "missing_or_conflicting_required_metric";
  };
  newsSearchPolicy?: NewsSearchPolicy;
  /** role이 허용하는 출처. 화면은 이 목록만 선택지로 보여준다. */
  allowedSourceTypes?: ResearchSourceType[];
  validationErrors: string[];
};

export type ResearchExcelTarget = {
  targetId: string;
  sheetId: string;
  sheetName: string;
  address: string;
  metricId?: string;
  metric: string;
  period: string;
  periodSpec?: {
    type: "annual" | "quarter" | "date";
    year: number;
    quarter: 1 | 2 | 3 | 4 | null;
    basis: "annual" | "year_to_date" | "single_quarter" | "point_in_time";
  };
  unit: string;
  targetUnit?: "KRW" | "KRW_MILLION" | "KRW_100M" | "KRW_BILLION" | "PERCENT";
  scope: string;
  scopeCode?: "CFS" | "OFS";
  valueKind: "actual" | "preliminary_actual";
  dartRuleId?: string | null;
  writeAuthority?: "user" | "system";
  required: boolean;
  included: boolean;
  sourcePolicy: Array<{
    sourceType: ResearchSourceType;
    role: "authority" | "verification" | "comparison";
  }>;
  mappingSlotIds: string[];
  excludedReason: string | null;
};

export type ResearchSourceReference = {
  referenceId: string;
  sourceType: Extract<
    ResearchSourceType,
    "COMPANY_IR" | "NEWS" | "USER_MATERIAL"
  >;
  ingestionMethod: "user_upload" | "user_url";
  title: string;
  publisher: string;
  publishedAt: string | null;
  canonicalUrl: string | null;
  artifactId: string | null;
  originalFilename: string | null;
  mediaType: string | null;
  byteSize: number | null;
  sha256: string | null;
};

export type ResearchPlanSnapshot = {
  questions: ResearchPlanQuestion[];
  excelTargets: ResearchExcelTarget[];
  userUrls: string[];
  sourceReferences?: ResearchSourceReference[];
};

export type PlanValidationIssue = {
  code: string;
  targetId: string | null;
  category: "hypothesis" | "excel" | "material";
  message: string;
};

export type ResearchSourceSnapshot = {
  sourceKey: string;
  sourceType: ResearchSourceType;
  title: string;
  publisher: string;
  canonicalUrl: string | null;
  publishedAt: string | null;
  modifiedAt?: string | null;
  availableAt?: string | null;
  datePrecision?: "second" | "minute" | "day" | null;
  collectedAt: string;
  responseHash: string;
  locator: Record<string, unknown>;
  content: Record<string, unknown>;
  artifactObjectKey?: string | null;
  parserVersion?: string | null;
  eligibilityPolicyVersion?: string | null;
  collectorVersion: string;
};

export type NewsDiscoveryResult = {
  questionId: string;
  queryId: string;
  queryText: string;
  providerCode: string;
  providerResultId: string | null;
  resultRank: number;
  url: string;
  titleHint: string | null;
  publisherHint: string | null;
  publishedAtHint: string | null;
  publicationWindow: {
    startAt: string;
    endAt: string;
  };
  policyVersion: string;
};

export type ResearchCandidate = {
  candidateKey: string;
  category: "hypothesis";
  questionId: string;
  targetId: null;
  metricId: string;
  sourceKey: string;
  title: string;
  quoteExact: string;
  oneLineValue: string;
  valueOriginal: string | null;
  valueNormalized: string | null;
  unit: string | null;
  currency: string | null;
  period: string;
  scope: string;
  valueKind: string | null;
  stance: "supporting" | "contradicting" | "neutral";
  required: boolean;
  criticalNumeric: boolean;
  calculation?: ResearchNumericCalculation | null;
};

export type ResearchCalculationTerm = {
  sourceKey: string;
  quoteExact: string;
  valueOriginal: string;
  operation: "add" | "subtract";
  period: string;
  scope: string;
};

export type ResearchNumericCalculation = {
  kind: "yoy" | "qoq";
  currentTerms: ResearchCalculationTerm[];
  comparisonTerms: ResearchCalculationTerm[];
  reportedRateOriginal: string | null;
};

export type ValidationCheck = {
  code: string;
  status: "passed" | "failed";
  message: string;
};

export type ValidatedEvidence = ResearchCandidate & {
  machineStatus: "passed" | "failed" | "needs_review";
  checks: ValidationCheck[];
  locator: Record<string, unknown>;
};

export type ResearchClaimType =
  | "fact"
  | "company_statement"
  | "calculation"
  | "analysis_judgment"
  | "excluded";

export type ResearchClaimUsage =
  | "assertive"
  | "attribute_to_company"
  | "state_as_calculation"
  | "state_as_analysis"
  | "omit";

export function classifyResearchClaim(input: {
  candidate: Pick<
    ResearchCandidate,
    | "title"
    | "oneLineValue"
    | "quoteExact"
    | "period"
    | "valueKind"
    | "calculation"
  >;
  sourceType: ResearchSourceType;
  machineStatus: ValidatedEvidence["machineStatus"];
}): { claimType: ResearchClaimType; usage: ResearchClaimUsage } {
  if (input.machineStatus !== "passed") {
    return { claimType: "excluded", usage: "omit" };
  }
  if (
    input.candidate.calculation ||
    /calculated|calculation|computed|derived|계산|산출/i.test(
      input.candidate.valueKind ?? "",
    )
  ) {
    return { claimType: "calculation", usage: "state_as_calculation" };
  }
  const text = [
    input.candidate.title,
    input.candidate.oneLineValue,
    input.candidate.quoteExact,
    input.candidate.period,
  ].join(" ");
  if (
    input.sourceType === "COMPANY_IR" &&
    /전망|예상|계획|목표|가이던스|지속될|이어질|확대할|추진|forecast|outlook|guidance|plan|expect/i.test(
      text,
    )
  ) {
    return {
      claimType: "company_statement",
      usage: "attribute_to_company",
    };
  }
  return { claimType: "fact", usage: "assertive" };
}

export type EvidenceValidationContext = {
  question?: ResearchPlanQuestion;
  companyName?: string;
  ticker?: string;
  corpCode?: string | null;
  sources?: ResearchSourceSnapshot[];
};

export function canonicalResearchNumericValue(
  value: string | null | undefined,
): string | null {
  const normalized = value?.trim() ?? "";
  if (!/^-?\d+(?:\.\d+)?$/.test(normalized)) return null;
  return new Decimal(normalized).toFixed();
}

function normalizedComparableNumber(value: unknown): string | null {
  const normalized = String(value ?? "")
    .replaceAll(",", "")
    .replace(/[^\d.+-]/g, "")
    .replace(/^\+/, "");
  return /^-?\d+(?:\.\d+)?$/.test(normalized) ? normalized : null;
}

function selectedRecordField(
  record: Record<string, unknown>,
  candidate: ResearchCandidate,
): string | null {
  const exact = Object.entries(record).filter(
    ([, value]) => String(value ?? "") === candidate.quoteExact,
  );
  if (exact.length === 1) return exact[0]![0];
  const expectedNumber =
    normalizedComparableNumber(candidate.valueOriginal) ??
    normalizedComparableNumber(candidate.quoteExact);
  if (!expectedNumber) return null;
  const numeric = Object.entries(record).filter(
    ([, value]) => normalizedComparableNumber(value) === expectedNumber,
  );
  return numeric.length === 1 ? numeric[0]![0] : null;
}

function resolvedEvidenceLocator(
  candidate: ResearchCandidate,
  source: ResearchSourceSnapshot,
  matchedPage?: { pageNumber?: number; text: string },
): Record<string, unknown> | null {
  if (source.locator.kind === "pdf") {
    return matchedPage
      ? {
          ...source.locator,
          ...(matchedPage.pageNumber
            ? { pageNumber: matchedPage.pageNumber }
            : {}),
          textFragment: candidate.quoteExact,
        }
      : null;
  }
  if (source.sourceType === "NEWS" || source.locator.kind === "html") {
    const body =
      typeof source.content.body === "string" ? source.content.body : "";
    const characterOffset = body.indexOf(candidate.quoteExact);
    return {
      ...source.locator,
      textFragment: candidate.quoteExact,
      ...(characterOffset >= 0
        ? {
            characterOffset,
            quotePrefix: body.slice(
              Math.max(0, characterOffset - 80),
              characterOffset,
            ),
            quoteSuffix: body.slice(
              characterOffset + candidate.quoteExact.length,
              characterOffset + candidate.quoteExact.length + 80,
            ),
          }
        : {}),
    };
  }
  if (source.sourceType === "DART") {
    const rows = Array.isArray(source.content.rows)
      ? source.content.rows.filter(
          (row): row is Record<string, unknown> =>
            Boolean(row) && typeof row === "object" && !Array.isArray(row),
        )
      : [];
    const matching = rows
      .map((row) => ({ row, selectedField: selectedRecordField(row, candidate) }))
      .filter(
        (
          item,
        ): item is { row: Record<string, unknown>; selectedField: string } =>
          item.selectedField !== null,
      );
    if (matching.length !== 1) return null;
    const { row, selectedField } = matching[0]!;
    const report =
      source.content.report &&
      typeof source.content.report === "object" &&
      !Array.isArray(source.content.report)
        ? (source.content.report as Record<string, unknown>)
        : {};
    const selectedLabelField = selectedField.replace(/_amount$/, "_nm");
    return {
      ...source.locator,
      kind: "dart_financial_statement",
      corpCode: report.corpCode,
      businessYear: report.businessYear,
      quarter: report.quarter,
      reportCode: report.reportCode,
      receiptNumber: report.receiptNumber,
      publishedAt: report.publishedAt,
      fsDiv: row.fs_div,
      statementCode: row.sj_div,
      statementName: row.sj_nm,
      accountId: row.account_id,
      accountName: row.account_nm,
      selectedField,
      selectedColumnLabel: row[selectedLabelField] ?? selectedField,
      rawValue: row[selectedField],
    };
  }
  if (source.locator.kind === "structured_api") {
    const latest =
      source.content.latest &&
      typeof source.content.latest === "object" &&
      !Array.isArray(source.content.latest)
        ? (source.content.latest as Record<string, unknown>)
        : source.content;
    const selectedField = selectedRecordField(latest, candidate);
    return selectedField
      ? {
          ...source.locator,
          selectedField,
        }
      : null;
  }
  return typeof source.locator.kind === "string" &&
    Object.keys(source.locator).length > 1
    ? source.locator
    : null;
}

function sourcePeriodMatches(
  candidate: ResearchCandidate,
  source: ResearchSourceSnapshot,
  locator: Record<string, unknown> | null,
): boolean {
  if (
    source.sourceType !== "DART" ||
    locator?.kind !== "dart_financial_statement"
  ) {
    return true;
  }
  const businessYear = Number(locator.businessYear);
  const quarter = Number(locator.quarter);
  const selectedField = String(locator.selectedField ?? "");
  const selectedBusinessYear =
    selectedField.startsWith("bfefrmtrm_")
      ? businessYear - 2
      : selectedField.startsWith("frmtrm_")
        ? businessYear - 1
        : businessYear;
  const candidateYears: string[] =
    candidate.period.match(/20\d{2}/g) ?? [];
  const candidateQuarters = Array.from(
    candidate.period.matchAll(/([1-4])\s*(?:분기|q)/gi),
    (match) => Number(match[1]),
  );
  return (
    Number.isInteger(selectedBusinessYear) &&
    candidateYears.includes(String(selectedBusinessYear)) &&
    (candidateQuarters.length > 0
      ? candidateQuarters.includes(quarter)
      : /상반기|반기/.test(candidate.period)
        ? quarter === 2
        : /연간|사업\s*연도/.test(candidate.period)
          ? quarter === 4
          : false)
  );
}

function sourceScopeMatches(
  candidate: ResearchCandidate,
  source: ResearchSourceSnapshot,
  locator: Record<string, unknown> | null,
): boolean {
  if (
    source.sourceType !== "DART" ||
    locator?.kind !== "dart_financial_statement"
  ) {
    return candidate.scope.trim().length > 0;
  }
  const expected = /별도|^OFS$/i.test(candidate.scope)
    ? "OFS"
    : /연결|^CFS$/i.test(candidate.scope)
      ? "CFS"
      : null;
  return expected !== null && locator.fsDiv === expected;
}

export type DeterministicExcelEvidence = {
  sourceKey: string;
  quoteExact: string;
  locator: Record<string, unknown>;
  valueOriginal: string;
  valueNormalized: string;
  unit: string;
  currency: string | null;
  period: string;
  scope: string;
  valueKind: string;
  checks: ValidationCheck[];
};

export type DeterministicExcelResult = {
  targetId: string;
  metricId: string;
  title: string;
  oneLineValue: string;
  valueOriginal: string | null;
  valueNormalized: string | null;
  unit: string | null;
  currency: string | null;
  period: string;
  scope: string;
  valueKind: string;
  required: boolean;
  machineStatus: "passed" | "failed" | "needs_review";
  statusCode:
    | "validated"
    | "report_unavailable"
    | "account_not_found"
    | "account_ambiguous"
    | "period_mismatch"
    | "scope_mismatch"
    | "unit_unknown"
    | "formula_cell"
    | "workbook_changed"
    | "manual_review";
  evidence: DeterministicExcelEvidence[];
  checks: ValidationCheck[];
};

export type SufficiencyInput = {
  requiredMetrics: string[];
  coveredMetrics: string[];
  evidenceCount: number;
  sourceCount: number;
  criticalNumericFailed: boolean;
  unresolvedConflict: boolean;
  stale: boolean;
  rejectedRequired: boolean;
  reinvestigating: boolean;
};

export type QuestionSufficiency =
  | "sufficient"
  | "qualified"
  | "insufficient"
  | "reinvestigating";

const sourceTypeMap: Record<string, ResearchSourceType[]> = {
  filing: ["DART"],
  company: ["COMPANY_IR"],
  news: ["NEWS"],
  industry: ["USER_MATERIAL"],
  market_data: ["KRX", "FNGUIDE_CONSENSUS"],
};

export function suggestedResearchSources(values: string[]): ResearchSourceType[] {
  const result = values.flatMap((value) => sourceTypeMap[value] ?? []);
  return Array.from(new Set(result.length > 0 ? result : ["DART"]));
}

export type ResearchQuestionRole =
  | "PERFORMANCE"
  | "DRIVER"
  | "SEGMENT"
  | "OUTLOOK"
  | "VALUATION";

// 질문 role별로 선택 가능한 출처를 제한한다.
//
// NEWS를 실적·밸류에이션 질문에서 빼는 이유: 확정 실적 수치의 권위 출처는 DART고,
// 주가·컨센서스는 KRX/FnGuide다. 같은 숫자를 옮겨 적은 기사는 2차 인용이라
// 근거로서 열등하고, 답이 이미 있는 질문에 뉴스 검색을 돌리면 비용과 실패면적만
// 늘어난다. 뉴스는 공시에 나오지 않는 원인·사업부·전망 질문에서만 쓴다.
const ALLOWED_SOURCES_BY_ROLE: Record<
  ResearchQuestionRole,
  ResearchSourceType[]
> = {
  PERFORMANCE: ["DART", "COMPANY_IR", "FNGUIDE_CONSENSUS", "USER_MATERIAL"],
  VALUATION: ["KRX", "DART", "FNGUIDE_CONSENSUS", "COMPANY_IR", "ECOS"],
  DRIVER: ["COMPANY_IR", "NEWS", "DART", "USER_MATERIAL"],
  SEGMENT: ["COMPANY_IR", "NEWS", "DART", "USER_MATERIAL"],
  OUTLOOK: ["COMPANY_IR", "NEWS", "DART", "USER_MATERIAL", "ECOS"],
};

export function allowedResearchSources(
  role: ResearchQuestionRole,
): ResearchSourceType[] {
  return ALLOWED_SOURCES_BY_ROLE[role] ?? ["DART", "COMPANY_IR"];
}

/** role이 허용하지 않는 출처를 제거한다. 최소 1개는 남긴다. */
export function restrictSourcesToRole(
  role: ResearchQuestionRole,
  sources: ResearchSourceType[],
): ResearchSourceType[] {
  const allowed = allowedResearchSources(role);
  const kept = sources.filter((source) => allowed.includes(source));
  return kept.length > 0 ? kept : [allowed[0]!];
}

export function usesNewsSource(
  role: ResearchQuestionRole,
): boolean {
  return allowedResearchSources(role).includes("NEWS");
}

export function defaultCollectionMethod(
  sourceType: ResearchSourceType,
): CollectionMethod {
  if (["KRX", "ECOS", "FNGUIDE_CONSENSUS"].includes(sourceType)) return "code";
  if (sourceType === "DART") return "code_then_agent";
  return "research_agent";
}

export function deriveNewsSearchPolicy(input: {
  targetYear: number;
  targetQuarter: number;
  cutoffAt: string;
  subjectPeriods: string[];
  providerCode?: string;
}): NewsSearchPolicy {
  const quarter = Math.min(4, Math.max(1, Math.trunc(input.targetQuarter)));
  const quarterStart = new Date(
    Date.UTC(input.targetYear, (quarter - 1) * 3, 1),
  );
  quarterStart.setUTCDate(quarterStart.getUTCDate() - 30);
  return {
    mode: "agent_web_search",
    publicationWindows: [
      {
        purpose: "current_period",
        startAt: `${quarterStart.toISOString().slice(0, 10)}T00:00:00+09:00`,
        endAt: input.cutoffAt,
      },
    ],
    subjectPeriods: Array.from(
      new Set(input.subjectPeriods.map((period) => period.trim()).filter(Boolean)),
    ),
    timezone: "Asia/Seoul",
    queryLimit: 4,
    discoverLimit: 20,
    fetchLimit: 10,
    retainLimit: 8,
    perPublisherLimit: 2,
    languages: ["ko", "en"],
    providerCode: input.providerCode ?? "openai_web_search",
    policyVersion: NEWS_SEARCH_POLICY_VERSION,
  };
}

const NEWS_WINDOW_MAX_DAYS = 240;

function isDateOnly(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

/**
 * Converts the KST date-only range a user picks into the offset-qualified
 * instants the news policy stores. The end instant is the KST end of day so a
 * user may select the report cutoff date itself: `${date}T23:59:59.999+09:00`
 * parses to the same instant as the stored `cutoffAt`.
 */
export function normalizeNewsWindowInput(input: {
  startDate: unknown;
  endDate: unknown;
  cutoffAt: string;
}): { startAt: string; endAt: string } {
  if (!isDateOnly(input.startDate) || !isDateOnly(input.endDate)) {
    throw new ApiError(
      422,
      "NEWS_SEARCH_WINDOW_INVALID",
      "뉴스 검색 기간은 시작일과 종료일을 날짜로 입력해주세요.",
    );
  }
  const startAt = `${input.startDate}T00:00:00.000+09:00`;
  const endAt = `${input.endDate}T23:59:59.999+09:00`;
  const start = Date.parse(startAt);
  const end = Date.parse(endAt);
  const cutoff = Date.parse(input.cutoffAt);
  if (start > end) {
    throw new ApiError(
      422,
      "NEWS_SEARCH_WINDOW_INVALID",
      "뉴스 검색 종료일은 시작일과 같거나 뒤여야 합니다.",
    );
  }
  if (Number.isFinite(cutoff) && end > cutoff) {
    throw new ApiError(
      422,
      "NEWS_SEARCH_WINDOW_INVALID",
      "뉴스 검색 기간은 보고서 기준일까지만 설정할 수 있습니다.",
    );
  }
  if (end - start > NEWS_WINDOW_MAX_DAYS * 24 * 60 * 60 * 1_000) {
    throw new ApiError(
      422,
      "NEWS_SEARCH_WINDOW_INVALID",
      `뉴스 검색 기간은 최대 ${NEWS_WINDOW_MAX_DAYS}일까지 설정할 수 있습니다.`,
    );
  }
  return { startAt, endAt };
}

export function attachNewsSearchPolicies(
  snapshot: ResearchPlanSnapshot,
  input: {
    targetYear: number;
    targetQuarter: number;
    cutoffAt: string;
    providerCode?: string;
  },
): ResearchPlanSnapshot {
  return {
    ...snapshot,
    questions: snapshot.questions.map((rawQuestion) => {
      const allowedSourceTypes = allowedResearchSources(rawQuestion.role);
      // 저장된 snapshot에도 role 정책을 적용한다. 정책 도입 전에 만들어진 계획이
      // 허용되지 않는 출처를 들고 있으면, 화면에서 선택지에는 없는데 선택된 상태로
      // 남아 해제할 수 없게 된다.
      const sourceBindingIds = restrictSourcesToRole(
        rawQuestion.role,
        rawQuestion.sourceBindingIds,
      );
      const collectionMethods = Object.fromEntries(
        Object.entries(rawQuestion.collectionMethods).filter(([source]) =>
          sourceBindingIds.includes(source as ResearchSourceType),
        ),
      ) as ResearchPlanQuestion["collectionMethods"];
      const question = {
        ...rawQuestion,
        sourceBindingIds,
        collectionMethods,
      };
      if (!question.sourceBindingIds.includes("NEWS")) {
        return { ...question, allowedSourceTypes, newsSearchPolicy: undefined };
      }
      return {
        ...question,
        allowedSourceTypes,
        newsSearchPolicy:
          question.newsSearchPolicy ??
          deriveNewsSearchPolicy({
            ...input,
            subjectPeriods: [question.period],
          }),
      };
    }),
  };
}

function newsSearchPolicyIssue(
  policy: NewsSearchPolicy | undefined,
  cutoffAt: string | undefined,
): string | null {
  if (!policy) return "뉴스 자동 검색 기간을 다시 확인해주세요.";
  if (
    policy.mode !== "agent_web_search" ||
    policy.timezone !== "Asia/Seoul" ||
    policy.policyVersion !== NEWS_SEARCH_POLICY_VERSION ||
    policy.providerCode !== "openai_web_search" ||
    policy.publicationWindows.length < 1 ||
    policy.publicationWindows.length > 2 ||
    policy.subjectPeriods.length < 1 ||
    policy.queryLimit < 2 ||
    policy.queryLimit > 4 ||
    policy.discoverLimit < 1 ||
    policy.discoverLimit > 20 ||
    policy.fetchLimit < 1 ||
    policy.fetchLimit > 10 ||
    policy.retainLimit < 1 ||
    policy.retainLimit > 8 ||
    policy.perPublisherLimit < 1 ||
    policy.perPublisherLimit > 2
  ) {
    return "뉴스 자동 검색 정책이 허용 범위를 벗어났습니다.";
  }
  const cutoff = cutoffAt ? Date.parse(cutoffAt) : Number.POSITIVE_INFINITY;
  for (const window of policy.publicationWindows) {
    const start = Date.parse(window.startAt);
    const end = Date.parse(window.endAt);
    if (
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      start > end ||
      end > cutoff ||
      end - start > NEWS_WINDOW_MAX_DAYS * 24 * 60 * 60 * 1_000
    ) {
      return `뉴스 검색 기간은 기준일 이전 ${NEWS_WINDOW_MAX_DAYS}일 안으로 설정해야 합니다.`;
    }
  }
  return null;
}

function isPrivateIpv4(value: string): boolean {
  const octets = value.split(".").map(Number);
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part))) {
    return true;
  }
  return (
    octets[0] === 0 ||
    octets[0] === 10 ||
    octets[0] === 127 ||
    (octets[0] === 169 && octets[1] === 254) ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168) ||
    octets[0] >= 224
  );
}

function isPrivateIpv6(value: string): boolean {
  const normalized = value.toLowerCase();
  return (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe8") ||
    normalized.startsWith("fe9") ||
    normalized.startsWith("fea") ||
    normalized.startsWith("feb")
  );
}

export function normalizePublicResearchUrl(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ApiError(422, "SOURCE_URL_INVALID", "공개 자료 URL을 확인해주세요.");
  }
  if (value.length > 2_048 || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new ApiError(422, "SOURCE_URL_INVALID", "URL은 2,048자 이하여야 합니다.");
  }
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new ApiError(422, "SOURCE_URL_INVALID", "올바른 공개 URL을 입력해주세요.");
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new ApiError(422, "SOURCE_URL_INVALID", "http 또는 https URL만 사용할 수 있습니다.");
  }
  if (url.username || url.password) {
    throw new ApiError(
      422,
      "SOURCE_URL_CREDENTIAL_FORBIDDEN",
      "인증 정보가 포함된 URL은 사용할 수 없습니다.",
    );
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (
    !hostname ||
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "metadata.google.internal"
  ) {
    throw new ApiError(
      422,
      "SOURCE_URL_PRIVATE_NETWORK",
      "공개 인터넷에서 접근 가능한 URL만 사용할 수 있습니다.",
    );
  }
  const ipVersion = isIP(hostname);
  if (
    (ipVersion === 4 && isPrivateIpv4(hostname)) ||
    (ipVersion === 6 && isPrivateIpv6(hostname))
  ) {
    throw new ApiError(
      422,
      "SOURCE_URL_PRIVATE_NETWORK",
      "사설·로컬 네트워크 URL은 사용할 수 없습니다.",
    );
  }
  url.hash = "";
  return url.toString();
}

export function normalizePublicResearchUrls(values: unknown): string[] {
  if (!Array.isArray(values)) {
    throw new ApiError(422, "SOURCE_URL_INVALID", "URL 목록을 확인해주세요.");
  }
  if (values.length > 20) {
    throw new ApiError(422, "SOURCE_URL_LIMIT_EXCEEDED", "URL은 최대 20개까지 등록할 수 있습니다.");
  }
  return Array.from(new Set(values.map(normalizePublicResearchUrl)));
}

export function validateResearchPlan(
  snapshot: ResearchPlanSnapshot,
  cutoffAt?: string,
): PlanValidationIssue[] {
  const issues: PlanValidationIssue[] = [];
  const references = snapshot.sourceReferences ?? [];
  const includedQuestions = snapshot.questions.filter((question) => question.included);
  if (includedQuestions.length < 3 || includedQuestions.length > 7) {
    issues.push({
      code: "QUESTION_COUNT_INVALID",
      targetId: null,
      category: "hypothesis",
      message: "자료를 수집할 질문은 3개 이상 7개 이하여야 합니다.",
    });
  }
  for (const question of includedQuestions) {
    if (question.sourceBindingIds.length === 0) {
      issues.push({
        code: "QUESTION_SOURCE_REQUIRED",
        targetId: question.questionId,
        category: "hypothesis",
        message: "포함한 질문에는 출처가 하나 이상 필요합니다.",
      });
    }
    if (
      !question.purpose ||
      question.metrics.length === 0 ||
      !question.period ||
      !question.comparison ||
      question.collectionTargets.length === 0
    ) {
      issues.push({
        code: "QUESTION_METADATA_INCOMPLETE",
        targetId: question.questionId,
        category: "hypothesis",
        message: "질문의 목적·지표·기간·비교 기준을 확인해주세요.",
      });
    }
    if (
      !question.verdictPolicy ||
      question.verdictPolicy.version !== "stance-balance-v1" ||
      question.verdictPolicy.positive !==
        "supporting_without_contradiction" ||
      question.verdictPolicy.negative !==
        "contradicting_without_support" ||
      question.verdictPolicy.neutral !== "mixed_or_neutral" ||
      question.verdictPolicy.indeterminate !==
        "missing_or_conflicting_required_metric"
    ) {
      issues.push({
        code: "QUESTION_VERDICT_POLICY_INVALID",
        targetId: question.questionId,
        category: "hypothesis",
        message: "질문의 긍정·중립·부정·판단 불가 판정 규칙을 확인해주세요.",
      });
    }
    for (const sourceType of question.sourceBindingIds) {
      if (!RESEARCH_SOURCE_TYPES.includes(sourceType)) {
        issues.push({
          code: "QUESTION_SOURCE_INVALID",
          targetId: question.questionId,
          category: "hypothesis",
          message: "지원하지 않는 출처가 포함되어 있습니다.",
        });
      }
      if (!question.collectionMethods[sourceType]) {
        issues.push({
          code: "COLLECTION_METHOD_REQUIRED",
          targetId: question.questionId,
          category: "hypothesis",
          message: "출처별 수집 방식을 확인해주세요.",
        });
      }
      if (sourceType === "NEWS") {
        const policyIssue = newsSearchPolicyIssue(
          question.newsSearchPolicy,
          cutoffAt,
        );
        if (policyIssue) {
          issues.push({
            code: "NEWS_SEARCH_POLICY_INVALID",
            targetId: question.questionId,
            category: "material",
            message: policyIssue,
          });
        }
      }
    }
  }
  const excelTargetIds = new Set<string>();
  const excelDestinations = new Set<string>();
  for (const target of snapshot.excelTargets) {
    const destination = `${target.sheetId}:${target.address.toUpperCase()}`;
    if (excelTargetIds.has(target.targetId)) {
      issues.push({
        code: "EXCEL_TARGET_DUPLICATE",
        targetId: target.targetId,
        category: "excel",
        message: "같은 Excel targetId가 중복되었습니다.",
      });
    }
    excelTargetIds.add(target.targetId);
    if (target.included && excelDestinations.has(destination)) {
      issues.push({
        code: "EXCEL_DESTINATION_DUPLICATE",
        targetId: target.targetId,
        category: "excel",
        message: "하나의 Excel 셀에 둘 이상의 수집 대상을 연결할 수 없습니다.",
      });
    }
    if (target.included) excelDestinations.add(destination);
    const authorities = target.sourcePolicy.filter(
      (policy) => policy.role === "authority",
    );
    if (target.included && authorities.length !== 1) {
      issues.push({
        code: "EXCEL_AUTHORITY_REQUIRED",
        targetId: target.targetId,
        category: "excel",
        message: "Excel 입력 대상은 권위 출처를 정확히 하나 가져야 합니다.",
      });
    }
    if (target.required && !target.included) {
      issues.push({
        code: "REQUIRED_EXCEL_TARGET_EXCLUDED",
        targetId: target.targetId,
        category: "excel",
        message: "필수 Excel 실제값은 수집 대상에서 제외할 수 없습니다.",
      });
    }
    if (
      target.included &&
      (!target.metric || !target.period || !target.unit || !target.scope)
    ) {
      issues.push({
        code: "EXCEL_TARGET_METADATA_INCOMPLETE",
        targetId: target.targetId,
        category: "excel",
        message: "Excel 대상의 지표·기간·단위·연결 기준을 확인해주세요.",
      });
    }
    if (
      target.sourcePolicy.some(
        (policy) =>
          policy.sourceType === "FNGUIDE_CONSENSUS" &&
          policy.role === "authority",
      )
    ) {
      issues.push({
        code: "FNGUIDE_AUTHORITY_FORBIDDEN",
        targetId: target.targetId,
        category: "excel",
        message: "FnGuide 컨센서스는 실제값 권위 출처로 사용할 수 없습니다.",
      });
    }
    if (
      target.sourcePolicy.some(
        (policy) =>
          policy.sourceType === "NEWS" && policy.role === "authority",
      )
    ) {
      issues.push({
        code: "NEWS_AUTHORITY_FORBIDDEN",
        targetId: target.targetId,
        category: "excel",
        message: "뉴스는 Excel 실제값의 권위 출처로 사용할 수 없습니다.",
      });
    }
  }
  if (snapshot.userUrls.length > 20) {
    issues.push({
      code: "SOURCE_URL_LIMIT_EXCEEDED",
      targetId: null,
      category: "material",
      message: "URL은 최대 20개까지 등록할 수 있습니다.",
    });
  }
  const selectedManualTypes = new Set<ResearchSourceReference["sourceType"]>();
  for (const question of includedQuestions) {
    for (const sourceType of question.sourceBindingIds) {
      if (
        sourceType === "COMPANY_IR" ||
        sourceType === "USER_MATERIAL"
      ) {
        selectedManualTypes.add(sourceType);
      }
    }
  }
  for (const target of snapshot.excelTargets.filter((item) => item.included)) {
    for (const policy of target.sourcePolicy) {
      if (
        policy.sourceType === "COMPANY_IR" ||
        policy.sourceType === "USER_MATERIAL"
      ) {
        selectedManualTypes.add(policy.sourceType);
      }
    }
    const dartAuthority = target.sourcePolicy.some(
      (policy) =>
        policy.sourceType === "DART" && policy.role === "authority",
    );
    const krxAuthority = target.sourcePolicy.some(
      (policy) =>
        policy.sourceType === "KRX" && policy.role === "authority",
    );
    const ecosAuthority = target.sourcePolicy.some(
      (policy) =>
        policy.sourceType === "ECOS" && policy.role === "authority",
    );
    if (
      dartAuthority &&
      (!target.metricId ||
        !target.periodSpec ||
        !target.scopeCode ||
        !target.targetUnit ||
        !target.dartRuleId)
    ) {
      issues.push({
        code: "EXCEL_TARGET_RULE_INCOMPLETE",
        targetId: target.targetId,
        category: "excel",
        message:
          "DART Excel 대상의 지표·기간·범위·단위·계정 규칙을 확인해주세요.",
      });
    }
    if (
      krxAuthority &&
      (target.metricId !== "current_price" ||
        target.periodSpec?.type !== "date" ||
        target.periodSpec.basis !== "point_in_time" ||
        target.targetUnit !== "KRW")
    ) {
      issues.push({
        code: "KRX_TARGET_RULE_INCOMPLETE",
        targetId: target.targetId,
        category: "excel",
        message: "KRX 대상은 기준일 종가·날짜·원 단위 규칙이 필요합니다.",
      });
    }
    if (
      ecosAuthority &&
      (![
        "usd_krw",
        "usd_krw_exchange_rate",
        "exchange_rate_usd_krw",
      ].includes(target.metricId ?? "") ||
        target.periodSpec?.type !== "date" ||
        target.periodSpec.basis !== "point_in_time")
    ) {
      issues.push({
        code: "ECOS_TARGET_RULE_INCOMPLETE",
        targetId: target.targetId,
        category: "excel",
        message: "ECOS 대상은 등록된 통계 지표와 기준일 규칙이 필요합니다.",
      });
    }
  }
  for (const sourceType of selectedManualTypes) {
    if (!references.some((reference) => reference.sourceType === sourceType)) {
      issues.push({
        code: "SOURCE_MATERIAL_REQUIRED",
        targetId: sourceType,
        category: "material",
        message:
          sourceType === "COMPANY_IR"
            ? "기업 IR 출처를 사용하려면 공식 PDF를 올리거나 공식 IR URL을 입력해주세요."
            : "사용자 자료 출처를 사용하려면 PDF를 올리거나 공개 원문 URL을 입력해주세요.",
      });
    }
  }
  return issues;
}

export function calculateQuestionSufficiency(
  input: SufficiencyInput,
): QuestionSufficiency {
  if (input.reinvestigating) return "reinvestigating";
  if (
    input.evidenceCount === 0 ||
    input.criticalNumericFailed ||
    input.unresolvedConflict ||
    input.stale ||
    input.rejectedRequired
  ) {
    return "insufficient";
  }
  return "sufficient";
}

type NumericCalculationValidation = {
  checks: ValidationCheck[];
  locator: Record<string, unknown> | null;
  inputBound: boolean;
};

function researchComparisonKind(
  question: ResearchPlanQuestion | undefined,
): ResearchNumericCalculation["kind"] | null {
  if (!question) return null;
  if (/전년|yoy|year[- ]over[- ]year/i.test(question.comparison)) return "yoy";
  if (/전분기|qoq|quarter[- ]over[- ]quarter/i.test(question.comparison)) {
    return "qoq";
  }
  return null;
}

function isGrowthRateCandidate(candidate: ResearchCandidate): boolean {
  return /(?:growth|change[_ -]?rate|yoy|qoq|증감률|성장률|증가율|감소율|변화율)/i.test(
    [
      candidate.metricId,
      candidate.title,
      candidate.oneLineValue,
      candidate.valueKind ?? "",
    ].join(" "),
  );
}

function strictResearchDecimal(value: string): Decimal | null {
  const normalized = value
    .trim()
    .replaceAll(",", "")
    .replaceAll(/\s+/g, "")
    .replace(/%$/, "")
    .replace(/^\+/, "");
  return /^-?\d+(?:\.\d+)?$/.test(normalized)
    ? new Decimal(normalized)
    : null;
}

function quoteContainsResearchDecimal(quote: string, value: string): boolean {
  const expected = strictResearchDecimal(value);
  if (!expected) return false;
  const tokens =
    quote.match(/[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?/g) ?? [];
  return tokens.some((token) => {
    const parsed = strictResearchDecimal(token);
    return parsed ? parsed.equals(expected) : false;
  });
}

function sourceMatchesResearchIdentity(
  source: ResearchSourceSnapshot,
  context: EvidenceValidationContext,
): boolean {
  const sourceText = [
    source.title,
    source.publisher,
    source.canonicalUrl ?? "",
    JSON.stringify(source.content),
  ].join("\n");
  const parameters =
    source.locator.parameters &&
    typeof source.locator.parameters === "object" &&
    !Array.isArray(source.locator.parameters)
      ? (source.locator.parameters as Record<string, unknown>)
      : null;
  const report =
    source.content.report &&
    typeof source.content.report === "object" &&
    !Array.isArray(source.content.report)
      ? (source.content.report as Record<string, unknown>)
      : null;
  const companyMatches =
    source.sourceType === "ECOS" ||
    !context.companyName ||
    sourceText.includes(context.companyName) ||
    (typeof context.ticker === "string" &&
      (sourceText.includes(context.ticker) ||
        parameters?.ticker === context.ticker));
  const corpCodeMatches =
    !context.corpCode ||
    source.sourceType !== "DART" ||
    report?.corpCode === context.corpCode;
  return companyMatches && corpCodeMatches;
}

function calculationTermLocator(
  term: ResearchCalculationTerm,
  candidate: ResearchCandidate,
  source: ResearchSourceSnapshot,
): Record<string, unknown> | null {
  const pages = Array.isArray(source.content.pages)
    ? source.content.pages.filter(
        (page): page is { pageNumber?: number; text: string } =>
          Boolean(page) &&
          typeof page === "object" &&
          typeof (page as { text?: unknown }).text === "string",
      )
    : [];
  const matchedPage = pages.find((page) => page.text.includes(term.quoteExact));
  return resolvedEvidenceLocator(
    {
      ...candidate,
      sourceKey: term.sourceKey,
      quoteExact: term.quoteExact,
      valueOriginal: term.valueOriginal,
      period: term.period,
      scope: term.scope,
      calculation: null,
    },
    source,
    matchedPage,
  );
}

function validateNumericCalculation(
  candidate: ResearchCandidate,
  cutoffAt: string,
  context: EvidenceValidationContext,
): NumericCalculationValidation {
  const expectedKind = researchComparisonKind(context.question);
  const required =
    candidate.criticalNumeric &&
    expectedKind !== null &&
    isGrowthRateCandidate(candidate);
  const calculation = candidate.calculation;
  if (!calculation) {
    return {
      checks: required
        ? [
            {
              code: "numeric_calculation_inputs",
              status: "failed",
              message:
                "증감률의 현재값·비교값과 정확한 원문 위치가 필요합니다.",
            },
          ]
        : [],
      locator: null,
      inputBound: false,
    };
  }

  const allSources = context.sources ?? [];
  const sourceByKey = new Map(
    allSources.map((source) => [source.sourceKey, source]),
  );
  const termGroups = [
    ["current", calculation.currentTerms] as const,
    ["comparison", calculation.comparisonTerms] as const,
  ];
  const locatedTerms: Array<Record<string, unknown>> = [];
  let inputsValid =
    expectedKind !== null &&
    calculation.kind === expectedKind &&
    calculation.currentTerms.length > 0 &&
    calculation.comparisonTerms.length > 0;
  const sums = {
    current: new Decimal(0),
    comparison: new Decimal(0),
  };

  for (const [role, terms] of termGroups) {
    for (const term of terms) {
      const termSource = sourceByKey.get(term.sourceKey);
      const value = strictResearchDecimal(term.valueOriginal);
      const sourceText = termSource ? JSON.stringify(termSource.content) : "";
      const locator = termSource
        ? calculationTermLocator(term, candidate, termSource)
        : null;
      const cutoffValid =
        Boolean(termSource) &&
        (!(termSource!.availableAt ?? termSource!.publishedAt) ||
          new Date(
            termSource!.availableAt ?? termSource!.publishedAt!,
          ).getTime() <= new Date(cutoffAt).getTime());
      const questionIds = Array.isArray(termSource?.locator.questionIds)
        ? termSource.locator.questionIds.filter(
            (value): value is string => typeof value === "string",
          )
        : [];
      const questionBound =
        !context.question ||
        Boolean(
          termSource &&
            context.question.sourceBindingIds.includes(termSource.sourceType) &&
            questionIds.includes(context.question.questionId),
        );
      const periodAndScopeValid =
        Boolean(termSource && locator) &&
        sourcePeriodMatches(
          {
            ...candidate,
            sourceKey: term.sourceKey,
            quoteExact: term.quoteExact,
            valueOriginal: term.valueOriginal,
            period: term.period,
            scope: term.scope,
            calculation: null,
          },
          termSource!,
          locator,
        ) &&
        sourceScopeMatches(
          {
            ...candidate,
            sourceKey: term.sourceKey,
            quoteExact: term.quoteExact,
            valueOriginal: term.valueOriginal,
            period: term.period,
            scope: term.scope,
            calculation: null,
          },
          termSource!,
          locator,
        );
      const termValid =
        Boolean(value) &&
        sourceText.includes(term.quoteExact) &&
        quoteContainsResearchDecimal(term.quoteExact, term.valueOriginal) &&
        Boolean(locator) &&
        cutoffValid &&
        Boolean(termSource && sourceMatchesResearchIdentity(termSource, context)) &&
        questionBound &&
        periodAndScopeValid;
      inputsValid &&= termValid;
      if (value) {
        sums[role] = sums[role].plus(
          term.operation === "subtract" ? value.negated() : value,
        );
      }
      locatedTerms.push({
        role,
        sourceKey: term.sourceKey,
        operation: term.operation,
        period: term.period,
        scope: term.scope,
        valueOriginal: term.valueOriginal,
        quoteExact: term.quoteExact,
        locator,
        valid: termValid,
      });
    }
  }

  const normalizedRate = strictResearchDecimal(
    candidate.valueNormalized ?? "",
  );
  const denominatorValid = !sums.comparison.isZero();
  const computedRate =
    inputsValid && denominatorValid
      ? sums.current
          .minus(sums.comparison)
          .dividedBy(sums.comparison)
          .times(100)
      : null;
  const tolerance = new Decimal("0.1");
  const formulaMatches =
    Boolean(computedRate && normalizedRate) &&
    computedRate!.minus(normalizedRate!).abs().lessThanOrEqualTo(tolerance);
  const reportedRate = calculation.reportedRateOriginal
    ? strictResearchDecimal(calculation.reportedRateOriginal)
    : null;
  const reportedBound =
    calculation.reportedRateOriginal === null ||
    [candidate.quoteExact, ...locatedTerms.map((item) => String(item.quoteExact))]
      .some((quote) =>
        quoteContainsResearchDecimal(
          quote,
          calculation.reportedRateOriginal!,
        ),
      );
  const reportedMatches =
    calculation.reportedRateOriginal === null ||
    (Boolean(computedRate && reportedRate) &&
      computedRate!.minus(reportedRate!).abs().lessThanOrEqualTo(tolerance));

  return {
    checks: [
      {
        code: "numeric_calculation_inputs",
        status: inputsValid ? "passed" : "failed",
        message:
          "증감률의 현재값·비교값을 고정된 원문 위치와 Decimal 값으로 확인했습니다.",
      },
      {
        code: "numeric_calculation_formula",
        status:
          inputsValid && denominatorValid && formulaMatches
            ? "passed"
            : "failed",
        message:
          "증감률을 (현재값-비교값)/비교값×100 공식으로 다시 계산했습니다.",
      },
      ...(calculation.reportedRateOriginal !== null
        ? [
            {
              code: "numeric_reported_rate",
              status:
                reportedBound && reportedMatches
                  ? ("passed" as const)
                  : ("failed" as const),
              message:
                "원문에 직접 기재된 증감률과 코드 계산값을 비교했습니다.",
            },
          ]
        : []),
    ],
    locator: {
      kind: calculation.kind,
      formula: "(current-comparison)/comparison*100",
      tolerancePercentagePoints: tolerance.toFixed(),
      currentValue: sums.current.toFixed(),
      comparisonValue: sums.comparison.toFixed(),
      computedRate: computedRate?.toFixed() ?? null,
      reportedRateOriginal: calculation.reportedRateOriginal,
      terms: locatedTerms,
    },
    inputBound: inputsValid,
  };
}

export function validateEvidenceCandidate(
  candidate: ResearchCandidate,
  source: ResearchSourceSnapshot,
  cutoffAt: string,
  context: EvidenceValidationContext = {},
): ValidatedEvidence {
  const sourceText = JSON.stringify(source.content);
  const pages = Array.isArray(source.content.pages)
    ? source.content.pages.filter(
        (page): page is { pageNumber?: number; text: string } =>
          Boolean(page) &&
          typeof page === "object" &&
          typeof (page as { text?: unknown }).text === "string",
      )
    : [];
  const matchedPage = pages.find((page) =>
    page.text.includes(candidate.quoteExact),
  );
  const baseEvidenceLocator = resolvedEvidenceLocator(
    candidate,
    source,
    matchedPage,
  );
  const numericCalculation = validateNumericCalculation(
    candidate,
    cutoffAt,
    context,
  );
  const evidenceLocator =
    baseEvidenceLocator && numericCalculation.locator
      ? {
          ...baseEvidenceLocator,
          numericCalculation: numericCalculation.locator,
        }
      : baseEvidenceLocator;
  const checks: ValidationCheck[] = [
    {
      code: "exact_quote",
      status: sourceText.includes(candidate.quoteExact) ? "passed" : "failed",
      message: "저장한 원문에 인용문이 존재합니다.",
    },
    {
      code: "company",
      status: sourceMatchesResearchIdentity(source, context)
        ? "passed"
        : "failed",
      message: "원문이 프로젝트 기업 식별자와 일치합니다.",
    },
    {
      code: "cutoff",
      status:
        !(source.availableAt ?? source.publishedAt) ||
        new Date(source.availableAt ?? source.publishedAt!).getTime() <=
          new Date(cutoffAt).getTime()
          ? "passed"
          : "failed",
      message: "자료 발행일이 프로젝트 기준일을 넘지 않습니다.",
    },
    {
      code: "period",
      status:
        candidate.period.trim().length > 0 &&
        sourcePeriodMatches(candidate, source, evidenceLocator)
          ? "passed"
          : "failed",
      message: "결과 기간이 원문 보고 기간과 일치합니다.",
    },
    {
      code: "scope",
      status: sourceScopeMatches(candidate, source, evidenceLocator)
        ? "passed"
        : "failed",
      message: "결과 범위가 원문 연결·별도 범위와 일치합니다.",
    },
    {
      code: "source_location",
      status: evidenceLocator ? "passed" : "failed",
      message: "원문 안에서 인용문이 있는 페이지·행·문장 위치를 확인했습니다.",
    },
  ];
  if (context.question) {
    const sourceQuestionIds = Array.isArray(source.locator.questionIds)
      ? source.locator.questionIds.filter(
          (value): value is string => typeof value === "string",
        )
      : [];
    const plannedYears = new Set(
      context.question.period.match(/20\d{2}/g) ?? [],
    );
    const allowedYears = new Set(plannedYears);
    if (/전년|yoy|year[- ]over[- ]year/i.test(context.question.comparison)) {
      for (const year of plannedYears) {
        allowedYears.add(String(Number(year) - 1));
      }
    }
    const candidateYears = candidate.period.match(/20\d{2}/g) ?? [];
    const plannedQuarters = new Set(
      Array.from(
        context.question.period.matchAll(/([1-4])\s*(?:분기|q)/gi),
        (match) => match[1],
      ),
    );
    const allowedQuarters = new Set(plannedQuarters);
    if (/전분기|qoq|quarter[- ]over[- ]quarter/i.test(context.question.comparison)) {
      for (const quarter of plannedQuarters) {
        allowedQuarters.add(String(Number(quarter) === 1 ? 4 : Number(quarter) - 1));
      }
    }
    const candidateQuarters = Array.from(
      candidate.period.matchAll(/([1-4])\s*(?:분기|q)/gi),
      (match) => match[1],
    );
    checks.push(
      {
        code: "question_binding",
        status:
          candidate.questionId === context.question.questionId
            ? "passed"
            : "failed",
        message: "승인된 질문 ID와 Evidence 후보가 연결됩니다.",
      },
      {
        code: "metric_binding",
        status: context.question.metrics.includes(candidate.metricId)
          ? "passed"
          : "failed",
        message: "Evidence 지표가 승인된 질문의 수집 지표에 포함됩니다.",
      },
      {
        code: "source_binding",
        status:
          context.question.sourceBindingIds.includes(source.sourceType) &&
          sourceQuestionIds.includes(context.question.questionId)
            ? "passed"
            : "failed",
        message: "Evidence 원천 유형이 승인된 질문의 출처 정책과 일치합니다.",
      },
      {
        code: "planned_period",
        status:
          (plannedYears.size === 0 ||
            (candidateYears.length > 0 &&
              candidateYears.every((year) => allowedYears.has(year)))) &&
          (plannedQuarters.size === 0 ||
            (candidateQuarters.length > 0 &&
              candidateQuarters.every((quarter) =>
                allowedQuarters.has(quarter),
              )))
            ? "passed"
            : "failed",
        message: "Evidence 기간이 승인된 질문 기간 범위 안에 있습니다.",
      },
    );
  }
  if (candidate.criticalNumeric) {
    checks.push({
      code: "numeric_normalization",
      status:
        candidate.valueOriginal !== null &&
        candidate.valueNormalized !== null &&
        /^-?\d+(?:\.\d+)?$/.test(candidate.valueNormalized)
          ? "passed"
          : "failed",
      message: "핵심 숫자의 원본 값과 Decimal 정규화 값이 있습니다.",
    });
    checks.push(
      {
        code: "numeric_quote_binding",
        status:
          numericCalculation.inputBound ||
          (candidate.valueOriginal !== null &&
            quoteContainsResearchDecimal(
              candidate.quoteExact,
              candidate.valueOriginal,
            ))
            ? "passed"
            : "failed",
        message: "원본 숫자가 정확 인용문에 포함됩니다.",
      },
      {
        code: "unit",
        status: candidate.unit?.trim() ? "passed" : "failed",
        message: "핵심 숫자의 단위가 명시되어 있습니다.",
      },
    );
  }
  checks.push(...numericCalculation.checks);
  return {
    ...candidate,
    valueNormalized:
      canonicalResearchNumericValue(candidate.valueNormalized) ??
      candidate.valueNormalized,
    machineStatus: checks.every((check) => check.status === "passed")
      ? "passed"
      : "failed",
    checks,
    locator: evidenceLocator ?? source.locator,
  };
}
