# REFLO UI 구현 결정 v1

**상태:** 구현 기준선
**확정일:** 2026-07-25
**입력:** `.omd/preferences.history.md`의 사용자 교정 245건
**우선순위:** 서비스 동작·기술 계약을 바꾸지 않는 범위에서 `DESIGN.md` 다음의 UI 권위 문서

## 1. 해석 규칙

1. 같은 대상을 여러 번 수정한 경우 가장 마지막의 명시적 사용자 교정을 적용한다.
2. 이전 교정은 설계 이력이며 현재 구현값이 아니다.
3. 표본의 페이지 수·값·문구보다 Template IR, workbook와 API 응답이 우선한다.
4. 접근성, 44px 상호작용 영역, 키보드 조작과 반응형 동작은 시각 미세조정보다 우선한다.
5. 화면에 이미 보이는 정보는 설명, badge, count와 banner로 반복하지 않는다.

## 2. 전역 shell·navigation·copy

- workflow는 사용자에게 연속된 `01–07` 단계로 보이고 내부 navigation index와 분리한다.
- sidebar는 `2–2–3` 묶음을 사용한다. 단독 항목 group을 만들지 않는다.
- STEP 01은 `기업 · 작성 정보 입력`, STEP 03은 `투자의견 · 조사 질문`, STEP 04는 `자료 수집 및 계획`, STEP 05는 `조사 결과 검증`을 사용한다.
- 한국어 middle dot 앞뒤에 공백을 둔다.
- process 화면 제목은 weight 500, `최근 프로젝트` 제목은 weight 600을 사용한다.
- copy는 짧고 행동 중심으로 쓴다. 위치 설명, 내부 생성 경로, 반복 helper와 0건 요약을 생략한다.
- 사용자가 확정하는 판단과 AI 제안을 시각·언어적으로 분리한다.
- 모든 주요 action, checkbox label, icon action은 최소 44px hit area와 keyboard focus를 제공한다.
- primary next button은 흰색의 얇은 line chevron을 label과 함께 중앙 정렬한다.
- 완료·결과 확인 action은 `#c8ff3d`와 near-black text, 검사·원문 열기는 중립 action을 사용한다.

## 3. 공통 component

### 3.1 Tabs

- 선택 tab은 content panel에 직접 연결된 흰색 surface, restrained lime edge와 명확한 active marker를 사용한다.
- inactive tab은 neutral surface를 사용한다. status pill이나 inset border로 선택을 표현하지 않는다.
- tab title은 목적을 설명하며 불필요한 suffix, count와 guide bar를 생략한다.

### 3.2 Inputs

- editable value는 명확한 border, in-field unit와 한 겹의 focus border를 사용한다.
- date input은 field 전체 click으로 picker를 연다.
- selected checkbox는 22px deep-green box와 2px white check를 사용한다. check glyph는 광학적으로 3px 위로 보정한다.
- checkbox 주변 label 전체는 44px 이상의 click target을 유지한다.

### 3.3 Cards·dialogs

- cards는 flat surface, hairline 또는 tint로 묶는다. decorative shadow와 반복 header action을 쓰지 않는다.
- dialog는 paper-white surface, header 우측의 borderless close action을 사용한다.
- approval dialog는 text-only primary CTA 하나를 사용하고 중복 back action과 decorative arrow를 생략한다.
- carousel은 넓은 화면에서 preview 바깥, 작은 화면에서 preview 아래에 navigation을 둔다.

## 4. 홈·프로젝트·설정

- project back arrow는 lime이 아닌 Ink를 사용한다.
- project 목록 row는 0px corner의 연속 table 형태를 사용한다.
- desktop project overview는 top padding 0, eyebrow 아래 14px, heading 아래 10px을 사용한다. compact breakpoint는 16px page inset을 유지한다.
- project setup field label은 12px을 사용한다.
- company mismatch dialog는 16px horizontal padding, 30px icon과 20px glyph를 사용한다.
- 기업 분야는 고정 문구를 사용하지 않고 선택 기업의 KRX 업종을 읽기 전용으로 표시·저장한다.
- 밸류에이션 모델은 `PER`, `PBR`, `EV/EBITDA`, `DCF` 중 선택하며 기본값과 데모 선택값은 `PER`다.

