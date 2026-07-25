import fs from "node:fs/promises";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const inputPath = "D:/Reflo_fin/fixtures/ISC_095340_Peer_PER_Valuation_v4.xlsx";
const outputDir = "D:/Reflo_fin/tmp/spreadsheets/isc_audit_019f97c0/renders";

const input = await FileBlob.load(inputPath);
const workbook = await SpreadsheetFile.importXlsx(input);
await fs.mkdir(outputDir, { recursive: true });

const periodMatches = await workbook.inspect({
  kind: "match",
  searchTerm: "삼성증권 1Q26 Review|삼성증권 2026-04-28|목표주가 300,000|300000|53.35|88.92",
  options: { useRegex: true, maxResults: 120 },
  maxChars: 16000,
  summary: "target-report-derived inputs",
});
console.log("=== TARGET REPORT MATCHES ===");
console.log(periodMatches.ndjson);

const ranges = [
  ["00_요약", "A3:H18"],
  ["01_실적추이", "A3:L26"],
  ["02_추정변경", "A3:K10"],
  ["03_목표주가", "A3:F20"],
  ["07_출처검증", "A3:G31"],
  ["08_Forward_EPS", "A3:H12"],
  ["08_Forward_EPS", "A38:H45"],
  ["09_Target_PER", "A3:I22"],
  ["09_Target_PER", "A36:I41"],
];
console.log("=== TARGET RANGES ===");
for (const [sheetId, range] of ranges) {
  const result = await workbook.inspect({
    kind: "table",
    sheetId,
    range,
    include: "values,formulas",
    tableMaxRows: 50,
    tableMaxCols: 12,
    tableMaxCellChars: 120,
    maxChars: 12000,
  });
  console.log(`--- ${sheetId}!${range} ---`);
  console.log(result.ndjson);
}

const formulaErrors = await workbook.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!",
  options: { useRegex: true, maxResults: 500 },
  maxChars: 12000,
  summary: "formula error scan",
});
console.log("=== FORMULA ERRORS ===");
console.log(formulaErrors.ndjson);

const preview = await workbook.render({
  sheetName: "00_요약",
  autoCrop: "all",
  scale: 0.8,
  format: "png",
});
const renderPath = `${outputDir}/00_요약.png`;
await fs.writeFile(renderPath, new Uint8Array(await preview.arrayBuffer()));
console.log(`=== RENDER ===\n${renderPath}`);
