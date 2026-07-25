import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const workbookPath =
  "D:\\Reflo_fin\\fixtures\\ISC_095340_Peer_PER_Valuation_v4.xlsx";
const input = await FileBlob.load(workbookPath);
const workbook = await SpreadsheetFile.importXlsx(input);

const sheets = await workbook.inspect({
  kind: "sheet",
  include: "id,name",
  maxChars: 12000,
});
console.log("---SHEETS---");
console.log(sheets.ndjson);

for (const [sheetId, range] of [
  ["06_재무요약", "A1:M45"],
  ["07_출처검증", "A1:G31"],
  ["01_실적추이", "A1:L29"],
]) {
  const table = await workbook.inspect({
    kind: "table",
    sheetId,
    range,
    include: "values,formulas",
    tableMaxRows: 60,
    tableMaxCols: 16,
    tableMaxCellChars: 200,
    maxChars: 50000,
  });
  console.log(`---TABLE ${sheetId}!${range}---`);
  console.log(table.ndjson);
}

process.exit(0);

for (const searchTerm of [
  "연결|별도|CFS|OFS|연결재무|별도재무",
  "매출액|영업이익|당기순이익|자산|부채|자본",
  "DART|전자공시|사업보고서|분기보고서|반기보고서",
]) {
  const matches = await workbook.inspect({
    kind: "match",
    searchTerm,
    options: { useRegex: true, maxResults: 200 },
    summary: `scope review: ${searchTerm}`,
    maxChars: 30000,
  });
  console.log(`---MATCH ${searchTerm}---`);
  console.log(matches.ndjson);
}

const formulas = await workbook.inspect({
  kind: "formula",
  options: { maxResults: 300 },
  maxChars: 30000,
});
console.log("---FORMULAS---");
console.log(formulas.ndjson);

for (const [sheetId, range] of [
  ["06_재무요약", "A1:M45"],
  ["07_출처검증", "A1:G31"],
  ["01_실적추이", "A1:L29"],
]) {
  const table = await workbook.inspect({
    kind: "table",
    sheetId,
    range,
    include: "values,formulas",
    tableMaxRows: 60,
    tableMaxCols: 16,
    tableMaxCellChars: 200,
    maxChars: 50000,
  });
  console.log(`---TABLE ${sheetId}!${range}---`);
  console.log(table.ndjson);
}
