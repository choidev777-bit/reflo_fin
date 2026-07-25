import fs from "node:fs/promises";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const originalPath =
  "D:/Reflo_fin/fixtures/ISC_095340_Peer_PER_Valuation_v4.xlsx";
const outputDir =
  "D:/Reflo_fin/outputs/019f97c0-6185-79e0-8d02-6d223531ba86";
const outputPath = `${outputDir}/ISC_095340_1Q26_PreReview_Template.xlsx`;
const previewDir = `${outputDir}/preview`;

const sheets = {
  summary: "\u0030\u0030_\uc694\uc57d",
  trend: "\u0030\u0031_\uc2e4\uc801\ucd94\uc774",
  revisions: "\u0030\u0032_\ucd94\uc815\ubcc0\uacbd",
  target: "\u0030\u0033_\ubaa9\ud45c\uc8fc\uac00",
  peerResults: "\u0030\u0034_\ud53c\uc5b4\uc2e4\uc801",
  peerValuation: "\u0030\u0035_\ud53c\uc5b4\ubc38\ub958",
  financials: "\u0030\u0036_\uc7ac\ubb34\uc694\uc57d",
  sources: "\u0030\u0037_\ucd9c\ucc98\uac80\uc99d",
};

const sheetRanges = [
  ["Forward EPS", "A1:L29"],
  ["Target PER", "A1:I29"],
  [sheets.summary, "A1:H24"],
  [sheets.trend, "A1:L29"],
  [sheets.revisions, "A1:K10"],
  [sheets.target, "A1:F20"],
  [sheets.peerResults, "A1:I11"],
  [sheets.financials, "A1:M45"],
  [sheets.peerValuation, "A1:J15"],
  [sheets.sources, "A1:G31"],
  ["08_Forward_EPS", "A1:H45"],
  ["08-01", "A1:H27"],
  ["09_Target_PER", "A1:I40"],
];

async function applyPhase(phase) {
  const inputPath = phase === 1 ? originalPath : outputPath;
  const patchPath = `D:/Reflo_fin/tmp/codex_xlsx_audit/patch-${phase}.json`;
  const patch = JSON.parse(await fs.readFile(patchPath, "utf8"));
  const input = await FileBlob.load(inputPath);
  const workbook = await SpreadsheetFile.importXlsx(input);

  for (const item of patch.clear || []) {
    workbook.worksheets
      .getItem(item.sheet)
      .getRange(item.range)
      .clear({ applyTo: "contents" });
  }
  for (const item of patch.values || []) {
    workbook.worksheets.getItem(item.sheet).getRange(item.range).values =
      item.data;
  }
  for (const item of patch.formulas || []) {
    workbook.worksheets.getItem(item.sheet).getRange(item.range).formulas =
      item.data;
  }

  await fs.mkdir(outputDir, { recursive: true });
  const output = await SpreadsheetFile.exportXlsx(workbook);
  await output.save(outputPath);
  console.log(`PHASE ${phase} OK`);
}

async function verify() {
  const input = await FileBlob.load(outputPath);
  const workbook = await SpreadsheetFile.importXlsx(input);
  for (const [sheetId, range] of [
    [sheets.trend, "F5:F27"],
    [sheets.summary, "A1:H18"],
    [sheets.sources, "A18:G24"],
    ["08_Forward_EPS", "B6:E9"],
    ["09_Target_PER", "A6:F17"],
  ]) {
    const result = await workbook.inspect({
      kind: "table",
      sheetId,
      range,
      include: "values,formulas",
      tableMaxRows: 30,
      tableMaxCols: 10,
      maxChars: 12000,
    });
    console.log(`=== ${sheetId}!${range} ===`);
    console.log(result.ndjson);
  }
  for (const [label, searchTerm] of [
    ["FORMULA_ERRORS", "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!"],
    [
      "LEAKAGE",
      "\uc0bc\uc131\uc99d\uad8c 1Q26 Review|88\\.920505|53\\.352303|1Q26 \ub9e4\ucd9c 683|\uc601\uc5c5\uc774\uc775 236",
    ],
  ]) {
    const result = await workbook.inspect({
      kind: "match",
      searchTerm,
      options: { useRegex: true, maxResults: 300 },
      summary: label,
      maxChars: 12000,
    });
    console.log(`=== ${label} ===`);
    console.log(result.ndjson);
  }
}

async function renderOne(index) {
  const [sheetName, range] = sheetRanges[index];
  const input = await FileBlob.load(outputPath);
  const workbook = await SpreadsheetFile.importXlsx(input);
  await fs.mkdir(previewDir, { recursive: true });
  const preview = await workbook.render({
    sheetName,
    range,
    scale: 1,
    format: "png",
  });
  const previewPath = `${previewDir}/${String(index).padStart(2, "0")}.png`;
  await fs.writeFile(
    previewPath,
    new Uint8Array(await preview.arrayBuffer()),
  );
  console.log(previewPath);
}

const mode = process.argv[2];
if (mode === "phase") {
  await applyPhase(Number(process.argv[3]));
} else if (mode === "verify") {
  await verify();
} else if (mode === "render") {
  await renderOne(Number(process.argv[3]));
} else {
  throw new Error(`Unknown mode: ${mode}`);
}
