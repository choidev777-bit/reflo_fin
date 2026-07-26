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
