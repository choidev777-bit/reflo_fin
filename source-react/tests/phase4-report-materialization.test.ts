import assert from "node:assert/strict";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import {
  assertRequiredReportMaterializationsReady,
  attachTemplateGeometry,
  compactReportMaterializations,
  generatedBandBindingsFromBridge,
  hydrateReportMaterializations,
  materializeReportBindings,
  validateReportDocument,
  type ReportMappingBinding,
  type ReportMaterializationContext,
  type ReportDocument,
  type ReportTemplatePage,
  type ReportWorkbookCell,
} from "../server/domain/report";
import { serializeReportMaterializationArtifact } from "../server/domain/report-materialization";
import { valuationWorkbookLineageIsCurrent } from "../server/domain/valuation";
import workerResultSchemas from "../server/domain/generated/worker-result-schemas.json";
import {
  parseReportBindingDefinition,
  reportMaterializationRetryDecision,
} from "../server/infrastructure/repositories/report-repository";
import { buildReportPeriodPlan } from "../server/domain/report-period-plan";

const contractAjv = new Ajv2020({
  allErrors: true,
  strict: true,
  strictRequired: false,
});
addFormats(contractAjv);
for (const schema of workerResultSchemas) contractAjv.addSchema(schema);
const validateReportMaterialization = contractAjv.getSchema(
  "https://schemas.reflo.dev/worker/v1/report-materialization.schema.json",
);
if (!validateReportMaterialization) {
  throw new Error("ReportMaterialization contract schema unavailable.");
}

function cell(
  address: string,
  row: number,
  column: number,
  rawValue: string | null,
  formattedText = rawValue ?? "",
  formula: string | null = null,
  numberFormat = "General",
): ReportWorkbookCell {
  return {
    address,
    row,
    column,
    valueType: rawValue === null ? "blank" : "number",
    rawValue,
    formattedText,
    formula,
    numberFormat,
  };
}

function context(
  cells: ReportWorkbookCell[],
  overrides: Partial<ReportMaterializationContext> = {},
): ReportMaterializationContext {
  return {
    sourceSnapshotId: "source-snapshot-1",
    mappingSetResourceVersionId: "mapping-version-1",
    workbookArtifactId: "workbook-artifact-1",
    workbookVersion: 4,
    validationApprovalVersionId: "validation-approval-1",
    valuationApprovalVersionId: "valuation-approval-1",
    readModel: {
      schemaVersion: "1.2",
      workbookHash: "a".repeat(64),
      sheets: [{ sheetId: "sheet-data", name: "Data", cells }],
    },
    ...overrides,
  };
}

test("valuation approval pins the exact validated Workbook lineage", () => {
  const approved = {
    validationApprovalId: "validation-approval-1",
    validatedValueSetResourceVersionId: "validated-values-1",
    validatedWorkbookResourceVersionId: "validated-workbook-1",
    sourceWorkbookResourceVersionId: "source-workbook-1",
    mappingSetResourceVersionId: "mapping-set-1",
    workbookArtifactId: "workbook-artifact-1",
    workbookHash: "a".repeat(64),
    structureHash: "b".repeat(64),
    inputFingerprint: "c".repeat(64),
  };
  assert.equal(
    valuationWorkbookLineageIsCurrent(approved, structuredClone(approved)),
    true,
  );
  assert.equal(
    valuationWorkbookLineageIsCurrent(approved, {
      ...approved,
      validatedWorkbookResourceVersionId: "validated-workbook-2",
    }),
    false,
  );
  assert.equal(
    valuationWorkbookLineageIsCurrent(approved, {
      ...approved,
      workbookArtifactId: "workbook-artifact-2",
    }),
    false,
  );
});

test("failed or cancelled report runs advance to a fresh attempt", () => {
  assert.deepEqual(reportMaterializationRetryDecision("running", 2), {
    reuse: true,
    nextAttempt: 2,
  });
  assert.deepEqual(reportMaterializationRetryDecision("succeeded", 2), {
    reuse: true,
    nextAttempt: 2,
  });
  assert.deepEqual(reportMaterializationRetryDecision("failed", 2), {
    reuse: false,
    nextAttempt: 3,
  });
  assert.deepEqual(reportMaterializationRetryDecision("cancelled", 2), {
    reuse: false,
    nextAttempt: 3,
  });
});

test("scalar snapshot resolves Workbook cells and approved market data", () => {
  const materializationContext = context(
    [cell("B2", 2, 2, "12401", "12,401원", "=B1/C1", "#,##0")],
    {
      authoritativeScalars: [
        {
          metric: "current_price",
          sourceType: "market_price_snapshot",
          sourceAddress: "current_price",
          rawValue: "80100",
          formattedValue: "80,100원",
          valueType: "money",
          unit: "KRW",
          period: "2026-07-25",
          authority: "user_decision",
          sourceDecision: "KRX cutoff snapshot",
        },
      ],
    },
  );
  const bindings: ReportMappingBinding[] = [
    {
      slotId: "slot-eps",
      metric: "eps",
      kind: "scalar",
      status: "confirmed",
      sourceLabel: "Data B2",
      sourceAddress: "B2",
      sourceType: "cell",
      sourceSheetId: "sheet-data",
      sourceSheetName: "Data",
      definition: {
        kind: "scalar",
        valueType: "money",
        source: {
          sheetId: "sheet-data",
          sheetName: "Data",
          address: "B2",
          structureFingerprint: "eps-cell",
        },
        verificationSources: [],
        display: { formatCode: "#,##0", suffix: "원" },
        unit: "KRW",
        period: "12MF",
        styleTemplateRef: "scalar-style-eps",
      },
    },
    {
      slotId: "slot-current-price",
      metric: "current_price",
      kind: "scalar",
      status: "confirmed",
      sourceLabel: "KRX cutoff snapshot",
      sourceAddress: "current_price",
      sourceType: "market_price_snapshot",
      definition: null,
    },
  ];

  const snapshots = materializeReportBindings(bindings, materializationContext);
  const eps = snapshots["slot-eps"];
  const currentPrice = snapshots["slot-current-price"];
  assert.equal(eps.kind, "scalar");
  assert.equal(eps.status, "ready");
  if (eps.kind === "scalar") {
    assert.equal(eps.rawValue, "12401");
    assert.equal(eps.formattedValue, "12,401원");
    assert.equal(eps.authority, "formula");
    assert.equal(eps.styleTemplateRef, "scalar-style-eps");
  }
  assert.equal(currentPrice.kind, "scalar");
  assert.equal(currentPrice.status, "ready");
  if (currentPrice.kind === "scalar") {
    assert.equal(currentPrice.rawValue, "80100");
    assert.equal(currentPrice.formattedValue, "80,100원");
    assert.equal(
      currentPrice.provenance.sourceSnapshotId,
      "source-snapshot-1",
    );
  }
});

