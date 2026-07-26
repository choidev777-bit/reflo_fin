import Decimal from "decimal.js";
import { ApiError } from "../http/api-error";

type UnitDefinition = {
  family: "currency" | "ratio" | "multiple" | "count";
  canonical: string;
  baseFactor: Decimal;
};

const UNIT_DEFINITIONS: Record<string, UnitDefinition> = {
  원: { family: "currency", canonical: "원", baseFactor: new Decimal(1) },
  krw: { family: "currency", canonical: "원", baseFactor: new Decimal(1) },
  천원: {
    family: "currency",
    canonical: "천원",
    baseFactor: new Decimal(1_000),
  },
  백만원: {
    family: "currency",
    canonical: "백만원",
    baseFactor: new Decimal(1_000_000),
  },
  억원: {
    family: "currency",
    canonical: "억원",
    baseFactor: new Decimal(100_000_000),
  },
  조원: {
    family: "currency",
    canonical: "조원",
    baseFactor: new Decimal(1_000_000_000_000),
  },
  "%": {
    family: "ratio",
    canonical: "%",
    baseFactor: new Decimal("0.01"),
  },
  percent: {
    family: "ratio",
    canonical: "%",
    baseFactor: new Decimal("0.01"),
  },
  ratio: {
    family: "ratio",
    canonical: "ratio",
    baseFactor: new Decimal(1),
  },
  비율: {
    family: "ratio",
    canonical: "ratio",
    baseFactor: new Decimal(1),
  },
  배: { family: "multiple", canonical: "배", baseFactor: new Decimal(1) },
  개: { family: "count", canonical: "개", baseFactor: new Decimal(1) },
  주: { family: "count", canonical: "주", baseFactor: new Decimal(1) },
};

function normalizationError(
  code: string,
  message: string,
  path: string,
): never {
  throw new ApiError(422, code, message, {
    details: [{ path, code, message }],
  });
}

export function canonicalValidatedDecimal(value: string): string {
  let parsed: Decimal;
  try {
    parsed = new Decimal(value.replaceAll(",", "").trim());
  } catch {
    return normalizationError(
      "VALIDATED_VALUE_INVALID",
      "검증 값이 올바른 10진수가 아닙니다.",
      "valueNormalized",
    );
  }
  if (!parsed.isFinite()) {
    return normalizationError(
      "VALIDATED_VALUE_INVALID",
      "검증 값은 유한한 10진수여야 합니다.",
      "valueNormalized",
    );
  }
  const decimalPlaces = Math.min(40, Math.max(0, parsed.decimalPlaces()));
  const fixed = parsed.toFixed(decimalPlaces);
  return fixed.includes(".")
    ? fixed.replace(/0+$/, "").replace(/\.$/, "") || "0"
    : fixed;
}

function unitDefinition(unit: string): UnitDefinition {
  const key = unit.normalize("NFC").replace(/\s+/g, "").toLowerCase();
  const definition = UNIT_DEFINITIONS[key];
  if (!definition) {
    return normalizationError(
      "VALIDATED_VALUE_UNIT_UNSUPPORTED",
      `지원하지 않는 단위입니다: ${unit}`,
      "unit",
    );
  }
  return definition;
}

export function canonicalValidationPeriod(value: string): string {
  const normalized = value.normalize("NFC").trim().replace(/\s+/g, "");
  const quarter = normalized.match(
    /^([12][0-9]{3})(?:년)?(?:-?Q|Q|년)?([1-4])(?:분기)?$/i,
  );
  if (quarter) return `${quarter[1]}년 ${quarter[2]}분기`;
  const koreanQuarter = normalized.match(/^([12][0-9]{3})년([1-4])분기$/);
  if (koreanQuarter) {
    return `${koreanQuarter[1]}년 ${koreanQuarter[2]}분기`;
  }
  const year = normalized.match(/^([12][0-9]{3})(?:년)?$/);
  if (year) return `${year[1]}년`;
  return value.normalize("NFC").trim().replace(/\s+/g, " ");
}

export function canonicalValidationScope(value: string): string {
  const normalized = value
    .normalize("NFC")
    .trim()
    .replace(/\s+/g, "")
    .toLowerCase();
  if (["연결", "consolidated", "consol"].includes(normalized)) {
    return "연결";
  }
  if (["별도", "separate", "standalone"].includes(normalized)) {
    return "별도";
  }
  return value.normalize("NFC").trim().replace(/\s+/g, " ");
}

export function convertValidatedDecimal(
  value: string,
  sourceUnit: string,
  targetUnit: string,
): {
  value: string;
  sourceUnit: string;
  targetUnit: string;
  scale: string;
  rule: "identity" | "unit_scale" | "ratio_conversion";
} {
  const source = unitDefinition(sourceUnit);
  const target = unitDefinition(targetUnit);
  if (source.family !== target.family) {
    return normalizationError(
      "VALIDATED_VALUE_UNIT_MISMATCH",
      `${sourceUnit} 값을 ${targetUnit} 단위로 변환할 수 없습니다.`,
      "unit",
    );
  }
  const scale = source.baseFactor.div(target.baseFactor);
  const original = new Decimal(canonicalValidatedDecimal(value));
  return {
    value: canonicalValidatedDecimal(original.mul(scale).toString()),
    sourceUnit: source.canonical,
    targetUnit: target.canonical,
    scale: canonicalValidatedDecimal(scale.toString()),
    rule:
      scale.equals(1)
        ? "identity"
        : source.family === "ratio"
          ? "ratio_conversion"
          : "unit_scale",
  };
}
