import { contentHash } from "./hash";

export type ReportTemplateSlot = {
  slotId: string;
  blockId: string;
  valueType: string;
  required: boolean;
  maxLength?: number;
  semanticKey?: {
    metric?: string;
    period?: string;
    unit?: string;
    scope?: string;
  };
  targetObjectIds?: string[];
};

export type ReportTemplateObject = {
  objectId: string;
  type: string;
  role?: string;
  bbox?: number[];
  zOrder?: number;
  styleRef?: string;
  sourceLocator?: Record<string, unknown>;
  textRun?: {
    text?: string;
    fontSize?: number;
    fontRef?: string;
    fillColor?: {
      colorSpace?: string;
      components?: number[];
    };
    lineHeight?: number;
    alignment?: string;
  };
};

export type ReportTemplatePage = {
  pageId: string;
  pageNumber: number;
  rotation?: number;
  boxes?: { mediaBox?: number[] };
  blocks?: Array<{
    blockId: string;
    role: string;
    bbox?: number[];
    objectIds?: string[];
    generationRule?: string;
  }>;
  slots?: ReportTemplateSlot[];
  objects?: ReportTemplateObject[];
};

export type OutlineTitle = {
  blockId: string;
  value: string;
  sourceText: string;
  maxLength: number;
  evidenceIds: string[];
  bbox: [number, number, number, number] | null;
  sourceObjectIds: string[];
};

export type OutlineNarrativeBlock = {
  blockId: string;
  order: number;
  subtitle: string;
  summary: string;
  sourceHeading: string;
  sourceText: string;
  maxLength: number;
  evidenceIds: string[];
  subtitleBbox: [number, number, number, number] | null;
  bodyBbox: [number, number, number, number] | null;
  bodyRegions?: Array<[number, number, number, number]>;
  subtitleObjectIds: string[];
  bodyObjectIds: string[];
  uncoveredBodyObjectIds?: string[];
};

export type OutlineChange = {
  pageId: string;
  blockId: string;
  field: "value" | "subtitle" | "summary";
  value: string;
};

export type OutlineVisualSlot = {
  slotId: string;
  blockId: string;
  kind: "표" | "차트" | "수치";
  label: string;
  metric: string;
  required: boolean;
  bindingStatus: "confirmed" | "unmapped" | "invalid";
  sourceLabel?: string | null;
  sourceAddress?: string | null;
  sourceType?: string | null;
};

export type ReportMappingBinding = {
  slotId: string;
  metric: string;
  kind: "scalar" | "table" | "chart";
  status: "confirmed" | "suggested" | "unmapped" | "invalid";
  sourceLabel: string | null;
  sourceAddress: string | null;
  sourceType: string | null;
  sourceSheetId?: string | null;
  sourceSheetName?: string | null;
  definition?: ReportBindingDefinition | null;
};

export type ReportChartType = "line" | "bar" | "area" | "combo";

export type ReportRangeSource = {
  sheetId: string;
  sheetName: string;
  address: string;
  structureFingerprint: string | null;
};

export type ReportTableBindingDefinition = {
  kind: "table";
  source: ReportRangeSource;
  rowKeyColumn: string;
  columnHeaderRow: number;
  expectedRows: number;
  expectedColumns: number;
};

export type ReportChartBindingDefinition = {
  kind: "chart";
  categories: ReportRangeSource;
  series: Array<{
    seriesId: string;
    label: string | null;
    source: ReportRangeSource;
  }>;
};

export type ReportBindingDefinition =
  | ReportTableBindingDefinition
  | ReportChartBindingDefinition;

export type ReportWorkbookCell = {
  address: string;
  row: number;
  column: number;
  valueType: string;
  rawValue: string | null;
  formattedText: string;
  formula: string | null;
  numberFormat: string;
};

export type ReportWorkbookReadModel = {
  schemaVersion: string;
  workbookHash: string;
  sheets: Array<{
    sheetId: string;
    name: string;
    cells: ReportWorkbookCell[];
  }>;
};

export type ReportMaterializationContext = {
  mappingSetResourceVersionId: string;
  workbookArtifactId: string;
  workbookVersion: number;
  readModel: ReportWorkbookReadModel | null;
};

export type ReportMaterializedCell = {
  address: string;
  row: number;
  column: number;
  valueType: string;
  rawValue: string | null;
  formattedText: string;
  formula: string | null;
  numberFormat: string;
};

export type ReportMaterializationProvenance = {
  mappingSetResourceVersionId: string;
  workbookArtifactId: string;
  workbookVersion: number;
  workbookHash: string | null;
  slotId: string;
  sources: Array<{
    role: "table" | "category" | "series";
    seriesId: string | null;
    label: string | null;
    sheetId: string;
    sheetName: string;
    address: string;
    structureFingerprint: string | null;
  }>;
};

type ReportMaterializationState = {
  status: "ready" | "blocked";
  blockerCode: string | null;
  provenance: ReportMaterializationProvenance;
};

export type ReportTableSnapshot = ReportMaterializationState & {
  kind: "table";
  headerRow: number | null;
  columns: Array<{
    column: number;
    address: string;
    label: string;
  }>;
  headers: ReportMaterializedCell[];
  rows: Array<{
    rowNumber: number;
    rowKey: string | null;
    cells: ReportMaterializedCell[];
  }>;
};

export type ReportChartSnapshot = ReportMaterializationState & {
  kind: "chart";
  supportedChartTypes: ReportChartType[];
  categories: ReportMaterializedCell[];
  series: Array<{
    seriesId: string;
    label: string;
    values: ReportMaterializedCell[];
  }>;
};

export type ReportFixedVisualSnapshot = {
  kind: "fixed_visual";
  status: "ready";
  blockerCode: null;
  provenance: null;
};

export type ReportMaterializedData =
  | ReportTableSnapshot
  | ReportChartSnapshot
  | ReportFixedVisualSnapshot;

export type ReportMaterializationsBySlotId = Record<
  string,
  ReportTableSnapshot | ReportChartSnapshot
>;

export type OutlinePage = {
  pageId: string;
  pageNumber: number;
  pageLabel: string;
  role: string;
  editable: boolean;
  widthPt: number;
  heightPt: number;
  rotation: number;
  recommendedTitle: OutlineTitle | null;
  narrativeBlocks: OutlineNarrativeBlock[];
  visualSlots: OutlineVisualSlot[];
  evidenceIds: string[];
};

export type OutlineContent = {
  schemaVersion: "2.0";
  generationSource: "ai" | "fallback";
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
  templateBlockId: string | null;
  bbox: [number, number, number, number] | null;
  regions?: Array<[number, number, number, number]>;
  sourceObjectIds: string[];
  sourceCoverage?: "complete" | "review_required";
  uncoveredSourceObjectIds?: string[];
  dataBinding?: {
    slotId?: string;
    metric: string;
    kind: "scalar" | "table" | "chart";
    status: "confirmed" | "suggested" | "unmapped" | "invalid";
    sourceLabel: string | null;
    sourceAddress: string | null;
    sourceType: string | null;
  } | null;
  materializedData?: ReportMaterializedData;
  chartType?: ReportChartType;
  patchStrategy:
    | "fixed"
    | "operator_replace"
    | "block_vector_replace"
    | "region_background_patch";
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
  mappingBindings?: ReportMappingBinding[];
};

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
    key_data: "핵심 데이터",
    consensus_data: "컨센서스 데이터",
    stock_price: "주가 추이",
    financial_data: "재무 데이터",
  };
  return labels[metric] ?? metric.replaceAll("_", " ");
}

type TemplateTextRun = {
  objectId: string;
  text: string;
  fontSize: number;
  bbox: number[];
  zOrder: number;
};

type PdfRect = [number, number, number, number];

function pdfRect(value: number[] | undefined): PdfRect | null {
  if (!value || value.length < 4) return null;
  const rect = value.slice(0, 4).map(Number);
  if (
    rect.some((item) => !Number.isFinite(item)) ||
    rect[2] <= rect[0] ||
    rect[3] <= rect[1]
  ) {
    return null;
  }
  return rect as PdfRect;
}

function unionRects(values: Array<number[] | undefined>): PdfRect | null {
  const rects = values.map(pdfRect).filter((value): value is PdfRect => Boolean(value));
  if (rects.length === 0) return null;
  return [
    Math.min(...rects.map((rect) => rect[0])),
    Math.min(...rects.map((rect) => rect[1])),
    Math.max(...rects.map((rect) => rect[2])),
    Math.max(...rects.map((rect) => rect[3])),
  ];
}

function templateTextRuns(page: ReportTemplatePage): TemplateTextRun[] {
  return (page.objects ?? [])
    .filter(
      (object): object is ReportTemplateObject & {
        textRun: { text: string; fontSize?: number };
      } =>
        object.type === "text_run" &&
        typeof object.textRun?.text === "string" &&
        Boolean(object.textRun.text.trim()),
    )
    .map((object) => ({
      objectId: object.objectId,
      text: object.textRun.text.trim(),
      fontSize: Number(object.textRun.fontSize ?? 0),
      bbox: object.bbox ?? [0, 0, 0, 0],
      zOrder: Number(object.zOrder ?? 0),
    }))
    .sort(
      (left, right) =>
        Number(left.bbox[1] ?? 0) - Number(right.bbox[1] ?? 0) ||
        Number(left.bbox[0] ?? 0) - Number(right.bbox[0] ?? 0) ||
        left.zOrder - right.zOrder,
    );
}