test("EPS, PER, target price, and current price are all ready from approved authorities", () => {
  const authorities = [
    {
      metric: "eps",
      sourceType: "valuation_approval",
      sourceAddress: "forward_eps",
      rawValue: "12401",
      formattedValue: "12,401원",
      valueType: "money" as const,
      unit: "KRW/share",
      period: "12MF",
      authority: "formula" as const,
      sourceDecision: "approved valuation workbook",
    },
    {
      metric: "per",
      sourceType: "valuation_approval",
      sourceAddress: "target_per",
      rawValue: "14.2",
      formattedValue: "14.2배",
      valueType: "decimal" as const,
      unit: "multiple",
      period: "12MF",
      authority: "user_decision" as const,
      sourceDecision: "valuation approval",
    },
    {
      metric: "target_price",
      sourceType: "valuation_approval",
      sourceAddress: "target_price",
      rawValue: "176094",
      formattedValue: "176,094원",
      valueType: "money" as const,
      unit: "KRW",
      period: null,
      authority: "user_decision" as const,
      sourceDecision: "valuation approval",
    },
    {
      metric: "current_price",
      sourceType: "market_price_snapshot",
      sourceAddress: "current_price",
      rawValue: "80100",
      formattedValue: "80,100원",
      valueType: "money" as const,
      unit: "KRW",
      period: "2026-07-25",
      authority: "user_decision" as const,
      sourceDecision: "KRX cutoff snapshot",
    },
  ];
  const bindings: ReportMappingBinding[] = authorities.map(
    (authority, index) => ({
      slotId: `slot-${authority.metric}`,
      pageId: "page-cover",
      blockId: `block-${authority.metric}`,
      metric: authority.metric,
      kind: "scalar",
      status: "confirmed",
      sourceLabel: authority.sourceDecision,
      sourceAddress: authority.sourceAddress,
      sourceType: authority.sourceType,
      styleTemplateRef: `style-${index}`,
      definition: null,
    }),
  );
  const snapshots = materializeReportBindings(
    bindings,
    context([], {
      readModel: null,
      authoritativeScalars: authorities,
    }),
  );
  assert.deepEqual(
    bindings.map((binding) => snapshots[binding.slotId].status),
    ["ready", "ready", "ready", "ready"],
  );
  assert.deepEqual(
    bindings.map((binding) => {
      const snapshot = snapshots[binding.slotId];
      return snapshot.kind === "scalar" ? snapshot.rawValue : null;
    }),
    ["12401", "14.2", "176094", "80100"],
  );
  assert.deepEqual(
    [
      ...new Set(
        Object.values(snapshots).map(
          (snapshot) => snapshot.provenance.sourceSnapshotId,
        ),
      ),
    ],
    ["source-snapshot-1"],
  );
});

test("table snapshot preserves exact matrices, merges, dimensions, styles, and row roles", () => {
  const cells = [
    {
      ...cell("A1", 1, 1, "손익계산서"),
      valueType: "string",
      style: { bold: true, fill: "#f5f7f3" },
    },
    cell("B1", 1, 2, null),
    { ...cell("A2", 2, 1, "매출액"), valueType: "string" },
    cell("B2", 2, 2, "120", "120", "=100+20", "#,##0"),
    { ...cell("A3", 3, 1, "영업이익"), valueType: "string" },
    cell("B3", 3, 2, "35", "35", "=B2*0.2917", "#,##0"),
  ];
  const materializationContext = context(cells, {
    readModel: {
      schemaVersion: "1.2",
      workbookHash: "b".repeat(64),
      sheets: [
        {
          sheetId: "sheet-data",
          name: "Data",
          columnWidths: [
            { column: 1, widthPixels: 120, hidden: false },
            { column: 2, widthPixels: 80, hidden: false },
          ],
          rowHeights: [
            { row: 1, heightPixels: 24, hidden: false },
            { row: 2, heightPixels: 20, hidden: false },
            { row: 3, heightPixels: 20, hidden: false },
          ],
          mergedRanges: [
            { firstRow: 1, firstColumn: 1, lastRow: 1, lastColumn: 2 },
          ],
          cells,
        },
      ],
    },
  });
  const binding: ReportMappingBinding = {
    slotId: "slot-income-statement",
    metric: "income_statement",
    kind: "table",
    status: "confirmed",
    sourceLabel: "Data A1:B3",
    sourceAddress: "A1:B3",
    sourceType: "range",
    definition: {
      kind: "table",
      source: {
        sheetId: "sheet-data",
        sheetName: "Data",
        address: "A1:B3",
        structureFingerprint: "financial-table",
      },
      rowKeyColumn: "A",
      columnHeaderRow: 1,
      expectedRows: 3,
      expectedColumns: 2,
      subtotalRows: [3],
      unitRows: [],
      forecastRows: [2],
      styleTemplateRef: "table-style-financial",
    },
  };

  const snapshot = materializeReportBindings(
    [binding],
    materializationContext,
  )[binding.slotId];
  assert.equal(snapshot.kind, "table");
  assert.equal(snapshot.status, "ready");
  if (snapshot.kind === "table") {
    assert.deepEqual(snapshot.rawMatrix, [
      ["손익계산서", null],
      ["매출액", "120"],
      ["영업이익", "35"],
    ]);
    assert.deepEqual(snapshot.formulaMatrix, [
      [null, null],
      [null, "=100+20"],
      [null, "=B2*0.2917"],
    ]);
    assert.deepEqual(snapshot.mergedRanges, ["A1:B1"]);
    assert.deepEqual(snapshot.rowHeightsPt, [18, 15, 15]);
    assert.deepEqual(snapshot.columnWidthsPt, [90, 60]);
    assert.deepEqual(snapshot.subtotalRows, [2]);
    assert.deepEqual(snapshot.forecastRows, [1]);
    assert.equal(snapshot.headers[0].style?.bold, true);
    assert.equal(snapshot.styleTemplateRef, "table-style-financial");
  }
});

