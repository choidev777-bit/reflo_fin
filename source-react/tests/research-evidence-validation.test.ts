import assert from "node:assert/strict";
import test from "node:test";
import {
  validateEvidenceCandidate,
  type ResearchCandidate,
  type ResearchPlanQuestion,
  type ResearchSourceSnapshot,
} from "../server/domain/research-validation";

const question: ResearchPlanQuestion = {
  questionId: "question-1",
  order: 1,
  role: "PERFORMANCE",
  text: "2026년 2분기 매출은 증가했는가?",
  purpose: "매출 성장 검증",
  metrics: ["revenue"],
  period: "2026년 2분기",
  comparison: "전년 동기",
  suggestedSourceTypes: ["DART"],
  included: true,
  collectionTargets: [{ label: "매출", resultTypes: ["number"] }],
  sourceBindingIds: ["DART"],
  collectionMethods: { DART: "code_then_agent" },
  validationErrors: [],
};

const quote = "2026년 2분기 매출은 1,200억원입니다.";
const source: ResearchSourceSnapshot = {
  sourceKey: "pdf-source",
  sourceType: "DART",
  title: "공식 PDF",
  publisher: "공식 발행처",
  canonicalUrl: null,
  publishedAt: "2026-07-20T00:00:00+09:00",
  collectedAt: "2026-07-20T01:00:00+09:00",
  responseHash: "d".repeat(64),
  locator: {
    kind: "pdf",
    objectKey: "immutable/project/source.pdf",
    questionIds: [question.questionId],
  },
  content: {
    pages: [
      { pageNumber: 1, text: "표지" },
      { pageNumber: 7, text: quote },
    ],
  },
  collectorVersion: "test-v1",
};
const candidate: ResearchCandidate = {
  candidateKey: "pdf-candidate",
  category: "hypothesis",
  questionId: question.questionId,
  targetId: null,
  metricId: question.metrics[0]!,
  sourceKey: source.sourceKey,
  title: "매출",
  quoteExact: quote,
  oneLineValue: "매출 1,200억원",
  valueOriginal: "1,200",
  valueNormalized: "1200",
  unit: "억원",
  currency: "KRW",
  period: question.period,
  scope: "연결",
  valueKind: "actual",
  stance: "supporting",
  required: true,
  criticalNumeric: true,
};

test("가설 Evidence는 승인 질문·출처와 PDF 실제 페이지까지 일치해야 한다", () => {
  const valid = validateEvidenceCandidate(
    candidate,
    source,
    "2026-07-25T00:00:00+09:00",
    { question },
  );

  assert.equal(valid.machineStatus, "passed");
  assert.equal(valid.locator.pageNumber, 7);
});

test("질문에 연결되지 않은 원문과 페이지 없는 인용은 근거에서 제외한다", () => {
  const wrongBinding = validateEvidenceCandidate(
    candidate,
    {
      ...source,
      locator: { ...source.locator, questionIds: ["another-question"] },
    },
    "2026-07-25T00:00:00+09:00",
    { question },
  );
  const missingPage = validateEvidenceCandidate(
    candidate,
    {
      ...source,
      content: { pages: [{ pageNumber: 1, text: "관련 없는 문장" }] },
    },
    "2026-07-25T00:00:00+09:00",
    { question },
  );

  assert.equal(wrongBinding.machineStatus, "failed");
  assert.equal(missingPage.machineStatus, "failed");
});

