import assert from "node:assert/strict";
import test from "node:test";
import {
  decideQuestionAnswers,
  decideStoredQuestionAnswer,
  validateQuestionAnswerSet,
  validateQuestionAnswer,
} from "../server/domain/research-question-answers";
import type {
  ResearchPlanQuestion,
  ValidatedEvidence,
} from "../server/domain/research-validation";

const question: ResearchPlanQuestion = {
  questionId: "question-1",
  order: 1,
  role: "PERFORMANCE",
  text: "매출 성장 가설은 유효한가?",
  purpose: "성장성 검증",
  metrics: ["revenue_growth"],
  period: "2026년 2분기",
  comparison: "전년 동기",
  suggestedSourceTypes: ["DART"],
  included: true,
  collectionTargets: [{ label: "매출 성장률", resultTypes: ["number"] }],
  sourceBindingIds: ["DART"],
  collectionMethods: { DART: "code_then_agent" },
  verdictPolicy: {
    version: "stance-balance-v1",
    positive: "supporting_without_contradiction",
    negative: "contradicting_without_support",
    neutral: "mixed_or_neutral",
    indeterminate: "missing_or_conflicting_required_metric",
  },
  validationErrors: [],
};

function evidence(
  overrides: Partial<ValidatedEvidence> = {},
): ValidatedEvidence {
  return {
    candidateKey: "candidate-1",
    category: "hypothesis",
    questionId: question.questionId,
    targetId: null,
    metricId: "revenue_growth",
    sourceKey: "source-1",
    title: "매출 성장률",
    quoteExact: "매출은 전년 동기 대비 12.5% 증가했습니다.",
    oneLineValue: "매출 성장률 12.5%",
    valueOriginal: "12.5",
    valueNormalized: "12.5",
    unit: "%",
    currency: null,
    period: "2026년 2분기",
    scope: "연결",
    valueKind: "actual",
    stance: "supporting",
    required: true,
    criticalNumeric: true,
    machineStatus: "passed",
    checks: [],
    locator: { kind: "structured_api" },
    ...overrides,
  };
}

test("질문 판정은 검증 통과 Evidence의 stance로 코드가 결정한다", () => {
  const [decision] = decideQuestionAnswers({
    questions: [question],
    evidence: [evidence()],
  });

  assert.equal(decision?.verdict, "positive");
  assert.equal(decision?.readyForSynthesis, true);
  assert.equal(decision?.policyVersion, "stance-balance-v1");
});

test("같은 지표·기간의 값 충돌은 답변 생성을 막는다", () => {
  const [decision] = decideQuestionAnswers({
    questions: [question],
    evidence: [
      evidence(),
      evidence({
        candidateKey: "candidate-2",
        valueOriginal: "9.1",
        valueNormalized: "9.1",
        oneLineValue: "매출 성장률 9.1%",
        quoteExact: "매출은 전년 동기 대비 9.1% 증가했습니다.",
      }),
    ],
  });

  assert.equal(decision?.verdict, "indeterminate");
  assert.equal(decision?.readyForSynthesis, false);
});

test("같은 지표라도 비교 기간이 다르면 정상 비교 근거로 유지한다", () => {
  const [decision] = decideQuestionAnswers({
    questions: [question],
    evidence: [
      evidence(),
      evidence({
        candidateKey: "candidate-prior",
        period: "2025년 2분기",
        valueOriginal: "8.1",
        valueNormalized: "8.1",
        oneLineValue: "전년 동기 매출 성장률 8.1%",
        quoteExact: "2025년 2분기 매출 성장률은 8.1%였습니다.",
      }),
    ],
  });

  assert.equal(decision?.verdict, "positive");
  assert.equal(decision?.readyForSynthesis, true);
});

test("같은 숫자의 소수 표기 차이는 출처 충돌로 보지 않는다", () => {
  const [decision] = decideQuestionAnswers({
    questions: [question],
    evidence: [
      evidence(),
      evidence({
        candidateKey: "candidate-equivalent",
        valueOriginal: "12.50",
        valueNormalized: "12.50",
        oneLineValue: "매출 성장률 12.50%",
        quoteExact: "매출은 전년 동기 대비 12.50% 증가했습니다.",
      }),
    ],
  });

  assert.equal(decision?.verdict, "positive");
  assert.equal(decision?.readyForSynthesis, true);
});

