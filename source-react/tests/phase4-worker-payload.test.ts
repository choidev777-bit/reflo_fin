import assert from "node:assert/strict";
import test from "node:test";
import {
  type PhaseFourWorkerPayload,
  validateWorkerPayload,
} from "../server/infrastructure/repositories/phase4-repository";

function payload(): PhaseFourWorkerPayload {
  return {
    sources: [
      {
        sourceKey: "source-1",
        sourceType: "COMPANY_IR",
        title: "기업 IR",
        publisher: "테스트 기업",
        canonicalUrl: null,
        publishedAt: "2026-07-20T00:00:00Z",
        collectedAt: "2026-07-20T01:00:00Z",
        responseHash: "a".repeat(64),
        locator: { kind: "pdf", pageCount: 1 },
        content: {
          pages: [{ pageNumber: 1, text: "검증할 근거가 없는 원문" }],
        },
        collectorVersion: "test-v1",
      },
    ],
    candidates: [],
    evidence: [],
    questionAnswers: [],
    excelResults: [],
    warnings: [],
    metadata: {
      researchAgentProfile: "research-agent-v1",
      validationAgentProfile: "validation-agent-v1",
      validationRuleVersion: "validation-sufficiency-v1",
      startedAt: "2026-07-20T01:00:00Z",
      finishedAt: "2026-07-20T01:00:01Z",
    },
  };
}

test("수집 원문이 있으면 후보와 Evidence가 모두 0건이어도 게시할 수 있다", () => {
  assert.doesNotThrow(() => validateWorkerPayload(payload()));
});

test("조사 후보와 Evidence 중 한쪽만 비어 있으면 거부한다", () => {
  const invalid = payload();
  invalid.candidates.push({
    candidateKey: "candidate-1",
    category: "hypothesis",
    questionId: "question-1",
    metricId: "revenue",
    targetId: null,
    sourceKey: "source-1",
    title: "매출",
    quoteExact: "매출 근거",
    oneLineValue: "근거",
    valueOriginal: null,
    valueNormalized: null,
    unit: null,
    currency: null,
    period: "2026년 2분기",
    scope: "연결",
    valueKind: null,
    stance: "neutral",
    required: true,
    criticalNumeric: false,
  });
  assert.throws(
    () => validateWorkerPayload(invalid),
    /조사 후보와 Evidence 연결을 확인해주세요/,
  );
});
