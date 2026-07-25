import { contentHash } from "./hash";

export type ReportTemplateSlot = {
  slotId: string;
  blockId: string;
  valueType: string;
  required: boolean;
  semanticKey?: {
    metric?: string;
    period?: string;
    unit?: string;
    scope?: string;
  };
};

export type ReportTemplatePage = {
  pageId: string;
  pageNumber: number;
  rotation?: number;
  boxes?: { mediaBox?: number[] };
  blocks?: Array<{ blockId: string; role: string }>;
  slots?: ReportTemplateSlot[];
};

export type OutlineNarrative = {
  reportTitle: string;
  companyReview: string;
  companyOutlook: string;
  targetDirection: "유지" | "상향" | "하향";
  targetReason: string;
};

export type OutlineVisualSlot = {
  slotId: string;
  blockId: string;
  kind: "표" | "차트" | "수치";
  label: string;
  metric: string;
  required: boolean;
  bindingStatus: "confirmed" | "invalid";
};

export type OutlinePage = {
  pageId: string;
  pageNumber: number;
  pageLabel: string;
  role: string;
  editable: boolean;
  widthPt: number;
  heightPt: number;
  rotation: number;
  narrative: OutlineNarrative | null;
  visualSlots: OutlineVisualSlot[];
  evidenceIds: string[];
};

export type OutlineContent = {
  schemaVersion: "1.0";
  pages: OutlinePage[];
};

export type ReportBlock = {
  blockId: string;
  pageId: string;
  role: "title" | "narrative" | "judgement" | "numeric" | "visual" | "fixed";
  label: string;
  text: string;
  editable: boolean;
  revision: number;
  evidenceIds: string[];
  numericAuthority: string | null;
};

export type ReportDocument = {
  schemaVersion: "1.0";
  pageCount: number;
  pages: Array<{
    pageId: string;
    pageNumber: number;
    pageLabel: string;
    role: string;
    widthPt: number;
    heightPt: number;
    rotation: number;
    blocks: ReportBlock[];
  }>;
};

export type ReportIssue = {
  code: string;
  severity: "blocking" | "warning";
  message: string;
  pageId: string | null;
  blockId: string | null;
};

type OutlineSeed = {
  companyName: string;
  targetYear: number;
  targetQuarter: number;
  thesis: string;
  rating: string;
  targetPer: string;
  targetPrice: string;
  currentPrice: string;
  evidence: Array<{
    evidenceId: string;
    title: string;
    oneLineValue: string;
    stance: string;
    machineStatus: string;
  }>;
  mappingConfirmed: boolean;
};

const pageRoles = [
  "핵심 실적 · 투자 판단",
  "실적 상세",
  "재무제표",
  "밸류에이션 · 고지",
  "회사 정보",
];

function cleanThesis(value: string): string {
  return value.replace(/^\[[^\]]+\]\s*/, "").trim();
}

function metricLabel(metric: string): string {
  const labels: Record<string, string> = {
    revenue: "매출",
    operating_profit: "영업이익",
    net_income: "순이익",
    eps: "Forward EPS",
    per: "Target PER",
    target_price: "목표주가",
    current_price: "현재주가",
    investment_opinion: "투자의견",
    quarterly_performance_table: "분기 실적",
    financial_statements_table: "재무제표",
    target_price_history_table: "목표주가 변경 이력",
  };
  return labels[metric] ?? metric.replaceAll("_", " ");
}