type ParsedCellRange = {
  startRow: number;
  endRow: number;
  startColumn: number;
  endColumn: number;
};

function columnNumber(value: string): number {
  return [...value.toUpperCase()].reduce(
    (result, character) => result * 26 + character.charCodeAt(0) - 64,
    0,
  );
}

function columnLabel(value: number): string {
  let remaining = value;
  let result = "";
  while (remaining > 0) {
    const offset = (remaining - 1) % 26;
    result = String.fromCharCode(65 + offset) + result;
    remaining = Math.floor((remaining - 1) / 26);
  }
  return result;
}

function parseCellRange(value: string): ParsedCellRange | null {
  const normalized = value.replace(/\$/g, "").trim();
  const match = normalized.match(
    /^([A-Za-z]{1,3})([1-9]\d*)(?::([A-Za-z]{1,3})([1-9]\d*))?$/,
  );
  if (!match) return null;
  const firstColumn = columnNumber(match[1]);
  const firstRow = Number(match[2]);
  const secondColumn = columnNumber(match[3] ?? match[1]);
  const secondRow = Number(match[4] ?? match[2]);
  return {
    startRow: Math.min(firstRow, secondRow),
    endRow: Math.max(firstRow, secondRow),
    startColumn: Math.min(firstColumn, secondColumn),
    endColumn: Math.max(firstColumn, secondColumn),
  };
}

function materializedCell(
  cell: ReportWorkbookCell | undefined,
  row: number,
  column: number,
): ReportMaterializedCell {
  return cell
    ? {
        address: cell.address,
        row: cell.row,
        column: cell.column,
        valueType: cell.valueType,
        rawValue: cell.rawValue,
        formattedText: cell.formattedText,
        formula: cell.formula,
        numberFormat: cell.numberFormat,
      }
    : {
        address: `${columnLabel(column)}${row}`,
        row,
        column,
        valueType: "blank",
        rawValue: null,
        formattedText: "",
        formula: null,
        numberFormat: "",
      };
}

function bindingSources(
  binding: ReportMappingBinding,
): ReportMaterializationProvenance["sources"] {
  const definition = binding.definition;
  if (definition?.kind === "table") {
    return [
      {
        role: "table",
        seriesId: null,
        label: binding.sourceLabel,
        sheetId: definition.source.sheetId,
        sheetName: definition.source.sheetName,
        address: definition.source.address,
        structureFingerprint: definition.source.structureFingerprint,
      },
    ];
  }
  if (definition?.kind === "chart") {
    return [
      {
        role: "category",
        seriesId: null,
        label: null,
        sheetId: definition.categories.sheetId,
        sheetName: definition.categories.sheetName,
        address: definition.categories.address,
        structureFingerprint: definition.categories.structureFingerprint,
      },
      ...definition.series.map((series) => ({
        role: "series" as const,
        seriesId: series.seriesId,
        label: series.label,
        sheetId: series.source.sheetId,
        sheetName: series.source.sheetName,
        address: series.source.address,
        structureFingerprint: series.source.structureFingerprint,
      })),
    ];
  }
  return [];
}

function materializationProvenance(
  binding: ReportMappingBinding,
  context: ReportMaterializationContext,
): ReportMaterializationProvenance {
  return {
    mappingSetResourceVersionId: context.mappingSetResourceVersionId,
    workbookArtifactId: context.workbookArtifactId,
    workbookVersion: context.workbookVersion,
    workbookHash: context.readModel?.workbookHash ?? null,
    slotId: binding.slotId,
    sources: bindingSources(binding),
  };
}

function blockedTableSnapshot(
  binding: ReportMappingBinding,
  context: ReportMaterializationContext,
  blockerCode: string,
): ReportTableSnapshot {
  return {
    kind: "table",
    status: "blocked",
    blockerCode,
    provenance: materializationProvenance(binding, context),
    headerRow: null,
    columns: [],
    headers: [],
    rows: [],
  };
}

function blockedChartSnapshot(
  binding: ReportMappingBinding,
  context: ReportMaterializationContext,
  blockerCode: string,
): ReportChartSnapshot {
  return {
    kind: "chart",
    status: "blocked",
    blockerCode,
    provenance: materializationProvenance(binding, context),
    supportedChartTypes: [],
    categories: [],
    series: [],
  };
}

function readRange(
  source: ReportRangeSource,
  context: ReportMaterializationContext,
): {
  range: ParsedCellRange;
  cells: ReportMaterializedCell[];
} | null {
  const range = parseCellRange(source.address);
  if (!range || !context.readModel) return null;
  const sheet = context.readModel.sheets.find(
    (item) => item.sheetId === source.sheetId,
  );
  if (!sheet) return null;
  const cellsByCoordinate = new Map(
    sheet.cells.map((cell) => [`${cell.row}:${cell.column}`, cell]),
  );
  const cells: ReportMaterializedCell[] = [];
  for (let row = range.startRow; row <= range.endRow; row += 1) {
    for (
      let column = range.startColumn;
      column <= range.endColumn;
      column += 1
    ) {
      cells.push(
        materializedCell(cellsByCoordinate.get(`${row}:${column}`), row, column),
      );
    }
  }
  return { range, cells };
}

function oneDimensionalRange(
  source: ReportRangeSource,
  context: ReportMaterializationContext,
): ReportMaterializedCell[] | null {
  const resolved = readRange(source, context);
  if (
    !resolved ||
    (resolved.range.startRow !== resolved.range.endRow &&
      resolved.range.startColumn !== resolved.range.endColumn)
  ) {
    return null;
  }
  return resolved.cells;
}

function materializeTableBinding(
  binding: ReportMappingBinding,
  context: ReportMaterializationContext,
): ReportTableSnapshot {
  if (binding.status !== "confirmed") {
    return blockedTableSnapshot(binding, context, "BINDING_NOT_CONFIRMED");
  }
  if (binding.definition?.kind !== "table") {
    return blockedTableSnapshot(
      binding,
      context,
      "TABLE_RANGE_BINDING_REQUIRED",
    );
  }
  if (!context.readModel) {
    return blockedTableSnapshot(
      binding,
      context,
      "APPROVED_WORKBOOK_READ_MODEL_MISSING",
    );
  }
  const resolved = readRange(binding.definition.source, context);
  if (!resolved) {
    return blockedTableSnapshot(
      binding,
      context,
      "TABLE_SOURCE_RANGE_UNAVAILABLE",
    );
  }
  if (
    resolved.cells.every(
      (cell) => cell.rawValue === null && cell.formattedText === "",
    )
  ) {
    return blockedTableSnapshot(
      binding,
      context,
      "TABLE_SOURCE_RANGE_EMPTY",
    );
  }
  const rowCount = resolved.range.endRow - resolved.range.startRow + 1;
  const columnCount =
    resolved.range.endColumn - resolved.range.startColumn + 1;
  if (
    rowCount !== binding.definition.expectedRows ||
    columnCount !== binding.definition.expectedColumns
  ) {
    return blockedTableSnapshot(
      binding,
      context,
      "TABLE_TOPOLOGY_MISMATCH",
    );
  }
  const headerRow = binding.definition.columnHeaderRow;
  const rowKeyColumn = columnNumber(binding.definition.rowKeyColumn);
  if (
    headerRow < resolved.range.startRow ||
    headerRow > resolved.range.endRow ||
    rowKeyColumn < resolved.range.startColumn ||
    rowKeyColumn > resolved.range.endColumn
  ) {
    return blockedTableSnapshot(
      binding,
      context,
      "TABLE_BINDING_METADATA_INVALID",
    );
  }
  const cellsByRow = new Map<number, ReportMaterializedCell[]>();
  for (const cell of resolved.cells) {
    const row = cellsByRow.get(cell.row) ?? [];
    row.push(cell);
    cellsByRow.set(cell.row, row);
  }
  const headers = cellsByRow.get(headerRow) ?? [];
  if (
    headers.every(
      (cell) => cell.rawValue === null && cell.formattedText === "",
    )
  ) {
    return blockedTableSnapshot(
      binding,
      context,
      "TABLE_HEADER_ROW_EMPTY",
    );
  }
  const rows = [...cellsByRow.entries()]
    .filter(([row]) => row !== headerRow)
    .sort(([left], [right]) => left - right)
    .map(([rowNumber, cells]) => {
      const keyCell = cells.find((cell) => cell.column === rowKeyColumn);
      return {
        rowNumber,
        rowKey:
          keyCell?.formattedText ||
          keyCell?.rawValue ||
          null,
        cells,
      };
    });
  return {
    kind: "table",
    status: "ready",
    blockerCode: null,
    provenance: materializationProvenance(binding, context),
    headerRow,
    columns: headers.map((cell) => ({
      column: cell.column,
      address: columnLabel(cell.column),
      label: cell.formattedText || cell.rawValue || columnLabel(cell.column),
    })),
    headers,
    rows,
  };
}

