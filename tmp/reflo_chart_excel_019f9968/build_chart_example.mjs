import fs from "node:fs/promises";
import { FileBlob, SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const outputDir = "D:/Reflo_fin/outputs/019f9968-reflo-chart-example";
const outputPath = `${outputDir}/REFLO_차트_데이터_예시.xlsx`;
const previewDir = `${outputDir}/previews`;
const chartLimit = Number(process.env.REFLO_CHART_LIMIT || "4");

const workbook = Workbook.create();
const guide = workbook.worksheets.add("README");
const raw = workbook.worksheets.add("01_RAW_INPUT");
const bridge = workbook.worksheets.add("_REFLO_BRIDGE");
const mapping = workbook.worksheets.add("02_CHART_MAPPING");
const charts = workbook.worksheets.add("03_CHARTS");
const checks = workbook.worksheets.add("04_CHECKS");

const COLORS = {
  ink: "#1E2420",
  muted: "#687168",
  line: "#DDE3DC",
  paper: "#FFFFFF",
  band: "#F4F6F3",
  lime: "#C8FF3D",
  limeDark: "#5C850D",
  green: "#2D6E65",
  green2: "#76B6AA",
  green3: "#C5DED8",
  gray: "#BFC4BF",
  blue: "#0000FF",
  formulaGreen: "#008000",
  warning: "#FFF2CC",
  ok: "#E2F0D9",
  fail: "#FCE4D6",
  dark: "#172016",
};

function styleTitle(sheet, range, text) {
  const target = sheet.getRange(range);
  target.merge();
  target.values = [[text]];
  target.format = {
    fill: COLORS.dark,
    font: { name: "Aptos Display", size: 18, bold: true, color: "#FFFFFF" },
    verticalAlignment: "center",
    horizontalAlignment: "left",
  };
  target.format.rowHeight = 34;
}

function styleSection(sheet, range, text) {
  const target = sheet.getRange(range);
  target.merge();
  target.values = [[text]];
  target.format = {
    fill: COLORS.band,
    font: { name: "Aptos", size: 11, bold: true, color: COLORS.ink },
    borders: { bottom: { style: "thin", color: COLORS.line } },
    verticalAlignment: "center",
  };
  target.format.rowHeight = 24;
}

function styleHeader(range) {
  range.format = {
    fill: COLORS.green,
    font: { name: "Aptos", size: 9, bold: true, color: "#FFFFFF" },
    horizontalAlignment: "center",
    verticalAlignment: "center",
    borders: {
      bottom: { style: "thin", color: "#1D544C" },
      insideVertical: { style: "thin", color: "#90B8B1" },
    },
    wrapText: true,
  };
  range.format.rowHeight = 28;
}

function styleBody(range) {
  range.format = {
    font: { name: "Aptos", size: 9, color: COLORS.ink },
    borders: { bottom: { style: "thin", color: "#E8ECE7" } },
    verticalAlignment: "center",
  };
  range.format.rowHeight = 20;
}

function addTable(sheet, range, name) {
  const table = sheet.tables.add(range, true, name);
  table.style = "TableStyleMedium4";
  table.showBandedRows = true;
  table.showFilterButton = true;
  return table;
}

guide.showGridLines = false;
raw.showGridLines = false;
bridge.showGridLines = false;
mapping.showGridLines = false;
charts.showGridLines = false;
checks.showGridLines = false;

// README
styleTitle(guide, "A1:H2", "REFLO 차트 데이터 예시");
guide.getRange("A4:H4").merge();
guide.getRange("A4").values = [["전 분기 PDF의 차트 디자인을 유지하면서 이번 분기 수치만 교체하기 위한 예시 구조입니다."]];
guide.getRange("A4:H4").format = {
  font: { name: "Aptos", size: 11, color: COLORS.muted },
  wrapText: true,
  verticalAlignment: "center",
};
guide.getRange("A4:H4").format.rowHeight = 32;

styleSection(guide, "A6:H6", "사용 방법");
guide.getRange("A7:H11").values = [
  ["1", "01_RAW_INPUT", "파란 글씨의 가상 입력값을 이번 분기 실제 데이터로 교체합니다.", null, null, null, null, null],
  ["2", "_REFLO_BRIDGE", "차트마다 하나의 표준 테이블로 정규화합니다. 녹색 글씨는 다른 시트 참조식입니다.", null, null, null, null, null],
  ["3", "02_CHART_MAPPING", "PDF chart slot과 category·series 범위를 연결하는 매핑 명세입니다.", null, null, null, null, null],
  ["4", "03_CHARTS", "표준 테이블을 참조해 실제 Excel 차트 4개를 표시합니다.", null, null, null, null, null],
  ["5", "04_CHECKS", "category·series 길이와 비중 합계 등을 자동 점검합니다.", null, null, null, null, null],
];
guide.getRange("A7:A11").format = {
  fill: COLORS.lime,
  font: { bold: true, color: COLORS.dark },
  horizontalAlignment: "center",
  verticalAlignment: "center",
};
guide.getRange("B7:B11").format = { font: { bold: true, color: COLORS.ink } };
guide.getRange("C7:H11").merge(true);
guide.getRange("A7:H11").format.borders = { preset: "inside", style: "thin", color: COLORS.line };
guide.getRange("C7:H11").format.wrapText = true;
guide.getRange("A7:H11").format.rowHeight = 28;

styleSection(guide, "A13:H13", "핵심 원칙");
guide.getRange("A14:H17").values = [
  ["✓", "차트 하나당 시트 하나가 아니라 차트 하나당 표준 데이터 테이블 하나를 사용합니다.", null, null, null, null, null, null],
  ["✓", "Excel 차트의 모양은 복사하지 않습니다. 색상·축·범례·레이아웃은 전 분기 PDF의 Template IR이 소유합니다.", null, null, null, null, null, null],
  ["✓", "사용자 원본 파일은 변경하지 않고 작업 사본의 _REFLO_BRIDGE만 시스템이 생성·갱신합니다.", null, null, null, null, null, null],
  ["!", "이 파일의 모든 수치는 구조 설명을 위한 가상값이며 실제 투자판단이나 기업 분석에 사용할 수 없습니다.", null, null, null, null, null, null],
];
guide.getRange("B14:H17").merge(true);
guide.getRange("A14:A16").format = { font: { bold: true, color: COLORS.limeDark }, horizontalAlignment: "center" };
guide.getRange("A17").format = { fill: COLORS.warning, font: { bold: true, color: "#9C6500" }, horizontalAlignment: "center" };
guide.getRange("A14:H17").format.borders = { preset: "inside", style: "thin", color: COLORS.line };
guide.getRange("B14:H17").format.wrapText = true;
guide.getRange("A14:H17").format.rowHeight = 30;

styleSection(guide, "A19:H19", "색상 규칙");
guide.getRange("A20:D23").values = [
  ["표시", "의미", "예시", "편집 여부"],
  ["파란 글씨", "사용자 입력 또는 교체 대상", "이번 분기 실적·믹스", "편집"],
  ["녹색 글씨", "다른 시트에서 연결된 값", "_REFLO_BRIDGE", "자동"],
  ["검은 글씨", "수식·검증·설명", "합계·상태", "자동"],
];
styleHeader(guide.getRange("A20:D20"));
styleBody(guide.getRange("A21:D23"));
guide.getRange("A21").format.font = { color: COLORS.blue, bold: true };
guide.getRange("A22").format.font = { color: COLORS.formulaGreen, bold: true };
guide.getRange("A23").format.font = { color: COLORS.ink, bold: true };
guide.getRange("A1:H25").format.font.name = "Aptos";
guide.getRange("A1:H25").format.verticalAlignment = "center";
guide.getRange("A:A").format.columnWidth = 7;
guide.getRange("B:B").format.columnWidth = 22;
guide.getRange("C:H").format.columnWidth = 15;
guide.freezePanes.freezeRows(2);

// Raw input data
styleTitle(raw, "A1:H2", "01 · RAW INPUT — 가상 이번 분기 데이터");
raw.getRange("A3:H3").merge();
raw.getRange("A3").values = [["파란 글씨만 입력 영역입니다. 회색 상태 열은 Actual / Estimate 구분 예시입니다."]];
raw.getRange("A3:H3").format = { font: { size: 9, color: COLORS.muted }, wrapText: true };

const trendPeriods = [
  "20Q1","20Q2","20Q3","20Q4","21Q1","21Q2","21Q3","21Q4",
  "22Q1","22Q2","22Q3","22Q4","23Q1","23Q2","23Q3","23Q4",
  "24Q1","24Q2","24Q3","24Q4","25Q1","25Q2","25Q3","25Q4",
  "26Q1","26Q2E","26Q3E","26Q4E",
];
const opValues = [1180,1320,1040,980,1250,1450,1800,1520,1410,1330,1480,2520,1980,1710,1580,240,1490,1630,1180,930,1510,1320,1420,1580,1980,2140,2460,3010];
const marketCaps = [1.8,2.4,2.6,2.9,3.4,3.8,4.3,4.7,5.2,4.8,5.7,5.1,4.6,5.9,13.5,15.8,18.3,13.2,9.8,10.6,12.4,9.1,8.8,11.7,17.9,22.8,25.1,31.2];
const trendRows = trendPeriods.map((period, index) => [
  period,
  opValues[index],
  marketCaps[index],
  index >= 25 ? "Estimate" : "Actual",
]);
styleSection(raw, "A5:D5", "도표 7 · 분기 영업이익 vs 시가총액");
raw.getRange(`A6:D${6 + trendRows.length}`).values = [
  ["period", "operating_profit_억원", "market_cap_조원", "status"],
  ...trendRows,
];
styleHeader(raw.getRange("A6:D6"));
styleBody(raw.getRange(`A7:D${6 + trendRows.length}`));
raw.getRange(`B7:C${6 + trendRows.length}`).format.font = { color: COLORS.blue };
raw.getRange(`B7:B${6 + trendRows.length}`).format.numberFormat = "#,##0;[Red](#,##0);-";
raw.getRange(`C7:C${6 + trendRows.length}`).format.numberFormat = "0.0";
addTable(raw, `A6:D${6 + trendRows.length}`, "RawOpMarketCap");

const mixPeriods = [
  "21Q1","21Q2","21Q3","21Q4","22Q1","22Q2","22Q3","22Q4","23Q1","23Q2",
  "23Q3","23Q4","24Q1","24Q2","24Q3","24Q4","25Q1","25Q2","25Q3","25Q4",
];
const dc = [0.24,0.26,0.28,0.27,0.31,0.36,0.42,0.38,0.34,0.30,0.28,0.26,0.29,0.33,0.38,0.42,0.46,0.50,0.55,0.61];
const smartphone = [0.38,0.37,0.36,0.36,0.35,0.32,0.28,0.29,0.31,0.33,0.34,0.35,0.34,0.32,0.29,0.27,0.25,0.23,0.21,0.18];
const pc = [0.12,0.11,0.10,0.11,0.10,0.09,0.08,0.08,0.09,0.09,0.09,0.09,0.08,0.08,0.07,0.07,0.06,0.06,0.05,0.04];
const auto = [0.07,0.07,0.08,0.08,0.08,0.08,0.09,0.09,0.10,0.10,0.10,0.11,0.11,0.10,0.10,0.09,0.09,0.08,0.07,0.06];
const wearable = [0.05,0.05,0.05,0.05,0.05,0.05,0.05,0.05,0.05,0.05,0.05,0.05,0.05,0.05,0.05,0.05,0.05,0.05,0.05,0.04];
const lsi = [0.08,0.08,0.07,0.07,0.07,0.07,0.05,0.06,0.06,0.07,0.07,0.07,0.07,0.07,0.07,0.06,0.06,0.06,0.05,0.04];
const mixRows = mixPeriods.map((period, index) => [
  period, dc[index], smartphone[index], pc[index], auto[index], wearable[index], lsi[index], null,
]);
styleSection(raw, "F5:M5", "도표 8 · 애플리케이션별 매출 비중");
raw.getRange(`F6:M${6 + mixRows.length}`).values = [
  ["period","데이터센터","스마트폰","PC_노트북","Auto","Wearable","LSI","기타"],
  ...mixRows,
];
raw.getRange("M7").formulas = [["=1-SUM(G7:L7)"]];
raw.getRange(`M7:M${6 + mixRows.length}`).fillDown();
styleHeader(raw.getRange("F6:M6"));
styleBody(raw.getRange(`F7:M${6 + mixRows.length}`));
raw.getRange(`G7:L${6 + mixRows.length}`).format.font = { color: COLORS.blue };
raw.getRange(`M7:M${6 + mixRows.length}`).format.font = { color: COLORS.ink };
raw.getRange(`G7:M${6 + mixRows.length}`).format.numberFormat = "0.0%";
addTable(raw, `F6:M${6 + mixRows.length}`, "RawApplicationMix");

const annualRows = [
  ["2019", 88, 0.03, "Actual"],
  ["2020", 121, 0.15, "Actual"],
  ["2021", 145, 0.26, "Actual"],
  ["2022", 178, 0.31, "Actual"],
  ["2023", 84, 0.08, "Actual"],
  ["2024", 172, 0.25, "Actual"],
  ["2025E", 220, 0.27, "Estimate"],
  ["2026E", 312, 0.31, "Estimate"],
  ["2027E", 374, 0.33, "Estimate"],
];
styleSection(raw, "A38:D38", "도표 9 · 연간 매출액 및 OPM");
raw.getRange(`A39:D${39 + annualRows.length}`).values = [
  ["year", "revenue_십억원", "opm", "status"],
  ...annualRows,
];
styleHeader(raw.getRange("A39:D39"));
styleBody(raw.getRange(`A40:D${39 + annualRows.length}`));
raw.getRange(`B40:C${39 + annualRows.length}`).format.font = { color: COLORS.blue };
raw.getRange(`B40:B${39 + annualRows.length}`).format.numberFormat = "#,##0;[Red](#,##0);-";
raw.getRange(`C40:C${39 + annualRows.length}`).format.numberFormat = "0.0%";
addTable(raw, `A39:D${39 + annualRows.length}`, "RawAnnualPerformance");

const productPeriods = [
  "19Q1","19Q2","19Q3","19Q4","20Q1","20Q2","20Q3","20Q4",
  "21Q1","21Q2","21Q3","21Q4","22Q1","22Q2","22Q3","22Q4",
  "23Q1","23Q2","23Q3","23Q4","24Q1","24Q2","24Q3","24Q4",
  "25Q1","25Q2","25Q3","25Q4","26Q1","26Q2E","26Q3E","26Q4E",
];
const socket = [18,22,17,26,21,28,37,31,24,33,29,34,38,45,49,41,45,34,33,28,24,31,49,50,38,34,29,52,60,62,59,68];
const nonSocket = [2,3,3,2,3,4,2,4,3,5,4,5,6,7,5,5,3,4,4,5,4,5,2,2,4,4,4,12,6,10,17,20];
const productRows = productPeriods.map((period, index) => [
  period,
  socket[index],
  nonSocket[index],
  index >= 29 ? "Estimate" : "Actual",
]);
styleSection(raw, "F31:I31", "도표 10 · 제품별 매출");
raw.getRange(`F32:I${32 + productRows.length}`).values = [
  ["period","Socket_십억원","Non_socket_십억원","status"],
  ...productRows,
];
styleHeader(raw.getRange("F32:I32"));
styleBody(raw.getRange(`F33:I${32 + productRows.length}`));
raw.getRange(`G33:H${32 + productRows.length}`).format.font = { color: COLORS.blue };
raw.getRange(`G33:H${32 + productRows.length}`).format.numberFormat = "#,##0.0;[Red](#,##0.0);-";
addTable(raw, `F32:I${32 + productRows.length}`, "RawProductMix");

raw.getRange("A:A").format.columnWidth = 11;
raw.getRange("B:C").format.columnWidth = 18;
raw.getRange("D:D").format.columnWidth = 12;
raw.getRange("E:E").format.columnWidth = 3;
raw.getRange("F:F").format.columnWidth = 11;
raw.getRange("G:M").format.columnWidth = 14;
raw.freezePanes.freezeRows(3);

// Canonical bridge data: one table per chart slot.
styleTitle(bridge, "A1:L2", "_REFLO_BRIDGE · 차트별 표준 데이터");
bridge.getRange("A3:L3").merge();
bridge.getRange("A3").values = [["시스템 생성 영역 예시입니다. 사용자 원본을 수정하지 않고 chart slot별 category·series를 정규화합니다."]];
bridge.getRange("A3:L3").format = { font: { size: 9, color: COLORS.muted }, wrapText: true };

styleSection(bridge, "A5:C5", "chart_op_marketcap");
bridge.getRange("A6:C6").values = [["period","operating_profit_억원","market_cap_조원"]];
for (let row = 7; row <= 34; row += 1) {
  const sourceRow = row;
  bridge.getRange(`A${row}:C${row}`).formulas = [[
    `='01_RAW_INPUT'!A${sourceRow}`,
    `='01_RAW_INPUT'!B${sourceRow}`,
    `='01_RAW_INPUT'!C${sourceRow}`,
  ]];
}
styleHeader(bridge.getRange("A6:C6"));
styleBody(bridge.getRange("A7:C34"));
bridge.getRange("A7:C34").format.font = { color: COLORS.formulaGreen };
bridge.getRange("B7:B34").format.numberFormat = "#,##0";
bridge.getRange("C7:C34").format.numberFormat = "0.0";
addTable(bridge, "A6:C34", "BridgeOpMarketCap");

styleSection(bridge, "E5:L5", "chart_application_mix");
bridge.getRange("E6:L6").values = [["period","데이터센터","스마트폰","PC_노트북","Auto","Wearable","LSI","기타"]];
for (let row = 7; row <= 26; row += 1) {
  const sourceRow = row;
  const formulas = [];
  for (let col = 0; col < 8; col += 1) {
    const sourceCol = String.fromCharCode("F".charCodeAt(0) + col);
    formulas.push(`='01_RAW_INPUT'!${sourceCol}${sourceRow}`);
  }
  bridge.getRange(`E${row}:L${row}`).formulas = [[...formulas]];
}
styleHeader(bridge.getRange("E6:L6"));
styleBody(bridge.getRange("E7:L26"));
bridge.getRange("E7:L26").format.font = { color: COLORS.formulaGreen };
bridge.getRange("F7:L26").format.numberFormat = "0.0%";
addTable(bridge, "E6:L26", "BridgeApplicationMix");

styleSection(bridge, "A38:C38", "chart_annual_performance");
bridge.getRange("A39:C39").values = [["year","revenue_십억원","opm"]];
for (let row = 40; row <= 48; row += 1) {
  const sourceRow = row;
  bridge.getRange(`A${row}:C${row}`).formulas = [[
    `='01_RAW_INPUT'!A${sourceRow}`,
    `='01_RAW_INPUT'!B${sourceRow}`,
    `='01_RAW_INPUT'!C${sourceRow}`,
  ]];
}
styleHeader(bridge.getRange("A39:C39"));
styleBody(bridge.getRange("A40:C48"));
bridge.getRange("A40:C48").format.font = { color: COLORS.formulaGreen };
bridge.getRange("B40:B48").format.numberFormat = "#,##0";
bridge.getRange("C40:C48").format.numberFormat = "0.0%";
addTable(bridge, "A39:C48", "BridgeAnnualPerformance");

styleSection(bridge, "E38:G38", "chart_product_mix");
bridge.getRange("E39:G39").values = [["period","Socket_십억원","Non_socket_십억원"]];
for (let row = 40; row <= 71; row += 1) {
  const sourceRow = row - 7;
  bridge.getRange(`E${row}:G${row}`).formulas = [[
    `='01_RAW_INPUT'!F${sourceRow}`,
    `='01_RAW_INPUT'!G${sourceRow}`,
    `='01_RAW_INPUT'!H${sourceRow}`,
  ]];
}
styleHeader(bridge.getRange("E39:G39"));
styleBody(bridge.getRange("E40:G71"));
bridge.getRange("E40:G71").format.font = { color: COLORS.formulaGreen };
bridge.getRange("F40:G71").format.numberFormat = "#,##0.0";
addTable(bridge, "E39:G71", "BridgeProductMix");

bridge.getRange("A:A").format.columnWidth = 12;
bridge.getRange("B:C").format.columnWidth = 21;
bridge.getRange("D:D").format.columnWidth = 3;
bridge.getRange("E:E").format.columnWidth = 12;
bridge.getRange("F:L").format.columnWidth = 15;
bridge.freezePanes.freezeRows(3);

// Mapping manifest
styleTitle(mapping, "A1:J2", "02 · CHART MAPPING MANIFEST");
mapping.getRange("A3:J3").merge();
mapping.getRange("A3").values = [["PDF의 chart slot과 _REFLO_BRIDGE 테이블을 연결하는 예시입니다. 주소가 아니라 chart_id와 semantic key를 안정 식별자로 사용합니다."]];
mapping.getRange("A3:J3").format = { font: { size: 9, color: COLORS.muted }, wrapText: true };
mapping.getRange("A5:J9").values = [
  ["chart_id","PDF 제목","template_slot_id","category_range","series_1","series_2","additional_series","권장 표현","단위","검증 규칙"],
  ["chart_op_marketcap","분기 영업이익 vs 시가총액","p7.op_marketcap","'_REFLO_BRIDGE'!$A$7:$A$34","B7:B34 · operating_profit","C7:C34 · market_cap","—","column + line · dual axis","억원 / 조원","기간 및 2개 series 길이 일치"],
  ["chart_application_mix","애플리케이션별 매출 비중","p8.application_mix","'_REFLO_BRIDGE'!$E$7:$E$26","F7:F26 · 데이터센터","G7:G26 · 스마트폰","H:L · 나머지 5개 series","stacked column","%","분기별 합계 100%"],
  ["chart_annual_performance","연간 매출액 및 OPM","p9.annual_performance","'_REFLO_BRIDGE'!$A$40:$A$48","B40:B48 · revenue","C40:C48 · OPM","—","column + line · dual axis","십억원 / %","Actual·Estimate 구분"],
  ["chart_product_mix","제품별 매출","p10.product_mix","'_REFLO_BRIDGE'!$E$40:$E$71","F40:F71 · Socket","G40:G71 · Non-socket","—","stacked column","십억원","기간 및 2개 series 길이 일치"],
];
styleHeader(mapping.getRange("A5:J5"));
styleBody(mapping.getRange("A6:J9"));
mapping.getRange("A6:A9").format.font = { color: COLORS.limeDark, bold: true };
mapping.getRange("C6:G9").format.font = { color: COLORS.formulaGreen };
mapping.getRange("A5:J9").format.wrapText = true;
mapping.getRange("A6:J9").format.rowHeight = 44;
addTable(mapping, "A5:J9", "ChartMappingManifest");
mapping.getRange("A:A").format.columnWidth = 24;
mapping.getRange("B:B").format.columnWidth = 26;
mapping.getRange("C:C").format.columnWidth = 24;
mapping.getRange("D:D").format.columnWidth = 29;
mapping.getRange("E:G").format.columnWidth = 25;
mapping.getRange("H:H").format.columnWidth = 24;
mapping.getRange("I:I").format.columnWidth = 15;
mapping.getRange("J:J").format.columnWidth = 28;
mapping.freezePanes.freezeRows(5);

// Charts and formula-backed helper ranges
styleTitle(charts, "A1:Q2", "03 · CHART PREVIEW — 표준 테이블 기반");
charts.getRange("A3:Q3").merge();
charts.getRange("A3").values = [["Excel 차트는 데이터 연결 확인용입니다. 최종 PDF에서는 Template IR의 원본 디자인으로 다시 렌더링합니다."]];
charts.getRange("A3:Q3").format = { font: { size: 9, color: COLORS.muted }, wrapText: true };

// Helper block 1: scale market cap to KRW 100bn units for a readable single-axis preview.
charts.getRange("A41:C41").values = [["period","영업이익(억원)","시가총액(천억원)"]];
for (let row = 42; row <= 69; row += 1) {
  const bridgeRow = row - 35;
  charts.getRange(`A${row}:C${row}`).formulas = [[
    `='_REFLO_BRIDGE'!A${bridgeRow}`,
    `='_REFLO_BRIDGE'!B${bridgeRow}`,
    `='_REFLO_BRIDGE'!C${bridgeRow}*100`,
  ]];
}
charts.getRange("A41:C69").format.font = { color: COLORS.formulaGreen, size: 8 };
charts.getRange("B42:C69").format.numberFormat = "#,##0";

charts.getRange("E41:L41").values = [["period","데이터센터","스마트폰","PC/노트북","Auto","Wearable","LSI","기타"]];
for (let row = 42; row <= 61; row += 1) {
  const bridgeRow = row - 35;
  const formulas = [];
  for (const col of ["E","F","G","H","I","J","K","L"]) formulas.push(`='_REFLO_BRIDGE'!${col}${bridgeRow}`);
  charts.getRange(`E${row}:L${row}`).formulas = [[...formulas]];
}
charts.getRange("E41:L61").format.font = { color: COLORS.formulaGreen, size: 8 };
charts.getRange("F42:L61").format.numberFormat = "0.0%";

charts.getRange("N41:P41").values = [["year","매출액(십억원)","OPM × 10"]];
for (let row = 42; row <= 50; row += 1) {
  const bridgeRow = row - 2;
  charts.getRange(`N${row}:P${row}`).formulas = [[
    `='_REFLO_BRIDGE'!A${bridgeRow}`,
    `='_REFLO_BRIDGE'!B${bridgeRow}`,
    `='_REFLO_BRIDGE'!C${bridgeRow}*1000`,
  ]];
}
charts.getRange("N41:P50").format.font = { color: COLORS.formulaGreen, size: 8 };
charts.getRange("O42:P50").format.numberFormat = "#,##0";

charts.getRange("N54:P54").values = [["period","Socket","Non-socket"]];
for (let row = 55; row <= 86; row += 1) {
  const bridgeRow = row - 15;
  charts.getRange(`N${row}:P${row}`).formulas = [[
    `='_REFLO_BRIDGE'!E${bridgeRow}`,
    `='_REFLO_BRIDGE'!F${bridgeRow}`,
    `='_REFLO_BRIDGE'!G${bridgeRow}`,
  ]];
}
charts.getRange("N54:P86").format.font = { color: COLORS.formulaGreen, size: 8 };
charts.getRange("O55:P86").format.numberFormat = "#,##0.0";

if (chartLimit >= 1) {
  const chart1 = charts.charts.add("line", charts.getRange("A41:C69"));
  chart1.title = "도표 7 · 분기 영업이익 vs 시가총액";
  chart1.titleTextStyle.fontSize = 12;
  chart1.hasLegend = true;
  chart1.xAxis = { axisType: "textAxis", textStyle: { fontSize: 8 } };
  chart1.yAxis = { numberFormatCode: "#,##0" };
  chart1.setPosition("A5", "H20");
}

if (chartLimit >= 2) {
  const chart2 = charts.charts.add("line", charts.getRange("E41:L61"));
  chart2.title = "도표 8 · 애플리케이션별 매출 비중";
  chart2.titleTextStyle.fontSize = 12;
  chart2.hasLegend = true;
  chart2.xAxis = { axisType: "textAxis", textStyle: { fontSize: 8 } };
  chart2.yAxis = { numberFormatCode: "0%" };
  chart2.setPosition("J5", "Q20");
}

if (chartLimit >= 3) {
  const chart3 = charts.charts.add("line", charts.getRange("N41:P50"));
  chart3.title = "도표 9 · 연간 매출액 및 OPM";
  chart3.titleTextStyle.fontSize = 12;
  chart3.hasLegend = true;
  chart3.xAxis = { axisType: "textAxis", textStyle: { fontSize: 8 } };
  chart3.yAxis = { numberFormatCode: "#,##0" };
  chart3.setPosition("A22", "H37");
}

if (chartLimit >= 4) {
  const chart4 = charts.charts.add("line", charts.getRange("N54:P86"));
  chart4.title = "도표 10 · 제품별 매출";
  chart4.titleTextStyle.fontSize = 12;
  chart4.hasLegend = true;
  chart4.xAxis = { axisType: "textAxis", textStyle: { fontSize: 8 } };
  chart4.yAxis = { numberFormatCode: "#,##0" };
  chart4.setPosition("J22", "Q37");
}

charts.getRange("A40:Q86").format.fill = "#FAFBF9";
charts.getRange("A40:Q86").format.font.size = 8;
charts.getRange("A:A").format.columnWidth = 11;
charts.getRange("B:Q").format.columnWidth = 11;
charts.freezePanes.freezeRows(3);

// Checks
styleTitle(checks, "A1:G2", "04 · DATA INTEGRITY CHECKS");
checks.getRange("A3:G3").merge();
checks.getRange("A3").values = [["차트 생성 전 category와 series의 크기·단위·합계를 확인하는 최소 검증 예시입니다."]];
checks.getRange("A3:G3").format = { font: { size: 9, color: COLORS.muted }, wrapText: true };
checks.getRange("A5:G11").values = [
  ["check_id","검증 항목","Actual","Expected","Difference","Status","조치"],
  ["CHK-01","도표 7 category vs 영업이익 길이",null,null,null,null,"빈 기간 또는 값 확인"],
  ["CHK-02","도표 7 category vs 시가총액 길이",null,null,null,null,"빈 기간 또는 값 확인"],
  ["CHK-03","도표 8 첫 분기 비중 합계",null,1,null,null,"합계가 100%인지 확인"],
  ["CHK-04","도표 8 category vs 데이터센터 길이",null,null,null,null,"빈 기간 또는 값 확인"],
  ["CHK-05","도표 9 category vs 매출액 길이",null,null,null,null,"빈 연도 또는 값 확인"],
  ["CHK-06","도표 10 category vs Socket 길이",null,null,null,null,"빈 기간 또는 값 확인"],
];
checks.getRange("C6").formulas = [["=COUNTA('_REFLO_BRIDGE'!A7:A34)"]];
checks.getRange("D6").formulas = [["=COUNT('_REFLO_BRIDGE'!B7:B34)"]];
checks.getRange("E6").formulas = [["=C6-D6"]];
checks.getRange("F6").formulas = [['=IF(E6=0,"OK","CHECK")']];
checks.getRange("C7").formulas = [["=COUNTA('_REFLO_BRIDGE'!A7:A34)"]];
checks.getRange("D7").formulas = [["=COUNT('_REFLO_BRIDGE'!C7:C34)"]];
checks.getRange("E7").formulas = [["=C7-D7"]];
checks.getRange("F7").formulas = [['=IF(E7=0,"OK","CHECK")']];
checks.getRange("C8").formulas = [["=SUM('_REFLO_BRIDGE'!F7:L7)"]];
checks.getRange("E8").formulas = [["=C8-D8"]];
checks.getRange("F8").formulas = [['=IF(ABS(E8)<0.0001,"OK","CHECK")']];
checks.getRange("C9").formulas = [["=COUNTA('_REFLO_BRIDGE'!E7:E26)"]];
checks.getRange("D9").formulas = [["=COUNT('_REFLO_BRIDGE'!F7:F26)"]];
checks.getRange("E9").formulas = [["=C9-D9"]];
checks.getRange("F9").formulas = [['=IF(E9=0,"OK","CHECK")']];
checks.getRange("C10").formulas = [["=COUNTA('_REFLO_BRIDGE'!A40:A48)"]];
checks.getRange("D10").formulas = [["=COUNT('_REFLO_BRIDGE'!B40:B48)"]];
checks.getRange("E10").formulas = [["=C10-D10"]];
checks.getRange("F10").formulas = [['=IF(E10=0,"OK","CHECK")']];
checks.getRange("C11").formulas = [["=COUNTA('_REFLO_BRIDGE'!E40:E71)"]];
checks.getRange("D11").formulas = [["=COUNT('_REFLO_BRIDGE'!F40:F71)"]];
checks.getRange("E11").formulas = [["=C11-D11"]];
checks.getRange("F11").formulas = [['=IF(E11=0,"OK","CHECK")']];
styleHeader(checks.getRange("A5:G5"));
styleBody(checks.getRange("A6:G11"));
checks.getRange("C6:F11").format.font = { color: COLORS.ink };
checks.getRange("C8:E8").format.numberFormat = "0.0%";
checks.getRange("F6:F11").conditionalFormats.add("containsText", {
  text: "OK",
  format: { fill: COLORS.ok, font: { bold: true, color: "#2F6B2F" } },
});
checks.getRange("F6:F11").conditionalFormats.add("containsText", {
  text: "CHECK",
  format: { fill: COLORS.fail, font: { bold: true, color: "#9C0006" } },
});
styleSection(checks, "A14:G14", "전체 상태");
checks.getRange("A15:B16").values = [["Model status", null],["검증 기준", "모든 Status가 OK"]];
checks.getRange("C15:G15").merge();
checks.getRange("C15").formulas = [['=IF(COUNTIF(F6:F11,"OK")=6,"OK","CHECK")']];
checks.getRange("C16:G16").merge();
checks.getRange("C16").values = [["예시 파일은 구조 검증용이며 실제 source/evidence 검증은 별도로 필요합니다."]];
checks.getRange("A15:B16").format = { fill: COLORS.band, font: { bold: true, color: COLORS.ink } };
checks.getRange("C15:G16").format = { borders: { preset: "outside", style: "thin", color: COLORS.line }, wrapText: true };
checks.getRange("C15").format = { fill: COLORS.ok, font: { size: 14, bold: true, color: "#2F6B2F" }, horizontalAlignment: "center", verticalAlignment: "center" };
checks.getRange("A:A").format.columnWidth = 13;
checks.getRange("B:B").format.columnWidth = 38;
checks.getRange("C:F").format.columnWidth = 15;
checks.getRange("G:G").format.columnWidth = 28;
checks.getRange("A5:G16").format.wrapText = true;
checks.freezePanes.freezeRows(5);

await fs.mkdir(previewDir, { recursive: true });

const sheetNames = ["README", "01_RAW_INPUT", "_REFLO_BRIDGE", "02_CHART_MAPPING", "03_CHARTS", "04_CHECKS"];
for (const sheetName of sheetNames) {
  const preview = await workbook.render({
    sheetName,
    autoCrop: "all",
    scale: sheetName === "03_CHARTS" ? 1.2 : 1,
    format: "png",
  });
  const safeName = sheetName.replaceAll("/", "_");
  await fs.writeFile(`${previewDir}/${safeName}.png`, new Uint8Array(await preview.arrayBuffer()));
}

const inspection = await workbook.inspect({
  kind: "workbook,sheet,table,drawing",
  maxChars: 8000,
  tableMaxRows: 4,
  tableMaxCols: 10,
  tableMaxCellChars: 80,
});
console.log(inspection.ndjson);

const checkInspection = await workbook.inspect({
  kind: "table",
  range: "04_CHECKS!A5:G16",
  include: "values,formulas",
  tableMaxRows: 20,
  tableMaxCols: 8,
  maxChars: 6000,
});
console.log(checkInspection.ndjson);

const errors = await workbook.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
  options: { useRegex: true, maxResults: 300 },
  summary: "final formula error scan",
});
console.log(errors.ndjson);

