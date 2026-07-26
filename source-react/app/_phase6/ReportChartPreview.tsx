"use client";

import styles from "./phase6.module.css";
import type {
  ReportBlock,
  ReportChartSnapshot,
  ReportChartType,
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

type NumericSeries = {
  key: string;
  label: string;
  values: Array<number | null>;
};

const chartColors = ["#274b44", "#75a900", "#9bb99f", "#708a7e", "#b7c99a"];

function numericSeries(data: ReportChartSnapshot): NumericSeries[] {
  return data.series.map((series) => ({
    key: series.seriesId,
    label: series.label,
    values: series.values.map((cell) => {
      if (cell.rawValue === null || cell.rawValue.trim() === "") return null;
      const value = Number(cell.rawValue);
      return Number.isFinite(value) ? value : null;
    }),
  }));
}

function pointPath(
  values: Array<number | null>,
  min: number,
  max: number,
  width: number,
  height: number,
  left: number,
  top: number,
) {
  const span = Math.max(max - min, 1);
  const step = values.length > 1 ? width / (values.length - 1) : 0;
  let open = false;
  return values
    .map((value, index) => {
      if (value === null) {
        open = false;
        return "";
      }
      const x = left + index * step;
      const y = top + height - ((value - min) / span) * height;
      const command = open ? "L" : "M";
      open = true;
      return `${command}${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .filter(Boolean)
    .join(" ");
}

function chartExtent(series: NumericSeries[]) {
  const values = series.flatMap((item) =>
    item.values.filter((value): value is number => value !== null),
  );
  if (values.length === 0) return null;
  const lowest = Math.min(...values);
  const highest = Math.max(...values);
  const padding = Math.max((highest - lowest) * 0.08, Math.abs(highest) * 0.02, 1);
  return {
    min: Math.min(0, lowest - padding),
    max: highest + padding,
  };
}

export function ReportChartPreview({
  type,
  data,
}: {
  type: ReportChartType;
  data?: ReportChartSnapshot | null;
}) {
  if (!data || data.status !== "ready") {
    return (
      <div className={styles.chartPreviewEmpty}>
        <span>연결된 데이터가 준비되지 않았습니다.</span>
      </div>
    );
  }

  const series = numericSeries(data);
  const extent = chartExtent(series);
  if (!extent || series.length === 0) {
    return (
      <div className={styles.chartPreviewEmpty}>
        <span>표시할 숫자 계열이 없습니다.</span>
      </div>
    );
  }

  const left = 18;
  const top = 14;
  const plotWidth = 210;
  const plotHeight = 88;
  const categoryCount = Math.max(
    data.categories.length,
    ...series.map((item) => item.values.length),
    1,
  );
  const barGroupWidth = plotWidth / categoryCount;
  const baseline =
    top +
    plotHeight -
    ((0 - extent.min) / Math.max(extent.max - extent.min, 1)) * plotHeight;

  return (
    <svg
      className={styles.chartPreviewSvg}
      viewBox="0 0 240 120"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <g className={styles.chartPreviewGrid}>
        <line x1="18" y1="24" x2="228" y2="24" />
        <line x1="18" y1="50" x2="228" y2="50" />
        <line x1="18" y1="76" x2="228" y2="76" />
        <line x1="18" y1="102" x2="228" y2="102" />
      </g>

      {type === "bar" &&
        Array.from({ length: categoryCount }, (_, categoryIndex) => {
          const positiveTotal = series.reduce(
            (total, item) =>
              total + Math.max(item.values[categoryIndex] ?? 0, 0),
            0,
          );
          let accumulated = 0;
          return series.map((item, seriesIndex) => {
            const value = Math.max(item.values[categoryIndex] ?? 0, 0);
            const height =
              positiveTotal > 0
                ? (value / Math.max(extent.max, positiveTotal, 1)) * plotHeight
                : 0;
            accumulated += height;
            return (
              <rect
                key={`${item.key}-${categoryIndex}`}
                x={left + categoryIndex * barGroupWidth + barGroupWidth * 0.18}
                y={top + plotHeight - accumulated}
                width={Math.max(barGroupWidth * 0.64, 1)}
                height={Math.max(height, 0)}
                fill={chartColors[seriesIndex % chartColors.length]}
              />
            );
          });
        })}

      {type === "area" && series[0] && (
        <>
          <path
            className={styles.chartPreviewAreaFill}
            d={`${pointPath(
              series[0].values,
              extent.min,
              extent.max,
              plotWidth,
              plotHeight,
              left,
              top,
            )} L${left + plotWidth} ${Math.min(Math.max(baseline, top), top + plotHeight)} L${left} ${Math.min(Math.max(baseline, top), top + plotHeight)} Z`}
          />
          <path
            className={styles.chartPreviewPrimaryLine}
            d={pointPath(
              series[0].values,
              extent.min,
              extent.max,
              plotWidth,
              plotHeight,
              left,
              top,
            )}
          />
          {series.slice(1).map((item, index) => (
            <path
              key={item.key}
              className={styles.chartPreviewSeriesLine}
              d={pointPath(
                item.values,
                extent.min,
                extent.max,
                plotWidth,
                plotHeight,
                left,
                top,
              )}
              style={{ stroke: chartColors[(index + 1) % chartColors.length] }}
            />
          ))}
        </>
      )}

      {type === "combo" && series[0] && (
        <>
          {series[0].values.map((value, index) => {
            const numeric = value ?? 0;
            const y =
              top +
              plotHeight -
              ((numeric - extent.min) /
                Math.max(extent.max - extent.min, 1)) *
                plotHeight;
            return (
              <rect
                key={`${series[0].key}-${index}`}
                x={left + index * barGroupWidth + barGroupWidth * 0.2}
                y={Math.min(y, baseline)}
                width={Math.max(barGroupWidth * 0.6, 1)}
                height={Math.abs(baseline - y)}
                fill="#dce8d2"
              />
            );
          })}
          {series.slice(1).map((item, index) => (
            <path
              key={item.key}
              className={styles.chartPreviewSeriesLine}
              d={pointPath(
                item.values,
                extent.min,
                extent.max,
                plotWidth,
                plotHeight,
                left,
                top,
              )}
              style={{ stroke: chartColors[index % chartColors.length] }}
            />
          ))}
        </>
      )}

      {type === "line" &&
        series.map((item, index) => (
          <path
            key={item.key}
            className={
              index === 0
                ? styles.chartPreviewPrimaryLine
                : styles.chartPreviewSeriesLine
            }
            d={pointPath(
              item.values,
              extent.min,
              extent.max,
              plotWidth,
              plotHeight,
              left,
              top,
            )}
            style={{ stroke: chartColors[index % chartColors.length] }}
          />
        ))}
    </svg>
  );
}
