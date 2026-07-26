import { contentHash, sha256 } from "./hash";

export type Bbox = [number, number, number, number];
export type ReportRenderChartType = "line" | "bar" | "area" | "combo";

export type ChartStyleTemplate = {
  templateType: "chart";
  chartFamily: string;
  plotBbox: Bbox;
  titleBbox: Bbox;
  captionBbox: Bbox;
  legendBbox: Bbox;
  palette: string[];
  seriesStyles: Array<{
    role: string;
    stroke: string;
    fill: string;
    dash: number[];
    marker: string;
  }>;
  barLayout: {
    stacking: "none" | "stacked" | "percent";
    gapPercent: number;
    widthPercent: number;
  };
  axes: Array<{
    role: string;
    position: string;
    scale: string;
    tick: string;
    numberFormat: string;
  }>;
  gridLines: { visible: boolean; color: string; widthPt: number };
  fonts: string[];
  legendLayout: string;
  forecastStyle: {
    fontStyle: string;
    fill: string;
    strokeDash: number[];
  };
  approvedAlternativeTypes: string[];
};

export type RenderPrimitive =
  | {
      kind: "line";
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      stroke: string;
      strokeWidth: number;
      dash: number[];
    }
  | {
      kind: "rect";
      x: number;
      y: number;
      width: number;
      height: number;
      fill: string;
      stroke: string;
      strokeWidth: number;
    }
  | {
      kind: "path";
      d: string;
      fill: string;
      fillOpacity: number;
      stroke: string;
      strokeWidth: number;
      dash: number[];
    }
  | {
      kind: "text";
      x: number;
      y: number;
      text: string;
      fill: string;
      fontFamily: string;
      fontSize: number;
      fontWeight: number;
      textAnchor: "start" | "middle" | "end";
    };

export type RenderScene = {
  schemaVersion: "1.0";
  rendererVersion: "reflo-svg-1";
  bbox: Bbox;
  primitives: RenderPrimitive[];
  metadata: {
    kind: "scalar" | "table" | "chart";
    variant: string;
    axes: string[];
  };
};

type RenderSeries = {
  seriesId: string;
  label: string;
  role: string;
  axis: "primary" | "secondary";
  chartType: string;
  unit: string | null;
  numberFormat: string;
  estimateType: string;
  values: Array<string | null>;
};

function rounded(value: number): number {
  return Number(value.toFixed(4));
}

