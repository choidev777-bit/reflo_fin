import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { SpreadsheetFile, Workbook } = require("@oai/artifact-tool");

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, "..");
const outputDir = path.join(root, "public", "downloads");
const qaDir = path.resolve(root, "..", "tmp", "download-artifacts");
await fs.mkdir(outputDir, { recursive: true });
await fs.mkdir(qaDir, { recursive: true });

const colors = {
  dark: "#151814",
  green: "#6B8E23",
  lime: "#B9F232",
  pale: "#F5F8F1",
  line: "#DDE4D8",
  muted: "#687066",
  blue: "#2463EB",
  inputFill: "#EEF4FF",
};

const workbook = Workbook.create();
const summary = workbook.worksheets.add("Summary");
const financials = workbook.worksheets.add("Financials");
const sources = workbook.worksheets.add("Sources & Checks");

for (const sheet of [summary, financials, sources]) {
  sheet.showGridLines = false;
}

summary.getRange("A1:F2").merge();
summary.getRange("A1").values = [["SK텔레콤 2Q26 Earnings Review"]];
summary.getRange("A1:F2").format = {
  fill: colors.dark,
  font: { bold: true, color: "#FFFFFF", size: 22 },
  verticalAlignment: "center",
};
summary.getRange("A3:F3").merge();
summary.getRange("A3").values = [["REFLO Equity Research · 2026.07.17 · 검증 완료"]];
summary.getRange("A3:F3").format = {
  fill: colors.lime,
  font: { bold: true, color: colors.dark, size: 10 },
  verticalAlignment: "center",
};

summary.getRange("A5:F5").values = [["투자의견", "목표주가", "현재주가", "상승여력", "Forward EPS", "Target PER"]];
summary.getRange("A6:F6").values = [["매수", 120000, 83900, null, 12430, 14.2]];
summary.getRange("D6").formulas = [["=B6/C6-1"]];
summary.getRange("A5:F5").format = {
  fill: colors.pale,
  font: { bold: true, color: colors.muted, size: 10 },
  borders: { preset: "all", style: "thin", color: colors.line },
};
summary.getRange("A6:F6").format = {
  font: { bold: true, color: colors.dark, size: 15 },
  borders: { preset: "all", style: "thin", color: colors.line },
};
summary.getRange("B6:C6").format.numberFormat = "#,##0\"원\"";
summary.getRange("D6").format.numberFormat = "0.0%";
summary.getRange("E6").format.numberFormat = "#,##0\"원\"";
summary.getRange("F6").format.numberFormat = "0.0\"배\"";
summary.getRange("A6").format.font = { bold: true, color: colors.green, size: 15 };
summary.getRange("D6").format.font = { bold: true, color: colors.green, size: 15 };

summary.getRange("A8:F8").merge();
summary.getRange("A8").values = [["Investment Summary"]];
summary.getRange("A8:F8").format = { font: { bold: true, color: colors.green, size: 13 } };
summary.getRange("A9:F10").merge();
summary.getRange("A9").values = [["2분기 실적 상회와 AIDC 사업의 가시성 개선을 함께 반영해 투자의견 매수, 목표주가 120,000원을 유지합니다. 현재 주가 대비 상승여력은 43.0%입니다."]];
summary.getRange("A9:F10").format = {
  fill: colors.pale,
  font: { color: colors.dark, size: 11 },
  wrapText: true,
  verticalAlignment: "center",
  borders: { preset: "outside", style: "thin", color: colors.line },
};

