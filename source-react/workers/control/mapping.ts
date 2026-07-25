import { createHash } from "node:crypto";
import type {
  TemplateIr,
  TemplateSlot,
  WorkbookAnalysis,
  WorkbookCandidateCell,
  WorkbookCandidateRange,
} from "./types";
import type { MarketPriceSnapshot } from "../../server/infrastructure/market-data/krx";

type MappingSource = {
  sheetId: string;
  sheet: string;
  address?: string;
  range?: string;
  readMode?: "calculated_value";
  authority: "authoritative";
  formulaHash?: string;
  numberFormat?: string;
  structureFingerprint: string;
  provider?: "KRX_OPEN_API";
  ticker?: string;
  exchange?: string;
  requestedDate?: string;
  tradingDate?: string;
  closePrice?: number;
  currency?: "KRW";
  sourceApiId?: string;
  sourcePayloadHash?: string;
};

export type MappingCandidate = {
  candidateId: string;
  slotId: string;
  kind: "cell" | "range" | "market_data";
  source: MappingSource;
  label: string;
  score: number;
  reasonCodes: string[];
  selected: boolean;
};

export type MappingBinding = {
  bindingId: string;
  slotId: string;
  kind: "scalar" | "table";
  valueType?: string;
  source: MappingSource;
  verificationSources?: MappingSource[];
  display?: Record<string, unknown>;
  rowKeyColumn?: string;
  columnHeaderRow?: number;
  expectedRows?: number;
  expectedColumns?: number;
  subtotalRows?: number[];
  unitRows?: number[];
  status: "suggested" | "confirmed" | "invalid";
};

export type MappingSet = {
  schemaVersion: "1.0";
  mappingSetId: string;
  mappingSetVersion: number;
  templateId: string;
  templateVersion: number;
  workbookVersionId: string;
  workbookFileHash: string;
  workbookStructureHash: string;
  status: "suggested" | "confirmed" | "revalidation_required" | "invalid";
  bindings: MappingBinding[];
  candidates: MappingCandidate[];
  unmappedRequiredSlots: string[];
  warnings: Array<{ code: string; message: string }>;
};

export type MappingSummary = {
  status: "confirmed" | "blocked";
  slotCount: number;
  requiredSlotCount: number;
  bindingCount: number;
  confirmedBindingCount: number;
  unmappedRequiredCount: number;
};

const metricAliases: Record<string, string[]> = {
  target_price: ["목표주가", "targetprice", "적정주가"],
  current_price: ["현재주가", "currentprice", "종가"],
  revenue: ["매출액", "매출", "revenue", "sales"],
  operating_profit: ["영업이익", "operatingprofit", "op"],
  net_income: ["지배주주순이익", "순이익", "netincome"],
  eps: ["forwardeps", "fwdeps", "eps"],
  per: ["targetper", "적용per", "per"],
  investment_opinion: ["투자의견", "investmentopinion", "rating"],
  quarterly_performance_table: ["분기실적", "quarterly", "분기"],
  segment_revenue_table: ["부문매출", "부문별", "segment"],
  financial_statements_table: ["재무제표", "재무상태표", "financialstatement"],
  target_price_history_table: ["목표주가추이", "targetpricehistory", "목표주가"],
  valuation_bridge_table: ["valuationbridge", "밸류에이션", "valuation"],
};

const fixedCellHints: Record<string, Array<[string, string]>> = {
  target_price: [["09_Target_PER", "B15"]],
  current_price: [["09_Target_PER", "B16"]],
  eps: [
    ["09_Target_PER", "B7"],
    ["08_Forward_EPS", "D36"],
  ],
  per: [["09_Target_PER", "B14"]],
};

const fixedRangeHints: Record<string, Array<[string, string]>> = {
  quarterly_performance_table: [["01_실적추이", "A5:L25"]],
  segment_revenue_table: [["01_실적추이", "A5:L13"]],
  financial_statements_table: [["06_재무요약", "A5:M45"]],
  target_price_history_table: [["03_목표주가", "A5:F20"]],
  valuation_bridge_table: [["09_Target_PER", "A5:I26"]],
};

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function opaque(prefix: string, value: string): string {
  return `${prefix}_${hash(value).slice(0, 20)}`;
}

