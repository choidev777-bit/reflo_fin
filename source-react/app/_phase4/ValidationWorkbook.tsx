"use client";

import { useMemo, useState } from "react";
import type {
  ExcelTarget,
  ValidationWorkbookManifest,
} from "./types";

function writeStatusLabel(
  status: ValidationWorkbookManifest["evidenceBindings"][number]["writeStatus"],
): string {
  if (status === "applied") return "반영 완료";
  if (status === "applying") return "재계산 중";
  if (status === "blocked") return "반영 차단";
  if (status === "proposed") return "반영 예정";
  return "검증 대기";
}

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
  const applicationStatus = manifest.workbookApplication?.status;
  const workbookStatus =
    applicationStatus === "succeeded"
      ? "검증본 생성 완료"
      : applicationStatus === "queued" || applicationStatus === "running"
        ? "검증본 생성 중"
        : applicationStatus === "failed" ||
            applicationStatus === "obsolete"
          ? "검증본 생성 실패"
          : "적용 전";

  return (
    <section className="phase4-workbook" aria-label="검증용 Excel workbook">
      <header>
        <div>
          <small>READ-ONLY WORKBOOK</small>
          <strong>승인 Evidence 반영 검토</strong>
        </div>
        <span>{workbookStatus}</span>
      </header>
      <div className="phase4-formula-bar">
        <b>{selected ? `${selected.sheetName}!${selected.address}` : "—"}</b>
        <span>
          {selectedBinding
            ? `${selectedBinding.beforeValue ?? "빈 셀"} → ${
                selectedBinding.afterValue ?? "빈 셀"
              } · Evidence ${selectedBinding.evidenceIds.length}건`
            : selected?.metric ?? ""}
        </span>
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
          <span role="columnheader">Before</span>
          <span role="columnheader">After</span>
          <span role="columnheader">Evidence · 상태</span>
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
              <span role="gridcell">{binding?.beforeValue ?? "빈 셀"}</span>
              <strong role="gridcell">
                {binding?.afterValue ?? binding?.formattedText ?? "검증 대기"}
              </strong>
              <span role="gridcell" className="phase4-write-status">
                <b>
                  {binding
                    ? writeStatusLabel(binding.writeStatus)
                    : "검증 대기"}
                </b>
                <small>
                  Evidence {binding?.evidenceIds.length ?? 0}건 ·{" "}
                  {target.period} · {target.scope}
                </small>
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
      <p>
        원본 Workbook은 변경하지 않습니다. 승인된 입력 셀만 새 artifact에
        반영하며, Evidence ID·before/after·재계산 결과를 함께 고정합니다.
      </p>
    </section>
  );
}
