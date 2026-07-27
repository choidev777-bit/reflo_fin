import assert from "node:assert/strict";
import test from "node:test";
import { validateDartExcelTarget } from "../server/domain/dart-value-validator";
import { collectOfficialExcelValues } from "../server/domain/official-excel-values";
import type {
  ResearchExcelTarget,
  ResearchSourceSnapshot,
} from "../server/domain/research-validation";

function target(
  overrides: Partial<ResearchExcelTarget> = {},
): ResearchExcelTarget {
  return {
    targetId: "revenue-2026-q2",
    sheetId: "sheet-income",
    sheetName: "손익계산서",
    address: "E12",
    metricId: "revenue",
    metric: "매출액",
    period: "2026년 2분기 단독",
    periodSpec: {
      type: "quarter",
      year: 2026,
      quarter: 2,
      basis: "single_quarter",
    },
    unit: "억원",
    targetUnit: "KRW_100M",
    scope: "연결",
    scopeCode: "CFS",
    valueKind: "actual",
    dartRuleId: "revenue-rule-v1",
    writeAuthority: "system",
    required: true,
    included: true,
    sourcePolicy: [{ sourceType: "DART", role: "authority" }],
    mappingSlotIds: ["slot-income"],
    excludedReason: null,
    ...overrides,
  };
}

function dartSource(input: {
  quarter: 1 | 2 | 3 | 4;
  amount: string;
  receiptNumber: string;
  accountId?: string;
  accountName?: string;
  scope?: "CFS" | "OFS";
  statementCode?: "IS" | "CIS" | "BS" | "CF";
  publishedAt?: string;
  duplicate?: boolean;
  corpCode?: string;
}): ResearchSourceSnapshot {
  const publishedAt =
    input.publishedAt ??
    (input.quarter === 1
      ? "2026-05-15T00:00:00+09:00"
      : input.quarter === 2
        ? "2026-08-14T00:00:00+09:00"
        : input.quarter === 3
          ? "2026-11-14T00:00:00+09:00"
          : "2027-03-18T00:00:00+09:00");
  const row = {
    rcept_no: input.receiptNumber,
    reprt_code:
      input.quarter === 1
        ? "11013"
        : input.quarter === 2
          ? "11012"
          : input.quarter === 3
            ? "11014"
            : "11011",
    bsns_year: "2026",
    corp_name: "대덕전자",
    account_id: input.accountId ?? "ifrs-full_Revenue",
    account_nm: input.accountName ?? "매출액",
    fs_div: input.scope ?? "CFS",
    fs_nm: input.scope === "OFS" ? "재무제표" : "연결재무제표",
    sj_div: input.statementCode ?? "CIS",
    sj_nm:
      input.statementCode === "BS"
        ? "연결 재무상태표"
        : "연결 포괄손익계산서",
    thstrm_nm: `2026년 ${input.quarter}분기 누적`,
    thstrm_amount: input.amount,
    currency: "KRW",
  };
  return {
    sourceKey: `dart:${input.corpCode ?? "00126380"}:2026:${row.reprt_code}:${input.receiptNumber}`,
    sourceType: "DART",
    title: `대덕전자 2026년 ${input.quarter}분기 재무제표`,
    publisher: "금융감독원 전자공시시스템",
    canonicalUrl:
      `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${input.receiptNumber}`,
    publishedAt,
    collectedAt: "2026-07-16T00:00:00+09:00",
    responseHash: "a".repeat(64),
    locator: {
      kind: "structured_api",
      rceptNo: input.receiptNumber,
    },
    content: {
      report: {
        corpCode: input.corpCode ?? "00126380",
        businessYear: 2026,
        quarter: input.quarter,
        reportCode: row.reprt_code,
        receiptNumber: input.receiptNumber,
        publishedAt,
      },
      rows: input.duplicate ? [row, { ...row }] : [row],
    },
    collectorVersion: "test-v1",
  };
}

test("DART 규칙 엔진은 2분기 단독값을 두 누적 보고서로 계산하고 모두 추적한다", () => {
  const result = validateDartExcelTarget({
    target: target(),
    sources: [
      dartSource({
        quarter: 1,
        amount: "300000000000",
        receiptNumber: "20260515000001",
      }),
      dartSource({
        quarter: 2,
        amount: "750000000000",
        receiptNumber: "20260814000001",
      }),
    ],
    cutoffAt: "2026-08-31T23:59:59.999+09:00",
  });

  assert.equal(result.machineStatus, "passed");
  assert.equal(result.valueOriginal, "450000000000");
  assert.equal(result.valueNormalized, "4500");
  assert.equal(result.evidence.length, 2);
  assert.deepEqual(
    result.evidence.map((item) => item.locator.receiptNumber).sort(),
    ["20260515000001", "20260814000001"],
  );
  assert.ok(
    result.evidence.every(
      (item) =>
        item.locator.targetId === "revenue-2026-q2" &&
        item.locator.selectedField === "thstrm_amount",
    ),
  );
});

