import assert from "node:assert/strict";
import test, { mock } from "node:test";
import {
  attachNewsSearchPolicies,
  calculateQuestionSufficiency,
  normalizePublicResearchUrl,
  validateEvidenceCandidate,
  validateResearchPlan,
  type ResearchCandidate,
  type ResearchPlanSnapshot,
  type ResearchSourceSnapshot,
} from "../server/domain/research-validation";
import { ApiError } from "../server/http/api-error";
import {
  collectResearchSources,
  extractArticleMetadata,
} from "../server/infrastructure/research-sources/adapters";

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

test("뉴스는 사용자 URL 대신 기준일이 고정된 자동 검색 정책을 요구한다", () => {
  const snapshot = plan();
  snapshot.questions[0].sourceBindingIds = ["DART", "NEWS"];
  snapshot.questions[0].collectionMethods.NEWS = "research_agent";
  const withPolicy = attachNewsSearchPolicies(snapshot, {
    targetYear: 2026,
    targetQuarter: 2,
    cutoffAt: "2026-07-25T23:59:59+09:00",
  });

  const newsQuestion = withPolicy.questions[0];
  assert.equal(newsQuestion.newsSearchPolicy?.mode, "agent_web_search");
  assert.equal(
    newsQuestion.newsSearchPolicy?.publicationWindows[0]?.startAt,
    "2026-03-02T00:00:00+09:00",
  );
  assert.equal(
    newsQuestion.newsSearchPolicy?.publicationWindows[0]?.endAt,
    "2026-07-25T23:59:59+09:00",
  );
  assert.equal(
    validateResearchPlan(
      withPolicy,
      "2026-07-25T23:59:59+09:00",
    ).some((issue) => issue.code === "SOURCE_MATERIAL_REQUIRED"),
    false,
  );

  delete newsQuestion.newsSearchPolicy;
  assert.ok(
    validateResearchPlan(
      withPolicy,
      "2026-07-25T23:59:59+09:00",
    ).some((issue) => issue.code === "NEWS_SEARCH_POLICY_INVALID"),
  );
});