function materializeChartBinding(
  binding: ReportMappingBinding,
  context: ReportMaterializationContext,
): ReportChartSnapshot {
  if (binding.status !== "confirmed") {
    return blockedChartSnapshot(binding, context, "BINDING_NOT_CONFIRMED");
  }
  if (binding.definition?.kind !== "chart") {
    return blockedChartSnapshot(
      binding,
      context,
      "CHART_SERIES_BINDING_REQUIRED",
    );
  }
  if (!context.readModel) {
    return blockedChartSnapshot(
      binding,
      context,
      "APPROVED_WORKBOOK_READ_MODEL_MISSING",
    );
  }
  const categories = oneDimensionalRange(
    binding.definition.categories,
    context,
  );
  if (
    !categories ||
    categories.length === 0 ||
    categories.every(
      (cell) => cell.rawValue === null && cell.formattedText === "",
    )
  ) {
    return blockedChartSnapshot(
      binding,
      context,
      "CHART_CATEGORY_RANGE_INVALID",
    );
  }
  const series = binding.definition.series.map((item) => ({
    seriesId: item.seriesId,
    label: item.label ?? item.seriesId,
    values: oneDimensionalRange(item.source, context),
  }));
  if (
    series.length === 0 ||
    series.some(
      (item) => {
        if (!item.values || item.values.length !== categories.length) {
          return true;
        }
        const nonBlank = item.values.filter(
          (cell) => cell.rawValue !== null && cell.rawValue !== "",
        );
        return (
          nonBlank.length === 0 ||
          nonBlank.some(
            (cell) => !Number.isFinite(Number(cell.rawValue)),
          )
        );
      },
    )
  ) {
    return blockedChartSnapshot(
      binding,
      context,
      "CHART_SERIES_RANGE_INVALID",
    );
  }
  return {
    kind: "chart",
    status: "ready",
    blockerCode: null,
    provenance: materializationProvenance(binding, context),
    supportedChartTypes: supportedChartTypesForBinding(
      binding,
      series.length,
    ),
    categories,
    series: series.map((item) => ({
      seriesId: item.seriesId,
      label: item.label,
      values: item.values!,
    })),
  };
}

function supportedChartTypesForBinding(
  binding: ReportMappingBinding,
  seriesCount: number,
): ReportChartType[] {
  const figureNumber = binding.metric
    .toLowerCase()
    .match(/figure[_\s-]*(\d+)[_\s-]*chart/)?.[1];

  if (figureNumber === "2" || figureNumber === "3") {
    return ["line", "area"];
  }
  if (figureNumber === "7" || figureNumber === "9") {
    return seriesCount > 1 ? ["combo", "line"] : ["line"];
  }
  if (figureNumber === "8" || figureNumber === "10") {
    return ["bar", "line", "area"];
  }
  return seriesCount > 1
    ? ["line", "bar", "area", "combo"]
    : ["line", "bar", "area"];
}

export function materializeReportBindings(
  bindings: ReportMappingBinding[],
  context: ReportMaterializationContext,
): ReportMaterializationsBySlotId {
  const result: ReportMaterializationsBySlotId = {};
  for (const binding of bindings) {
    if (binding.kind === "table") {
      result[binding.slotId] = materializeTableBinding(binding, context);
    } else if (binding.kind === "chart") {
      result[binding.slotId] = materializeChartBinding(binding, context);
    }
  }
  return result;
}

type DetectedChartRegion = {
  figureNumber: number;
  title: string;
  bbox: PdfRect;
  objectIds: string[];
};

function rectArea(rect: PdfRect): number {
  return (rect[2] - rect[0]) * (rect[3] - rect[1]);
}

function rectCenterX(rect: PdfRect): number {
  return (rect[0] + rect[2]) / 2;
}

function rectsIntersect(left: PdfRect, right: PdfRect): boolean {
  return !(
    left[2] <= right[0] ||
    left[0] >= right[2] ||
    left[3] <= right[1] ||
    left[1] >= right[3]
  );
}

function detectFigureCharts(
  page: ReportTemplatePage,
  pageWidth: number,
  pageHeight: number,
): DetectedChartRegion[] {
  const runs = templateTextRuns(page);
  const headings = runs
    .map((run) => {
      const match = run.text.match(
        /^(?:도\s*표|그\s*림|figure|chart)\s*(\d+)\s*[.:．]?\s*(.*)$/i,
      );
      const bbox = pdfRect(run.bbox);
      if (!match || !bbox) return null;
      return {
        ...run,
        bbox,
        figureNumber: Number(match[1]),
        title: run.text.replace(/\s+/g, " ").trim(),
      };
    })
    .filter(
      (
        heading,
      ): heading is TemplateTextRun & {
        bbox: PdfRect;
        figureNumber: number;
        title: string;
      } => Boolean(heading && Number.isInteger(heading.figureNumber)),
    );
  if (headings.length === 0) return [];

  const paths = (page.objects ?? [])
    .filter((object) => object.type === "path")
    .map((object) => {
      const bbox = pdfRect(object.bbox);
      return bbox ? { objectId: object.objectId, bbox } : null;
    })
    .filter(
      (
        path,
      ): path is {
        objectId: string;
        bbox: PdfRect;
      } => Boolean(path),
    );

  return headings.flatMap((heading) => {
    const nextHeadingRow = headings
      .filter((candidate) => candidate.bbox[1] > heading.bbox[1] + 16)
      .sort((left, right) => left.bbox[1] - right.bbox[1])[0];
    const verticalLimit = Math.min(
      pageHeight - 18,
      nextHeadingRow?.bbox[1] ?? heading.bbox[1] + pageHeight * 0.3,
    );
    const rowHeadings = headings.filter(
      (candidate) => Math.abs(candidate.bbox[1] - heading.bbox[1]) <= 4,
    );
    const orderedRowHeadings = [...rowHeadings].sort(
      (left, right) => rectCenterX(left.bbox) - rectCenterX(right.bbox),
    );
    const headingColumnIndex = orderedRowHeadings.findIndex(
      (candidate) => candidate.objectId === heading.objectId,
    );
    const columnLeft =
      headingColumnIndex > 0
        ? (rectCenterX(orderedRowHeadings[headingColumnIndex - 1].bbox) +
            rectCenterX(heading.bbox)) /
          2
        : 36;
    const columnRight =
      headingColumnIndex >= 0 &&
      headingColumnIndex < orderedRowHeadings.length - 1
        ? (rectCenterX(heading.bbox) +
            rectCenterX(orderedRowHeadings[headingColumnIndex + 1].bbox)) /
          2
        : pageWidth - 36;
    const belongsToHeadingColumn = (rect: PdfRect) => {
      const center = rectCenterX(rect);
      return center >= columnLeft - 8 && center <= columnRight + 8;
    };
    const eligiblePaths = paths.filter((path) => {
      const width = path.bbox[2] - path.bbox[0];
      const height = path.bbox[3] - path.bbox[1];
      if (
        width < Math.min(100, pageWidth * 0.18) ||
        height < 45 ||
        path.bbox[1] < heading.bbox[3] - 2 ||
        path.bbox[3] > verticalLimit + 8
      ) {
        return false;
      }
      const pathCenter = rectCenterX(path.bbox);
      const nearestHeading = [...rowHeadings].sort(
        (left, right) =>
          Math.abs(rectCenterX(left.bbox) - pathCenter) -
          Math.abs(rectCenterX(right.bbox) - pathCenter),
      )[0];
      return nearestHeading?.objectId === heading.objectId;
    });
    const anchor = [...eligiblePaths].sort(
      (left, right) => rectArea(right.bbox) - rectArea(left.bbox),
    )[0];

    const sourceRun = runs
      .filter((run) => {
        const bbox = pdfRect(run.bbox);
        return (
          bbox &&
          /^자료\s*[:：]/.test(run.text) &&
          bbox[1] >= (anchor?.bbox[3] ?? heading.bbox[3] + 60) - 3 &&
          bbox[1] <=
            Math.min(
              verticalLimit + 8,
              (anchor?.bbox[3] ?? verticalLimit) + 32,
            ) &&
          (anchor
            ? rectCenterX(bbox) >= anchor.bbox[0] - 20 &&
              rectCenterX(bbox) <= anchor.bbox[2] + 20
            : belongsToHeadingColumn(bbox))
        );
      })
      .sort(
        (left, right) =>
          Number(left.bbox[1] ?? 0) - Number(right.bbox[1] ?? 0),
      )[0];
    const sourceBbox = pdfRect(sourceRun?.bbox);
    if (!anchor) {
      if (!sourceBbox || sourceBbox[1] - heading.bbox[3] < 80) return [];
      const bodyRuns = runs.filter((run) => {
        if (
          run.objectId === heading.objectId ||
          run.objectId === sourceRun?.objectId
        ) {
          return false;
        }
        const bbox = pdfRect(run.bbox);
        return (
          bbox &&
          bbox[1] >= heading.bbox[3] - 2 &&
          bbox[3] <= sourceBbox[1] + 2 &&
          belongsToHeadingColumn(bbox)
        );
      });
      const bodyCharacterCount = bodyRuns.reduce(
        (count, run) => count + run.text.replace(/\s+/g, "").length,
        0,
      );
      if (bodyRuns.length > 12 || bodyCharacterCount > 240) return [];

      const bbox: PdfRect = [
        Math.max(0, Math.min(heading.bbox[0], sourceBbox[0], columnLeft) - 4),
        Math.max(0, heading.bbox[1] - 3),
        Math.min(
          pageWidth,
          Math.max(heading.bbox[2], sourceBbox[2], columnRight) + 4,
        ),
        Math.min(pageHeight, sourceBbox[3] + 3),
      ];
      const objectIds = (page.objects ?? [])
        .filter((object) => {
          const objectBbox = pdfRect(object.bbox);
          return objectBbox ? rectsIntersect(objectBbox, bbox) : false;
        })
        .map((object) => object.objectId);
      return [
        {
          figureNumber: heading.figureNumber,
          title: heading.title,
          bbox,
          objectIds,
        },
      ];
    }

    const combined = unionRects([
      heading.bbox,
      anchor.bbox,
      sourceBbox ?? undefined,
    ]);
    if (!combined) return [];
    const bbox: PdfRect = [
      Math.max(0, combined[0] - 4),
      Math.max(0, combined[1] - 3),
      Math.min(pageWidth, combined[2] + 4),
      Math.min(pageHeight, combined[3] + 3),
    ];
    const objectIds = (page.objects ?? [])
      .filter((object) => {
        const objectBbox = pdfRect(object.bbox);
        return objectBbox ? rectsIntersect(objectBbox, bbox) : false;
      })
      .map((object) => object.objectId);
    return [
      {
        figureNumber: heading.figureNumber,
        title: heading.title,
        bbox,
        objectIds,
      },
    ];
  });
}

