import { isIP } from "node:net";
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
  newsSearchPolicy?: NewsSearchPolicy;
  validationErrors: string[];
};

export type ResearchExcelTarget = {
  targetId: string;
  sheetId: string;
  sheetName: string;
  address: string;
  metric: string;
  period: string;
  unit: string;
  scope: string;
  valueKind: "actual" | "preliminary_actual";
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
  category: "hypothesis" | "excel";
  questionId: string | null;
  targetId: string | null;
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
  market_data: ["KRX", "ECOS"],
};

export function suggestedResearchSources(values: string[]): ResearchSourceType[] {
  const result = values.flatMap((value) => sourceTypeMap[value] ?? []);
  return Array.from(new Set(result.length > 0 ? result : ["DART"]));
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
    questions: snapshot.questions.map((question) => {
      if (!question.sourceBindingIds.includes("NEWS")) {
        return { ...question, newsSearchPolicy: undefined };
      }
      return {
        ...question,
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
      end - start > 240 * 24 * 60 * 60 * 1_000
    ) {
      return "뉴스 검색 기간은 기준일 이전 240일 안으로 설정해야 합니다.";
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
  if (includedQuestions.length < 3 || includedQuestions.length > 5) {
    issues.push({
      code: "QUESTION_COUNT_INVALID",
      targetId: null,
      category: "hypothesis",
      message: "자료를 수집할 질문은 3개 이상 5개 이하여야 합니다.",
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
      if (sourceType === "FNGUIDE_CONSENSUS") {
        issues.push({
          code: "FNGUIDE_SOURCE_UNAVAILABLE",
          targetId: question.questionId,
          category: "material",
          message:
            "FnGuide 자동 수집은 현재 지원하지 않습니다. 다른 공식 출처를 선택해주세요.",
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
  for (const target of snapshot.excelTargets) {
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
  const required = new Set(input.requiredMetrics.map((value) => value.trim()));
  const covered = new Set(input.coveredMetrics.map((value) => value.trim()));
  const missingRequired = Array.from(required).some((metric) => !covered.has(metric));
  if (
    input.evidenceCount === 0 ||
    missingRequired ||
    input.criticalNumericFailed ||
    input.unresolvedConflict ||
    input.stale ||
    input.rejectedRequired
  ) {
    return "insufficient";
  }
  if (input.sourceCount < 2 || covered.size < required.size + 1) {
    return "qualified";
  }
  return "sufficient";
}

export function validateEvidenceCandidate(
  candidate: ResearchCandidate,
  source: ResearchSourceSnapshot,
  cutoffAt: string,
): ValidatedEvidence {
  const pages =
    source.locator.kind === "pdf" &&
    typeof source.content === "object" &&
    source.content !== null &&
    "pages" in source.content &&
    Array.isArray(source.content.pages)
      ? source.content.pages
      : [];
  const sourceText =
    pages.length > 0
      ? pages
          .map((page) =>
            typeof page === "object" &&
            page !== null &&
            "text" in page &&
            typeof page.text === "string"
              ? page.text
              : "",
          )
          .join("\n")
      : JSON.stringify(source.content);
  const quotePage = pages.find(
    (page): page is { pageNumber: number; text: string } =>
      typeof page === "object" &&
      page !== null &&
      "pageNumber" in page &&
      typeof page.pageNumber === "number" &&
      "text" in page &&
      typeof page.text === "string" &&
      page.text.includes(candidate.quoteExact),
  );
  const checks: ValidationCheck[] = [
    {
      code: "exact_quote",
      status: sourceText.includes(candidate.quoteExact) ? "passed" : "failed",
      message: "저장한 원문에 인용문이 존재합니다.",
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
      status: candidate.period.trim().length > 0 ? "passed" : "failed",
      message: "결과 기간이 명시되어 있습니다.",
    },
    {
      code: "scope",
      status: candidate.scope.trim().length > 0 ? "passed" : "failed",
      message: "결과 범위가 명시되어 있습니다.",
    },
  ];
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
  }
  if (source.sourceType === "NEWS" && candidate.category === "excel") {
    checks.push({
      code: "source_authority",
      status: "failed",
      message: "뉴스는 Excel 실제값의 권위 출처로 사용할 수 없습니다.",
    });
  }
  return {
    ...candidate,
    machineStatus: checks.every((check) => check.status === "passed")
      ? "passed"
      : "failed",
    checks,
    locator: {
      ...source.locator,
      ...(source.locator.kind === "html" || source.sourceType === "NEWS"
        ? { textFragment: candidate.quoteExact }
        : {}),
      ...(quotePage
        ? {
            pageNumber: quotePage.pageNumber,
            textFragment: candidate.quoteExact,
          }
        : {}),
    },
  };
}
