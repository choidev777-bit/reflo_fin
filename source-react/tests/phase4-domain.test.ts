import assert from "node:assert/strict";
import test, { mock } from "node:test";
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
import { collectResearchSources } from "../server/infrastructure/research-sources/adapters";

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

test("기업 IR을 선택하면 사용자 제공 PDF 또는 공식 URL을 요구한다", () => {
  const missing = plan();
  missing.questions[0].sourceBindingIds = ["DART", "COMPANY_IR"];
  missing.questions[0].collectionMethods.COMPANY_IR = "research_agent";
  assert.ok(
    validateResearchPlan(missing).some(
      (issue) =>
        issue.code === "SOURCE_MATERIAL_REQUIRED" &&
        issue.targetId === "COMPANY_IR",
    ),
  );

  missing.sourceReferences = [
    {
      referenceId: "reference-1",
      sourceType: "COMPANY_IR",
      ingestionMethod: "user_url",
      title: "2026년 2분기 실적발표",
      publisher: "ISC",
      publishedAt: "2026-07-20T00:00:00.000Z",
      canonicalUrl: "https://company.example.com/ir.pdf",
      artifactId: null,
      originalFilename: null,
      mediaType: null,
      byteSize: null,
      sha256: null,
    },
  ];
  assert.equal(
    validateResearchPlan(missing).some(
      (issue) => issue.code === "SOURCE_MATERIAL_REQUIRED",
    ),
    false,
  );
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

test("ECOS 환율 수집은 일별 주기와 기준일 이전 최신값을 사용한다", async () => {
  const previous = {
    apiKey: process.env.ECOS_API_KEY,
    researchFixture: process.env.REFLO_RESEARCH_TEST_FIXTURE,
    llmFixture: process.env.REFLO_LLM_TEST_FIXTURE,
  };
  process.env.ECOS_API_KEY = "test-ecos-key";
  process.env.REFLO_RESEARCH_TEST_FIXTURE = "0";
  process.env.REFLO_LLM_TEST_FIXTURE = "0";
  let requestedUrl = "";
  mock.method(
    globalThis,
    "fetch",
    async (input: string | URL | Request) => {
      requestedUrl = String(input);
      return new Response(
        JSON.stringify({
          StatisticSearch: {
            row: [
              { TIME: "20260519", DATA_VALUE: "1380.5" },
              { TIME: "20260520", DATA_VALUE: "1375.2" },
            ],
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    },
  );
  try {
    const result = await collectResearchSources({
      projectId: "project-1",
      companyMasterId: "company-1",
      companyName: "ISC",
      corpCode: "00572905",
      ticker: "095340",
      exchange: "KOSDAQ",
      targetYear: 2026,
      targetQuarter: 1,
      cutoffDate: "2026-05-20",
      cutoffAt: "2026-05-20T23:59:59.999Z",
      questions: [
        {
          questionId: "question-1",
          order: 1,
          text: "환율 환경은 실적에 어떤 영향을 주는가?",
          purpose: "투자 가설 확인",
          metrics: ["원/미국달러"],
          period: "2026년 1분기",
          comparison: "전년 동기",
          suggestedSourceTypes: ["ECOS"],
          included: true,
          collectionTargets: [
            { label: "원/미국달러", resultTypes: ["number"] },
          ],
          sourceBindingIds: ["ECOS"],
          collectionMethods: { ECOS: "code_then_agent" },
          validationErrors: [],
        },
      ],
      excelTargets: [],
      userUrls: [],
      sourceReferences: [],
    });
    assert.match(
      requestedUrl,
      /\/StatisticSearch\/test-ecos-key\/json\/kr\/1\/100\/731Y001\/D\/20260405\/20260520\/0000001$/,
    );
    assert.equal(result.sources[0]?.sourceType, "ECOS");
    assert.equal(result.sources[0]?.publishedAt, "2026-05-20T00:00:00+09:00");
    assert.equal(
      (result.sources[0]?.content.latest as { DATA_VALUE?: string })
        .DATA_VALUE,
      "1375.2",
    );
  } finally {
    mock.restoreAll();
    if (previous.apiKey === undefined) delete process.env.ECOS_API_KEY;
    else process.env.ECOS_API_KEY = previous.apiKey;
    if (previous.researchFixture === undefined) {
      delete process.env.REFLO_RESEARCH_TEST_FIXTURE;
    } else {
      process.env.REFLO_RESEARCH_TEST_FIXTURE = previous.researchFixture;
    }
    if (previous.llmFixture === undefined) {
      delete process.env.REFLO_LLM_TEST_FIXTURE;
    } else {
      process.env.REFLO_LLM_TEST_FIXTURE = previous.llmFixture;
    }
  }
});