test("final report validation blocks stale financial statement periods", () => {
  const labels = ["구분", "2023", "2024", "2025F", "2026F", "2027F"];
  const cells = labels.flatMap((label, index) => [
    {
      ...cell(
        `${String.fromCharCode(65 + index)}1`,
        1,
        index + 1,
        label,
        label,
      ),
      valueType: "string",
    },
    cell(`${String.fromCharCode(65 + index)}2`, 2, index + 1, String(index)),
  ]);
  const binding: ReportMappingBinding = {
    slotId: "slot-financial-periods",
    metric: "income_statement_table",
    kind: "table",
    status: "confirmed",
    sourceLabel: "12_p4_손익계산서 A1:F2",
    sourceAddress: "A1:F2",
    sourceType: "range",
    definition: {
      kind: "table",
      source: {
        sheetId: "sheet-income-statement",
        sheetName: "12_p4_손익계산서",
        address: "A1:F2",
        structureFingerprint: "income-statement-periods",
      },
      rowKeyColumn: "A",
      columnHeaderRow: 1,
      expectedRows: 2,
      expectedColumns: 6,
    },
  };
  const snapshot = materializeReportBindings(
    [binding],
    context(cells, {
      readModel: {
        schemaVersion: "1.2",
        workbookHash: "c".repeat(64),
        sheets: [
          {
            sheetId: "sheet-income-statement",
            name: "12_p4_손익계산서",
            cells,
          },
        ],
      },
    }),
  )[binding.slotId];
  const document: ReportDocument = {
    schemaVersion: "1.0",
    pageCount: 1,
    pages: [
      {
        pageId: "page-financials",
        pageNumber: 1,
        pageLabel: "4",
        role: "financials",
        widthPt: 595,
        heightPt: 842,
        rotation: 0,
        blocks: [
          {
            blockId: "block-financial-periods",
            pageId: "page-financials",
            role: "visual",
            label: "손익계산서",
            text: "손익계산서",
            editable: false,
            revision: 1,
            evidenceIds: [],
            numericAuthority: "mapping_set",
            templateBlockId: "template-financial-periods",
            bbox: [10, 10, 300, 400],
            sourceObjectIds: [],
            dataBinding: {
              slotId: binding.slotId,
              metric: binding.metric,
              kind: "table",
              status: "confirmed",
              sourceLabel: binding.sourceLabel,
              sourceAddress: binding.sourceAddress,
              sourceType: binding.sourceType,
            },
            materializedData: snapshot,
            patchStrategy: "fixed",
          },
        ],
      },
    ],
  };

  const issues = validateReportDocument({
    document,
    templatePageIds: ["page-financials"],
    evidenceIds: new Set(),
    valuationText: {
      targetPer: "10",
      targetPrice: "100000",
      forwardEps: "10000",
    },
    reportPeriodPlan: buildReportPeriodPlan({
      targetYear: 2026,
      targetQuarter: 1,
      cutoffDate: "2026-04-30",
    }),
  });

  assert.ok(
    issues.some((issue) => issue.code === "REPORT_PERIOD_HEADER_MISMATCH"),
  );
});

test("the four financial statement ranges materialize independently", () => {
  const definitions = [
    ["income_statement_table", 1, "손익계산서", "120"],
    ["balance_sheet_table", 4, "대차대조표", "220"],
    ["investment_indicators_table", 7, "투자지표", "14.2"],
    ["cash_flow_statement_table", 10, "현금흐름표", "320"],
  ] as const;
  const cells = definitions.flatMap(([, startColumn, label, value]) => [
    {
      ...cell(
        `${String.fromCharCode(64 + startColumn)}1`,
        1,
        startColumn,
        "구분",
      ),
      valueType: "string",
    },
    {
      ...cell(
        `${String.fromCharCode(65 + startColumn)}1`,
        1,
        startColumn + 1,
        "2026F",
      ),
      valueType: "string",
    },
    {
      ...cell(
        `${String.fromCharCode(64 + startColumn)}2`,
        2,
        startColumn,
        label,
      ),
      valueType: "string",
    },
    cell(
      `${String.fromCharCode(65 + startColumn)}2`,
      2,
      startColumn + 1,
      value,
    ),
  ]);
  const bindings: ReportMappingBinding[] = definitions.map(
    ([metric, startColumn]) => {
      const first = String.fromCharCode(64 + startColumn);
      const last = String.fromCharCode(65 + startColumn);
      return {
        slotId: `slot-${metric}`,
        metric,
        kind: "table",
        status: "confirmed",
        sourceLabel: `Data ${first}1:${last}2`,
        sourceAddress: `${first}1:${last}2`,
        sourceType: "range",
        definition: {
          kind: "table",
          source: {
            sheetId: "sheet-data",
            sheetName: "Data",
            address: `${first}1:${last}2`,
            structureFingerprint: `${metric}-range`,
          },
          rowKeyColumn: first,
          columnHeaderRow: 1,
          expectedRows: 2,
          expectedColumns: 2,
          styleTemplateRef: `style-${metric}`,
        },
      };
    },
  );
  const snapshots = materializeReportBindings(bindings, context(cells));
  assert.deepEqual(
    bindings.map((binding) => snapshots[binding.slotId].status),
    ["ready", "ready", "ready", "ready"],
  );
  assert.deepEqual(
    bindings.map((binding) => {
      const snapshot = snapshots[binding.slotId];
      return snapshot.kind === "table" ? snapshot.rawMatrix[1][1] : null;
    }),
    ["120", "220", "14.2", "320"],
  );
});

