import { createHash } from "node:crypto";
import type {
  TemplateIr,
  TemplateSlot,
  WorkbookAnalysis,
  WorkbookCandidateCell,
  WorkbookCandidateRange,
  WorkbookChartAnalysis,
  WorkbookChartDataReference,
} from "./types";
import type { MarketPriceSnapshot } from "../../server/infrastructure/market-data/krx";
import {
  IGNORED_RANGE_CONTEXT,
  LEGACY_ISC_WORKBOOK_PROFILE,
  MAPPING_RULES,
  METRIC_ALIASES,
} from "./mapping-rules";

export type MappingSource = {
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

export type MappingChartSeries = {
  seriesId: string;
  label?: string;
  source: MappingSource;
  axis: "primary" | "secondary";
  role: "actual" | "forecast" | "target" | "band_upper" | "band_lower" | "benchmark";
  chartType: string;
  estimateType: "actual" | "forecast" | "mixed" | "not_applicable";
};

export type MappingChartDefinition = {
  categories: MappingSource;
  series: MappingChartSeries[];
  chartTypes?: string[];
};

export type MappingCandidate = {
  candidateId: string;
  slotId: string;
  kind: "cell" | "range" | "chart" | "market_data";
  source: MappingSource;
  chartDefinition?: MappingChartDefinition;
  bindingDefinition?: MappingBinding;
  label: string;
  score: number;
  reasonCodes: string[];
  selected: boolean;
};

type ScalarMappingBinding = {
  bindingId: string;
  slotId: string;
  kind: "scalar";
  valueType?: string;
  source: MappingSource;
  verificationSources?: MappingSource[];
  display?: Record<string, unknown>;
  styleTemplateRef?: string;
  status: "suggested" | "confirmed" | "invalid";
  purpose: "workbook_input" | "report_output";
  semanticKey: TemplateSlot["semanticKey"];
  estimateType: "actual" | "forecast" | "mixed" | "not_applicable";
  detectionConfidence: number;
  reasonCodes: string[];
  review: {
    status: "unreviewed" | "approved" | "rejected" | "needs_review";
    reasonCodes: string[];
  };
};

type TableMappingBinding = {
  bindingId: string;
  slotId: string;
  kind: "table";
  source: MappingSource;
  rowKeyColumn: string;
  columnHeaderRow: number;
  expectedRows: number;
  expectedColumns: number;
  subtotalRows?: number[];
  unitRows?: number[];
  display?: Record<string, unknown>;
  styleTemplateRef?: string;
  status: "suggested" | "confirmed" | "invalid";
  purpose: "workbook_input" | "report_output";
  semanticKey: TemplateSlot["semanticKey"];
  estimateType: "actual" | "forecast" | "mixed" | "not_applicable";
  detectionConfidence: number;
  reasonCodes: string[];
  review: {
    status: "unreviewed" | "approved" | "rejected" | "needs_review";
    reasonCodes: string[];
  };
};

type ChartMappingBinding = {
  bindingId: string;
  slotId: string;
  kind: "chart";
  categories: MappingSource;
  series: MappingChartSeries[];
  styleTemplateRef?: string;
  status: "suggested" | "confirmed" | "invalid";
  purpose: "workbook_input" | "report_output";
  semanticKey: TemplateSlot["semanticKey"];
  estimateType: "actual" | "forecast" | "mixed" | "not_applicable";
  detectionConfidence: number;
  reasonCodes: string[];
  review: {
    status: "unreviewed" | "approved" | "rejected" | "needs_review";
    reasonCodes: string[];
  };
};

type CompositeChartMappingBinding = {
  bindingId: string;
  slotId: string;
  kind: "composite_chart";
  categories: MappingSource;
  series: MappingChartSeries[];
  styleTemplateRef: string;
  status: "suggested" | "confirmed" | "invalid";
  purpose: "workbook_input" | "report_output";
  semanticKey: TemplateSlot["semanticKey"];
  detectionConfidence: number;
  reasonCodes: string[];
  review: {
    status: "unreviewed" | "approved" | "rejected" | "needs_review";
    reasonCodes: string[];
  };
};

type MarketDataMappingBinding = {
  bindingId: string;
  slotId: string;
  kind: "market_data";
  purpose: "report_output";
  semanticKey: TemplateSlot["semanticKey"];
  source: MappingSource;
  display: Record<string, unknown>;
  status: "confirmed";
  review: {
    status: "unreviewed";
    reasonCodes: string[];
  };
};

export type MappingBinding =
  | ScalarMappingBinding
  | TableMappingBinding
  | ChartMappingBinding
  | CompositeChartMappingBinding
  | MarketDataMappingBinding;

export type MappingSet = {
  schemaVersion: "1.0";
  mappingSetId: string;
  mappingSetVersion: number;
  templateId: string;
  templateVersion: number;
  workbookVersionId: string;
  workbookFileHash: string;
  workbookStructureHash: string;
  analysisPipelineVersion: string;
  semanticAliasVersion: string;
  scoringRuleVersion: string;
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

function columnName(value: number): string {
  let current = value;
  let result = "";
  while (current > 0) {
    current -= 1;
    result = String.fromCharCode(65 + (current % 26)) + result;
    current = Math.floor(current / 26);
  }
  return result || "A";
}

function parseAddress(value: string): [number, number] {
  const match = /^([A-Z]+)(\d+)$/i.exec(value.replaceAll("$", ""));
  return match ? [columnNumber(match[1]), Number(match[2])] : [0, 0];
}

function normalizedRange(value: string): string | null {
  const cleaned = value.replaceAll("$", "").trim();
  if (/^[A-Za-z]{1,3}[1-9][0-9]*$/.test(cleaned)) {
    return `${cleaned.toUpperCase()}:${cleaned.toUpperCase()}`;
  }
  const match =
    /^([A-Za-z]{1,3}[1-9][0-9]*):([A-Za-z]{1,3}[1-9][0-9]*)$/.exec(
      cleaned,
    );
  return match ? `${match[1].toUpperCase()}:${match[2].toUpperCase()}` : null;
}

function rangeCoordinates(value: string): {
  firstColumn: number;
  firstRow: number;
  lastColumn: number;
  lastRow: number;
} {
  const normalized = normalizedRange(value) ?? "A1:A1";
  const [first, last] = normalized.split(":");
  const [firstColumn, firstRow] = parseAddress(first);
  const [lastColumn, lastRow] = parseAddress(last);
  return { firstColumn, firstRow, lastColumn, lastRow };
}

function rangeDimensions(value: string): { rows: number; columns: number } {
  const range = rangeCoordinates(value);
  return {
    rows: Math.max(1, range.lastRow - range.firstRow + 1),
    columns: Math.max(1, range.lastColumn - range.firstColumn + 1),
  };
}

function rangeLength(value: string): number | null {
  const dimensions = rangeDimensions(value);
  if (dimensions.rows > 1 && dimensions.columns > 1) return null;
  return Math.max(dimensions.rows, dimensions.columns);
}

function containsAddress(range: string, address: string): boolean {
  const outer = rangeCoordinates(range);
  const [column, row] = parseAddress(address);
  return (
    column >= outer.firstColumn &&
    column <= outer.lastColumn &&
    row >= outer.firstRow &&
    row <= outer.lastRow
  );
}

function containsRange(outer: string, inner: string): boolean {
  const range = rangeCoordinates(inner);
  return (
    containsAddress(outer, `${columnName(range.firstColumn)}${range.firstRow}`) &&
    containsAddress(outer, `${columnName(range.lastColumn)}${range.lastRow}`)
  );
}

function aliases(metric: string): string[] {
  const values = METRIC_ALIASES[metric] ?? [metric];
  return [...new Set([metric, ...values].map(normalize).filter(Boolean))];
}

function figureNumber(metric: string): number | null {
  const normalized = normalize(metric);
  const match =
    /(?:figure|chart|도표)(\d+)/.exec(normalized) ??
    /(\d+)(?:figure|chart|도표)/.exec(normalized);
  return match ? Number(match[1]) : null;
}

function figureContextMatches(value: string, figure: number): boolean {
  const normalized = normalize(value);
  return (
    normalized.includes(`도표${figure}`) ||
    normalized.includes(`figure${figure}`) ||
    normalized.includes(`chart${figure}`)
  );
}

function meaningfulTokens(value: string): string[] {
  const ignored = new Set([
    "도표",
    "차트",
    "그래프",
    "추이",
    "전망",
    "figure",
    "chart",
    "graph",
    "trend",
    "outlook",
    "isc",
    "vs",
  ]);
  return [
    ...new Set(
      value
        .normalize("NFKC")
        .toLowerCase()
        .split(/[\s/_·:()[\],.-]+/)
        .map(normalize)
        .filter((token) => token.length >= 2 && !ignored.has(token)),
    ),
  ];
}

function ignoredContext(value: string): boolean {
  const normalized = normalize(value);
  return IGNORED_RANGE_CONTEXT.some((token) =>
    normalized.includes(normalize(token)),
  );
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
    range: normalizedRange(range.range) ?? range.range,
    authority: "authoritative",
    structureFingerprint: range.structureFingerprint,
  };
}

function derivedRangeSource(
  sheet: WorkbookAnalysis["sheets"][number],
  range: string,
  seed: string,
): MappingSource {
  return {
    sheetId: sheet.sheetId,
    sheet: sheet.name,
    range,
    authority: "authoritative",
    structureFingerprint: hash(`${sheet.structureHash}:${range}:${seed}`),
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
  const hints =
    LEGACY_ISC_WORKBOOK_PROFILE.cellHints[slot.semanticKey.metric] ?? [];
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
    fixed.map(
      (candidate) => `${candidate.source.sheet}!${candidate.source.address}`,
    ),
  );
  const ranked = workbook.candidateCells
    .map((cell) => ({ cell, ...candidateScore(slot, cell) }))
    .filter(({ score }) => score >= MAPPING_RULES.scalar.candidateMinimum)
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.cell.candidateId.localeCompare(right.cell.candidateId),
    )
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
    (left, right) =>
      right.score - left.score ||
      left.candidateId.localeCompare(right.candidateId),
  );
  const top = candidates[0];
  const next = candidates[1];
  const unambiguous =
    top &&
    (top.reasonCodes.includes("DOCUMENTED_MODEL_CONTRACT") ||
      (top.score >= MAPPING_RULES.scalar.modelPeriodMinimum &&
        top.reasonCodes.includes("MODEL_SHEET") &&
        top.reasonCodes.includes("PERIOD_MATCH")) ||
      (top.score >= MAPPING_RULES.scalar.automaticMinimum &&
        (!next ||
          top.score - next.score >= MAPPING_RULES.scalar.automaticMargin)));
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
  const normalized = normalizedRange(rangeValue);
  if (!sheet || !normalized || !containsRange(sheet.usedRange, normalized)) {
    return null;
  }
  const existing = workbook.candidateRanges.find(
    (range) =>
      range.sheetId === sheet.sheetId &&
      normalizedRange(range.range) === normalized,
  );
  if (existing) return existing;
  const dimensions = rangeDimensions(normalized);
  return {
    candidateId: opaque("range", `${sheet.sheetId}:${normalized}`),
    sheetId: sheet.sheetId,
    sheetName,
    range: normalized,
    label: `${sheetName} ${normalized}`,
    rowCount: dimensions.rows,
    columnCount: dimensions.columns,
    structureFingerprint: hash(
      `${sheet.structureHash}:${normalized}:${dimensions.rows}:${dimensions.columns}`,
    ),
  };
}

