import assert from "node:assert/strict";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { buildMappingSet } from "../workers/control/mapping";
import workerResultSchemas from "../server/domain/generated/worker-result-schemas.json";
import {
  buildMappingRevisionBinding,
  deserializeMappingCandidateSource,
  serializeMappingCandidateSource,
  type MappingRevisionEntry,
} from "../server/infrastructure/repositories/file-repository";
import type {
  TemplateIr,
  WorkbookAnalysis,
  WorkbookCandidateCell,
  WorkbookCandidateRange,
  WorkbookChartAnalysis,
  WorkbookChartDataReference,
} from "../workers/control/types";

const contractAjv = new Ajv2020({
  allErrors: true,
  strict: true,
  strictRequired: false,
});
addFormats(contractAjv);
for (const schema of workerResultSchemas) contractAjv.addSchema(schema);
const validateMappingSet = contractAjv.getSchema(
  "https://schemas.reflo.dev/worker/v1/mapping-set.schema.json",
);
if (!validateMappingSet) throw new Error("MappingSet contract schema unavailable.");
const validateChartBinding = contractAjv.getSchema(
  "https://schemas.reflo.dev/worker/v1/mapping-set.schema.json#/$defs/ChartBinding",
);
if (!validateChartBinding) {
  throw new Error("ChartBinding contract schema unavailable.");
}

function cell(
  sheetId: string,
  sheetName: string,
  address: string,
  label: string,
): WorkbookCandidateCell {
  return {
    candidateId: `cell_${sheetId}_${address}`,
    sheetId,
    sheetName,
    address,
    valueType: "decimal",
    displayValue: "100",
    rawValue: 100,
    numberFormat: "#,##0",
    label,
    formula: null,
    styleFingerprint: "a".repeat(64),
    structureFingerprint: "b".repeat(64),
  };
}

function template(): TemplateIr {
  return {
    schemaVersion: "1.0",
    templateId: "tpl_test",
    templateVersion: 1,
    source: { pdfHash: "c".repeat(64) },
    pages: [
      {
        pageId: "page_1",
        pageNumber: 1,
        blocks: [],
        objects: [],
        slots: [
          {
            slotId: "slot_target",
            blockId: "block_target",
            valueType: "money",
            semanticKey: { metric: "target_price" },
            required: true,
          },
          {
            slotId: "slot_revenue",
            blockId: "block_revenue",
            valueType: "money",
            semanticKey: { metric: "revenue", period: "1Q26" },
            required: true,
          },
        ],
      },
    ],
    resources: { fonts: [], images: [], xobjects: [], styles: [], clipPaths: [] },
    analysisWarnings: [],
  };
}

function workbook(candidateCells: WorkbookCandidateCell[]): WorkbookAnalysis {
  return {
    schemaVersion: "1.0",
    workbookAnalysisId: "wba_test",
    workbookVersionId: "wbv_test",
    fileHash: "d".repeat(64),
    structureHash: "e".repeat(64),
    format: "xlsx",
    calculationStatus: "compatible",
    sheets: [
      {
        sheetId: "sheet_1",
        name: "01_실적추이",
        index: 0,
        visibility: "visible",
        usedRange: "A1:L30",
        structureHash: "f".repeat(64),
        formulaCount: 0,
        mergedRangeCount: 0,
        chartCount: 0,
        tableCount: 0,
      },
      {
        sheetId: "sheet_2",
        name: "09_Target_PER",
        index: 1,
        visibility: "visible",
        usedRange: "A1:I40",
        structureHash: "1".repeat(64),
        formulaCount: 0,
        mergedRangeCount: 0,
        chartCount: 0,
        tableCount: 0,
      },
    ],
    editableCells: [],
    candidateCells,
    candidateRanges: [],
    externalLinks: [],
    warnings: [],
    tool: { name: "ClosedXML", version: "0.105.0" },
  };
}

function sourceAddresses(
  result: ReturnType<typeof buildMappingSet>,
): Array<string | undefined> {
  return result.mappingSet.bindings.map((binding) =>
    binding.kind === "chart"
      ? binding.categories.range
      : binding.source.address ?? binding.source.range,
  );
}