test("composite chart aligns categories and preserves axes, roles, and chart types", () => {
  const cells = [
    { ...cell("A2", 2, 1, "2026-03-01", "2026.03"), valueType: "date" },
    { ...cell("A3", 3, 1, "2026-01-01", "2026.01"), valueType: "date" },
    { ...cell("A4", 4, 1, "2026-02-01", "2026.02"), valueType: "date" },
    cell("B2", 2, 2, "30"),
    cell("B3", 3, 2, "10"),
    cell("B4", 4, 2, "20"),
    cell("C2", 2, 3, "3.0", "3.0%", null, "0.0%"),
    cell("C3", 3, 3, "1.0", "1.0%", null, "0.0%"),
    cell("C4", 4, 3, "2.0", "2.0%", null, "0.0%"),
  ];
  const binding: ReportMappingBinding = {
    slotId: "slot-composite",
    metric: "revenue_margin",
    kind: "chart",
    status: "confirmed",
    sourceLabel: "Data A2:C4",
    sourceAddress: "A2:C4",
    sourceType: "chart",
    definition: {
      kind: "composite_chart",
      categories: {
        sheetId: "sheet-data",
        sheetName: "Data",
        address: "A2:A4",
        structureFingerprint: "categories",
      },
      series: [
        {
          seriesId: "revenue",
          label: "매출액",
          source: {
            sheetId: "sheet-data",
            sheetName: "Data",
            address: "B2:B4",
            structureFingerprint: "revenue",
          },
          axis: "primary",
          role: "actual",
          chartType: "bar",
          estimateType: "actual",
          unit: "KRW",
          numberFormat: "#,##0",
        },
        {
          seriesId: "margin",
          label: "영업이익률",
          source: {
            sheetId: "sheet-data",
            sheetName: "Data",
            address: "C2:C4",
            structureFingerprint: "margin",
          },
          axis: "secondary",
          role: "forecast",
          chartType: "line",
          estimateType: "forecast",
          unit: "percent",
          numberFormat: "0.0%",
        },
      ],
      styleTemplateRef: "chart-style-composite",
    },
  };

  const snapshot = materializeReportBindings([binding], context(cells))[
    binding.slotId
  ];
  assert.equal(snapshot.kind, "composite_chart");
  assert.equal(snapshot.status, "ready");
  if (snapshot.kind === "composite_chart") {
    assert.deepEqual(
      snapshot.categories.map((item) => item.rawValue),
      ["2026-01-01", "2026-02-01", "2026-03-01"],
    );
    assert.deepEqual(
      snapshot.series[0].values.map((item) => item.rawValue),
      ["10", "20", "30"],
    );
    assert.equal(snapshot.series[0].chartType, "bar");
    assert.equal(snapshot.series[1].axis, "secondary");
    assert.equal(snapshot.series[1].role, "forecast");
    assert.equal(snapshot.primaryAxis.position, "left");
    assert.equal(snapshot.secondaryAxis?.position, "right");
  }
});

const bandBinding: ReportMappingBinding = {
  slotId: "slot-pe-band",
  metric: "pe_band",
  kind: "chart",
  status: "confirmed",
  sourceLabel: "_REFLO_BRIDGE P/E band",
  sourceAddress: "A2:D4",
  sourceType: "generated_range",
  definition: {
    kind: "chart",
    categories: {
      sheetId: "_REFLO_BRIDGE",
      sheetName: "_REFLO_BRIDGE",
      address: "A2:A4",
      structureFingerprint: "bridge-category",
    },
    series: [
      {
        seriesId: "price",
        label: "주가",
        source: {
          sheetId: "_REFLO_BRIDGE",
          sheetName: "_REFLO_BRIDGE",
          address: "B2:B4",
          structureFingerprint: "bridge-price",
        },
        axis: "primary",
        role: "actual",
        chartType: "line",
        estimateType: "actual",
      },
      {
        seriesId: "upper",
        label: "상단 밴드",
        source: {
          sheetId: "_REFLO_BRIDGE",
          sheetName: "_REFLO_BRIDGE",
          address: "C2:C4",
          structureFingerprint: "bridge-upper",
        },
        axis: "primary",
        role: "band_upper",
        chartType: "line",
        estimateType: "forecast",
      },
      {
        seriesId: "lower",
        label: "하단 밴드",
        source: {
          sheetId: "_REFLO_BRIDGE",
          sheetName: "_REFLO_BRIDGE",
          address: "D2:D4",
          structureFingerprint: "bridge-lower",
        },
        axis: "primary",
        role: "band_lower",
        chartType: "line",
        estimateType: "forecast",
      },
    ],
    styleTemplateRef: "style-pe-band",
  },
};