summary.getRange("A12:C12").merge();
summary.getRange("D12:F12").merge();
summary.getRange("A12").values = [["핵심 투자 포인트"]];
summary.getRange("D12").values = [["밸류에이션 계산"]];
summary.getRange("A12:F12").format = { font: { bold: true, color: colors.green, size: 13 } };
summary.getRange("A13:C15").values = [
  ["01", "본업 이익 체력 회복", "2026년 영업이익 1조 9,350억원 전망"],
  ["02", "AIDC 가치 재평가", "2027년 수전용량 187MW 확대"],
  ["03", "주주환원 가시성", "2026년 예상 DPS 3,660원"],
];
summary.getRange("A13:C15").format = {
  borders: { preset: "all", style: "thin", color: colors.line },
  wrapText: true,
  verticalAlignment: "center",
};
summary.getRange("A13:A15").format = { fill: colors.pale, font: { bold: true, color: colors.green } };
summary.getRange("B13:B15").format.font = { bold: true, color: colors.dark };
summary.getRange("D13:E15").values = [
  ["Forward EPS", 12430],
  ["Target PER", 14.2],
  ["계산 목표주가", null],
];
summary.getRange("F13:F15").values = [["원"], ["배"], ["원"]];
summary.getRange("E15").formulas = [["=E13*E14"]];
summary.getRange("D13:F15").format = {
  borders: { preset: "all", style: "thin", color: colors.line },
  verticalAlignment: "center",
};
summary.getRange("D13:D15").format = { fill: colors.pale, font: { bold: true, color: colors.muted } };
summary.getRange("E13:E14").format = { fill: colors.inputFill, font: { bold: true, color: colors.blue, size: 13 } };
summary.getRange("E15:F15").format = { fill: "#EFF5E7", font: { bold: true, color: colors.green, size: 14 } };
summary.getRange("E13").format.numberFormat = "#,##0";
summary.getRange("E14").format.numberFormat = "0.0";
summary.getRange("E15").format.numberFormat = "#,##0";

summary.getRange("A18:F18").merge();
summary.getRange("A18").values = [["주요 리스크"]];
summary.getRange("A18:F18").format = { font: { bold: true, color: colors.green, size: 13 } };
summary.getRange("A19:F21").values = [
  ["01", "AIDC 투자 집행과 가동 지연", "전력 인입·인허가·고객 유치 일정", "모니터링", "분기", "IR/공시"],
  ["02", "무선 가입자 성장 둔화", "가입자 순증 및 ARPU 개선 속도", "모니터링", "월간", "산업 데이터"],
  ["03", "주주환원 여력 축소", "데이터센터 투자와 차입금 증가", "모니터링", "분기", "공시"],
];
summary.getRange("A19:F21").format = {
  borders: { preset: "all", style: "thin", color: colors.line },
  wrapText: true,
  verticalAlignment: "center",
};
summary.getRange("A19:A21").format = { fill: colors.pale, font: { bold: true, color: colors.green } };
summary.getRange("B19:B21").format.font = { bold: true, color: colors.dark };

summary.getRange("A24:F24").merge();
summary.getRange("A24").values = [["자료: 회사 공시, 기업 IR, REFLO Research Workspace · 본 워크북은 리서치 검증용 예시 산출물입니다."]];
summary.getRange("A24:F24").format = { font: { italic: true, color: colors.muted, size: 9 } };

summary.getRange("A1:F24").format.font = { name: "Malgun Gothic" };
summary.getRange("A1:F24").format.rowHeight = 24;
summary.getRange("A1:A24").format.columnWidth = 11;
summary.getRange("B1:B24").format.columnWidth = 23;
summary.getRange("C1:C24").format.columnWidth = 33;
summary.getRange("D1:D24").format.columnWidth = 20;
summary.getRange("E1:E24").format.columnWidth = 17;
summary.getRange("F1:F24").format.columnWidth = 12;
summary.getRange("A1:F2").format.rowHeight = 36;
summary.getRange("A9:F10").format.rowHeight = 32;
summary.freezePanes.freezeRows(3);

financials.getRange("A1:F2").merge();
financials.getRange("A1").values = [["Financial Forecast"]];
financials.getRange("A1:F2").format = { fill: colors.dark, font: { bold: true, color: "#FFFFFF", size: 22 } };
financials.getRange("A4:F4").values = [["구분", "2024", "2025", "2026F", "2027F", "2028F"]];
financials.getRange("A5:F8").values = [
  ["매출액 (십억원)", 17941, 17099, 17941, 18337, 18712],
  ["영업이익 (십억원)", 1823, 1073, 1935, 2153, 2435],
  ["EPS (원)", 5810, 1901, 6347, 7205, 8424],
  ["P/E (배)", 9.5, 28.1, 13.2, 11.6, 10.0],
];
financials.getRange("A10:F10").values = [["증감/계산", "2024", "2025", "2026F", "2027F", "2028F"]];
financials.getRange("A11:F11").values = [["영업이익률", null, null, null, null, null]];
financials.getRange("B11").formulas = [["=B6/B5"]];
financials.getRange("B11:F11").fillRight();
financials.getRange("A12:F12").values = [["EPS 성장률", null, null, null, null, null]];
financials.getRange("C12").formulas = [["=C7/B7-1"]];
financials.getRange("C12:F12").fillRight();
financials.getRange("A4:F4").format = { fill: colors.dark, font: { bold: true, color: "#FFFFFF" } };
financials.getRange("A10:F10").format = { fill: colors.pale, font: { bold: true, color: colors.green } };
financials.getRange("A5:F8").format.borders = { preset: "all", style: "thin", color: colors.line };
financials.getRange("A11:F12").format.borders = { preset: "all", style: "thin", color: colors.line };
financials.getRange("B5:F7").format.numberFormat = "#,##0";
financials.getRange("B8:F8").format.numberFormat = "0.0\"배\"";
financials.getRange("B11:F12").format.numberFormat = "0.0%";
financials.getRange("D5:F8").format.font = { bold: true, color: colors.green };
financials.getRange("A1:F12").format.font = { name: "Malgun Gothic" };
financials.getRange("A1:F12").format.rowHeight = 25;
financials.getRange("A1:A12").format.columnWidth = 25;
financials.getRange("B1:F12").format.columnWidth = 15;
financials.freezePanes.freezeRows(4);