function isMeaningfulText(value: string): boolean {
  return /[A-Za-z가-힣]/.test(value) && !/^[\d\s.,()%+\-/:]+$/.test(value);
}

function isBoilerplateText(value: string): boolean {
  const normalized = value.replace(/\s+/g, " ").trim();
  return (
    /^(company|update|company update|research|research center)$/i.test(
      normalized,
    ) ||
    /^(compliance notice|자료|주|출처)\b/i.test(normalized) ||
    /^[A-Z][A-Z0-9.&-]{0,14}$/.test(normalized) ||
    /^\(\d{4,6}\)$/.test(normalized) ||
    /^\(?\d{4,6}\)?$/.test(normalized) ||
    /^\d{4}[./-]\s*\d{1,2}[./-]\s*\d{1,2}$/.test(normalized)
  );
}

function dominantProseLeft(
  page: ReportTemplatePage,
  pageWidth: number,
): number | null {
  const runs = templateTextRuns(page).filter(
    (run) =>
      run.text.length >= 20 &&
      Number(run.bbox[0] ?? 0) >= 0 &&
      Number(run.bbox[0] ?? 0) <= pageWidth * 0.82,
  );
  if (runs.length === 0) return null;
  const groups = new Map<number, number>();
  for (const run of runs) {
    const key = Math.round(Number(run.bbox[0] ?? 0) / 4) * 4;
    groups.set(key, (groups.get(key) ?? 0) + run.text.length);
  }
  return (
    [...groups.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ??
    null
  );
}

function detectSourceTitle(
  page: ReportTemplatePage,
  pageWidth: number,
  pageHeight: number,
): TemplateTextRun | null {
  const proseLeft = dominantProseLeft(page, pageWidth);
  const candidates = templateTextRuns(page)
    .filter((run) => {
      const x = Number(run.bbox[0] ?? 0);
      const y = Number(run.bbox[1] ?? 0);
      return (
        run.text.length >= 3 &&
        run.text.length <= 100 &&
        isMeaningfulText(run.text) &&
        !isBoilerplateText(run.text) &&
        !/[：:]$/.test(run.text) &&
        (proseLeft === null || Math.abs(x - proseLeft) <= 24) &&
        y >= pageHeight * 0.08 &&
        y <= pageHeight * 0.45
      );
    })
    .sort(
      (left, right) =>
        right.fontSize - left.fontSize ||
        Number(left.bbox[1] ?? 0) - Number(right.bbox[1] ?? 0),
    );
  return candidates[0] ?? null;
}

function detectNarrativeSections(
  page: ReportTemplatePage,
  pageWidth: number,
  pageHeight: number,
): Array<{
  heading: TemplateTextRun;
  sourceText: string;
  bodyRuns: TemplateTextRun[];
  bodyRegions: PdfRect[];
  uncoveredObjectIds: string[];
}> {
  const runs = templateTextRuns(page);
  const proseLeft = dominantProseLeft(page, pageWidth);
  if (proseLeft === null) return [];
  const proseRuns = runs.filter(
    (run) => Math.abs(Number(run.bbox[0] ?? 0) - proseLeft) <= 18,
  );
  const proseSizes = proseRuns
    .filter((run) => run.text.length >= 20 && run.fontSize > 0)
    .map((run) => run.fontSize)
    .sort((left, right) => left - right);
  const bodySize =
    proseSizes[Math.floor(proseSizes.length / 2)] ?? Number.NaN;
  const headings = runs.filter((run, index) => {
    const x = Number(run.bbox[0] ?? 0);
    const y = Number(run.bbox[1] ?? 0);
    const colonHeading = /[：:]($|\s)/.test(run.text);
    const inProseColumn = Math.abs(x - proseLeft) <= 18;
    const next = runs
      .slice(index + 1)
      .find(
        (candidate) =>
          candidate.text.trim().length >= 2 &&
          Number(candidate.bbox[1] ?? 0) >= y - 1 &&
          Number(candidate.bbox[1] ?? 0) -
            Number(run.bbox[3] ?? run.bbox[1] ?? 0) <=
            36 &&
          Number(candidate.bbox[0] ?? 0) >= x - 10 &&
          (colonHeading
            ? candidate.fontSize <= run.fontSize * 1.05
            : candidate.fontSize < run.fontSize * 0.98),
      );
    const looksLikeHeading =
      colonHeading ||
      (inProseColumn &&
        Number.isFinite(bodySize) &&
        run.fontSize >= bodySize * 1.07);
    return (
      run.text.length >= 3 &&
      run.text.length <= 100 &&
      looksLikeHeading &&
      Boolean(next) &&
      isMeaningfulText(run.text) &&
      !isBoilerplateText(run.text) &&
      y >= pageHeight * 0.18 &&
      y <= pageHeight * 0.84
    );
  });

  return headings.flatMap((heading, index) => {
    const y = Number(heading.bbox[1] ?? 0);
    const headingBottom = Number(heading.bbox[3] ?? y);
    const nextY =
      Number(headings[index + 1]?.bbox[1] ?? pageHeight - 6) || pageHeight;
    const headingX = Number(heading.bbox[0] ?? 0);
    const candidateRuns = runs
      .filter((run) => {
      const runY = Number(run.bbox[1] ?? 0);
      const runX = Number(run.bbox[0] ?? 0);
      const runRight = Number(run.bbox[2] ?? runX);
      const sameProseColumn =
        (runRight >= proseLeft - 18 && runX <= pageWidth * 0.96) ||
        (/[：:]($|\s)/.test(heading.text) &&
          runX >= headingX - 10 &&
          runX <= pageWidth * 0.94);
      const bodySized =
        !Number.isFinite(bodySize) ||
        (run.fontSize >= bodySize * 0.78 &&
          run.fontSize <= Math.max(heading.fontSize * 1.05, bodySize * 1.24));
      return (
        run.objectId !== heading.objectId &&
        runY >= y - 1 &&
        runY < nextY &&
        sameProseColumn &&
        bodySized &&
        Boolean(run.text.trim()) &&
        !isBoilerplateText(run.text) &&
        !headings.some((candidate) => candidate.objectId === run.objectId)
      );
      })
      .sort(
        (left, right) =>
          Number(left.bbox[1] ?? 0) - Number(right.bbox[1] ?? 0) ||
          Number(left.bbox[0] ?? 0) - Number(right.bbox[0] ?? 0),
      );
    const bodyRuns: TemplateTextRun[] = [];
    let previousBottom = headingBottom;
    let continuityBroken = false;
    for (const run of candidateRuns) {
      const rect = pdfRect(run.bbox);
      if (!rect || continuityBroken) continue;
      const referenceSize = Number.isFinite(bodySize)
        ? bodySize
        : Math.max(7, run.fontSize);
      const allowedGap = bodyRuns.length === 0
        ? Math.max(42, referenceSize * 4.2)
        : Math.max(20, Math.min(34, referenceSize * 2.8));
      const gap = rect[1] - previousBottom;
      if (gap > allowedGap) {
        continuityBroken = true;
        continue;
      }
      bodyRuns.push(run);
      previousBottom = Math.max(previousBottom, rect[3]);
    }
    if (bodyRuns.length === 0) return [];
    const covered = new Set(bodyRuns.map((run) => run.objectId));
    const uncoveredObjectIds = candidateRuns
      .filter((run) => !covered.has(run.objectId))
      .map((run) => run.objectId);
    const bodyBox = unionRects(bodyRuns.map((run) => run.bbox));
    return [
      {
        heading,
        bodyRuns,
        bodyRegions: bodyBox ? [bodyBox] : [],
        uncoveredObjectIds,
        sourceText: bodyRuns
          .map((run) => run.text)
          .join(" ")
          .replace(/\s+/g, " ")
          .slice(0, 4_000),
      },
    ];
  });
}

function suggestedSummary(
  heading: string,
  index: number,
  seed: OutlineSeed,
): string {
  const normalized = heading.toLowerCase();
  if (
    normalized.includes("목표주가") ||
    normalized.includes("valuation") ||
    normalized.includes("밸류에이션")
  ) {
    return `${seed.rating} 의견과 Target PER ${seed.targetPer}배, 목표주가 ${Number(
      seed.targetPrice,
    ).toLocaleString("ko-KR")}원의 산출 근거를 설명합니다.`;
  }
  if (
    normalized.includes("전망") ||
    normalized.includes("가시성") ||
    normalized.includes("outlook")
  ) {
    return cleanThesis(seed.thesis);
  }
  const passedEvidence = seed.evidence.filter(
    (item) => item.machineStatus === "passed",
  );
  return (
    passedEvidence[index % Math.max(1, passedEvidence.length)]?.oneLineValue ||
    cleanThesis(seed.thesis) ||
    `${seed.companyName}의 검증된 핵심 내용을 정리합니다.`
  );
}

function suggestedReportTitle(seed: OutlineSeed): string {
  const thesis = cleanThesis(seed.thesis)
    .replace(/[.。]\s*$/, "")
    .replace(/\s+/g, " ");
  const concise = thesis.length > 44 ? `${thesis.slice(0, 44).trim()}…` : thesis;
  const prefix = `${seed.companyName} ${seed.targetYear}년 ${seed.targetQuarter}분기`;
  return concise ? `${prefix}: ${concise}`.slice(0, 80) : `${prefix} 실적 Review`;
}

function pageRole(
  page: ReportTemplatePage,
  sourceTitle: string,
  visualSlots: OutlineVisualSlot[],
  narrativeBlocks: OutlineNarrativeBlock[],
): string {
  if (sourceTitle) return sourceTitle;
  if (visualSlots.length > 0) {
    return [...new Set(visualSlots.map((slot) => slot.metric))]
      .slice(0, 2)
      .join(" · ");
  }
  if (narrativeBlocks[0]?.subtitle) return narrativeBlocks[0].subtitle;
  return `원본 페이지 ${page.pageNumber}`;
}

export function buildInitialOutline(
  templatePages: ReportTemplatePage[],
  seed: OutlineSeed,
): OutlineContent {
  const sortedPages = [...templatePages].sort(
    (left, right) => left.pageNumber - right.pageNumber,
  );
  const allEvidenceIds = seed.evidence
    .filter((item) => item.machineStatus === "passed")
    .map((item) => item.evidenceId);

  return {
    schemaVersion: "2.0",
    generationSource: "fallback",
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
        const metricDisplay =
          kind !== "수치" && slot.semanticKey?.scope?.trim()
            ? slot.semanticKey.scope.trim()
            : metricLabel(metric);
        const binding = seed.mappingBindings?.find(
          (item) =>
            item.slotId === slot.slotId ||
            (item.metric === metric &&
              item.kind ===
                (slot.valueType === "table"
                  ? "table"
                  : slot.valueType === "chart"
                    ? "chart"
                    : "scalar")),
        );
        return {
          slotId: slot.slotId,
          blockId: slot.blockId,
          kind,
          label: `${kind}${localIndex}`,
          metric: metricDisplay,
          required: slot.required,
          bindingStatus: binding
            ? binding.status === "confirmed"
              ? "confirmed"
              : binding.status === "invalid"
                ? "invalid"
                : "unmapped"
            : seed.mappingBindings
              ? "unmapped"
              : seed.mappingConfirmed
                ? "confirmed"
                : "invalid",
          sourceLabel: binding?.sourceLabel ?? null,
          sourceAddress: binding?.sourceAddress ?? null,
          sourceType: binding?.sourceType ?? null,
        } satisfies OutlineVisualSlot;
      });
      const mediaBox = page.boxes?.mediaBox ?? [0, 0, 595.32, 841.92];
      const pageHeight = Math.abs(
        Number(mediaBox[3] ?? 841.92) - Number(mediaBox[1] ?? 0),
      );
      const pageWidth = Math.abs(
        Number(mediaBox[2] ?? 595.32) - Number(mediaBox[0] ?? 0),
      );
      const sourceTitle = detectSourceTitle(page, pageWidth, pageHeight);
      const pageEvidenceIds =
        pageIndex === 0
          ? allEvidenceIds
          : allEvidenceIds.filter(
              (_, index) => index % sortedPages.length === pageIndex,
            );
      const detectedSections = detectNarrativeSections(
        page,
        pageWidth,
        pageHeight,
      );
      const narrativeBlocks = detectedSections.map(
        (
          {
            heading,
            sourceText,
            bodyRuns,
            bodyRegions,
            uncoveredObjectIds,
          },
          index,
        ) => ({
          blockId: `${page.pageId}.body.${heading.objectId}`,
          order: index + 1,
          subtitle: heading.text.replace(/[：:]\s*$/, "").trim(),
          summary: suggestedSummary(heading.text, index, seed),
          sourceHeading: heading.text,
          sourceText,
          maxLength: 160,
          evidenceIds: pageEvidenceIds,
          subtitleBbox: pdfRect(heading.bbox),
          bodyBbox: unionRects(bodyRuns.map((run) => run.bbox)),
          bodyRegions,
          subtitleObjectIds: [heading.objectId],
          bodyObjectIds: bodyRuns.map((run) => run.objectId),
          uncoveredBodyObjectIds: uncoveredObjectIds,
        }),
      );
      const recommendedTitle =
        pageIndex === 0 || sourceTitle
          ? {
              blockId: `${page.pageId}.title.${sourceTitle?.objectId ?? "generated"}`,
              value:
                pageIndex === 0
                  ? suggestedReportTitle(seed)
                  : sourceTitle?.text ?? pageRole(page, "", visualSlots, []),
              sourceText: sourceTitle?.text ?? "",
              maxLength: 80,
              evidenceIds: pageEvidenceIds,
              bbox: pdfRect(sourceTitle?.bbox),
              sourceObjectIds: sourceTitle ? [sourceTitle.objectId] : [],
            }
          : null;

      return {
        pageId: page.pageId,
        pageNumber: page.pageNumber,
        pageLabel: String(page.pageNumber).padStart(2, "0"),
        role: pageRole(
          page,
          sourceTitle?.text ?? "",
          visualSlots,
          narrativeBlocks,
        ),
        editable: Boolean(recommendedTitle || narrativeBlocks.length > 0),
        widthPt: pageWidth,
        heightPt: pageHeight,
        rotation: Number(page.rotation ?? 0),
        recommendedTitle,
        narrativeBlocks,
        visualSlots,
        evidenceIds: pageEvidenceIds,
      };
    }),
  };
}