test("band chart fixtures fail closed when a required series is missing", () => {
  const cells = [
    { ...cell("A2", 2, 1, "2025-01-01"), valueType: "date" },
    { ...cell("A3", 3, 1, "2025-02-01"), valueType: "date" },
    { ...cell("A4", 4, 1, "2025-03-01"), valueType: "date" },
    cell("B2", 2, 2, "76000"),
    cell("B3", 3, 2, "79000"),
    cell("B4", 4, 2, "81000"),
    cell("C2", 2, 3, "90000"),
    cell("C3", 3, 3, "92000"),
    cell("C4", 4, 3, "94000"),
    cell("D2", 2, 4, "60000"),
    cell("D3", 3, 4, "62000"),
    cell("D4", 4, 4, "64000"),
  ];
  const bridgeContext = context(cells, {
    readModel: {
      schemaVersion: "1.2",
      workbookHash: "d".repeat(64),
      sheets: [
        { sheetId: "_REFLO_BRIDGE", name: "_REFLO_BRIDGE", cells },
      ],
    },
  });
  const ready = materializeReportBindings([bandBinding], bridgeContext)[
    bandBinding.slotId
  ];
  assert.equal(ready.status, "ready");

  const insufficient = structuredClone(bandBinding);
  assert.equal(insufficient.definition?.kind, "chart");
  if (insufficient.definition?.kind === "chart") {
    insufficient.definition.series = insufficient.definition.series.filter(
      (series) => series.seriesId !== "lower",
    );
  }
  const blocked = materializeReportBindings([insufficient], bridgeContext)[
    insufficient.slotId
  ];
  assert.equal(blocked.status, "blocked");
  assert.equal(blocked.blockerCode, "BAND_SERIES_INCOMPLETE");
});

function bridgeTextCell(
  address: string,
  row: number,
  column: number,
  value: string,
): ReportWorkbookCell {
  return {
    ...cell(address, row, column, value),
    valueType: "string",
  };
}

function bridgeHeaderCells(): ReportWorkbookCell[] {
  return [
    "target_id",
    "approved_value",
    "evidence_ids",
    "metric",
    "period",
    "unit",
    "scope",
  ].map((value, index) =>
    bridgeTextCell(`${String.fromCharCode(65 + index)}1`, 1, index + 1, value),
  );
}

function bridgeSemanticRow(input: {
  row: number;
  family: "P/E" | "P/B";
  metric: string;
  period: string;
  value: string;
  unit: string;
  evidenceId?: string;
}): ReportWorkbookCell[] {
  const values = [
    `target-${input.family.replace("/", "").toLowerCase()}-${input.row}`,
    input.value,
    input.evidenceId ?? `evidence-${input.row}`,
    input.metric,
    input.period,
    input.unit,
    `12MF ${input.family} Band`,
  ];
  return values.map((value, index) => {
    const created = cell(
      `${String.fromCharCode(65 + index)}${input.row}`,
      input.row,
      index + 1,
      value,
    );
    return index === 1
      ? created
      : { ...created, valueType: "string" };
  });
}

function generatedBandBinding(
  family: "pe" | "pb",
): ReportMappingBinding {
  return {
    slotId: `slot-${family}-generated-band`,
    metric: `${family}_band`,
    kind: "chart",
    status: "confirmed",
    sourceLabel: `_REFLO_BRIDGE ${family.toUpperCase()} band`,
    sourceAddress: "A1:G17",
    sourceType: "generated_range",
    sourceSheetId: "_REFLO_BRIDGE",
    sourceSheetName: "_REFLO_BRIDGE",
    definition: {
      kind: "generated_band_chart",
      source: {
        sheetId: "_REFLO_BRIDGE",
        sheetName: "_REFLO_BRIDGE",
        address: "A1:G17",
        structureFingerprint: "bridge-generator-v1",
      },
      bandFamily: family,
      generatorId: "bridge_generator_v1",
      sourceEvidenceIds: Array.from(
        { length: 16 },
        (_, index) => `evidence-${index + 2}`,
      ),
      styleTemplateRef: `style-${family}-band`,
    },
  };
}

test("generated range contract restores a typed P/E or P/B bridge binding", () => {
  const definition = parseReportBindingDefinition({
    kind: "generated_range",
    semanticKey: {
      metric: "figure_2_chart",
      scope: "12MF P/E Band",
    },
    source: {
      sheetId: "_REFLO_BRIDGE",
      sheet: "_REFLO_BRIDGE",
      range: "A1:G17",
      authority: "authoritative",
      structureFingerprint: "a".repeat(64),
      generatorId: "bridge_generator_v1",
      sourceEvidenceIds: ["evidence-2", "evidence-3"],
    },
    styleTemplateRef: "style-figure-2",
  });
  assert.deepEqual(definition, {
    kind: "generated_band_chart",
    source: {
      sheetId: "_REFLO_BRIDGE",
      sheetName: "_REFLO_BRIDGE",
      address: "A1:G17",
      structureFingerprint: "a".repeat(64),
    },
    bandFamily: "pe",
    generatorId: "bridge_generator_v1",
    sourceEvidenceIds: ["evidence-2", "evidence-3"],
    styleTemplateRef: "style-figure-2",
  });
});

