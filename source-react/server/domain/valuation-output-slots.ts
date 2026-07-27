/**
 * PER 밸류에이션은 Forward EPS · Target PER · 목표주가 세 값을 Excel 모델
 * 셀에서 직접 읽어야 한다(`loadRequiredWorkbookOutputBindings`).
 *
 * 이 세 값의 mapping entry는 template IR의 scalar slot에서만 만들어지는데,
 * 국내 리서치 보고서 원본에서는 EPS·PER 라벨이 Key Data·투자지표 표 **안**에
 * 인쇄되는 경우가 대부분이다. PDF 분석기는 표(data region) 안의 span을 scalar
 * 후보에서 제외하므로 `eps`·`per` slot이 생성되지 않고, 결과적으로 mapping
 * entry도 없어 STEP 05 Excel 반영과 STEP 06 밸류에이션이 영구히 409로 막힌다.
 *
 * 이 세 슬롯은 보고서에 무엇이 인쇄되는지와 무관하게 **밸류에이션 모델의
 * 입력 위치**를 가리키므로, template IR에 없으면 workbook 전용 합성 슬롯으로
 * 보완한다. 합성 슬롯은 template IR 자체에는 추가하지 않는다(PDF 렌더링·블록
 * 구조는 그대로 두고, mapping set과 mapping entry에만 참여한다).
 */

export const REQUIRED_VALUATION_OUTPUT_METRICS = [
  "eps",
  "per",
  "target_price",
] as const;

export type ValuationOutputMetric =
  (typeof REQUIRED_VALUATION_OUTPUT_METRICS)[number];

export type ValuationOutputSlot = {
  slotId: string;
  blockId: string;
  valueType: "money" | "decimal";
  semanticKey: { metric: ValuationOutputMetric };
  required: false;
};

const VALUATION_OUTPUT_VALUE_TYPES: Readonly<
  Record<ValuationOutputMetric, "money" | "decimal">
> = {
  eps: "money",
  per: "decimal",
  target_price: "money",
};

const SLOT_ID_PREFIX = "slot_valuation_output_";
const BLOCK_ID_PREFIX = "block_valuation_output_";

export function valuationOutputSlotId(metric: ValuationOutputMetric): string {
  return `${SLOT_ID_PREFIX}${metric}`;
}

export function isValuationOutputSlotId(slotId: string): boolean {
  return REQUIRED_VALUATION_OUTPUT_METRICS.some(
    (metric) => valuationOutputSlotId(metric) === slotId,
  );
}

type SlotLike = {
  valueType?: string | null;
  semanticKey?: { metric?: string | null } | null;
} | null | undefined;

/**
 * template IR이 이미 제공하는 scalar slot은 그대로 사용하고, 누락된 밸류에이션
 * 출력 metric에 대해서만 합성 슬롯을 만든다. 표·차트 slot은 값 하나를 가리키지
 * 않으므로 scalar 출처로 인정하지 않는다.
 */
export function missingValuationOutputSlots(
  slots: readonly SlotLike[],
): ValuationOutputSlot[] {
  const present = new Set<string>();
  for (const slot of slots) {
    const metric = slot?.semanticKey?.metric;
    if (!metric) continue;
    const valueType = slot?.valueType;
    if (valueType === "table" || valueType === "chart") continue;
    present.add(metric);
  }
  // `required: false` — 이 슬롯이 해결되지 않아도 STEP 02 적합성 검사를 막지
  // 않는다. 밸류에이션에 반드시 필요한 값이지만, 파일 검사 단계에서 하드
  // 블로킹하면 기존 STEP 05 잠금을 더 이른 잠금으로 바꾸는 셈이 된다. 대신
  // entry가 생기므로 사용자가 STEP 02 매핑 화면에서 셀을 직접 지정할 수 있고,
  // 미해결 상태는 mapping set warning으로 드러난다.
  return REQUIRED_VALUATION_OUTPUT_METRICS.filter(
    (metric) => !present.has(metric),
  ).map((metric) => ({
    slotId: valuationOutputSlotId(metric),
    blockId: `${BLOCK_ID_PREFIX}${metric}`,
    valueType: VALUATION_OUTPUT_VALUE_TYPES[metric],
    semanticKey: { metric },
    required: false as const,
  }));
}

/** template IR slot + 합성 슬롯을 합친 mapping 대상 slot 목록. */
export function withValuationOutputSlots<T extends SlotLike>(
  slots: readonly T[],
): Array<T | ValuationOutputSlot> {
  return [...slots, ...missingValuationOutputSlots(slots)];
}
