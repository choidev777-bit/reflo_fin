import {
  evaluateMappingDataReadiness,
  isValuationMappingMetric,
  mappingPeriodKind,
  type DataReadinessState,
  type MappingState,
} from "./mapping-data-readiness";
import { deferredMappingPolicy } from "./mapping-policy";
import {
  buildCompactAnnualPeriodWindow,
  buildQuarterlyReportPeriodWindow,
  parseQuarterlyPeriodLabel,
  type ReportPeriod,
  type ReportPeriodPlan,
} from "./report-period-plan";
import type {
  ResearchExcelTarget,
  ResearchSourceType,
} from "./research-validation";

export type ReportCollectionStatus =
  | "collection_required"
  | "carry_forward"
  | "later_stage"
  | "connection_required";

export type ReportCollectionAction =
  | "keep"
  | "collect"
  | "later_stage"
  | "connect";

export type ReportCollectionPeriod = {
  label: string;
  action: ReportCollectionAction;
  note: string;
  sourcePolicy: Array<{
    sourceType: ResearchSourceType;
    role: "authority" | "verification" | "comparison";
  }>;
};

export type ReportMappingEntry = {
  mappingEntryId: string;
  slotId: string;
  metric: string;
  kind: "scalar" | "table" | "chart";
  required: boolean;
  mappingState: MappingState;
  pageNumber: number | null;
  pageLabel: string | null;
  candidate: {
    sourceType: "cell" | "range" | "chart" | "market_data";
    sheetId: string;
    sheetName: string;
    address: string;
    label: string | null;
    periodLabels: string[];
  } | null;
};

export type ResearchReportTarget = {
  targetId: string;
  slotId: string;
  metric: string;
  title: string;
  kind: "scalar" | "table" | "chart";
  required: boolean;
  pageNumber: number | null;
  pageLabel: string | null;
  status: ReportCollectionStatus;
  readinessState: DataReadinessState;
  reasons: string[];
  workbook: {
    sourceType: "cell" | "range" | "chart" | "market_data";
    sheetId: string;
    sheetName: string;
    address: string;
    label: string | null;
  } | null;
  destinationLabel: string | null;
  detectedPeriods: string[];
  periods: ReportCollectionPeriod[];
  sourcePolicy: Array<{
    sourceType: ResearchSourceType;
    role: "authority" | "verification" | "comparison";
  }>;
  executableTargetIds: string[];
};

const TITLES: Readonly<Record<string, string>> = {
  current_price: "현재주가",
  target_price: "목표주가",
  investment_opinion: "투자의견",
  key_data: "Key Data",
  financial_data: "요약 투자지표",
  consensus_data: "컨센서스",
  stock_price: "주가 추이",
  figure_1_chart: "도표 1. Valuation",
  figure_2_chart: "도표 2. PER Band",
  figure_3_chart: "도표 3. PBR Band",
  figure_4_chart: "도표 4. 분기 실적 추이",
  figure_5_chart: "도표 5. 분기별 수주잔고 추이",
  figure_6_chart: "도표 6. 분기 실적 전망 · 수정 후",
  figure_7_chart: "도표 7. 분기 실적 전망 · 수정 전",
  income_statement_table: "손익계산서",
  balance_sheet_table: "재무상태표",
  investment_indicators_table: "투자지표",
  cash_flow_statement_table: "현금흐름표",
};

const FINANCIAL_METRIC =
  /(?:income_statement|balance_sheet|cash_flow|investment_indicators|financial_data)/;

function sourcePolicy(metric: string): ResearchReportTarget["sourcePolicy"] {
  if (/^(?:target_price|target_per|per|forward_eps|eps|figure_1_chart)$/.test(metric)) {
    return [];
  }
  if (metric === "figure_5_chart") {
    return [
      { sourceType: "COMPANY_IR", role: "authority" },
      { sourceType: "USER_MATERIAL", role: "verification" },
    ];
  }
  if (/^(?:figure_4_chart|figure_6_chart|figure_7_chart)$/.test(metric)) {
    return [
      { sourceType: "DART", role: "authority" },
      { sourceType: "COMPANY_IR", role: "verification" },
    ];
  }
  if (metric === "current_price" || metric === "stock_price") {
    return [{ sourceType: "KRX", role: "authority" }];
  }
  if (metric === "figure_2_chart") {
    return [
      { sourceType: "FNGUIDE_CONSENSUS", role: "authority" },
      { sourceType: "KRX", role: "verification" },
    ];
  }
  if (metric === "figure_3_chart") {
    return [
      { sourceType: "DART", role: "authority" },
      { sourceType: "KRX", role: "verification" },
    ];
  }
  if (metric === "consensus_data") {
    return [{ sourceType: "FNGUIDE_CONSENSUS", role: "authority" }];
  }
  if (metric === "key_data") {
    return [
      { sourceType: "DART", role: "authority" },
      { sourceType: "KRX", role: "verification" },
    ];
  }
  if (FINANCIAL_METRIC.test(metric)) {
    return [{ sourceType: "DART", role: "authority" }];
  }
  return [];
}

