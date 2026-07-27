import { createHash } from "node:crypto";
import {
  resolveDartAccountRule,
} from "./dart-account-registry";
import { calculateDartValue } from "./dart-period-calculator";
import {
  resolveDartReport,
  type DartReportSource,
} from "./dart-report-resolver";
import { resolveDartRow, type DartFinancialRow } from "./dart-row-resolver";
import type {
  DeterministicExcelEvidence,
  DeterministicExcelResult,
  ResearchExcelTarget,
  ResearchSourceSnapshot,
  ValidationCheck,
} from "./research-validation";

function check(code: string, passed: boolean, message: string): ValidationCheck {
  return { code, status: passed ? "passed" : "failed", message };
}

function failed(
  target: ResearchExcelTarget,
  statusCode: DeterministicExcelResult["statusCode"],
  message: string,
): DeterministicExcelResult {
  return {
    targetId: target.targetId,
    metricId: target.metricId ?? target.metric,
    title: target.metric,
    oneLineValue: message,
    valueOriginal: null,
    valueNormalized: null,
    unit: target.targetUnit ?? target.unit,
    currency: target.targetUnit?.startsWith("KRW") ? "KRW" : null,
    period: target.period,
    scope: target.scopeCode ?? target.scope,
    valueKind: target.valueKind,
    required: target.required,
    machineStatus: "failed",
    statusCode,
    evidence: [],
    checks: [check(statusCode, false, message)],
  };
}

function evidenceFor(input: {
  target: ResearchExcelTarget;
  report: DartReportSource;
  row: DartFinancialRow;
  rawValue: string;
  normalizedValue: string;
  formula: string | null;
  unitDivisor: string;
  componentNo: number;
}): DeterministicExcelEvidence {
  const selectedField = "thstrm_amount";
  const quoteExact = String(input.row[selectedField] ?? "");
  const locator = {
    kind: "dart_financial_statement",
    provider: "DART",
    corpCode: input.report.report.corpCode,
    businessYear: input.report.report.businessYear,
    quarter: input.report.report.quarter,
    reportCode: input.report.report.reportCode,
    receiptNumber: input.report.report.receiptNumber,
    publishedAt: input.report.report.publishedAt,
    fsDiv: input.row.fs_div,
    statementCode: input.row.sj_div,
    statementName: input.row.sj_nm,
    accountId: input.row.account_id,
    accountName: input.row.account_nm,
    selectedField,
    selectedColumnLabel: input.row.thstrm_nm,
    rawValue: quoteExact,
    normalizedValue: input.normalizedValue,
    originalUnit: "KRW",
    targetUnit: input.target.targetUnit,
    conversionDivisor: input.unitDivisor,
    targetId: input.target.targetId,
    destination: {
      sheetId: input.target.sheetId,
      sheetName: input.target.sheetName,
      address: input.target.address,
    },
    formula: input.formula,
    componentNo: input.componentNo,
    rowFingerprint: createHash("sha256")
      .update(JSON.stringify(input.row))
      .digest("hex"),
  };
  const checks = [
    check("company", true, "승인 계획의 DART 회사 코드와 일치합니다."),
    check("report", true, "요구한 사업연도와 보고서 종류가 일치합니다."),
    check("cutoff", true, "공시일이 프로젝트 기준일 이전입니다."),
    check("scope", true, "연결·별도 범위가 일치합니다."),
    check("statement", true, "허용된 재무제표 종류입니다."),
    check("account", true, "등록된 계정 ID 또는 계정명과 일치합니다."),
    check("numeric", true, "금액을 Decimal 값으로 변환했습니다."),
    check("destination", true, "승인 계획의 Excel 목적지와 연결됩니다."),
  ];
  return {
    sourceKey: input.report.source.sourceKey,
    quoteExact,
    locator,
    valueOriginal: input.rawValue,
    valueNormalized: input.normalizedValue,
    unit: input.target.targetUnit ?? input.target.unit,
    currency: "KRW",
    period: input.target.period,
    scope: input.target.scopeCode ?? input.target.scope,
    valueKind: input.target.valueKind,
    checks,
  };
}

function previousQuarter(
  quarter: 1 | 2 | 3 | 4,
): 1 | 2 | 3 {
  return (quarter - 1) as 1 | 2 | 3;
}

