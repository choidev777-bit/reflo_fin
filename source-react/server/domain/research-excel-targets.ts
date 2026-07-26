import type { ResearchExcelTarget } from "./research-validation";

export type WorkbookCandidateCell = {
  sheetId: string;
  sheetName: string;
  address: string;
  label?: string | null;
  rawValue?: unknown;
  formula?: string | null;
};

const FINANCIAL_SHEET_PATTERN = /^(?:12|13|14|15)_p4_/i;

function metricFromLabel(label: string, year: number): string {
  return label
    .replace(
      new RegExp(`\\s*[·ㆍ]\\s*${year}\\s*(?:F|E)\\s*$`, "i"),
      "",
    )
    .trim();
}

function unitFor(sheetName: string, metric: string): string {
  if (/성장률|이익률|마진|ROE|ROA|배당률|수익률|비율/.test(metric)) {
    return "%";
  }
  if (/PER|PBR|PCR|EV\/EBITDA/i.test(metric)) return "배";
  if (/^14_p4_/i.test(sheetName) && /EPS|BPS|CFPS/i.test(metric)) {
    return "원";
  }
  return "십억원";
}

function isCoreActualMetric(metric: string): boolean {
  return /^(?:매출액|영업이익|세전이익|당기순이익|지배주주순이익|자산총계|부채총계|자본총계|영업활동 현금흐름)$/.test(
    metric,
  );
}

function isNumericValue(value: unknown): boolean {
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "string" || value.trim() === "") return false;
  return Number.isFinite(Number(value.replaceAll(",", "")));
}

/**
 * Finds the prior workbook's first forecast column that becomes an actual
 * column in the new report. These cells are collected from authoritative
 * sources before the workbook is rolled forward.
 */
export function createActualFinancialTargets(input: {
  candidateCells: WorkbookCandidateCell[];
  targetYear: number;
  mappingSlotIdsBySheetId?: ReadonlyMap<string, string[]>;
}): ResearchExcelTarget[] {
  const actualYear = input.targetYear - 1;
  const periodPattern = new RegExp(
    `(?:^|[·ㆍ]\\s*)${actualYear}\\s*(?:F|E)\\s*$`,
    "i",
  );
  return input.candidateCells
    .filter(
      (cell) =>
        FINANCIAL_SHEET_PATTERN.test(cell.sheetName) &&
        !cell.formula &&
        isNumericValue(cell.rawValue) &&
        periodPattern.test(cell.label?.trim() ?? ""),
    )
    .flatMap((cell): ResearchExcelTarget[] => {
      const metric = metricFromLabel(cell.label ?? "", actualYear);
      if (!metric) return [];
      return [
        {
          targetId: `actual:${cell.sheetId}:${cell.address.toUpperCase()}:${actualYear}`,
          sheetId: cell.sheetId,
          sheetName: cell.sheetName,
          address: cell.address.toUpperCase(),
          metric,
          period: `${actualYear}년 연간`,
          unit: unitFor(cell.sheetName, metric),
          scope: "연결",
          valueKind: "actual",
          writeAuthority: "system",
          required: isCoreActualMetric(metric),
          included: true,
          sourcePolicy: [{ sourceType: "DART", role: "authority" }],
          mappingSlotIds:
            input.mappingSlotIdsBySheetId?.get(cell.sheetId) ?? [],
          excludedReason: null,
        },
      ];
    })
    .sort((left, right) =>
      `${left.sheetName}:${left.address}`.localeCompare(
        `${right.sheetName}:${right.address}`,
        "ko",
      ),
    );
}