function generatedBandCells(): ReportWorkbookCell[] {
  return [
    ...bridgeHeaderCells(),
    ...bridgeSemanticRow({
      row: 2,
      family: "P/E",
      metric: "adjusted_price",
      period: "2025-01",
      value: "10000",
      unit: "KRW",
    }),
    ...bridgeSemanticRow({
      row: 3,
      family: "P/E",
      metric: "forward_eps",
      period: "2025-01",
      value: "1000",
      unit: "KRW/share",
    }),
    ...bridgeSemanticRow({
      row: 4,
      family: "P/E",
      metric: "multiple_lower",
      period: "2025-01",
      value: "8",
      unit: "multiple",
    }),
    ...bridgeSemanticRow({
      row: 5,
      family: "P/E",
      metric: "multiple_upper",
      period: "2025-01",
      value: "12",
      unit: "multiple",
    }),
    ...bridgeSemanticRow({
      row: 6,
      family: "P/E",
      metric: "adjusted_price",
      period: "2025-02",
      value: "11000",
      unit: "KRW",
    }),
    ...bridgeSemanticRow({
      row: 7,
      family: "P/E",
      metric: "forward_eps",
      period: "2025-02",
      value: "1100",
      unit: "KRW/share",
    }),
    ...bridgeSemanticRow({
      row: 8,
      family: "P/E",
      metric: "multiple_lower",
      period: "2025-02",
      value: "8",
      unit: "multiple",
    }),
    ...bridgeSemanticRow({
      row: 9,
      family: "P/E",
      metric: "multiple_upper",
      period: "2025-02",
      value: "12",
      unit: "multiple",
    }),
    ...bridgeSemanticRow({
      row: 10,
      family: "P/B",
      metric: "adjusted_price",
      period: "2025-01",
      value: "10000",
      unit: "KRW",
    }),
    ...bridgeSemanticRow({
      row: 11,
      family: "P/B",
      metric: "book_value_per_share",
      period: "2025-01",
      value: "20000",
      unit: "KRW/share",
    }),
    ...bridgeSemanticRow({
      row: 12,
      family: "P/B",
      metric: "multiple_lower",
      period: "2025-01",
      value: "0.5",
      unit: "multiple",
    }),
    ...bridgeSemanticRow({
      row: 13,
      family: "P/B",
      metric: "multiple_upper",
      period: "2025-01",
      value: "1",
      unit: "multiple",
    }),
    ...bridgeSemanticRow({
      row: 14,
      family: "P/B",
      metric: "adjusted_price",
      period: "2025-02",
      value: "11000",
      unit: "KRW",
    }),
    ...bridgeSemanticRow({
      row: 15,
      family: "P/B",
      metric: "book_value_per_share",
      period: "2025-02",
      value: "22000",
      unit: "KRW/share",
    }),
    ...bridgeSemanticRow({
      row: 16,
      family: "P/B",
      metric: "multiple_lower",
      period: "2025-02",
      value: "0.5",
      unit: "multiple",
    }),
    ...bridgeSemanticRow({
      row: 17,
      family: "P/B",
      metric: "multiple_upper",
      period: "2025-02",
      value: "1",
      unit: "multiple",
    }),
  ];
}

test("_REFLO_BRIDGE builds P/E and P/B periods, price, and bands only from approved semantic rows", () => {
  const cells = generatedBandCells();
  const bridgeContext = context(cells, {
    readModel: {
      schemaVersion: "1.2",
      workbookHash: "e".repeat(64),
      sheets: [
        { sheetId: "_REFLO_BRIDGE", name: "_REFLO_BRIDGE", cells },
      ],
    },
  });
  const pe = materializeReportBindings(
    [generatedBandBinding("pe")],
    bridgeContext,
  )["slot-pe-generated-band"];
  const pb = materializeReportBindings(
    [generatedBandBinding("pb")],
    bridgeContext,
  )["slot-pb-generated-band"];

  assert.equal(pe.status, "ready");
  assert.equal(pb.status, "ready");
  if (pe.kind === "chart" && pb.kind === "chart") {
    assert.deepEqual(
      pe.categories.map((item) => item.rawValue),
      ["2025-01", "2025-02"],
    );
    assert.deepEqual(
      pe.series.find((item) => item.role === "band_upper")?.values.map(
        (item) => item.rawValue,
      ),
      ["12000", "13200"],
    );
    assert.deepEqual(
      pb.series.find((item) => item.role === "band_lower")?.values.map(
        (item) => item.rawValue,
      ),
      ["10000", "11000"],
    );
    assert.equal(pe.provenance.sources[0].sheetId, "_REFLO_BRIDGE");
  }
});

test("approved bridge data synthesizes the production P/E template binding", () => {
  const cells = generatedBandCells();
  const readModel = {
    schemaVersion: "1.2",
    workbookHash: "1".repeat(64),
    sheets: [
      { sheetId: "_REFLO_BRIDGE", name: "_REFLO_BRIDGE", cells },
    ],
  };
  const pages: ReportTemplatePage[] = [
    {
      pageId: "page-2",
      pageNumber: 2,
      blocks: [
        {
          blockId: "figure-2",
          role: "visual",
          styleTemplateRef: "style-figure-2",
        },
      ],
      slots: [
        {
          slotId: "slot-figure-2",
          blockId: "figure-2",
          valueType: "chart",
          required: true,
          semanticKey: {
            metric: "figure_2_chart",
            scope: "12MF P/E Band",
          },
        },
      ],
    },
  ];
  const evidenceIds = cells
    .filter((item) => item.column === 3 && item.row > 1)
    .map((item) => item.rawValue!)
    .filter((value, index, all) => all.indexOf(value) === index);

  const bindings = generatedBandBindingsFromBridge(
    pages,
    readModel,
    evidenceIds,
  );

  assert.equal(bindings.length, 1);
  assert.equal(bindings[0].slotId, "slot-figure-2");
  assert.equal(bindings[0].required, true);
  assert.equal(bindings[0].definition?.kind, "generated_band_chart");
  const snapshot = materializeReportBindings(bindings, {
    ...context([]),
    readModel,
  })["slot-figure-2"];
  assert.equal(snapshot.status, "ready");
});

