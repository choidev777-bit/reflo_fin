import assert from "node:assert/strict";
import test from "node:test";
import { evaluateMappingDataReadiness } from "../server/domain/mapping-data-readiness";
import { buildReportPeriodPlan } from "../server/domain/report-period-plan";

const plan = buildReportPeriodPlan({
  targetYear: 2026,
  targetQuarter: 1,
  cutoffDate: "2026-04-30",
});

test("a connected financial table with an old horizon requires refresh", () => {
  const result = evaluateMappingDataReadiness({
    metric: "income_statement_table",
    mappingState: "connected",
    sourceType: "range",
    periodLabels: ["2023", "2024", "2025F", "2026F", "2027F"],
    periodPlan: plan,
    deferredResolution: null,
  });

  assert.equal(result.state, "period_refresh_required");
  assert.match(result.reasons.join(" "), /2028F/);
});

test("a balance sheet uses the same five-year refresh rule", () => {
  const result = evaluateMappingDataReadiness({
    metric: "balance_sheet_table",
    mappingState: "connected",
    sourceType: "range",
    periodLabels: ["2023", "2024", "2025F", "2026F", "2027F"],
    periodPlan: plan,
    deferredResolution: null,
  });

  assert.equal(result.state, "period_refresh_required");
  assert.match(result.reasons.join(" "), /2028F/);
});

test("page-one Financial Data uses its compact four-year window", () => {
  const ready = evaluateMappingDataReadiness({
    metric: "financial_data",
    mappingState: "connected",
    sourceType: "range",
    periodLabels: ["2024", "2025", "2026F", "2027F"],
    periodPlan: plan,
    deferredResolution: null,
  });
  const stale = evaluateMappingDataReadiness({
    metric: "financial_data",
    mappingState: "connected",
    sourceType: "range",
    periodLabels: ["2023", "2024", "2025F", "2026F"],
    periodPlan: plan,
    deferredResolution: null,
  });

  assert.equal(ready.state, "source_and_input_required");
  assert.equal(stale.state, "period_refresh_required");
  assert.match(stale.reasons.join(" "), /2027F/);
});

test("figures six and seven validate rolling quarter headers", () => {
  const result = evaluateMappingDataReadiness({
    metric: "figure_6_chart",
    mappingState: "connected",
    sourceType: "range",
    periodLabels: [
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
    periodPlan: plan,
    deferredResolution: null,
  });

  assert.equal(result.state, "period_refresh_required");
  assert.match(result.reasons.join(" "), /1Q27F/);
  assert.match(result.reasons.join(" "), /1Q26/);
});

test("figure seven preserves the target quarter as the prior forecast", () => {
  const result = evaluateMappingDataReadiness({
    metric: "figure_7_chart",
    mappingState: "connected",
    sourceType: "range",
    periodLabels: [
      "2Q25",
      "3Q25",
      "4Q25",
      "1Q26F",
      "2Q26F",
      "3Q26F",
      "4Q26F",
      "1Q27F",
      "2025",
      "2026F",
      "2027F",
    ],
    periodPlan: plan,
    deferredResolution: null,
  });

  assert.equal(result.state, "user_input_required");
  assert.equal(result.periodCoverage?.state, "ready");
});

test("a current financial table is not presented as fully automatic", () => {
  const result = evaluateMappingDataReadiness({
    metric: "income_statement_table",
    mappingState: "connected",
    sourceType: "range",
    periodLabels: ["2024", "2025", "2026F", "2027F", "2028F"],
    periodPlan: plan,
    deferredResolution: null,
  });

  assert.equal(result.state, "source_and_input_required");
});

test("a selected KRX market value is ready", () => {
  const result = evaluateMappingDataReadiness({
    metric: "current_price",
    mappingState: "connected",
    sourceType: "market_data",
    periodLabels: [],
    periodPlan: plan,
    deferredResolution: "external_pending",
  });

  assert.equal(result.state, "ready");
});

test("an unresolved mapping remains a review item", () => {
  const result = evaluateMappingDataReadiness({
    metric: "income_statement_table",
    mappingState: "review_required",
    sourceType: null,
    periodLabels: [],
    periodPlan: plan,
    deferredResolution: null,
  });

  assert.equal(result.state, "review_required");
});