function rangeMatch(
  slot: TemplateSlot,
  range: WorkbookCandidateRange,
): { score: number; reasons: string[] } {
  const context = normalize(
    `${range.sheetName} ${range.label} ${(range.headerValues ?? []).join(" ")}`,
  );
  if (ignoredContext(`${range.label} ${(range.headerValues ?? []).join(" ")}`)) {
    return { score: 0, reasons: ["NON_REPORT_RANGE"] };
  }
  const targetAliases = aliases(slot.semanticKey.metric);
  const exact = targetAliases.some(
    (alias) => alias && (context.includes(alias) || alias.includes(context)),
  );
  const scope = normalize(slot.semanticKey.scope ?? "");
  const scopeMatch = Boolean(scope && context.includes(scope));
  let score = exact ? 0.84 : 0.24;
  const reasons = exact ? ["RANGE_CONTEXT_MATCH"] : ["SHEET_RANGE"];
  if (scopeMatch) {
    score += 0.1;
    reasons.push("SCOPE_MATCH");
  }
  if (range.kind === "dense_region" || range.kind === "excel_table") {
    score += 0.04;
    reasons.push("STRUCTURED_RANGE");
  }
  return { score: Math.min(0.98, score), reasons };
}

function tableCandidates(
  slot: TemplateSlot,
  workbook: WorkbookAnalysis,
): MappingCandidate[] {
  const fixed = (
    LEGACY_ISC_WORKBOOK_PROFILE.rangeHints[slot.semanticKey.metric] ?? []
  )
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
  const fixedIds = new Set(
    fixed.map(
      (candidate) => `${candidate.source.sheet}!${candidate.source.range}`,
    ),
  );
  const ranked = workbook.candidateRanges
    .map((range) => ({ range, ...rangeMatch(slot, range) }))
    .filter(({ score }) => score >= MAPPING_RULES.table.candidateMinimum)
    .filter(
      ({ range }) =>
        !fixedIds.has(
          `${range.sheetName}!${normalizedRange(range.range) ?? range.range}`,
        ),
    )
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.range.candidateId.localeCompare(right.range.candidateId),
    )
    .slice(0, Math.max(0, 5 - fixed.length))
    .map(({ range, score, reasons }) => ({
      candidateId: opaque("mapcand", `${slot.slotId}:${range.candidateId}`),
      slotId: slot.slotId,
      kind: "range" as const,
      source: rangeSource(range),
      label: range.label,
      score: Number(score.toFixed(4)),
      reasonCodes: reasons,
      selected: false,
    }));
  const candidates = [...fixed, ...ranked].sort(
    (left, right) =>
      right.score - left.score ||
      left.candidateId.localeCompare(right.candidateId),
  );
  const top = candidates[0];
  const next = candidates[1];
  const unambiguous =
    top &&
    (top.reasonCodes.includes("DOCUMENTED_MODEL_CONTRACT") ||
      (top.score >= MAPPING_RULES.table.automaticMinimum &&
        (!next ||
          top.score - next.score >= MAPPING_RULES.table.automaticMargin)));
  return candidates.map((candidate, index) => ({
    ...candidate,
    selected: Boolean(unambiguous && index === 0),
  }));
}