await fs.mkdir(outputDir, { recursive: true });
if (process.env.REFLO_EXPORT_DIAG === "noCharts") {
  charts.charts.deleteAll();
}
if (process.env.REFLO_EXPORT_DIAG === "noConditionalFormats") {
  checks.getRange("F6:F11").conditionalFormats.deleteAll();
}
try {
  const exported = await SpreadsheetFile.exportXlsx(workbook);
  await exported.save(outputPath);
  const reopened = await SpreadsheetFile.importXlsx(await FileBlob.load(outputPath));
  const reopenedInspection = await reopened.inspect({
    kind: "workbook,sheet,table,drawing",
    maxChars: 5000,
    tableMaxRows: 2,
    tableMaxCols: 6,
  });
  console.log(reopenedInspection.ndjson);
  const reopenedErrors = await reopened.inspect({
    kind: "match",
    searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
    options: { useRegex: true, maxResults: 300 },
    summary: "reopened workbook formula error scan",
  });
  console.log(reopenedErrors.ndjson);
  const reopenedPreview = await reopened.render({
    sheetName: "03_CHARTS",
    autoCrop: "all",
    scale: 1.2,
    format: "png",
  });
  await fs.writeFile(
    `${previewDir}/03_CHARTS_exported.png`,
    new Uint8Array(await reopenedPreview.arrayBuffer()),
  );
  console.log(`OUTPUT=${outputPath}`);
} catch (error) {
  console.error("EXPORT_ERROR", error?.stack || error);
  process.exitCode = 1;
}
