"use client";

import {
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from "react";
import type { WorkbookCell, WorkbookReadModel } from "./types";

type Change = {
  sheetId: string;
  address: string;
  valueType: "number" | "string" | "boolean" | "blank";
  value: string | null;
};

const PAGE_ROWS = 60;
const PAGE_COLUMNS = 16;
const DEFAULT_COLUMN_WIDTH = 108;
const DEFAULT_ROW_HEIGHT = 34;
type ImpactFilter = "all" | "eps" | "per" | "price" | "other";

const impactFilters: Array<{
  key: ImpactFilter;
  label: string;
}> = [
  { key: "all", label: "전체" },
  { key: "eps", label: "EPS" },
  { key: "per", label: "PER" },
  { key: "price", label: "목표주가" },
  { key: "other", label: "기타·미연결" },
];

function matchesImpact(
  impactTypes: string[],
  filter: ImpactFilter,
) {
  if (filter === "all") return true;
  if (filter === "eps") {
    return impactTypes.includes("forward_eps_driver");
  }
  if (filter === "per") {
    return impactTypes.includes("target_per_driver");
  }
  if (filter === "price") {
    return impactTypes.includes("target_price_driver");
  }
  return impactTypes.some((impact) =>
    [
      "report_table_driver",
      "source_metadata",
      "inactive_branch",
      "unmapped",
    ].includes(impact),
  );
}

function columnName(column: number): string {
  let value = column;
  let result = "";
  while (value > 0) {
    value -= 1;
    result = String.fromCharCode(65 + (value % 26)) + result;
    value = Math.floor(value / 26);
  }
  return result;
}

function cellChange(
  cell: WorkbookCell,
  sheetId: string,
  value: string,
): Change {
  if (value === "") {
    return {
      sheetId,
      address: cell.address,
      valueType: "blank",
      value: null,
    };
  }
  if (cell.valueType === "decimal" || cell.valueType === "integer") {
    return {
      sheetId,
      address: cell.address,
      valueType: "number",
      value,
    };
  }
  if (cell.valueType === "boolean") {
    return {
      sheetId,
      address: cell.address,
      valueType: "boolean",
      value: value.toLowerCase(),
    };
  }
  return {
    sheetId,
    address: cell.address,
    valueType: "string",
    value,
  };
}

function editableColor(value: string, fallback: string) {
  return /^[0-9A-F]{6}$/i.test(value) ? `#${value}` : fallback;
}

function horizontalAlignment(
  value: string | undefined,
  valueType: string,
): CSSProperties["textAlign"] {
  switch (value?.toLowerCase()) {
    case "left":
      return "left";
    case "center":
    case "centercontinuous":
      return "center";
    case "justify":
    case "distributed":
      return "justify";
    default:
      return valueType === "string" ? "left" : "right";
  }
}

function horizontalJustification(
  value: string | undefined,
  valueType: string,
): CSSProperties["justifyContent"] {
  switch (value?.toLowerCase()) {
    case "left":
      return "flex-start";
    case "center":
    case "centercontinuous":
      return "center";
    default:
      return valueType === "string" ? "flex-start" : "flex-end";
  }
}

function verticalAlignment(
  value: string | undefined,
): CSSProperties["alignItems"] {
  switch (value?.toLowerCase()) {
    case "top":
      return "flex-start";
    case "center":
      return "center";
    default:
      return "flex-end";
  }
}

function visibleBorder(value: string | undefined) {
  return value && value !== "none" ? value : undefined;
}

function EditableCell({
  cell,
  disabled,
  row,
  column,
  onSelect,
  onCommit,
  onPaste,
}: {
  cell: WorkbookCell;
  disabled: boolean;
  row?: number;
  column?: number;
  onSelect: () => void;
  onCommit: (value: string) => Promise<boolean>;
  onPaste?: (value: string) => Promise<boolean>;
}) {
  const [value, setValue] = useState(cell.rawValue ?? "");
  const [committing, setCommitting] = useState(false);

  const commit = async () => {
    if (value === (cell.rawValue ?? "")) return true;
    setCommitting(true);
    const success = await onCommit(value);
    if (!success) setValue(cell.rawValue ?? "");
    setCommitting(false);
    return success;
  };

  return (
    <input
      className="phase5-grid-input"
      aria-label={`${cell.label || cell.address} 입력`}
      data-row={row}
      data-column={column}
      value={value}
      disabled={disabled || committing}
      inputMode={
        cell.valueType === "decimal" || cell.valueType === "integer"
          ? "decimal"
          : undefined
      }
      onFocus={onSelect}
      onChange={(event) => setValue(event.target.value)}
      onBlur={() => void commit()}
      onPaste={(event) => {
        const text = event.clipboardData.getData("text/plain");
        if (!onPaste || !/[\t\r\n]/.test(text)) return;
        event.preventDefault();
        void onPaste(text);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          event.currentTarget.blur();
          return;
        }
        if (event.key === "Escape") {
          setValue(cell.rawValue ?? "");
          event.currentTarget.blur();
          return;
        }
        if (row === undefined || column === undefined) return;
        const input = event.currentTarget;
        const atStart =
          input.selectionStart === 0 && input.selectionEnd === 0;
        const atEnd =
          input.selectionStart === value.length &&
          input.selectionEnd === value.length;
        if (event.key === "ArrowUp" || event.key === "ArrowDown") {
          focusGridCell(event, row, column);
        } else if (event.key === "ArrowLeft" && atStart) {
          focusGridCell(event, row, column);
        } else if (event.key === "ArrowRight" && atEnd) {
          focusGridCell(event, row, column);
        }
      }}
    />
  );
}

