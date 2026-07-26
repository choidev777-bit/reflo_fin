export type ReportPeriodRole = "actual" | "forecast";

export type ReportPeriod = {
  year: number;
  label: string;
  role: ReportPeriodRole;
  quarter?: 1 | 2 | 3 | 4;
};

export type ReportPeriodPlan = {
  schemaVersion: "1.0";
  targetYear: number;
  targetQuarter: number;
  cutoffDate: string;
  latestActualYear: number;
  source: "project_target" | "dart_verified";
  periods: ReportPeriod[];
};

export type PeriodCoverage = {
  state: "ready" | "refresh_required" | "not_detected";
  detectedPeriods: ReportPeriod[];
  missingPeriods: ReportPeriod[];
  unexpectedPeriods: ReportPeriod[];
  roleMismatches: Array<{
    expected: ReportPeriod;
    detected: ReportPeriod;
  }>;
};

export type WorkbookPeriodCell = {
  row: number;
  column: number;
  value: string;
};

const YEAR_LABEL_PATTERN =
  /(?:^|[^0-9])((?:19|20)\d{2})\s*([FEA]|(?:EST)|(?:E))?(?:$|[^A-Z0-9])/i;
const SHORT_YEAR_LABEL_PATTERN =
  /(?:^|[^0-9])(\d{2})\s*([FEA]|(?:EST)|(?:E))(?:$|[^A-Z0-9])/i;

function assertTargetYear(value: number): void {
  if (!Number.isInteger(value) || value < 1900 || value > 2200) {
    throw new Error("REPORT_PERIOD_TARGET_YEAR_INVALID");
  }
}

function assertTargetQuarter(value: number): void {
  if (!Number.isInteger(value) || value < 1 || value > 4) {
    throw new Error("REPORT_PERIOD_TARGET_QUARTER_INVALID");
  }
}

function assertDate(value: string): void {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    Number.isNaN(new Date(`${value}T00:00:00Z`).getTime())
  ) {
    throw new Error("REPORT_PERIOD_CUTOFF_DATE_INVALID");
  }
}

function period(year: number, role: ReportPeriodRole): ReportPeriod {
  return {
    year,
    role,
    label: role === "forecast" ? `${year}F` : String(year),
  };
}

function quarterPeriod(
  year: number,
  quarter: 1 | 2 | 3 | 4,
  role: ReportPeriodRole,
): ReportPeriod {
  return {
    year,
    quarter,
    role,
    label: `${quarter}Q${String(year).slice(-2)}${
      role === "forecast" ? "F" : ""
    }`,
  };
}

/**
 * Creates the annual column plan used by the report.
 *
 * The target report year is the first forecast year. The latest actual year
 * therefore defaults to the preceding year and can later be replaced by a
 * DART-verified year without changing any consumer contract.
 */
export function buildReportPeriodPlan(input: {
  targetYear: number;
  targetQuarter: number;
  cutoffDate: string;
  latestActualYear?: number | null;
}): ReportPeriodPlan {
  assertTargetYear(input.targetYear);
  assertTargetQuarter(input.targetQuarter);
  assertDate(input.cutoffDate);

  const inferredLatestActualYear = input.targetYear - 1;
  const latestActualYear =
    input.latestActualYear == null
      ? inferredLatestActualYear
      : input.latestActualYear;
  assertTargetYear(latestActualYear);
  if (latestActualYear >= input.targetYear) {
    throw new Error("REPORT_PERIOD_ACTUAL_YEAR_INVALID");
  }

  return {
    schemaVersion: "1.0",
    targetYear: input.targetYear,
    targetQuarter: input.targetQuarter,
    cutoffDate: input.cutoffDate,
    latestActualYear,
    source:
      input.latestActualYear == null ? "project_target" : "dart_verified",
    periods: [
      period(latestActualYear - 1, "actual"),
      period(latestActualYear, "actual"),
      period(latestActualYear + 1, "forecast"),
      period(latestActualYear + 2, "forecast"),
      period(latestActualYear + 3, "forecast"),
    ],
  };
}

function roleFromSuffix(suffix: string | undefined): ReportPeriodRole {
  const normalized = suffix?.trim().toUpperCase();
  return normalized && normalized !== "A" ? "forecast" : "actual";
}

export function parseAnnualPeriodLabel(
  value: string,
): ReportPeriod | null {
  const normalized = value.normalize("NFKC").trim().toUpperCase();
  const longMatch = YEAR_LABEL_PATTERN.exec(` ${normalized} `);
  if (longMatch) {
    return period(Number(longMatch[1]), roleFromSuffix(longMatch[2]));
  }
  const shortMatch = SHORT_YEAR_LABEL_PATTERN.exec(` ${normalized} `);
  if (!shortMatch) return null;
  return period(2000 + Number(shortMatch[1]), roleFromSuffix(shortMatch[2]));
}

