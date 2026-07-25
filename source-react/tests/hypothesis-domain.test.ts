import assert from "node:assert/strict";
import test from "node:test";
import { ApiError } from "../server/http/api-error";
import {
  normalizeHypothesisQuestionText,
  validateHypothesisAgentOutput,
  type HypothesisAgentResult,
} from "../server/infrastructure/repositories/hypothesis-repository";

function validResult(): HypothesisAgentResult {
  return {
    schemaVersion: "1.0",
    outputType: "hypothesis_questions",
    inputVersionRefs: [
      {
        role: "hypothesis_draft",
        resourceVersionId: "019f0000-0000-7000-8000-000000000001",
        version: 2,
        contentHash:
          "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      },
    ],
    warnings: [],
    questions: [1, 2, 3].map((priority) => ({
      questionKey: `q_0${priority}`,
      text: `2026년 2분기 ISC 지표 ${priority}은 전년 동기 대비 개선됐는가?`,
      purpose: `지표 ${priority} 확인`,
      metrics: [`지표 ${priority}`],
      period: "2026년 2분기",
      comparison: "전년 동기",
      sourceTypes: ["filing", "company"],
      priority,
    })),
    missingContext: [],
    metadata: {
      provider: "openai",
      model: "test:hypothesis-fixture",
      promptVersion: "hypothesis-v2",
      outputSchemaId:
        "https://schemas.reflo.dev/worker/v1/agent-output.schema.json",
      startedAt: "2026-07-25T00:00:00Z",
      finishedAt: "2026-07-25T00:00:01Z",
      usage: { inputTokens: 10, outputTokens: 20 },
    },
  };
}

test("질문 정규화는 공백과 대소문자 차이를 제거한다", () => {
  assert.equal(
    normalizeHypothesisQuestionText("  ISC   ASP 개선  "),
    normalizeHypothesisQuestionText("isc asp 개선"),
  );
});

test("Hypothesis Agent 출력은 3~5개와 연속 우선순위를 통과한다", () => {
  assert.deepEqual(
    validateHypothesisAgentOutput(validResult()).map(
      (question) => question.priority,
    ),
    [1, 2, 3],
  );
});

test("중복 Agent 질문은 일부 결과를 게시하지 않고 거부한다", () => {
  const result = validResult();
  result.questions[1].text = result.questions[0].text;
  assert.throws(
    () => validateHypothesisAgentOutput(result),
    (error) =>
      error instanceof ApiError && error.code === "AGENT_OUTPUT_INVALID",
  );
});

test("불연속 Agent 우선순위는 거부한다", () => {
  const result = validResult();
  result.questions[2].priority = 5;
  assert.throws(
    () => validateHypothesisAgentOutput(result),
    (error) =>
      error instanceof ApiError && error.code === "AGENT_OUTPUT_INVALID",
  );
});