function focusGridCell(
  event: KeyboardEvent<HTMLElement>,
  row: number,
  column: number,
) {
  const movement: Record<string, [number, number]> = {
    ArrowUp: [-1, 0],
    ArrowDown: [1, 0],
    ArrowLeft: [0, -1],
    ArrowRight: [0, 1],
  };
  const delta = movement[event.key];
  if (!delta) return;
  const grid = event.currentTarget.closest('[role="grid"]');
  const target = grid?.querySelector<HTMLElement>(
    `[data-row="${row + delta[0]}"][data-column="${column + delta[1]}"]`,
  );
  if (!target) return;
  event.preventDefault();
  target.focus();
}

export default function ValuationWorkbook({
  model,
  disabled,
  selected,
  onSelected,
  onCommit,
  onLocalError,
}: {
  model: WorkbookReadModel;
  disabled: boolean;
  selected: { sheetId: string; address: string } | null;
  onSelected: (cell: WorkbookCell, sheetId: string, sheetName: string) => void;
  onCommit: (changes: Change[]) => Promise<boolean>;
  onLocalError: (message: string) => void;
}) {
  const preferredSheetId =
    model.sheets.find(
      (sheet) =>
        sheet.visibility === "visible" &&
        /^M1_/i.test(sheet.name) &&
        model.editableCells.some((cell) => cell.sheetId === sheet.sheetId),
    )?.sheetId ??
    model.sheets.find(
      (sheet) =>
        sheet.visibility === "visible" &&
        model.editableCells.some((cell) => cell.sheetId === sheet.sheetId),
    )?.sheetId ??
    model.sheets.find((sheet) => sheet.visibility === "visible")?.sheetId ??
    model.sheets[0]?.sheetId ??
    "";
  const [activeSheetId, setActiveSheetId] = useState(
    preferredSheetId,
  );
  const [rowStart, setRowStart] = useState(1);
  const [columnStart, setColumnStart] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [impactFilter, setImpactFilter] =
    useState<ImpactFilter>("all");
  const gridScrollRef = useRef<HTMLDivElement | null>(null);
  const visibleSheets = useMemo(
    () => model.sheets.filter((item) => item.visibility === "visible"),
    [model.sheets],
  );
  const sheet =
    visibleSheets.find((item) => item.sheetId === activeSheetId) ??
    visibleSheets[0];
  const editableCountBySheet = useMemo(() => {
    const counts = new Map<string, number>();
    for (const cell of model.editableCells) {
      counts.set(cell.sheetId, (counts.get(cell.sheetId) ?? 0) + 1);
    }
    return counts;
  }, [model.editableCells]);
  const editableMetadata = useMemo(
    () =>
      new Map(
        model.editableCells.map((cell) => [
          `${cell.sheetId}:${cell.address}`,
          cell,
        ]),
      ),
    [model.editableCells],
  );
  const filteredEditableCountBySheet = useMemo(() => {
    const counts = new Map<string, number>();
    for (const cell of model.editableCells) {
      if (!matchesImpact(cell.impactTypes, impactFilter)) continue;
      counts.set(cell.sheetId, (counts.get(cell.sheetId) ?? 0) + 1);
    }
    return counts;
  }, [impactFilter, model.editableCells]);

  const bounds = useMemo(() => {
    const cells = sheet?.cells ?? [];
    const columnDimensions = new Map(
      (sheet?.columnWidths ?? []).map((item) => [item.column, item]),
    );
    const rowDimensions = new Map(
      (sheet?.rowHeights ?? []).map((item) => [item.row, item]),
    );
    return {
      minRow: Math.max(1, Math.min(...cells.map((cell) => cell.row), 1)),
      maxRow: Math.max(...cells.map((cell) => cell.row), 1),
      minColumn: Math.max(
        1,
        Math.min(...cells.map((cell) => cell.column), 1),
      ),
      maxColumn: Math.max(...cells.map((cell) => cell.column), 1),
      byPosition: new Map(
        cells.map((cell) => [`${cell.row}:${cell.column}`, cell]),
      ),
      columnDimensions,
      rowDimensions,
    };
  }, [sheet]);

  if (!sheet) {
    return (
      <div className="phase5-grid-empty">
        표시할 Excel 시트가 없습니다.
      </div>
    );
  }

  const safeRowStart = Math.min(
    Math.max(rowStart, bounds.minRow),
    Math.max(bounds.minRow, bounds.maxRow - PAGE_ROWS + 1),
  );
  const safeColumnStart = Math.min(
    Math.max(columnStart, bounds.minColumn),
    Math.max(bounds.minColumn, bounds.maxColumn - PAGE_COLUMNS + 1),
  );
  const rowEnd = Math.min(bounds.maxRow, safeRowStart + PAGE_ROWS - 1);
  const columnEnd = Math.min(
    bounds.maxColumn,
    safeColumnStart + PAGE_COLUMNS - 1,
  );
  const columns = Array.from(
    { length: columnEnd - safeColumnStart + 1 },
    (_, index) => safeColumnStart + index,
  ).filter((column) => !bounds.columnDimensions.get(column)?.hidden);
  const rows = Array.from(
    { length: rowEnd - safeRowStart + 1 },
    (_, index) => safeRowStart + index,
  ).filter((row) => !bounds.rowDimensions.get(row)?.hidden);
  const columnIndex = new Map(
    columns.map((column, index) => [column, index]),
  );
  const rowIndex = new Map(rows.map((row, index) => [row, index]));
  const columnWidths = columns.map(
    (column) =>
      bounds.columnDimensions.get(column)?.widthPixels ??
      DEFAULT_COLUMN_WIDTH,
  );
  const naturalGridWidth =
    44 + columnWidths.reduce((sum, width) => sum + width, 0);
  const mergedByPosition = new Map<
    string,
    {
      anchor: string;
      source: WorkbookCell | undefined;
      rowSpan: number;
      columnSpan: number;
    }
  >();
  for (const range of sheet.mergedRanges ?? []) {
    const visibleRows = rows.filter(
      (row) => row >= range.firstRow && row <= range.lastRow,
    );
    const visibleColumns = columns.filter(
      (column) =>
        column >= range.firstColumn && column <= range.lastColumn,
    );
    if (visibleRows.length === 0 || visibleColumns.length === 0) continue;
    const anchor = `${visibleRows[0]}:${visibleColumns[0]}`;
    const source = bounds.byPosition.get(
      `${range.firstRow}:${range.firstColumn}`,
    );
    for (const row of visibleRows) {
      for (const column of visibleColumns) {
        mergedByPosition.set(`${row}:${column}`, {
          anchor,
          source,
          rowSpan: visibleRows.length,
          columnSpan: visibleColumns.length,
        });
      }
    }
  }
  const selectedCell =
    selected?.sheetId === sheet.sheetId
      ? sheet.cells.find((cell) => cell.address === selected.address) ?? null
      : null;
  const activeEditableCount = editableCountBySheet.get(sheet.sheetId) ?? 0;
  const activeFilteredEditableCount =
    filteredEditableCountBySheet.get(sheet.sheetId) ?? 0;

  const fitToWidth = () => {
    const viewportWidth = gridScrollRef.current?.clientWidth;
    if (!viewportWidth || naturalGridWidth <= 0) return;
    setZoom(
      Math.max(
        0.55,
        Math.min(1.25, Number(((viewportWidth - 8) / naturalGridWidth).toFixed(2))),
      ),
    );
  };

  const pasteChanges = async (
    startCell: WorkbookCell,
    text: string,
  ) => {
    const matrix = text
      .replace(/\r/g, "")
      .split("\n")
      .filter((row, index, all) => row !== "" || index < all.length - 1)
      .map((row) => row.split("\t"));
    const changes: Change[] = [];
    for (const [rowOffset, values] of matrix.entries()) {
      for (const [columnOffset, value] of values.entries()) {
        const cell = bounds.byPosition.get(
          `${startCell.row + rowOffset}:${startCell.column + columnOffset}`,
        );
        if (!cell?.editable) {
          onLocalError(
            "붙여넣기 범위에 읽기 전용 셀이 있어 전체 변경을 취소했습니다.",
          );
          return false;
        }
        changes.push(cellChange(cell, sheet.sheetId, value.trim()));
      }
    }
    return changes.length > 0 && onCommit(changes);
  };

  return (
    <section
      className="phase5-workbook-host"
      aria-label="Excel workbook 입력 영역"
    >
      <div className="phase5-name-box" aria-live="polite">
        <b>{selectedCell?.address ?? "—"}</b>
        <span>
          {sheet.name} · {sheet.usedRange}
        </span>
        <em className={activeEditableCount > 0 ? "is-editable" : ""}>
          {activeEditableCount > 0
            ? impactFilter === "all"
              ? `사용자 입력 ${activeEditableCount}개`
              : `필터 결과 ${activeFilteredEditableCount}개`
            : "읽기 전용 시트"}
        </em>
      </div>
      <div
        className="phase5-impact-filters"
        role="group"
        aria-label="입력 셀 영향 범위"
      >
        <span>입력 영향</span>
        {impactFilters.map((filter) => {
          const count = model.editableCells.filter((cell) =>
            matchesImpact(cell.impactTypes, filter.key),
          ).length;
          return (
            <button
              key={filter.key}
              type="button"
              aria-pressed={impactFilter === filter.key}
              onClick={() => setImpactFilter(filter.key)}
            >
              {filter.label} <small>{count}</small>
            </button>
          );
        })}
        {model.dependencyAnalysis.status === "partial" && (
          <em title={model.dependencyAnalysis.warnings.join("\n")}>
            일부 수식 추적 제한
          </em>
        )}
      </div>
      <div className="phase5-grid-pager" aria-label="Workbook 표시 범위">
        <span>
          {safeRowStart}:{rowEnd}행 · {columnName(safeColumnStart)}:
          {columnName(columnEnd)}열
        </span>
        <div className="phase5-grid-tools">
          <div className="phase5-grid-zoom" aria-label="Workbook 배율">
            <button
              type="button"
              aria-label="Workbook 축소"
              disabled={zoom <= 0.55}
              onClick={() =>
                setZoom((value) =>
                  Math.max(0.55, Number((value - 0.1).toFixed(2))),
                )
              }
            >
              −
            </button>
            <button type="button" onClick={() => setZoom(1)}>
              {Math.round(zoom * 100)}%
            </button>
            <button
              type="button"
              aria-label="Workbook 확대"
              disabled={zoom >= 1.5}
              onClick={() =>
                setZoom((value) =>
                  Math.min(1.5, Number((value + 0.1).toFixed(2))),
                )
              }
            >
              +
            </button>
            <button type="button" onClick={fitToWidth}>
              화면 맞춤
            </button>
          </div>
          <div className="phase5-grid-pages">
            <button
              type="button"
              disabled={safeRowStart <= bounds.minRow}
              onClick={() => setRowStart((value) => value - PAGE_ROWS)}
            >
              이전 행
            </button>
            <button
              type="button"
              disabled={rowEnd >= bounds.maxRow}
              onClick={() => setRowStart((value) => value + PAGE_ROWS)}
            >
              다음 행
            </button>
            <button
              type="button"
              disabled={safeColumnStart <= bounds.minColumn}
              onClick={() =>
                setColumnStart((value) => value - PAGE_COLUMNS)
              }
            >
              이전 열
            </button>
            <button
              type="button"
              disabled={columnEnd >= bounds.maxColumn}
              onClick={() =>
                setColumnStart((value) => value + PAGE_COLUMNS)
              }
            >
              다음 열
            </button>
          </div>
        </div>
      </div>
      <div
        ref={gridScrollRef}
        className="phase5-grid-scroll"
        tabIndex={0}
        aria-label={`${sheet.name} 시트, 범위 이동 버튼으로 전체 셀을 확인할 수 있습니다.`}
      >
        <div
          className="phase5-grid"
          role="grid"
          aria-rowcount={bounds.maxRow - bounds.minRow + 1}
          aria-colcount={bounds.maxColumn - bounds.minColumn + 1}
          style={{
            gridTemplateColumns: [
              `${44 * zoom}px`,
              ...columnWidths.map((width) => `${width * zoom}px`),
            ].join(" "),
          }}
        >
          <div
            className="phase5-grid-corner"
            aria-hidden="true"
            style={{ gridColumn: 1, gridRow: 1 }}
          />
          {columns.map((column, index) => (
            <div
              key={column}
              role="columnheader"
              className="phase5-grid-header"
              style={{
                gridColumn: index + 2,
                gridRow: 1,
                minHeight: `${31 * zoom}px`,
              }}
            >
              {columnName(column)}
            </div>
          ))}
          {rows.map((row) => (
            <div
              key={`row-${row}`}
              className="phase5-grid-row-fragment"
              role="row"
              aria-rowindex={row}
            >
              <div
                role="rowheader"
                className="phase5-grid-header"
                style={{
                  gridColumn: 1,
                  gridRow: (rowIndex.get(row) ?? 0) + 2,
                  height: `${
                    (bounds.rowDimensions.get(row)?.heightPixels ??
                      DEFAULT_ROW_HEIGHT) * zoom
                  }px`,
                }}
              >
                {row}
              </div>
              {columns.map((column) => {
                const position = `${row}:${column}`;
                const merged = mergedByPosition.get(position);
                if (merged && merged.anchor !== position) return null;
                const cell =
                  merged?.source ?? bounds.byPosition.get(position);
                const rowHeight =
                  (bounds.rowDimensions.get(row)?.heightPixels ??
                    DEFAULT_ROW_HEIGHT) * zoom;
                const placement = {
                  gridColumn: `${(columnIndex.get(column) ?? 0) + 2} / span ${
                    merged?.columnSpan ?? 1
                  }`,
                  gridRow: `${(rowIndex.get(row) ?? 0) + 2} / span ${
                    merged?.rowSpan ?? 1
                  }`,
                  minHeight: `${rowHeight}px`,
                };
                if (!cell) {
                  return (
                    <div
                      key={`${row}-${column}`}
                      role="gridcell"
                      className="phase5-grid-cell is-empty"
                      style={placement}
                    />
                  );
                }
                const isSelected =
                  selected?.sheetId === sheet.sheetId &&
                  selected.address === cell.address;
                const impact = editableMetadata.get(
                  `${sheet.sheetId}:${cell.address}`,
                );
                const isImpactMuted =
                  cell.editable &&
                  impactFilter !== "all" &&
                  !matchesImpact(
                    impact?.impactTypes ?? ["unmapped"],
                    impactFilter,
                  );
                const style: CSSProperties = {
                  ...placement,
                  fontWeight: cell.bold ? 650 : 450,
                  fontStyle: cell.italic ? "italic" : "normal",
                  fontSize: `${Math.max(
                    8,
                    (cell.fontSize ?? 11) * zoom,
                  )}px`,
                  backgroundColor: cell.editable
                    ? editableColor(cell.fill, "#fff2cc")
                    : editableColor(cell.fill, "#ffffff"),
                  color: cell.editable
                    ? editableColor(cell.fontColor, "#0000ff")
                    : editableColor(cell.fontColor, "#111410"),
                  textAlign: horizontalAlignment(
                    cell.horizontalAlignment,
                    cell.valueType,
                  ),
                  justifyContent: horizontalJustification(
                    cell.horizontalAlignment,
                    cell.valueType,
                  ),
                  alignItems: verticalAlignment(cell.verticalAlignment),
                  whiteSpace: cell.wrapText ? "normal" : "nowrap",
                  borderTop: visibleBorder(cell.borderTop),
                  borderRight: visibleBorder(cell.borderRight),
                  borderBottom: visibleBorder(cell.borderBottom),
                  borderLeft: visibleBorder(cell.borderLeft),
                };
                return (
                  <div
                    key={`${sheet.sheetId}:${cell.address}`}
                    role="gridcell"
                    aria-selected={isSelected}
                    aria-readonly={!cell.editable}
                    className={[
                      "phase5-grid-cell",
                      cell.editable ? "is-editable" : "is-readonly",
                      cell.wrapText ? "is-wrapped" : "",
                      merged ? "is-merged" : "",
                      isImpactMuted ? "is-impact-muted" : "",
                      isSelected ? "is-selected" : "",
                    ].join(" ")}
                    style={style}
                    onClick={() =>
                      onSelected(cell, sheet.sheetId, sheet.name)
                    }
                  >
                    {cell.editable ? (
                      <EditableCell
                        key={`${sheet.sheetId}:${cell.address}:${cell.rawValue ?? ""}`}
                        cell={cell}
                        disabled={disabled}
                        row={row}
                        column={column}
                        onSelect={() =>
                          onSelected(cell, sheet.sheetId, sheet.name)
                        }
                        onCommit={(value) =>
                          onCommit([
                            cellChange(cell, sheet.sheetId, value),
                          ])
                        }
                        onPaste={(value) => pasteChanges(cell, value)}
                      />
                    ) : (
                      <button
                        type="button"
                        data-row={row}
                        data-column={column}
                        onKeyDown={(event) =>
                          focusGridCell(event, row, column)
                        }
                        onClick={() =>
                          onSelected(cell, sheet.sheetId, sheet.name)
                        }
                      >
                        {cell.formattedText}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
      <div className="phase5-tablet-cell-editor">
        {selectedCell?.editable ? (
          <label>
            <span>
              {selectedCell.label || selectedCell.address}
              <small>
                {sheet.name}!{selectedCell.address}
              </small>
            </span>
            <EditableCell
              key={`tablet:${model.workbookVersion}:${sheet.sheetId}:${selectedCell.address}:${selectedCell.rawValue ?? ""}`}
              cell={selectedCell}
              disabled={disabled}
              onSelect={() =>
                onSelected(selectedCell, sheet.sheetId, sheet.name)
              }
              onCommit={(value) =>
                onCommit([
                  cellChange(selectedCell, sheet.sheetId, value),
                ])
              }
            />
          </label>
        ) : (
          <p>편집할 셀을 선택해주세요.</p>
        )}
      </div>
      <nav className="phase5-sheet-tabs" aria-label="Excel 시트">
        {visibleSheets.map((item) => {
          const editableCount =
            editableCountBySheet.get(item.sheetId) ?? 0;
          const filteredCount =
            filteredEditableCountBySheet.get(item.sheetId) ?? 0;
          return (
            <button
              key={item.sheetId}
              type="button"
              className={
                [
                  editableCount > 0 ? "has-editable-cells" : "",
                  impactFilter !== "all" && filteredCount === 0
                    ? "is-impact-muted"
                    : "",
                ].filter(Boolean).join(" ") || undefined
              }
              aria-label={
                editableCount > 0
                  ? `${item.name}, 사용자 입력 셀 ${editableCount}개`
                  : `${item.name}, 읽기 전용`
              }
              aria-pressed={item.sheetId === sheet.sheetId}
              onClick={() => {
                setActiveSheetId(item.sheetId);
                setRowStart(1);
                setColumnStart(1);
              }}
            >
              <span>{item.name}</span>
              {editableCount > 0 && (
                <small>
                  입력 {impactFilter === "all" ? editableCount : filteredCount}
                </small>
              )}
            </button>
          );
        })}
      </nav>
      <div className="phase5-mobile-inputs">
        <h3>입력 가능한 셀</h3>
        {model.editableCells
          .filter((editable) =>
            matchesImpact(editable.impactTypes, impactFilter),
          )
          .map((editable) => {
          const sourceSheet = model.sheets.find(
            (item) => item.sheetId === editable.sheetId,
          );
          const cell = sourceSheet?.cells.find(
            (item) => item.address === editable.address,
          );
          if (!cell) return null;
          return (
            <label key={`${editable.sheetId}:${editable.address}`}>
              <span>
                {editable.label || editable.address}
                <small>
                  {editable.sheetName}!{editable.address}
                </small>
              </span>
              <EditableCell
                key={`mobile:${model.workbookVersion}:${editable.sheetId}:${editable.address}:${cell.rawValue ?? ""}`}
                cell={cell}
                disabled={disabled}
                onSelect={() =>
                  onSelected(cell, editable.sheetId, editable.sheetName)
                }
                onCommit={(value) =>
                  onCommit([
                    cellChange(cell, editable.sheetId, value),
                  ])
                }
              />
            </label>
          );
          })}
      </div>
    </section>
  );
}