## 5. 파일 업로드·분석

- 분석 결과 card는 중복 header 설명, 0건 상태 요약과 가짜 issue-resolution panel을 표시하지 않는다.
- 재분석은 의존 workbook 요약값을 함께 갱신한다.
- upload analysis dialog는 title row 하나만 두고 nested bordered header card를 만들지 않는다.
- 비교 action은 wide screen에서 close button 아래 upper-right에 둔다.
- 다중 page preview는 같은 horizontal carousel interaction을 사용한다.
- PDF 표본의 region count 같은 fixture 값은 실제 분석 응답으로 교체하고 전역 상수로 사용하지 않는다.

## 6. 투자 가설·자료 수집 계획

- STEP 03 subtitle은 `지금 생각하는 투자 가설을 적으면 AI가 조사할 질문으로 나눕니다.`를 사용한다.
- 의견 파생 질문은 `현재 의견을 반영한 가설 질문`으로 부른다.
- research-plan tab은 `가설 확인을 위한 자료 수집`, `입력값 삽입을 위한 자료 수집` 순서다.
- content panel 아래에 목적 header를 반복하지 않는다.
- 가설 tab은 출처를 tab 단위로 한 번 설정하고 질문 전체를 수집 대상으로 선택한다.
- 질문 선택 상태는 `이 질문으로 자료 수집`, `자료 수집 안 함`으로 결과를 말한다.
- 질문은 두 자리 연속 번호를 사용하고 추가·삭제 후 다시 정렬한다.
- STEP 03 질문 목록은 질문 본문만 표시한다. 기간·비교 기준·지표 metadata는 후속 조사 입력으로 유지하되 사용자 화면에는 반복 노출하지 않는다.
- STEP 03 질문 행의 사용자 action은 `수정`, `삭제`만 제공하며 수동 순서 변경 control은 표시하지 않는다.
- 각 질문은 top-right 44px X action으로 개별 제거한다. 리포트 입력 대상은 PDF–Excel mapping에서 파생되므로 이 화면에서 제거하지 않는다.
- question card는 content 높이만큼 확장하며 내부 scroll을 만들지 않는다.
- tablet·desktop question card는 right padding 26px, mobile은 12px을 사용한다.
- content shell은 tab 아래 side·bottom hairline만 사용한다. question card hover는 layout shift 없는 1px `#75a900` inner outline을 사용한다.
- Excel tab은 출처가 아니라 PDF와 연결된 리포트 입력 대상을 기준으로 나열한다. 각 대상은 PDF page·요소 종류·필수 여부, Excel sheet·range, 기간별 처리 계획과 출처 정책을 함께 표시한다.
- 기간별 처리는 `기존값 유지`, `자료 수집`, `후속 단계`, `연결 확인`으로 구분한다. 연간 재무표는 과거 실제값을 유지하고 최신 확정 연도는 DART로 교체하며 미래 전망값은 후속 Excel·밸류에이션 단계에서 확정한다.
- 출처는 metric 정책에서 파생한다. 재무제표는 DART, 주가는 KRX, 수주잔고는 기업 IR, consensus는 FnGuide를 권위 출처로 사용하고 필요한 경우 검증 출처를 함께 표시한다.
- 목표주가·Valuation처럼 계산 결과인 항목은 자료 수집 대상으로 만들지 않고 `후속 단계`에 둔다. 현재 자동 연결을 지원하지 않는 FnGuide 항목은 `연결 확인`에 둔다.
- 리포트 입력 대상 상태 필터는 해당 대상이 1개 이상일 때만 표시한다. 0건 필터와 빈 결과 화면은 노출하지 않는다.
- STEP 04 본문 아래에 별도 `계획 차단 항목` 경고 영역을 두지 않는다. 필요한 상태와 조치는 각 질문·리포트 입력 대상 안에서 직접 표시하되, `필요 기간 누락`·`이전 기간 잔존`·`실적·전망 구분 불일치` 같은 내부 기간 진단 footer는 노출하지 않는다.
- source dialog는 desktop 2열, mobile 1열이다. icon, title, helper, checkbox를 사용하고 recommendation label은 생략한다.
- 기업 IR과 사용자 자료는 STEP 04 하단의 `사용자 제공 원문` 영역에서 공통 등록한다. 두 자료 유형 모두 PDF 업로드 또는 공개 원문 URL 등록을 지원한다.
- shared source surface는 quiet neutral, white source chip과 lime action을 사용한다.
- STEP 04 이후 workflow sidebar는 이전 단계와 동일한 near-black 배경, muted text, lime active marker를 사용한다.

