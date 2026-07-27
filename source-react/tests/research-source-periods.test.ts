import assert from "node:assert/strict";
import test from "node:test";
import { researchIrPeriods } from "../server/infrastructure/research-sources/adapters";
import type { ResearchPlanQuestion } from "../server/domain/research-validation";

function question(comparison: string): ResearchPlanQuestion {
  return {
    questionId: `question-${comparison}`,
    order: 1,
    role: "OUTLOOK",
    text: "분기 실적은 개선됐는가?",
    purpose: "기간 비교",
    metrics: ["revenue_growth"],
    period: "2026년 1분기",
    comparison,
    suggestedSourceTypes: ["COMPANY_IR"],
    included: true,
    collectionTargets: [{ label: "매출", resultTypes: ["number"] }],
    sourceBindingIds: ["COMPANY_IR"],
    collectionMethods: { COMPANY_IR: "research_agent" },
    validationErrors: [],
  };
}

test("IR 원문 기간은 현재·전년 동기·전분기를 모두 허용한다", () => {
  const periods = researchIrPeriods({
    targetYear: 2026,
    targetQuarter: 1,
    questions: [question("전년 동기 및 전분기")],
  });

  assert.deepEqual(periods, [
    { year: 2026, quarter: 1 },
    { year: 2025, quarter: 4 },
    { year: 2025, quarter: 1 },
  ]);
});

test("승인 질문에 연결되지 않은 임의 과거 IR 기간은 추가하지 않는다", () => {
  const periods = researchIrPeriods({
    targetYear: 2026,
    targetQuarter: 2,
    questions: [
      {
        ...question("전년 동기"),
        included: false,
        period: "2024년 3분기",
      },
    ],
  });

  assert.deepEqual(periods, [{ year: 2026, quarter: 2 }]);
});