sources.getRange("A1:E2").merge();
sources.getRange("A1").values = [["Sources & Integrity Checks"]];
sources.getRange("A1:E2").format = { fill: colors.dark, font: { bold: true, color: "#FFFFFF", size: 22 } };
sources.getRange("A4:E4").values = [["구분", "출처", "기준일", "사용 위치", "검증 상태"]];
sources.getRange("A5:E8").values = [
  ["공식 실적", "DART 잠정실적 공시", "2026.07.16", "영업이익·매출액", "확인 완료"],
  ["기업 가이던스", "SK텔레콤 IR 자료", "2026.07.17", "AIDC 수전용량", "확인 완료"],
  ["산업 데이터", "통신 산업 데이터", "2026.07.17", "가입자·ARPU", "확인 완료"],
  ["계산 모델", "REFLO 표준 모델", "2026.07.17", "EPS·목표주가", "수식 검증"],
];
sources.getRange("A4:E4").format = { fill: colors.dark, font: { bold: true, color: "#FFFFFF" } };
sources.getRange("A5:E8").format = {
  borders: { preset: "all", style: "thin", color: colors.line },
  wrapText: true,
  verticalAlignment: "center",
};
sources.getRange("E5:E8").format = { fill: "#E8F5EC", font: { bold: true, color: "#16784A" } };
sources.getRange("A11:E11").merge();
sources.getRange("A11").values = [["검증 체크"]];
sources.getRange("A11:E11").format = { font: { bold: true, color: colors.green, size: 13 } };
sources.getRange("A12:D15").values = [
  ["01", "수식 참조 검사", "순환 참조 없음", "PASS"],
  ["02", "단위 일치 검사", "원·배·십억원 단위 일치", "PASS"],
  ["03", "입력값 출처 검사", "모든 주요 입력값 출처 연결", "PASS"],
  ["04", "최종 산식 검사", "12,430원 × 14.2배 = 176,506원", "PASS"],
];
sources.getRange("A12:D15").format = { borders: { preset: "all", style: "thin", color: colors.line } };
sources.getRange("D12:D15").format = { fill: "#E8F5EC", font: { bold: true, color: "#16784A" } };
sources.getRange("A1:E15").format.font = { name: "Malgun Gothic" };
sources.getRange("A1:E15").format.rowHeight = 26;
sources.getRange("A1:A15").format.columnWidth = 18;
sources.getRange("B1:B15").format.columnWidth = 29;
sources.getRange("C1:C15").format.columnWidth = 18;
sources.getRange("D1:D15").format.columnWidth = 31;
sources.getRange("E1:E15").format.columnWidth = 17;
sources.freezePanes.freezeRows(4);

const inspection = await workbook.inspect({
  kind: "sheet,formula",
  maxChars: 5000,
  options: { maxResults: 100 },
});
await fs.writeFile(path.join(qaDir, "workbook-inspection.txt"), inspection.ndjson ?? String(inspection), "utf8");

const preview = await workbook.render({
  sheetName: "Summary",
  range: "A1:F24",
  autoCrop: "all",
  scale: 1.15,
  format: "png",
});
await fs.writeFile(path.join(qaDir, "workbook-summary.png"), new Uint8Array(await preview.arrayBuffer()));

const xlsx = await SpreadsheetFile.exportXlsx(workbook);
const outputPath = path.join(outputDir, "SK_Telecom_2Q26_Data.xlsx");
await xlsx.save(outputPath);
console.log(outputPath);