test("DART 가설 근거는 정확한 재무제표 행과 값 필드를 고정한다", () => {
  const dartSource: ResearchSourceSnapshot = {
    ...source,
    sourceKey: "dart-source",
    locator: {
      kind: "structured_api",
      endpoint: "/api/fnlttSinglAcntAll.json",
      questionIds: [question.questionId],
    },
    content: {
      report: {
        corpCode: "00126380",
        businessYear: 2026,
        quarter: 2,
        reportCode: "11012",
        receiptNumber: "20260814000001",
        publishedAt: "2026-07-20T00:00:00+09:00",
      },
      rows: [
        {
          fs_div: "CFS",
          sj_div: "CIS",
          sj_nm: "연결 포괄손익계산서",
          account_id: "ifrs-full_Revenue",
          account_nm: "매출액",
          thstrm_nm: "2026년 2분기 누적",
          thstrm_amount: "120000000000",
        },
      ],
    },
  };
  const valid = validateEvidenceCandidate(
    {
      ...candidate,
      sourceKey: dartSource.sourceKey,
      quoteExact: "120000000000",
      oneLineValue: "매출 1,200억원",
      valueOriginal: "120000000000",
      valueNormalized: "120000000000",
      unit: "KRW",
    },
    dartSource,
    "2026-07-25T00:00:00+09:00",
    { question },
  );

  assert.equal(valid.machineStatus, "passed");
  assert.equal(valid.locator.kind, "dart_financial_statement");
  assert.equal(valid.locator.accountId, "ifrs-full_Revenue");
  assert.equal(valid.locator.selectedField, "thstrm_amount");

  const wrongPeriod = validateEvidenceCandidate(
    {
      ...candidate,
      sourceKey: dartSource.sourceKey,
      quoteExact: "120000000000",
      valueOriginal: "120000000000",
      valueNormalized: "120000000000",
      unit: "KRW",
      period: "2026년 1분기",
    },
    dartSource,
    "2026-07-25T00:00:00+09:00",
    { question: { ...question, period: "2026년 1분기" } },
  );
  const wrongScope = validateEvidenceCandidate(
    {
      ...candidate,
      sourceKey: dartSource.sourceKey,
      quoteExact: "120000000000",
      valueOriginal: "120000000000",
      valueNormalized: "120000000000",
      unit: "KRW",
      scope: "별도",
    },
    dartSource,
    "2026-07-25T00:00:00+09:00",
    { question },
  );

  assert.equal(
    wrongPeriod.checks.find((check) => check.code === "period")?.status,
    "failed",
  );
  assert.equal(
    wrongScope.checks.find((check) => check.code === "scope")?.status,
    "failed",
  );
});

test("같은 DART 값이 여러 행에 있으면 정확한 원문 위치로 채택하지 않는다", () => {
  const row = {
    fs_div: "CFS",
    sj_div: "CIS",
    account_id: "ifrs-full_Revenue",
    account_nm: "매출액",
    thstrm_nm: "2026년 2분기 누적",
    thstrm_amount: "120000000000",
  };
  const ambiguous = validateEvidenceCandidate(
    {
      ...candidate,
      sourceKey: "dart-ambiguous",
      quoteExact: "120000000000",
      valueOriginal: "120000000000",
      valueNormalized: "120000000000",
      unit: "KRW",
    },
    {
      ...source,
      sourceKey: "dart-ambiguous",
      locator: {
        kind: "structured_api",
        endpoint: "/api/fnlttSinglAcntAll.json",
        questionIds: [question.questionId],
      },
      content: {
        report: {
          corpCode: "00126380",
          businessYear: 2026,
          quarter: 2,
          reportCode: "11012",
          receiptNumber: "20260814000001",
          publishedAt: "2026-07-20T00:00:00+09:00",
        },
        rows: [row, { ...row, account_id: "custom_Revenue" }],
      },
    },
    "2026-07-25T00:00:00+09:00",
    { question },
  );

  assert.equal(ambiguous.machineStatus, "failed");
  assert.equal(
    ambiguous.checks.find((check) => check.code === "source_location")?.status,
    "failed",
  );
});

