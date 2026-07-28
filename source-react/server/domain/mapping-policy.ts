export type DeferredMappingPolicy = {
  resolution: "external_pending" | "later_stage";
  sourceLabel: string;
  destinationLabel: string;
  ownerStage: string;
  exclusiveSource: boolean;
};

const deferredPolicies: Readonly<Record<string, DeferredMappingPolicy>> = {
  current_price: {
    resolution: "external_pending",
    sourceLabel: "KRX 기준일 종가",
    destinationLabel: "현재주가 슬롯",
    ownerStage: "자료 수집",
    exclusiveSource: true,
  },
  figure_2_chart: {
    resolution: "external_pending",
    sourceLabel: "FnGuide 역사적 Forward EPS + KRX 주가",
    destinationLabel: "06_도표2_PER_Band",
    ownerStage: "자료 수집",
    exclusiveSource: false,
  },
  figure_3_chart: {
    resolution: "external_pending",
    sourceLabel: "DART Historical BPS + KRX 주가",
    destinationLabel: "07_도표3_PBR_Band",
    ownerStage: "자료 수집",
    exclusiveSource: false,
  },
  consensus_data: {
    resolution: "external_pending",
    sourceLabel: "FnGuide 컨센서스",
    destinationLabel: "02_p1_Consensus",
    ownerStage: "자료 수집",
    exclusiveSource: false,
  },
  stock_price: {
    resolution: "external_pending",
    sourceLabel: "KRX 기준일 이전 주가 시계열",
    destinationLabel: "03_p1_주가추이",
    ownerStage: "자료 수집",
    exclusiveSource: false,
  },
  investment_opinion: {
    resolution: "later_stage",
    sourceLabel: "사용자가 확정한 투자의견",
    destinationLabel: "투자의견 슬롯",
    ownerStage: "투자 의견 · 조사 질문",
    exclusiveSource: true,
  },
};

export function deferredMappingPolicy(
  metric: string,
): DeferredMappingPolicy | null {
  return deferredPolicies[metric] ?? null;
}

export function deferredMappingResolvesRequiredSlot(metric: string): boolean {
  return Boolean(deferredMappingPolicy(metric));
}

/**
 * 이 필수 슬롯이 STEP 02 완료를 막아야 하는가.
 *
 * 막는 기준은 "필수인데 아직 안 골랐다"가 아니라 **사용자가 지금 할 수 있는
 * 일이 남아 있는가**이다. Excel 후보가 하나도 없으면 검사 화면에는 고를 것이
 * 없고, 원본 선택 dropdown 자체가 그려지지 않는다. 그것을 미해결로 세면 완료
 * 버튼이 `원본 확인 필요` 상태로 영구히 잠겨 STEP 02를 빠져나갈 수 없다.
 *
 * 후보가 없는 슬롯은 후속 단계에서 원본을 연결하도록 넘기고 게이트는 열어 둔다.
 * 후보가 있는데 고르지 않은 슬롯은 그대로 막는다 — 그건 사용자가 해결할 수 있다.
 */
export function requiredSlotBlocksInspection(input: {
  metric: string;
  candidateCount: number;
  bound: boolean;
}): boolean {
  if (input.bound) return false;
  if (deferredMappingResolvesRequiredSlot(input.metric)) return false;
  if (input.candidateCount === 0) return false;
  return true;
}