function normalize(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^0-9a-z가-힣]/g, "");
}

function columnNumber(value: string): number {
  return [...value.toUpperCase()].reduce(
    (total, character) => total * 26 + character.charCodeAt(0) - 64,
    0,
  );
}

function parseAddress(value: string): [number, number] {
  const match = /^([A-Z]+)(\d+)$/i.exec(value);
  return match ? [columnNumber(match[1]), Number(match[2])] : [0, 0];
}

function rangeDimensions(value: string): { rows: number; columns: number } {
  const [first, last] = value.split(":");
  const [firstColumn, firstRow] = parseAddress(first);
  const [lastColumn, lastRow] = parseAddress(last ?? first);
  return {
    rows: Math.max(1, lastRow - firstRow + 1),
    columns: Math.max(1, lastColumn - firstColumn + 1),
  };
}

function containsAddress(range: string, address: string): boolean {
  const [first, last] = range.split(":");
  const [firstColumn, firstRow] = parseAddress(first);
  const [lastColumn, lastRow] = parseAddress(last ?? first);
  const [column, row] = parseAddress(address);
  return (
    column >= firstColumn &&
    column <= lastColumn &&
    row >= firstRow &&
    row <= lastRow
  );
}

function containsRange(outer: string, inner: string): boolean {
  const [first, last] = inner.split(":");
  return containsAddress(outer, first) && containsAddress(outer, last ?? first);
}

function aliases(metric: string): string[] {
  return (metricAliases[metric] ?? [metric]).map(normalize);
}

function cellSource(cell: WorkbookCandidateCell): MappingSource {
  return {
    sheetId: cell.sheetId,
    sheet: cell.sheetName,
    address: cell.address,
    readMode: "calculated_value",
    authority: "authoritative",
    ...(cell.formula ? { formulaHash: hash(cell.formula) } : {}),
    numberFormat: cell.numberFormat,
    structureFingerprint: cell.structureFingerprint,
  };
}

function rangeSource(range: WorkbookCandidateRange): MappingSource {
  return {
    sheetId: range.sheetId,
    sheet: range.sheetName,
    range: range.range,
    authority: "authoritative",
    structureFingerprint: range.structureFingerprint,
  };
}

function candidateScore(
  slot: TemplateSlot,
  candidate: WorkbookCandidateCell,
): { score: number; reasons: string[] } {
  const targetAliases = aliases(slot.semanticKey.metric);
  const label = normalize(candidate.label);
  const sheet = normalize(candidate.sheetName);
  const formula = normalize(candidate.formula ?? "");
  const period = normalize(slot.semanticKey.period ?? "");
  const reasons: string[] = [];
  let score = 0;
  if (targetAliases.some((alias) => alias && label === alias)) {
    score += 0.72;
    reasons.push("EXACT_LABEL");
  } else if (
    targetAliases.some(
      (alias) => alias && (label.includes(alias) || alias.includes(label)),
    )
  ) {
    score += 0.54;
    reasons.push("LABEL_MATCH");
  }
  if (
    targetAliases.some(
      (alias) => alias && (sheet.includes(alias) || formula.includes(alias)),
    )
  ) {
    score += 0.18;
    reasons.push("CONTEXT_MATCH");
  }
  if (period && label.includes(period)) {
    score += 0.12;
    reasons.push("PERIOD_MATCH");
  }
  if (/^\d{2}_/.test(candidate.sheetName)) {
    score += 0.06;
    reasons.push("MODEL_SHEET");
  }
  if (
    ["money", "decimal", "integer", "percent"].includes(slot.valueType) &&
    candidate.valueType === "decimal"
  ) {
    score += 0.12;
    reasons.push("VALUE_TYPE_MATCH");
  }
  if (candidate.formula) {
    score += 0.04;
    reasons.push("CALCULATED_VALUE");
  }
  return { score: Math.min(0.99, score), reasons };
}