test("DART 규칙 엔진은 프로젝트와 다른 회사의 보고서를 사용하지 않는다", () => {
  const result = validateDartExcelTarget({
    target: target({
      period: "2026년 1분기",
      periodSpec: {
        type: "quarter",
        year: 2026,
        quarter: 1,
        basis: "single_quarter",
      },
    }),
    sources: [
      dartSource({
        quarter: 1,
        amount: "300000000000",
        receiptNumber: "20260515000001",
        corpCode: "00999999",
      }),
    ],
    cutoffAt: "2026-05-31T23:59:59.999+09:00",
    corpCode: "00126380",
  });

  assert.equal(result.machineStatus, "failed");
  assert.equal(result.statusCode, "report_unavailable");
  assert.equal(result.evidence.length, 0);
});

test("DART 응답 행이 fs_div를 생략해도 요청 snapshot의 단일 범위를 유지한다", () => {
  const source = dartSource({
    quarter: 1,
    amount: "300000000000",
    receiptNumber: "20260515000001",
  });
  const report = source.content.report as Record<string, unknown>;
  const rows = source.content.rows as Array<Record<string, unknown>>;
  report.scopeCodes = ["CFS"];
  delete rows[0].fs_div;

  const result = validateDartExcelTarget({
    target: target({
      period: "2026년 1분기",
      periodSpec: {
        type: "quarter",
        year: 2026,
        quarter: 1,
        basis: "single_quarter",
      },
    }),
    sources: [source],
    cutoffAt: "2026-05-31T23:59:59.999+09:00",
  });

  assert.equal(result.machineStatus, "passed");
  assert.equal(result.statusCode, "validated");
  assert.equal(result.evidence[0]?.locator.fsDiv, "CFS");
});

test("1·3·4분기 단독값과 연간값은 보고서 종류별 공식으로 계산한다", () => {
  const q1 = validateDartExcelTarget({
    target: target({
      targetId: "revenue-2026-q1",
      period: "2026년 1분기 단독",
      periodSpec: {
        type: "quarter",
        year: 2026,
        quarter: 1,
        basis: "single_quarter",
      },
    }),
    sources: [
      dartSource({
        quarter: 1,
        amount: "300000000000",
        receiptNumber: "20260515000001",
      }),
    ],
    cutoffAt: "2026-05-31T23:59:59.999+09:00",
  });
  const q3 = validateDartExcelTarget({
    target: target({
      targetId: "revenue-2026-q3",
      period: "2026년 3분기 단독",
      periodSpec: {
        type: "quarter",
        year: 2026,
        quarter: 3,
        basis: "single_quarter",
      },
    }),
    sources: [
      dartSource({
        quarter: 2,
        amount: "750000000000",
        receiptNumber: "20260814000001",
      }),
      dartSource({
        quarter: 3,
        amount: "1200000000000",
        receiptNumber: "20261114000001",
      }),
    ],
    cutoffAt: "2026-11-30T23:59:59.999+09:00",
  });
  const q4 = validateDartExcelTarget({
    target: target({
      targetId: "revenue-2026-q4",
      period: "2026년 4분기 단독",
      periodSpec: {
        type: "quarter",
        year: 2026,
        quarter: 4,
        basis: "single_quarter",
      },
    }),
    sources: [
      dartSource({
        quarter: 3,
        amount: "1200000000000",
        receiptNumber: "20261114000001",
      }),
      dartSource({
        quarter: 4,
        amount: "1700000000000",
        receiptNumber: "20270318000001",
      }),
    ],
    cutoffAt: "2027-03-31T23:59:59.999+09:00",
  });
  const annual = validateDartExcelTarget({
    target: target({
      targetId: "revenue-2026-annual",
      period: "2026년 연간",
      periodSpec: {
        type: "annual",
        year: 2026,
        quarter: null,
        basis: "annual",
      },
    }),
    sources: [
      dartSource({
        quarter: 4,
        amount: "1700000000000",
        receiptNumber: "20270318000001",
      }),
    ],
    cutoffAt: "2027-03-31T23:59:59.999+09:00",
  });

  assert.equal(q1.valueNormalized, "3000");
  assert.equal(q1.evidence.length, 1);
  assert.equal(q3.valueNormalized, "4500");
  assert.equal(q3.evidence.length, 2);
  assert.equal(q4.valueNormalized, "5000");
  assert.equal(q4.evidence.length, 2);
  assert.equal(annual.valueNormalized, "17000");
  assert.equal(annual.evidence.length, 1);
});

