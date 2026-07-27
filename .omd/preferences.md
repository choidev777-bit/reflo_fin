---
schema: omd.preferences/v1
design_md_hash_at_creation:
resolved_at: 2026-07-25T00:00:00+09:00
source_entry_count: 245
pending_count: 0
---

# Preference Log

245개 사용자 교정 기록을 검토해 현재 유효한 규칙을 다음 문서에 통합했다.

- 전역 디자인 원칙: [`../DESIGN.md`](../DESIGN.md)
- 화면별 구현 결정: [`../docs/REFLO_UI_IMPLEMENTATION_DECISIONS_v1.md`](../docs/REFLO_UI_IMPLEMENTATION_DECISIONS_v1.md)
- 원본 이력: [`preferences.history.md`](./preferences.history.md)

동일 대상을 여러 번 수정한 기록은 가장 마지막의 명시적 사용자 교정을 적용했다. 이전 값은 구현 기준이 아니다. 새 교정만 이 파일 아래에 `status: pending`으로 추가한다.

## Applied corrections

- id: `2026-07-27-phase3-question-metadata-visibility`
  status: applied
  correction: STEP 03 질문 목록에서는 질문 본문만 표시하고 기간·비교 기준·지표 metadata는 후속 조사 입력으로만 유지한다.
  applied_to:
    - `../docs/REFLO_UI_IMPLEMENTATION_DECISIONS_v1.md`
    - `../source-react/app/_phase3/HypothesisScreen.tsx`
- id: `2026-07-27-phase3-question-row-actions`
  status: applied
  correction: STEP 03 질문 행에서는 수정·삭제만 표시하고 드래그·위로·아래로 이동 control은 제거한다.
  applied_to:
    - `../docs/REFLO_UI_IMPLEMENTATION_DECISIONS_v1.md`
    - `../source-react/app/_phase3/HypothesisScreen.tsx`
- id: `2026-07-27-phase4-question-materials`
  status: applied
  correction: STEP 04의 공통 사용자 제공 원문 영역을 제거하고, 각 질문의 출처 조정 dialog에서 기업 IR은 공식 PDF를, 사용자 자료는 PDF 또는 공개 URL을 질문별로 연결한다.
  applied_to:
    - `../docs/REFLO_UI_IMPLEMENTATION_DECISIONS_v1.md`
    - `../source-react/app/_phase4/ResearchPlanScreen.tsx`
    - `../source-react/server/domain/research-validation.ts`
- id: `2026-07-27-phase4-global-materials-restored`
  status: applied
  correction: 이전 질문별 자료 연결 변경을 취소한다. 기업 IR과 사용자 자료는 STEP 04 하단의 공통 사용자 제공 원문 영역에서 PDF 업로드 또는 공개 URL로 등록한다.
  applied_to:
    - `../docs/REFLO_UI_IMPLEMENTATION_DECISIONS_v1.md`
    - `../source-react/app/_phase4/ResearchPlanScreen.tsx`
    - `../source-react/server/domain/research-validation.ts`
- id: `2026-07-27-phase4-sidebar-colors`
  status: applied
  correction: STEP 04 이후 workflow sidebar는 이전 단계와 동일한 near-black 배경, muted text, lime active marker를 사용한다.
  applied_to:
    - `../docs/REFLO_UI_IMPLEMENTATION_DECISIONS_v1.md`
    - `../source-react/app/_phase4/ProcessShell.tsx`
    - `../source-react/app/globals.css`
- id: `2026-07-27-phase4-report-targets`
  status: applied
  correction: STEP 04 Excel tab은 출처별 목록이 아니라 PDF–Excel 연동 리포트 입력 대상을 기준으로 표시하고, 각 대상의 Excel 연결·기간별 유지/수집/후속 처리·출처 정책을 함께 보여준다.
  applied_to:
    - `../docs/REFLO_UI_IMPLEMENTATION_DECISIONS_v1.md`
    - `../source-react/app/_phase4/ResearchPlanScreen.tsx`
    - `../source-react/server/domain/research-report-targets.ts`
    - `../source-react/app/globals.css`
- id: `2026-07-27-phase4-remove-blocker-panel`
  status: applied
  correction: STEP 04 본문 아래의 별도 계획 차단 항목 경고 panel은 표시하지 않고 필요한 상태와 조치는 해당 질문·리포트 입력 대상 안에서 보여준다.
  applied_to:
    - `../docs/REFLO_UI_IMPLEMENTATION_DECISIONS_v1.md`
    - `../source-react/app/_phase4/ResearchPlanScreen.tsx`
    - `../source-react/app/globals.css`
- id: `2026-07-27-phase4-hide-period-diagnostics`
  status: applied
  correction: STEP 04 리포트 입력 대상 card에서 필요 기간 누락·이전 기간 잔존·실적/전망 구분 불일치 같은 내부 기간 진단 footer는 표시하지 않는다.
  applied_to:
    - `../docs/REFLO_UI_IMPLEMENTATION_DECISIONS_v1.md`
    - `../source-react/app/_phase4/ResearchPlanScreen.tsx`
    - `../source-react/app/globals.css`
- id: `2026-07-27-phase4-hide-empty-filters`
  status: applied
  correction: STEP 04 리포트 입력 대상 상태 필터는 해당 대상이 1개 이상일 때만 표시하고 0건 필터는 숨긴다.
  applied_to:
    - `../docs/REFLO_UI_IMPLEMENTATION_DECISIONS_v1.md`
    - `../source-react/app/_phase4/ResearchPlanScreen.tsx`
    - `../source-react/app/globals.css`
- id: `2026-07-27-phase4-question-card-sources-only`
  status: applied
  correction: STEP 04 질문 card는 `출처 · 수집 방식`만 표시하고 `확인할 근거`와 `기간 · 비교` 행은 제거한다. 두 값은 이 화면에서 편집할 수 없고 질문 본문과 중복되므로 수집·검증 입력으로만 유지한다.
  note: 같은 원칙의 STEP 03 교정 `2026-07-27-phase3-question-metadata-visibility`를 STEP 04에 동일하게 적용한 것이다.
  applied_to:
    - `../docs/REFLO_UI_IMPLEMENTATION_DECISIONS_v1.md`
    - `../source-react/app/_phase4/ResearchPlanScreen.tsx`
- id: `2026-07-27-phase4-news-window-user-editable`
  status: applied
  correction: 뉴스 검색 기간은 서버 고정값이 아니라 출처 설정 dialog에서 사용자가 시작일·종료일을 직접 지정한다. 종료일 상한은 보고서 기준일, 최대 기간은 240일이며 비워 두면 기존 기본값을 적용한다.
  applied_to:
    - `../docs/REFLO_UI_IMPLEMENTATION_DECISIONS_v1.md`
    - `../source-react/app/_phase4/ResearchPlanScreen.tsx`
    - `../source-react/app/globals.css`
    - `../source-react/server/domain/research-validation.ts`
    - `../source-react/server/infrastructure/repositories/phase4-repository.ts`
