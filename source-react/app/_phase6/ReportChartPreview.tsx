"use client";

import styles from "./phase6.module.css";
import type {
  ReportBlock,
  ReportChartSnapshot,
  ReportChartType,
  ReportRenderAsset,
} from "./types";

export const reportChartOptions: Array<{
  value: ReportChartType;
  title: string;
  description: string;
}> = [
  {
    value: "line",
    title: "선 그래프",
    description: "기간별 흐름과 밴드 변화를 비교합니다.",
  },
  {
    value: "bar",
    title: "막대 그래프",
    description: "기간·항목별 규모 차이를 강조합니다.",
  },
  {
    value: "area",
    title: "영역 그래프",
    description: "한 지표의 규모와 추세를 함께 보여줍니다.",
  },
  {
    value: "combo",
    title: "혼합 그래프",
    description: "막대와 선으로 서로 다른 지표를 비교합니다.",
  },
];

export function inferReportChartType(block: ReportBlock): ReportChartType {
  const snapshot =
    block.materializedData?.kind === "chart"
      ? block.materializedData
      : null;
  if (
    block.chartType &&
    (!snapshot || snapshot.supportedChartTypes.includes(block.chartType))
  ) {
    return block.chartType;
  }
  if (snapshot?.supportedChartTypes[0]) {
    return snapshot.supportedChartTypes[0];
  }
  if (/비중|제품별|어플리케이션|소켓.*비소켓/i.test(block.label)) {
    return "bar";
  }
  if (/영업이익|실적|OPM|시가총액/i.test(block.label)) return "combo";
  return "line";
}

export function ReportChartPreview({
  type,
  data,
  asset,
}: {
  type: ReportChartType;
  data?: ReportChartSnapshot | null;
  asset?: ReportRenderAsset | null;
}) {
  if (!data || data.status !== "ready") {
    return (
      <div className={styles.chartPreviewEmpty}>
        <span>연결된 데이터가 준비되지 않았습니다.</span>
      </div>
    );
  }

  if (!asset) {
    return (
      <div className={styles.chartPreviewEmpty}>
        <span>승인된 렌더 자산이 없습니다.</span>
      </div>
    );
  }

  return (
    <object
      className={styles.chartPreviewSvg}
      data={`data:${asset.mediaType};charset=utf-8,${encodeURIComponent(asset.svg)}`}
      type={asset.mediaType}
      aria-label={`${type} 그래프 미리보기`}
      data-scene-hash={asset.sceneHash}
      data-renderer-version={asset.rendererVersion}
    />
  );
}
