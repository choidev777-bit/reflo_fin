import assert from "node:assert/strict";
import test from "node:test";
import type { OutlineContent } from "../server/domain/report";
import { suggestReportDraft } from "../server/infrastructure/agents/report-draft-agent";

const outline: OutlineContent = {
  schemaVersion: "2.0",
  generationSource: "fallback",
  pages: [
    {
      pageId: "page-1",
      pageNumber: 1,
      pageLabel: "01",
      role: "summary",
      editable: true,
      widthPt: 595,
      heightPt: 842,
      rotation: 0,
      recommendedTitle: null,
      narrativeBlocks: [
        {
          blockId: "block-1",
          order: 1,
          subtitle: "실적",
          summary: "기존 요약 1",
          sourceHeading: "실적",
          sourceText: "검증된 원문 1",
          maxLength: 220,
          evidenceIds: ["evidence-1"],
          subtitleBbox: null,
          bodyBbox: null,
          subtitleObjectIds: [],
          bodyObjectIds: [],
        },
        {
          blockId: "block-2",
          order: 2,
          subtitle: "전망",
          summary: "기존 요약 2",
          sourceHeading: "전망",
          sourceText: "검증된 원문 2",
          maxLength: 220,
          evidenceIds: ["evidence-2"],
          subtitleBbox: null,
          bodyBbox: null,
          subtitleObjectIds: [],
          bodyObjectIds: [],
        },
      ],
      visualSlots: [],
      evidenceIds: ["evidence-1", "evidence-2"],
    },
  ],
};

const baseInput = {
  outline,
  companyName: "리플로",
  ticker: "000001",
  targetYear: 2026,
  targetQuarter: 2,
  rating: "BUY",
  thesis: "검증된 투자 가설",
  targetPer: "12.0",
  targetPrice: "12000",
  currentPrice: "10000",
  evidence: [
    {
      evidenceId: "evidence-1",
      title: "실적 근거",
      oneLineValue: "실적",
      quoteExact: "실적 원문",
      stance: "support",
      machineStatus: "passed",
    },
    {
      evidenceId: "evidence-2",
      title: "전망 근거",
      oneLineValue: "전망",
      quoteExact: "전망 원문",
      stance: "support",
      machineStatus: "passed",
    },
  ],
};

async function withDraftResponse(
  blocks: Array<{
    blockId: string;
    text: string;
    evidenceIds: string[];
  }>,
) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ blocks }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  try {
    return await suggestReportDraft(baseInput);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("draft text falls back when Evidence is empty or belongs to another block", async () => {
  for (const firstEvidenceIds of [[], ["evidence-2"]]) {
    const result = await withDraftResponse([
      {
        blockId: "block-1",
        text: "근거 없이 부풀린 신규 문장",
        evidenceIds: firstEvidenceIds,
      },
      {
        blockId: "block-2",
        text: "근거가 있는 신규 문장",
        evidenceIds: ["evidence-2"],
      },
    ]);
    assert.deepEqual(result, {
      "block-1": "검증된 원문 1",
      "block-2": "검증된 원문 2",
    });
  }
});

test("draft text accepts only block-scoped passed Evidence", async () => {
  const result = await withDraftResponse([
    {
      blockId: "block-1",
      text: "근거가 있는 실적 문장",
      evidenceIds: ["evidence-1"],
    },
    {
      blockId: "block-2",
      text: "근거가 있는 전망 문장",
      evidenceIds: ["evidence-2"],
    },
  ]);
  assert.deepEqual(result, {
    "block-1": "근거가 있는 실적 문장",
    "block-2": "근거가 있는 전망 문장",
  });
});
