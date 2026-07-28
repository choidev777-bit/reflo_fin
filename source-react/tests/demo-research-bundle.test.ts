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
const DEMO_CORP_CODE = "01478712";

/**
 * 시연 Excel(대덕전자 리서치 보고서)이 실제로 요구하는 DART 입력 대상.
 *
 * 여러 시트·셀이 같은 계정을 가리키는 구성이 핵심이다. 2025 기준연도 묶음에는
 * 매출액·영업이익·당기순이익이 각각 두 번 들어 있고, 2026년 1분기 묶음에는
 * 매출액·영업이익이 각각 세 번 들어 있다.
 */
const DEMO_EXCEL_TARGETS: Array<
  [string, string, string, string, string, string, string, "annual" | "quarter", number, 1 | 2 | 3 | 4 | null, string]
> = [
  ["actual:sheet_17:D13:2025", "sheet_17", "12_p4_손익계산서", "D13", "profit_before_tax", "세전이익", "2025년 연간", "annual", 2025, null, "annual"],
  ["actual:sheet_17:D17:2025", "sheet_17", "12_p4_손익계산서", "D17", "net_income", "당기순이익", "2025년 연간", "annual", 2025, null, "annual"],
  ["actual:sheet_17:D19:2025", "sheet_17", "12_p4_손익계산서", "D19", "controlling_net_income", "지배주주순이익", "2025년 연간", "annual", 2025, null, "annual"],
  ["actual:sheet_17:D5:2025", "sheet_17", "12_p4_손익계산서", "D5", "revenue", "매출액", "2025년 연간", "annual", 2025, null, "annual"],
  ["actual:sheet_17:D9:2025", "sheet_17", "12_p4_손익계산서", "D9", "operating_profit", "영업이익", "2025년 연간", "annual", 2025, null, "annual"],
  ["actual:sheet_18:D17:2025", "sheet_18", "13_p4_대차대조표", "D17", "total_assets", "자산총계", "2025년 연간", "annual", 2025, null, "point_in_time"],
  ["actual:sheet_18:D25:2025", "sheet_18", "13_p4_대차대조표", "D25", "total_liabilities", "부채총계", "2025년 연간", "annual", 2025, null, "point_in_time"],
  ["actual:sheet_18:D33:2025", "sheet_18", "13_p4_대차대조표", "D33", "total_equity", "자본총계", "2025년 연간", "annual", 2025, null, "point_in_time"],
  ["actual:sheet_20:D5:2025", "sheet_20", "15_p4_현금흐름표", "D5", "operating_cash_flow", "영업활동 현금흐름", "2025년 연간", "annual", 2025, null, "annual"],
  ["actual:sheet_20:D6:2025", "sheet_20", "15_p4_현금흐름표", "D6", "net_income", "당기순이익", "2025년 연간", "annual", 2025, null, "annual"],
  ["quarterly:sheet_13:V5:2026Q1", "sheet_13", "08_도표4_분기실적추이", "V5", "revenue", "매출액", "2026년 1분기", "quarter", 2026, 1, "year_to_date"],
  ["quarterly:sheet_13:V6:2026Q1", "sheet_13", "08_도표4_분기실적추이", "V6", "operating_profit", "영업이익", "2026년 1분기", "quarter", 2026, 1, "year_to_date"],
  ["quarterly:sheet_15:F19:2026Q1", "sheet_15", "10_도표6_분기실적전망_수정후", "F19", "operating_profit", "영업이익", "2026년 1분기", "quarter", 2026, 1, "year_to_date"],
  ["quarterly:sheet_15:F5:2026Q1", "sheet_15", "10_도표6_분기실적전망_수정후", "F5", "revenue", "매출액", "2026년 1분기", "quarter", 2026, 1, "year_to_date"],
  ["quarterly:sheet_16:E19:2025Q4", "sheet_16", "11_도표7_분기실적전망_수정전", "E19", "operating_profit", "영업이익", "2025년 4분기", "quarter", 2025, 4, "single_quarter"],
  ["quarterly:sheet_16:E5:2025Q4", "sheet_16", "11_도표7_분기실적전망_수정전", "E5", "revenue", "매출액", "2025년 4분기", "quarter", 2025, 4, "single_quarter"],
  ["quarterly:sheet_16:F19:2026Q1", "sheet_16", "11_도표7_분기실적전망_수정전", "F19", "operating_profit", "영업이익", "2026년 1분기", "quarter", 2026, 1, "year_to_date"],
  ["quarterly:sheet_16:F5:2026Q1", "sheet_16", "11_도표7_분기실적전망_수정전", "F5", "revenue", "매출액", "2026년 1분기", "quarter", 2026, 1, "year_to_date"],
];