function chartTemplate(
  metric: string,
  scope?: string,
  required = true,
): TemplateIr {
  const value = template();
  value.pages[0].slots = [
    {
      slotId: `slot_${metric}`,
      blockId: `block_${metric}`,
      valueType: "chart",
      semanticKey: { metric, ...(scope ? { scope } : {}) },
      required,
    },
  ];
  return value;
}

function chartReference(
  sheetId: string,
  sheetName: string,
  range: string,
  pointCount: number,
): WorkbookChartDataReference {
  return {
    formula: `'${sheetName}'!$${range.replace(":", ":$")}`,
    sheetId,
    sheetName,
    range,
    cacheType: "number",
    pointCount,
    cachedValues: Array.from({ length: pointCount }, (_, index) => ({
      index,
      value: String(index + 1),
    })),
  };
}

function embeddedChart(input: {
  chartId: string;
  sheetId: string;
  sheetName: string;
  title: string;
  categoryRange: string;
  seriesRange: string;
  seriesName: string;
  pointCount: number;
}): WorkbookChartAnalysis {
  const category = chartReference(
    input.sheetId,
    input.sheetName,
    input.categoryRange,
    input.pointCount,
  );
  return {
    chartId: input.chartId,
    sheetId: input.sheetId,
    sheetName: input.sheetName,
    partPath: `xl/charts/${input.chartId}.xml`,
    title: input.title,
    anchor: { kind: "two_cell", fromCell: "A32", toCell: "H50" },
    chartTypes: ["bar"],
    category,
    series: [
      {
        seriesId: `series_${input.chartId}`,
        index: 0,
        name: input.seriesName,
        nameFormula: null,
        chartType: "bar",
        axis: "primary",
        category,
        values: chartReference(
          input.sheetId,
          input.sheetName,
          input.seriesRange,
          input.pointCount,
        ),
      },
    ],
    axes: [],
    structureFingerprint: input.chartId.padEnd(64, "a").slice(0, 64),
  };
}

function rangeCandidate(input: {
  candidateId: string;
  sheetId: string;
  sheetName: string;
  range: string;
  label: string;
  kind?: WorkbookCandidateRange["kind"];
  headerRows?: number[];
  headerValues?: string[];
  rowKeyColumns?: WorkbookCandidateRange["rowKeyColumns"];
  periodColumns?: WorkbookCandidateRange["periodColumns"];
}): WorkbookCandidateRange {
  const [first, last] = input.range.split(":");
  const parse = (address: string) => {
    const match = /^([A-Z]+)(\d+)$/.exec(address)!;
    const column = [...match[1]].reduce(
      (value, character) => value * 26 + character.charCodeAt(0) - 64,
      0,
    );
    return { column, row: Number(match[2]) };
  };
  const start = parse(first);
  const end = parse(last);
  return {
    ...input,
    rowCount: end.row - start.row + 1,
    columnCount: end.column - start.column + 1,
    structureFingerprint: "b".repeat(64),
    unitHints: [],
    subtotalRows: [],
  };
}

function valueCell(input: {
  sheetId: string;
  sheetName: string;
  address: string;
  value: string | number;
}): WorkbookCandidateCell {
  const numeric = typeof input.value === "number";
  return {
    candidateId: `cell_${input.sheetId}_${input.address}`,
    sheetId: input.sheetId,
    sheetName: input.sheetName,
    address: input.address,
    valueType: numeric ? "decimal" : "string",
    displayValue: String(input.value),
    rawValue: input.value,
    numberFormat: numeric ? "#,##0.0" : "@",
    label: String(input.value),
    formula: null,
    styleFingerprint: "a".repeat(64),
    structureFingerprint: "b".repeat(64),
  };
}

test("confirms documented and period-specific model sources", () => {
  const result = buildMappingSet(
    template(),
    workbook([
      cell("sheet_2", "09_Target_PER", "B15", "목표주가 (원)"),
      cell("sheet_1", "01_실적추이", "F6", "매출액 · 1Q26P"),
      cell("legacy", "Forward EPS", "F6", "매출액 · 1Q26P"),
    ]),
  );

  assert.equal(result.summary.status, "confirmed");
  assert.equal(result.summary.unmappedRequiredCount, 0);
  assert.deepEqual(sourceAddresses(result), ["B15", "F6"]);
  assert.equal(
    validateMappingSet(result.mappingSet),
    true,
    JSON.stringify(validateMappingSet.errors),
  );
});

