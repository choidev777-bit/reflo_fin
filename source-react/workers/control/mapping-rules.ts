export const MAPPING_RULES = {
  analysisPipelineVersion: "mapping-analysis/2.0",
  semanticAliasVersion: "mapping-alias/2.1",
  scoringRuleVersion: "mapping-score/2.1",
  scalar: {
    candidateMinimum: 0.36,
    modelPeriodMinimum: 0.8,
    automaticMinimum: 0.92,
    automaticMargin: 0.12,
  },
  table: {
    candidateMinimum: 0.36,
    automaticMinimum: 0.88,
    automaticMargin: 0.1,
  },
  chart: {
    candidateMinimum: 0.42,
    automaticMinimum: 0.62,
    automaticMargin: 0.08,
  },
} as const;

export const METRIC_ALIASES: Readonly<Record<string, readonly string[]>> = {
  target_price: ["목표주가", "target price", "적정주가"],
  current_price: ["현재주가", "current price", "종가"],
  revenue: ["매출액", "매출", "revenue", "sales"],
  operating_profit: ["영업이익", "operating profit", "op"],
  net_income: ["지배주주순이익", "순이익", "net income"],
  eps: ["forward eps", "fwd eps", "eps"],
  per: ["target per", "적용 per", "per"],
  investment_opinion: ["투자의견", "investment opinion", "rating"],
  key_data: ["key data", "핵심 데이터", "주요 데이터", "주요 지표"],
  quarterly_performance_table: ["분기실적", "quarterly performance", "분기"],
  segment_revenue_table: ["부문매출", "부문별", "segment revenue", "segment"],
  target_price_history_table: ["목표주가추이", "target price history", "목표주가"],
  valuation_bridge_table: ["valuation bridge", "밸류에이션", "valuation"],
  income_statement_table: ["손익계산서", "income statement", "profit and loss"],
  financial_income_statement_table: [
    "손익계산서",
    "income statement",
    "profit and loss",
  ],
  balance_sheet_table: ["대차대조표", "재무상태표", "balance sheet"],
  financial_balance_sheet_table: [
    "대차대조표",
    "재무상태표",
    "balance sheet",
  ],
  investment_indicators_table: [
    "투자지표",
    "investment indicators",
    "valuation metrics",
  ],
  financial_investment_indicators_table: [
    "투자지표",
    "investment indicators",
    "valuation metrics",
  ],
  cash_flow_statement_table: ["현금흐름표", "cash flow statement", "cash flow"],
  financial_cash_flow_table: ["현금흐름표", "cash flow statement", "cash flow"],
  stock_price: ["주가추이", "stock price", "price trend"],
  figure_1_chart: ["도표1", "valuation", "밸류에이션"],
  figure_4_chart: [
    "도표4",
    "분기실적수정후",
    "분기실적",
    "quarterly performance revised",
  ],
  figure_5_chart: [
    "도표5",
    "분기실적수정전",
    "수주잔고",
    "quarterly performance prior",
  ],
  figure_6_chart: [
    "도표6",
    "분기실적전망수정후",
    "quarterly performance outlook revised",
  ],
  figure_7_chart: [
    "도표7",
    "분기실적전망수정전",
    "quarterly performance outlook prior",
  ],
};

/**
 * Exact workbook-layout hints are isolated as a versioned compatibility
 * profile. They only apply when the inspected workbook still contains the
 * exact sheet and address; they are never treated as semantic evidence.
 */
type WorkbookLayoutHint = readonly [sheetName: string, address: string];

export const REFLO_REPORT_OUTPUT_PROFILE: {
  readonly profileVersion: string;
  readonly rangeHints: Readonly<
    Record<string, readonly WorkbookLayoutHint[]>
  >;
} = {
  profileVersion: "reflo-report-output/1.1",
  rangeHints: {
    key_data: [["01A_p1_KeyData", "A4:C14"]],
    figure_1_chart: [["05_도표1_Valuation", "A4:E14"]],
    figure_4_chart: [["08_도표4_분기실적_수정후", "A4:M19"]],
    figure_5_chart: [["09_도표5_분기실적_수정전", "A4:M19"]],
    figure_6_chart: [["10_도표6_분기실적전망_수정후", "A4:M22"]],
    figure_7_chart: [["11_도표7_분기실적전망_수정전", "A4:M22"]],
  },
};

export const LEGACY_ISC_WORKBOOK_PROFILE: {
  readonly profileVersion: string;
  readonly cellHints: Readonly<
    Record<string, readonly WorkbookLayoutHint[]>
  >;
  readonly rangeHints: Readonly<
    Record<string, readonly WorkbookLayoutHint[]>
  >;
} = {
  profileVersion: "isc-workbook-layout/1.0",
  cellHints: {
    target_price: [
      ["M2_목표주가_타겟멀티플", "C21"],
      ["09_Target_PER", "B15"],
    ],
    current_price: [["09_Target_PER", "B16"]],
    eps: [
      ["M2_목표주가_타겟멀티플", "C10"],
      ["09_Target_PER", "B7"],
      ["08_Forward_EPS", "D36"],
    ],
    per: [
      ["M2_목표주가_타겟멀티플", "C7"],
      ["09_Target_PER", "B14"],
    ],
  },
  rangeHints: {
    quarterly_performance_table: [["01_실적추이", "A5:L25"]],
    segment_revenue_table: [["01_실적추이", "A5:L13"]],
    target_price_history_table: [["03_목표주가", "A5:F20"]],
    valuation_bridge_table: [["09_Target_PER", "A5:I26"]],
    income_statement_table: [["15_p5_손익계산서", "A4:G35"]],
    financial_income_statement_table: [["15_p5_손익계산서", "A4:G35"]],
    balance_sheet_table: [["16_p5_대차대조표", "A4:G37"]],
    financial_balance_sheet_table: [["16_p5_대차대조표", "A4:G37"]],
    investment_indicators_table: [["17_p5_투자지표", "A4:G25"]],
    financial_investment_indicators_table: [["17_p5_투자지표", "A4:G25"]],
    cash_flow_statement_table: [["18_p5_현금흐름표", "A4:G25"]],
    financial_cash_flow_table: [["18_p5_현금흐름표", "A4:G25"]],
  },
};

export const IGNORED_RANGE_CONTEXT = [
  "정합성체크",
  "출처",
  "감사",
  "audit",
  "source",
  "reference",
] as const;
