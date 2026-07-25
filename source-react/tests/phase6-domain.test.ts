import assert from "node:assert/strict";
import test from "node:test";
import {
  applyReportOperations,
  buildInitialOutline,
  buildReportDocument,
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

test("Phase 06 outline preserves the exact Template IR page structure", () => {
  const outline = buildInitialOutline(templatePages, seed);

  assert.equal(outline.pages.length, 5);
  assert.deepEqual(
    outline.pages.map((page) => page.pageId),
    templatePages.map((page) => page.pageId),
  );
  assert.equal(outline.pages[0].editable, true);
  assert.equal(outline.pages[1].editable, false);
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

test("Phase 06 report edits only editable blocks and tracks revisions", () => {
  const outline = buildInitialOutline(templatePages, seed);
  const report = buildReportDocument({
    outline,
    rating: seed.rating,
    targetPer: seed.targetPer,
    targetPrice: seed.targetPrice,
    currentPrice: seed.currentPrice,
    forwardEps: "5000",
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
