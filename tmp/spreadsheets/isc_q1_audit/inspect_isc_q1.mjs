import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const inputPath = "D:/Reflo_fin/fixtures/ISC_095340_Peer_PER_Valuation_v4.xlsx";
const input = await FileBlob.load(inputPath);
const workbook = await SpreadsheetFile.importXlsx(input);

const summary = await workbook.inspect({
  kind: "workbook,sheet,table,definedName,drawing",
  maxChars: 14000,
  tableMaxRows: 8,
  tableMaxCols: 14,
  tableMaxCellChars: 100,
});
console.log("=== SUMMARY ===");
console.log(summary.ndjson);

const periodMatches = await workbook.inspect({
  kind: "match",
  searchTerm:
    "2Q26|2Q 26|2Q'26|2Q 2026|2026.*2Q|2026년\\s*2분기|1Q26|1Q 26|1Q'26|1Q 2026|2026.*1Q|2026년\\s*1분기|2026E|2026\\.04|2026\\.07",
  options: { useRegex: true, maxResults: 500 },
  summary: "period-specific labels and values",
  maxChars: 30000,
});
console.log("=== PERIOD MATCHES ===");
console.log(periodMatches.ndjson);

const formulaMatches = await workbook.inspect({
  kind: "formula",
  options: { maxResults: 500 },
  maxChars: 30000,
});
console.log("=== FORMULAS ===");
console.log(formulaMatches.ndjson);
