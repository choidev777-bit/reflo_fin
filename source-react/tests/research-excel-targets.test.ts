import assert from "node:assert/strict";
import test from "node:test";
import { createActualFinancialTargets } from "../server/domain/research-excel-targets";

test("creates DART targets for the forecast column becoming actual", () => {
  const targets = createActualFinancialTargets({
    targetYear: 2026,
    candidateCells: [
      {
        sheetId: "sheet-12",
        sheetName: "12_p4_손익계산서",
        address: "D5",
        label: "매출액 · 2025F",
        rawValue: 1065.3,
        formula: "'M1_실적추정_모델'!J16",
      },
      {
        sheetId: "sheet-12",
        sheetName: "12_p4_손익계산서",
        address: "E5",
        label: "매출액 · 2026F",
        rawValue: 1485.5,
        formula: null,
      },
    ],
    mappingSlotIdsBySheetId: new Map([["sheet-12", ["slot-12"]]]),
  });

  assert.equal(targets.length, 1);
  assert.deepEqual(targets[0], {
    targetId: "actual:sheet-12:D5:2025",
    sheetId: "sheet-12",
    sheetName: "12_p4_손익계산서",
    address: "D5",
    metricId: "revenue",
    metric: "매출액",
    period: "2025년 연간",
    periodSpec: {
      type: "annual",
      year: 2025,
      quarter: null,
      basis: "annual",
    },
    unit: "십억원",
    targetUnit: "KRW_BILLION",
    scope: "연결",
    scopeCode: "CFS",
    valueKind: "actual",
    dartRuleId: "revenue-rule-v1",
    writeAuthority: "system",
    required: true,
    included: true,
    sourcePolicy: [{ sourceType: "DART", role: "authority" }],
    mappingSlotIds: ["slot-12"],
    excludedReason: null,
  });
});

test("skips unregistered statement rows", () => {
  const targets = createActualFinancialTargets({
    targetYear: 2026,
    candidateCells: [
      {
        sheetId: "sheet-12",
        sheetName: "12_p4_손익계산서",
        address: "D7",
        label: "매출총이익 · 2025F",
        rawValue: 108.1,
        formula: "D5-D6",
      },
      {
        sheetId: "sheet-13",
        sheetName: "13_p4_대차대조표",
        address: "D8",
        label: "매출채권 · 2025F",
        rawValue: 197.7,
        formula: null,
      },
    ],
  });

  assert.equal(targets.length, 0);
});

test("재무상태표 실제값은 누적이 아닌 결산일 시점 값으로 만든다", () => {
  const targets = createActualFinancialTargets({
    targetYear: 2026,
    candidateCells: [
      {
        sheetId: "sheet-13",
        sheetName: "13_p4_대차대조표",
        address: "D5",
        label: "자산총계 · 2025F",
        rawValue: 2200,
        formula: null,
      },
    ],
  });

  assert.equal(targets.length, 1);
  assert.equal(targets[0]?.metricId, "total_assets");
  assert.equal(targets[0]?.periodSpec?.basis, "point_in_time");
});

test("분기 차트와 전망표의 실제 분기 셀을 DART target으로 만든다", () => {
  const targets = createActualFinancialTargets({
    targetYear: 2026,
    targetQuarter: 1,
    candidateCells: [
      {
        sheetId: "sheet-08",
        sheetName: "08_도표4_분기실적추이",
        address: "B5",
        label: "매출액 · 1Q25",
        rawValue: 215.4,
        formula: null,
      },
      {
        sheetId: "sheet-08",
        sheetName: "08_도표4_분기실적추이",
        address: "V5",
        label: "1Q26",
        rawValue: 330,
        formula: null,
      },
      {
        sheetId: "sheet-11",
        sheetName: "11_도표7_분기실적전망_수정전",
        address: "E19",
        label: "OP · 4Q25",
        rawValue: 29,
        formula: null,
      },
      {
        sheetId: "sheet-11",
        sheetName: "11_도표7_분기실적전망_수정전",
        address: "F19",
        label: "OP · 1Q26F",
        rawValue: 31.1,
        formula: null,
      },
    ],
    mappingSlotIdsBySheetId: new Map([
      ["sheet-08", ["slot-08"]],
      ["sheet-11", ["slot-11"]],
    ]),
  });

  assert.equal(targets.length, 3);
  assert.deepEqual(
    targets.map((target) => [
      target.sheetId,
      target.address,
      target.metricId,
      target.periodSpec?.basis,
    ]),
    [
      ["sheet-08", "V5", "revenue", "year_to_date"],
      ["sheet-11", "E19", "operating_profit", "single_quarter"],
      ["sheet-11", "F19", "operating_profit", "year_to_date"],
    ],
  );
});
