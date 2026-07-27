import Decimal from "decimal.js";
import type { ResearchExcelTarget } from "./research-validation";
import type { DartFinancialRow } from "./dart-row-resolver";

const UNIT_DIVISOR: Record<
  NonNullable<ResearchExcelTarget["targetUnit"]>,
  Decimal
> = {
  KRW: new Decimal(1),
  KRW_MILLION: new Decimal(1_000_000),
  KRW_100M: new Decimal(100_000_000),
  KRW_BILLION: new Decimal(1_000_000_000),
  PERCENT: new Decimal(1),
};

function decimalAmount(row: DartFinancialRow): Decimal | null {
  const raw = String(row.thstrm_amount ?? "")
    .replaceAll(",", "")
    .trim();
  if (!/^-?\d+(?:\.\d+)?$/.test(raw)) return null;
  return new Decimal(raw);
}

export type DartCalculatedValue =
  | {
      status: "resolved";
      rawValue: string;
      normalizedValue: string;
      formula: string | null;
      unitDivisor: string;
    }
  | { status: "invalid_amount" | "unit_unknown" };

export function calculateDartValue(input: {
  target: ResearchExcelTarget;
  currentRow: DartFinancialRow;
  previousRow?: DartFinancialRow | null;
}): DartCalculatedValue {
  const current = decimalAmount(input.currentRow);
  if (!current) return { status: "invalid_amount" };
  const unit = input.target.targetUnit;
  if (!unit || unit === "PERCENT") return { status: "unit_unknown" };
  let raw = current;
  let formula: string | null = null;
  if (
    input.target.periodSpec?.basis === "single_quarter" &&
    input.target.periodSpec.quarter !== 1
  ) {
    const previous = input.previousRow
      ? decimalAmount(input.previousRow)
      : null;
    if (!previous) return { status: "invalid_amount" };
    raw = current.minus(previous);
    formula = `${current.toFixed()} - ${previous.toFixed()}`;
  }
  return {
    status: "resolved",
    rawValue: raw.toFixed(),
    normalizedValue: raw.dividedBy(UNIT_DIVISOR[unit]).toFixed(),
    formula,
    unitDivisor: UNIT_DIVISOR[unit].toFixed(),
  };
}