test("기준일 이전 최신 정정공시만 사용하고 이후 정정본은 배제한다", () => {
  const beforeCutoff = dartSource({
    quarter: 1,
    amount: "300000000000",
    receiptNumber: "20260515000001",
    publishedAt: "2026-05-15T00:00:00+09:00",
  });
  const afterCutoff = dartSource({
    quarter: 1,
    amount: "999000000000",
    receiptNumber: "20260615000001",
    publishedAt: "2026-06-15T00:00:00+09:00",
  });
  const result = validateDartExcelTarget({
    target: target({
      period: "2026년 1분기 누적",
      periodSpec: {
        type: "quarter",
        year: 2026,
        quarter: 1,
        basis: "year_to_date",
      },
    }),
    sources: [beforeCutoff, afterCutoff],
    cutoffAt: "2026-05-31T23:59:59.999+09:00",
  });

  assert.equal(result.valueNormalized, "3000");
  assert.equal(
    result.evidence[0]?.locator.receiptNumber,
    "20260515000001",
  );
});

test("계정이 다른 연결·별도 범위에만 있으면 범위 불일치로 차단한다", () => {
  const result = validateDartExcelTarget({
    target: target({
      period: "2026년 1분기 누적",
      periodSpec: {
        type: "quarter",
        year: 2026,
        quarter: 1,
        basis: "year_to_date",
      },
    }),
    sources: [
      dartSource({
        quarter: 1,
        amount: "300000000000",
        receiptNumber: "20260515000001",
        scope: "OFS",
      }),
    ],
    cutoffAt: "2026-05-31T23:59:59.999+09:00",
  });

  assert.equal(result.machineStatus, "failed");
  assert.equal(result.statusCode, "scope_mismatch");
  assert.equal(result.evidence.length, 0);
});

test("DART 계정 후보가 여러 개면 자동 선택하지 않는다", () => {
  const result = validateDartExcelTarget({
    target: target({
      period: "2026년 1분기 누적",
      periodSpec: {
        type: "quarter",
        year: 2026,
        quarter: 1,
        basis: "year_to_date",
      },
    }),
    sources: [
      dartSource({
        quarter: 1,
        amount: "300000000000",
        receiptNumber: "20260515000001",
        duplicate: true,
      }),
    ],
    cutoffAt: "2026-05-31T23:59:59.999+09:00",
  });

  assert.equal(result.machineStatus, "failed");
  assert.equal(result.statusCode, "account_ambiguous");
  assert.equal(result.evidence.length, 0);
});

test("공식 Excel 수집은 KRX 종가를 코드로 선택하고 LLM 후보를 만들지 않는다", () => {
  const krxTarget = target({
    targetId: "current-price",
    metricId: "current_price",
    metric: "현재주가",
    period: "2026-07-17",
    periodSpec: {
      type: "date",
      year: 2026,
      quarter: null,
      basis: "point_in_time",
    },
    unit: "원",
    targetUnit: "KRW",
    dartRuleId: null,
    sourcePolicy: [{ sourceType: "KRX", role: "authority" }],
  });
  const source: ResearchSourceSnapshot = {
    sourceKey: "krx:353200:2026-07-17",
    sourceType: "KRX",
    title: "대덕전자 기준일 종가",
    publisher: "한국거래소",
    canonicalUrl: "https://data.krx.co.kr/",
    publishedAt: "2026-07-17T15:30:00+09:00",
    collectedAt: "2026-07-17T16:00:00+09:00",
    responseHash: "b".repeat(64),
    locator: {
      kind: "structured_api",
      parameters: { ticker: "353200" },
      jsonPointer: "/selectedRow/TDD_CLSPRC",
      selectedRecord: "selectedRow",
    },
    content: {
      tradingDate: "2026-07-17",
      closePrice: 32100,
      currency: "KRW",
      selectedRow: {
        BAS_DD: "20260717",
        ISU_CD: "353200",
        ISU_NM: "대덕전자",
        MKT_NM: "KOSPI",
        TDD_CLSPRC: "32,100",
      },
    },
    collectorVersion: "krx-test-v1",
  };

  const results = collectOfficialExcelValues({
    targets: [krxTarget],
    sources: [source],
    cutoffAt: "2026-07-17T23:59:59.999+09:00",
  });
  assert.equal(results[0]?.machineStatus, "passed");
  assert.equal(results[0]?.valueNormalized, "32100");
  assert.equal(results[0]?.evidence[0]?.sourceKey, source.sourceKey);
  assert.equal(
    results[0]?.evidence[0]?.locator.selectedField,
    "TDD_CLSPRC",
  );

  const tampered = collectOfficialExcelValues({
    targets: [krxTarget],
    sources: [
      {
        ...source,
        content: {
          ...source.content,
          selectedRow: {
            ...(source.content.selectedRow as Record<string, unknown>),
            TDD_CLSPRC: "99,900",
          },
        },
      },
    ],
    cutoffAt: "2026-07-17T23:59:59.999+09:00",
  });
  assert.equal(tampered[0]?.machineStatus, "failed");
});