function sourceFromChartReference(
  workbook: WorkbookAnalysis,
  reference: WorkbookChartDataReference,
  fallbackSheet: WorkbookAnalysis["sheets"][number],
  seed: string,
): { source: MappingSource; length: number } | null {
  const sheet =
    workbook.sheets.find(
      (item) =>
        (reference.sheetId && item.sheetId === reference.sheetId) ||
        (reference.sheetName && item.name === reference.sheetName),
    ) ?? fallbackSheet;
  const range = reference.range ? normalizedRange(reference.range) : null;
  if (!range || !containsRange(sheet.usedRange, range)) return null;
  const length = rangeLength(range);
  if (
    length == null ||
    length < 2 ||
    (reference.pointCount > 0 && reference.pointCount !== length)
  ) {
    return null;
  }
  return {
    source: derivedRangeSource(sheet, range, seed),
    length,
  };
}

function sameRange(left: MappingSource, right: MappingSource): boolean {
  return (
    left.sheetId === right.sheetId &&
    left.sheet === right.sheet &&
    left.range === right.range
  );
}

function explicitChartDefinition(
  workbook: WorkbookAnalysis,
  chart: WorkbookChartAnalysis,
): MappingChartDefinition | null {
  const fallbackSheet = workbook.sheets.find(
    (sheet) => sheet.sheetId === chart.sheetId || sheet.name === chart.sheetName,
  );
  if (!fallbackSheet) return null;
  const categoryReference =
    chart.category ??
    chart.series.find((series) => series.category)?.category ??
    null;
  if (!categoryReference) return null;
  const categories = sourceFromChartReference(
    workbook,
    categoryReference,
    fallbackSheet,
    `${chart.structureFingerprint}:categories`,
  );
  if (!categories) return null;
  const series = chart.series.flatMap((item) => {
    if (!item.values) return [];
    const values = sourceFromChartReference(
      workbook,
      item.values,
      fallbackSheet,
      `${chart.structureFingerprint}:series:${item.seriesId}`,
    );
    if (!values || values.length !== categories.length) return [];
    if (item.category) {
      const itemCategories = sourceFromChartReference(
        workbook,
        item.category,
        fallbackSheet,
        `${chart.structureFingerprint}:series:${item.seriesId}:categories`,
      );
      if (
        !itemCategories ||
        itemCategories.length !== categories.length ||
        !sameRange(itemCategories.source, categories.source)
      ) {
        return [];
      }
    }
    return [
      {
        seriesId: item.seriesId,
        ...(item.name ? { label: item.name.slice(0, 500) } : {}),
        source: values.source,
        axis: item.axis,
        role: "actual" as const,
        chartType: item.chartType,
        estimateType: "mixed" as const,
      },
    ];
  });
  if (series.length === 0 || series.length !== chart.series.length) return null;
  return {
    categories: categories.source,
    series,
    chartTypes: [...new Set(chart.chartTypes)],
  };
}