test("질문 기간 검사는 전년 비교 기간만 허용하고 모호한 기간은 거부한다", () => {
  const priorQuote = "2025년 2분기 매출은 1,000억원입니다.";
  const priorSource: ResearchSourceSnapshot = {
    ...source,
    sourceKey: "prior-pdf-source",
    publishedAt: "2025-07-20T00:00:00+09:00",
    locator: {
      ...source.locator,
      questionIds: [question.questionId],
    },
    content: {
      pages: [{ pageNumber: 3, text: priorQuote }],
    },
  };
  const prior = validateEvidenceCandidate(
    {
      ...candidate,
      sourceKey: priorSource.sourceKey,
      quoteExact: priorQuote,
      oneLineValue: "전년 동기 매출 1,000억원",
      valueOriginal: "1,000",
      valueNormalized: "1000",
      period: "2025년 2분기",
    },
    priorSource,
    "2026-07-25T00:00:00+09:00",
    { question },
  );
  const ambiguousPeriod = validateEvidenceCandidate(
    { ...candidate, period: "최근 분기" },
    source,
    "2026-07-25T00:00:00+09:00",
    { question },
  );

  assert.equal(prior.machineStatus, "passed");
  assert.equal(ambiguousPeriod.machineStatus, "failed");
  assert.equal(
    ambiguousPeriod.checks.find((check) => check.code === "planned_period")
      ?.status,
    "failed",
  );
});

test("프로젝트 기업 식별자가 없는 다른 회사 원문은 근거에서 제외한다", () => {
  const mismatched = validateEvidenceCandidate(
    candidate,
    {
      ...source,
      title: "다른회사 공식 자료",
      publisher: "다른회사",
    },
    "2026-07-25T00:00:00+09:00",
    {
      question,
      companyName: "대덕전자",
      ticker: "353200",
      corpCode: "00126380",
    },
  );

  assert.equal(mismatched.machineStatus, "failed");
  assert.equal(
    mismatched.checks.find((check) => check.code === "company")?.status,
    "failed",
  );
});

test("전년 증감률은 고정 원문 숫자로 다시 계산하고 불일치를 거부한다", () => {
  const growthQuestion: ResearchPlanQuestion = {
    ...question,
    metrics: ["revenue_growth"],
    suggestedSourceTypes: ["COMPANY_IR"],
    sourceBindingIds: ["COMPANY_IR"],
    collectionMethods: { COMPANY_IR: "research_agent" },
  };
  const growthQuote =
    "2026년 2분기 매출은 1,200억원, 전년 동기 매출은 1,000억원이며 20% 증가했습니다.";
  const growthSource: ResearchSourceSnapshot = {
    ...source,
    sourceKey: "growth-ir-source",
    sourceType: "COMPANY_IR",
    locator: {
      kind: "pdf",
      objectKey: "immutable/project/growth-ir.pdf",
      questionIds: [growthQuestion.questionId],
    },
    content: {
      pages: [{ pageNumber: 9, text: growthQuote }],
    },
  };
  const growthCandidate: ResearchCandidate = {
    ...candidate,
    candidateKey: "growth-candidate",
    questionId: growthQuestion.questionId,
    metricId: "revenue_growth",
    sourceKey: growthSource.sourceKey,
    quoteExact: growthQuote,
    oneLineValue: "매출은 전년 동기 대비 20% 증가",
    valueOriginal: "20",
    valueNormalized: "20",
    unit: "%",
    calculation: {
      kind: "yoy",
      currentTerms: [
        {
          sourceKey: growthSource.sourceKey,
          quoteExact: "1,200",
          valueOriginal: "1,200",
          operation: "add",
          period: "2026년 2분기",
          scope: "연결",
        },
      ],
      comparisonTerms: [
        {
          sourceKey: growthSource.sourceKey,
          quoteExact: "1,000",
          valueOriginal: "1,000",
          operation: "add",
          period: "2025년 2분기",
          scope: "연결",
        },
      ],
      reportedRateOriginal: "20",
    },
  };
  const valid = validateEvidenceCandidate(
    growthCandidate,
    growthSource,
    "2026-07-25T00:00:00+09:00",
    { question: growthQuestion, sources: [growthSource] },
  );
  const manipulated = validateEvidenceCandidate(
    { ...growthCandidate, valueNormalized: "28" },
    growthSource,
    "2026-07-25T00:00:00+09:00",
    { question: growthQuestion, sources: [growthSource] },
  );
  const missingInputs = validateEvidenceCandidate(
    { ...growthCandidate, calculation: null },
    growthSource,
    "2026-07-25T00:00:00+09:00",
    { question: growthQuestion, sources: [growthSource] },
  );

  assert.equal(valid.machineStatus, "passed");
  assert.equal(
    (
      valid.locator.numericCalculation as Record<string, unknown>
    ).computedRate,
    "20",
  );
  assert.equal(manipulated.machineStatus, "failed");
  assert.equal(
    manipulated.checks.find(
      (check) => check.code === "numeric_calculation_formula",
    )?.status,
    "failed",
  );
  assert.equal(missingInputs.machineStatus, "failed");
  assert.equal(
    missingInputs.checks.find(
      (check) => check.code === "numeric_calculation_inputs",
    )?.status,
    "failed",
  );
});