export function buildInitialOutline(
  templatePages: ReportTemplatePage[],
  seed: OutlineSeed,
): OutlineContent {
  const sortedPages = [...templatePages].sort(
    (left, right) => left.pageNumber - right.pageNumber,
  );
  const supporting = seed.evidence.find(
    (item) => item.stance === "supporting" && item.machineStatus === "passed",
  );
  const allEvidenceIds = seed.evidence
    .filter((item) => item.machineStatus === "passed")
    .map((item) => item.evidenceId);

  return {
    schemaVersion: "1.0",
    pages: sortedPages.map((page, pageIndex) => {
      let tableIndex = 0;
      let chartIndex = 0;
      let scalarIndex = 0;
      const visualSlots = (page.slots ?? []).map((slot) => {
        const metric = slot.semanticKey?.metric ?? "연결 항목";
        const kind =
          slot.valueType === "table"
            ? "표"
            : slot.valueType === "chart"
              ? "차트"
              : "수치";
        const localIndex =
          kind === "표"
            ? ++tableIndex
            : kind === "차트"
              ? ++chartIndex
              : ++scalarIndex;
        return {
          slotId: slot.slotId,
          blockId: slot.blockId,
          kind,
          label: `${kind}${localIndex}`,
          metric: metricLabel(metric),
          required: slot.required,
          bindingStatus: seed.mappingConfirmed ? "confirmed" : "invalid",
        } satisfies OutlineVisualSlot;
      });
      const mediaBox = page.boxes?.mediaBox ?? [0, 0, 595.32, 841.92];

      return {
        pageId: page.pageId,
        pageNumber: page.pageNumber,
        pageLabel: String(page.pageNumber).padStart(2, "0"),
        role: pageRoles[pageIndex] ?? `원본 페이지 ${page.pageNumber}`,
        editable: pageIndex === 0,
        widthPt: Math.abs(Number(mediaBox[2] ?? 595.32) - Number(mediaBox[0] ?? 0)),
        heightPt: Math.abs(Number(mediaBox[3] ?? 841.92) - Number(mediaBox[1] ?? 0)),
        rotation: Number(page.rotation ?? 0),
        narrative:
          pageIndex === 0
            ? {
                reportTitle: `${seed.companyName} ${seed.targetYear}년 ${seed.targetQuarter}분기 실적 Review`,
                companyReview:
                  supporting?.oneLineValue ||
                  `${seed.companyName}의 분기 실적과 핵심 변화를 검증 근거로 정리한다.`,
                companyOutlook: cleanThesis(seed.thesis),
                targetDirection: "유지",
                targetReason: `${seed.rating} · Target PER ${seed.targetPer}배 · 목표주가 ${Number(seed.targetPrice).toLocaleString("ko-KR")}원`,
              }
            : null,
        visualSlots,
        evidenceIds:
          pageIndex === 0
            ? allEvidenceIds
            : allEvidenceIds.filter((_, index) => index % sortedPages.length === pageIndex),
      };
    }),
  };
}

export function patchOutline(
  outline: OutlineContent,
  changes: Array<{
    pageId: string;
    field: keyof OutlineNarrative;
    value: string;
  }>,
): { content: OutlineContent; invalidatedPageIds: string[] } {
  const invalidated = new Set<string>();
  const pages = outline.pages.map((page) => {
    const pageChanges = changes.filter((change) => change.pageId === page.pageId);
    if (pageChanges.length === 0) return page;
    if (!page.editable || !page.narrative) {
      throw new Error("OUTLINE_SLOT_READ_ONLY");
    }
    const narrative = { ...page.narrative };
    for (const change of pageChanges) {
      const value = change.value.trim();
      const maxLength = change.field === "reportTitle" ? 80 : 120;
      if (
        !value ||
        value.length > maxLength ||
        /[\r\n]/.test(value) ||
        (change.field === "targetDirection" &&
          !["유지", "상향", "하향"].includes(value))
      ) {
        throw new Error("OUTLINE_VALUE_INVALID");
      }
      narrative[change.field] = value as never;
    }
    invalidated.add(page.pageId);
    return { ...page, narrative };
  });
  return {
    content: { ...outline, pages },
    invalidatedPageIds: [...invalidated],
  };
}

export function validateOutline(input: {
  outline: OutlineContent;
  templatePageIds: string[];
  mappingConfirmed: boolean;
  evidencePassed: boolean;
  allPageIdsReviewed: string[];
}): ReportIssue[] {
  const issues: ReportIssue[] = [];
  const actualPageIds = input.outline.pages.map((page) => page.pageId);
  if (
    actualPageIds.length !== input.templatePageIds.length ||
    actualPageIds.some((pageId, index) => pageId !== input.templatePageIds[index])
  ) {
    issues.push({
      code: "PAGE_STRUCTURE_CHANGED",
      severity: "blocking",
      message: "원본 PDF 페이지 수 또는 순서가 변경되었습니다.",
      pageId: null,
      blockId: null,
    });
  }
  const first = input.outline.pages[0];
  if (
    !first?.narrative ||
    Object.values(first.narrative).some((value) => !String(value).trim())
  ) {
    issues.push({
      code: "REQUIRED_NARRATIVE_MISSING",
      severity: "blocking",
      message: "첫 페이지의 필수 작성 방향을 모두 입력해주세요.",
      pageId: first?.pageId ?? null,
      blockId: null,
    });
  }
  if (!input.mappingConfirmed) {
    issues.push({
      code: "MAPPING_REVALIDATION_REQUIRED",
      severity: "blocking",
      message: "표·차트와 Excel 연결을 다시 확인해주세요.",
      pageId: null,
      blockId: null,
    });
  }
  if (!input.evidencePassed) {
    issues.push({
      code: "EVIDENCE_REVALIDATION_REQUIRED",
      severity: "blocking",
      message: "보고서에 사용할 근거를 다시 검증해주세요.",
      pageId: null,
      blockId: null,
    });
  }
  const reviewed = new Set(input.allPageIdsReviewed);
  for (const page of input.outline.pages) {
    if (!reviewed.has(page.pageId)) {
      issues.push({
        code: "PAGE_REVIEW_REQUIRED",
        severity: "blocking",
        message: `${page.pageLabel} 페이지 확인이 필요합니다.`,
        pageId: page.pageId,
        blockId: null,
      });
    }
  }
  return issues;
}