function chartContextScore(
  slot: TemplateSlot,
  context: string,
  explicit: boolean,
): { score: number; reasons: string[] } {
  const normalizedContext = normalize(context);
  const reasons: string[] = [];
  let score = explicit ? 0.12 : 0.08;
  if (explicit) reasons.push("EMBEDDED_CHART_DEFINITION");
  const figure = figureNumber(slot.semanticKey.metric);
  if (figure != null && figureContextMatches(context, figure)) {
    score += 0.56;
    reasons.push("FIGURE_NUMBER_MATCH");
  }
  const targetAliases = aliases(slot.semanticKey.metric);
  if (
    targetAliases.some(
      (alias) => alias && normalizedContext.includes(alias),
    )
  ) {
    score += 0.22;
    reasons.push("CHART_CONTEXT_MATCH");
  }
  const scope = slot.semanticKey.scope ?? "";
  const normalizedScope = normalize(scope);
  if (normalizedScope && normalizedContext.includes(normalizedScope)) {
    score += 0.28;
    reasons.push("SCOPE_MATCH");
  } else {
    const tokens = meaningfulTokens(scope);
    const matches = tokens.filter((token) => normalizedContext.includes(token));
    if (tokens.length > 0 && matches.length > 0) {
      score += 0.24 * (matches.length / tokens.length);
      reasons.push("SCOPE_TOKEN_MATCH");
    }
  }
  return { score: Math.min(0.99, score), reasons };
}

