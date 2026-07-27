import assert from "node:assert/strict";
import test from "node:test";
import { buildReportPeriodPlan } from "../server/domain/report-period-plan";
import {
  buildResearchReportTargets,
  type ReportMappingEntry,
} from "../server/domain/research-report-targets";
import type { ResearchExcelTarget } from "../server/domain/research-validation";

const periodPlan = buildReportPeriodPlan({
  targetYear: 2026,
  targetQuarter: 1,
  cutoffDate: "2026-03-31",
});

function entry(
  patch: Partial<ReportMappingEntry> = {},
): ReportMappingEntry {
  return {
    mappingEntryId: "mapping-1",
    slotId: "slot-1",
    metric: "income_statement_table",
    kind: "table",
    required: true,
    mappingState: "connected",
    pageNumber: 4,
    pageLabel: "4",
    candidate: {
      sourceType: "range",
      sheetId: "sheet-12",
      sheetName: "12_p4_손익계산서",
      address: "A4:G35",
      label: "구분",
      periodLabels: ["2023", "2024", "2025F", "2026F", "2027F"],
    },
    ...patch,
  };
}

function executableTarget(
  patch: Partial<ResearchExcelTarget> = {},
): ResearchExcelTarget {
  return {
    targetId: "target-1",
    sheetId: "sheet-12",
    sheetName: "12_p4_손익계산서",
    address: "B5",
    metric: "매출액",
    period: "2025",
    unit: "백만원",
    scope: "연결",
    valueKind: "actual",
    required: true,
    included: true,
    sourcePolicy: [{ sourceType: "DART", role: "authority" }],
    mappingSlotIds: ["slot-1"],
    excludedReason: null,
    ...patch,
  };
}

test("annual report target separates carry-forward, actual collection, and forecasts", () => {
  const [target] = buildResearchReportTargets({
    entries: [entry()],
    periodPlan,
    executableTargets: [executableTarget()],
  });

  assert.equal(target.title, "손익계산서");
  assert.equal(target.status, "collection_required");
  assert.deepEqual(
    target.periods.map((period) => [period.label, period.action]),
    [
      ["2024", "keep"],
      ["2025", "collect"],
      ["2026F", "later_stage"],
      ["2027F", "later_stage"],
      ["2028F", "later_stage"],
    ],
  );
  assert.deepEqual(target.periods[1]?.sourcePolicy, [
    { sourceType: "DART", role: "authority" },
  ]);
});

test("valuation output remains visible but moves to the later-stage group", () => {
  const [target] = buildResearchReportTargets({
    entries: [
      entry({
        metric: "target_price",
        kind: "scalar",
        pageNumber: 1,
        candidate: {
          sourceType: "cell",
          sheetId: "sheet-m2",
          sheetName: "M2_목표주가_타겟멀티플",
          address: "C21",
          label: "목표주가",
          periodLabels: [],
        },
      }),
    ],
    periodPlan,
    executableTargets: [],
  });

  assert.equal(target.title, "목표주가");
  assert.equal(target.status, "later_stage");
  assert.equal(target.periods[0]?.action, "later_stage");
  assert.equal(target.sourcePolicy.length, 0);
});

test("backlog chart identifies missing quarters after the workbook history", () => {
  const [target] = buildResearchReportTargets({
    entries: [
      entry({
        metric: "figure_5_chart",
        kind: "chart",
        pageNumber: 2,
        candidate: {
          sourceType: "chart",
          sheetId: "sheet-09",
          sheetName: "09_도표5_수주잔고추이",
          address: "B4:T4",
          label: "구분",
          periodLabels: [
            "1Q21",
            "2Q21",
            "3Q21",
            "4Q21",
            "1Q22",
            "2Q22",
            "3Q22",
            "4Q22",
            "1Q23",
            "2Q23",
            "3Q23",
            "4Q23",
            "1Q24",
            "2Q24",
            "3Q24",
            "4Q24",
            "1Q25",
            "2Q25",
            "3Q25",
          ],
        },
      }),
    ],
    periodPlan,
    executableTargets: [],
  });

  assert.equal(target.status, "later_stage");
  assert.deepEqual(
    target.periods.map((period) => [period.label, period.action]),
    [
      ["1Q21–3Q25", "keep"],
      ["4Q25", "later_stage"],
      ["1Q26", "later_stage"],
    ],
  );
  assert.deepEqual(target.sourcePolicy, []);
  assert.match(target.reasons[0] ?? "", /IR 원문/);
});