test("generated bands reject evidence outside the pinned source set", () => {
  const binding = generatedBandBinding("pe");
  if (binding.definition?.kind !== "generated_band_chart") {
    throw new Error("generated band fixture is invalid");
  }
  binding.definition.sourceEvidenceIds =
    binding.definition.sourceEvidenceIds.filter(
      (evidenceId) => evidenceId !== "evidence-3",
    );
  const cells = generatedBandCells();
  const snapshot = materializeReportBindings(
    [binding],
    context(cells, {
      readModel: {
        schemaVersion: "1.2",
        workbookHash: "2".repeat(64),
        sheets: [
          { sheetId: "_REFLO_BRIDGE", name: "_REFLO_BRIDGE", cells },
        ],
      },
    }),
  )[binding.slotId];
  assert.equal(snapshot.status, "blocked");
  assert.equal(snapshot.blockerCode, "BAND_EVIDENCE_MISMATCH");
});

test("oversized or out-of-bounds Workbook ranges fail closed", () => {
  for (const address of [
    `A1:A${"9".repeat(400)}`,
    "A1:XFD1048576",
  ]) {
    const binding = generatedBandBinding("pe");
    if (binding.definition?.kind !== "generated_band_chart") {
      throw new Error("generated band fixture is invalid");
    }
    binding.definition.source.address = address;
    const snapshot = materializeReportBindings(
      [binding],
      context([], {
        readModel: {
          schemaVersion: "1.2",
          workbookHash: "3".repeat(64),
          sheets: [
            {
              sheetId: "_REFLO_BRIDGE",
              name: "_REFLO_BRIDGE",
              cells: [],
            },
          ],
        },
      }),
    )[binding.slotId];
    assert.equal(snapshot.status, "blocked");
    assert.equal(snapshot.blockerCode, "BAND_BRIDGE_RANGE_UNAVAILABLE");
  }
});

test("generated bands require compatible currency and dimensionless multiple units", () => {
  for (const [address, unit] of [
    ["F3", "USD/share"],
    ["F4", "KRW"],
  ]) {
    const cells = generatedBandCells().map((item) =>
      item.address === address
        ? { ...item, rawValue: unit, formattedText: unit }
        : item,
    );
    const snapshot = materializeReportBindings(
      [generatedBandBinding("pe")],
      context(cells, {
        readModel: {
          schemaVersion: "1.2",
          workbookHash: "4".repeat(64),
          sheets: [
            { sheetId: "_REFLO_BRIDGE", name: "_REFLO_BRIDGE", cells },
          ],
        },
      }),
    )["slot-pe-generated-band"];
    assert.equal(snapshot.status, "blocked");
    assert.equal(snapshot.blockerCode, "BAND_UNIT_MISMATCH");
  }
});

test("a blocked optional slot is omitted from report materializations", () => {
  const binding = generatedBandBinding("pe");
  binding.required = false;
  const snapshots = materializeReportBindings(
    [binding],
    context([], { readModel: null }),
  );
  assert.equal(snapshots[binding.slotId], undefined);
});

test("an unavailable optional slot keeps the original PDF visual without an overlay", () => {
  const document: ReportDocument = {
    schemaVersion: "1.0",
    pageCount: 1,
    pages: [
      {
        pageId: "draft-page",
        pageNumber: 1,
        pageLabel: "01",
        role: "summary",
        widthPt: 595,
        heightPt: 842,
        rotation: 0,
        blocks: [],
      },
    ],
  };
  const pages: ReportTemplatePage[] = [
    {
      pageId: "template-page",
      pageNumber: 1,
      boxes: { mediaBox: [0, 0, 595, 842] },
      blocks: [
        {
          blockId: "optional-chart-block",
          role: "visual",
          bbox: [10, 10, 100, 100],
        },
      ],
      slots: [
        {
          slotId: "optional-chart",
          blockId: "optional-chart-block",
          valueType: "chart",
          required: false,
          semanticKey: { metric: "optional_metric" },
        },
      ],
    },
  ];
  const hydrated = attachTemplateGeometry(document, pages, [
    {
      slotId: "optional-chart",
      metric: "optional_metric",
      kind: "chart",
      required: false,
      status: "unmapped",
      sourceLabel: null,
      sourceAddress: null,
      sourceType: null,
      definition: null,
    },
  ]);
  assert.equal(
    hydrated.pages[0].blocks.some(
      (block) => block.dataBinding?.slotId === "optional-chart",
    ),
    false,
  );
});

test("_REFLO_BRIDGE P/E and P/B fixtures fail closed without base, multiple, price, or Evidence", () => {
  const cells = generatedBandCells();
  const bridgeContext = (nextCells: ReportWorkbookCell[]) =>
    context(nextCells, {
      readModel: {
        schemaVersion: "1.2",
        workbookHash: "f".repeat(64),
        sheets: [
          {
            sheetId: "_REFLO_BRIDGE",
            name: "_REFLO_BRIDGE",
            cells: nextCells,
          },
        ],
      },
    });
  const missingBps = cells.filter((item) => item.row !== 15);
  const pb = materializeReportBindings(
    [generatedBandBinding("pb")],
    bridgeContext(missingBps),
  )["slot-pb-generated-band"];
  assert.equal(pb.status, "blocked");

  const missingEvidence = cells.map((item) =>
    item.address === "C3"
      ? { ...item, rawValue: "", formattedText: "" }
      : item,
  );
  const pe = materializeReportBindings(
    [generatedBandBinding("pe")],
    bridgeContext(missingEvidence),
  )["slot-pe-generated-band"];
  assert.equal(pe.status, "blocked");
  assert.equal(pe.blockerCode, "BAND_EVIDENCE_MISSING");
});

test("one blocked required block fails the whole report materialization", () => {
  const binding: ReportMappingBinding = {
    slotId: "slot-required-scalar",
    metric: "eps",
    kind: "scalar",
    status: "confirmed",
    sourceLabel: "Data B2",
    sourceAddress: "B2",
    sourceType: "cell",
    sourceSheetId: "sheet-data",
    sourceSheetName: "Data",
    definition: null,
  };
  const snapshots = materializeReportBindings(
    [binding],
    context([], { readModel: null }),
  );
  assert.throws(
    () =>
      assertRequiredReportMaterializationsReady(
        [binding.slotId],
        snapshots,
      ),
    /REPORT_MATERIALIZATION_BLOCKED/,
  );
});

