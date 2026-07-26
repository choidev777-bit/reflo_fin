"use client";

import { ChartNoAxesCombined, Check, Database, ExternalLink } from "lucide-react";
import { useState } from "react";
import {
  inferReportChartType,
  ReportChartPreview,
  reportChartOptions,
} from "./ReportChartPreview";
import styles from "./phase6.module.css";
import type { ReportBlock, ReportChartType } from "./types";

export function ReportChartEditor({
  block,
  pending,
  onApply,
  onInspectConnection,
}: {
  block: ReportBlock;
  pending: boolean;
  onApply: (chartType: ReportChartType) => void;
  onInspectConnection: () => void;
}) {
  const currentType = inferReportChartType(block);
  const [draft, setDraft] = useState<ReportChartType>(currentType);
  const snapshot =
    block.materializedData?.kind === "chart"
      ? block.materializedData
      : null;
  const connectionReady =
    block.dataBinding?.status === "confirmed" &&
    snapshot?.status === "ready";
  const options =
    snapshot?.status === "ready"
      ? reportChartOptions.filter((option) =>
          snapshot.supportedChartTypes.includes(option.value),
        )
      : [];

  const source =
    block.dataBinding?.sourceLabel ??
    block.dataBinding?.sourceAddress ??
    "연결할 Excel 시트를 지정해야 합니다.";
  const status =
    block.dataBinding?.status === "confirmed"
      ? "연결 완료"
      : block.dataBinding?.status === "suggested"
        ? "연결 제안"
        : block.dataBinding?.status === "invalid"
          ? "연결 오류"
          : "연결 필요";

  return (
    <div className={styles.panelSection}>
      <div className={styles.chartEditorTarget}>
        <span className={styles.chartEditorIcon}>
          <ChartNoAxesCombined size={18} />
        </span>
        <div>
          <small>선택한 그래프</small>
          <strong>{block.label}</strong>
        </div>
      </div>

      <div
        className={styles.chartSourceCard}
        data-status={block.dataBinding?.status ?? "unmapped"}
      >
        <Database size={15} />
        <div>
          <span>Excel 데이터 · {status}</span>
          <strong>{source}</strong>
        </div>
        <button
          type="button"
          className={styles.chartConnectionButton}
          onClick={onInspectConnection}
        >
          <ExternalLink size={13} />
          연결 확인
        </button>
      </div>

      <div className={styles.chartEditorHeading}>
        <div>
          <p className={styles.panelLabel}>그래프 형태</p>
          <span>
            {connectionReady
              ? "연결된 값은 유지하고 선택한 그래프만 변경합니다."
              : "연결된 데이터를 확인한 뒤 형태를 변경할 수 있습니다."}
          </span>
        </div>
        <strong>{options.length}개 형태</strong>
      </div>

      {options.length > 0 ? (
        <div
          className={styles.reportChartOptionGrid}
          role="group"
          aria-label="그래프 형태"
        >
          {options.map((option) => {
            const selected = draft === option.value;
            return (
              <button
                type="button"
                key={option.value}
                className={styles.reportChartOption}
                data-selected={selected}
                aria-pressed={selected}
                onClick={() => setDraft(option.value)}
              >
                <span className={styles.reportChartOptionPreview}>
                  <ReportChartPreview
                    type={option.value}
                    data={snapshot}
                    asset={block.renderAssets?.[option.value]}
                  />
                </span>
                <span className={styles.reportChartOptionCopy}>
                  <strong>{option.title}</strong>
                  <small>{option.description}</small>
                </span>
                {selected && (
                  <span className={styles.reportChartSelected}>
                    <Check size={12} /> 선택
                  </span>
                )}
              </button>
            );
          })}
        </div>
      ) : (
        <div className={styles.chartOptionBlocked} role="status">
          <Database size={17} />
          <div>
            <strong>그래프 데이터 확인이 먼저 필요합니다.</strong>
            <span>
              연결 확인에서 승인된 Excel 버전과 category·series 범위를
              확인해 주세요.
            </span>
          </div>
        </div>
      )}

      <div className={styles.chartEditorActions}>
        <span>
          {connectionReady
            ? `Workbook v${snapshot.provenance.workbookVersion}의 category·series를 그대로 사용합니다.`
            : "현재 블록은 물질화된 Excel 데이터가 없어 적용할 수 없습니다."}
        </span>
        <button
          type="button"
          className={styles.limeButton}
          disabled={pending || !connectionReady || draft === currentType}
          onClick={() => onApply(draft)}
        >
          {draft === currentType ? "현재 형태" : "선택한 형태 적용"}
        </button>
      </div>
    </div>
  );
}
