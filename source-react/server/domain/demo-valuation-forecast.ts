/**
 * 시연용 STEP 06 전망 연도 입력값 (대덕전자 353200).
 *
 * Excel roll-forward는 모델을 한 해 민다(`2023~2027F` → `2024~2028F`). 그래서
 * 마지막 전망 열은 빈 채로 STEP 06에 도착한다. 이건 결함이 아니라 설계다 —
 * 그 열은 애널리스트가 직접 입력하는 자기 추정치이고, 어떤 자료에서도 가져올
 * 수 없다.
 *
 * 문제는 시연이다. 승인 게이트(`REQUIRED_INPUT_MISSING`)가 85칸을 모두 요구하는데
 * 촬영 중에 그걸 손으로 칠 수는 없다. 그래서 시연 모드에서만 이 값을 미리
 * 채워 두고, 발표자는 "원래 이 칸들은 애널리스트가 직접 입력한다"고 설명하고
 * 넘어간다.
 *
 * 값의 출처: 하나증권 대덕전자 4Q25 Valuation 모델의 추정 논리를 2028F로
 * 연장한 수치다. 시연 중 화면에 그대로 보이므로 실제 모델과 어긋나지 않는
 * 값이어야 한다(매출 계 1,810 / 영업이익 247.3 / 지배주주순이익 209.8).
 *
 * 시트는 `sheetId`가 아니라 **시트 이름**으로 찾는다. `sheetId`는 zip 안의
 * 순서에서 나오므로 다른 파일에서 같은 id가 다른 시트를 가리킬 수 있다. 이름이
 * 안 맞으면 아무것도 채우지 않고 넘어간다(다른 기업 모델 보호).
 */

/**
 * 시연에서 확정하는 Target PER.
 *
 * Excel의 `적정 P/E`(27.82배)는 Peer 평균이지만 그 모델은 주가 52,500원 시점에
 * 만들어졌다. 현재주가(109,400원)에 그대로 대면 목표주가가 84,000원으로 내려가
 * 상승여력이 -23%가 되고, STEP 03에서 입력하는 강세 투자의견과 STEP 07 보고서가
 * 정면으로 어긋난다.
 *
 * 41.9배는 목표주가 127,000원·상승여력 +16%를 만든다. Peer 최고치(Ibiden 36배)
 * 위이지만 AI·데이터센터 사이클 프리미엄으로 설명되는 범위이고, 애널리스트
 * 목표주가로 무리가 없다.
 */
export const DEMO_TARGET_PER = "41.9";

export type DemoForecastCell = {
  sheetName: string;
  address: string;
  value: string;
};

