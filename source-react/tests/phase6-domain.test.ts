import assert from "node:assert/strict";
import test from "node:test";
import {
  applyReportOperations,
  attachTemplateGeometry,
  buildInitialOutline,
  buildReportDocument,
  materializeReportBindings,
  patchOutline,
  reportFilename,
  validateOutline,
  validateReportDocument,
  type ReportTemplatePage,
} from "../server/domain/report";

const templatePages: ReportTemplatePage[] = Array.from(
  { length: 5 },
  (_, index) => ({
    pageId: `page-${index + 1}`,
    pageNumber: index + 1,
    boxes: { mediaBox: [0, 0, 595.32, 841.92] },
    objects:
      index === 0
        ? [
            {
              objectId: "title-object",
              type: "text_run",
              bbox: [40, 140, 420, 162],
              textRun: {
                text: "1Q26 Review - 실적 개선과 성장 가시성",
                fontSize: 14,
              },
            },
            {
              objectId: "heading-1",
              type: "text_run",
              bbox: [40, 280, 150, 294],
              textRun: { text: "1분기 실적:", fontSize: 10 },
            },
            {
              objectId: "body-1",
              type: "text_run",
              bbox: [150, 280, 520, 310],
              textRun: {
                text: "매출액과 영업이익이 예상치를 상회한 배경을 설명합니다.",
                fontSize: 10,
              },
            },
            {
              objectId: "heading-2",
              type: "text_run",
              bbox: [40, 360, 150, 374],
              textRun: { text: "향후 전망:", fontSize: 10 },
            },
            {
              objectId: "body-2",
              type: "text_run",
              bbox: [150, 360, 520, 390],
              textRun: {
                text: "판매량 회복과 제품 믹스 개선에 따른 전망을 설명합니다.",
                fontSize: 10,
              },
            },
          ]
        : [
            {
              objectId: `table-heading-${index + 1}`,
              type: "text_run",
              bbox: [40, 110, 260, 126],
              textRun: {
                text: index === 1 ? "요약 손익 계산서" : `재무 표 ${index + 1}`,
                fontSize: 10,
              },
            },
          ],
    slots: [
      {
        slotId: `slot-${index + 1}`,
        blockId: `block-${index + 1}`,
        valueType: index % 2 === 0 ? "table" : "chart",
        required: true,
        semanticKey: { metric: index === 0 ? "revenue" : "operating_profit" },
      },
    ],
  }),
);

const seed = {
  companyName: "Reflo Test",
  targetYear: 2026,
  targetQuarter: 2,
  thesis: "[BUY] Evidence-backed investment thesis",
  rating: "BUY",
  targetPer: "18.5",
  targetPrice: "92500",
  currentPrice: "80100",
  evidence: [
    {
      evidenceId: "evidence-1",
      title: "Quarterly filing",
      oneLineValue: "Revenue and operating profit improved.",
      stance: "supporting",
      machineStatus: "passed",
    },
  ],
  mappingConfirmed: true,
};

const materializationContext = {
  mappingSetResourceVersionId: "mapping-version-1",
  workbookArtifactId: "workbook-artifact-1",
  workbookVersion: 4,
  readModel: {
    schemaVersion: "1.2",
    workbookHash: "workbook-hash-1",
    sheets: [
      {
        sheetId: "sheet-data",
        name: "Data",
        cells: [
          {
            address: "A1",
            row: 1,
            column: 1,
            valueType: "string",
            rawValue: "기간",
            formattedText: "기간",
            formula: null,
            numberFormat: "General",
          },
          {
            address: "B1",
            row: 1,
            column: 2,
            valueType: "string",
            rawValue: "매출",
            formattedText: "매출",
            formula: null,
            numberFormat: "General",
          },
          {
            address: "A2",
            row: 2,
            column: 1,
            valueType: "string",
            rawValue: "1Q26",
            formattedText: "1Q26",
            formula: null,
            numberFormat: "General",
          },
          {
            address: "B2",
            row: 2,
            column: 2,
            valueType: "number",
            rawValue: "120",
            formattedText: "120",
            formula: "=100+20",
            numberFormat: "#,##0",
          },
          {
            address: "A3",
            row: 3,
            column: 1,
            valueType: "string",
            rawValue: "2Q26",
            formattedText: "2Q26",
            formula: null,
            numberFormat: "General",
          },
          {
            address: "B3",
            row: 3,
            column: 2,
            valueType: "number",
            rawValue: "150",
            formattedText: "150",
            formula: "=120+30",
            numberFormat: "#,##0",
          },
        ],
      },
    ],
  },
};

