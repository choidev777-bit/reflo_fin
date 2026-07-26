import {
  buildCompactAnnualPeriodWindow,
  buildQuarterlyReportPeriodWindow,
  evaluatePeriodCoverage,
  evaluatePeriodWindowCoverage,
  type PeriodCoverage,
  type ReportPeriodPlan,
} from "./report-period-plan";

export type MappingState =
  | "connected"
  | "unmapped"
  | "invalid"
  | "review_required";

export type DataReadinessState =
  | "ready"
  | "period_refresh_required"
  | "source_collection_required"
  | "user_input_required"
  | "source_and_input_required"
  | "valuation_required"
  | "later_stage"
  | "review_required";

export type MappingDataReadiness = {
  state: DataReadinessState;
  reasons: string[];
  periodCoverage: PeriodCoverage | null;
};

const FULL_ANNUAL_PERIOD_METRICS = new Set([
  "income_statement_table",
  "financial_income_statement_table",
  "balance_sheet_table",
  "financial_balance_sheet_table",
  "investment_indicators_table",
  "financial_investment_indicators_table",
  "cash_flow_statement_table",
  "financial_cash_flow_table",
  "financial_statements_table",
]);
const COMPACT_ANNUAL_PERIOD_METRICS = new Set(["financial_data"]);
const QUARTERLY_PERIOD_METRICS = new Set([
  "quarterly_performance_table",
  "figure_6_chart",
  "figure_7_chart",
]);
const SOURCE_AND_INPUT_METRIC =
  /(?:statement|financial_|indicators|key_data|quarterly|figure_[45]_chart)/;
const USER_INPUT_METRIC = /(?:figure_[67]_chart)/;
const VALUATION_METRIC =
  /^(?:target_price|target_per|per|forward_eps|eps|valuation_bridge_table|figure_1_chart)$/;

export type MappingPeriodKind =
  | "annual_full"
  | "annual_compact"
  | "quarterly"
  | "none";

export function mappingPeriodKind(metric: string): MappingPeriodKind {
  if (FULL_ANNUAL_PERIOD_METRICS.has(metric)) return "annual_full";
  if (COMPACT_ANNUAL_PERIOD_METRICS.has(metric)) return "annual_compact";
  if (QUARTERLY_PERIOD_METRICS.has(metric)) return "quarterly";
  return "none";
}

export function isValuationMappingMetric(metric: string): boolean {
  return VALUATION_METRIC.test(metric);
}

function formatPeriods(
  periods: Array<{ label: string }>,
): string {
  return periods.map((item) => item.label).join(", ");
}

function evaluateMetricPeriodCoverage(
  metric: string,
  labels: string[],
  plan: ReportPeriodPlan,
): PeriodCoverage | null {
  const periodKind = mappingPeriodKind(metric);
  if (periodKind === "annual_full") {
    return evaluatePeriodCoverage(labels, plan);
  }
  if (periodKind === "annual_compact") {
    return evaluatePeriodWindowCoverage(
      labels,
      buildCompactAnnualPeriodWindow(plan),
    );
  }
  if (periodKind === "quarterly") {
    return evaluatePeriodWindowCoverage(
      labels,
      buildQuarterlyReportPeriodWindow(plan, {
        targetQuarterRole:
          metric === "figure_7_chart" ? "forecast" : "actual",
      }),
    );
  }
  return null;
}

export function evaluateMappingDataReadiness(input: {
  metric: string;
  mappingState: MappingState;
  sourceType: "cell" | "range" | "chart" | "market_data" | null;
  periodLabels: string[];
  periodPlan: ReportPeriodPlan;
  deferredResolution: "external_pending" | "later_stage" | null;
}): MappingDataReadiness {
  if (input.mappingState !== "connected") {
    return {
      state: "review_required",
      reasons: ["Excel 원본 위치를 먼저 확인해야 합니다."],
      periodCoverage: null,
    };
  }
  if (input.sourceType === "market_data") {
    return {
      state: "ready",
      reasons: ["기준일 시장 데이터가 연결되었습니다."],
      periodCoverage: null,
    };
  }

  const periodCoverage = evaluateMetricPeriodCoverage(
    input.metric,
    input.periodLabels,
    input.periodPlan,
  );
  if (periodCoverage?.state === "refresh_required") {
    const reasons = [
      periodCoverage.missingPeriods.length > 0
        ? `필요 기간 누락: ${formatPeriods(periodCoverage.missingPeriods)}`
        : null,
      periodCoverage.unexpectedPeriods.length > 0
        ? `이전 기간 잔존: ${formatPeriods(periodCoverage.unexpectedPeriods)}`
        : null,
      periodCoverage.roleMismatches.length > 0
        ? `실적·전망 구분 불일치: ${periodCoverage.roleMismatches
            .map(({ expected }) => expected.label)
            .join(", ")}`
        : null,
    ].filter((reason): reason is string => Boolean(reason));
    return {
      state: "period_refresh_required",
      reasons,
      periodCoverage,
    };
  }

  if (input.deferredResolution === "external_pending") {
    return {
      state: "source_collection_required",
      reasons: ["자료 수집 단계에서 최신 원본을 연결해야 합니다."],
      periodCoverage,
    };
  }
  if (input.deferredResolution === "later_stage") {
    return {
      state: "later_stage",
      reasons: ["후속 의사결정 또는 초안 작성 단계에서 확정합니다."],
      periodCoverage,
    };
  }
  if (isValuationMappingMetric(input.metric)) {
    return {
      state: "valuation_required",
      reasons: ["밸류에이션 단계의 계산 결과로 확정합니다."],
      periodCoverage,
    };
  }
  if (SOURCE_AND_INPUT_METRIC.test(input.metric)) {
    return {
      state: "source_and_input_required",
      reasons: [
        "실제값은 자료 수집 단계에서 갱신합니다.",
        "전망값은 Excel 입력 단계에서 확정합니다.",
      ],
      periodCoverage,
    };
  }
  if (USER_INPUT_METRIC.test(input.metric)) {
    return {
      state: "user_input_required",
      reasons: ["Excel 입력 단계에서 전망값을 확정해야 합니다."],
      periodCoverage,
    };
  }
  return {
    state: "ready",
    reasons: ["현재 Excel 원본을 그대로 사용할 수 있습니다."],
    periodCoverage,
  };
}
