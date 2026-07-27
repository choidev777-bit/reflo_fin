import type { DartAccountRule } from "./dart-account-registry";
import type { DartReportSource } from "./dart-report-resolver";

export type DartFinancialRow = {
  account_id?: string;
  account_nm?: string;
  fs_div?: string;
  fs_nm?: string;
  sj_div?: string;
  sj_nm?: string;
  thstrm_nm?: string;
  thstrm_amount?: string;
  frmtrm_nm?: string;
  frmtrm_amount?: string;
  currency?: string;
  [key: string]: unknown;
};

export type DartRowResolution =
  | { status: "resolved"; row: DartFinancialRow }
  | { status: "not_found"; candidates: [] }
  | { status: "ambiguous"; candidates: DartFinancialRow[] };

function rowsForScopeAndStatement(
  report: DartReportSource,
  rule: DartAccountRule,
  scope: "CFS" | "OFS",
): DartFinancialRow[] {
  return report.rows.filter((row): row is DartFinancialRow => {
    const statement = String(row.sj_div ?? "").toUpperCase();
    return (
      String(row.fs_div ?? "").toUpperCase() === scope &&
      rule.allowedStatements.includes(
        statement as DartAccountRule["allowedStatements"][number],
      )
    );
  });
}

function outcome(candidates: DartFinancialRow[]): DartRowResolution {
  if (candidates.length === 0) return { status: "not_found", candidates: [] };
  if (candidates.length > 1) return { status: "ambiguous", candidates };
  return { status: "resolved", row: candidates[0]! };
}

export function resolveDartRow(input: {
  report: DartReportSource;
  rule: DartAccountRule;
  scope: "CFS" | "OFS";
}): DartRowResolution {
  const eligible = rowsForScopeAndStatement(
    input.report,
    input.rule,
    input.scope,
  );
  const byId = eligible.filter((row) =>
    input.rule.allowedAccountIds.includes(String(row.account_id ?? "")),
  );
  if (byId.length > 0) return outcome(byId);
  return outcome(
    eligible.filter((row) =>
      input.rule.allowedAccountNames.includes(
        String(row.account_nm ?? "").trim(),
      ),
    ),
  );
}
