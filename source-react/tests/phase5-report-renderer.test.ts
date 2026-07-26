import assert from "node:assert/strict";
import test from "node:test";
import {
  buildChartScene,
  buildScalarScene,
  buildTableScene,
  renderSceneHash,
  renderSceneToSvg,
  type ChartStyleTemplate,
} from "../server/domain/report-renderer";

const style: ChartStyleTemplate = {
  templateType: "chart",
  chartFamily: "line",
  plotBbox: [20, 18, 220, 112],
  titleBbox: [20, 0, 220, 16],
  captionBbox: [20, 114, 220, 128],
  legendBbox: [20, 114, 220, 128],
  palette: ["#112233", "#86B817", "#778899"],
  seriesStyles: [
    {
      role: "actual",
      stroke: "#112233",
      fill: "#112233",
      dash: [],
      marker: "none",
    },
    {
      role: "forecast",
      stroke: "#86B817",
      fill: "#86B817",
      dash: [3, 2],
      marker: "none",
    },
  ],
  barLayout: { stacking: "none", gapPercent: 100, widthPercent: 70 },
  axes: [
    {
      role: "category",
      position: "bottom",
      scale: "linear",
      tick: "outside",
      numberFormat: "",
    },
    {
      role: "primary",
      position: "left",
      scale: "linear",
      tick: "outside",
      numberFormat: "#,##0.0",
    },
    {
      role: "secondary",
      position: "right",
      scale: "linear",
      tick: "outside",
      numberFormat: "0.0%",
    },
  ],
  gridLines: { visible: true, color: "#E4E8E1", widthPt: 0.5 },
  fonts: ["Pretendard"],
  legendLayout: "horizontal",
  forecastStyle: {
    fontStyle: "normal",
    fill: "#FFFFFF",
    strokeDash: [3, 2],
  },
  approvedAlternativeTypes: ["line", "bar", "area", "combo"],
};

const chartInput = {
  bbox: [0, 0, 240, 130] as [number, number, number, number],
  categories: ["2023", "2024", "2025E"],
  series: [
    {
      seriesId: "sales",
      label: "매출액",
      role: "actual" as const,
      axis: "primary" as const,
      chartType: "bar",
      unit: "KRW mn",
      numberFormat: "#,##0",
      estimateType: "mixed" as const,
      values: ["-10", "20", "30"],
    },
    {
      seriesId: "margin",
      label: "영업이익률",
      role: "forecast" as const,
      axis: "secondary" as const,
      chartType: "line",
      unit: "%",
      numberFormat: "0.0%",
      estimateType: "forecast" as const,
      values: ["0.1", null, "0.25"],
    },
  ],
};

test("canonical renderer produces the same scene and SVG hash for the same input", () => {
  const first = buildChartScene({ ...chartInput, type: "combo", style });
  const second = buildChartScene({ ...chartInput, type: "combo", style });
  assert.deepEqual(first, second);
  assert.equal(renderSceneHash(first), renderSceneHash(second));
  assert.equal(renderSceneToSvg(first), renderSceneToSvg(second));
});

test("renderer supports line, area, grouped/stacked bar, combo, band and secondary axis", () => {
  const variants = [
    ["line", style],
    ["area", style],
    ["bar", style],
    [
      "bar",
      {
        ...style,
        barLayout: { ...style.barLayout, stacking: "stacked" as const },
      },
    ],
    ["combo", style],
  ] as const;
  for (const [type, variantStyle] of variants) {
    const scene = buildChartScene({
      ...chartInput,
      type,
      style: variantStyle,
    });
    assert.ok(scene.primitives.length > 0, type);
    assert.match(renderSceneToSvg(scene), /^<svg/);
  }

  const band = buildChartScene({
    ...chartInput,
    type: "line",
    style: { ...style, chartFamily: "line_band" },
    series: [
      {
        ...chartInput.series[0],
        seriesId: "upper",
        role: "band_upper",
        values: ["20", "30", "40"],
      },
      {
        ...chartInput.series[0],
        seriesId: "lower",
        role: "band_lower",
        values: ["10", "15", "20"],
      },
      chartInput.series[0],
    ],
  });
  assert.ok(band.primitives.some((item) => item.kind === "path" && item.fill !== "none"));
  assert.ok(
    buildChartScene({ ...chartInput, type: "combo", style }).metadata.axes.includes(
      "secondary",
    ),
  );
});

test("renderer preserves style palette/font/line/legend/axis/spacing without browser CSS", () => {
  const svg = renderSceneToSvg(
    buildChartScene({ ...chartInput, type: "line", style }),
  );
  assert.match(svg, /#112233/);
  assert.match(svg, /#86B817/);
  assert.match(svg, /Pretendard/);
  assert.match(svg, /stroke-dasharray="3 2"/);
  assert.doesNotMatch(svg, /class=/);
});

test("scalar and table scenes handle negative, blank, percent and multiple values", () => {
  const scalar = buildScalarScene({
    bbox: [0, 0, 100, 20],
    formattedValue: "-12.5%",
    style: {
      fontRef: "Pretendard",
      fontSizePt: 10,
      color: "#112233",
      weight: 700,
      alignment: "right",
      bbox: [0, 0, 100, 20],
    },
  });
  assert.match(renderSceneToSvg(scalar), /-12.5%/);

  const table = buildTableScene({
    bbox: [0, 0, 120, 60],
    matrix: [["PER", "12.0x"], ["빈 값", ""]],
    style: {
      fontRef: "Pretendard",
      fontSizePt: 8,
      color: "#112233",
      borderColor: "#E4E8E1",
      fill: "#FFFFFF",
    },
  });
  const svg = renderSceneToSvg(table);
  assert.match(svg, /12.0x/);
  assert.match(svg, /빈 값/);
});