function fixedCellCandidates(
  slot: TemplateSlot,
  workbook: WorkbookAnalysis,
): MappingCandidate[] {
  const hints = fixedCellHints[slot.semanticKey.metric] ?? [];
  return hints.flatMap(([sheetName, address]) => {
    const cell = workbook.candidateCells.find(
      (candidate) =>
        candidate.sheetName === sheetName &&
        candidate.address.toUpperCase() === address,
    );
    if (!cell) return [];
    return [
      {
        candidateId: opaque("mapcand", `${slot.slotId}:${cell.candidateId}`),
        slotId: slot.slotId,
        kind: "cell" as const,
        source: cellSource(cell),
        label: cell.label || `${cell.sheetName}!${cell.address}`,
        score: 0.99,
        reasonCodes: ["DOCUMENTED_MODEL_CONTRACT", "EXACT_ADDRESS"],
        selected: true,
      },
    ];
  });
}

function scalarCandidates(
  slot: TemplateSlot,
  workbook: WorkbookAnalysis,
): MappingCandidate[] {
  const fixed = fixedCellCandidates(slot, workbook);
  const fixedIds = new Set(
    fixed.map((candidate) => `${candidate.source.sheet}!${candidate.source.address}`),
  );
  const ranked = workbook.candidateCells
    .map((cell) => ({ cell, ...candidateScore(slot, cell) }))
    .filter(({ score }) => score >= 0.36)
    .sort((left, right) => right.score - left.score)
    .filter(
      ({ cell }) => !fixedIds.has(`${cell.sheetName}!${cell.address}`),
    )
    .slice(0, Math.max(0, 5 - fixed.length))
    .map(({ cell, score, reasons }) => ({
      candidateId: opaque("mapcand", `${slot.slotId}:${cell.candidateId}`),
      slotId: slot.slotId,
      kind: "cell" as const,
      source: cellSource(cell),
      label: cell.label || `${cell.sheetName}!${cell.address}`,
      score: Number(score.toFixed(4)),
      reasonCodes: reasons,
      selected: false,
    }));
  const candidates = [...fixed, ...ranked].sort(
    (left, right) => right.score - left.score,
  );
  const top = candidates[0];
  const next = candidates[1];
  const unambiguous =
    top &&
    (top.reasonCodes.includes("DOCUMENTED_MODEL_CONTRACT") ||
      (top.score >= 0.8 &&
        top.reasonCodes.includes("MODEL_SHEET") &&
        top.reasonCodes.includes("PERIOD_MATCH")) ||
      (top.score >= 0.92 && (!next || top.score - next.score >= 0.12)));
  return candidates.map((candidate, index) => ({
    ...candidate,
    selected: Boolean(unambiguous && index === 0),
  }));
}

function marketPriceCandidate(
  slot: TemplateSlot,
  snapshot: MarketPriceSnapshot,
): MappingCandidate | null {
  if (
    slot.semanticKey.metric !== "current_price" ||
    snapshot.status !== "available" ||
    snapshot.closePrice == null ||
    !snapshot.tradingDate ||
    !snapshot.sourceApiId ||
    !snapshot.sourcePayloadHash
  ) {
    return null;
  }
  const source: MappingSource = {
    sheetId: "krx-open-api",
    sheet: "KRX",
    address: snapshot.tradingDate,
    authority: "authoritative",
    structureFingerprint: hash(
      `${snapshot.ticker}:${snapshot.tradingDate}:${snapshot.closePrice}:${snapshot.sourcePayloadHash}`,
    ),
    provider: snapshot.provider,
    ticker: snapshot.ticker,
    exchange: snapshot.exchange,
    requestedDate: snapshot.requestedDate,
    tradingDate: snapshot.tradingDate,
    closePrice: snapshot.closePrice,
    currency: snapshot.currency,
    sourceApiId: snapshot.sourceApiId,
    sourcePayloadHash: snapshot.sourcePayloadHash,
  };
  return {
    candidateId: opaque(
      "mapcand",
      `${slot.slotId}:KRX:${snapshot.ticker}:${snapshot.tradingDate}:${snapshot.closePrice}`,
    ),
    slotId: slot.slotId,
    kind: "market_data",
    source,
    label: `KRX 기준일 종가 · ${snapshot.tradingDate} · ${snapshot.closePrice.toLocaleString("ko-KR")}원`,
    score: 0.99,
    reasonCodes: [
      "OFFICIAL_MARKET_CLOSE",
      snapshot.requestedDate === snapshot.tradingDate
        ? "CUTOFF_DATE_MATCH"
        : "PREVIOUS_TRADING_DAY",
    ],
    selected: true,
  };
}