function selectChartCandidate(
  candidates: MappingCandidate[],
): MappingCandidate[] {
  const ordered = [...candidates].sort(
    (left, right) =>
      right.score - left.score ||
      left.candidateId.localeCompare(right.candidateId),
  );
  const top = ordered[0];
  const next = ordered[1];
  const unambiguous =
    top &&
    top.score >= MAPPING_RULES.chart.automaticMinimum &&
    (!next || top.score - next.score >= MAPPING_RULES.chart.automaticMargin);
  return ordered.map((candidate, index) => ({
    ...candidate,
    selected: Boolean(unambiguous && index === 0),
  }));
}

function explicitChartCandidates(
  slot: TemplateSlot,
  workbook: WorkbookAnalysis,
): MappingCandidate[] {
  const candidates = (workbook.charts ?? []).flatMap((chart) => {
    const definition = explicitChartDefinition(workbook, chart);
    if (!definition) return [];
    const context = `${chart.sheetName} ${chart.title} ${chart.chartTypes.join(
      " ",
    )} ${chart.series.map((series) => series.name).join(" ")}`;
    const scored = chartContextScore(slot, context, true);
    if (scored.score < MAPPING_RULES.chart.candidateMinimum) return [];
    return [
      {
        candidateId: opaque("mapcand", `${slot.slotId}:${chart.chartId}`),
        slotId: slot.slotId,
        kind: "chart" as const,
        source: definition.categories,
        chartDefinition: definition,
        label: chart.title || `${chart.sheetName} 차트`,
        score: Number(scored.score.toFixed(4)),
        reasonCodes: scored.reasons,
        selected: false,
      },
    ];
  });
  return selectChartCandidate(candidates).slice(0, 5);
}

function cellIndex(
  workbook: WorkbookAnalysis,
  sheetId: string,
): Map<string, WorkbookCandidateCell> {
  return new Map(
    workbook.candidateCells
      .filter((cell) => cell.sheetId === sheetId)
      .map((cell) => [cell.address.toUpperCase(), cell]),
  );
}

function cellText(cell: WorkbookCandidateCell | undefined): string {
  if (!cell) return "";
  if (typeof cell.rawValue === "string") return cell.rawValue.trim();
  return cell.displayValue.trim();
}

function numericCell(cell: WorkbookCandidateCell | undefined): boolean {
  if (!cell) return false;
  if (typeof cell.rawValue === "number") return Number.isFinite(cell.rawValue);
  if (cell.valueType === "decimal") {
    const parsed = Number(String(cell.rawValue ?? cell.displayValue).replaceAll(",", ""));
    return Number.isFinite(parsed);
  }
  return false;
}

function contiguous(values: number[]): boolean {
  return values.every((value, index) => index === 0 || value === values[index - 1] + 1);
}