export function buildReportDocument(input: {
  outline: OutlineContent;
  rating: string;
  targetPer: string;
  targetPrice: string;
  currentPrice: string;
  forwardEps: string;
}): ReportDocument {
  return {
    schemaVersion: "1.0",
    pageCount: input.outline.pages.length,
    pages: input.outline.pages.map((page, index) => {
      const blocks: ReportBlock[] = [];
      if (page.narrative) {
        blocks.push(
          {
            blockId: `${page.pageId}.title`,
            pageId: page.pageId,
            role: "title",
            label: "리포트 제목",
            text: page.narrative.reportTitle,
            editable: true,
            revision: 1,
            evidenceIds: page.evidenceIds,
            numericAuthority: null,
          },
          {
            blockId: `${page.pageId}.review`,
            pageId: page.pageId,
            role: "narrative",
            label: "기업 리뷰",
            text: page.narrative.companyReview,
            editable: true,
            revision: 1,
            evidenceIds: page.evidenceIds,
            numericAuthority: null,
          },
          {
            blockId: `${page.pageId}.outlook`,
            pageId: page.pageId,
            role: "narrative",
            label: "기업 전망",
            text: page.narrative.companyOutlook,
            editable: true,
            revision: 1,
            evidenceIds: page.evidenceIds,
            numericAuthority: null,
          },
          {
            blockId: `${page.pageId}.target-judgement`,
            pageId: page.pageId,
            role: "judgement",
            label: "목표주가 판단",
            text: `${page.narrative.targetDirection} · ${page.narrative.targetReason}`,
            editable: true,
            revision: 1,
            evidenceIds: page.evidenceIds,
            numericAuthority: null,
          },
          {
            blockId: `${page.pageId}.valuation-authority`,
            pageId: page.pageId,
            role: "numeric",
            label: "승인 밸류에이션",
            text: `${input.rating} · Forward EPS ${Number(input.forwardEps).toLocaleString("ko-KR")}원 · Target PER ${input.targetPer}배 · 목표주가 ${Number(input.targetPrice).toLocaleString("ko-KR")}원 · 현재주가 ${Number(input.currentPrice).toLocaleString("ko-KR")}원`,
            editable: false,
            revision: 1,
            evidenceIds: page.evidenceIds,
            numericAuthority: "valuation_approval",
          },
        );
      }
      for (const slot of page.visualSlots) {
        blocks.push({
          blockId: slot.blockId,
          pageId: page.pageId,
          role: "visual",
          label: `${slot.label} · ${slot.metric}`,
          text: `${slot.metric} · Excel 연결 완료`,
          editable: false,
          revision: 1,
          evidenceIds: page.evidenceIds,
          numericAuthority: "mapping_set",
        });
      }
      if (blocks.length === 0) {
        blocks.push({
          blockId: `${page.pageId}.fixed`,
          pageId: page.pageId,
          role: "fixed",
          label: page.role,
          text: "원본 PDF의 고정 디자인과 문구를 유지합니다.",
          editable: false,
          revision: 1,
          evidenceIds: [],
          numericAuthority: null,
        });
      }
      return {
        pageId: page.pageId,
        pageNumber: page.pageNumber,
        pageLabel: page.pageLabel,
        role: index === 0 ? "핵심 실적 · 투자 판단" : page.role,
        widthPt: page.widthPt,
        heightPt: page.heightPt,
        rotation: page.rotation,
        blocks,
      };
    }),
  };
}