test("a confirmed binding cannot silently retain the old PDF number without a ready snapshot", () => {
  const issues = validateReportDocument({
    document: {
      schemaVersion: "1.0",
      pageCount: 1,
      pages: [
        {
          pageId: "page-1",
          pageNumber: 1,
          pageLabel: "1",
          role: "summary",
          widthPt: 595,
          heightPt: 842,
          rotation: 0,
          blocks: [
            {
              blockId: "block-old-eps",
              pageId: "page-1",
              role: "numeric",
              label: "EPS",
              text: "기존 PDF EPS 9,999원",
              editable: false,
              revision: 1,
              evidenceIds: [],
              numericAuthority: "mapping_set",
              templateBlockId: "template-old-eps",
              bbox: [10, 10, 100, 30],
              sourceObjectIds: ["old-pdf-eps"],
              sourceCoverage: "complete",
              uncoveredSourceObjectIds: [],
              dataBinding: {
                slotId: "slot-eps",
                metric: "eps",
                kind: "scalar",
                status: "confirmed",
                sourceLabel: "Data B2",
                sourceAddress: "B2",
                sourceType: "cell",
              },
              patchStrategy: "fixed",
            },
          ],
        },
      ],
    },
    templatePageIds: ["page-1"],
    evidenceIds: new Set(),
    valuationText: {
      targetPer: "10.0",
      targetPrice: "100000",
      forwardEps: "10000",
    },
  });

  assert.ok(
    issues.some(
      (issue) =>
        issue.code === "REPORT_DATA_MATERIALIZATION_INCOMPLETE" &&
        issue.blockId === "block-old-eps",
    ),
  );
});

test("materialization artifact and report pages share snapshot references without repeating matrices", () => {
  const binding: ReportMappingBinding = {
    slotId: "slot-eps",
    pageId: "page-1",
    blockId: "block-eps",
    metric: "eps",
    kind: "scalar",
    status: "confirmed",
    sourceLabel: "Data B2",
    sourceAddress: "B2",
    sourceType: "cell",
    sourceSheetId: "sheet-data",
    sourceSheetName: "Data",
    styleTemplateRef: "style-eps",
    definition: null,
  };
  const snapshots = materializeReportBindings(
    [binding],
    context([cell("B2", 2, 2, "1250", "1,250")]),
  );
  const document = {
    schemaVersion: "1.0" as const,
    pageCount: 1,
    pages: [
      {
        pageId: "page-1",
        pageNumber: 1,
        pageLabel: "1",
        role: "cover",
        widthPt: 595,
        heightPt: 842,
        rotation: 0,
        blocks: [
          {
            blockId: "block-eps",
            pageId: "page-1",
            role: "numeric" as const,
            label: "EPS",
            text: "1,250",
            editable: false,
            revision: 1,
            evidenceIds: [],
            numericAuthority: "mapping_set",
            templateBlockId: "block-eps",
            bbox: null,
            sourceObjectIds: [],
            dataBinding: {
              slotId: "slot-eps",
              metric: "eps",
              kind: "scalar" as const,
              status: "confirmed" as const,
              sourceLabel: "Data B2",
              sourceAddress: "B2",
              sourceType: "cell",
            },
            materializedData: snapshots["slot-eps"],
            patchStrategy: "fixed" as const,
          },
        ],
      },
    ],
  };
  const compact = compactReportMaterializations(document, {
    "slot-eps": "snapshot-eps",
  });
  assert.equal(
    compact.pages[0].blocks[0].materializedData,
    undefined,
  );
  assert.equal(
    compact.pages[0].blocks[0].materializationSnapshotId,
    "snapshot-eps",
  );
  const hydrated = hydrateReportMaterializations(compact, {
    "snapshot-eps": snapshots["slot-eps"],
  });
  assert.equal(hydrated.pages[0].blocks[0].materializedData?.status, "ready");

  const ref = (role: string) => ({
    role,
    resourceVersionId: `${role}-version`,
    version: 1,
    contentHash: "a".repeat(64),
  });
  const artifact = serializeReportMaterializationArtifact({
    materializationId: "materialization-1",
    materializationVersion: 1,
    sourceSnapshot: {
      snapshotId: "source-snapshot-1",
      sourceFingerprint: "b".repeat(64),
      setup: ref("setup"),
      pdf: ref("pdf"),
      xlsx: ref("xlsx"),
      templateIr: ref("template_ir"),
      workbookAnalysis: ref("workbook_analysis"),
      mappingSet: ref("mapping_set"),
      validationApproval: ref("validation_approval"),
      validatedWorkbook: ref("validated_workbook"),
      valuationApproval: ref("valuation_approval"),
      outlineApproval: ref("outline_approval"),
      styleTemplate: ref("style_template"),
      report: ref("report"),
      capturedAt: "2026-07-26T00:00:00.000Z",
    },
    materializationsBySlotId: snapshots,
    materializerVersion: "report-materializer-v1",
    createdAt: "2026-07-26T00:00:00.000Z",
  });
  assert.equal(artifact.items[0].kind, "scalar");
  assert.equal(artifact.items[0].provenance.sourceSnapshotId, "source-snapshot-1");
  if (artifact.items[0].kind === "scalar") {
    assert.deepEqual(artifact.items[0].displayRule, {
      pattern: "General",
    });
  }
  assert.match(artifact.contentHash, /^[a-f0-9]{64}$/);
  assert.equal(
    validateReportMaterialization(artifact),
    true,
    JSON.stringify(validateReportMaterialization.errors),
  );
});