test("keeps a required slot blocked when candidates are ambiguous", () => {
  const value = template();
  value.pages[0].slots = [value.pages[0].slots[1]];
  const result = buildMappingSet(
    value,
    workbook([
      cell("legacy_1", "Legacy A", "B2", "매출액"),
      cell("legacy_2", "Legacy B", "B2", "매출액"),
    ]),
  );

  assert.equal(result.summary.status, "blocked");
  assert.equal(result.summary.unmappedRequiredCount, 1);
  assert.equal(result.mappingSet.bindings.length, 0);
});

test("uses the KRX cutoff close as the authoritative current price", () => {
  const value = template();
  value.pages[0].slots = [
    {
      slotId: "slot_current",
      blockId: "block_current",
      valueType: "money",
      semanticKey: { metric: "current_price" },
      required: true,
    },
  ];
  const result = buildMappingSet(
    value,
    workbook([
      cell("sheet_2", "09_Target_PER", "B16", "현재주가 (원)"),
    ]),
    {
      schemaVersion: "1.0",
      provider: "KRX_OPEN_API",
      status: "available",
      companyMasterId: "company-1",
      ticker: "005930",
      exchange: "KOSPI",
      requestedDate: "2026-07-25",
      tradingDate: "2026-07-24",
      closePrice: 88_700,
      currency: "KRW",
      sourceApiId: "stk_bydd_trd",
      retrievedAt: "2026-07-25T00:00:00.000Z",
      sourcePayloadHash: "a".repeat(64),
      errorCode: null,
      errorMessage: null,
    },
  );

  assert.equal(result.summary.status, "confirmed");
  assert.equal(result.mappingSet.candidates[0].kind, "market_data");
  assert.equal(result.mappingSet.candidates[0].selected, true);
  const binding = result.mappingSet.bindings[0];
  assert.equal(binding.kind, "market_data");
  if (binding.kind !== "market_data") {
    throw new Error("Expected market-data binding.");
  }
  assert.equal(binding.source.provider, "KRX_OPEN_API");
  assert.equal(binding.source.closePrice, 88_700);
  assert.equal(
    result.mappingSet.candidates.some(
      (candidate) => candidate.kind === "cell" && !candidate.selected,
    ),
    true,
  );
  assert.equal(
    validateMappingSet(result.mappingSet),
    true,
    JSON.stringify(validateMappingSet.errors),
  );
});

test("prefers the embedded chart whose title and series match the PDF figure scope", () => {
  const value = workbook([]);
  value.sheets.push({
    sheetId: "sheet_18",
    name: "12_도표8_어플리케이션별_매출",
    index: 2,
    visibility: "visible",
    usedRange: "A1:M30",
    structureHash: "2".repeat(64),
    formulaCount: 0,
    mergedRangeCount: 0,
    chartCount: 2,
    tableCount: 0,
  });
  value.charts = [
    embeddedChart({
      chartId: "chart_amount",
      sheetId: "sheet_18",
      sheetName: "12_도표8_어플리케이션별_매출",
      title: "어플리케이션별 매출",
      categoryRange: "B5:M5",
      seriesRange: "B6:M6",
      seriesName: "데이터센터",
      pointCount: 12,
    }),
    embeddedChart({
      chartId: "chart_share",
      sheetId: "sheet_18",
      sheetName: "12_도표8_어플리케이션별_매출",
      title: "어플리케이션별 매출 비중",
      categoryRange: "B16:M16",
      seriesRange: "B17:M17",
      seriesName: "데이터센터 비중",
      pointCount: 12,
    }),
  ];

  const result = buildMappingSet(
    chartTemplate("figure_8_chart", "어플리케이션 별 매출 비중 추이"),
    value,
  );

  assert.equal(result.summary.status, "confirmed");
  const selected = result.mappingSet.candidates.find(
    (candidate) => candidate.selected,
  );
  assert.equal(selected?.kind, "chart");
  assert.equal(selected?.chartDefinition?.categories.range, "B16:M16");
  assert.equal(selected?.chartDefinition?.series[0].source.range, "B17:M17");
  const binding = result.mappingSet.bindings[0];
  assert.equal(binding.kind, "chart");
  if (binding.kind !== "chart") throw new Error("Expected chart binding.");
  assert.equal(binding.categories.range, "B16:M16");
  assert.equal(binding.series[0].axis, "primary");
  assert.equal(
    validateMappingSet(result.mappingSet),
    true,
    JSON.stringify(validateMappingSet.errors),
  );
});