/** 2028F 열. M1의 7칸이 추정의 입력 원천이고 나머지는 재무제표 상수다. */
export const DEMO_FORECAST_CELLS: readonly DemoForecastCell[] = [
  // M1_실적추정_모델 · L열(2028F) — 세그먼트 매출과 손익 입력
  { sheetName: "M1_실적추정_모델", address: "L12", value: "850" },
  { sheetName: "M1_실적추정_모델", address: "L13", value: "630" },
  { sheetName: "M1_실적추정_모델", address: "L14", value: "330" },
  { sheetName: "M1_실적추정_모델", address: "L15", value: "0" },
  { sheetName: "M1_실적추정_모델", address: "L21", value: "247.3" },
  { sheetName: "M1_실적추정_모델", address: "L25", value: "262.3" },
  { sheetName: "M1_실적추정_모델", address: "L26", value: "209.8" },
  // M2_목표주가_타겟멀티플 · Peer 슬롯(필수는 아니지만 비면 표가 비어 보인다)
  { sheetName: "M2_목표주가_타겟멀티플", address: "C40", value: "34" },
  // 12_p4_손익계산서 · F열(2028F)
  { sheetName: "12_p4_손익계산서", address: "F6", value: "1498.7" },
  { sheetName: "12_p4_손익계산서", address: "F8", value: "64" },
  { sheetName: "12_p4_손익계산서", address: "F10", value: "10" },
  { sheetName: "12_p4_손익계산서", address: "F11", value: "5" },
  { sheetName: "12_p4_손익계산서", address: "F12", value: "0" },
  { sheetName: "12_p4_손익계산서", address: "F14", value: "52.5" },
  { sheetName: "12_p4_손익계산서", address: "F16", value: "0" },
  { sheetName: "12_p4_손익계산서", address: "F18", value: "0" },
  { sheetName: "12_p4_손익계산서", address: "F20", value: "209.8" },
  { sheetName: "12_p4_손익계산서", address: "F21", value: "197.8" },
  { sheetName: "12_p4_손익계산서", address: "F22", value: "335.3" },
  // 13_p4_대차대조표 · F열(2028F)
  { sheetName: "13_p4_대차대조표", address: "F5", value: "1357.7" },
  { sheetName: "13_p4_대차대조표", address: "F6", value: "797.2" },
  { sheetName: "13_p4_대차대조표", address: "F7", value: "364" },
  { sheetName: "13_p4_대차대조표", address: "F8", value: "306" },
  { sheetName: "13_p4_대차대조표", address: "F9", value: "217" },
  { sheetName: "13_p4_대차대조표", address: "F10", value: "37.5" },
  { sheetName: "13_p4_대차대조표", address: "F11", value: "523.5" },
  { sheetName: "13_p4_대차대조표", address: "F12", value: "6.9" },
  { sheetName: "13_p4_대차대조표", address: "F13", value: "6.9" },
  { sheetName: "13_p4_대차대조표", address: "F14", value: "471.7" },
  { sheetName: "13_p4_대차대조표", address: "F15", value: "11" },
  { sheetName: "13_p4_대차대조표", address: "F16", value: "33.9" },
  { sheetName: "13_p4_대차대조표", address: "F17", value: "1881.2" },
  { sheetName: "13_p4_대차대조표", address: "F18", value: "386" },
  { sheetName: "13_p4_대차대조표", address: "F19", value: "28" },
  { sheetName: "13_p4_대차대조표", address: "F20", value: "101" },
  { sheetName: "13_p4_대차대조표", address: "F21", value: "257" },
  { sheetName: "13_p4_대차대조표", address: "F22", value: "112.7" },
  { sheetName: "13_p4_대차대조표", address: "F23", value: "1.7" },
  { sheetName: "13_p4_대차대조표", address: "F24", value: "111" },
  { sheetName: "13_p4_대차대조표", address: "F25", value: "498.7" },
  { sheetName: "13_p4_대차대조표", address: "F26", value: "1382.5" },
  { sheetName: "13_p4_대차대조표", address: "F27", value: "25.8" },
  { sheetName: "13_p4_대차대조표", address: "F28", value: "545.1" },
  { sheetName: "13_p4_대차대조표", address: "F29", value: "0" },
  { sheetName: "13_p4_대차대조표", address: "F30", value: "0.7" },
  { sheetName: "13_p4_대차대조표", address: "F31", value: "810.9" },
  { sheetName: "13_p4_대차대조표", address: "F32", value: "0" },
  { sheetName: "13_p4_대차대조표", address: "F33", value: "1382.5" },
  { sheetName: "13_p4_대차대조표", address: "F34", value: "-767.5" },
  // 14_p4_투자지표 · F열(2028F)
  { sheetName: "14_p4_투자지표", address: "F6", value: "4245" },
  { sheetName: "14_p4_투자지표", address: "F7", value: "26838" },
  { sheetName: "14_p4_투자지표", address: "F8", value: "6748" },
  { sheetName: "14_p4_투자지표", address: "F9", value: "6509" },
  { sheetName: "14_p4_투자지표", address: "F10", value: "35137" },
  { sheetName: "14_p4_투자지표", address: "F11", value: "400" },
  { sheetName: "14_p4_투자지표", address: "F14", value: "12.36" },
  { sheetName: "14_p4_투자지표", address: "F15", value: "1.96" },
  { sheetName: "14_p4_투자지표", address: "F16", value: "7.78" },
  { sheetName: "14_p4_투자지표", address: "F17", value: "5.78" },
  { sheetName: "14_p4_투자지표", address: "F18", value: "1.49" },
  { sheetName: "14_p4_투자지표", address: "F21", value: "0.1629" },
  { sheetName: "14_p4_투자지표", address: "F22", value: "0.1187" },
  { sheetName: "14_p4_투자지표", address: "F23", value: "0.325" },
  { sheetName: "14_p4_투자지표", address: "F24", value: "0.3607" },
  { sheetName: "14_p4_투자지표", address: "F25", value: "-0.5552" },
  { sheetName: "14_p4_투자지표", address: "F26", value: "0" },
  // 15_p4_현금흐름표 · F열(2028F)
  { sheetName: "15_p4_현금흐름표", address: "F5", value: "287.9" },
  { sheetName: "15_p4_현금흐름표", address: "F6", value: "209.8" },
  { sheetName: "15_p4_현금흐름표", address: "F7", value: "88" },
  { sheetName: "15_p4_현금흐름표", address: "F8", value: "88" },
  { sheetName: "15_p4_현금흐름표", address: "F9", value: "0" },
  { sheetName: "15_p4_현금흐름표", address: "F10", value: "0" },
  { sheetName: "15_p4_현금흐름표", address: "F11", value: "0" },
  { sheetName: "15_p4_현금흐름표", address: "F12", value: "-9.9" },
  { sheetName: "15_p4_현금흐름표", address: "F13", value: "-105" },
  { sheetName: "15_p4_현금흐름표", address: "F14", value: "0" },
  { sheetName: "15_p4_현금흐름표", address: "F15", value: "-65" },
  { sheetName: "15_p4_현금흐름표", address: "F16", value: "-40" },
  { sheetName: "15_p4_현금흐름표", address: "F17", value: "-27.1" },
  { sheetName: "15_p4_현금흐름표", address: "F18", value: "-6.5" },
  { sheetName: "15_p4_현금흐름표", address: "F19", value: "0" },
  { sheetName: "15_p4_현금흐름표", address: "F20", value: "0" },
  { sheetName: "15_p4_현금흐름표", address: "F21", value: "-20.6" },
  { sheetName: "15_p4_현금흐름표", address: "F22", value: "155.8" },
  { sheetName: "15_p4_현금흐름표", address: "F23", value: "325.9" },
  { sheetName: "15_p4_현금흐름표", address: "F24", value: "222.9" },
];