const templateMaterializations = materializeReportBindings(
  templatePages.map((page, index) => {
    const slot = page.slots![0];
    return slot.valueType === "table"
      ? {
          slotId: slot.slotId,
          metric: slot.semanticKey!.metric ?? "unknown_metric",
          kind: "table" as const,
          status: "confirmed" as const,
          sourceLabel: "Data A1:B3",
          sourceAddress: "A1:B3",
          sourceType: "range",
          definition: {
            kind: "table" as const,
            source: {
              sheetId: "sheet-data",
              sheetName: "Data",
              address: "A1:B3",
              structureFingerprint: `table-${index}`,
            },
            rowKeyColumn: "A",
            columnHeaderRow: 1,
            expectedRows: 3,
            expectedColumns: 2,
          },
        }
      : {
          slotId: slot.slotId,
          metric: slot.semanticKey!.metric ?? "unknown_metric",
          kind: "chart" as const,
          status: "confirmed" as const,
          sourceLabel: "Data A2:B3",
          sourceAddress: "A2:B3",
          sourceType: "chart",
          definition: {
            kind: "chart" as const,
            categories: {
              sheetId: "sheet-data",
              sheetName: "Data",
              address: "A2:A3",
              structureFingerprint: `category-${index}`,
            },
            series: [
              {
                seriesId: `series-${index}`,
                label: "매출",
                source: {
                  sheetId: "sheet-data",
                  sheetName: "Data",
                  address: "B2:B3",
                  structureFingerprint: `series-${index}`,
                },
              },
            ],
          },
        };
  }),
  materializationContext,
);

test("Phase 06 outline preserves the exact Template IR page structure", () => {
  const outline = buildInitialOutline(templatePages, seed);

  assert.equal(outline.pages.length, 5);
  assert.deepEqual(
    outline.pages.map((page) => page.pageId),
    templatePages.map((page) => page.pageId),
  );
  assert.equal(outline.pages[0].editable, true);
  assert.equal(outline.pages[0].narrativeBlocks.length, 2);
  assert.equal(outline.pages[0].narrativeBlocks[0].subtitle, "1분기 실적");
  assert.equal(outline.pages[1].narrativeBlocks.length, 0);
  assert.equal(outline.pages[1].recommendedTitle?.value, "요약 손익 계산서");
  assert.equal(outline.pages[0].visualSlots[0].bindingStatus, "confirmed");

  const issues = validateOutline({
    outline,
    templatePageIds: templatePages.map((page) => page.pageId),
    mappingConfirmed: true,
    evidencePassed: true,
    allPageIdsReviewed: outline.pages.map((page) => page.pageId),
  });
  assert.deepEqual(issues, []);
});