test("AI 한 줄 답변은 코드 판정·근거 ID·근거 숫자를 벗어날 수 없다", () => {
  const [decision] = decideQuestionAnswers({
    questions: [question],
    evidence: [evidence()],
  });
  assert.ok(decision);

  assert.throws(
    () =>
      validateQuestionAnswer(
        {
          questionId: question.questionId,
          verdict: "positive",
          oneLineAnswer: "매출 성장률은 99%로 긍정적입니다.",
          evidenceCandidateKeys: ["candidate-1"],
          caveat: null,
          policyVersion: "stance-balance-v1",
        },
        decision,
      ),
    /QUESTION_ANSWER_NUMBER_UNSUPPORTED/,
  );
  assert.throws(
    () =>
      validateQuestionAnswer(
        {
          questionId: question.questionId,
          verdict: "positive",
          oneLineAnswer: "매출 성장률 12.5%\n긍정",
          evidenceCandidateKeys: ["candidate-1"],
          caveat: null,
          policyVersion: "stance-balance-v1",
        },
        decision,
      ),
    /QUESTION_ANSWER_FORMAT_INVALID/,
  );
});

test("일부 지표가 빠져도 검증된 주장은 답변에 반영하고 누락 지표만 제외한다", () => {
  const answer = decideStoredQuestionAnswer({
    requiredMetricIds: ["revenue_growth", "order_growth"],
    results: [
      {
        metricId: "revenue_growth",
        oneLineValue: "매출 성장률 12.5%",
        stance: "supporting",
        evidenceIds: ["evidence-1"],
      },
    ],
  });

  assert.equal(answer.verdict, "positive");
  assert.match(answer.caveat ?? "", /order_growth/);
  assert.deepEqual(answer.evidenceIds, ["evidence-1"]);
});

test("충돌 원문 선택 뒤 모든 필수 지표가 있으면 stance로 다시 판정한다", () => {
  const answer = decideStoredQuestionAnswer({
    requiredMetricIds: ["revenue_growth", "order_growth"],
    results: [
      {
        metricId: "revenue_growth",
        oneLineValue: "매출 성장률 12.5%",
        stance: "supporting",
        evidenceIds: ["evidence-1"],
      },
      {
        metricId: "order_growth",
        oneLineValue: "수주가 증가했습니다.",
        stance: "supporting",
        evidenceIds: ["evidence-2"],
      },
    ],
  });

  assert.equal(answer.verdict, "positive");
  assert.equal(answer.caveat, null);
  assert.deepEqual(answer.evidenceIds, ["evidence-1", "evidence-2"]);
});

test("서버는 질문 답변을 Evidence로 다시 검증하고 판정을 서버 정책으로 확정한다", () => {
  // verdict는 서버의 decideQuestionAnswers가 근거로부터 정하는 정책 권위다. 워커가
  // 보낸 verdict가 어긋나도 실패시키지 않고 서버 값으로 확정한다(한 줄 답변은 유지).
  const [confirmed] = validateQuestionAnswerSet({
    questions: [question],
    evidence: [evidence()],
    answers: [
      {
        questionId: question.questionId,
        verdict: "negative",
        oneLineAnswer: "매출 성장률 12.5%",
        evidenceCandidateKeys: ["candidate-1"],
        caveat: null,
        policyVersion: "stance-balance-v1",
      },
    ],
  });
  assert.equal(confirmed.verdict, "positive");
  assert.equal(confirmed.oneLineAnswer, "매출 성장률 12.5%");
  // 판단 가능한 질문에 워커의 한 줄 답변이 없으면 여전히 집합 불일치로 거부한다.
  assert.throws(
    () =>
      validateQuestionAnswerSet({
        questions: [question],
        evidence: [evidence()],
        answers: [],
      }),
    /QUESTION_ANSWER_SET_MISMATCH/,
  );
});
