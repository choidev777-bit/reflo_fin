import assert from "node:assert/strict";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { buildMappingSet } from "../workers/control/mapping";
import workerResultSchemas from "../server/domain/generated/worker-result-schemas.json";
import { isValuationOutputSlotId } from "../server/domain/valuation-output-slots";
import {
  buildMappingRevisionBinding,
  deserializeMappingCandidateSource,
  pdfPageProjection,
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
const validateCompositeChartBinding = contractAjv.getSchema(
  "https://schemas.reflo.dev/worker/v1/mapping-set.schema.json#/$defs/CompositeChartBinding",
);
if (!validateCompositeChartBinding) {
  throw new Error("CompositeChartBinding contract schema unavailable.");
}

test("projects narrative subtitles and bodies from PDF text geometry", () => {
  const objects = [
    {
      objectId: "report-date",
      type: "text_run",
      bbox: [198.53, 70.75, 387.89, 80.71],
      textRun: {
        text: "2026년 1월 30일 I 기업분석_Earnings Review",
        fontSize: 9.96,
      },
    },
    {
      objectId: "company-name",
      type: "text_run",
      bbox: [198.53, 105.55, 364.96, 132.26],
      textRun: {
        text: "대덕전자 (353200)",
        fontSize: 26.04,
      },
    },
    {
      objectId: "report-title",
      type: "text_run",
      bbox: [198.53, 141.21, 288.21, 157.17],
      textRun: {
        text: "기판 맹수, 앙!",
        fontSize: 15.96,
      },
    },
    {
      objectId: "section-1-heading",
      type: "text_run",
      bbox: [198.53, 206.23, 367.12, 217.27],
      textRun: {
        text: "4Q25 Review: 반가운 하이싱글 수익성",
        fontSize: 10.8,
      },
    },
    {
      objectId: "section-1-body-1",
      type: "text_run",
      bbox: [198.53, 224, 553, 235],
      textRun: {
        text: "25년 4분기 매출과 영업이익이 모두 하나증권 추정치를 상회했다.",
        fontSize: 9.7,
      },
    },
    {
      objectId: "section-1-body-2",
      type: "text_run",
      bbox: [198.53, 242, 553, 253],
      textRun: {
        text: "메모리 패키지 기판과 전장용 매출 증가가 수익성을 견인했다.",
        fontSize: 9.7,
      },
    },
    {
      objectId: "section-2-heading",
      type: "text_run",
      bbox: [198.53, 406.9, 382.85, 417.94],
      textRun: {
        text: "2026 Preview: 증설을 고민해야 하는 정도",
        fontSize: 10.8,
      },
    },
    {
      objectId: "section-2-body",
      type: "text_run",
      bbox: [198.53, 425, 553, 436],
      textRun: {
        text: "2026년에는 신규 수주 증가와 가동률 상승이 이어질 전망이다.",
        fontSize: 9.7,
      },
    },
    {
      objectId: "section-3-heading",
      type: "text_run",
      bbox: [198.53, 624.96, 312.69, 636],
      textRun: {
        text: "목표주가 8.1만원으로 상향",
        fontSize: 10.8,
      },
    },
    {
      objectId: "section-3-body",
      type: "text_run",
      bbox: [198.53, 643, 553, 654],
      textRun: {
        text: "영업이익 추정치 상향을 반영해 목표주가를 8만1천원으로 상향한다.",
        fontSize: 9.7,
      },
    },
  ];

  const pages = pdfPageProjection({
    pages: [
      {
        pageId: "page-1",
        pageNumber: 1,
        pageLabel: "01",
        boxes: {
          mediaBox: [0, 0, 595.32, 841.92],
          cropBox: [0, 0, 595.32, 841.92],
        },
        blocks: [],
        slots: [],
        objects,
      },
    ],
  });

  assert.deepEqual(
    pages[0]?.narrativeSections.map((section) => section.headingText),
    [
      "4Q25 Review: 반가운 하이싱글 수익성",
      "2026 Preview: 증설을 고민해야 하는 정도",
      "목표주가 8.1만원으로 상향",
    ],
  );
  assert.deepEqual(pages[0]?.narrativeSections[0]?.headingBbox, [
    198.53,
    206.23,
    367.12,
    217.27,
  ]);
  assert.deepEqual(pages[0]?.narrativeSections[0]?.bodyBbox, [
    198.53,
    224,
    553,
    253,
  ]);
  assert.deepEqual(pages[0]?.headerFields.reportDate, {
    text: "2026년 1월 30일 I 기업분석_Earnings Review",
    bbox: [198.53, 70.75, 387.89, 80.71],
    objectIds: ["report-date"],
  });
  assert.deepEqual(pages[0]?.headerFields.reportTitle, {
    text: "기판 맹수, 앙!",
    bbox: [198.53, 141.21, 288.21, 157.17],
    objectIds: ["report-title"],
  });
});

test("does not project source captions as narrative sections", () => {
  const pages = pdfPageProjection({
    pages: [
      {
        pageId: "page-2",
        pageNumber: 2,
        pageLabel: "02",
        boxes: {
          mediaBox: [0, 0, 595.32, 841.92],
          cropBox: [0, 0, 595.32, 841.92],
        },
        blocks: [],
        slots: [],
        objects: [
          {
            objectId: "source-heading",
            type: "text_run",
            bbox: [46.8, 410, 230, 420],
            textRun: {
              text: "자료: FnGuide, 하나증권",
              fontSize: 7,
            },
          },
          {
            objectId: "source-body",
            type: "text_run",
            bbox: [46.8, 424, 250, 434],
            textRun: {
              text: "자료: 대덕전자, 하나증권",
              fontSize: 7,
            },
          },
        ],
      },
    ],
  });

  assert.deepEqual(pages[0]?.narrativeSections, []);
});

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

/**
 * 밸류에이션 출력(EPS·PER·목표주가)은 template IR에 slot이 없어도 항상 합성
 * 슬롯으로 매핑 후보를 만든다. 아래 테스트들은 template의 특정 슬롯 동작을
 * 검증하므로, 그 합성 슬롯의 후보는 제외하고 본다.
 */
function templateSlotCandidates(
  result: ReturnType<typeof buildMappingSet>,
): ReturnType<typeof buildMappingSet>["mappingSet"]["candidates"] {
  return result.mappingSet.candidates.filter(
    (candidate) => !isValuationOutputSlotId(candidate.slotId),
  );
}

function sourceAddresses(
  result: ReturnType<typeof buildMappingSet>,
): Array<string | undefined> {
  return result.mappingSet.bindings.map((binding) => {
    if (binding.kind === "chart" || binding.kind === "composite_chart") {
      return binding.categories.range;
    }
    return binding.source.address ?? binding.source.range;
  });
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

test("binds valuation outputs even when the PDF prints EPS and PER inside a table", () => {
  // 실제 리서치 보고서는 EPS·PER을 Key Data 표 안에 인쇄해 template IR의
  // scalar slot으로 감지되지 않는다. 그래도 STEP 06 밸류에이션이 Excel 셀을
  // 읽을 수 있어야 하므로 합성 슬롯이 후보와 binding을 만들어야 한다.
  const value = template();
  value.pages[0].slots = [];
  const result = buildMappingSet(
    value,
    workbook([
      cell("sheet_m2", "M2_목표주가_타겟멀티플", "C10", "적용 EPS (2026F)"),
      cell("sheet_m2", "M2_목표주가_타겟멀티플", "C7", "적정 P/E (선택 방식)"),
      cell("sheet_m2", "M2_목표주가_타겟멀티플", "C21", "목표주가 (모델, 제시)"),
    ]),
  );

  const boundMetrics = result.mappingSet.bindings.map(
    (binding) => binding.semanticKey.metric,
  );
  assert.deepEqual([...boundMetrics].sort(), ["eps", "per", "target_price"]);
  assert.deepEqual([...sourceAddresses(result)].sort(), ["C10", "C21", "C7"]);
  assert.equal(
    result.mappingSet.warnings.some(
      (warning) => warning.code === "VALUATION_OUTPUT_MAPPING_UNRESOLVED",
    ),
    false,
  );
  assert.equal(
    validateMappingSet(result.mappingSet),
    true,
    JSON.stringify(validateMappingSet.errors),
  );
});

test("warns without blocking when a valuation output cell cannot be located", () => {
  const value = template();
  value.pages[0].slots = [];
  const result = buildMappingSet(value, workbook([]));

  // STEP 02 적합성 검사는 막지 않는다(합성 슬롯은 required=false).
  assert.equal(result.summary.status, "confirmed");
  assert.deepEqual(result.mappingSet.unmappedRequiredSlots, []);
  assert.equal(
    result.mappingSet.warnings.some(
      (warning) => warning.code === "VALUATION_OUTPUT_MAPPING_UNRESOLVED",
    ),
    true,
  );
});

test("prefers the M2 target P/E output over a market P/E cell", () => {
  const value = template();
  value.pages[0].slots = [
    {
      slotId: "slot_per",
      blockId: "block_per",
      valueType: "decimal",
      semanticKey: { metric: "per" },
      required: true,
    },
  ];
  const result = buildMappingSet(
    value,
    workbook([
      cell(
        "sheet_m2",
        "M2_목표주가_타겟멀티플",
        "C7",
        "적정 P/E (선택 방식)",
      ),
      cell("sheet_financial", "04_p1_FinancialData", "F11", "PER"),
    ]),
  );

  assert.equal(result.summary.status, "confirmed");
  assert.deepEqual(sourceAddresses(result), ["C7"]);
  const binding = result.mappingSet.bindings[0];
  assert.equal(binding?.kind, "scalar");
  assert.ok(
    binding?.kind === "scalar" &&
      binding.reasonCodes.includes("DOCUMENTED_MODEL_CONTRACT"),
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

test("does not block a required slot the workbook offers no candidate for", () => {
  // 후보가 하나도 없으면 검사 화면에 원본 선택 dropdown이 그려지지 않는다.
  // 그래도 미해결로 세면 완료 버튼이 `원본 확인 필요`에 영구히 잠겨 STEP 02를
  // 빠져나갈 수 없다. 사용자가 할 수 있는 일이 없으면 후속 단계로 넘긴다.
  const value = template();
  value.pages[0].slots = [value.pages[0].slots[1]];
  const result = buildMappingSet(value, workbook([]));

  assert.equal(result.summary.status, "confirmed");
  assert.equal(result.summary.unmappedRequiredCount, 0);
  assert.deepEqual(result.mappingSet.unmappedRequiredSlots, []);
  assert.equal(
    result.mappingSet.warnings.some(
      (warning) => warning.code === "REQUIRED_MAPPING_UNRESOLVED",
    ),
    false,
  );
});

test("does not treat a broad used range as ambiguity for one structured table", () => {
  const value = template();
  value.pages[0].slots = [
    {
      slotId: "slot_custom_table",
      blockId: "block_custom_table",
      valueType: "table",
      semanticKey: { metric: "custom_table" },
      required: true,
    },
  ];
  const analyzed = workbook([]);
  analyzed.candidateRanges = [
    rangeCandidate({
      candidateId: "range_structured",
      sheetId: "sheet_custom",
      sheetName: "custom_table",
      range: "A4:G35",
      label: "custom_table",
      kind: "dense_region",
    }),
    rangeCandidate({
      candidateId: "range_used",
      sheetId: "sheet_custom",
      sheetName: "custom_table",
      range: "A1:G40",
      label: "custom_table",
      kind: "used_range",
    }),
  ];

  const result = buildMappingSet(value, analyzed);

  assert.equal(result.summary.status, "confirmed");
  assert.equal(result.summary.unmappedRequiredCount, 0);
  assert.equal(result.mappingSet.bindings.length, 1);
  assert.equal(result.mappingSet.bindings[0]?.kind, "table");
  assert.equal(result.mappingSet.bindings[0]?.source.range, "A4:G35");
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
    templateSlotCandidates(result).some(
      (candidate) => candidate.kind === "cell",
    ),
    false,
  );
  assert.equal(
    validateMappingSet(result.mappingSet),
    true,
    JSON.stringify(validateMappingSet.errors),
  );
});

test("keeps current price assigned to KRX when the cutoff close is not yet available", () => {
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
      status: "unavailable",
      companyMasterId: "company-1",
      ticker: "005930",
      exchange: "KOSPI",
      requestedDate: "2026-07-25",
      tradingDate: null,
      closePrice: null,
      currency: "KRW",
      sourceApiId: null,
      retrievedAt: "2026-07-25T00:00:00.000Z",
      sourcePayloadHash: null,
      errorCode: "KRX_PERMISSION_REQUIRED",
      errorMessage: "조회 권한이 없습니다.",
    },
  );

  assert.equal(result.summary.status, "confirmed");
  assert.deepEqual(result.mappingSet.unmappedRequiredSlots, []);
  assert.equal(templateSlotCandidates(result).length, 0);
  assert.equal(result.mappingSet.bindings.length, 0);
  assert.equal(
    result.mappingSet.warnings.some(
      (warning) => warning.code === "KRX_MARKET_PRICE_PENDING",
    ),
    true,
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

test("defers a multiplier-only P/E range to the planned FnGuide and KRX collection", () => {
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

  assert.equal(result.summary.status, "confirmed");
  assert.deepEqual(result.mappingSet.unmappedRequiredSlots, []);
  assert.equal(templateSlotCandidates(result).length, 0);
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
        candidateId: `aaa_used_${sheetId}`,
        sheetId,
        sheetName,
        range: "A1:Z90",
        label,
        kind: "used_range",
      }),
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
  reportTemplate.pages[0].pageNumber = 5;
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

test("uses the declared report page to reject a page-1 summary table", () => {
  const value = workbook([]);
  const definitions = [
    ["sheet_income", "12_p4_손익계산서", "A4:G35", "손익계산서"],
    ["sheet_balance", "13_p4_대차대조표", "A4:G34", "대차대조표"],
    ["sheet_indicators", "14_p4_투자지표", "A4:G26", "투자지표"],
    ["sheet_cashflow", "15_p4_현금흐름표", "A4:G24", "현금흐름표"],
  ] as const;
  for (const [sheetId, sheetName, range, label] of definitions) {
    value.sheets.push({
      sheetId,
      name: sheetName,
      index: value.sheets.length,
      visibility: "visible",
      usedRange: `A1:${range.split(":")[1]}`,
      structureHash: sheetId.padEnd(64, "7").slice(0, 64),
      formulaCount: 0,
      mergedRangeCount: 0,
      chartCount: 0,
      tableCount: 0,
    });
    value.candidateRanges.push(
      rangeCandidate({
        candidateId: `aaa_used_${sheetId}`,
        sheetId,
        sheetName,
        range: "A1:Z90",
        label,
        kind: "used_range",
      }),
      rangeCandidate({
        candidateId: `range_${sheetId}`,
        sheetId,
        sheetName,
        range,
        label,
        kind: "dense_region",
      }),
    );
  }
  value.sheets.push({
    sheetId: "sheet_summary",
    name: "04_p1_FinancialData",
    index: value.sheets.length,
    visibility: "visible",
    usedRange: "A1:F23",
    structureHash: "8".repeat(64),
    formulaCount: 0,
    mergedRangeCount: 0,
    chartCount: 0,
    tableCount: 0,
  });
  value.candidateRanges.push(
    rangeCandidate({
      candidateId: "range_summary_indicators",
      sheetId: "sheet_summary",
      sheetName: "04_p1_FinancialData",
      range: "A4:F16",
      label: "투자지표",
      kind: "dense_region",
    }),
  );

  const reportTemplate = template();
  reportTemplate.pages[0].pageNumber = 4;
  reportTemplate.pages[0].slots = [
    {
      slotId: "slot_income",
      blockId: "block_income",
      valueType: "table",
      semanticKey: {
        metric: "financial_income_statement_table",
        scope: "손익계산서",
      },
      required: true,
    },
    {
      slotId: "slot_balance",
      blockId: "block_balance",
      valueType: "table",
      semanticKey: {
        metric: "financial_balance_sheet_table",
        scope: "대차대조표",
      },
      required: true,
    },
    {
      slotId: "slot_indicators",
      blockId: "block_indicators",
      valueType: "table",
      semanticKey: {
        metric: "financial_investment_indicators_table",
        scope: "투자지표",
      },
      required: true,
    },
    {
      slotId: "slot_cashflow",
      blockId: "block_cashflow",
      valueType: "table",
      semanticKey: {
        metric: "financial_cash_flow_table",
        scope: "현금흐름표",
      },
      required: true,
    },
  ];

  const result = buildMappingSet(reportTemplate, value);

  assert.equal(result.summary.status, "confirmed");
  assert.deepEqual(
    result.mappingSet.bindings.flatMap((binding) =>
      binding.kind === "table" ? [binding.source.sheet] : [],
    ),
    definitions.map((definition) => definition[1]),
  );
  assert.deepEqual(
    result.mappingSet.bindings.flatMap((binding) =>
      binding.kind === "table" ? [binding.source.range] : [],
    ),
    definitions.map((definition) => definition[2]),
  );
  assert.equal(
    result.mappingSet.candidates.some(
      (candidate) => candidate.source.sheet === "04_p1_FinancialData",
    ),
    false,
  );
  assert.equal(
    result.mappingSet.candidates
      .filter((candidate) =>
        candidate.reasonCodes.includes("BROAD_USED_RANGE"),
      )
      .every(
        (candidate) => candidate.score < 0.88,
      ),
    true,
  );
});

test("maps revised and prior quarterly tables to their dedicated output sheets", () => {
  const value = workbook([]);
  const definitions = [
    ["sheet_15", "10_도표6_분기실적전망_수정후"],
    ["sheet_16", "11_도표7_분기실적전망_수정전"],
  ] as const;
  for (const [sheetId, sheetName] of definitions) {
    value.sheets.push({
      sheetId,
      name: sheetName,
      index: value.sheets.length,
      visibility: "visible",
      usedRange: "A1:Z90",
      structureHash: sheetId.padEnd(64, "6").slice(0, 64),
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
        range: "A4:M22",
        label: "구분",
        kind: "dense_region",
        headerRows: [4],
        headerValues: [
          "구분",
          "1Q25",
          "2Q25",
          "3Q25",
          "4Q25",
          "1Q26F",
          "2Q26F",
          "3Q26F",
          "4Q26F",
          "2024",
          "2025F",
          "2026F",
          "단위",
        ],
        rowKeyColumns: [{ index: 0, column: "A", label: "구분" }],
      }),
    );
  }
  const reportTemplate = template();
  reportTemplate.pages[0].slots = [
    {
      slotId: "slot_figure_6",
      blockId: "block_figure_6",
      valueType: "table",
      semanticKey: {
        metric: "figure_6_chart",
        scope: "대덕전자 분기별 실적 전망(수정 후)",
      },
      required: true,
    },
    {
      slotId: "slot_figure_7",
      blockId: "block_figure_7",
      valueType: "table",
      semanticKey: {
        metric: "figure_7_chart",
        scope: "대덕전자 분기별 실적 전망(수정 전)",
      },
      required: true,
    },
  ];

  const result = buildMappingSet(reportTemplate, value);

  assert.equal(result.summary.status, "confirmed");
  assert.deepEqual(
    result.mappingSet.bindings.map((binding) =>
      binding.kind === "table"
        ? [binding.semanticKey.metric, binding.source.sheet, binding.source.range]
        : null,
    ),
    [
      ["figure_6_chart", definitions[0][1], "A4:M22"],
      ["figure_7_chart", definitions[1][1], "A4:M22"],
    ],
  );
});

test("maps Key Data and figure one to their dedicated output sheets", () => {
  const value = workbook([]);
  const definitions = [
    ["sheet_key_data", "01A_p1_KeyData", "A1:C22"],
    ["sheet_valuation", "05_도표1_Valuation", "A1:Z90"],
  ] as const;
  for (const [sheetId, sheetName, usedRange] of definitions) {
    value.sheets.push({
      sheetId,
      name: sheetName,
      index: value.sheets.length,
      visibility: "visible",
      usedRange,
      structureHash: sheetId.padEnd(64, "9").slice(0, 64),
      formulaCount: 0,
      mergedRangeCount: 0,
      chartCount: 0,
      tableCount: 0,
    });
  }
  const reportTemplate = template();
  reportTemplate.pages = [
    {
      ...reportTemplate.pages[0],
      pageNumber: 1,
      slots: [
        {
          slotId: "slot_key_data",
          blockId: "block_key_data",
          valueType: "table",
          semanticKey: { metric: "key_data", scope: "Key Data" },
          required: false,
        },
      ],
    },
    {
      ...reportTemplate.pages[0],
      pageId: "page_2",
      pageNumber: 2,
      slots: [
        {
          slotId: "slot_figure_1",
          blockId: "block_figure_1",
          valueType: "table",
          semanticKey: {
            metric: "figure_1_chart",
            scope: "대덕전자 Valuation",
          },
          required: true,
        },
      ],
    },
  ];

  const result = buildMappingSet(reportTemplate, value);
  const sources = result.mappingSet.bindings.map((binding) =>
    binding.kind === "table"
      ? [binding.semanticKey.metric, binding.source.sheet, binding.source.range]
      : null,
  );

  assert.deepEqual(sources, [
    ["key_data", "01A_p1_KeyData", "A4:C14"],
    ["figure_1_chart", "05_도표1_Valuation", "A4:E14"],
  ]);
  assert.deepEqual(result.mappingSet.unmappedRequiredSlots, []);
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

test("round-trips the complete scalar definition through mapping revision storage", () => {
  const source = {
    sheetId: "sheet_2",
    sheet: "09_Target_PER",
    address: "B15",
    readMode: "calculated_value",
    authority: "authoritative",
    numberFormat: "#,##0원",
    structureFingerprint: "a".repeat(64),
  };
  const bindingDefinition = {
    bindingId: "binding_scalar_original",
    slotId: "slot_target",
    kind: "scalar",
    valueType: "money",
    source,
    verificationSources: [],
    display: {
      unit: "KRW",
      scale: "1",
      roundingIncrement: "100",
      roundingMode: "half_up",
      pattern: "#,##0",
      suffix: "원",
    },
    status: "suggested",
    purpose: "report_output",
    semanticKey: {
      metric: "target_price",
      period: "2Q26",
      unit: "KRW",
      scope: "consolidated",
    },
    estimateType: "forecast",
    styleTemplateRef: "style_scalar_target",
    detectionConfidence: 0.94,
    reasonCodes: ["STABLE_CELL_MATCH"],
    review: {
      status: "unreviewed",
      reasonCodes: ["STABLE_CELL_MATCH"],
    },
  };
  const stored = (
    serializeMappingCandidateSource as unknown as (
      input: Record<string, unknown>,
    ) => Record<string, unknown>
  )({
    source,
    bindingDefinition,
  });
  const restored = deserializeMappingCandidateSource(stored) as ReturnType<
    typeof deserializeMappingCandidateSource
  > & {
    bindingDefinition: Record<string, unknown> | null;
  };
  const entry = {
    entryId: "11111111-1111-4111-8111-111111111111",
    slotId: "slot_target",
    metric: "target_price",
    kind: "scalar",
    valueType: "money",
    required: true,
    selectedCandidateId: "22222222-2222-4222-8222-222222222222",
    candidates: [
      {
        candidateId: "22222222-2222-4222-8222-222222222222",
        sourceType: "cell",
        sheetId: "sheet_2",
        sheetName: "09_Target_PER",
        address: "B15",
        label: "목표주가",
        score: 0.94,
        reasonCodes: ["STABLE_CELL_MATCH"],
        source: restored.source,
        chartDefinition: null,
        bindingDefinition: restored.bindingDefinition,
      },
    ],
  } as unknown as MappingRevisionEntry;

  const binding = buildMappingRevisionBinding(entry, entry.candidates[0]) as {
    kind: string;
    semanticKey: Record<string, string>;
    display: Record<string, string>;
    styleTemplateRef: string;
    estimateType: string;
    source: Record<string, unknown>;
  };

  assert.deepEqual(restored.bindingDefinition, bindingDefinition);
  assert.equal(binding.kind, "scalar");
  assert.deepEqual(binding.semanticKey, bindingDefinition.semanticKey);
  assert.deepEqual(binding.display, bindingDefinition.display);
  assert.equal(binding.styleTemplateRef, "style_scalar_target");
  assert.equal(binding.estimateType, "forecast");
  assert.deepEqual(binding.source, source);
});

test("materializes mixed chart types and a secondary axis as a composite binding", () => {
  const value = workbook([]);
  value.sheets.push({
    sheetId: "sheet_combo",
    name: "11_도표7_영업이익_시가총액",
    index: 2,
    visibility: "visible",
    usedRange: "A1:G20",
    structureHash: "6".repeat(64),
    formulaCount: 0,
    mergedRangeCount: 0,
    chartCount: 1,
    tableCount: 0,
  });
  const categories = chartReference(
    "sheet_combo",
    "11_도표7_영업이익_시가총액",
    "B4:G4",
    6,
  );
  value.charts = [
    {
      chartId: "chart_combo",
      sheetId: "sheet_combo",
      sheetName: "11_도표7_영업이익_시가총액",
      partPath: "xl/charts/chart_combo.xml",
      title: "도표 7 분기 영업이익 vs 시가총액 추이",
      anchor: { kind: "two_cell", fromCell: "A2", toCell: "H20" },
      chartTypes: ["bar", "line"],
      category: categories,
      series: [
        {
          seriesId: "series_profit",
          index: 0,
          name: "영업이익",
          nameFormula: null,
          chartType: "bar",
          axis: "primary",
          category: categories,
          values: chartReference(
            "sheet_combo",
            "11_도표7_영업이익_시가총액",
            "B5:G5",
            6,
          ),
        },
        {
          seriesId: "series_market_cap",
          index: 1,
          name: "시가총액",
          nameFormula: null,
          chartType: "line",
          axis: "secondary",
          category: categories,
          values: chartReference(
            "sheet_combo",
            "11_도표7_영업이익_시가총액",
            "B6:G6",
            6,
          ),
        },
      ],
      axes: [
        {
          axisId: "axis_primary",
          type: "value",
          position: "left",
          title: "영업이익",
          numberFormat: "#,##0",
          crossAxisId: "axis_category",
          secondary: false,
        },
        {
          axisId: "axis_secondary",
          type: "value",
          position: "right",
          title: "시가총액",
          numberFormat: "#,##0",
          crossAxisId: "axis_category",
          secondary: true,
        },
      ],
      structureFingerprint: "7".repeat(64),
    },
  ];
  const reportTemplate = chartTemplate(
    "figure_7_chart",
    "분기 영업이익 vs 시가총액 추이",
  );
  Object.assign(reportTemplate.pages[0].slots[0], {
    styleRef: "style_chart_figure_7",
  });

  const result = buildMappingSet(reportTemplate, value);
  const binding = result.mappingSet.bindings[0] as unknown as {
    kind: string;
    styleTemplateRef: string;
    series: Array<{ axis: string; chartType: string }>;
  };

  assert.equal(result.summary.status, "confirmed");
  assert.equal(binding.kind, "composite_chart");
  assert.equal(binding.styleTemplateRef, "style_chart_figure_7");
  assert.deepEqual(
    binding.series.map((series) => [series.chartType, series.axis]),
    [
      ["bar", "primary"],
      ["line", "secondary"],
    ],
  );
  assert.equal(
    validateCompositeChartBinding(binding),
    true,
    JSON.stringify(validateCompositeChartBinding.errors),
  );
});

test("keeps a stable sheet ID and candidate identity after a sheet rename", () => {
  const reportTemplate = template();
  reportTemplate.pages[0].slots = [reportTemplate.pages[0].slots[1]];
  const before = workbook([
    cell("sheet_ooxml_9", "01_실적추이", "F6", "매출액 · 1Q26P"),
  ]);
  before.sheets = [
    {
      ...before.sheets[0],
      sheetId: "sheet_ooxml_9",
      ooxmlSheetId: "9",
      name: "01_실적추이",
    },
  ];
  const after = structuredClone(before);
  after.sheets[0].name = "01_실적_업데이트";
  after.candidateCells[0].sheetName = "01_실적_업데이트";

  const beforeResult = buildMappingSet(reportTemplate, before);
  const afterResult = buildMappingSet(reportTemplate, after);

  assert.equal(beforeResult.summary.status, "confirmed");
  assert.equal(afterResult.summary.status, "confirmed");
  assert.equal(beforeResult.mappingSet.candidates[0].candidateId, afterResult.mappingSet.candidates[0].candidateId);
  assert.equal(afterResult.mappingSet.candidates[0].source.sheetId, "sheet_ooxml_9");
  assert.equal(afterResult.mappingSet.candidates[0].source.sheet, "01_실적_업데이트");
});

test("versions semantic aliases and never auto-selects equally scored required candidates", () => {
  const value = template();
  value.pages[0].slots = [value.pages[0].slots[1]];
  const result = buildMappingSet(
    value,
    workbook([
      cell("sheet_candidate_a", "Candidate A", "F6", "매출액 · 1Q26P"),
      cell("sheet_candidate_b", "Candidate B", "F6", "매출액 · 1Q26P"),
    ]),
  );
  const mappingMetadata = result.mappingSet as unknown as Record<string, unknown>;

  assert.equal(mappingMetadata.semanticAliasVersion, "mapping-alias/2.1");
  assert.equal(mappingMetadata.scoringRuleVersion, "mapping-score/2.1");
  assert.equal(result.summary.status, "blocked");
  assert.equal(result.mappingSet.bindings.length, 0);
  assert.equal(
    result.mappingSet.candidates.filter((candidate) => candidate.selected).length,
    0,
  );
});