test("Phase 06 detects a main-column title and narrative sections without trailing colons", () => {
  const actualBrokerLayout: ReportTemplatePage[] = [
    {
      pageId: "broker-page-1",
      pageNumber: 1,
      boxes: { mediaBox: [0, 0, 595.32, 841.92] },
      objects: [
        {
          objectId: "company-name",
          type: "text_run",
          bbox: [198, 105, 247, 132],
          textRun: { text: "ISC", fontSize: 25.5 },
        },
        {
          objectId: "report-title",
          type: "text_run",
          bbox: [198, 141, 345, 158],
          textRun: { text: "이유 없는 증설은 없다", fontSize: 15.7 },
        },
        {
          objectId: "section-1",
          type: "text_run",
          bbox: [198, 194, 416, 206],
          textRun: {
            text: "4Q25 Review: 데이터센터향 매출이 수익성 견인",
            fontSize: 10.8,
          },
        },
        {
          objectId: "section-1-body-1",
          type: "text_run",
          bbox: [198, 218, 553, 229],
          textRun: {
            text: "4분기 매출과 영업이익이 추정치를 상회한 배경을 설명합니다.",
            fontSize: 9.7,
          },
        },
        {
          objectId: "section-1-body-2",
          type: "text_run",
          bbox: [198, 236, 553, 247],
          textRun: {
            text: "AI 가속기 소켓 출하 증가가 수익성을 견인했습니다.",
            fontSize: 9.7,
          },
        },
        {
          objectId: "section-2",
          type: "text_run",
          bbox: [198, 408, 440, 420],
          textRun: {
            text: "2026 Preview: 대규모 증설로 성장 가시성 확보",
            fontSize: 10.8,
          },
        },
        {
          objectId: "section-2-body",
          type: "text_run",
          bbox: [198, 432, 553, 443],
          textRun: {
            text: "고객사 다변화와 생산능력 확대로 구조적 성장을 전망합니다.",
            fontSize: 9.7,
          },
        },
        {
          objectId: "section-2-body-short",
          type: "text_run",
          bbox: [198, 450, 282, 461],
          textRun: {
            text: "을 것으로 기대된다.",
            fontSize: 9.7,
          },
        },
        {
          objectId: "section-2-orphan",
          type: "text_run",
          bbox: [198, 560, 420, 571],
          textRun: {
            text: "멀리 떨어진 문장은 자동 치환하지 않고 검토 대상으로 남깁니다.",
            fontSize: 9.7,
          },
        },
        {
          objectId: "section-3",
          type: "text_run",
          bbox: [198, 700, 360, 712],
          textRun: {
            text: "목표주가 18만원으로 상향",
            fontSize: 10.8,
          },
        },
        ...Array.from({ length: 5 }, (_, lineIndex) => ({
          objectId: `section-3-body-${lineIndex + 1}`,
          type: "text_run",
          bbox: [
            198,
            724 + lineIndex * 18,
            lineIndex === 4 ? 282 : 553,
            735 + lineIndex * 18,
          ],
          textRun: {
            text:
              lineIndex === 4
                ? "을 것으로 기대된다."
                : `목표주가 산출 근거 본문 ${lineIndex + 1}번째 줄입니다.`,
            fontSize: 9.7,
          },
        })),
        {
          objectId: "sidebar-heading",
          type: "text_run",
          bbox: [42, 204, 74, 212],
          textRun: { text: "Key Data", fontSize: 7.4 },
        },
      ],
      slots: [],
    },
  ];

  const outline = buildInitialOutline(actualBrokerLayout, seed);
  assert.equal(
    outline.pages[0].recommendedTitle?.sourceText,
    "이유 없는 증설은 없다",
  );
  assert.deepEqual(
    outline.pages[0].narrativeBlocks.map((block) => block.subtitle),
    [
      "4Q25 Review: 데이터센터향 매출이 수익성 견인",
      "2026 Preview: 대규모 증설로 성장 가시성 확보",
      "목표주가 18만원으로 상향",
    ],
  );
  assert.deepEqual(outline.pages[0].narrativeBlocks[0].bodyObjectIds, [
    "section-1-body-1",
    "section-1-body-2",
  ]);
  assert.deepEqual(outline.pages[0].narrativeBlocks[1].bodyObjectIds, [
    "section-2-body",
    "section-2-body-short",
  ]);
  assert.equal(
    outline.pages[0].narrativeBlocks[1].bodyBbox?.[3],
    461,
  );
  assert.deepEqual(
    outline.pages[0].narrativeBlocks[1].uncoveredBodyObjectIds,
    ["section-2-orphan"],
  );
  assert.deepEqual(
    outline.pages[0].narrativeBlocks[2].bodyObjectIds,
    Array.from({ length: 5 }, (_, index) => `section-3-body-${index + 1}`),
  );
  assert.equal(
    outline.pages[0].narrativeBlocks[2].bodyBbox?.[3],
    807,
  );

  const hydrated = attachTemplateGeometry(
    {
      schemaVersion: "1.0",
      pageCount: 1,
      pages: [
        {
          pageId: "legacy-page",
          pageNumber: 1,
          pageLabel: "01",
          role: "legacy",
          widthPt: 595.32,
          heightPt: 841.92,
          rotation: 0,
          blocks: [
            {
              blockId: "legacy-body",
              pageId: "legacy-page",
              role: "narrative",
              label: "기업 리뷰",
              text: "기존 한 줄 요약",
              editable: true,
              revision: 1,
              evidenceIds: [],
              numericAuthority: null,
              templateBlockId: null,
              bbox: null,
              sourceObjectIds: [],
              patchStrategy: "fixed",
            },
          ],
        },
      ],
    },
    actualBrokerLayout,
  );
  const generatedHeading = hydrated.pages[0].blocks.find(
    (block) => block.label === "본문 1 소제목",
  );
  assert.ok(generatedHeading);
  assert.equal(generatedHeading.editable, true);
  assert.deepEqual(generatedHeading.bbox, [198, 194, 416, 206]);
});