test("keeps equally plausible embedded charts unselected", () => {
  const value = workbook([]);
  value.sheets.push({
    sheetId: "sheet_18",
    name: "12_도표8_어플리케이션별_매출",
    index: 2,
    visibility: "visible",
    usedRange: "A1:M30",
    structureHash: "2".repeat(64),
    formulaCount: 0,
    mergedRangeCount: 0,
    chartCount: 2,
    tableCount: 0,
  });
  value.charts = [
    embeddedChart({
      chartId: "chart_a",
      sheetId: "sheet_18",
      sheetName: "12_도표8_어플리케이션별_매출",
      title: "차트 A",
      categoryRange: "B5:M5",
      seriesRange: "B6:M6",
      seriesName: "계열 A",
      pointCount: 12,
    }),
    embeddedChart({
      chartId: "chart_b",
      sheetId: "sheet_18",
      sheetName: "12_도표8_어플리케이션별_매출",
      title: "차트 B",
      categoryRange: "B16:M16",
      seriesRange: "B17:M17",
      seriesName: "계열 B",
      pointCount: 12,
    }),
  ];

  const result = buildMappingSet(chartTemplate("figure_8_chart"), value);

  assert.equal(result.summary.status, "blocked");
  assert.equal(result.mappingSet.candidates.length, 2);
  assert.equal(
    result.mappingSet.candidates.some((candidate) => candidate.selected),
    false,
  );
  assert.equal(result.mappingSet.bindings.length, 0);
});

test("blocks a multiplier-only P/E range because it cannot recreate the time-series band chart", () => {
  const value = workbook([]);
  value.sheets.push({
    sheetId: "sheet_12",
    name: "06_도표2_PER_Band",
    index: 2,
    visibility: "visible",
    usedRange: "A1:E22",
    structureHash: "3".repeat(64),
    formulaCount: 0,
    mergedRangeCount: 0,
    chartCount: 0,
    tableCount: 0,
  });
  value.candidateRanges = [
    rangeCandidate({
      candidateId: "range_per_band",
      sheetId: "sheet_12",
      sheetName: "06_도표2_PER_Band",
      range: "A4:E10",
      label: "밴드",
      kind: "dense_region",
      headerRows: [4],
      headerValues: ["밴드", "배수 (배)", "", "", "비고"],
      rowKeyColumns: [{ index: 0, column: "A", label: "밴드" }],
      periodColumns: [],
    }),
    rangeCandidate({
      candidateId: "range_per_audit",
      sheetId: "sheet_12",
      sheetName: "06_도표2_PER_Band",
      range: "A12:E20",
      label: "정합성 체크",
      kind: "dense_region",
      headerRows: [13],
      headerValues: ["밴드", "배수", "내재주가", "현재주가 대비", "비고"],
      rowKeyColumns: [{ index: 0, column: "A", label: "밴드" }],
      periodColumns: [],
    }),
  ];
  value.candidateCells = [
    valueCell({
      sheetId: "sheet_12",
      sheetName: "06_도표2_PER_Band",
      address: "A4",
      value: "밴드",
    }),
    valueCell({
      sheetId: "sheet_12",
      sheetName: "06_도표2_PER_Band",
      address: "B4",
      value: "배수 (배)",
    }),
    ...Array.from({ length: 5 }, (_, index) => [
      valueCell({
        sheetId: "sheet_12",
        sheetName: "06_도표2_PER_Band",
        address: `A${index + 5}`,
        value: `Band ${index + 1}`,
      }),
      valueCell({
        sheetId: "sheet_12",
        sheetName: "06_도표2_PER_Band",
        address: `B${index + 5}`,
        value: [57, 45.1, 33.3, 21.4, 5][index],
      }),
    ]).flat(),
    valueCell({
      sheetId: "sheet_12",
      sheetName: "06_도표2_PER_Band",
      address: "A10",
      value: "자료: FnGuide, 하나증권",
    }),
  ];

  const result = buildMappingSet(
    chartTemplate("figure_2_chart", "ISC 12MF P/E Band"),
    value,
  );

  assert.equal(result.summary.status, "blocked");
  assert.deepEqual(result.mappingSet.unmappedRequiredSlots, [
    "slot_figure_2_chart",
  ]);
  assert.equal(result.mappingSet.candidates.length, 0);
  assert.equal(result.mappingSet.bindings.length, 0);
});