function titleFor(entry: ReportMappingEntry): string {
  return (
    TITLES[entry.metric] ??
    entry.candidate?.label ??
    entry.metric.replaceAll("_", " ")
  );
}

function annualPeriods(
  metric: string,
  plan: ReportPeriodPlan,
): ReportCollectionPeriod[] {
  const expected =
    mappingPeriodKind(metric) === "annual_compact"
      ? buildCompactAnnualPeriodWindow(plan)
      : plan.periods;
  return expected.map((period) => {
    if (period.role === "forecast") {
      return {
        label: period.label,
        action: "later_stage" as const,
        note: "후속 Excel 입력·밸류에이션 단계에서 확정",
        sourcePolicy: [],
      };
    }
    if (period.year === plan.latestActualYear) {
      return {
        label: period.label,
        action: "collect" as const,
        note: "이전 전망값을 공식 연간 실적으로 교체",
        sourcePolicy: [{ sourceType: "DART" as const, role: "authority" as const }],
      };
    }
    return {
      label: period.label,
      action: "keep" as const,
      note: "기존 Excel 실제값 유지",
      sourcePolicy: [],
    };
  });
}

function periodIndex(period: ReportPeriod): number {
  return period.year * 4 + (period.quarter ?? 1) - 1;
}

function quarterFromIndex(index: number): ReportPeriod {
  const year = Math.floor(index / 4);
  const quarter = (index % 4) + 1;
  return {
    year,
    quarter: quarter as 1 | 2 | 3 | 4,
    role: "actual",
    label: `${quarter}Q${String(year).slice(-2)}`,
  };
}

function quarterRangeLabel(periods: ReportPeriod[]): string | null {
  const first = periods[0];
  const last = periods.at(-1);
  if (!first || !last) return null;
  return first.label === last.label ? first.label : `${first.label}–${last.label}`;
}

function historicalQuarterPeriods(
  metric: string,
  detectedLabels: string[],
  plan: ReportPeriodPlan,
): ReportCollectionPeriod[] {
  const detected = detectedLabels
    .map(parseQuarterlyPeriodLabel)
    .filter((period): period is ReportPeriod => Boolean(period))
    .sort((left, right) => periodIndex(left) - periodIndex(right));
  const rows: ReportCollectionPeriod[] = [];
  const targetIndex = plan.targetYear * 4 + plan.targetQuarter - 1;
  const priorActuals = detected.filter(
    (period) =>
      period.role === "actual" && periodIndex(period) < targetIndex,
  );
  const existingLabel = quarterRangeLabel(priorActuals);
  if (existingLabel) {
    rows.push({
      label: existingLabel,
      action: "keep",
      note: "기존 Excel 분기값 유지",
      sourcePolicy: [],
    });
  }
  const lastIndex =
    priorActuals.length > 0
      ? periodIndex(priorActuals.at(-1)!)
      : targetIndex - 1;
  const policy = sourcePolicy(metric);
  for (let index = lastIndex + 1; index <= targetIndex; index += 1) {
    const period = quarterFromIndex(index);
    rows.push({
      label: period.label,
      action: "collect",
      note: metric === "figure_5_chart"
        ? "수주잔고 실제값 확인"
        : "분기 실제값 확인",
      sourcePolicy: policy,
    });
  }
  if (rows.length === 0) {
    rows.push({
      label: `${plan.targetQuarter}Q${String(plan.targetYear).slice(-2)}`,
      action: "keep",
      note: "목표 분기 실제값이 이미 연결됨",
      sourcePolicy: [],
    });
  }
  return rows;
}

function forecastQuarterPeriods(
  metric: string,
  detectedLabels: string[],
  plan: ReportPeriodPlan,
): ReportCollectionPeriod[] {
  const historical = historicalQuarterPeriods(metric, detectedLabels, plan);
  const forecast = buildQuarterlyReportPeriodWindow(plan).filter(
    (period) => period.quarter != null && period.role === "forecast",
  );
  const forecastLabel = quarterRangeLabel(forecast);
  if (forecastLabel) {
    historical.push({
      label: forecastLabel,
      action: "later_stage",
      note: "후속 Excel 입력 단계에서 전망값 확정",
      sourcePolicy: [],
    });
  }
  return historical;
}

function singlePeriod(
  entry: ReportMappingEntry,
  plan: ReportPeriodPlan,
  status: ReportCollectionStatus,
  policy: ResearchReportTarget["sourcePolicy"],
): ReportCollectionPeriod[] {
  const deferred = deferredMappingPolicy(entry.metric);
  if (status === "later_stage") {
    return [{
      label: deferred?.ownerStage ?? "후속 단계",
      action: "later_stage",
      note: deferred?.sourceLabel ?? "후속 계산 결과로 확정",
      sourcePolicy: [],
    }];
  }
  if (status === "connection_required") {
    const externalSource = deferred?.resolution === "external_pending";
    return [{
      label: "연결 확인",
      action: "connect",
      note: externalSource
        ? `${deferred.sourceLabel} 원본 연결 필요`
        : "PDF 요소와 Excel 원본 위치를 먼저 연결",
      sourcePolicy: policy,
    }];
  }
  return [{
    label:
      entry.metric === "current_price"
        ? plan.cutoffDate
        : `${plan.targetYear}년 ${plan.targetQuarter}분기`,
    action: status === "carry_forward" ? "keep" : "collect",
    note:
      deferred?.sourceLabel ??
      (status === "carry_forward"
        ? "현재 Excel 원본 유지"
        : "목표 기간 실제값 수집"),
    sourcePolicy: policy,
  }];
}