function synthesizeRange(
  workbook: WorkbookAnalysis,
  sheetName: string,
  rangeValue: string,
): WorkbookCandidateRange | null {
  const sheet = workbook.sheets.find((item) => item.name === sheetName);
  if (!sheet || !containsRange(sheet.usedRange, rangeValue)) return null;
  const dimensions = rangeDimensions(rangeValue);
  return {
    candidateId: opaque("range", `${sheet.sheetId}:${rangeValue}`),
    sheetId: sheet.sheetId,
    sheetName,
    range: rangeValue,
    label: `${sheetName} ${rangeValue}`,
    rowCount: dimensions.rows,
    columnCount: dimensions.columns,
    structureFingerprint: hash(
      `${sheet.structureHash}:${rangeValue}:${dimensions.rows}:${dimensions.columns}`,
    ),
  };
}

function tableCandidates(
  slot: TemplateSlot,
  workbook: WorkbookAnalysis,
): MappingCandidate[] {
  const fixed = (fixedRangeHints[slot.semanticKey.metric] ?? [])
    .map(([sheet, range]) => synthesizeRange(workbook, sheet, range))
    .filter((value): value is WorkbookCandidateRange => Boolean(value))
    .map((range) => ({
      candidateId: opaque("mapcand", `${slot.slotId}:${range.candidateId}`),
      slotId: slot.slotId,
      kind: "range" as const,
      source: rangeSource(range),
      label: range.label,
      score: 0.99,
      reasonCodes: ["DOCUMENTED_MODEL_CONTRACT", "EXACT_RANGE"],
      selected: true,
    }));
  const targetAliases = aliases(slot.semanticKey.metric);
  const fixedIds = new Set(
    fixed.map((candidate) => `${candidate.source.sheet}!${candidate.source.range}`),
  );
  const ranked = workbook.candidateRanges
    .map((range) => {
      const context = normalize(`${range.sheetName} ${range.label}`);
      const matched = targetAliases.some((alias) => context.includes(alias));
      return {
        range,
        score: matched ? 0.82 : 0.3,
        reasons: matched ? ["RANGE_CONTEXT_MATCH"] : ["SHEET_RANGE"],
      };
    })
    .filter(({ range }) => !fixedIds.has(`${range.sheetName}!${range.range}`))
    .sort((left, right) => right.score - left.score)
    .slice(0, Math.max(0, 5 - fixed.length))
    .map(({ range, score, reasons }) => ({
      candidateId: opaque("mapcand", `${slot.slotId}:${range.candidateId}`),
      slotId: slot.slotId,
      kind: "range" as const,
      source: rangeSource(range),
      label: range.label,
      score,
      reasonCodes: reasons,
      selected: false,
    }));
  const candidates = [...fixed, ...ranked].sort(
    (left, right) => right.score - left.score,
  );
  return candidates.map((candidate, index) => ({
    ...candidate,
    selected:
      index === 0 &&
      (candidate.reasonCodes.includes("DOCUMENTED_MODEL_CONTRACT") ||
        candidate.score >= 0.92),
  }));
}

function bindingFor(
  slot: TemplateSlot,
  candidate: MappingCandidate,
): MappingBinding {
  if (slot.valueType === "table") {
    const dimensions = rangeDimensions(candidate.source.range ?? "A1:A1");
    return {
      bindingId: opaque("binding", `${slot.slotId}:${candidate.candidateId}`),
      slotId: slot.slotId,
      kind: "table",
      source: candidate.source,
      rowKeyColumn: (candidate.source.range ?? "A1").match(/^[A-Z]+/i)?.[0] ?? "A",
      columnHeaderRow: parseAddress(
        (candidate.source.range ?? "A1").split(":")[0],
      )[1],
      expectedRows: dimensions.rows,
      expectedColumns: dimensions.columns,
      subtotalRows: [],
      unitRows: [],
      display: {},
      status: "confirmed",
    };
  }
  return {
    bindingId: opaque("binding", `${slot.slotId}:${candidate.candidateId}`),
    slotId: slot.slotId,
    kind: "scalar",
    valueType: slot.valueType,
    source: candidate.source,
    verificationSources: [],
    display: {},
    status: "confirmed",
  };
}