test("synthesizes a band chart only from period categories and multiple validated series", () => {
  const value = workbook([]);
  value.sheets.push({
    sheetId: "sheet_band",
    name: "06_도표2_PER_Band",
    index: 2,
    visibility: "visible",
    usedRange: "A1:G10",
    structureHash: "5".repeat(64),
    formulaCount: 0,
    mergedRangeCount: 0,
    chartCount: 0,
    tableCount: 0,
  });
  value.candidateRanges = [
    rangeCandidate({
      candidateId: "range_true_band",
      sheetId: "sheet_band",
      sheetName: "06_도표2_PER_Band",
      range: "A4:G7",
      label: "PER Band 시계열",
      kind: "dense_region",
      headerRows: [4],
      headerValues: [
        "구분",
        "2021",
        "2022",
        "2023",
        "2024",
        "2025",
        "2026",
      ],
      rowKeyColumns: [{ index: 0, column: "A", label: "구분" }],
      periodColumns: [
        { index: 1, column: "B", label: "2021", role: "actual" },
        { index: 2, column: "C", label: "2022", role: "actual" },
        { index: 3, column: "D", label: "2023", role: "actual" },
        { index: 4, column: "E", label: "2024", role: "actual" },
        { index: 5, column: "F", label: "2025", role: "actual" },
        { index: 6, column: "G", label: "2026", role: "forecast" },
      ],
    }),
  ];
  value.candidateCells = [
    valueCell({
      sheetId: "sheet_band",
      sheetName: "06_도표2_PER_Band",
      address: "A4",
      value: "구분",
    }),
    ...["2021", "2022", "2023", "2024", "2025", "2026"].map(
      (period, index) =>
        valueCell({
          sheetId: "sheet_band",
          sheetName: "06_도표2_PER_Band",
          address: `${String.fromCharCode(66 + index)}4`,
          value: period,
        }),
    ),
    ...["수정주가", "57.0x PER Band", "45.1x PER Band"].flatMap(
      (label, rowIndex) => [
        valueCell({
          sheetId: "sheet_band",
          sheetName: "06_도표2_PER_Band",
          address: `A${rowIndex + 5}`,
          value: label,
        }),
        ...Array.from({ length: 6 }, (_, columnIndex) =>
          valueCell({
            sheetId: "sheet_band",
            sheetName: "06_도표2_PER_Band",
            address: `${String.fromCharCode(66 + columnIndex)}${rowIndex + 5}`,
            value: 100 + rowIndex * 20 + columnIndex * 5,
          }),
        ),
      ],
    ),
  ];

  const result = buildMappingSet(
    chartTemplate("figure_2_chart", "ISC 12MF P/E Band"),
    value,
  );

  assert.equal(result.summary.status, "confirmed");
  const candidate = result.mappingSet.candidates[0];
  assert.equal(candidate.chartDefinition?.categories.range, "B4:G4");
  assert.equal(candidate.chartDefinition?.series.length, 3);
  assert.deepEqual(
    candidate.chartDefinition?.series.map((series) => series.source.range),
    ["B5:G5", "B6:G6", "B7:G7"],
  );
});