function demoExcelTargets() {
  return DEMO_EXCEL_TARGETS.map(
    ([
      targetId,
      sheetId,
      sheetName,
      address,
      metricId,
      metric,
      period,
      type,
      year,
      quarter,
      basis,
    ]) => ({
      targetId,
      sheetId,
      sheetName,
      address,
      metricId,
      metric,
      period,
      periodSpec: { type, year, quarter, basis },
      unit: "십억원",
      targetUnit: "KRW_BILLION" as const,
      scope: "연결",
      scopeCode: "CFS" as const,
      valueKind: "actual" as const,
      dartRuleId: `${metricId.replaceAll("_", "-")}-rule-v1`,
      writeAuthority: "system" as const,
      required: true,
      included: true,
      sourcePolicy: [{ sourceType: "DART" as const, role: "authority" as const }],
      mappingSlotIds: [`slot_${targetId}`],
      excludedReason: null,
    }),
  );
}

function demoContext(excelTargets: ReturnType<typeof demoExcelTargets> = []) {
  return {
    projectId: "019fa61f-5949-7354-b798-38aca3cc607f",
    companyMasterId: "019fa61f-5949-7354-b798-38aca3cc6070",
    companyName: "대덕전자",
    corpCode: DEMO_CORP_CODE,
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
    excelTargets,
    userUrls: [],
    sourceReferences: [],
    newsDiscoveryResults: [],
    allowEmpty: true,
  };
}

async function collectInDemoMode(
  excelTargets: ReturnType<typeof demoExcelTargets> = [],
) {
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
      demoContext(excelTargets) as unknown as Parameters<
        typeof collectResearchSources
      >[0],
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
  assert.ok(publishers.has("대덕전자 IR"));
});