test("KRX 값은 기준일 이후 자료를 제외하고 가장 가까운 거래일을 선택한다", () => {
  const krxTarget = target({
    targetId: "current-price",
    metricId: "current_price",
    metric: "현재주가",
    period: "2026-07-17",
    periodSpec: {
      type: "date",
      year: 2026,
      quarter: null,
      basis: "point_in_time",
    },
    unit: "원",
    targetUnit: "KRW",
    dartRuleId: null,
    sourcePolicy: [{ sourceType: "KRX", role: "authority" }],
  });
  const krxSource = (
    tradingDate: string,
    closePrice: number,
  ): ResearchSourceSnapshot => ({
    sourceKey: `krx:353200:${tradingDate}`,
    sourceType: "KRX",
    title: "대덕전자 기준일 종가",
    publisher: "한국거래소",
    canonicalUrl: "https://data.krx.co.kr/",
    publishedAt: `${tradingDate}T15:30:00+09:00`,
    collectedAt: `${tradingDate}T16:00:00+09:00`,
    responseHash: "c".repeat(64),
    locator: {
      kind: "structured_api",
      parameters: { ticker: "353200" },
      jsonPointer: "/selectedRow/TDD_CLSPRC",
      selectedRecord: "selectedRow",
    },
    content: {
      tradingDate,
      closePrice,
      currency: "KRW",
      selectedRow: {
        BAS_DD: tradingDate.replaceAll("-", ""),
        ISU_CD: "353200",
        ISU_NM: "대덕전자",
        MKT_NM: "KOSPI",
        TDD_CLSPRC: closePrice.toLocaleString("en-US"),
      },
    },
    collectorVersion: "krx-test-v1",
  });

  const results = collectOfficialExcelValues({
    targets: [krxTarget],
    sources: [
      krxSource("2026-07-16", 31000),
      krxSource("2026-07-17", 32100),
      krxSource("2026-07-20", 99900),
    ],
    cutoffAt: "2026-07-17T23:59:59.999+09:00",
  });

  assert.equal(results[0]?.valueNormalized, "32100");
  assert.equal(
    results[0]?.evidence[0]?.sourceKey,
    "krx:353200:2026-07-17",
  );
});

test("ECOS 환율은 등록된 통계표·항목의 기준일 이전 최신값만 채택한다", () => {
  const ecosTarget = target({
    targetId: "usd-krw",
    metricId: "usd_krw_exchange_rate",
    metric: "원달러 환율",
    period: "2026-07-17",
    periodSpec: {
      type: "date",
      year: 2026,
      quarter: null,
      basis: "point_in_time",
    },
    unit: "원/달러",
    targetUnit: "KRW",
    dartRuleId: null,
    sourcePolicy: [{ sourceType: "ECOS", role: "authority" }],
  });
  const source: ResearchSourceSnapshot = {
    sourceKey: "ecos:731Y001:0000001:20260717",
    sourceType: "ECOS",
    title: "원/미국달러 환율",
    publisher: "한국은행 경제통계시스템",
    canonicalUrl: "https://ecos.bok.or.kr/",
    publishedAt: "2026-07-17T00:00:00+09:00",
    collectedAt: "2026-07-17T10:00:00+09:00",
    responseHash: "c".repeat(64),
    locator: {
      kind: "structured_api",
      parameters: {
        statCode: "731Y001",
        cycle: "D",
        itemCode: "0000001",
      },
    },
    content: {
      latest: { TIME: "20260717", DATA_VALUE: "1386.4" },
    },
    collectorVersion: "ecos-test-v1",
  };

  const [result] = collectOfficialExcelValues({
    targets: [ecosTarget],
    sources: [source],
    cutoffAt: "2026-07-17T23:59:59.999+09:00",
  });

  assert.equal(result?.machineStatus, "passed");
  assert.equal(result?.valueNormalized, "1386.4");
  assert.equal(result?.evidence[0]?.locator.selectedField, "DATA_VALUE");
});
