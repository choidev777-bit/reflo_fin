const reasonCopy: Record<string, string> = {
  CALCULATED_VALUE: "계산식 결과",
  CATEGORY_SERIES_LENGTH_VALIDATED: "범주·계열 길이 일치",
  CHART_CONTEXT_MATCH: "차트 문맥 일치",
  CHART_PATH_TEXT_CLUSTER: "선·텍스트 묶음 감지",
  COMPOSITE_AXIS_MATCH: "복합 축 구조 일치",
  COMPOSITE_TITLE_CLUSTER: "복합 차트 제목 감지",
  CONTEXT_MATCH: "주변 문맥 일치",
  CUTOFF_DATE_MATCH: "기준일 일치",
  DENSE_RANGE_TOPOLOGY: "밀집 표 구조",
  DOCUMENTED_MODEL_CONTRACT: "승인된 모델 위치",
  EMBEDDED_CHART_DEFINITION: "Excel 차트 정의",
  EXACT_ADDRESS: "정확한 셀 주소",
  EXACT_LABEL: "정확한 레이블",
  EXACT_RANGE: "정확한 범위",
  FIGURE_NUMBER_MATCH: "도표 번호 일치",
  FIXED_VISUAL_TITLE_CLUSTER: "고정 시각물",
  LABEL_MATCH: "레이블 일치",
  LEGEND_AXIS_PLOT_CLUSTER: "범례·축·플롯 묶음",
  MODEL_SHEET: "모델 시트",
  OFFICIAL_MARKET_CLOSE: "공식 종가",
  PERIOD_MATCH: "대상 기간 일치",
  PREVIOUS_TRADING_DAY: "직전 거래일",
  RANGE_CONTEXT_MATCH: "범위 문맥 일치",
  SCALAR_LABEL_VALUE_PAIR: "레이블·값 쌍",
  SCOPE_MATCH: "분석 범위 일치",
  SCOPE_TOKEN_MATCH: "범위 키워드 일치",
  SHEET_RANGE: "시트 범위 후보",
  STRUCTURED_RANGE: "구조화된 범위",
  TABLE_PATH_TEXT_CLUSTER: "표 선·텍스트 묶음",
  VALUE_TYPE_MATCH: "값 형식 일치",
  WORKBOOK_VERIFICATION_SOURCE: "Excel 교차 확인",
};

export function analysisReasonCopy(code: string): string {
  return reasonCopy[code] ?? code.toLowerCase().replaceAll("_", " ");
}

export function analysisConfidenceCopy(value: number | null): {
  label: string;
  level: "high" | "medium" | "low" | "unknown";
} {
  if (value == null) return { label: "신뢰도 미산정", level: "unknown" };
  if (value >= 0.9) return { label: `높음 ${Math.round(value * 100)}%`, level: "high" };
  if (value >= 0.7) {
    return { label: `검토 권장 ${Math.round(value * 100)}%`, level: "medium" };
  }
  return { label: `수동 확인 ${Math.round(value * 100)}%`, level: "low" };
}