test("Phase 06 outline patches dynamic title and body blocks", () => {
  const outline = buildInitialOutline(templatePages, seed);
  const page = outline.pages[0];
  const title = page.recommendedTitle;
  const body = page.narrativeBlocks[0];
  assert.ok(title);
  assert.ok(body);

  const patched = patchOutline(outline, [
    {
      pageId: page.pageId,
      blockId: title.blockId,
      field: "value",
      value: "AI 추천 제목 수정",
    },
    {
      pageId: page.pageId,
      blockId: body.blockId,
      field: "summary",
      value: "본문 1에 작성할 내용을 한 문장으로 정리합니다.",
    },
  ]);

  assert.equal(
    patched.content.pages[0].recommendedTitle?.value,
    "AI 추천 제목 수정",
  );
  assert.equal(
    patched.content.pages[0].narrativeBlocks[0].summary,
    "본문 1에 작성할 내용을 한 문장으로 정리합니다.",
  );
  assert.deepEqual(patched.invalidatedPageIds, [page.pageId]);
});

test("Phase 06 materializes confirmed table data without changing workbook values", () => {
  const table = templateMaterializations["slot-1"];
  assert.equal(table.kind, "table");
  assert.equal(table.status, "ready");
  if (table.kind !== "table") return;
  assert.deepEqual(
    table.columns.map((column) => column.label),
    ["기간", "매출"],
  );
  assert.deepEqual(
    table.rows.map((row) => ({
      key: row.rowKey,
      value: row.cells[1]?.rawValue,
      formatted: row.cells[1]?.formattedText,
      formula: row.cells[1]?.formula,
    })),
    [
      {
        key: "1Q26",
        value: "120",
        formatted: "120",
        formula: "=100+20",
      },
      {
        key: "2Q26",
        value: "150",
        formatted: "150",
        formula: "=120+30",
      },
    ],
  );
  assert.equal(table.provenance.workbookVersion, 4);
  assert.equal(
    table.provenance.mappingSetResourceVersionId,
    "mapping-version-1",
  );

  const blocked = materializeReportBindings(
    [
      {
        slotId: "missing-chart-definition",
        metric: "figure_2_chart",
        kind: "chart",
        status: "confirmed",
        sourceLabel: "Data",
        sourceAddress: null,
        sourceType: "chart",
      },
    ],
    materializationContext,
  )["missing-chart-definition"];
  assert.equal(blocked.kind, "chart");
  assert.equal(blocked.status, "blocked");
  assert.equal(blocked.blockerCode, "CHART_SERIES_BINDING_REQUIRED");
});