test("quarterly performance replaces the target-quarter forecast with actual data", () => {
  const [target] = buildResearchReportTargets({
    entries: [
      entry({
        metric: "figure_4_chart",
        kind: "chart",
        candidate: {
          sourceType: "chart",
          sheetId: "sheet-08",
          sheetName: "08_도표4_분기실적추이",
          address: "B4:Y4",
          label: "구분",
          periodLabels: [
            "1Q25",
            "2Q25",
            "3Q25",
            "4Q25",
            "1Q26",
            "2Q26",
            "3Q26",
            "4Q26",
          ],
        },
      }),
    ],
    periodPlan,
    executableTargets: [
      executableTarget({
        targetId: "figure-4-target",
        sheetId: "sheet-08",
        sheetName: "08_도표4_분기실적추이",
        address: "V5",
        mappingSlotIds: [],
      }),
    ],
  });

  assert.deepEqual(
    target.periods.map((period) => [period.label, period.action]),
    [
      ["1Q25–4Q25", "keep"],
      ["1Q26", "collect"],
    ],
  );
  assert.equal(target.status, "collection_required");
  assert.deepEqual(target.sourcePolicy, [
    { sourceType: "DART", role: "authority" },
  ]);
});

test("deferred market data stays collectible without an Excel candidate", () => {
  const [target] = buildResearchReportTargets({
    entries: [
      entry({
        metric: "current_price",
        kind: "scalar",
        mappingState: "review_required",
        pageNumber: 1,
        candidate: null,
      }),
    ],
    periodPlan,
    executableTargets: [
      executableTarget({
        targetId: "current-price-target",
        sheetId: "market-data",
        sheetName: "현재주가",
        address: "A1",
        metric: "현재주가",
        period: "2026-03-31",
        sourcePolicy: [{ sourceType: "KRX", role: "authority" }],
      }),
    ],
  });

  assert.equal(target.status, "collection_required");
  assert.equal(target.destinationLabel, "현재주가 슬롯");
  assert.deepEqual(target.sourcePolicy, [
    { sourceType: "KRX", role: "authority" },
  ]);
});

test("FnGuide-dependent targets remain a transparent connection task", () => {
  const [target] = buildResearchReportTargets({
    entries: [
      entry({
        metric: "consensus_data",
        kind: "table",
        mappingState: "review_required",
        candidate: null,
      }),
    ],
    periodPlan,
    executableTargets: [],
  });

  assert.equal(target.status, "connection_required");
  assert.ok(target.periods.some((period) => period.action === "connect"));
  assert.match(target.reasons[0] ?? "", /FnGuide/);
});

test("required collection targets without an executable target remain blocking", () => {
  const targets = buildResearchReportTargets({
    entries: [
      entry(),
      entry({
        mappingEntryId: "mapping-2",
        slotId: "slot-2",
        metric: "figure_4_chart",
        kind: "chart",
        candidate: {
          sourceType: "chart",
          sheetId: "sheet-08",
          sheetName: "08_도표4_분기실적추이",
          address: "B4:Y4",
          label: "구분",
          periodLabels: ["1Q25", "2Q25", "3Q25", "4Q25"],
        },
      }),
    ],
    periodPlan,
    executableTargets: [executableTarget()],
  });

  const missingTarget = targets.find(
    (target) => target.metric === "figure_4_chart",
  );
  assert.equal(missingTarget?.status, "connection_required");
  assert.deepEqual(missingTarget?.executableTargetIds, []);
});

test("unmapped report element is shown as a connection task", () => {
  const [target] = buildResearchReportTargets({
    entries: [
      entry({
        metric: "unknown_chart",
        kind: "chart",
        mappingState: "unmapped",
        candidate: null,
      }),
    ],
    periodPlan,
    executableTargets: [],
  });

  assert.equal(target.status, "connection_required");
  assert.equal(target.periods[0]?.action, "connect");
});
