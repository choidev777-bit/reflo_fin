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
    questions: [1, 2, 3, 4].map((priority) => ({
      questionKey: `q_0${priority}`,
      role: (
        ["PERFORMANCE", "DRIVER", "OUTLOOK", "VALUATION"] as const
      )[priority - 1]!,
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
      promptVersion: "hypothesis-v4",
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

test("Hypothesis Agent 출력은 3~7개와 연속 우선순위를 통과한다", () => {
  assert.deepEqual(
    validateHypothesisAgentOutput(validResult()).map(
      (question) => question.priority,
    ),
    [1, 2, 3, 4],
  );
});

test("가설 계획 맥락은 이전 PDF와 Excel의 주제를 현재 사실과 구분한다", async () => {
  const { buildHypothesisPlanningContext } = await import(
    "../server/infrastructure/repositories/hypothesis-repository"
  );
  const context = buildHypothesisPlanningContext({
    templateIr: {
      pages: [
        {
          pageNumber: 1,
          objects: [
            {
              textRun: {
                text: "PKG와 MLB의 분기 실적 및 AI 데이터센터 수요를 분석하고 다음 분기 성장 동력을 점검한다.",
              },
            },
          ],
        },
      ],
    },
    workbookAnalysis: {
      sheets: [
        { name: "08_도표4_분기실적추이", visibility: "visible" },
      ],
      candidateRanges: [
        {
          sheetName: "08_도표4_분기실적추이",
          range: "A4:Y7",
          headerValues: ["매출액", "영업이익", "OPM"],
          periodColumns: [{ label: "1Q26" }],
        },
      ],
    },
    currentIr: {
      pages: [
        {
          pageNumber: 5,
          objects: [
            {
              textRun: {
                text: "현재 분기 공식 IR은 서버와 데이터센터 수요가 견조하고 고부가 제품 비중이 확대되었다고 설명한다.",
              },
            },
          ],
        },
      ],
    },
  });

  assert.match(context.knownFacts.join(" "), /PKG와 MLB/);
  assert.match(context.knownFacts.join(" "), /현재 분기 공식 IR/);
  assert.match(context.knownFacts.join(" "), /08_도표4_분기실적추이/);
  assert.match(context.knownFacts.join(" "), /현재 분기 사실 아님/);
  assert.match(context.optionalContext, /배경 자료/);
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
