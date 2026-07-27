export type DartStatementCode = "IS" | "CIS" | "BS" | "CF";

export type DartAccountRule = {
  ruleId: string;
  metricId: string;
  labels: string[];
  allowedStatements: DartStatementCode[];
  allowedAccountIds: string[];
  allowedAccountNames: string[];
  balanceType: "flow" | "point_in_time";
};

const RULES: readonly DartAccountRule[] = [
  {
    ruleId: "revenue-rule-v1",
    metricId: "revenue",
    labels: ["매출액", "영업수익", "수익(매출액)", "revenue"],
    allowedStatements: ["IS", "CIS"],
    allowedAccountIds: ["ifrs-full_Revenue", "ifrs_Revenue"],
    allowedAccountNames: ["매출액", "영업수익", "수익(매출액)"],
    balanceType: "flow",
  },
  {
    ruleId: "operating-profit-rule-v1",
    metricId: "operating_profit",
    labels: ["영업이익", "영업이익(손실)", "operating_profit"],
    allowedStatements: ["IS", "CIS"],
    allowedAccountIds: ["dart_OperatingIncomeLoss"],
    allowedAccountNames: ["영업이익", "영업이익(손실)"],
    balanceType: "flow",
  },
  {
    ruleId: "profit-before-tax-rule-v1",
    metricId: "profit_before_tax",
    labels: ["세전이익", "법인세비용차감전순이익", "profit_before_tax"],
    allowedStatements: ["IS", "CIS"],
    allowedAccountIds: ["ifrs-full_ProfitLossBeforeTax"],
    allowedAccountNames: ["세전이익", "법인세비용차감전순이익"],
    balanceType: "flow",
  },
  {
    ruleId: "net-income-rule-v1",
    metricId: "net_income",
    labels: ["당기순이익", "당기순이익(손실)", "net_income"],
    allowedStatements: ["IS", "CIS"],
    allowedAccountIds: ["ifrs-full_ProfitLoss"],
    allowedAccountNames: ["당기순이익", "당기순이익(손실)"],
    balanceType: "flow",
  },
  {
    ruleId: "controlling-net-income-rule-v1",
    metricId: "controlling_net_income",
    labels: ["지배주주순이익", "지배기업 소유주지분 순이익", "controlling_net_income"],
    allowedStatements: ["IS", "CIS"],
    allowedAccountIds: [
      "ifrs-full_ProfitLossAttributableToOwnersOfParent",
    ],
    allowedAccountNames: ["지배주주순이익", "지배기업 소유주지분 순이익"],
    balanceType: "flow",
  },
  {
    ruleId: "total-assets-rule-v1",
    metricId: "total_assets",
    labels: ["자산총계", "total_assets"],
    allowedStatements: ["BS"],
    allowedAccountIds: ["ifrs-full_Assets"],
    allowedAccountNames: ["자산총계"],
    balanceType: "point_in_time",
  },
  {
    ruleId: "total-liabilities-rule-v1",
    metricId: "total_liabilities",
    labels: ["부채총계", "total_liabilities"],
    allowedStatements: ["BS"],
    allowedAccountIds: ["ifrs-full_Liabilities"],
    allowedAccountNames: ["부채총계"],
    balanceType: "point_in_time",
  },
  {
    ruleId: "total-equity-rule-v1",
    metricId: "total_equity",
    labels: ["자본총계", "total_equity"],
    allowedStatements: ["BS"],
    allowedAccountIds: ["ifrs-full_Equity"],
    allowedAccountNames: ["자본총계"],
    balanceType: "point_in_time",
  },
  {
    ruleId: "operating-cash-flow-rule-v1",
    metricId: "operating_cash_flow",
    labels: ["영업활동 현금흐름", "영업활동현금흐름", "operating_cash_flow"],
    allowedStatements: ["CF"],
    allowedAccountIds: ["ifrs-full_CashFlowsFromUsedInOperatingActivities"],
    allowedAccountNames: ["영업활동 현금흐름", "영업활동현금흐름"],
    balanceType: "flow",
  },
] as const;

function normalized(value: string): string {
  return value.replaceAll(/\s+/g, "").toLocaleLowerCase("ko-KR");
}

export function dartAccountRules(): readonly DartAccountRule[] {
  return RULES;
}

export function resolveDartAccountRule(
  metricOrRuleId: string,
): DartAccountRule | null {
  const key = normalized(metricOrRuleId);
  return (
    RULES.find(
      (rule) =>
        normalized(rule.ruleId) === key ||
        normalized(rule.metricId) === key ||
        rule.labels.some((label) => normalized(label) === key),
    ) ?? null
  );
}
