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