test("Phase 06 detects individual figure charts and persists chart type changes", () => {
  const chartTemplate: ReportTemplatePage[] = [
    {
      pageId: "chart-page",
      pageNumber: 1,
      boxes: { mediaBox: [0, 0, 595.32, 841.92] },
      blocks: [
        {
          blockId: "figure-2-block",
          role: "chart",
          bbox: [36, 107, 288, 323],
          objectIds: ["chart-heading", "chart-path", "chart-source"],
        },
      ],
      slots: [
        {
          slotId: "figure-2-slot",
          blockId: "figure-2-block",
          valueType: "chart",
          required: true,
          semanticKey: {
            metric: "figure_2_chart",
            scope: "도표 2. 12MF P/E Band",
          },
          targetObjectIds: ["chart-heading", "chart-path", "chart-source"],
        },
      ],
      objects: [
        {
          objectId: "table-heading",
          type: "text_run",
          bbox: [40, 30, 190, 40],
          textRun: { text: "도표 1. Valuation", fontSize: 9 },
        },
        {
          objectId: "table-row-1",
          type: "path",
          bbox: [40, 48, 280, 62],
        },
        {
          objectId: "table-row-2",
          type: "path",
          bbox: [40, 62, 280, 76],
        },
        {
          objectId: "chart-heading",
          type: "text_run",
          bbox: [40, 110, 220, 120],
          textRun: { text: "도표 2. 12MF P/E Band", fontSize: 9 },
        },
        {
          objectId: "chart-path",
          type: "path",
          bbox: [42, 132, 284, 306],
        },
        {
          objectId: "chart-source",
          type: "text_run",
          bbox: [40, 311, 150, 320],
          textRun: { text: "자료: FnGuide", fontSize: 7 },
        },
        {
          objectId: "diagram-heading",
          type: "text_run",
          bbox: [40, 360, 330, 370],
          textRun: {
            text: "도표 6. 사업개요 및 시너지 효과",
            fontSize: 9,
          },
        },
        {
          objectId: "diagram-caption",
          type: "text_run",
          bbox: [72, 386, 210, 404],
          textRun: { text: "사업 부문과의 시너지 효과", fontSize: 8 },
        },
        {
          objectId: "diagram-source",
          type: "text_run",
          bbox: [40, 532, 150, 541],
          textRun: { text: "자료: 회사자료", fontSize: 7 },
        },
      ],
    },
  ];
  const chartBindings = [
    {
      slotId: "figure-2-slot",
      metric: "figure_2_chart",
      kind: "chart" as const,
      status: "confirmed" as const,
      sourceLabel: "Data A2:B3",
      sourceAddress: "A2:B3",
      sourceType: "chart",
      definition: {
        kind: "chart" as const,
        categories: {
          sheetId: "sheet-data",
          sheetName: "Data",
          address: "A2:A3",
          structureFingerprint: "figure-2-category",
        },
        series: [
          {
            seriesId: "figure-2-price",
            label: "수정주가",
            source: {
              sheetId: "sheet-data",
              sheetName: "Data",
              address: "B2:B3",
              structureFingerprint: "figure-2-series",
            },
          },
        ],
      },
    },
  ];
  const chartMaterializations = materializeReportBindings(
    chartBindings,
    materializationContext,
  );
  const hydrated = attachTemplateGeometry(
    {
      schemaVersion: "1.0",
      pageCount: 1,
      pages: [
        {
          pageId: "chart-page",
          pageNumber: 1,
          pageLabel: "01",
          role: "source",
          widthPt: 595.32,
          heightPt: 841.92,
          rotation: 0,
          blocks: [
            {
              blockId: "chart-page.fixed",
              pageId: "chart-page",
              role: "fixed",
              label: "fixed",
              text: "fixed",
              editable: false,
              revision: 1,
              evidenceIds: [],
              numericAuthority: null,
              templateBlockId: null,
              bbox: null,
              sourceObjectIds: [],
              patchStrategy: "fixed",
            },
            {
              blockId: "chart-page.chart.figure-6",
              pageId: "chart-page",
              role: "visual",
              label: "도표 6. 사업개요 및 시너지 효과",
              text: "도표 6. 사업개요 및 시너지 효과 · 연결 필요",
              editable: false,
              revision: 1,
              evidenceIds: [],
              numericAuthority: "mapping_required",
              templateBlockId: "chart-page.detected-chart.6",
              bbox: [32, 357, 563.32, 544],
              sourceObjectIds: ["diagram-heading"],
              dataBinding: {
                metric: "figure_6_chart",
                kind: "chart",
                status: "unmapped",
                sourceLabel: null,
                sourceAddress: null,
                sourceType: null,
              },
              patchStrategy: "fixed",
            },
          ],
        },
      ],
    },
    chartTemplate,
    chartBindings,
    chartMaterializations,
  );
  const chartBlocks = hydrated.pages[0].blocks.filter(
    (block) => block.dataBinding?.kind === "chart",
  );
  assert.equal(chartBlocks.length, 1);
  const dataChart = chartBlocks.find(
    (block) => block.label === "도표 2. 12MF P/E Band",
  );
  const imageDiagram = hydrated.pages[0].blocks.find(
    (block) => block.label === "도표 6. 사업개요 및 시너지 효과",
  );
  assert.ok(dataChart);
  assert.ok(imageDiagram);
  assert.deepEqual(dataChart.bbox, [36, 107, 288, 323]);
  assert.deepEqual(imageDiagram.bbox, [32, 357, 563.32, 544]);
  assert.equal(dataChart.materializedData?.kind, "chart");
  assert.equal(dataChart.materializedData?.status, "ready");
  if (dataChart.materializedData?.kind === "chart") {
    assert.deepEqual(dataChart.materializedData.supportedChartTypes, [
      "line",
      "area",
    ]);
  }
  assert.equal(imageDiagram.dataBinding, null);
  assert.equal(imageDiagram.materializedData?.kind, "fixed_visual");
  assert.equal(
    hydrated.pages[0].blocks.filter(
      (block) => block.materializedData?.kind === "fixed_visual",
    ).length,
    1,
  );

  const changed = applyReportOperations(hydrated, [
    {
      type: "replace_chart_type",
      blockId: dataChart.blockId,
      baseBlockRevision: dataChart.revision,
      chartType: "area",
    },
  ]);
  const changedChart = changed.pages[0].blocks.find(
    (block) => block.blockId === dataChart.blockId,
  );
  assert.equal(changedChart?.chartType, "area");
  assert.equal(changedChart?.revision, 2);

  assert.throws(
    () =>
      applyReportOperations(hydrated, [
        {
          type: "replace_chart_type",
          blockId: dataChart.blockId,
          baseBlockRevision: dataChart.revision,
          chartType: "bar",
        },
      ]),
    /INVALID_REPORT_OPERATION/,
  );

  const disconnected = structuredClone(hydrated);
  const disconnectedChart = disconnected.pages[0].blocks.find(
    (block) => block.blockId === dataChart.blockId,
  );
  assert.ok(disconnectedChart?.dataBinding);
  disconnectedChart.dataBinding.status = "unmapped";
  assert.throws(
    () =>
      applyReportOperations(disconnected, [
        {
          type: "replace_chart_type",
          blockId: dataChart.blockId,
          baseBlockRevision: dataChart.revision,
          chartType: "line",
        },
      ]),
    /INVALID_REPORT_OPERATION/,
  );
  assert.ok(
    validateReportDocument({
      document: disconnected,
      templatePageIds: ["chart-page"],
      evidenceIds: new Set(),
      valuationText: {
        targetPer: seed.targetPer,
        targetPrice: seed.targetPrice,
        forwardEps: "5000",
      },
    }).some(
      (issue) => issue.code === "REPORT_DATA_BINDING_NOT_CONFIRMED",
    ),
  );
});