export function parseQuarterlyPeriodLabel(
  value: string,
): ReportPeriod | null {
  const normalized = value
    .normalize("NFKC")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
  const quarterFirst =
    /^([1-4])Q((?:19|20)?\d{2})(F|E|A|EST)?$/.exec(normalized);
  const yearFirst =
    /^((?:19|20)?\d{2})Q([1-4])(F|E|A|EST)?$/.exec(normalized);
  const rawYear = quarterFirst?.[2] ?? yearFirst?.[1];
  const rawQuarter = quarterFirst?.[1] ?? yearFirst?.[2];
  const suffix = quarterFirst?.[3] ?? yearFirst?.[3];
  if (!rawYear || !rawQuarter) return null;
  const year =
    rawYear.length === 2 ? 2000 + Number(rawYear) : Number(rawYear);
  const quarter = Number(rawQuarter);
  if (
    !Number.isInteger(year) ||
    year < 1900 ||
    year > 2200 ||
    ![1, 2, 3, 4].includes(quarter)
  ) {
    return null;
  }
  return quarterPeriod(
    year,
    quarter as 1 | 2 | 3 | 4,
    roleFromSuffix(suffix),
  );
}

export function buildCompactAnnualPeriodWindow(
  plan: ReportPeriodPlan,
): ReportPeriod[] {
  return plan.periods.slice(0, 4);
}

export function buildQuarterlyReportPeriodWindow(
  plan: ReportPeriodPlan,
  options?: {
    targetQuarterRole?: ReportPeriodRole;
  },
): ReportPeriod[] {
  const targetIndex = plan.targetYear * 4 + plan.targetQuarter - 1;
  const targetQuarterRole = options?.targetQuarterRole ?? "actual";
  const quarters = Array.from({ length: 8 }, (_, index) => {
    const absoluteQuarter = targetIndex - 3 + index;
    const year = Math.floor(absoluteQuarter / 4);
    const quarter = (absoluteQuarter % 4) + 1;
    const role =
      index < 3
        ? "actual"
        : index === 3
          ? targetQuarterRole
          : "forecast";
    return quarterPeriod(
      year,
      quarter as 1 | 2 | 3 | 4,
      role,
    );
  });
  return [
    ...quarters,
    period(plan.latestActualYear, "actual"),
    period(plan.latestActualYear + 1, "forecast"),
    period(plan.latestActualYear + 2, "forecast"),
  ];
}

function periodKey(value: ReportPeriod): string {
  return value.quarter == null
    ? `annual:${value.year}`
    : `quarter:${value.year}:${value.quarter}`;
}

function evaluateExpectedPeriodCoverage(
  labels: string[],
  expectedPeriods: ReportPeriod[],
  parse: (value: string) => ReportPeriod | null,
): PeriodCoverage {
  const detectedByKey = new Map<string, ReportPeriod>();
  for (const label of labels) {
    const parsed = parse(label);
    if (parsed) detectedByKey.set(periodKey(parsed), parsed);
  }
  const detectedPeriods = [...detectedByKey.values()];
  if (detectedPeriods.length === 0) {
    return {
      state: "not_detected",
      detectedPeriods: [],
      missingPeriods: [...expectedPeriods],
      unexpectedPeriods: [],
      roleMismatches: [],
    };
  }

  const expectedByKey = new Map(
    expectedPeriods.map((item) => [periodKey(item), item]),
  );
  const missingPeriods = expectedPeriods.filter(
    (item) => !detectedByKey.has(periodKey(item)),
  );
  const unexpectedPeriods = detectedPeriods.filter(
    (item) => !expectedByKey.has(periodKey(item)),
  );
  const roleMismatches = expectedPeriods.flatMap((expected) => {
    const detected = detectedByKey.get(periodKey(expected));
    return detected && detected.role !== expected.role
      ? [{ expected, detected }]
      : [];
  });

  return {
    state:
      missingPeriods.length === 0 &&
      unexpectedPeriods.length === 0 &&
      roleMismatches.length === 0
        ? "ready"
        : "refresh_required",
    detectedPeriods,
    missingPeriods,
    unexpectedPeriods,
    roleMismatches,
  };
}

export function evaluatePeriodCoverage(
  labels: string[],
  plan: ReportPeriodPlan,
): PeriodCoverage {
  return evaluateExpectedPeriodCoverage(
    labels,
    plan.periods,
    parseAnnualPeriodLabel,
  );
}

export function evaluatePeriodWindowCoverage(
  labels: string[],
  expectedPeriods: ReportPeriod[],
): PeriodCoverage {
  return evaluateExpectedPeriodCoverage(labels, expectedPeriods, (label) => {
    return parseQuarterlyPeriodLabel(label) ?? parseAnnualPeriodLabel(label);
  });
}

export function hasExactPeriodWindow(
  cells: WorkbookPeriodCell[],
  expected: ReportPeriod[],
): boolean {
  if (expected.length === 0) return false;
  const rows = new Map<number, WorkbookPeriodCell[]>();
  for (const cell of cells) {
    const current = rows.get(cell.row) ?? [];
    current.push(cell);
    rows.set(cell.row, current);
  }
  for (const row of rows.values()) {
    const ordered = row.sort((left, right) => left.column - right.column);
    for (
      let start = 0;
      start <= ordered.length - expected.length;
      start++
    ) {
      const window = ordered.slice(start, start + expected.length);
      if (
        window.some(
          (cell, index) =>
            index > 0 &&
            cell.column !== window[index - 1]!.column + 1,
        )
      ) {
        continue;
      }
      const parsed = window.map((cell) =>
        parseAnnualPeriodLabel(cell.value),
      );
      if (
        parsed.every(
          (period, index) =>
            period?.year === expected[index]!.year &&
            period.role === expected[index]!.role,
        )
      ) {
        return true;
      }
    }
  }
  return false;
}