## 7. 조사 결과 검증

- 상단 tab은 `가설 질문의 근거 자료`, `Excel 입력값 및 근거 자료 확인`을 사용한다.
- command bar는 반복 step context, 전체 result count와 collected-material overview trigger를 생략한다.
- desktop은 evidence list와 원문 viewer를 keyboard·pointer로 resize한다. mobile은 stack한다.
- splitter는 neutral hairline과 24×48px white pill handle을 사용한다.
- active question header는 `#edf8d1`, text는 `#75a900`; inactive header는 dark surface와 white text를 사용한다.
- confirmed-question과 evidence card는 12px radius를 사용한다. desktop vertical spacing은 compact하게 유지하되 mobile touch density는 줄이지 않는다.
- evidence row는 status, title, value와 provenance를 왼쪽 정렬하고 row 전체를 selection affordance로 사용한다. 우측 chevron은 두지 않는다.
- 개별 evidence 선택 때만 그 질문의 source panel을 연다. panel은 해당 group의 마지막 evidence 뒤, 다음 question 앞에 둔다.
- source panel 이동으로 question·evidence card의 spacing과 size를 바꾸지 않는다.
- source surface는 `#f4f5f2`, evidence card는 white, confirmed question은 pale lime hierarchy를 사용한다.
- 완료 chip은 `#f5f7f3`와 `#697066`을 사용한다.
- conflict는 `#ffebe9` surface와 `#b53731` text를 사용하고 green outline을 쓰지 않는다.
- all-results active filter는 `#e5f1ff`와 `#0f348a`를 사용한다.
- financial value는 raw `십억원`보다 comma와 `조 원`·`억 원` 표기를 사용한다.
- Excel validation은 read-only workbook chrome, file name, active sheet·range, formula bar, coordinates와 sheet tabs를 보여준다.
- STEP 05는 공통 Process footer를 사용하고 completion modal 없이 PER valuation으로 이동한다.
- 성공 icon의 흰색 check는 1px stroke를 유지하고 최종 위치는 최초 기준에서 위로 5px 보정한다.

## 8. PER 밸류에이션

- Excel 계산과 사용자 결정을 한 card 안의 tab으로 전환한다.
- Excel derived table은 read-only workbook preview로 표시하고 AI 추천과 분리한다.
- editable valuation 값은 bordered input, in-field unit와 명확한 focus state를 사용한다.
- Target PER 입력은 evidence table 뒤에 둔다.
- target price는 직접 입력 가능하며 PER과 동기화한다. font weight는 700을 사용한다.
- summary는 editable target price를 우선하고 설명을 낮추며 upside metric을 분리한다.
- sensitivity action은 card full width를 사용한다.
- selected sensitivity cell은 `#557909` text·border와 `#f4f9ea` surface를 사용한다.
- 중복 approval badge, recalculation helper, header action과 peer-comparison 문구를 생략한다.