export function buildMappingSet(
  template: TemplateIr,
  workbook: WorkbookAnalysis,
  marketPrice?: MarketPriceSnapshot,
): { mappingSet: MappingSet; summary: MappingSummary } {
  const slots = template.pages.flatMap((page) => page.slots);
  const candidates = slots.flatMap((slot) => {
    if (slot.valueType === "table") return tableCandidates(slot, workbook);
    if (slot.valueType === "chart") return [];
    const workbookCandidates = scalarCandidates(slot, workbook);
    const krxCandidate = marketPrice
      ? marketPriceCandidate(slot, marketPrice)
      : null;
    return krxCandidate
      ? [
          krxCandidate,
          ...workbookCandidates.map((candidate) => ({
            ...candidate,
            selected: false,
            reasonCodes: [
              ...candidate.reasonCodes,
              "WORKBOOK_VERIFICATION_SOURCE",
            ],
          })),
        ]
      : workbookCandidates;
  });
  const bindings = slots.flatMap((slot) => {
    const selected = candidates.find(
      (candidate) => candidate.slotId === slot.slotId && candidate.selected,
    );
    if (!selected) return [];
    const binding = bindingFor(slot, selected);
    if (selected.kind === "market_data" && binding.kind === "scalar") {
      binding.verificationSources = candidates
        .filter(
          (candidate) =>
            candidate.slotId === slot.slotId && candidate.kind === "cell",
        )
        .slice(0, 1)
        .map((candidate) => candidate.source);
    }
    return [binding];
  });
  const boundSlotIds = new Set(bindings.map((binding) => binding.slotId));
  const unmappedRequiredSlots = slots
    .filter((slot) => slot.required && !boundSlotIds.has(slot.slotId))
    .map((slot) => slot.slotId);
  const status = unmappedRequiredSlots.length === 0 ? "confirmed" : "suggested";
  const mappingSetId = opaque(
    "mapset",
    `${template.templateId}:${workbook.workbookVersionId}:${workbook.structureHash}`,
  );
  const warnings = [
    ...(unmappedRequiredSlots.length > 0
      ? [
          {
            code: "REQUIRED_MAPPING_UNRESOLVED",
            message: `필수 슬롯 ${unmappedRequiredSlots.length}개의 Excel 원본을 확인해야 합니다.`,
          },
        ]
      : []),
    ...(marketPrice?.status === "unavailable"
      ? [
          {
            code: "KRX_MARKET_PRICE_FALLBACK",
            message:
              "KRX 기준일 종가를 조회하지 못해 Excel의 현재주가 값을 대체 원본으로 사용했습니다.",
          },
        ]
      : []),
  ];
  const mappingSet: MappingSet = {
    schemaVersion: "1.0",
    mappingSetId,
    mappingSetVersion: 1,
    templateId: template.templateId,
    templateVersion: template.templateVersion,
    workbookVersionId: workbook.workbookVersionId,
    workbookFileHash: workbook.fileHash,
    workbookStructureHash: workbook.structureHash,
    status,
    bindings,
    candidates,
    unmappedRequiredSlots,
    warnings,
  };
  return {
    mappingSet,
    summary: {
      status: status === "confirmed" ? "confirmed" : "blocked",
      slotCount: slots.length,
      requiredSlotCount: slots.filter((slot) => slot.required).length,
      bindingCount: bindings.length,
      confirmedBindingCount: bindings.filter(
        (binding) => binding.status === "confirmed",
      ).length,
      unmappedRequiredCount: unmappedRequiredSlots.length,
    },
  };
}
