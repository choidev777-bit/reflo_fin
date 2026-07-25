"use client";

import { useMemo, useState } from "react";
import type {
  ExcelTarget,
  ValidationWorkbookManifest,
} from "./types";

export function ValidationWorkbook({
  manifest,
  selectedTargetId,
  onSelectTarget,
}: {
  manifest: ValidationWorkbookManifest;
  selectedTargetId: string | null;
  onSelectTarget: (target: ExcelTarget) => void;
}) {
  const sheetNames = useMemo(
    () =>
      Array.from(
        new Set([
          ...manifest.visibleSheets
            .map((sheet) => sheet.name)
            .filter((name): name is string => Boolean(name)),
          ...manifest.validationTargets.map((target) => target.sheetName),
        ]),
      ),
    [manifest],
  );
  const [activeSheet, setActiveSheet] = useState(
    sheetNames[0] ?? manifest.validationTargets[0]?.sheetName ?? "",
  );
  const visibleTargets = manifest.validationTargets.filter(
    (target) => target.sheetName === activeSheet,
  );
  const selected = manifest.validationTargets.find(
    (target) => target.targetId === selectedTargetId,
  );
  const selectedBinding = manifest.evidenceBindings.find(
    (binding) => binding.targetId === selectedTargetId,
  );

  return (
    <section className="phase4-workbook" aria-label="검증용 Excel workbook">
      <header>
        <div>
          <small>READ-ONLY WORKBOOK</small>
          <strong>분석 workbook 검증 사본</strong>
        </div>
        <span>읽기 전용</span>
      </header>
      <div className="phase4-formula-bar">
        <b>{selected ? `${selected.sheetName}!${selected.address}` : "—"}</b>
        <span>{selectedBinding?.formattedText ?? selected?.metric ?? ""}</span>
      </div>
      <div
        className="phase4-grid"
        role="grid"
        aria-label="검증용 Excel workbook"
        aria-readonly="true"
      >
        <div role="row" className="head">
          <span role="columnheader">셀</span>
          <span role="columnheader">지표</span>
          <span role="columnheader">값</span>
          <span role="columnheader">기간 · 기준</span>
        </div>
        {visibleTargets.map((target) => {
          const binding = manifest.evidenceBindings.find(
            (item) => item.targetId === target.targetId,
          );
          return (
            <button
              type="button"
              role="row"
              aria-selected={selectedTargetId === target.targetId}
              className={selectedTargetId === target.targetId ? "selected" : ""}
              key={target.targetId}
              onClick={() => onSelectTarget(target)}
            >
              <span role="gridcell">{target.address}</span>
              <span role="gridcell">{target.metric}</span>
              <strong role="gridcell">
                {binding?.formattedText ?? "검증 대기"}
              </strong>
              <span role="gridcell">
                {target.period} · {target.scope}
              </span>
            </button>
          );
        })}
        {visibleTargets.length === 0 && (
          <div className="phase4-grid-empty">이 sheet의 검증 대상 셀이 없습니다.</div>
        )}
      </div>
      <nav role="tablist" aria-label="Excel sheet">
        {sheetNames.map((sheet, index) => (
          <button
            type="button"
            role="tab"
            aria-selected={activeSheet === sheet}
            tabIndex={activeSheet === sheet ? 0 : -1}
            className={activeSheet === sheet ? "active" : ""}
            key={sheet}
            onClick={() => setActiveSheet(sheet)}
            onKeyDown={(event) => {
              const direction =
                event.key === "ArrowRight"
                  ? 1
                  : event.key === "ArrowLeft"
                    ? -1
                    : 0;
              if (!direction) return;
              event.preventDefault();
              const next =
                sheetNames[(index + direction + sheetNames.length) % sheetNames.length];
              setActiveSheet(next);
              event.currentTarget.parentElement
                ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
                [sheetNames.indexOf(next)]?.focus();
            }}
          >
            {sheet}
          </button>
        ))}
      </nav>
      <p>{manifest.readOnlyReason}</p>
    </section>
  );
}