export function normalizeOutlineContent(value: unknown): OutlineContent {
  const outline = value as {
    schemaVersion?: string;
    generationSource?: "ai" | "fallback";
    pages?: Array<
      Partial<OutlinePage> & {
        narrative?: {
          reportTitle?: string;
          companyReview?: string;
          companyOutlook?: string;
        } | null;
      }
    >;
  };
  if (
    outline.schemaVersion === "2.0" &&
    Array.isArray(outline.pages) &&
    outline.pages.every(
      (page) =>
        Array.isArray(page.narrativeBlocks) &&
        Object.hasOwn(page, "recommendedTitle"),
    )
  ) {
    return outline as OutlineContent;
  }

  return {
    schemaVersion: "2.0",
    generationSource: outline.generationSource ?? "fallback",
    pages: (outline.pages ?? []).map((page) => {
      const legacy = page.narrative;
      const evidenceIds = page.evidenceIds ?? [];
      const narrativeBlocks: OutlineNarrativeBlock[] = legacy
        ? [
            {
              blockId: `${page.pageId}.legacy.body.1`,
              order: 1,
              subtitle: "",
              summary: String(legacy.companyReview ?? ""),
              sourceHeading: "",
              sourceText: "",
               maxLength: 160,
               evidenceIds,
               subtitleBbox: null,
               bodyBbox: null,
               subtitleObjectIds: [],
               bodyObjectIds: [],
             },
            {
              blockId: `${page.pageId}.legacy.body.2`,
              order: 2,
              subtitle: "",
              summary: String(legacy.companyOutlook ?? ""),
              sourceHeading: "",
              sourceText: "",
               maxLength: 160,
               evidenceIds,
               subtitleBbox: null,
               bodyBbox: null,
               subtitleObjectIds: [],
               bodyObjectIds: [],
             },
          ].filter((block) => Boolean(block.summary))
        : [];
      const recommendedTitle = legacy?.reportTitle
        ? {
            blockId: `${page.pageId}.legacy.title`,
            value: legacy.reportTitle,
            sourceText: "",
             maxLength: 80,
             evidenceIds,
             bbox: null,
             sourceObjectIds: [],
           }
        : (page.recommendedTitle ?? null);
      return {
        pageId: String(page.pageId ?? ""),
        pageNumber: Number(page.pageNumber ?? 0),
        pageLabel: String(page.pageLabel ?? ""),
        role: String(page.role ?? ""),
        editable: Boolean(recommendedTitle || narrativeBlocks.length > 0),
        widthPt: Number(page.widthPt ?? 595.32),
        heightPt: Number(page.heightPt ?? 841.92),
        rotation: Number(page.rotation ?? 0),
        recommendedTitle,
        narrativeBlocks:
          page.narrativeBlocks && page.narrativeBlocks.length > 0
            ? page.narrativeBlocks
            : narrativeBlocks,
        visualSlots: page.visualSlots ?? [],
        evidenceIds,
      };
    }),
  };
}

