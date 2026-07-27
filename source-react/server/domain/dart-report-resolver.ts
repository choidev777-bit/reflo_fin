import type { ResearchSourceSnapshot } from "./research-validation";

export type DartReportMetadata = {
  businessYear: number;
  quarter: 1 | 2 | 3 | 4;
  reportCode: "11011" | "11012" | "11013" | "11014";
  receiptNumber: string;
  publishedAt: string;
  corpCode: string;
  scopeCodes?: Array<"CFS" | "OFS">;
};

export type DartReportSource = {
  source: ResearchSourceSnapshot;
  report: DartReportMetadata;
  rows: Array<Record<string, unknown>>;
};

const REPORT_CODE_BY_QUARTER = {
  1: "11013",
  2: "11012",
  3: "11014",
  4: "11011",
} as const;

export function asDartReportSource(
  source: ResearchSourceSnapshot,
): DartReportSource | null {
  if (source.sourceType !== "DART") return null;
  const report = source.content.report as Record<string, unknown> | undefined;
  const rows = source.content.rows;
  if (
    !report ||
    !Array.isArray(rows) ||
    typeof report.businessYear !== "number" ||
    ![1, 2, 3, 4].includes(Number(report.quarter)) ||
    typeof report.reportCode !== "string" ||
    typeof report.receiptNumber !== "string" ||
    typeof report.publishedAt !== "string" ||
    typeof report.corpCode !== "string"
  ) {
    return null;
  }
  const scopeCodes = Array.isArray(report.scopeCodes)
    ? report.scopeCodes.filter(
        (value): value is "CFS" | "OFS" =>
          value === "CFS" || value === "OFS",
      )
    : [];
  const retainedScope = scopeCodes.length === 1 ? scopeCodes[0] : null;
  return {
    source,
    report: report as DartReportMetadata,
    rows: rows.filter(
      (row): row is Record<string, unknown> =>
        Boolean(row) && typeof row === "object" && !Array.isArray(row),
    ).map((row) =>
      row.fs_div || !retainedScope
        ? row
        : { ...row, fs_div: retainedScope },
    ),
  };
}

export function resolveDartReport(input: {
  sources: ResearchSourceSnapshot[];
  businessYear: number;
  quarter: 1 | 2 | 3 | 4;
  scope?: "CFS" | "OFS";
  corpCode?: string | null;
  cutoffAt: string;
}): DartReportSource | null {
  const expectedCode = REPORT_CODE_BY_QUARTER[input.quarter];
  const cutoff = Date.parse(input.cutoffAt);
  return input.sources
    .map(asDartReportSource)
    .filter((item): item is DartReportSource => Boolean(item))
    .filter(
      (item) =>
        item.report.businessYear === input.businessYear &&
        item.report.quarter === input.quarter &&
        item.report.reportCode === expectedCode &&
        (!input.corpCode || item.report.corpCode === input.corpCode) &&
        (!input.scope ||
          item.rows.some(
            (row) =>
              String(row.fs_div ?? "").toUpperCase() === input.scope,
          )) &&
        Date.parse(item.report.publishedAt) <= cutoff,
    )
    .sort(
      (left, right) =>
        Date.parse(right.report.publishedAt) -
          Date.parse(left.report.publishedAt) ||
        right.report.receiptNumber.localeCompare(left.report.receiptNumber),
    )[0] ?? null;
}