test("시연 근거는 실제 값과 열리는 원문 링크를 갖는다", async () => {
  const bundle = await collectInDemoMode();
  const dart = bundle.sources.filter((source) => source.sourceType === "DART");
  const ir = bundle.sources.filter(
    (source) => source.sourceType === "COMPANY_IR",
  );

  for (const source of [...dart, ...ir]) {
    // example.com 링크는 시연에서 "Example Domain" 안내 페이지로 열린다.
    assert.ok(
      source.canonicalUrl && !source.canonicalUrl.includes("example.com"),
      `원문 링크가 자리표시입니다: ${source.canonicalUrl}`,
    );
  }

  for (const source of dart) {
    // 합성 접수번호는 형식이 실제와 같아 다른 회사 공시가 열린다.
    assert.ok(
      source.canonicalUrl?.includes("20260514001471"),
      `DART 링크가 실제 대덕전자 접수번호가 아닙니다: ${source.canonicalUrl}`,
    );
    const content = source.content as Record<string, unknown>;
    assert.ok(
      Array.isArray(content.rows) && content.rows.length > 0,
      "DART 근거에 계정 행이 없으면 값·기간이 비어 보입니다.",
    );
    // 원문 표는 실제 DART에서 받아 오므로 건수는 네트워크에 달려 있다. 여기서는
    // 표를 직접 만들어 넣지 않는다는 계약만 확인한다. 발췌본을 합성하면 화면에
    // 보이는 것이 원본이 아니게 된다.
    assert.ok(
      content.originalStatements === undefined ||
        Array.isArray(content.originalStatements),
      "원문 표는 실제 공시에서 받은 배열이어야 합니다.",
    );
    for (const statement of (content.originalStatements ?? []) as Array<{
      html?: string;
    }>) {
      assert.ok(
        !statement.html?.includes("그 종속기업</p>"),
        "합성한 표가 섞여 있습니다. 원문 표는 DART에서 받은 것만 씁니다.",
      );
    }
  }

  // 근거 한 줄 요약에 실제 숫자가 보여야 조사 결과처럼 읽힌다.
  const dartCandidates = bundle.candidates.filter((candidate) =>
    candidate.sourceKey.endsWith(":DART"),
  );
  assert.ok(dartCandidates.length > 0);
  for (const candidate of dartCandidates) {
    assert.match(
      candidate.oneLineValue,
      /\d/,
      `근거 요약에 숫자가 없습니다: ${candidate.oneLineValue}`,
    );
    assert.ok(
      candidate.valueOriginal && /^\-?\d+$/.test(candidate.valueOriginal),
      `근거에 원본 값이 없습니다: ${candidate.valueOriginal}`,
    );
  }

  // IR 근거는 업로드 자료의 실제 서술이어야 한다.
  const irCandidates = bundle.candidates.filter((candidate) =>
    candidate.sourceKey.endsWith(":COMPANY_IR"),
  );
  for (const candidate of irCandidates) {
    assert.ok(
      candidate.quoteExact.length > 30 &&
        !candidate.quoteExact.includes("확인되었습니다"),
      `IR 인용이 자리표시 문장입니다: ${candidate.quoteExact}`,
    );
  }
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

/**
 * STEP 05 `다음`은 stage gate가 열려야 활성화되고, gate는 필수 Excel 대상이
 * 하나라도 검증되지 않으면 REQUIRED_NUMERIC_UNAVAILABLE·EXCEL_EVIDENCE_MISSING로
 * 닫힌다. 같은 DART 계정을 가리키는 대상이 여러 개일 때 고정 원문이 계정 행을
 * 중복 생성하면 resolveDartRow가 ambiguous로 판정해 그 계정이 전부 실패했다.
 */
test("시연 원문은 Excel 대상이 겹쳐도 계정 행을 하나만 만든다", async () => {
  const targets = demoExcelTargets();
  const bundle = await collectInDemoMode(targets);
  const dartFixtures = bundle.sources.filter((source) =>
    source.sourceKey.startsWith("fixture:dart:"),
  );
  assert.ok(dartFixtures.length > 0, "Excel 대상용 DART 원문이 없습니다.");

  for (const source of dartFixtures) {
    const rows = (source.content as { rows?: Array<Record<string, string>> })
      .rows;
    assert.ok(Array.isArray(rows) && rows.length > 0);
    const keys = rows.map(
      (row) => `${row.fs_div}:${row.sj_div}:${row.account_id}`,
    );
    assert.equal(
      new Set(keys).size,
      keys.length,
      `${source.sourceKey}에 같은 계정 행이 두 번 있습니다. ` +
        "resolveDartRow가 ambiguous로 판정해 해당 대상이 모두 검증 실패합니다.",
    );
  }
});

test("시연 Excel 대상은 전부 검증을 통과해 STEP 05 gate를 연다", async () => {
  const targets = demoExcelTargets();
  const bundle = await collectInDemoMode(targets);
  const { validateDartExcelTarget } = await import(
    "../server/domain/dart-value-validator"
  );

  const failures: string[] = [];
  const values = new Map<string, string | null>();
  for (const target of targets) {
    const result = validateDartExcelTarget({
      target: target as never,
      sources: bundle.sources as never,
      cutoffAt: CUTOFF_AT,
      corpCode: DEMO_CORP_CODE,
    });
    values.set(target.targetId, result.valueNormalized);
    if (result.machineStatus !== "passed") {
      failures.push(`${target.targetId}: ${result.oneLineValue}`);
    }
  }
  assert.deepEqual(
    failures,
    [],
    `필수 Excel 대상이 검증되지 않아 STEP 05 \`다음\`이 막힙니다:\n${failures.join("\n")}`,
  );

  // 시연 화면에 실제 공시 금액이 보여야 한다. 합성 값이 섞이면 4Q25 매출이
  // 연간 매출을 넘는 숫자로 표시된다.
  assert.equal(values.get("actual:sheet_17:D5:2025"), "1065.294559811");
  assert.equal(values.get("actual:sheet_17:D17:2025"), "47.60532769");
  assert.equal(values.get("actual:sheet_17:D19:2025"), "47.60532769");
  assert.equal(values.get("quarterly:sheet_13:V5:2026Q1"), "346.31416369");
  assert.equal(values.get("quarterly:sheet_13:V6:2026Q1"), "51.29810885");
  // 4Q25 = 2025 연간 − 3Q25 누적
  assert.equal(values.get("quarterly:sheet_16:E5:2025Q4"), "317.887737499");
  assert.equal(values.get("quarterly:sheet_16:E19:2025Q4"), "28.949052994");
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