export function patchOutline(
  outline: OutlineContent,
  changes: OutlineChange[],
): { content: OutlineContent; invalidatedPageIds: string[] } {
  const normalized = normalizeOutlineContent(outline);
  const invalidated = new Set<string>();
  const pages = normalized.pages.map((page) => {
    const pageChanges = changes.filter((change) => change.pageId === page.pageId);
    if (pageChanges.length === 0) return page;
    if (!page.editable) {
      throw new Error("OUTLINE_SLOT_READ_ONLY");
    }
    let recommendedTitle = page.recommendedTitle
      ? { ...page.recommendedTitle }
      : null;
    const narrativeBlocks = page.narrativeBlocks.map((block) => ({ ...block }));
    for (const change of pageChanges) {
      const value = change.value.trim();
      const titleMatch =
        recommendedTitle?.blockId === change.blockId &&
        change.field === "value";
      const narrative = narrativeBlocks.find(
        (block) => block.blockId === change.blockId,
      );
      const maxLength = titleMatch
        ? recommendedTitle?.maxLength ?? 80
        : change.field === "subtitle"
          ? 80
          : narrative?.maxLength ?? 160;
      if (!value || value.length > maxLength || /[\r\n]/.test(value)) {
        throw new Error("OUTLINE_VALUE_INVALID");
      }
      if (titleMatch && recommendedTitle) {
        recommendedTitle = { ...recommendedTitle, value };
      } else if (
        narrative &&
        (change.field === "subtitle" || change.field === "summary")
      ) {
        narrative[change.field] = value;
      } else {
        throw new Error("OUTLINE_SLOT_READ_ONLY");
      }
    }
    invalidated.add(page.pageId);
    return { ...page, recommendedTitle, narrativeBlocks };
  });
  return {
    content: { ...normalized, pages },
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
  for (const page of input.outline.pages) {
    const invalidTitle =
      page.recommendedTitle && !page.recommendedTitle.value.trim();
    const invalidNarrative = page.narrativeBlocks.some(
      (block) => !block.subtitle.trim() || !block.summary.trim(),
    );
    if (invalidTitle || invalidNarrative) {
      issues.push({
        code: "REQUIRED_NARRATIVE_MISSING",
        severity: "blocking",
        message: `${page.pageLabel} 페이지의 제목과 본문 작성 방향을 확인해주세요.`,
        pageId: page.pageId,
        blockId: null,
      });
    }
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
  draftTextByBlockId?: Record<string, string>;
  materializationsBySlotId?: ReportMaterializationsBySlotId;
}): ReportDocument {
  const outline = normalizeOutlineContent(input.outline);
  return {
    schemaVersion: "1.0",
    pageCount: outline.pages.length,
    pages: outline.pages.map((page, index) => {
      const blocks: ReportBlock[] = [];
      if (page.recommendedTitle) {
        blocks.push({
          blockId: page.recommendedTitle.blockId,
          pageId: page.pageId,
          role: "title",
          label: "페이지 제목",
          text: page.recommendedTitle.value,
          editable: true,
          revision: 1,
          evidenceIds: page.recommendedTitle.evidenceIds,
          numericAuthority: null,
          templateBlockId: page.recommendedTitle.blockId,
          bbox: page.recommendedTitle.bbox,
          regions: page.recommendedTitle.bbox
            ? [page.recommendedTitle.bbox]
            : [],
          sourceObjectIds: page.recommendedTitle.sourceObjectIds,
          sourceCoverage: "complete",
          uncoveredSourceObjectIds: [],
          dataBinding: null,
          patchStrategy: page.recommendedTitle.bbox
            ? "operator_replace"
            : "region_background_patch",
        });
      }
      for (const narrative of page.narrativeBlocks) {
        blocks.push(
          {
            blockId: `${narrative.blockId}.subtitle`,
            pageId: page.pageId,
            role: "title",
            label: `본문 ${narrative.order} 소제목`,
            text: narrative.subtitle,
            editable: true,
            revision: 1,
            evidenceIds: narrative.evidenceIds,
            numericAuthority: null,
            templateBlockId: narrative.blockId,
            bbox: narrative.subtitleBbox,
            regions: narrative.subtitleBbox ? [narrative.subtitleBbox] : [],
            sourceObjectIds: narrative.subtitleObjectIds,
            sourceCoverage: "complete",
            uncoveredSourceObjectIds: [],
            dataBinding: null,
            patchStrategy: narrative.subtitleBbox
              ? "operator_replace"
              : "region_background_patch",
          },
          {
            blockId: `${narrative.blockId}.summary`,
            pageId: page.pageId,
            role: "narrative",
            label: `본문 ${narrative.order}`,
            text:
              input.draftTextByBlockId?.[narrative.blockId] ??
              narrative.sourceText ??
              narrative.summary,
            editable: true,
            revision: 1,
            evidenceIds: narrative.evidenceIds,
            numericAuthority: null,
            templateBlockId: narrative.blockId,
            bbox: narrative.bodyBbox,
            regions:
              narrative.bodyRegions ??
              (narrative.bodyBbox ? [narrative.bodyBbox] : []),
            sourceObjectIds: narrative.bodyObjectIds,
            sourceCoverage:
              (narrative.uncoveredBodyObjectIds?.length ?? 0) > 0
                ? "review_required"
                : "complete",
            uncoveredSourceObjectIds:
              narrative.uncoveredBodyObjectIds ?? [],
            dataBinding: null,
            patchStrategy: narrative.bodyBbox
              ? "block_vector_replace"
              : "region_background_patch",
          },
        );
      }
      if (index === 0 && (page.recommendedTitle || page.narrativeBlocks.length > 0)) {
        blocks.push({
          blockId: `${page.pageId}.valuation-authority`,
          pageId: page.pageId,
          role: "numeric",
          label: "승인 밸류에이션",
          text: `${input.rating} · Forward EPS ${Number(input.forwardEps).toLocaleString("ko-KR")}원 · Target PER ${input.targetPer}배 · 목표주가 ${Number(input.targetPrice).toLocaleString("ko-KR")}원 · 현재주가 ${Number(input.currentPrice).toLocaleString("ko-KR")}원`,
          editable: false,
          revision: 1,
          evidenceIds: page.evidenceIds,
          numericAuthority: "valuation_approval",
          templateBlockId: null,
          bbox: null,
          sourceObjectIds: [],
          regions: [],
          sourceCoverage: "complete",
          uncoveredSourceObjectIds: [],
          dataBinding: null,
          patchStrategy: "fixed",
        });
      }
      for (const slot of page.visualSlots) {
        const materializedData =
          input.materializationsBySlotId?.[slot.slotId];
        const materializationReady =
          materializedData?.status === "ready";
        blocks.push({
          blockId: slot.blockId,
          pageId: page.pageId,
          role: "visual",
          label: `${slot.label} · ${slot.metric}`,
          text:
            slot.bindingStatus !== "confirmed"
              ? `${slot.metric} · 연결 필요`
              : slot.kind !== "수치" && !materializationReady
                ? `${slot.metric} · 데이터 반영 준비 필요`
                : `${slot.metric} · 입력값 반영 완료`,
          editable: false,
          revision: 1,
          evidenceIds: page.evidenceIds,
          numericAuthority:
            slot.bindingStatus === "confirmed"
              ? "mapping_set"
              : "mapping_required",
          templateBlockId: slot.blockId,
          bbox: null,
          regions: [],
          sourceObjectIds: [],
          sourceCoverage: "complete",
          uncoveredSourceObjectIds: [],
          dataBinding: {
            slotId: slot.slotId,
            metric: slot.metric,
            kind:
              slot.kind === "표"
                ? "table"
                : slot.kind === "차트"
                  ? "chart"
                  : "scalar",
            status: slot.bindingStatus,
            sourceLabel: slot.sourceLabel ?? null,
            sourceAddress: slot.sourceAddress ?? null,
            sourceType: slot.sourceType ?? null,
          },
          materializedData,
          patchStrategy: "fixed",
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
          templateBlockId: null,
          bbox: null,
          sourceObjectIds: [],
          regions: [],
          sourceCoverage: "complete",
          uncoveredSourceObjectIds: [],
          dataBinding: null,
          patchStrategy: "fixed",
        });
      }
      return {
        pageId: page.pageId,
        pageNumber: page.pageNumber,
        pageLabel: page.pageLabel,
        role: page.role,
        widthPt: page.widthPt,
        heightPt: page.heightPt,
        rotation: page.rotation,
        blocks,
      };
    }),
  };
}

export function attachTemplateGeometry(
  document: ReportDocument,
  templatePages: ReportTemplatePage[],
  mappingBindings: ReportMappingBinding[] = [],
  materializationsBySlotId: ReportMaterializationsBySlotId = {},
): ReportDocument {
  const documentPagesByNumber = new Map(
    document.pages.map((page) => [page.pageNumber, page]),
  );
  const alignedPages =
    templatePages.length === 0
      ? document.pages
      : [...templatePages]
          .sort((left, right) => left.pageNumber - right.pageNumber)
          .map((template) => {
            const mediaBox =
              template.boxes?.mediaBox ?? [0, 0, 595.32, 841.92];
            const widthPt = Math.abs(
              Number(mediaBox[2] ?? 595.32) - Number(mediaBox[0] ?? 0),
            );
            const heightPt = Math.abs(
              Number(mediaBox[3] ?? 841.92) - Number(mediaBox[1] ?? 0),
            );
            const existing = documentPagesByNumber.get(template.pageNumber);
            if (existing) {
              return {
                ...existing,
                pageId: template.pageId,
                pageNumber: template.pageNumber,
                pageLabel: String(template.pageNumber).padStart(2, "0"),
                widthPt,
                heightPt,
                rotation: Number(template.rotation ?? 0),
                blocks: existing.blocks.map((block) => ({
                  ...block,
                  pageId: template.pageId,
                })),
              };
            }
            return {
              pageId: template.pageId,
              pageNumber: template.pageNumber,
              pageLabel: String(template.pageNumber).padStart(2, "0"),
              role: `원본 페이지 ${template.pageNumber}`,
              widthPt,
              heightPt,
              rotation: Number(template.rotation ?? 0),
              blocks: [
                {
                  blockId: `${template.pageId}.fixed`,
                  pageId: template.pageId,
                  role: "fixed" as const,
                  label: `원본 페이지 ${template.pageNumber}`,
                  text: "원본 PDF의 고정 디자인과 문구를 유지합니다.",
                  editable: false,
                  revision: 1,
                  evidenceIds: [],
                  numericAuthority: null,
                  templateBlockId: null,
                  bbox: null,
                  sourceObjectIds: [],
                  patchStrategy: "fixed" as const,
                },
              ],
            };
          });
  const pagesById = new Map(templatePages.map((page) => [page.pageId, page]));
  const pagesByNumber = new Map(
    templatePages.map((page) => [page.pageNumber, page]),
  );
  return {
    ...document,
    pageCount: alignedPages.length,
    pages: alignedPages.map((page) => {
      const template =
        pagesById.get(page.pageId) ?? pagesByNumber.get(page.pageNumber);
      if (!template) {
        return {
          ...page,
          blocks: page.blocks.map((block) => ({
            ...block,
            templateBlockId: block.templateBlockId ?? null,
            bbox: pdfRect(block.bbox ?? undefined),
            regions:
              block.regions ??
              (pdfRect(block.bbox ?? undefined)
                ? [pdfRect(block.bbox ?? undefined)!]
                : []),
            sourceObjectIds: block.sourceObjectIds ?? [],
            sourceCoverage: block.sourceCoverage ?? "complete",
            uncoveredSourceObjectIds:
              block.uncoveredSourceObjectIds ?? [],
            dataBinding: block.dataBinding ?? null,
            patchStrategy: block.patchStrategy ?? "fixed",
          })),
        };
      }
      const pageHeight = page.heightPt;
      const sourceTitle = detectSourceTitle(
        template,
        page.widthPt,
        pageHeight,
      );
      const sections = detectNarrativeSections(
        template,
        page.widthPt,
        pageHeight,
      );
      const templateBlocks = new Map(
        (template.blocks ?? []).map((block) => [block.blockId, block]),
      );
      let subtitleIndex = 0;
      let bodyIndex = 0;
      const hydratedBlocks: ReportBlock[] = page.blocks.map((block) => {
        let label = block.label;
        let text = block.text;
        let targetBbox = pdfRect(block.bbox ?? undefined);
        let sourceObjectIds = block.sourceObjectIds ?? [];
        let templateBlockId = block.templateBlockId ?? null;
        let patchStrategy = block.patchStrategy ?? "fixed";
        let regions =
          block.regions ?? (targetBbox ? [targetBbox] : []);
        let sourceCoverage = block.sourceCoverage ?? "complete";
        let uncoveredSourceObjectIds =
          block.uncoveredSourceObjectIds ?? [];
        if (
          block.editable &&
          ["페이지 제목", "리포트 제목"].includes(block.label) &&
          sourceTitle
        ) {
          targetBbox = pdfRect(sourceTitle.bbox);
          sourceObjectIds = [sourceTitle.objectId];
          templateBlockId = `${page.pageId}.detected-title`;
          patchStrategy = "operator_replace";
          regions = targetBbox ? [targetBbox] : [];
        } else if (block.editable && block.label.includes("소제목")) {
          const section = sections[subtitleIndex++];
          if (section) {
            targetBbox = pdfRect(section.heading.bbox);
            sourceObjectIds = [section.heading.objectId];
            templateBlockId = `${page.pageId}.detected-body.${subtitleIndex}`;
            patchStrategy = "operator_replace";
            regions = targetBbox ? [targetBbox] : [];
            sourceCoverage = "complete";
            uncoveredSourceObjectIds = [];
          }
        } else if (
          block.editable &&
          (block.role === "narrative" || block.role === "judgement")
        ) {
          const section = sections[bodyIndex++];
          if (section) {
            label = `본문 ${bodyIndex}`;
            targetBbox = unionRects(
              section.bodyRuns.map((run) => run.bbox),
            );
            sourceObjectIds = section.bodyRuns.map((run) => run.objectId);
            templateBlockId = `${page.pageId}.detected-body.${bodyIndex}`;
            patchStrategy = "block_vector_replace";
            regions = section.bodyRegions;
            uncoveredSourceObjectIds = section.uncoveredObjectIds;
            sourceCoverage =
              uncoveredSourceObjectIds.length > 0
                ? "review_required"
                : "complete";
            if (
              block.revision === 1 &&
              section.sourceText.length >= 120 &&
              block.text.trim().length < section.sourceText.length * 0.35
            ) {
              text = section.sourceText;
              patchStrategy = "fixed";
            }
          }
        } else if (templateBlockId) {
          const templateBlock = templateBlocks.get(templateBlockId);
          targetBbox ??= pdfRect(templateBlock?.bbox);
          if (
            sourceObjectIds.length === 0 &&
            templateBlock?.objectIds?.length
          ) {
            sourceObjectIds = templateBlock.objectIds;
          }
          regions = targetBbox ? [targetBbox] : [];
        }
        return {
          ...block,
          label,
          text,
          templateBlockId,
          bbox: targetBbox,
          regions,
          sourceObjectIds,
          sourceCoverage,
          uncoveredSourceObjectIds,
          dataBinding: block.dataBinding ?? null,
          materializedData:
            block.materializedData ??
            (block.dataBinding?.slotId
              ? materializationsBySlotId[block.dataBinding.slotId]
              : undefined),
          patchStrategy: targetBbox ? patchStrategy : "fixed",
        };
      });

      const headingIds = new Set(
        hydratedBlocks.flatMap((block) =>
          block.label.includes("소제목") ? block.sourceObjectIds : [],
        ),
      );
      sections.forEach((section, index) => {
        if (headingIds.has(section.heading.objectId)) return;
        const bbox = pdfRect(section.heading.bbox);
        const bodyBlock = hydratedBlocks.find(
          (block) =>
            block.templateBlockId ===
              `${page.pageId}.detected-body.${index + 1}` &&
            (block.role === "narrative" || block.role === "judgement"),
        );
        hydratedBlocks.push({
          blockId: `${page.pageId}.detected-heading.${section.heading.objectId}`,
          pageId: page.pageId,
          role: "title",
          label: `본문 ${index + 1} 소제목`,
          text: section.heading.text.trim(),
          editable: true,
          revision: 1,
          evidenceIds: bodyBlock?.evidenceIds ?? [],
          numericAuthority: null,
          templateBlockId: `${page.pageId}.detected-body.${index + 1}`,
          bbox,
          regions: bbox ? [bbox] : [],
          sourceObjectIds: [section.heading.objectId],
          sourceCoverage: "complete",
          uncoveredSourceObjectIds: [],
          dataBinding: null,
          patchStrategy: bbox ? "operator_replace" : "fixed",
        });
      });

      for (const slot of template.slots ?? []) {
        const metric = slot.semanticKey?.metric ?? "연결 항목";
        const kind: "scalar" | "table" | "chart" =
          slot.valueType === "table"
            ? "table"
            : slot.valueType === "chart"
              ? "chart"
              : "scalar";
        const displayLabel =
          kind !== "scalar" && slot.semanticKey?.scope?.trim()
            ? slot.semanticKey.scope.trim()
            : metricLabel(metric);
        const blockId = `${page.pageId}.data.${slot.slotId}`;
        const binding = mappingBindings.find(
          (item) =>
            item.slotId === slot.slotId ||
            (item.metric === metric && item.kind === kind),
        );
        const templateBlock = templateBlocks.get(slot.blockId);
        const bbox = pdfRect(templateBlock?.bbox);
        const status = binding?.status ?? "unmapped";
        const materializedData = materializationsBySlotId[slot.slotId];
        const existingSlotBlock = hydratedBlocks.find(
          (block) =>
            block.blockId === blockId ||
            block.dataBinding?.slotId === slot.slotId,
        );
        if (existingSlotBlock) {
          if (kind !== "scalar" && slot.semanticKey?.scope?.trim()) {
            existingSlotBlock.label = displayLabel;
          }
          existingSlotBlock.dataBinding = {
            slotId: slot.slotId,
            metric,
            kind,
            status,
            sourceLabel: binding?.sourceLabel ?? null,
            sourceAddress: binding?.sourceAddress ?? null,
            sourceType: binding?.sourceType ?? null,
          };
          existingSlotBlock.materializedData ??=
            materializedData;
          existingSlotBlock.numericAuthority =
            status === "confirmed" ? "mapping_set" : "mapping_required";
          if (existingSlotBlock.revision === 1) {
            existingSlotBlock.text =
              status !== "confirmed"
                ? `${displayLabel} · 연결 필요`
                : kind !== "scalar" &&
                    existingSlotBlock.materializedData?.status !== "ready"
                  ? `${displayLabel} · 데이터 반영 준비 필요`
                  : `${displayLabel} · 입력값 반영 완료`;
          }
          continue;
        }
        hydratedBlocks.push({
          blockId,
          pageId: page.pageId,
          role: kind === "scalar" ? "numeric" : "visual",
          label: displayLabel,
          text:
            status !== "confirmed"
              ? `${displayLabel} · 연결 필요`
              : kind !== "scalar" && materializedData?.status !== "ready"
                ? `${displayLabel} · 데이터 반영 준비 필요`
                : `${displayLabel} · 입력값 반영 완료`,
          editable: false,
          revision: 1,
          evidenceIds: [],
          numericAuthority:
            status === "confirmed" ? "mapping_set" : "mapping_required",
          templateBlockId: slot.blockId,
          bbox,
          regions: bbox ? [bbox] : [],
          sourceObjectIds:
            slot.targetObjectIds ?? templateBlock?.objectIds ?? [],
          sourceCoverage: "complete",
          uncoveredSourceObjectIds: [],
          dataBinding: {
            slotId: slot.slotId,
            metric,
            kind,
            status,
            sourceLabel: binding?.sourceLabel ?? null,
            sourceAddress: binding?.sourceAddress ?? null,
            sourceType: binding?.sourceType ?? null,
          },
          materializedData,
          patchStrategy: "fixed",
        });
      }

      const normalizeMatchValue = (value: string | null | undefined) =>
        (value ?? "").toLowerCase().replace(/[^0-9a-z가-힣]/g, "");
      for (const chart of detectFigureCharts(
        template,
        page.widthPt,
        page.heightPt,
      )) {
        const normalizedChartTitle = normalizeMatchValue(chart.title);
        const fixedVisual =
          /(사업개요|시너지효과|조직도|프로세스|개념도|구조도|businessoverview|synergy)/.test(
            normalizedChartTitle,
          );
        if (fixedVisual) {
          for (let index = hydratedBlocks.length - 1; index >= 0; index -= 1) {
            const block = hydratedBlocks[index];
            if (
              block.dataBinding?.kind === "chart" &&
              (block.dataBinding.metric ===
                `figure_${chart.figureNumber}_chart` ||
                block.templateBlockId ===
                  `${page.pageId}.detected-chart.${chart.figureNumber}`)
            ) {
              hydratedBlocks.splice(index, 1);
            }
          }
          const blockId = `${page.pageId}.fixed-visual.figure-${chart.figureNumber}`;
          if (!hydratedBlocks.some((block) => block.blockId === blockId)) {
            hydratedBlocks.push({
              blockId,
              pageId: page.pageId,
              role: "fixed",
              label: chart.title,
              text: chart.title,
              editable: false,
              revision: 1,
              evidenceIds: [],
              numericAuthority: null,
              templateBlockId: `${page.pageId}.fixed-visual.${chart.figureNumber}`,
              bbox: chart.bbox,
              regions: [chart.bbox],
              sourceObjectIds: chart.objectIds,
              sourceCoverage: "complete",
              uncoveredSourceObjectIds: [],
              dataBinding: null,
              materializedData: {
                kind: "fixed_visual",
                status: "ready",
                blockerCode: null,
                provenance: null,
              },
              patchStrategy: "fixed",
            });
          }
          continue;
        }
        const overlapsExistingChart = hydratedBlocks.some(
          (block) =>
            block.dataBinding?.kind === "chart" &&
            block.bbox &&
            rectsIntersect(block.bbox, chart.bbox),
        );
        if (overlapsExistingChart) continue;

        const figureToken = `도표${chart.figureNumber}`;
        const binding = mappingBindings.find((item) => {
          if (item.kind !== "chart") return false;
          const source = normalizeMatchValue(
            `${item.sourceLabel ?? ""} ${item.sourceAddress ?? ""}`,
          );
          return (
            item.metric === `figure_${chart.figureNumber}_chart` ||
            source.includes(figureToken)
          );
        });
        const status = binding?.status ?? "unmapped";
        const materializedData = binding
          ? materializationsBySlotId[binding.slotId]
          : undefined;
        hydratedBlocks.push({
          blockId: `${page.pageId}.chart.figure-${chart.figureNumber}`,
          pageId: page.pageId,
          role: "visual",
          label: chart.title,
          text:
            status !== "confirmed"
              ? `${chart.title} · 연결 필요`
              : materializedData?.status !== "ready"
                ? `${chart.title} · 데이터 반영 준비 필요`
                : `${chart.title} · 입력값 반영 완료`,
          editable: false,
          revision: 1,
          evidenceIds: [],
          numericAuthority:
            status === "confirmed" ? "mapping_set" : "mapping_required",
          templateBlockId: `${page.pageId}.detected-chart.${chart.figureNumber}`,
          bbox: chart.bbox,
          regions: [chart.bbox],
          sourceObjectIds: chart.objectIds,
          sourceCoverage: "complete",
          uncoveredSourceObjectIds: [],
          dataBinding: {
            slotId: binding?.slotId,
            metric: `figure_${chart.figureNumber}_chart`,
            kind: "chart",
            status,
            sourceLabel: binding?.sourceLabel ?? null,
            sourceAddress: binding?.sourceAddress ?? null,
            sourceType: binding?.sourceType ?? null,
          },
          materializedData,
          patchStrategy: "fixed",
        });
      }
      return {
        ...page,
        blocks: hydratedBlocks,
      };
    }),
  };
}

export function applyReportOperations(
  document: ReportDocument,
  operations: Array<
    | {
        type: "replace_text" | "replace_block_text";
        blockId: string;
        baseBlockRevision: number;
        text: string;
      }
    | {
        type: "replace_chart_type";
        blockId: string;
        baseBlockRevision: number;
        chartType: ReportChartType;
      }
  >,
): ReportDocument {
  const next = structuredClone(document);
  for (const operation of operations) {
    const block = next.pages
      .flatMap((page) => page.blocks)
      .find((item) => item.blockId === operation.blockId);
    if (!block) throw new Error("INVALID_REPORT_OPERATION");
    if (block.revision !== operation.baseBlockRevision) {
      throw new Error("REPORT_BLOCK_CONFLICT");
    }
    if (operation.type === "replace_chart_type") {
      if (
        block.dataBinding?.kind !== "chart" ||
        block.dataBinding.status !== "confirmed" ||
        block.materializedData?.kind !== "chart" ||
        block.materializedData.status !== "ready" ||
        !block.materializedData.supportedChartTypes.includes(
          operation.chartType,
        )
      ) {
        throw new Error("INVALID_REPORT_OPERATION");
      }
      block.chartType = operation.chartType;
      block.revision += 1;
      continue;
    }
    if (!block.editable) throw new Error("INVALID_REPORT_OPERATION");
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
      if (
        block.editable &&
        (block.sourceCoverage === "review_required" ||
          (block.uncoveredSourceObjectIds?.length ?? 0) > 0)
      ) {
        issues.push({
          code: "SOURCE_TEXT_COVERAGE_INCOMPLETE",
          severity: "blocking",
          message: `${block.label}의 원문 일부가 편집 영역에 포함되지 않았습니다.`,
          pageId: page.pageId,
          blockId: block.blockId,
        });
      }
      if (
        (block.dataBinding?.kind === "table" ||
          block.dataBinding?.kind === "chart") &&
        block.dataBinding.status !== "confirmed"
      ) {
        issues.push({
          code: "REPORT_DATA_BINDING_NOT_CONFIRMED",
          severity: "blocking",
          message: `${block.label}의 Excel 연결을 다시 확인해주세요.`,
          pageId: page.pageId,
          blockId: block.blockId,
        });
      } else if (
        (block.dataBinding?.kind === "table" ||
          block.dataBinding?.kind === "chart") &&
        (!block.materializedData ||
          block.materializedData.kind !== block.dataBinding.kind ||
          block.materializedData.status !== "ready")
      ) {
        issues.push({
          code: "REPORT_DATA_MATERIALIZATION_INCOMPLETE",
          severity: "blocking",
          message: `${block.label}에 승인된 Excel 입력값이 반영되지 않았습니다.`,
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