test("Phase 06 report edits only editable blocks and tracks revisions", () => {
  const outline = buildInitialOutline(templatePages, seed);
  const report = buildReportDocument({
    outline,
    rating: seed.rating,
    targetPer: seed.targetPer,
    targetPrice: seed.targetPrice,
    currentPrice: seed.currentPrice,
    forwardEps: "5000",
    materializationsBySlotId: templateMaterializations,
  });
  const editable = report.pages[0].blocks.find((block) => block.editable);
  assert.ok(editable);

  const changed = applyReportOperations(report, [
    {
      type: "replace_block_text",
      blockId: editable.blockId,
      baseBlockRevision: editable.revision,
      text: "Updated report title",
    },
  ]);
  const changedBlock = changed.pages[0].blocks.find(
    (block) => block.blockId === editable.blockId,
  );
  assert.equal(changedBlock?.text, "Updated report title");
  assert.equal(changedBlock?.revision, editable.revision + 1);

  const numeric = report.pages[0].blocks.find(
    (block) => block.numericAuthority === "valuation_approval",
  );
  assert.ok(numeric);
  assert.throws(
    () =>
      applyReportOperations(report, [
        {
          type: "replace_block_text",
          blockId: numeric.blockId,
          baseBlockRevision: numeric.revision,
          text: "tampered",
        },
      ]),
    /INVALID_REPORT_OPERATION/,
  );
});