type SeedReadModel = {
  sheets: Array<{
    sheetId: string;
    name: string;
    cells: Array<{ address: string; rawValue: string | null }>;
  }>;
  editableCells: Array<{ sheetId: string; address: string }>;
};

export type DemoForecastChange = {
  sheetId: string;
  address: string;
  valueType: "number";
  value: string;
};

/**
 * 시연 값 중 **지금 채워도 되는 것만** 고른다.
 *
 * 세 조건을 모두 만족해야 한다. 하나라도 어긋나면 그 칸은 건너뛴다.
 * - 시트 이름이 일치한다 (다른 기업 모델이면 0건이 되어 아무 일도 안 일어난다)
 * - 그 셀이 편집 가능하다 (수식·읽기전용 칸을 덮어쓰지 않는다)
 * - 그 셀이 비어 있다 (사용자가 화면에서 이미 입력한 값을 되돌리지 않는다)
 *
 * 마지막 조건 덕분에 여러 번 호출해도 안전하다. 첫 호출 뒤에는 채울 게 없어
 * 빈 배열이 나온다.
 */
export function demoForecastSeedChanges(
  readModel: SeedReadModel,
): DemoForecastChange[] {
  const sheetIdByName = new Map(
    readModel.sheets.map((sheet) => [sheet.name, sheet.sheetId]),
  );
  const editable = new Set(
    readModel.editableCells.map((cell) => `${cell.sheetId}:${cell.address}`),
  );
  const rawValues = new Map<string, string | null>(
    readModel.sheets.flatMap((sheet) =>
      sheet.cells.map(
        (cell) => [`${sheet.sheetId}:${cell.address}`, cell.rawValue] as const,
      ),
    ),
  );
  const changes: DemoForecastChange[] = [];
  for (const cell of DEMO_FORECAST_CELLS) {
    const sheetId = sheetIdByName.get(cell.sheetName);
    if (!sheetId) continue;
    const key = `${sheetId}:${cell.address}`;
    if (!editable.has(key)) continue;
    if (rawValues.get(key)?.trim()) continue;
    changes.push({
      sheetId,
      address: cell.address,
      valueType: "number",
      value: cell.value,
    });
  }
  return changes;
}