export function validateDartExcelTarget(input: {
  target: ResearchExcelTarget;
  sources: ResearchSourceSnapshot[];
  cutoffAt: string;
  corpCode?: string | null;
}): DeterministicExcelResult {
  const { target } = input;
  const period = target.periodSpec;
  const rule = resolveDartAccountRule(target.dartRuleId ?? target.metricId ?? target.metric);
  if (!period || !target.scopeCode || !target.targetUnit || !rule) {
    return failed(
      target,
      "manual_review",
      "지표·기간·범위·단위·DART 계정 규칙이 완전하지 않습니다.",
    );
  }
  const current = resolveDartReport({
    sources: input.sources,
    businessYear: period.year,
    quarter: period.type === "annual" ? 4 : (period.quarter ?? 4),
    scope: target.scopeCode,
    corpCode: input.corpCode,
    cutoffAt: input.cutoffAt,
  });
  if (!current) {
    const otherScopeReport = resolveDartReport({
      sources: input.sources,
      businessYear: period.year,
      quarter: period.type === "annual" ? 4 : (period.quarter ?? 4),
      corpCode: input.corpCode,
      cutoffAt: input.cutoffAt,
    });
    return otherScopeReport
      ? failed(
          target,
          "scope_mismatch",
          "필요한 보고서는 있지만 연결·별도 재무제표 범위가 다릅니다.",
        )
      : failed(
          target,
          "report_unavailable",
          "필요한 DART 보고서가 공시되지 않았습니다.",
        );
  }
  if (input.corpCode && current.report.corpCode !== input.corpCode) {
    return failed(
      target,
      "manual_review",
      "DART 보고서의 회사 코드가 프로젝트 회사와 일치하지 않습니다.",
    );
  }
  const currentRow = resolveDartRow({
    report: current,
    rule,
    scope: target.scopeCode,
  });
  if (currentRow.status === "not_found") {
    const otherScope = resolveDartRow({
      report: current,
      rule,
      scope: target.scopeCode === "CFS" ? "OFS" : "CFS",
    });
    return otherScope.status === "not_found"
      ? failed(target, "account_not_found", "허용된 DART 계정 행을 찾지 못했습니다.")
      : failed(
          target,
          "scope_mismatch",
          "계정은 존재하지만 연결·별도 범위가 Excel 대상과 다릅니다.",
        );
  }
  if (currentRow.status === "ambiguous") {
    return failed(target, "account_ambiguous", "허용된 DART 계정 후보가 여러 개입니다.");
  }
  let previousReport: DartReportSource | null = null;
  let previousRow: DartFinancialRow | null = null;
  if (
    period.basis === "single_quarter" &&
    period.quarter !== null &&
    period.quarter > 1
  ) {
    previousReport = resolveDartReport({
      sources: input.sources,
      businessYear: period.year,
      quarter: previousQuarter(period.quarter),
      scope: target.scopeCode,
      corpCode: input.corpCode,
      cutoffAt: input.cutoffAt,
    });
    if (!previousReport) {
      const otherScopeReport = resolveDartReport({
        sources: input.sources,
        businessYear: period.year,
        quarter: previousQuarter(period.quarter),
        corpCode: input.corpCode,
        cutoffAt: input.cutoffAt,
      });
      return otherScopeReport
        ? failed(
            target,
            "scope_mismatch",
            "이전 누적 보고서의 연결·별도 재무제표 범위가 다릅니다.",
          )
        : failed(
            target,
            "report_unavailable",
            "단일 분기 계산에 필요한 이전 누적 보고서가 없습니다.",
          );
    }
    if (
      input.corpCode &&
      previousReport.report.corpCode !== input.corpCode
    ) {
      return failed(
        target,
        "manual_review",
        "이전 누적 DART 보고서의 회사 코드가 프로젝트 회사와 일치하지 않습니다.",
      );
    }
    const resolvedPrevious = resolveDartRow({
      report: previousReport,
      rule,
      scope: target.scopeCode,
    });
    if (resolvedPrevious.status !== "resolved") {
      if (resolvedPrevious.status === "not_found") {
        const otherScope = resolveDartRow({
          report: previousReport,
          rule,
          scope: target.scopeCode === "CFS" ? "OFS" : "CFS",
        });
        if (otherScope.status !== "not_found") {
          return failed(
            target,
            "scope_mismatch",
            "이전 누적 보고서의 연결·별도 범위가 Excel 대상과 다릅니다.",
          );
        }
      }
      return failed(
        target,
        resolvedPrevious.status === "ambiguous"
          ? "account_ambiguous"
          : "account_not_found",
        "이전 누적 보고서의 DART 계정 행을 확정하지 못했습니다.",
      );
    }
    previousRow = resolvedPrevious.row;
  }
  const calculated = calculateDartValue({
    target,
    currentRow: currentRow.row,
    previousRow,
  });
  if (calculated.status !== "resolved") {
    return failed(
      target,
      calculated.status === "unit_unknown" ? "unit_unknown" : "manual_review",
      calculated.status === "unit_unknown"
        ? "Excel 목표 단위를 확인할 수 없습니다."
        : "DART 금액을 안전하게 계산할 수 없습니다.",
    );
  }
  const evidence = [
    evidenceFor({
      target,
      report: current,
      row: currentRow.row,
      rawValue: String(currentRow.row.thstrm_amount ?? ""),
      normalizedValue: calculated.normalizedValue,
      formula: calculated.formula,
      unitDivisor: calculated.unitDivisor,
      componentNo: 1,
    }),
  ];
  if (previousReport && previousRow) {
    evidence.push(
      evidenceFor({
        target,
        report: previousReport,
        row: previousRow,
        rawValue: String(previousRow.thstrm_amount ?? ""),
        normalizedValue: calculated.normalizedValue,
        formula: calculated.formula,
        unitDivisor: calculated.unitDivisor,
        componentNo: 2,
      }),
    );
  }
  return {
    targetId: target.targetId,
    metricId: rule.metricId,
    title: target.metric,
    oneLineValue: `${calculated.normalizedValue} ${target.unit}`,
    valueOriginal: calculated.rawValue,
    valueNormalized: calculated.normalizedValue,
    unit: target.targetUnit,
    currency: "KRW",
    period: target.period,
    scope: target.scopeCode,
    valueKind: target.valueKind,
    required: target.required,
    machineStatus: "passed",
    statusCode: "validated",
    evidence,
    checks: evidence.flatMap((item) => item.checks),
  };
}