function numeric(value: string | null): number | null {
  if (value === null || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function extent(series: RenderSeries[], axis: "primary" | "secondary") {
  const values = series
    .filter((item) => item.axis === axis)
    .flatMap((item) => item.values.map(numeric))
    .filter((value): value is number => value !== null);
  if (values.length === 0) return { min: 0, max: 1 };
  const low = Math.min(...values);
  const high = Math.max(...values);
  const padding = Math.max((high - low) * 0.08, Math.abs(high) * 0.02, 1e-6);
  return {
    min: Math.min(0, low - padding),
    max: Math.max(0, high + padding),
  };
}

function scaleY(
  value: number,
  range: { min: number; max: number },
  plot: Bbox,
): number {
  const span = Math.max(range.max - range.min, 1e-12);
  return rounded(
    plot[3] - ((value - range.min) / span) * (plot[3] - plot[1]),
  );
}

function pointPath(
  values: Array<string | null>,
  range: { min: number; max: number },
  plot: Bbox,
): string {
  const width = plot[2] - plot[0];
  const step = values.length > 1 ? width / (values.length - 1) : 0;
  let open = false;
  return values
    .map((raw, index) => {
      const value = numeric(raw);
      if (value === null) {
        open = false;
        return "";
      }
      const command = open ? "L" : "M";
      open = true;
      return `${command}${rounded(plot[0] + index * step)} ${scaleY(value, range, plot)}`;
    })
    .filter(Boolean)
    .join(" ");
}

function styleForSeries(style: ChartStyleTemplate, series: RenderSeries, index: number) {
  const roleStyle = style.seriesStyles.find((item) => item.role === series.role);
  const paletteColor = style.palette[index % Math.max(style.palette.length, 1)];
  const color = paletteColor ?? "#000000";
  return {
    stroke: roleStyle?.stroke ?? color,
    fill: roleStyle?.fill ?? color,
    dash:
      roleStyle?.dash ??
      (series.estimateType === "forecast"
        ? style.forecastStyle.strokeDash
        : []),
  };
}

function linePrimitive(
  series: RenderSeries,
  index: number,
  style: ChartStyleTemplate,
  range: { min: number; max: number },
): RenderPrimitive {
  const seriesStyle = styleForSeries(style, series, index);
  return {
    kind: "path",
    d: pointPath(series.values, range, style.plotBbox),
    fill: "none",
    fillOpacity: 1,
    stroke: seriesStyle.stroke,
    strokeWidth: 1.5,
    dash: seriesStyle.dash,
  };
}

function barPrimitives(
  series: RenderSeries[],
  style: ChartStyleTemplate,
  ranges: Record<"primary" | "secondary", { min: number; max: number }>,
): RenderPrimitive[] {
  const count = Math.max(...series.map((item) => item.values.length), 1);
  const groupWidth = (style.plotBbox[2] - style.plotBbox[0]) / count;
  const usableWidth =
    groupWidth * Math.min(Math.max(style.barLayout.widthPercent / 100, 0.05), 1);
  const stacked = style.barLayout.stacking !== "none";
  const bars: RenderPrimitive[] = [];

  for (let category = 0; category < count; category += 1) {
    const offsets = new Map<string, { positive: number; negative: number }>();
    series.forEach((item, seriesIndex) => {
      const value = numeric(item.values[category] ?? null);
      if (value === null) return;
      const range = ranges[item.axis];
      const key = item.axis;
      const current = offsets.get(key) ?? { positive: 0, negative: 0 };
      const startValue = stacked
        ? value >= 0
          ? current.positive
          : current.negative
        : 0;
      const endValue = startValue + value;
      if (stacked) {
        if (value >= 0) current.positive = endValue;
        else current.negative = endValue;
        offsets.set(key, current);
      }
      const y1 = scaleY(startValue, range, style.plotBbox);
      const y2 = scaleY(endValue, range, style.plotBbox);
      const width = stacked ? usableWidth : usableWidth / series.length;
      const x =
        style.plotBbox[0] +
        category * groupWidth +
        (groupWidth - usableWidth) / 2 +
        (stacked ? 0 : seriesIndex * width);
      const itemStyle = styleForSeries(style, item, seriesIndex);
      bars.push({
        kind: "rect",
        x: rounded(x),
        y: Math.min(y1, y2),
        width: rounded(Math.max(width, 0.25)),
        height: rounded(Math.abs(y2 - y1)),
        fill: itemStyle.fill,
        stroke: itemStyle.stroke,
        strokeWidth: 0,
      });
    });
  }
  return bars;
}

function bandPrimitive(
  upper: RenderSeries,
  lower: RenderSeries,
  style: ChartStyleTemplate,
  range: { min: number; max: number },
): RenderPrimitive {
  const count = Math.max(upper.values.length, lower.values.length);
  const width = style.plotBbox[2] - style.plotBbox[0];
  const step = count > 1 ? width / (count - 1) : 0;
  const upperPoints: string[] = [];
  const lowerPoints: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const upperValue = numeric(upper.values[index] ?? null);
    const lowerValue = numeric(lower.values[index] ?? null);
    if (upperValue === null || lowerValue === null) continue;
    const x = rounded(style.plotBbox[0] + index * step);
    upperPoints.push(`${x} ${scaleY(upperValue, range, style.plotBbox)}`);
    lowerPoints.unshift(`${x} ${scaleY(lowerValue, range, style.plotBbox)}`);
  }
  const color = styleForSeries(style, upper, 0).fill;
  return {
    kind: "path",
    d:
      upperPoints.length === 0
        ? ""
        : `M${upperPoints.join(" L")} L${lowerPoints.join(" L")} Z`,
    fill: color,
    fillOpacity: 0.16,
    stroke: "none",
    strokeWidth: 0,
    dash: [],
  };
}

export function buildChartScene(input: {
  bbox: Bbox;
  categories: string[];
  series: RenderSeries[];
  type: ReportRenderChartType;
  style: ChartStyleTemplate;
}): RenderScene {
  const ranges = {
    primary: extent(input.series, "primary"),
    secondary: extent(input.series, "secondary"),
  };
  const primitives: RenderPrimitive[] = [];

  if (input.style.gridLines.visible) {
    for (let index = 0; index <= 4; index += 1) {
      const y =
        input.style.plotBbox[1] +
        ((input.style.plotBbox[3] - input.style.plotBbox[1]) * index) / 4;
      primitives.push({
        kind: "line",
        x1: input.style.plotBbox[0],
        y1: rounded(y),
        x2: input.style.plotBbox[2],
        y2: rounded(y),
        stroke: input.style.gridLines.color,
        strokeWidth: input.style.gridLines.widthPt,
        dash: [],
      });
    }
  }

  const bandUpper = input.series.find((item) => item.role === "band_upper");
  const bandLower = input.series.find((item) => item.role === "band_lower");
  if (
    input.style.chartFamily === "line_band" &&
    bandUpper &&
    bandLower
  ) {
    primitives.push(bandPrimitive(bandUpper, bandLower, input.style, ranges.primary));
  }

  if (input.type === "bar") {
    primitives.push(...barPrimitives(input.series, input.style, ranges));
  } else if (input.type === "combo") {
    const bars = input.series.filter(
      (item, index) => item.chartType === "bar" || index === 0,
    );
    const lines = input.series.filter((item) => !bars.includes(item));
    primitives.push(...barPrimitives(bars, input.style, ranges));
    lines.forEach((item, index) =>
      primitives.push(
        linePrimitive(item, index + bars.length, input.style, ranges[item.axis]),
      ),
    );
  } else {
    input.series.forEach((item, index) => {
      const line = linePrimitive(
        item,
        index,
        input.style,
        ranges[item.axis],
      );
      if (input.type === "area" && index === 0 && line.kind === "path") {
        const baseline = scaleY(0, ranges[item.axis], input.style.plotBbox);
        primitives.push({
          ...line,
          d: `${line.d} L${input.style.plotBbox[2]} ${baseline} L${input.style.plotBbox[0]} ${baseline} Z`,
          fill: styleForSeries(input.style, item, index).fill,
          fillOpacity: 0.16,
        });
      }
      primitives.push(line);
    });
  }

  if (input.style.legendLayout !== "hidden") {
    const font = input.style.fonts[0] ?? "sans-serif";
    input.series.forEach((item, index) => {
      const itemStyle = styleForSeries(input.style, item, index);
      const x = input.style.legendBbox[0] + index * 70;
      const y = (input.style.legendBbox[1] + input.style.legendBbox[3]) / 2;
      primitives.push({
        kind: "line",
        x1: rounded(x),
        y1: rounded(y),
        x2: rounded(x + 12),
        y2: rounded(y),
        stroke: itemStyle.stroke,
        strokeWidth: 1.5,
        dash: itemStyle.dash,
      });
      primitives.push({
        kind: "text",
        x: rounded(x + 16),
        y: rounded(y + 3),
        text: item.label,
        fill: itemStyle.stroke,
        fontFamily: font,
        fontSize: 7,
        fontWeight: 400,
        textAnchor: "start",
      });
    });
  }

  return {
    schemaVersion: "1.0",
    rendererVersion: "reflo-svg-1",
    bbox: input.bbox,
    primitives,
    metadata: {
      kind: "chart",
      variant: input.type,
      axes: input.style.axes.map((axis) => axis.role),
    },
  };
}

export function buildScalarScene(input: {
  bbox: Bbox;
  formattedValue: string;
  style: {
    fontRef: string;
    fontSizePt: number;
    color: string;
    weight: number;
    alignment: string;
    bbox: Bbox;
  };
}): RenderScene {
  const anchor =
    input.style.alignment === "right"
      ? "end"
      : input.style.alignment === "center"
        ? "middle"
        : "start";
  const x =
    anchor === "end"
      ? input.style.bbox[2]
      : anchor === "middle"
        ? (input.style.bbox[0] + input.style.bbox[2]) / 2
        : input.style.bbox[0];
  return {
    schemaVersion: "1.0",
    rendererVersion: "reflo-svg-1",
    bbox: input.bbox,
    primitives: [
      {
        kind: "text",
        x,
        y: rounded(
          input.style.bbox[1] +
            (input.style.bbox[3] - input.style.bbox[1] + input.style.fontSizePt) /
              2,
        ),
        text: input.formattedValue,
        fill: input.style.color,
        fontFamily: input.style.fontRef,
        fontSize: input.style.fontSizePt,
        fontWeight: input.style.weight,
        textAnchor: anchor,
      },
    ],
    metadata: { kind: "scalar", variant: "exact_bbox", axes: [] },
  };
}

export function buildTableScene(input: {
  bbox: Bbox;
  matrix: string[][];
  style: {
    fontRef: string;
    fontSizePt: number;
    color: string;
    borderColor: string;
    fill: string;
  };
}): RenderScene {
  const rowCount = Math.max(input.matrix.length, 1);
  const columnCount = Math.max(
    ...input.matrix.map((row) => row.length),
    1,
  );
  const rowHeight = (input.bbox[3] - input.bbox[1]) / rowCount;
  const columnWidth = (input.bbox[2] - input.bbox[0]) / columnCount;
  const primitives: RenderPrimitive[] = [];
  for (let row = 0; row < rowCount; row += 1) {
    for (let column = 0; column < columnCount; column += 1) {
      const x = input.bbox[0] + column * columnWidth;
      const y = input.bbox[1] + row * rowHeight;
      primitives.push({
        kind: "rect",
        x: rounded(x),
        y: rounded(y),
        width: rounded(columnWidth),
        height: rounded(rowHeight),
        fill: input.style.fill,
        stroke: input.style.borderColor,
        strokeWidth: 0.5,
      });
      primitives.push({
        kind: "text",
        x: rounded(
          column === 0 ? x + 2 : x + columnWidth - 2,
        ),
        y: rounded(y + rowHeight / 2 + input.style.fontSizePt / 3),
        text: input.matrix[row]?.[column] ?? "",
        fill: input.style.color,
        fontFamily: input.style.fontRef,
        fontSize: input.style.fontSizePt,
        fontWeight: row === 0 ? 700 : 400,
        textAnchor: column === 0 ? "start" : "end",
      });
    }
  }
  return {
    schemaVersion: "1.0",
    rendererVersion: "reflo-svg-1",
    bbox: input.bbox,
    primitives,
    metadata: { kind: "table", variant: "exact_bbox", axes: [] },
  };
}

function escaped(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function primitiveSvg(item: RenderPrimitive): string {
  if (item.kind === "line") {
    return `<line x1="${item.x1}" y1="${item.y1}" x2="${item.x2}" y2="${item.y2}" stroke="${escaped(item.stroke)}" stroke-width="${item.strokeWidth}"${item.dash.length ? ` stroke-dasharray="${item.dash.join(" ")}"` : ""}/>`;
  }
  if (item.kind === "rect") {
    return `<rect x="${item.x}" y="${item.y}" width="${item.width}" height="${item.height}" fill="${escaped(item.fill)}" stroke="${escaped(item.stroke)}" stroke-width="${item.strokeWidth}"/>`;
  }
  if (item.kind === "path") {
    return `<path d="${escaped(item.d)}" fill="${escaped(item.fill)}" fill-opacity="${item.fillOpacity}" stroke="${escaped(item.stroke)}" stroke-width="${item.strokeWidth}"${item.dash.length ? ` stroke-dasharray="${item.dash.join(" ")}"` : ""}/>`;
  }
  return `<text x="${item.x}" y="${item.y}" fill="${escaped(item.fill)}" font-family="${escaped(item.fontFamily)}" font-size="${item.fontSize}" font-weight="${item.fontWeight}" text-anchor="${item.textAnchor}">${escaped(item.text)}</text>`;
}

export function renderSceneToSvg(scene: RenderScene): string {
  const [x1, y1, x2, y2] = scene.bbox;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x1} ${y1} ${rounded(x2 - x1)} ${rounded(y2 - y1)}" role="img">${scene.primitives.map(primitiveSvg).join("")}</svg>`;
}

export function renderSceneHash(scene: RenderScene): string {
  return contentHash(scene);
}

export function createRenderAsset(scene: RenderScene) {
  const svg = renderSceneToSvg(scene);
  return {
    rendererVersion: scene.rendererVersion,
    mediaType: "image/svg+xml" as const,
    sceneHash: renderSceneHash(scene),
    assetHash: sha256(svg),
    svg,
  };
}