export function applyReportOperations(
  document: ReportDocument,
  operations: Array<{
    type: "replace_text" | "replace_block_text";
    blockId: string;
    baseBlockRevision: number;
    text: string;
  }>,
): ReportDocument {
  const next = structuredClone(document);
  for (const operation of operations) {
    const block = next.pages
      .flatMap((page) => page.blocks)
      .find((item) => item.blockId === operation.blockId);
    if (!block || !block.editable) throw new Error("INVALID_REPORT_OPERATION");
    if (block.revision !== operation.baseBlockRevision) {
      throw new Error("REPORT_BLOCK_CONFLICT");
    }
    const text = operation.text.trim();
    if (!text || text.length > 2_000) throw new Error("BLOCK_OVERFLOW");
    block.text = text;
    block.revision += 1;
  }
  return next;
}

export function validateReportDocument(input: {
  document: ReportDocument;
  templatePageIds: string[];
  evidenceIds: Set<string>;
  valuationText: {
    targetPer: string;
    targetPrice: string;
    forwardEps: string;
  };
}): ReportIssue[] {
  const issues: ReportIssue[] = [];
  if (
    input.document.pages.length !== input.templatePageIds.length ||
    input.document.pages.some(
      (page, index) => page.pageId !== input.templatePageIds[index],
    )
  ) {
    issues.push({
      code: "PAGE_STRUCTURE_CHANGED",
      severity: "blocking",
      message: "보고서 페이지 구조가 원본 PDF와 다릅니다.",
      pageId: null,
      blockId: null,
    });
  }
  for (const page of input.document.pages) {
    for (const block of page.blocks) {
      if (!block.text.trim()) {
        issues.push({
          code: "REPORT_BLOCK_EMPTY",
          severity: "blocking",
          message: `${block.label} 내용이 비어 있습니다.`,
          pageId: page.pageId,
          blockId: block.blockId,
        });
      }
      if (
        block.evidenceIds.some((evidenceId) => !input.evidenceIds.has(evidenceId))
      ) {
        issues.push({
          code: "EVIDENCE_REFERENCE_MISSING",
          severity: "blocking",
          message: `${block.label}의 근거 연결을 찾을 수 없습니다.`,
          pageId: page.pageId,
          blockId: block.blockId,
        });
      }
      if (block.numericAuthority === "valuation_approval") {
        for (const expected of [
          input.valuationText.targetPer,
          Number(input.valuationText.targetPrice).toLocaleString("ko-KR"),
          Number(input.valuationText.forwardEps).toLocaleString("ko-KR"),
        ]) {
          if (!block.text.includes(expected)) {
            issues.push({
              code: "NUMERIC_AUTHORITY_MISMATCH",
              severity: "blocking",
              message: "보고서 수치가 승인된 밸류에이션과 다릅니다.",
              pageId: page.pageId,
              blockId: block.blockId,
            });
            break;
          }
        }
      }
    }
  }
  return issues;
}

export function proposeReportRewrite(original: string, prompt: string): string {
  let proposed = original.trim();
  if (/간결|짧|축약/.test(prompt)) {
    proposed = proposed
      .replace(/것으로 예상한다/g, "전망이다")
      .replace(/할 것으로 전망한다/g, "할 전망이다")
      .replace(/\s+/g, " ");
  } else if (/격식|공식|리서치/.test(prompt)) {
    proposed = proposed
      .replace(/보인다/g, "판단한다")
      .replace(/같다/g, "전망한다");
  } else {
    proposed = proposed.replace(/예상한다/g, "전망한다");
  }
  const originalNumbers = original.match(/-?\d[\d,.]*%?/g) ?? [];
  if (originalNumbers.some((value) => !proposed.includes(value))) return original;
  return proposed;
}

export function reportContentHash(document: ReportDocument): string {
  return contentHash(document);
}

export function reportFilename(input: {
  companyName: string;
  ticker: string;
  year: number;
  quarter: number;
  reportVersion: number;
  approvedAt: Date;
  extension: "pdf" | "xlsx";
}): string {
  const date = input.approvedAt.toISOString().slice(0, 10).replaceAll("-", "");
  const base =
    `${input.companyName}_${input.ticker}_${input.year}Q${input.quarter}` +
    `_실적Review_v${input.reportVersion}_${date}`;
  const normalized = base
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 110);
  return `${normalized}.${input.extension}`;
}