test("Phase 06 validation detects valuation drift", () => {
  const outline = buildInitialOutline(templatePages, seed);
  const report = buildReportDocument({
    outline,
    rating: seed.rating,
    targetPer: seed.targetPer,
    targetPrice: seed.targetPrice,
    currentPrice: seed.currentPrice,
    forwardEps: "5000",
    materializationsBySlotId: templateMaterializations,
  });
  const evidenceIds = new Set(seed.evidence.map((item) => item.evidenceId));
  const validIssues = validateReportDocument({
    document: report,
    templatePageIds: templatePages.map((page) => page.pageId),
    evidenceIds,
    valuationText: {
      targetPer: seed.targetPer,
      targetPrice: seed.targetPrice,
      forwardEps: "5000",
    },
  });
  assert.deepEqual(validIssues, []);

  const altered = structuredClone(report);
  const numeric = altered.pages[0].blocks.find(
    (block) => block.numericAuthority === "valuation_approval",
  );
  assert.ok(numeric);
  numeric.text = numeric.text.replace("18.5", "20.0");
  const issues = validateReportDocument({
    document: altered,
    templatePageIds: templatePages.map((page) => page.pageId),
    evidenceIds,
    valuationText: {
      targetPer: seed.targetPer,
      targetPrice: seed.targetPrice,
      forwardEps: "5000",
    },
  });
  assert.ok(issues.some((issue) => issue.code === "NUMERIC_AUTHORITY_MISMATCH"));

  const incomplete = structuredClone(report);
  const editable = incomplete.pages[0].blocks.find((block) => block.editable);
  assert.ok(editable);
  editable.sourceCoverage = "review_required";
  editable.uncoveredSourceObjectIds = ["orphan-line"];
  const coverageIssues = validateReportDocument({
    document: incomplete,
    templatePageIds: templatePages.map((page) => page.pageId),
    evidenceIds,
    valuationText: {
      targetPer: seed.targetPer,
      targetPrice: seed.targetPrice,
      forwardEps: "5000",
    },
  });
  assert.ok(
    coverageIssues.some(
      (issue) => issue.code === "SOURCE_TEXT_COVERAGE_INCOMPLETE",
    ),
  );
});

test("Phase 06 export filename is stable and filesystem-safe", () => {
  const filename = reportFilename({
    companyName: "Reflo/Test",
    ticker: "RFLO",
    year: 2026,
    quarter: 2,
    reportVersion: 7,
    approvedAt: new Date("2026-07-25T00:00:00.000Z"),
    extension: "pdf",
  });

  assert.match(filename, /^Reflo_Test_RFLO_2026Q2_.+_v7_20260725\.pdf$/);
  assert.doesNotMatch(filename, /[\\/:*?"<>|]/);
});
