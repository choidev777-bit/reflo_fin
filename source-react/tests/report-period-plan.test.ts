import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCompactAnnualPeriodWindow,
  buildQuarterlyReportPeriodWindow,
  buildReportPeriodPlan,
  evaluatePeriodCoverage,
  evaluatePeriodWindowCoverage,
  hasExactPeriodWindow,
  parseAnnualPeriodLabel,
  parseQuarterlyPeriodLabel,
} from "../server/domain/report-period-plan";

test("target report period creates two actual and three forecast years", () => {
  const plan = buildReportPeriodPlan({
    targetYear: 2026,
    targetQuarter: 1,
    cutoffDate: "2026-04-30",
  });

  assert.equal(plan.source, "project_target");
  assert.deepEqual(
    plan.periods.map((item) => item.label),
    ["2024", "2025", "2026F", "2027F", "2028F"],
  );
});

test("DART verified actual year overrides the inferred actual year", () => {
  const plan = buildReportPeriodPlan({
    targetYear: 2026,
    targetQuarter: 1,
    cutoffDate: "2026-02-01",
    latestActualYear: 2024,
  });

  assert.equal(plan.source, "dart_verified");
  assert.deepEqual(
    plan.periods.map((item) => item.label),
    ["2023", "2024", "2025F", "2026F", "2027F"],
  );
});

test("annual period labels support full and short forecast notation", () => {
  assert.deepEqual(parseAnnualPeriodLabel("2025"), {
    year: 2025,
    label: "2025",
    role: "actual",
  });
  assert.deepEqual(parseAnnualPeriodLabel("2026F"), {
    year: 2026,
    label: "2026F",
    role: "forecast",
  });
  assert.deepEqual(parseAnnualPeriodLabel("27E"), {
    year: 2027,
    label: "2027F",
    role: "forecast",
  });
});

test("quarterly period labels support quarter-first and year-first notation", () => {
  assert.deepEqual(parseQuarterlyPeriodLabel("1Q26"), {
    year: 2026,
    quarter: 1,
    label: "1Q26",
    role: "actual",
  });
  assert.deepEqual(parseQuarterlyPeriodLabel("2026 Q2F"), {
    year: 2026,
    quarter: 2,
    label: "2Q26F",
    role: "forecast",
  });
});

test("builds compact annual and rolling quarterly report windows", () => {
  const plan = buildReportPeriodPlan({
    targetYear: 2026,
    targetQuarter: 1,
    cutoffDate: "2026-04-30",
  });

  assert.deepEqual(
    buildCompactAnnualPeriodWindow(plan).map((item) => item.label),
    ["2024", "2025", "2026F", "2027F"],
  );
  assert.deepEqual(
    buildQuarterlyReportPeriodWindow(plan).map((item) => item.label),
    [
      "2Q25",
      "3Q25",
      "4Q25",
      "1Q26",
      "2Q26F",
      "3Q26F",
      "4Q26F",
      "1Q27F",
      "2025",
      "2026F",
      "2027F",
    ],
  );
  assert.equal(
    buildQuarterlyReportPeriodWindow(plan, {
      targetQuarterRole: "forecast",
    })[3]?.label,
    "1Q26F",
  );
});

test("quarterly coverage checks both rolling quarters and annual summaries", () => {
  const plan = buildReportPeriodPlan({
    targetYear: 2026,
    targetQuarter: 1,
    cutoffDate: "2026-04-30",
  });
  const coverage = evaluatePeriodWindowCoverage(
    [
      "1Q25",
      "2Q25",
      "3Q25",
      "4Q25",
      "1Q26F",
      "2Q26F",
      "3Q26F",
      "4Q26F",
      "2024",
      "2025F",
      "2026F",
    ],
    buildQuarterlyReportPeriodWindow(plan),
  );

  assert.equal(coverage.state, "refresh_required");
  assert.deepEqual(
    coverage.missingPeriods.map((item) => item.label),
    ["1Q27F", "2027F"],
  );
  assert.deepEqual(
    coverage.roleMismatches.map((item) => item.expected.label),
    ["1Q26", "2025"],
  );
});

test("coverage reports a stale workbook horizon", () => {
  const plan = buildReportPeriodPlan({
    targetYear: 2026,
    targetQuarter: 1,
    cutoffDate: "2026-04-30",
  });
  const coverage = evaluatePeriodCoverage(
    ["2023", "2024", "2025F", "2026F", "2027F"],
    plan,
  );

  assert.equal(coverage.state, "refresh_required");
  assert.deepEqual(
    coverage.missingPeriods.map((item) => item.label),
    ["2028F"],
  );
  assert.deepEqual(
    coverage.unexpectedPeriods.map((item) => item.label),
    ["2023"],
  );
  assert.deepEqual(
    coverage.roleMismatches.map((item) => item.expected.label),
    ["2025"],
  );
});

test("coverage accepts the exact report horizon and roles", () => {
  const plan = buildReportPeriodPlan({
    targetYear: 2026,
    targetQuarter: 1,
    cutoffDate: "2026-04-30",
  });

  assert.equal(
    evaluatePeriodCoverage(
      ["2024", "2025", "2026F", "2027F", "2028F"],
      plan,
    ).state,
    "ready",
  );
});

test("finds an exact contiguous workbook period header", () => {
  const plan = buildReportPeriodPlan({
    targetYear: 2026,
    targetQuarter: 1,
    cutoffDate: "2026-04-30",
  });
  assert.equal(
    hasExactPeriodWindow(
      plan.periods.map((period, index) => ({
        row: 4,
        column: index + 2,
        value: period.label,
      })),
      plan.periods,
    ),
    true,
  );
  assert.equal(
    hasExactPeriodWindow(
      ["2023", "2024", "2025F", "2026F", "2027F"].map(
        (value, index) => ({
          row: 4,
          column: index + 2,
          value,
        }),
      ),
      plan.periods,
    ),
    false,
  );
});
