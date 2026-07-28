import Decimal from "decimal.js";
import { ApiError } from "../http/api-error";

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export type ValuationWorkbookLineage = {
  validationApprovalId: string;
  validatedValueSetResourceVersionId: string;
  validatedWorkbookResourceVersionId: string;
  sourceWorkbookResourceVersionId: string;
  mappingSetResourceVersionId: string;
  workbookArtifactId: string;
  workbookHash: string;
  structureHash: string;
  inputFingerprint: string;
};

export function valuationWorkbookLineageIsCurrent(
  approved: ValuationWorkbookLineage,
  current: ValuationWorkbookLineage,
): boolean {
  return (
    approved.validationApprovalId === current.validationApprovalId &&
    approved.validatedValueSetResourceVersionId ===
      current.validatedValueSetResourceVersionId &&
    approved.validatedWorkbookResourceVersionId ===
      current.validatedWorkbookResourceVersionId &&
    approved.sourceWorkbookResourceVersionId ===
      current.sourceWorkbookResourceVersionId &&
    approved.mappingSetResourceVersionId ===
      current.mappingSetResourceVersionId &&
    approved.workbookArtifactId === current.workbookArtifactId &&
    approved.workbookHash === current.workbookHash &&
    approved.structureHash === current.structureHash &&
    approved.inputFingerprint === current.inputFingerprint
  );
}

function groupedInteger(value: Decimal): string {
  return value.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export function canonicalTargetPer(value: unknown): string {
  if (typeof value !== "string" || !/^(?:\d+)(?:\.\d)?$/.test(value.trim())) {
    throw new ApiError(
      400,
      "INVALID_TARGET_PER",
      "Target PER은 소수 첫째 자리까지 입력해주세요.",
    );
  }
  const targetPer = new Decimal(value);
  if (targetPer.lt("0.1") || targetPer.gt("100.0")) {
    throw new ApiError(
      400,
      "INVALID_TARGET_PER",
      "Target PER은 0.1배 이상 100.0배 이하로 입력해주세요.",
    );
  }
  return targetPer.toFixed(1);
}

export function canonicalTargetPrice(value: unknown): string {
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value.trim())) {
    throw new ApiError(
      400,
      "INVALID_TARGET_PRICE",
      "목표주가는 1원 이상 정수로 입력해주세요.",
    );
  }
  const targetPrice = new Decimal(value);
  if (targetPrice.gt("1000000000")) {
    throw new ApiError(
      400,
      "INVALID_TARGET_PRICE",
      "목표주가는 10억원 이하로 입력해주세요.",
    );
  }
  return targetPrice.toFixed(0);
}

export function inverseTargetPer(targetPrice: string, forwardEps: string): string {
  const eps = new Decimal(forwardEps);
  if (!eps.isFinite() || eps.lte(0)) {
    throw new ApiError(
      422,
      "VALUATION_APPROVAL_BLOCKED",
      "Forward EPS가 0보다 커야 합니다.",
    );
  }
  const impliedPer = new Decimal(targetPrice).div(eps).toDecimalPlaces(1);
  if (impliedPer.lt("0.1") || impliedPer.gt("100.0")) {
    throw new ApiError(
      400,
      "INVALID_TARGET_PRICE",
      "입력한 목표주가로 계산한 PER이 허용 범위(0.1~100.0배)를 벗어납니다. 목표주가를 조정해주세요.",
    );
  }
  return canonicalTargetPer(impliedPer.toFixed(1));
}

export function upside(targetPrice: string, currentPrice: string): string {
  const current = new Decimal(currentPrice);
  if (!current.isFinite() || current.lte(0)) {
    throw new ApiError(
      422,
      "CURRENT_PRICE_UNAVAILABLE",
      "유효한 현재주가가 필요합니다.",
    );
  }
  return new Decimal(targetPrice).div(current).minus(1).toString();
}

export function sensitivityGrid(input: {
  forwardEps: string;
  targetPer: string;
}) {
  const eps = new Decimal(input.forwardEps);
  const per = new Decimal(input.targetPer);
  const epsOffsets = ["-0.10", "-0.05", "0", "0.05", "0.10"];
  const perOffsets = ["-2.0", "-1.0", "0", "1.0", "2.0"];
  const epsAxis = epsOffsets.map((offset) => {
    const rawValue = eps.mul(new Decimal(1).plus(offset)).toString();
    return {
      offset,
      rawValue,
      formattedText: `${groupedInteger(new Decimal(rawValue).toDecimalPlaces(0))}원`,
    };
  });
  const perByValue = new Map<
    string,
    { offset: string; rawValue: string; formattedText: string }
  >();
  for (const offset of perOffsets) {
    const rawValue = Decimal.max("0.1", per.plus(offset))
      .toDecimalPlaces(1)
      .toFixed(1);
    const axis = { offset, rawValue, formattedText: `${rawValue}배` };
    if (!perByValue.has(rawValue) || offset === "0") {
      perByValue.set(rawValue, axis);
    }
  }
  const perAxis = [...perByValue.values()].sort((left, right) =>
    new Decimal(left.rawValue).comparedTo(right.rawValue),
  );
  return {
    ruleVersion: "valuation-sensitivity-v1",
    epsAxis,
    perAxis,
    cells: epsAxis.flatMap((epsItem, row) =>
      perAxis.map((perItem, column) => {
        const rawValue = new Decimal(epsItem.rawValue)
          .mul(perItem.rawValue)
          .toString();
        return {
          row,
          column,
          rawValue,
          formattedText: `${groupedInteger(
            new Decimal(rawValue).toNearest(1000),
          )}원`,
          current: epsItem.offset === "0" && perItem.offset === "0",
        };
      }),
    ),
  };
}
