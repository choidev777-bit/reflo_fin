import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateQuestionSufficiency,
  normalizePublicResearchUrl,
  validateEvidenceCandidate,
  validateResearchPlan,
  type ResearchCandidate,
  type ResearchPlanSnapshot,
  type ResearchSourceSnapshot,
} from "../server/domain/research-validation";
import { ApiError } from "../server/http/api-error";

function plan(): ResearchPlanSnapshot {
  return {
    questions: [1, 2, 3].map((order) => ({
      questionId: `question-${order}`,
      order,
      text: `${order}번 조사 질문`,
      purpose: "투자 가설 확인",
      metrics: [`지표-${order}`],
      period: "2026년 2분기",
      comparison: "전년 동기",
      suggestedSourceTypes: ["DART"],
      included: true,
      collectionTargets: [{ label: `지표-${order}`, resultTypes: ["number"] }],
      sourceBindingIds: ["DART"],
      collectionMethods: { DART: "code_then_agent" },
      validationErrors: [],
    })),
    excelTargets: [
      {
        targetId: "target-1",
        sheetId: "sheet-1",
        sheetName: "Valuation",
        address: "B12",
        metric: "매출액",
        period: "2026년 2분기",
        unit: "백만원",
        scope: "연결",
        valueKind: "actual",
        required: true,
        included: true,
        sourcePolicy: [{ sourceType: "DART", role: "authority" }],
        mappingSlotIds: ["slot-1"],
        excludedReason: null,
      },
    ],
    userUrls: [],
  };
}

test("공개 URL만 정규화하고 사설망·자격 증명 URL은 거부한다", () => {
  assert.equal(
    normalizePublicResearchUrl("https://example.com/report#section"),
    "https://example.com/report",
  );
  for (const value of [
    "http://127.0.0.1/admin",
    "http://169.254.169.254/latest/meta-data",
    "https://user:secret@example.com/report",
    "file:///etc/passwd",
  ]) {
    assert.throws(
      () => normalizePublicResearchUrl(value),
      (error) => error instanceof ApiError && error.code.startsWith("SOURCE_URL_"),
    );
  }
});

test("계획은 3~5개 질문과 필수 Excel 실제값 출처를 요구한다", () => {
  assert.deepEqual(validateResearchPlan(plan()), []);

  const invalid = plan();
  invalid.questions[0].sourceBindingIds = [];
  invalid.excelTargets[0].sourcePolicy = [
    { sourceType: "FNGUIDE_CONSENSUS", role: "authority" },
  ];
  const codes = validateResearchPlan(invalid).map((issue) => issue.code);
  assert.ok(codes.includes("QUESTION_SOURCE_REQUIRED"));
  assert.ok(codes.includes("FNGUIDE_AUTHORITY_FORBIDDEN"));
});

test("TD-020 충분성 판정은 부족·조건부·충분·재조사를 구분한다", () => {
  const base = {
    requiredMetrics: ["매출액"],
    coveredMetrics: ["매출액", "영업이익"],
    evidenceCount: 2,
    sourceCount: 2,
    criticalNumericFailed: false,
    unresolvedConflict: false,
    stale: false,
    rejectedRequired: false,
    reinvestigating: false,
  };
  assert.equal(calculateQuestionSufficiency(base), "sufficient");
  assert.equal(
    calculateQuestionSufficiency({ ...base, sourceCount: 1 }),
    "qualified",
  );
  assert.equal(
    calculateQuestionSufficiency({ ...base, coveredMetrics: [] }),
    "insufficient",
  );
  assert.equal(
    calculateQuestionSufficiency({ ...base, reinvestigating: true }),
    "reinvestigating",
  );
});

test("Evidence는 원문 exact quote·기준일·기간·범위·숫자 정규화를 검사한다", () => {
  const source: ResearchSourceSnapshot = {
    sourceKey: "source-1",
    sourceType: "DART",
    title: "공시 원문",
    publisher: "금융감독원",
    canonicalUrl: "https://dart.fss.or.kr/",
    publishedAt: "2026-07-20T00:00:00Z",
    collectedAt: "2026-07-25T00:00:00Z",
    responseHash: "a".repeat(64),
    locator: { kind: "structured_api", jsonPointer: "/rows/0" },
    content: { quote: "매출액은 1,200억원입니다." },
    collectorVersion: "test-v1",
  };
  const candidate: ResearchCandidate = {
    candidateKey: "candidate-1",
    category: "excel",
    questionId: null,
    targetId: "target-1",
    sourceKey: source.sourceKey,
    title: "매출액",
    quoteExact: "매출액은 1,200억원입니다.",
    oneLineValue: "1,200억원",
    valueOriginal: "1,200",
    valueNormalized: "1200",
    unit: "억원",
    currency: "KRW",
    period: "2026년 2분기",
    scope: "연결",
    valueKind: "actual",
    stance: "supporting",
    required: true,
    criticalNumeric: true,
  };

  assert.equal(
    validateEvidenceCandidate(candidate, source, "2026-07-25T00:00:00Z")
      .machineStatus,
    "passed",
  );
  assert.equal(
    validateEvidenceCandidate(
      { ...candidate, quoteExact: "원문에 없는 문장" },
      source,
      "2026-07-25T00:00:00Z",
    ).machineStatus,
    "failed",
  );
});
