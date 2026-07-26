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
        formula: null,
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
    metric: "매출액",
    period: "2025년 연간",
    unit: "십억원",
    scope: "연결",
    valueKind: "actual",
    writeAuthority: "system",
    required: true,
    included: true,
    sourcePolicy: [{ sourceType: "DART", role: "authority" }],
    mappingSlotIds: ["slot-12"],
    excludedReason: null,
  });
});

test("skips formula cells and keeps non-core statement rows optional", () => {
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

  assert.equal(targets.length, 1);
  assert.equal(targets[0]?.metric, "매출채권");
  assert.equal(targets[0]?.required, false);
});
