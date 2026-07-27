import type { ResearchExcelTarget } from "./research-validation";
import { resolveDartAccountRule } from "./dart-account-registry";

export type WorkbookCandidateCell = {
  sheetId: string;
  sheetName: string;
  address: string;
  label?: string | null;
  rawValue?: unknown;
  formula?: string | null;
};

const FINANCIAL_SHEET_PATTERN = /^(?:12|13|14|15)_p4_/i;
const QUARTERLY_SHEET_PATTERN =
  /^(?:08_도표4_|10_도표6_|11_도표7_)/i;

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

function targetUnitFor(
  sheetName: string,
  metric: string,
): NonNullable<ResearchExcelTarget["targetUnit"]> | null {
  const displayUnit = unitFor(sheetName, metric);
  if (displayUnit === "십억원") return "KRW_BILLION";
  if (displayUnit === "원") return "KRW";
  if (displayUnit === "%") return "PERCENT";
  return null;
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

function addressRow(address: string): number | null {
  const match = address.toUpperCase().match(/^[A-Z]{1,3}([1-9]\d*)$/);
  return match ? Number(match[1]) : null;
}

function metricFromQuarterLabel(label: string): string {
  if (/^\s*[1-4]Q\d{2}\s*(?:F|E)?\s*$/i.test(label)) return "";
  const metric = label
    .replace(/\s*[·ㆍ]\s*[1-4]Q\d{2}\s*(?:F|E)?\s*$/i, "")
    .trim();
  return /^OP$/i.test(metric) ? "영업이익" : metric;
}

function previousQuarter(
  year: number,
  quarter: 1 | 2 | 3 | 4,
): { year: number; quarter: 1 | 2 | 3 | 4 } {
  return quarter === 1
    ? { year: year - 1, quarter: 4 }
    : { year, quarter: (quarter - 1) as 1 | 2 | 3 };
}

function quarterlyActualTargets(input: {
  candidateCells: WorkbookCandidateCell[];
  targetYear: number;
  targetQuarter: 1 | 2 | 3 | 4;
  mappingSlotIdsBySheetId?: ReadonlyMap<string, string[]>;
}): ResearchExcelTarget[] {
  const metricBySheetRow = new Map<string, string>();
  for (const cell of input.candidateCells) {
    if (!QUARTERLY_SHEET_PATTERN.test(cell.sheetName)) continue;
    const row = addressRow(cell.address);
    const metric = metricFromQuarterLabel(cell.label ?? "");
    if (
      row &&
      metric &&
      resolveDartAccountRule(metric) &&
      targetUnitFor(cell.sheetName, metric) !== "PERCENT"
    ) {
      metricBySheetRow.set(`${cell.sheetId}:${row}`, metric);
    }
  }
  const targetPeriod = {
    year: input.targetYear,
    quarter: input.targetQuarter,
  };
  const priorPeriod = previousQuarter(
    input.targetYear,
    input.targetQuarter,
  );
  return input.candidateCells.flatMap((cell): ResearchExcelTarget[] => {
    if (
      !QUARTERLY_SHEET_PATTERN.test(cell.sheetName) ||
      cell.formula ||
      !isNumericValue(cell.rawValue)
    ) {
      return [];
    }
    const periods = /^11_도표7_/i.test(cell.sheetName)
      ? [priorPeriod, targetPeriod]
      : [targetPeriod];
    const matchedPeriod = periods.find(({ year, quarter }) =>
      new RegExp(
        `(?:^|[·ㆍ]\\s*)${quarter}Q${String(year).slice(-2)}\\s*(?:F|E)?\\s*$`,
        "i",
      ).test(cell.label?.trim() ?? ""),
    );
    if (!matchedPeriod) return [];
    const row = addressRow(cell.address);
    const metric =
      metricFromQuarterLabel(cell.label ?? "") ||
      (row ? metricBySheetRow.get(`${cell.sheetId}:${row}`) ?? "" : "");
    const rule = resolveDartAccountRule(metric);
    const targetUnit = targetUnitFor(cell.sheetName, metric);
    if (!metric || !rule || !targetUnit || targetUnit === "PERCENT") return [];
    return [{
      targetId:
        `quarterly:${cell.sheetId}:${cell.address.toUpperCase()}:` +
        `${matchedPeriod.year}Q${matchedPeriod.quarter}`,
      sheetId: cell.sheetId,
      sheetName: cell.sheetName,
      address: cell.address.toUpperCase(),
      metricId: rule.metricId,
      metric,
      period: `${matchedPeriod.year}년 ${matchedPeriod.quarter}분기`,
      periodSpec: {
        type: "quarter",
        year: matchedPeriod.year,
        quarter: matchedPeriod.quarter,
        basis:
          rule.balanceType === "point_in_time"
            ? "point_in_time"
            : matchedPeriod.quarter === 4
              ? "single_quarter"
              : "year_to_date",
      },
      unit: unitFor(cell.sheetName, metric),
      targetUnit,
      scope: "연결",
      scopeCode: "CFS",
      valueKind: "actual",
      dartRuleId: rule.ruleId,
      writeAuthority: "system",
      required: isCoreActualMetric(metric),
      included: true,
      sourcePolicy: [{ sourceType: "DART", role: "authority" }],
      mappingSlotIds:
        input.mappingSlotIdsBySheetId?.get(cell.sheetId) ?? [],
      excludedReason: null,
    }];
  });
}

/**
 * Finds the prior workbook's first forecast column that becomes an actual
 * column in the new report. These cells are collected from authoritative
 * sources before the workbook is rolled forward.
 */
export function createActualFinancialTargets(input: {
  candidateCells: WorkbookCandidateCell[];
  targetYear: number;
  targetQuarter?: 1 | 2 | 3 | 4;
  mappingSlotIdsBySheetId?: ReadonlyMap<string, string[]>;
}): ResearchExcelTarget[] {
  const actualYear = input.targetYear - 1;
  const periodPattern = new RegExp(
    `(?:^|[·ㆍ]\\s*)${actualYear}\\s*(?:F|E)\\s*$`,
    "i",
  );
  const annualTargets = input.candidateCells
    .filter(
      (cell) =>
        FINANCIAL_SHEET_PATTERN.test(cell.sheetName) &&
        isNumericValue(cell.rawValue) &&
        periodPattern.test(cell.label?.trim() ?? ""),
    )
    .flatMap((cell): ResearchExcelTarget[] => {
      const metric = metricFromLabel(cell.label ?? "", actualYear);
      const rule = resolveDartAccountRule(metric);
      const targetUnit = targetUnitFor(cell.sheetName, metric);
      if (!metric || !rule || !targetUnit || targetUnit === "PERCENT") return [];
      return [
        {
          targetId: `actual:${cell.sheetId}:${cell.address.toUpperCase()}:${actualYear}`,
          sheetId: cell.sheetId,
          sheetName: cell.sheetName,
          address: cell.address.toUpperCase(),
          metricId: rule.metricId,
          metric,
          period: `${actualYear}년 연간`,
          periodSpec: {
            type: "annual",
            year: actualYear,
            quarter: null,
            basis:
              rule.balanceType === "point_in_time"
                ? "point_in_time"
                : "annual",
          },
          unit: unitFor(cell.sheetName, metric),
          targetUnit,
          scope: "연결",
          scopeCode: "CFS",
          valueKind: "actual",
          dartRuleId: rule.ruleId,
          writeAuthority: "system",
          required: isCoreActualMetric(metric),
          included: true,
          sourcePolicy: [{ sourceType: "DART", role: "authority" }],
          mappingSlotIds:
            input.mappingSlotIdsBySheetId?.get(cell.sheetId) ?? [],
          excludedReason: null,
        },
      ];
    });
  return [
    ...annualTargets,
    ...quarterlyActualTargets({
      ...input,
      targetQuarter: input.targetQuarter ?? 1,
    }),
  ]
    .sort((left, right) =>
      `${left.sheetName}:${left.address}`.localeCompare(
        `${right.sheetName}:${right.address}`,
        "ko",
      ),
    );
}