function denseChartDefinition(
  workbook: WorkbookAnalysis,
  range: WorkbookCandidateRange,
): MappingChartDefinition | null {
  const sourceRange = normalizedRange(range.range);
  const sheet = workbook.sheets.find((item) => item.sheetId === range.sheetId);
  if (!sourceRange || !sheet) return null;
  const coordinates = rangeCoordinates(sourceRange);
  const cells = cellIndex(workbook, range.sheetId);
  const headerRows = (range.headerRows ?? [])
    .filter(
      (row) => row >= coordinates.firstRow && row <= coordinates.lastRow,
    )
    .sort((left, right) => left - right);
  const headerRow = headerRows.at(-1) ?? coordinates.firstRow;
  const rowKeyColumn = range.rowKeyColumns?.[0]?.column
    ? columnNumber(range.rowKeyColumns[0].column)
    : coordinates.firstColumn;
  if (
    rowKeyColumn < coordinates.firstColumn ||
    rowKeyColumn > coordinates.lastColumn ||
    headerRow >= coordinates.lastRow
  ) {
    return null;
  }

  const periodColumnNumbers = [...new Set(
    (range.periodColumns ?? [])
      .map((period) => columnNumber(period.column))
      .filter(
        (column) =>
          column >= coordinates.firstColumn &&
          column <= coordinates.lastColumn,
      ),
  )].sort((left, right) => left - right);

  if (periodColumnNumbers.length >= 2 && contiguous(periodColumnNumbers)) {
    const firstPeriodColumn = periodColumnNumbers[0];
    const lastPeriodColumn = periodColumnNumbers.at(-1)!;
    const categoryValues = periodColumnNumbers.map((column) =>
      cellText(cells.get(`${columnName(column)}${headerRow}`)),
    );
    if (categoryValues.some((value) => !value)) return null;
    const chartSeries: MappingChartSeries[] = [];
    for (let row = headerRow + 1; row <= coordinates.lastRow; row += 1) {
      const label = cellText(cells.get(`${columnName(rowKeyColumn)}${row}`));
      if (!label || ignoredContext(label)) continue;
      const populated = periodColumnNumbers.filter((column) =>
        numericCell(cells.get(`${columnName(column)}${row}`)),
      ).length;
      if (
        populated < 2 ||
        populated / periodColumnNumbers.length < 0.6
      ) {
        continue;
      }
      const seriesRange = `${columnName(firstPeriodColumn)}${row}:${columnName(
        lastPeriodColumn,
      )}${row}`;
      chartSeries.push({
        seriesId: opaque(
          "series",
          `${range.candidateId}:${row}:${seriesRange}`,
        ),
        label: label.slice(0, 500),
        source: derivedRangeSource(
          sheet,
          seriesRange,
          `${range.structureFingerprint}:series:${row}`,
        ),
        axis: "primary",
        role: "actual",
        chartType: "line",
        estimateType: "mixed",
      });
    }
    if (chartSeries.length === 0) return null;
    const categoriesRange = `${columnName(firstPeriodColumn)}${headerRow}:${columnName(
      lastPeriodColumn,
    )}${headerRow}`;
    return {
      categories: derivedRangeSource(
        sheet,
        categoriesRange,
        `${range.structureFingerprint}:categories`,
      ),
      series: chartSeries,
    };
  }

  const seriesColumns: number[] = [];
  for (
    let column = coordinates.firstColumn;
    column <= coordinates.lastColumn;
    column += 1
  ) {
    if (column === rowKeyColumn) continue;
    const label =
      cellText(cells.get(`${columnName(column)}${headerRow}`)) ||
      range.headerValues?.[column - coordinates.firstColumn] ||
      "";
    if (!label || ignoredContext(label)) continue;
    let numericCount = 0;
    for (let row = headerRow + 1; row <= coordinates.lastRow; row += 1) {
      if (numericCell(cells.get(`${columnName(column)}${row}`))) numericCount += 1;
    }
    if (numericCount >= 2) seriesColumns.push(column);
  }
  if (seriesColumns.length === 0) return null;
  const dataRows: number[] = [];
  for (let row = headerRow + 1; row <= coordinates.lastRow; row += 1) {
    const category = cellText(cells.get(`${columnName(rowKeyColumn)}${row}`));
    const numericCount = seriesColumns.filter((column) =>
      numericCell(cells.get(`${columnName(column)}${row}`)),
    ).length;
    if (category && numericCount > 0) dataRows.push(row);
  }
  if (
    dataRows.length < 2 ||
    !contiguous(dataRows) ||
    dataRows[0] !== headerRow + 1
  ) {
    return null;
  }
  const firstDataRow = dataRows[0];
  const lastDataRow = dataRows.at(-1)!;
  const chartSeries = seriesColumns.flatMap((column) => {
    const populated = dataRows.filter((row) =>
      numericCell(cells.get(`${columnName(column)}${row}`)),
    ).length;
    if (populated / dataRows.length < 0.8) return [];
    const label =
      cellText(cells.get(`${columnName(column)}${headerRow}`)) ||
      range.headerValues?.[column - coordinates.firstColumn] ||
      columnName(column);
    const seriesRange = `${columnName(column)}${firstDataRow}:${columnName(
      column,
    )}${lastDataRow}`;
    return [
      {
        seriesId: opaque(
          "series",
          `${range.candidateId}:${column}:${seriesRange}`,
        ),
        label: label.slice(0, 500),
        source: derivedRangeSource(
          sheet,
          seriesRange,
          `${range.structureFingerprint}:series:${column}`,
        ),
        axis: "primary" as const,
        role: "actual" as const,
        chartType: "line",
        estimateType: "mixed" as const,
      },
    ];
  });
  if (chartSeries.length === 0) return null;
  const categoriesRange = `${columnName(rowKeyColumn)}${firstDataRow}:${columnName(
    rowKeyColumn,
  )}${lastDataRow}`;
  return {
    categories: derivedRangeSource(
      sheet,
      categoriesRange,
      `${range.structureFingerprint}:categories`,
    ),
    series: chartSeries,
  };
}

