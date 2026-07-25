"use client";

import { useMemo, useState, type KeyboardEvent } from "react";
import type { WorkbookCell, WorkbookReadModel } from "./types";

type Change = {
  sheetId: string;
  address: string;
  valueType: "number" | "string" | "boolean" | "blank";
  value: string | null;
};

const PAGE_ROWS = 60;
const PAGE_COLUMNS = 16;

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

function EditableCell({
  cell,
  disabled,
  onSelect,
  onCommit,
  onPaste,
}: {
  cell: WorkbookCell;
  disabled: boolean;
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
        }
        if (event.key === "Escape") {
          setValue(cell.rawValue ?? "");
          event.currentTarget.blur();
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
  const [activeSheetId, setActiveSheetId] = useState(
    model.sheets[0]?.sheetId ?? "",
  );
  const [rowStart, setRowStart] = useState(1);
  const [columnStart, setColumnStart] = useState(1);
  const sheet =
    model.sheets.find((item) => item.sheetId === activeSheetId) ??
    model.sheets[0];

  const bounds = useMemo(() => {
    const cells = sheet?.cells ?? [];
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
  );
  const rows = Array.from(
    { length: rowEnd - safeRowStart + 1 },
    (_, index) => safeRowStart + index,
  );
  const selectedCell =
    selected?.sheetId === sheet.sheetId
      ? sheet.cells.find((cell) => cell.address === selected.address) ?? null
      : null;

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
      </div>
      <div className="phase5-grid-pager" aria-label="Workbook 표시 범위">
        <span>
          {safeRowStart}:{rowEnd}행 · {columnName(safeColumnStart)}:
          {columnName(columnEnd)}열
        </span>
        <div>
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
      <div
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
            gridTemplateColumns: `44px repeat(${columns.length}, minmax(108px, 1fr))`,
          }}
        >
          <div className="phase5-grid-corner" aria-hidden="true" />
          {columns.map((column) => (
            <div key={column} role="columnheader" className="phase5-grid-header">
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
              <div role="rowheader" className="phase5-grid-header">
                {row}
              </div>
              {columns.map((column) => {
                const cell = bounds.byPosition.get(`${row}:${column}`);
                if (!cell) {
                  return (
                    <div
                      key={`${row}-${column}`}
                      role="gridcell"
                      className="phase5-grid-cell is-empty"
                    />
                  );
                }
                const isSelected =
                  selected?.sheetId === sheet.sheetId &&
                  selected.address === cell.address;
                const style = {
                  fontWeight: cell.bold ? 650 : 450,
                  backgroundColor: cell.editable
                    ? "#fff8d6"
                    : editableColor(cell.fill, "#ffffff"),
                  color: editableColor(cell.fontColor, "#111410"),
                };
                return (
                  <div
                    key={`${sheet.sheetId}:${cell.address}`}
                    role="gridcell"
                    aria-selected={isSelected}
                    className={[
                      "phase5-grid-cell",
                      cell.editable ? "is-editable" : "is-readonly",
                      isSelected ? "is-selected" : "",
                    ].join(" ")}
                    style={style}
                    onClick={() =>
                      onSelected(cell, sheet.sheetId, sheet.name)
                    }
                  >
                    {cell.editable ? (
                      <EditableCell
                        key={`${model.workbookVersion}:${sheet.sheetId}:${cell.address}:${cell.rawValue ?? ""}`}
                        cell={cell}
                        disabled={disabled}
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
        {model.sheets.map((item) => (
          <button
            key={item.sheetId}
            type="button"
            aria-pressed={item.sheetId === sheet.sheetId}
            onClick={() => {
              setActiveSheetId(item.sheetId);
              setRowStart(1);
              setColumnStart(1);
            }}
          >
            {item.name}
          </button>
        ))}
      </nav>
      <div className="phase5-mobile-inputs">
        <h3>입력 가능한 셀</h3>
        {model.editableCells.map((editable) => {
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
