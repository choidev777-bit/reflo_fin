import Decimal from "decimal.js";
import { ApiError } from "../http/api-error";

type UnitDefinition = {
  // ratio_point(%p)는 ratio(%)와 다른 family로 둬 퍼센트포인트 값이 %로 자동 스케일되지
  // 않게 한다(교차 변환 시 UNIT_MISMATCH로 명시적으로 실패).
  family: "currency" | "ratio" | "ratio_point" | "multiple" | "count";
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
  십억원: {
    family: "currency",
    canonical: "십억원",
    baseFactor: new Decimal(1_000_000_000),
  },
  조원: {
    family: "currency",
    canonical: "조원",
    baseFactor: new Decimal(1_000_000_000_000),
  },
  // targetUnit 코드형(KRW_MILLION/KRW_100M/KRW_BILLION)도 라벨과 동일하게 취급한다.
  // Excel 축 검증값은 unit에 코드를 담아 오는데 이 맵엔 라벨과 krw만 있어 누락됐다.
  krw_million: {
    family: "currency",
    canonical: "백만원",
    baseFactor: new Decimal(1_000_000),
  },
  krw_100m: {
    family: "currency",
    canonical: "억원",
    baseFactor: new Decimal(100_000_000),
  },
  krw_billion: {
    family: "currency",
    canonical: "십억원",
    baseFactor: new Decimal(1_000_000_000),
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
  배수: { family: "multiple", canonical: "배", baseFactor: new Decimal(1) },
  x: { family: "multiple", canonical: "배", baseFactor: new Decimal(1) },
  multiple: { family: "multiple", canonical: "배", baseFactor: new Decimal(1) },
  times: { family: "multiple", canonical: "배", baseFactor: new Decimal(1) },
  개: { family: "count", canonical: "개", baseFactor: new Decimal(1) },
  주: { family: "count", canonical: "주", baseFactor: new Decimal(1) },
  // 남은 통화 코드형(KRW_THOUSAND/KRW_TRILLION)과 비율/퍼센트포인트 표기도 흡수한다.
  krw_thousand: {
    family: "currency",
    canonical: "천원",
    baseFactor: new Decimal(1_000),
  },
  krw_trillion: {
    family: "currency",
    canonical: "조원",
    baseFactor: new Decimal(1_000_000_000_000),
  },
  퍼센트: { family: "ratio", canonical: "%", baseFactor: new Decimal("0.01") },
  pct: { family: "ratio", canonical: "%", baseFactor: new Decimal("0.01") },
  "%p": { family: "ratio_point", canonical: "%p", baseFactor: new Decimal(1) },
  pp: { family: "ratio_point", canonical: "%p", baseFactor: new Decimal(1) },
  퍼센트포인트: {
    family: "ratio_point",
    canonical: "%p",
    baseFactor: new Decimal(1),
  },
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
  let normalized = value.normalize("NFC").trim().replace(/\s+/g, "");
  // 전망/실적 역할 접미사(F/E/A/EST/P)는 기간 정체성이 아니라 valueKind 개념이므로
  // 기간 정규화 전에 제거한다. (예: "1Q26F" → "1Q26", "2027F" → "2027")
  normalized = normalized.replace(/(?:_|-)?(?:EST|F|E|A|P)$/i, "");
  // 연도-선행 분기: YYYY(년)(Q|년)N(분기)  — "2026Q1", "2026년2분기" 등
  const quarter = normalized.match(
    /^([12][0-9]{3})(?:년)?(?:-?Q|Q|년)?([1-4])(?:분기)?$/i,
  );
  if (quarter) return `${quarter[1]}년 ${quarter[2]}분기`;
  // 분기-선행 단축/전체 연도: NQyy / NQyyyy — PDF·리포트 라벨 "2Q26", "1Q2026"
  const quarterFirst = normalized.match(/^([1-4])Q([0-9]{2}|[12][0-9]{3})$/i);
  if (quarterFirst) {
    const year =
      quarterFirst[2].length === 2 ? `20${quarterFirst[2]}` : quarterFirst[2];
    return `${year}년 ${quarterFirst[1]}분기`;
  }
  // 연간: YYYY(년)(연간|사업연도)? / FYYYYY — "2025년 연간", "2025 사업연도", "FY2025"
  const annual = normalized.match(
    /^(?:FY)?([12][0-9]{3})(?:년)?(?:연간|사업연도|사업년도)?$/i,
  );
  if (annual) return `${annual[1]}년`;
  return value.normalize("NFC").trim().replace(/\s+/g, " ");
}

export function canonicalValidationScope(value: string): string {
  const normalized = value
    .normalize("NFC")
    .trim()
    .replace(/\s+/g, "")
    .toLowerCase();
  // DART 범위 코드(CFS=연결, OFS=별도)와 라벨을 동일하게 취급한다. PDF 원문은 scope에
  // 원문 제목("연결재무상태표")을 담기도 하므로 정확 일치가 아닌 포함으로 판정한다.
  // (dart-original-statement.ts도 "연결" 포함 여부로 CFS/OFS를 가른다.)
  if (["연결", "consolidated", "consol", "cfs"].some((t) => normalized.includes(t))) {
    return "연결";
  }
  if (["별도", "separate", "standalone", "ofs"].some((t) => normalized.includes(t))) {
    return "별도";
  }
  return value.normalize("NFC").trim().replace(/\s+/g, " ");
}

// valueKind도 period/scope/unit처럼 표현 차이를 흡수한다. 잠정 실적(preliminary_actual)은
// 확정 실적(actual) target을 충족하는 것으로 보고, 전망 계열 토큰(F/E/EST/전망/추정)은
// forecast로 접는다. null/미지정은 확정 실적으로 간주한다(공식 Excel 값은 실적이다).
export function canonicalValidationValueKind(
  value: string | null | undefined,
): string {
  const normalized = (value ?? "")
    .normalize("NFC")
    .trim()
    .replace(/\s+/g, "")
    .toLowerCase();
  if (
    normalized === "" ||
    ["actual", "a", "preliminary_actual", "preliminaryactual", "실적", "잠정실적", "확정"].includes(
      normalized,
    )
  ) {
    return "actual";
  }
  if (
    [
      "forecast",
      "f",
      "e",
      "est",
      "estimate",
      "projection",
      "projected",
      "전망",
      "예상",
      "추정",
    ].includes(normalized)
  ) {
    return "forecast";
  }
  return normalized;
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