function denseChartCandidates(
  slot: TemplateSlot,
  workbook: WorkbookAnalysis,
): MappingCandidate[] {
  const slotContext = normalize(
    `${slot.semanticKey.metric} ${slot.semanticKey.scope ?? ""}`,
  );
  const bandChart =
    [2, 3].includes(figureNumber(slot.semanticKey.metric) ?? -1) ||
    slotContext.includes("band") ||
    slotContext.includes("밴드");
  const candidates = workbook.candidateRanges.flatMap((range) => {
    if (
      !["dense_region", "excel_table"].includes(range.kind ?? "") ||
      ignoredContext(`${range.label} ${(range.headerValues ?? []).join(" ")}`)
    ) {
      return [];
    }
    const definition = denseChartDefinition(workbook, range);
    if (!definition) return [];
    if (bandChart) {
      const periodCount = range.periodColumns?.length ?? 0;
      const pointCount = rangeLength(definition.categories.range ?? "");
      const labels = definition.series.map((series) =>
        normalize(series.label ?? ""),
      );
      const hasPriceSeries = labels.some(
        (label) => label.includes("주가") || label.includes("price"),
      );
      const hasBandSeries = labels.some(
        (label) =>
          label.includes("band") ||
          label.includes("밴드") ||
          label.includes("per") ||
          label.includes("pbr") ||
          label.includes("배수") ||
          label.includes("x"),
      );
      if (
        periodCount < 4 ||
        pointCount == null ||
        pointCount < 4 ||
        definition.series.length < 2 ||
        !hasPriceSeries ||
        !hasBandSeries
      ) {
        return [];
      }
    }
    const context = `${range.sheetName} ${range.label} ${(range.headerValues ?? []).join(
      " ",
    )}`;
    const scored = chartContextScore(slot, context, false);
    if (scored.score < MAPPING_RULES.chart.candidateMinimum) return [];
    return [
      {
        candidateId: opaque("mapcand", `${slot.slotId}:${range.candidateId}`),
        slotId: slot.slotId,
        kind: "chart" as const,
        source: definition.categories,
        chartDefinition: definition,
        label: range.label || `${range.sheetName} ${range.range}`,
        score: Number(scored.score.toFixed(4)),
        reasonCodes: [
          ...scored.reasons,
          "DENSE_RANGE_TOPOLOGY",
          "CATEGORY_SERIES_LENGTH_VALIDATED",
        ],
        selected: false,
      },
    ];
  });
  return selectChartCandidate(candidates).slice(0, 5);
}

function chartCandidates(
  slot: TemplateSlot,
  workbook: WorkbookAnalysis,
): MappingCandidate[] {
  const explicit = explicitChartCandidates(slot, workbook);
  if (explicit.length > 0) return explicit;
  return denseChartCandidates(slot, workbook);
}