test("DART 전기 금액 필드는 보고서 연도보다 1년 전 값으로 계산한다", () => {
  const growthQuestion: ResearchPlanQuestion = {
    ...question,
    metrics: ["revenue_growth"],
  };
  const dartSource: ResearchSourceSnapshot = {
    ...source,
    sourceKey: "dart-growth-source",
    sourceType: "DART",
    locator: {
      kind: "structured_api",
      endpoint: "/api/fnlttSinglAcntAll.json",
      questionIds: [growthQuestion.questionId],
    },
    content: {
      report: {
        corpCode: "00126380",
        businessYear: 2026,
        quarter: 2,
        reportCode: "11012",
        receiptNumber: "20260814000001",
        publishedAt: "2026-07-20T00:00:00+09:00",
      },
      rows: [
        {
          fs_div: "CFS",
          sj_div: "CIS",
          account_id: "ifrs-full_Revenue",
          account_nm: "매출액",
          thstrm_nm: "2026년 2분기 누적",
          thstrm_amount: "120000000000",
          frmtrm_nm: "2025년 2분기 누적",
          frmtrm_amount: "100000000000",
        },
      ],
    },
  };
  const validated = validateEvidenceCandidate(
    {
      ...candidate,
      candidateKey: "dart-growth-candidate",
      questionId: growthQuestion.questionId,
      metricId: "revenue_growth",
      sourceKey: dartSource.sourceKey,
      quoteExact: "120000000000",
      oneLineValue: "매출은 전년 동기 대비 20% 증가",
      valueOriginal: "20",
      valueNormalized: "20",
      unit: "%",
      calculation: {
        kind: "yoy",
        currentTerms: [
          {
            sourceKey: dartSource.sourceKey,
            quoteExact: "120000000000",
            valueOriginal: "120000000000",
            operation: "add",
            period: "2026년 2분기",
            scope: "연결",
          },
        ],
        comparisonTerms: [
          {
            sourceKey: dartSource.sourceKey,
            quoteExact: "100000000000",
            valueOriginal: "100000000000",
            operation: "add",
            period: "2025년 2분기",
            scope: "연결",
          },
        ],
        reportedRateOriginal: null,
      },
    },
    dartSource,
    "2026-07-25T00:00:00+09:00",
    { question: growthQuestion, sources: [dartSource] },
  );

  assert.equal(validated.machineStatus, "passed");
  const calculation = validated.locator.numericCalculation as {
    terms: Array<{ locator: Record<string, unknown>; valid: boolean }>;
  };
  assert.equal(calculation.terms[1]?.locator.selectedField, "frmtrm_amount");
  assert.equal(calculation.terms[1]?.valid, true);
});
