import type { OutlineContent } from "../../domain/report";

type EvidenceInput = {
  evidenceId: string;
  title: string;
  oneLineValue: string;
  quoteExact: string;
  stance: string;
  machineStatus: string;
  metricId: string;
  sourceType: string;
  period: string | null;
  scope: string | null;
  claimType: "fact" | "company_statement" | "calculation";
  allowedUsage:
    | "assertive"
    | "attribute_to_company"
    | "state_as_calculation";
};

type DraftSuggestion = {
  generationSource?: "ai" | "fixture";
  blocks?: Array<{
    blockId?: string;
    text?: string;
    evidenceIds?: string[];
  }>;
};

function sourceFallback(outline: OutlineContent): Record<string, string> {
  return Object.fromEntries(
    outline.pages.flatMap((page) =>
      page.narrativeBlocks.map((block) => [
        block.blockId,
        block.sourceText || block.summary,
      ]),
    ),
  );
}

export async function suggestReportDraft(input: {
  outline: OutlineContent;
  companyName: string;
  ticker: string;
  targetYear: number;
  targetQuarter: number;
  rating: string;
  thesis: string;
  targetPer: string;
  targetPrice: string;
  currentPrice: string;
  evidence: EvidenceInput[];
  signal?: AbortSignal;
}): Promise<Record<string, string>> {
  const fallback = sourceFallback(input.outline);
  const blocks = input.outline.pages.flatMap((page) =>
    page.narrativeBlocks.map((block) => {
      const sourceLength = block.sourceText.trim().length;
      return {
        blockId: block.blockId,
        pageId: page.pageId,
        pageNumber: page.pageNumber,
        subtitle: block.subtitle,
        summary: block.summary,
        sourceText: block.sourceText,
        minimumLength:
          sourceLength >= 120 ? Math.max(80, Math.floor(sourceLength * 0.65)) : 1,
        maximumLength:
          sourceLength >= 120
            ? Math.min(4_000, Math.ceil(sourceLength * 1.05))
            : Math.max(220, block.maxLength),
        evidenceIds: block.evidenceIds,
      };
    }),
  );
  if (blocks.length === 0) return fallback;

  try {
    const response = await fetch(
      `${(process.env.REFLO_LLM_WORKER_URL || "http://127.0.0.1:8093").replace(/\/$/, "")}/report/draft`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: input.signal
          ? AbortSignal.any([AbortSignal.timeout(120_000), input.signal])
          : AbortSignal.timeout(120_000),
        body: JSON.stringify({
          input: {
            company: input.companyName,
            ticker: input.ticker,
            targetPeriod: `${input.targetYear}년 ${input.targetQuarter}분기`,
            rating: input.rating,
            thesis: input.thesis,
            valuation: {
              targetPer: input.targetPer,
              targetPrice: input.targetPrice,
              currentPrice: input.currentPrice,
            },
            evidence: input.evidence,
            blocks,
          },
          profile: {
            version: "report-draft-v2",
            model: "gpt-5.4-mini",
            reasoning: "medium",
          },
        }),
      },
    );
    if (!response.ok) return fallback;
    const suggestion = (await response.json()) as DraftSuggestion;
    if (!Array.isArray(suggestion.blocks)) return fallback;
    const proposed = new Map(
      suggestion.blocks.map((block) => [block.blockId, block] as const),
    );
    const allowedEvidenceIds = new Set(
      input.evidence
        .filter((item) => item.machineStatus === "passed")
        .map((item) => item.evidenceId),
    );
    if (
      proposed.size !== blocks.length ||
      blocks.some((block) => !proposed.has(block.blockId))
    ) {
      return fallback;
    }

    const result: Record<string, string> = {};
    for (const block of blocks) {
      const candidate = proposed.get(block.blockId);
      const text =
        typeof candidate?.text === "string" ? candidate.text.trim() : "";
      const evidenceIds = candidate?.evidenceIds;
      const blockEvidenceIds = new Set(
        block.evidenceIds.filter((evidenceId) =>
          allowedEvidenceIds.has(evidenceId),
        ),
      );
      if (
        text.length < block.minimumLength ||
        text.length > block.maximumLength ||
        /[\r\n]/.test(text) ||
        !Array.isArray(evidenceIds) ||
        evidenceIds.length === 0 ||
        new Set(evidenceIds).size !== evidenceIds.length ||
        blockEvidenceIds.size === 0 ||
        evidenceIds.some(
          (evidenceId) =>
            typeof evidenceId !== "string" ||
            !blockEvidenceIds.has(evidenceId),
        )
      ) {
        return fallback;
      }
      result[block.blockId] = text;
    }
    return result;
  } catch (error) {
    if (input.signal?.aborted) {
      throw input.signal.reason ?? error;
    }
    return fallback;
  }
}