## 9. 페이지 내용 설정

- page 수·순서·slot은 Template IR을 따른다. 과거 4-page prototype preference는 구현 기준이 아니다.
- page 추가·삭제·재정렬 control을 제공하지 않는다.
- page는 compact accordion으로 열고 닫는다. selected header는 white, editor panel은 quiet soft surface를 사용한다.
- reset은 screen header에 둔다.
- page label은 section number와 subject 사이 underscore, editable value 앞 colon을 사용한다.
- title·decision 아래 key-point input은 6px margin을 둔다.
- target-price decision key-point는 40px height, 다른 one-line key-point는 compact height를 사용한다.
- report title, company review와 outlook은 별도 title input을 두지 않고 one-line key-point를 유지한다.
- planned table·chart는 read-only preview다. page-local numbered label을 사용하고 title input으로 보이지 않게 한다.
- visual slot의 field control은 해당 page slot 안에 둔다.
- evidence row는 선택 control이 아니라 source inspection action이다.
- overall evidence row는 accessible label이 있는 Lucide source icon 하나를 사용한다.

## 10. 보고서 편집

- Template IR의 실제 모든 page를 source PDF layout 그대로 표시한다. 5-page 표본을 전역 고정값으로 쓰지 않는다.
- view와 edit는 같은 document layout을 사용하고 mode는 text·table editability만 바꾼다.
- page 위에 별도 editing-context header card를 두지 않는다.
- page는 이어진 canvas가 아니라 분리된 A4 sheet로 표시한다.
- report cover blue는 최종 교정값 `#ebf5ff`, summary bullet panel은 `#f5f5f5`를 사용한다.
- active editable area는 upper-right AI action으로 해당 area만 수정한다.
- table 선택은 prompt와 CSV·Excel·image attachment를 받는 table editor를 연다.
- target-price chart 선택은 같은 attachment와 네 가지 chart type을 제공하는 chart editor를 연다.
- target-price two-year trend chart는 title 바로 아래, history table 앞에 둔다.
- toolbar에는 중복 error-check button을 두지 않는다.
- analyst contact 표본은 fictional identity와 `example.com` email을 사용한다.

## 11. 반응형·접근성

- wide screen의 carousel arrow, dialog action과 split workspace 위치를 유지한다.
- mobile은 panel을 stack하고 navigation을 preview 아래로 이동한다.
- mobile에서 control text와 touch target을 축소하지 않는다.
- drag control은 keyboard resize를 지원한다.
- selected, included, conflict와 complete 상태는 색상 외 text·shape로도 구분한다.
- reduced motion, focus visibility, dialog focus trap과 호출 control 복귀를 유지한다.

## 12. 해소된 충돌

| 대상 | 폐기된 값 | 현재 값 |
|---|---|---|
| selected tab | underline-only, tinted connected surface | white connected surface + restrained lime edge |
| research-plan 가설 tab | 여러 생성 질문·근거자료 문구 | `가설 확인을 위한 자료 수집` |
| report outline page count | 4-page default | Template IR 실제 page count |
| report cover | `#ebf4ff`, `#dcebf9` | `#ebf5ff` |
| validation active header | dark active header | pale lime active, dark inactive |
| question source panel | question header 직후 | 마지막 evidence 뒤 |
| Excel splitter | 48×84px handle | 24×48px handle |
| checkbox check position | geometric center | 3px optical upward correction |

## 13. 변경 절차

새 사용자 교정은 `.omd/preferences.md`에 `pending`으로 기록한다. 구현 전 다음 순서로 처리한다.

1. 기존 canonical rule과 충돌 확인
2. 최신 사용자 의도 확정
3. 이 문서 또는 `DESIGN.md` 수정
4. preference를 `applied` 또는 `superseded`로 닫기
5. 관련 visual regression과 interaction test 갱신