test("maps the four page-5 financial tables independently", () => {
  const value = workbook([]);
  const definitions = [
    ["sheet_21", "15_p5_손익계산서", "A4:G35", "손익계산서"],
    ["sheet_22", "16_p5_대차대조표", "A4:G37", "대차대조표"],
    ["sheet_23", "17_p5_투자지표", "A4:G25", "투자지표"],
    ["sheet_24", "18_p5_현금흐름표", "A4:G25", "현금흐름표"],
  ] as const;
  for (const [sheetId, sheetName, range, label] of definitions) {
    value.sheets.push({
      sheetId,
      name: sheetName,
      index: value.sheets.length,
      visibility: "visible",
      usedRange: `A1:${range.split(":")[1]}`,
      structureHash: sheetId.padEnd(64, "4").slice(0, 64),
      formulaCount: 0,
      mergedRangeCount: 0,
      chartCount: 0,
      tableCount: 0,
    });
    value.candidateRanges.push(
      rangeCandidate({
        candidateId: `range_${sheetId}`,
        sheetId,
        sheetName,
        range,
        label,
        kind: "dense_region",
        headerRows: [4],
        headerValues: ["구분", "2023", "2024", "2025F", "2026F", "2027F", "비고"],
        rowKeyColumns: [{ index: 0, column: "A", label: "구분" }],
        periodColumns: [
          { index: 1, column: "B", label: "2023", role: "actual" },
          { index: 2, column: "C", label: "2024", role: "actual" },
          { index: 3, column: "D", label: "2025F", role: "forecast" },
          { index: 4, column: "E", label: "2026F", role: "forecast" },
          { index: 5, column: "F", label: "2027F", role: "forecast" },
        ],
      }),
    );
  }
  const reportTemplate = template();
  reportTemplate.pages[0].slots = [
    {
      slotId: "slot_income",
      blockId: "block_income",
      valueType: "table",
      semanticKey: { metric: "income_statement_table" },
      required: true,
    },
    {
      slotId: "slot_balance",
      blockId: "block_balance",
      valueType: "table",
      semanticKey: { metric: "balance_sheet_table" },
      required: true,
    },
    {
      slotId: "slot_indicators",
      blockId: "block_indicators",
      valueType: "table",
      semanticKey: { metric: "investment_indicators_table" },
      required: true,
    },
    {
      slotId: "slot_cashflow",
      blockId: "block_cashflow",
      valueType: "table",
      semanticKey: { metric: "cash_flow_statement_table" },
      required: true,
    },
  ];

  const result = buildMappingSet(reportTemplate, value);

  assert.equal(result.summary.status, "confirmed");
  assert.deepEqual(
    result.mappingSet.bindings.map((binding) =>
      binding.kind === "table" ? binding.source.sheet : null,
    ),
    definitions.map((definition) => definition[1]),
  );
  assert.equal(
    result.mappingSet.bindings.some(
      (binding) =>
        binding.kind === "table" && binding.source.sheet === "06_재무요약",
    ),
    false,
  );
  assert.equal(
    validateMappingSet(result.mappingSet),
    true,
    JSON.stringify(validateMappingSet.errors),
  );
});

test("round-trips each chart candidate definition through mapping revision storage", () => {
  const source = {
    sheetId: "sheet_18",
    sheet: "12_도표8_어플리케이션별_매출",
    range: "B16:M16",
    authority: "authoritative",
    structureFingerprint: "a".repeat(64),
  };
  const chartDefinition = {
    categories: source,
    series: [
      {
        seriesId: "series_share",
        label: "데이터센터 비중",
        source: {
          ...source,
          range: "B17:M17",
          structureFingerprint: "b".repeat(64),
        },
        axis: "primary",
      },
    ],
    chartTypes: ["bar"],
  };
  const stored = serializeMappingCandidateSource({
    source,
    chartDefinition,
  });
  const restored = deserializeMappingCandidateSource(stored);
  const entry: MappingRevisionEntry = {
    entryId: "11111111-1111-4111-8111-111111111111",
    slotId: "slot_figure_8",
    metric: "figure_8_chart",
    kind: "chart",
    valueType: "chart",
    required: true,
    selectedCandidateId: "22222222-2222-4222-8222-222222222222",
    candidates: [
      {
        candidateId: "22222222-2222-4222-8222-222222222222",
        sourceType: "chart",
        sheetId: "sheet_18",
        sheetName: "12_도표8_어플리케이션별_매출",
        address: "B16:M16",
        label: "어플리케이션별 매출 비중",
        score: 0.99,
        reasonCodes: ["SCOPE_MATCH"],
        source: restored.source,
        chartDefinition: restored.chartDefinition,
      },
    ],
  };

  const binding = buildMappingRevisionBinding(entry, entry.candidates[0]);

  assert.deepEqual(restored.source, source);
  assert.deepEqual(restored.chartDefinition, chartDefinition);
  assert.equal(binding.kind, "chart");
  if (!binding.categories || !binding.series) {
    throw new Error("Expected chart categories and series.");
  }
  assert.equal(binding.categories.range, "B16:M16");
  assert.equal(binding.series[0].source.range, "B17:M17");
  assert.equal(binding.series[0].axis, "primary");
  assert.equal(
    validateChartBinding(binding),
    true,
    JSON.stringify(validateChartBinding.errors),
  );
});