function statusFromReadiness(
  entry: ReportMappingEntry,
  readiness: DataReadinessState,
): ReportCollectionStatus {
  const deferred = deferredMappingPolicy(entry.metric);
  if (
    deferred?.resolution === "later_stage" ||
    readiness === "valuation_required" ||
    readiness === "later_stage" ||
    readiness === "user_input_required" ||
    isValuationMappingMetric(entry.metric)
  ) {
    return "later_stage";
  }
  if (
    readiness === "source_collection_required" ||
    readiness === "source_and_input_required" ||
    readiness === "period_refresh_required"
  ) {
    return "collection_required";
  }
  if (entry.mappingState !== "connected") {
    return deferred?.resolution === "external_pending"
      ? "collection_required"
      : "connection_required";
  }
  return readiness === "ready" ? "carry_forward" : "connection_required";
}

function periodsFor(
  entry: ReportMappingEntry,
  plan: ReportPeriodPlan,
  status: ReportCollectionStatus,
  policy: ResearchReportTarget["sourcePolicy"],
): ReportCollectionPeriod[] {
  const kind = mappingPeriodKind(entry.metric);
  if (kind === "annual_full" || kind === "annual_compact") {
    return annualPeriods(entry.metric, plan);
  }
  if (entry.metric === "figure_4_chart" || entry.metric === "figure_5_chart") {
    return historicalQuarterPeriods(
      entry.metric,
      entry.candidate?.periodLabels ?? [],
      plan,
    );
  }
  if (entry.metric === "figure_6_chart" || entry.metric === "figure_7_chart") {
    return forecastQuarterPeriods(
      entry.metric,
      entry.candidate?.periodLabels ?? [],
      plan,
    );
  }
  return singlePeriod(entry, plan, status, policy);
}

export function buildResearchReportTargets(input: {
  entries: ReportMappingEntry[];
  periodPlan: ReportPeriodPlan;
  executableTargets: ResearchExcelTarget[];
}): ResearchReportTarget[] {
  return input.entries
    .map((entry) => {
      const deferred = deferredMappingPolicy(entry.metric);
      const readiness = evaluateMappingDataReadiness({
        metric: entry.metric,
        mappingState: entry.mappingState,
        sourceType: entry.candidate?.sourceType ?? null,
        periodLabels: entry.candidate?.periodLabels ?? [],
        periodPlan: input.periodPlan,
        deferredResolution: deferred?.resolution ?? null,
      });
      const policy = sourcePolicy(entry.metric);
      const needsUnsupportedSource = policy.some(
        (item) => item.sourceType === "FNGUIDE_CONSENSUS",
      );
      const status = needsUnsupportedSource
        ? "connection_required"
        : statusFromReadiness(entry, readiness.state);
      const reasons =
        needsUnsupportedSource
          ? ["현재 FnGuide 자동 수집이 지원되지 않아 원본 연결이 필요합니다."]
          : deferred?.resolution === "external_pending" && !entry.candidate
          ? [
              `${deferred.sourceLabel} 수집 후 ${deferred.destinationLabel}에 반영합니다.`,
            ]
          : readiness.reasons;
      return {
        targetId: entry.mappingEntryId,
        slotId: entry.slotId,
        metric: entry.metric,
        title: titleFor(entry),
        kind: entry.kind,
        required: entry.required,
        pageNumber: entry.pageNumber,
        pageLabel: entry.pageLabel,
        status,
        readinessState: readiness.state,
        reasons,
        workbook: entry.candidate
          ? {
              sourceType: entry.candidate.sourceType,
              sheetId: entry.candidate.sheetId,
              sheetName: entry.candidate.sheetName,
              address: entry.candidate.address,
              label: entry.candidate.label,
            }
          : null,
        destinationLabel: deferred?.destinationLabel ?? null,
        detectedPeriods: entry.candidate?.periodLabels ?? [],
        periods: periodsFor(entry, input.periodPlan, status, policy),
        sourcePolicy: policy,
        executableTargetIds: input.executableTargets
          .filter(
            (target) =>
              target.mappingSlotIds.includes(entry.slotId) ||
              (entry.candidate &&
                target.sheetId === entry.candidate.sheetId),
          )
          .map((target) => target.targetId),
      } satisfies ResearchReportTarget;
    })
    .sort(
      (left, right) =>
        (left.pageNumber ?? Number.MAX_SAFE_INTEGER) -
          (right.pageNumber ?? Number.MAX_SAFE_INTEGER) ||
        Number(right.required) - Number(left.required) ||
        left.title.localeCompare(right.title, "ko"),
    );
}