function bindingFor(
  slot: TemplateSlot,
  candidate: MappingCandidate,
  workbook: WorkbookAnalysis,
): MappingBinding {
  if (candidate.kind === "market_data") {
    return {
      bindingId: opaque("binding", `${slot.slotId}:${candidate.candidateId}`),
      slotId: slot.slotId,
      kind: "market_data",
      purpose: "report_output",
      semanticKey: slot.semanticKey,
      source: candidate.source,
      display: {},
      status: "confirmed",
      review: {
        status: "unreviewed",
        reasonCodes: candidate.reasonCodes,
      },
    };
  }
  if (slot.valueType === "chart") {
    if (
      candidate.kind !== "chart" ||
      !candidate.chartDefinition ||
      candidate.chartDefinition.series.length === 0
    ) {
      throw new Error(`Chart candidate ${candidate.candidateId} has no definition.`);
    }
    const series = candidate.chartDefinition.series.map((item) => ({
      ...item,
    }));
    const composite =
      Boolean(slot.styleRef) &&
      series.length >= 2 &&
      (series.some((item) => item.axis === "secondary") ||
        new Set(series.map((item) => item.chartType)).size > 1);
    if (composite) {
      return {
        bindingId: opaque("binding", `${slot.slotId}:${candidate.candidateId}`),
        slotId: slot.slotId,
        kind: "composite_chart",
        categories: candidate.chartDefinition.categories,
        series,
        styleTemplateRef: slot.styleRef!,
        status: "confirmed",
        purpose: "report_output",
        semanticKey: slot.semanticKey,
        detectionConfidence: candidate.score,
        reasonCodes: [
          ...new Set([...candidate.reasonCodes, "COMPOSITE_AXIS_MATCH"]),
        ],
        review: {
          status: "unreviewed",
          reasonCodes: candidate.reasonCodes,
        },
      };
    }
    return {
      bindingId: opaque("binding", `${slot.slotId}:${candidate.candidateId}`),
      slotId: slot.slotId,
      kind: "chart",
      categories: candidate.chartDefinition.categories,
      series,
      ...(slot.styleRef ? { styleTemplateRef: slot.styleRef } : {}),
      status: "confirmed",
      purpose: "report_output",
      semanticKey: slot.semanticKey,
      estimateType: "mixed",
      detectionConfidence: candidate.score,
      reasonCodes: candidate.reasonCodes,
      review: {
        status: "unreviewed",
        reasonCodes: candidate.reasonCodes,
      },
    };
  }
  if (slot.valueType === "table") {
    const sourceRange = candidate.source.range ?? "A1:A1";
    const dimensions = rangeDimensions(sourceRange);
    const topology = workbook.candidateRanges.find(
      (range) =>
        range.sheetId === candidate.source.sheetId &&
        normalizedRange(range.range) === normalizedRange(sourceRange),
    );
    const first = rangeCoordinates(sourceRange);
    return {
      bindingId: opaque("binding", `${slot.slotId}:${candidate.candidateId}`),
      slotId: slot.slotId,
      kind: "table",
      source: candidate.source,
      rowKeyColumn:
        topology?.rowKeyColumns?.[0]?.column ?? columnName(first.firstColumn),
      columnHeaderRow:
        topology?.headerRows?.at(-1) ?? first.firstRow,
      expectedRows: dimensions.rows,
      expectedColumns: dimensions.columns,
      subtotalRows: topology?.subtotalRows ?? [],
      unitRows: [],
      display: {},
      ...(slot.styleRef ? { styleTemplateRef: slot.styleRef } : {}),
      status: "confirmed",
      purpose: "report_output",
      semanticKey: slot.semanticKey,
      estimateType: "mixed",
      detectionConfidence: candidate.score,
      reasonCodes: candidate.reasonCodes,
      review: {
        status: "unreviewed",
        reasonCodes: candidate.reasonCodes,
      },
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
    ...(slot.styleRef ? { styleTemplateRef: slot.styleRef } : {}),
    status: "confirmed",
    purpose: "report_output",
    semanticKey: slot.semanticKey,
    estimateType: "not_applicable",
    detectionConfidence: candidate.score,
    reasonCodes: candidate.reasonCodes,
    review: {
      status: "unreviewed",
      reasonCodes: candidate.reasonCodes,
    },
  };
}

export function buildMappingSet(
  template: TemplateIr,
  workbook: WorkbookAnalysis,
  marketPrice?: MarketPriceSnapshot,
): { mappingSet: MappingSet; summary: MappingSummary } {
  const slots = template.pages.flatMap((page) => page.slots);
  const candidateSeeds = slots.flatMap((slot) => {
    if (slot.valueType === "table") return tableCandidates(slot, workbook);
    if (slot.valueType === "chart") return chartCandidates(slot, workbook);
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
  const slotById = new Map(slots.map((slot) => [slot.slotId, slot]));
  const candidates = candidateSeeds.map((candidate) => {
    const slot = slotById.get(candidate.slotId);
    if (!slot) return candidate;
    return {
      ...candidate,
      bindingDefinition: bindingFor(slot, candidate, workbook),
    };
  });
  const bindings = slots.flatMap((slot) => {
    const selected = candidates.find(
      (candidate) => candidate.slotId === slot.slotId && candidate.selected,
    );
    if (!selected) return [];
    return [
      selected.bindingDefinition ?? bindingFor(slot, selected, workbook),
    ];
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
    analysisPipelineVersion: MAPPING_RULES.analysisPipelineVersion,
    semanticAliasVersion: MAPPING_RULES.semanticAliasVersion,
    scoringRuleVersion: MAPPING_RULES.scoringRuleVersion,
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
