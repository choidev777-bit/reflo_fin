"use client";

import styles from "./phase6.module.css";
import type { ReportTableSnapshot } from "./types";

export function ReportTablePreview({
  label,
  data,
}: {
  label: string;
  data: ReportTableSnapshot;
}) {
  const columnCount = Math.max(
    data.headers.length,
    data.columns.length,
    data.rows[0]?.cells.length ?? 0,
    1,
  );
  const gridTemplateColumns =
    columnCount === 1
      ? "minmax(0, 1fr)"
      : `minmax(52px, 1.6fr) repeat(${columnCount - 1}, minmax(0, 1fr))`;
  const headers =
    data.headers.length > 0
      ? data.headers.map((cell) => cell.formattedText)
      : data.columns.map((column) => column.label);

  return (
    <span className={styles.pdfTableReplacement}>
      <span className={styles.pdfTableReplacementTitle}>{label}</span>
      <span
        className={styles.pdfTableGrid}
        style={{ gridTemplateColumns }}
        role="presentation"
      >
        {headers.map((header, index) => (
          <span
            key={`header-${data.columns[index]?.address ?? index}`}
            className={styles.pdfTableHeaderCell}
          >
            {header || "\u00a0"}
          </span>
        ))}
        {data.rows.flatMap((row) =>
          row.cells.map((cell, index) => (
            <span
              key={`${row.rowNumber}-${cell.address}`}
              className={styles.pdfTableCell}
              data-row-key={index === 0}
            >
              {cell.formattedText || "\u00a0"}
            </span>
          )),
        )}
      </span>
    </span>
  );
}