test("뉴스는 Excel 실제값의 권위 출처가 될 수 없다", () => {
  const snapshot = plan();
  snapshot.excelTargets[0].sourcePolicy = [
    { sourceType: "NEWS", role: "authority" },
  ];
  assert.ok(
    validateResearchPlan(snapshot).some(
      (issue) => issue.code === "NEWS_AUTHORITY_FORBIDDEN",
    ),
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
  assert.equal(
    validateEvidenceCandidate(
      candidate,
      { ...source, sourceType: "NEWS" },
      "2026-07-25T00:00:00Z",
    ).machineStatus,
    "failed",
  );
});

test("PDF Evidence는 exact quote가 있는 페이지와 text fragment를 locator에 고정한다", () => {
  const quoteExact = "매출액은 1,200억원입니다.";
  const source: ResearchSourceSnapshot = {
    sourceKey: "upload:source-1",
    sourceType: "COMPANY_IR",
    title: "기업 IR 원문",
    publisher: "테스트 기업",
    canonicalUrl: null,
    publishedAt: "2026-07-20T00:00:00Z",
    collectedAt: "2026-07-25T00:00:00Z",
    responseHash: "b".repeat(64),
    locator: {
      kind: "pdf",
      referenceId: "reference-1",
      objectKey: "immutable/project/research-materials/source.pdf",
      pageCount: 2,
    },
    content: {
      pages: [
        { pageNumber: 1, text: "표지" },
        { pageNumber: 2, text: `실적 요약\n${quoteExact}` },
      ],
    },
    collectorVersion: "test-pdf-v1",
  };
  const candidate: ResearchCandidate = {
    candidateKey: "candidate-pdf-1",
    category: "hypothesis",
    questionId: "question-1",
    targetId: null,
    sourceKey: source.sourceKey,
    title: "매출액",
    quoteExact,
    oneLineValue: "1,200억원",
    valueOriginal: null,
    valueNormalized: null,
    unit: null,
    currency: null,
    period: "2026년 2분기",
    scope: "연결",
    valueKind: null,
    stance: "supporting",
    required: true,
    criticalNumeric: false,
  };

  const evidence = validateEvidenceCandidate(
    candidate,
    source,
    "2026-07-25T00:00:00Z",
  );

  assert.equal(evidence.machineStatus, "passed");
  assert.equal(evidence.locator.pageNumber, 2);
  assert.equal(evidence.locator.textFragment, quoteExact);
});

test("뉴스 원문은 실제 기사 메타데이터와 보수적 이용 가능 시점을 추출한다", () => {
  const articleBody =
    "ISC는 신규 수주와 생산능력 확대 계획을 발표했다. ".repeat(12);
  const html = `<!doctype html>
    <html><head>
      <meta property="og:type" content="article">
      <meta property="og:site_name" content="테스트경제">
      <link rel="canonical" href="https://news.example.com/article/isc">
      <script type="application/ld+json">${JSON.stringify({
        "@type": "NewsArticle",
        headline: "ISC 신규 수주 확대",
        datePublished: "2026-07-20",
        publisher: { name: "테스트경제" },
        articleBody,
      })}</script>
    </head><body><article>${articleBody}</article></body></html>`;
  const source: ResearchSourceSnapshot = {
    sourceKey: "url:news",
    sourceType: "NEWS",
    title: "news.example.com",
    publisher: "news.example.com",
    canonicalUrl: "https://news.example.com/article/isc?tracking=1",
    publishedAt: null,
    collectedAt: "2026-07-25T00:00:00Z",
    responseHash: "b".repeat(64),
    locator: { kind: "html" },
    content: { contentType: "text/html; charset=utf-8", body: html },
    collectorVersion: "test-v1",
  };

  const metadata = extractArticleMetadata(source);
  assert.equal(metadata.title, "ISC 신규 수주 확대");
  assert.equal(metadata.publisher, "테스트경제");
  assert.equal(metadata.datePrecision, "day");
  assert.equal(metadata.publishedAt, "2026-07-20T00:00:00+09:00");
  assert.equal(metadata.availableAt, "2026-07-21T00:00:00+09:00");
  assert.equal(
    metadata.canonicalUrl,
    "https://news.example.com/article/isc",
  );
  assert.match(metadata.body, /ISC는 신규 수주/);
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
          suggestedSourceTypes: ["ECOS", "NEWS"],
          included: true,
          collectionTargets: [
            { label: "원/미국달러", resultTypes: ["number"] },
          ],
          sourceBindingIds: ["ECOS", "NEWS"],
          collectionMethods: {
            ECOS: "code_then_agent",
            NEWS: "research_agent",
          },
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
    assert.equal(
      result.warnings.some(
        (warning) => warning.code === "NEWS_NO_ELIGIBLE_ARTICLES",
      ),
      true,
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

test("DART 수집은 최근 연간 실적을 포함하고 기준일 이후 분기는 제외한다", async () => {
  const previous = {
    apiKey: process.env.OPENDART_API_KEY,
    researchFixture: process.env.REFLO_RESEARCH_TEST_FIXTURE,
    llmFixture: process.env.REFLO_LLM_TEST_FIXTURE,
  };
  process.env.OPENDART_API_KEY = "test-dart-key";
  process.env.REFLO_RESEARCH_TEST_FIXTURE = "0";
  process.env.REFLO_LLM_TEST_FIXTURE = "0";
  const requestedUrls: string[] = [];
  mock.method(
    globalThis,
    "fetch",
    async (input: string | URL | Request) => {
      const url = String(input);
      requestedUrls.push(url);
      const query = new URL(url).searchParams;
      const annual = query.get("bsns_year") === "2025";
      return new Response(
        JSON.stringify({
          status: "000",
          list: [
            {
              rcept_no: annual
                ? "20260318000001"
                : "20260514000001",
              bsns_year: annual ? "2025" : "2026",
              account_nm: "매출액",
              thstrm_amount: annual ? "1065290000000" : "346310000000",
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    },
  );
  try {
    const result = await collectResearchSources({
      projectId: "project-1",
      companyMasterId: "company-1",
      companyName: "대덕전자",
      corpCode: "00126380",
      ticker: "353200",
      exchange: "KOSPI",
      targetYear: 2026,
      targetQuarter: 1,
      cutoffDate: "2026-04-30",
      cutoffAt: "2026-04-30T23:59:59.999+09:00",
      questions: [
        {
          questionId: "question-1",
          order: 1,
          text: "최근 확정 실적은 무엇인가?",
          purpose: "실적 확인",
          metrics: ["매출액"],
          period: "2025년 연간",
          comparison: "전년",
          suggestedSourceTypes: ["DART"],
          included: true,
          collectionTargets: [
            { label: "매출액", resultTypes: ["number"] },
          ],
          sourceBindingIds: ["DART"],
          collectionMethods: { DART: "code_then_agent" },
          validationErrors: [],
        },
      ],
      excelTargets: [],
      userUrls: [],
      sourceReferences: [],
    });

    assert.equal(requestedUrls.length, 2);
    assert.match(requestedUrls[0] ?? "", /bsns_year=2025/);
    assert.match(requestedUrls[0] ?? "", /reprt_code=11011/);
    assert.match(requestedUrls[1] ?? "", /bsns_year=2026/);
    assert.match(requestedUrls[1] ?? "", /reprt_code=11013/);
    const source = result.sources[0];
    assert.equal(source?.publishedAt, "2026-03-18T00:00:00+09:00");
    const rows = source?.content.rows as Array<{
      _reflo_period?: string;
    }>;
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?._reflo_period, "2025년 연간");
  } finally {
    mock.restoreAll();
    if (previous.apiKey === undefined) delete process.env.OPENDART_API_KEY;
    else process.env.OPENDART_API_KEY = previous.apiKey;
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
