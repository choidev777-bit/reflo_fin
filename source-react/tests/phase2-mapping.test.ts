import assert from "node:assert/strict";
import test from "node:test";
import { buildMappingSet } from "../workers/control/mapping";
import type {
  TemplateIr,
  WorkbookAnalysis,
  WorkbookCandidateCell,
} from "../workers/control/types";

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
  assert.deepEqual(
    result.mappingSet.bindings.map((binding) => binding.source.address),
    ["B15", "F6"],
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
