import type {
  OutlineContent,
  OutlineNarrativeBlock,
} from "../../domain/report";

type EvidenceInput = {
  evidenceId: string;
  title: string;
  oneLineValue: string;
  stance: string;
  machineStatus: string;
};

type AgentSuggestion = {
  generationSource?: "ai" | "fixture";
  pages?: Array<{
    pageId?: string;
    recommendedTitle?: {
      blockId?: string;
      value?: string;
      evidenceIds?: string[];
    } | null;
    narrativeBlocks?: Array<{
      blockId?: string;
      subtitle?: string;
      summary?: string;
      evidenceIds?: string[];
    }>;
  }>;
};

function oneLine(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.trim();
  if (!cleaned || cleaned.length > maxLength || /[\r\n]/.test(cleaned)) {
    return null;
  }
  return cleaned;
}

function validEvidenceIds(
  value: unknown,
  allowed: Set<string>,
): string[] | null {
  if (!Array.isArray(value)) return null;
  const ids = value.filter((item): item is string => typeof item === "string");
  if (ids.length !== value.length || ids.some((id) => !allowed.has(id))) {
    return null;
  }
  return [...new Set(ids)];
}

function mergeNarrativeBlock(
  block: OutlineNarrativeBlock,
  suggestion: NonNullable<
    NonNullable<AgentSuggestion["pages"]>[number]["narrativeBlocks"]
  >[number],
  allowedEvidenceIds: Set<string>,
): OutlineNarrativeBlock | null {
  if (suggestion.blockId !== block.blockId) return null;
  const subtitle = oneLine(suggestion.subtitle, 80);
  const summary = oneLine(suggestion.summary, block.maxLength);
  const evidenceIds = validEvidenceIds(
    suggestion.evidenceIds,
    allowedEvidenceIds,
  );
  if (!subtitle || !summary || !evidenceIds) return null;
  return { ...block, subtitle, summary, evidenceIds };
}

export async function suggestReportOutline(input: {
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
}): Promise<OutlineContent> {
  const fallback = input.outline;
  try {
    const response = await fetch(
      `${(process.env.REFLO_LLM_WORKER_URL || "http://127.0.0.1:8093").replace(/\/$/, "")}/report/outline`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(120_000),
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
            pages: fallback.pages.map((page) => ({
              pageId: page.pageId,
              pageNumber: page.pageNumber,
              role: page.role,
              recommendedTitle: page.recommendedTitle
                ? {
                    blockId: page.recommendedTitle.blockId,
                    currentValue: page.recommendedTitle.value,
                    sourceText: page.recommendedTitle.sourceText,
                    maxLength: page.recommendedTitle.maxLength,
                  }
                : null,
              narrativeBlocks: page.narrativeBlocks.map((block) => ({
                blockId: block.blockId,
                order: block.order,
                sourceHeading: block.sourceHeading,
                sourceText: block.sourceText,
                currentSubtitle: block.subtitle,
                currentSummary: block.summary,
                maxLength: block.maxLength,
              })),
              visualSlots: page.visualSlots.map((slot) => ({
                kind: slot.kind,
                label: slot.label,
                metric: slot.metric,
              })),
            })),
          },
          profile: {
            version: "report-outline-v1",
            model: "gpt-5.6-terra",
            reasoning: "medium",
          },
        }),
      },
    );
    if (!response.ok) return fallback;
    const suggestion = (await response.json()) as AgentSuggestion;
    const suggestedPages = suggestion.pages;
    if (!Array.isArray(suggestedPages)) return fallback;
    const allowedEvidenceIds = new Set(
      input.evidence
        .filter((item) => item.machineStatus === "passed")
        .map((item) => item.evidenceId),
    );
    const pageMap = new Map(
      suggestedPages.map((page) => [page.pageId, page] as const),
    );
    if (
      pageMap.size !== fallback.pages.length ||
      fallback.pages.some((page) => !pageMap.has(page.pageId))
    ) {
      return fallback;
    }

    const pages = fallback.pages.map((page) => {
      const proposed = pageMap.get(page.pageId);
      if (!proposed) return page;
      let recommendedTitle = page.recommendedTitle;
      if (recommendedTitle) {
        if (
          proposed.recommendedTitle?.blockId !== recommendedTitle.blockId
        ) {
          return page;
        }
        const value = oneLine(
          proposed.recommendedTitle.value,
          recommendedTitle.maxLength,
        );
        const evidenceIds = validEvidenceIds(
          proposed.recommendedTitle.evidenceIds,
          allowedEvidenceIds,
        );
        if (!value || !evidenceIds) return page;
        recommendedTitle = { ...recommendedTitle, value, evidenceIds };
      } else if (proposed.recommendedTitle !== null) {
        return page;
      }

      if (
        !Array.isArray(proposed.narrativeBlocks) ||
        proposed.narrativeBlocks.length !== page.narrativeBlocks.length
      ) {
        return page;
      }
      const proposedBlockMap = new Map(
        proposed.narrativeBlocks.map((block) => [block.blockId, block] as const),
      );
      const narrativeBlocks = page.narrativeBlocks.map((block) => {
        const proposedBlock = proposedBlockMap.get(block.blockId);
        return proposedBlock
          ? mergeNarrativeBlock(block, proposedBlock, allowedEvidenceIds)
          : null;
      });
      if (narrativeBlocks.some((block) => block === null)) return page;
      return {
        ...page,
        recommendedTitle,
        narrativeBlocks: narrativeBlocks as OutlineNarrativeBlock[],
      };
    });

    return {
      ...fallback,
      generationSource:
        suggestion.generationSource === "ai" ? "ai" : "fallback",
      pages,
    };
  } catch {
    return fallback;
  }
}
