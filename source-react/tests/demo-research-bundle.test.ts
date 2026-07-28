import assert from "node:assert/strict";
import test from "node:test";

/**
 * 시연 모드 STEP 04가 STEP 05까지 이어지는지 확인한다.
 *
 * STEP 05는 `validateEvidenceCandidate`를 통과한 근거만 보여준다. 고정 응답이
 * 만든 인용문이 같은 고정 응답이 만든 원문 안에 실제로 존재하지 않으면
 * exact_quote 검사에서 걸러져 STEP 04가 100%로 끝나도 STEP 05가 빈 화면이 된다.
 * 지난번 회귀가 정확히 그 모양이었으므로 여기서 막는다.
 */

const DEMO_QUESTIONS = [
  { role: "PERFORMANCE" as const, metric: "매출액" },
  { role: "DRIVER" as const, metric: "FCCSP 수요" },
  { role: "SEGMENT" as const, metric: "위성통신 수요" },
  { role: "OUTLOOK" as const, metric: "판가" },
  { role: "VALUATION" as const, metric: "이익 추정치" },
];

const CUTOFF_DATE = "2026-05-15";
const CUTOFF_AT = `${CUTOFF_DATE}T23:59:59+09:00`;

function demoContext() {
  return {
    projectId: "019fa61f-5949-7354-b798-38aca3cc607f",
    companyMasterId: "019fa61f-5949-7354-b798-38aca3cc6070",
    companyName: "대덕전자",
    corpCode: "00164779",
    ticker: "353200",
    exchange: "KOSPI" as const,
    targetYear: 2026,
    targetQuarter: 1,
    cutoffDate: CUTOFF_DATE,
    cutoffAt: CUTOFF_AT,
    questions: DEMO_QUESTIONS.map((question, index) => ({
      questionId: `019fa61f-5949-7354-b798-38aca3cc60${(index + 10).toString()}`,
      order: index + 1,
      role: question.role,
      text: `${question.metric} 관련 시연 질문 ${index + 1}`,
      purpose: `${question.metric} 확인`,
      metrics: [question.metric],
      period: "2026년 1분기",
      comparison: "전분기·전년 동기",
      suggestedSourceTypes: ["DART", "COMPANY_IR"] as const,
      included: true,
      collectionTargets: [],
      // 시연에서 고정하는 출처: DART 공시 + 기업 IR
      sourceBindingIds: ["DART", "COMPANY_IR"] as const,
      collectionMethods: {},
    })),
    excelTargets: [],
    userUrls: [],
    sourceReferences: [],
    newsDiscoveryResults: [],
    allowEmpty: true,
  };
}

async function collectInDemoMode() {
  const previous = {
    demo: process.env.REFLO_DEMO_MODE,
    llm: process.env.REFLO_LLM_TEST_FIXTURE,
    research: process.env.REFLO_RESEARCH_TEST_FIXTURE,
  };
  process.env.REFLO_DEMO_MODE = "1";
  delete process.env.REFLO_LLM_TEST_FIXTURE;
  delete process.env.REFLO_RESEARCH_TEST_FIXTURE;
  try {
    const { collectResearchSources } = await import(
      "../server/infrastructure/research-sources/adapters"
    );
    return await collectResearchSources(
      demoContext() as unknown as Parameters<typeof collectResearchSources>[0],
    );
  } finally {
    if (previous.demo === undefined) delete process.env.REFLO_DEMO_MODE;
    else process.env.REFLO_DEMO_MODE = previous.demo;
    if (previous.llm !== undefined) process.env.REFLO_LLM_TEST_FIXTURE = previous.llm;
    if (previous.research !== undefined) {
      process.env.REFLO_RESEARCH_TEST_FIXTURE = previous.research;
    }
  }
}

test("시연 모드는 질문마다 DART 공시와 기업 IR 원문을 함께 만든다", async () => {
  const bundle = await collectInDemoMode();
  const sourceTypes = bundle.sources.map((source) => source.sourceType);
  assert.equal(
    bundle.sources.length,
    DEMO_QUESTIONS.length * 2,
    "질문 5개 × 출처 2종 = 원문 10건이어야 합니다.",
  );
  assert.equal(sourceTypes.filter((type) => type === "DART").length, 5);
  assert.equal(sourceTypes.filter((type) => type === "COMPANY_IR").length, 5);
  // STEP 05가 근거마다 발행기관을 보여주므로 두 축이 구분돼야 한다.
  const publishers = new Set(bundle.sources.map((source) => source.publisher));
  assert.ok(publishers.has("금융감독원 전자공시시스템"));
  assert.ok(publishers.has("기업 IR 자료"));
});

test("시연 모드 근거는 원문 검증을 통과해 STEP 05에 남는다", async () => {
  const bundle = await collectInDemoMode();
  const { validateEvidenceCandidate } = await import(
    "../server/domain/research-validation"
  );
  const context = demoContext();
  const sourceByKey = new Map(
    bundle.sources.map((source) => [source.sourceKey, source]),
  );
  const questionById = new Map(
    context.questions.map((question) => [question.questionId, question]),
  );

  assert.ok(bundle.candidates.length > 0, "조사 후보가 비어 있습니다.");
  const passed = bundle.candidates.filter((candidate) => {
    const source = sourceByKey.get(candidate.sourceKey);
    const question = questionById.get(candidate.questionId);
    assert.ok(source, `후보의 원문을 찾지 못했습니다: ${candidate.sourceKey}`);
    assert.ok(question, "후보의 질문을 찾지 못했습니다.");
    return (
      validateEvidenceCandidate(candidate, source, CUTOFF_AT, {
        question: question as never,
        companyName: context.companyName,
        ticker: context.ticker,
        corpCode: context.corpCode,
        sources: bundle.sources,
      }).machineStatus === "passed"
    );
  });

  assert.equal(
    passed.length,
    bundle.candidates.length,
    `후보 ${bundle.candidates.length}건 중 ${passed.length}건만 통과했습니다. ` +
      "STEP 04가 완료돼도 STEP 05가 비게 됩니다.",
  );
});

test("후보 키가 겹치지 않아 답변 합성이 실패하지 않는다", async () => {
  const bundle = await collectInDemoMode();
  const keys = bundle.candidates.map((candidate) => candidate.candidateKey);
  assert.equal(
    new Set(keys).size,
    keys.length,
    "candidateKey가 중복되면 EVIDENCE_CANDIDATE_KEY_CONFLICT로 STEP 04가 실패합니다.",
  );
});
