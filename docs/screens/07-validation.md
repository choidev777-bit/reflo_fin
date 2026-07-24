# REFLO 화면 구현 명세: `/projects/:projectId/process/validation` 조사 결과 검증

**문서 상태:** 조사 결과 검증 화면 명세 작성 완료
**작성일:** 2026-07-24
**대상:** 현업 배포용 MVP
**상위 문서:** [`REFLO_SCREEN_IMPLEMENTATION_SPEC_v1.md`](../REFLO_SCREEN_IMPLEMENTATION_SPEC_v1.md)
**기준 문서:** [`REFLO_URL_SERVICE_BEHAVIOR_v1.md`](../REFLO_URL_SERVICE_BEHAVIOR_v1.md), [`REFLO_TECHNICAL_DECISIONS_v1.md`](../REFLO_TECHNICAL_DECISIONS_v1.md)

## 7. `/projects/:projectId/process/validation` — 조사 결과 검증

### 7.1 명세 상태

| 항목 | 값 |
|---|---|
| URL | `/projects/:projectId/process/validation` |
| 접근 권한 | Google 로그인 완료 + 프로젝트 소유자 |
| 주요 목적 | 수집 결과를 원문과 독립 대조하고, 검증된 값·주장만 후속 단계에 확정 |
| 선행 단계 | `/projects/:projectId/process/research-plan`의 계획 승인과 수집 실행 |
| 다음 단계 | `/projects/:projectId/process/valuation` |
| 현재 route 파일 | `source-react/app/projects/[projectId]/process/validation/page.tsx` |
| 현재 공통 route 구현 | `source-react/app/page.tsx`, `source-react/app/process.tsx` |
| 현재 스타일 | `source-react/app/globals.css`의 `rv-*` 계열 |
| 현재 주요 컴포넌트 | `Home`, `PlannedProcessPage`, `ResearchValidation`, `ScreenHead` |
| 기준 요구사항 | 서비스 동작 명세 2장, 3장, 4장, 5장, 11장, 12장, 16장, 17장, 19장 |
| 관련 기술 결정 | TD-003, TD-004, TD-005, TD-010, TD-011, TD-012, 필요 시 TD-013 |
| 구현 상태 | 고정 샘플 데이터와 가짜 뷰어만 존재, 실제 인증·API·검증·결정 저장·SpreadJS 미구현 |

### 7.2 화면 목적과 책임

이 화면은 자료를 새로 찾는 기본 조사 화면이 아니다. 앞 단계에서 수집한 후보를 독립 검증한 뒤 애널리스트가 원문, 값, 연결 위치와 예외를 확인하는 화면이다.

책임은 다음과 같다.

1. 가설 질문별 수집 결과와 한 줄 답변을 보여준다.
2. 검증을 통과한 주장·숫자와 정확한 원문 위치를 연결한다.
3. 숫자의 단위, 통화, 기간, 연결·별도, 실제·잠정·추정 구분을 확인한다.
4. 합계·증감률·Excel 계산값은 결정적 코드 검증 결과를 보여준다.
5. 출처 값이 충돌하면 양쪽 원문을 보여주고 사용자가 채택할 값을 확정하게 한다.
6. 반려 또는 재조사 요청을 새 결정·작업 버전으로 저장한다.
7. 검증된 실제값과 Excel 입력 위치의 연결을 읽기 전용으로 확인하게 한다.
8. 완료 조건을 서버에서 다시 검사한 뒤 검증 버전을 승인하고 PER 밸류에이션으로 이동한다.

다음 책임은 이 화면에 두지 않는다.

- 조사 질문 또는 기본 출처 계획 편집
- 미래 추정치 입력
- Target PER·목표주가 확정
- 보고서 문장 작성
- 검증에 실패한 Research Agent 후보를 검증된 사실처럼 노출
- 이전 분기 증권사 리포트를 새 사실의 최종 검증 출처로 사용
- 브라우저에서 Excel 수식·서식·워크북 구조 수정

### 7.3 접근 권한과 진입 조건

#### 인증·소유권

- 로그인하지 않은 사용자는 Google 로그인 후 동일한 validation URL로 복귀한다.
- 서버는 URL의 `projectId`와 검증된 세션의 Google 사용자 ID로 소유권을 확인한다.
- 다른 사용자 프로젝트는 존재 여부를 추측할 수 없도록 `404 PROJECT_NOT_FOUND` 공통 응답을 사용한다.
- 클라이언트가 보낸 사용자 ID, 소유자 ID, Evidence 소유권과 객체 저장소 key는 신뢰하지 않는다.

#### 단계 조건

| 프로젝트 상태 | 진입 결과 |
|---|---|
| 조사 계획 미승인 | 가장 이른 미완료 단계인 research-plan으로 이동 |
| 조사 계획 승인, 수집 대기·실행 중 | validation URL을 유지하고 진행 상태 표시 |
| 수집 일부 실패 | 성공 결과와 실패 원천을 분리 표시, 필수 결과 누락이면 다음 단계 차단 |
| 검증 작업 실행 중 | 완료된 검증 결과만 표시하고 나머지는 자리표시자·진행 상태로 표시 |
| 검증 검토 가능 | 기본 검증 작업 영역 표시 |
| 상위 데이터 변경으로 무효화 | 기존 결과를 읽기 전용으로 표시하고 `재검증 필요` 상태와 재실행 동작 제공 |
| 이미 validation 승인 완료 | 승인한 버전을 읽기 전용으로 표시, 후속 단계 이동 가능 |
| 이미 후속 단계 진행 중 | 열람은 허용하되 결과 변경 시 하위 결과 무효화 경고와 새 버전 생성 필요 |

수집과 검증은 화면을 벗어나도 Temporal workflow에서 계속된다. 직접 URL 진입은 작업을 중복 시작하지 않고 현재 projection을 조회한다.

### 7.4 이탈 조건과 단계 이동

#### 항상 허용하는 이탈

- `프로젝트로 돌아가기`는 `/projects`로 이동한다.
- 브라우저 뒤로 가기와 프로젝트 목록 이동은 서버 작업을 취소하지 않는다.
- 이미 서버에 반영된 결정은 자동 저장 상태로 유지한다.
- 제출하지 않은 반려·재조사·충돌 사유가 있으면 이탈 확인을 제공하거나 임시 저장 후 이동한다.

#### 이전 단계 이동

- 사이드바의 `자료 수집 및 계획`으로 이동할 수 있다.
- 승인된 질문·출처 계획을 수정하면 현재 `validationVersion`과 이를 사용하는 Excel·밸류에이션·보고서 결과를 `재검증 필요`로 전환한다.
- 단순 열람은 버전을 무효화하지 않는다.

#### 다음 단계 이동

공유 Process 하단 액션 바의 `다음`은 다음 조건을 모두 만족할 때만 활성화한다.

1. 선행 조사 계획 버전과 현재 검증 버전이 일치한다.
2. 모든 필수 질문에 검증된 근거가 있고 답변 충분성이 `sufficient` 또는 사용자 확인 가능한 `qualified`다.
3. 모든 필수 Excel 실제값이 검증된 Evidence와 입력 셀에 연결됐다.
4. 핵심 숫자 검증 실패가 없다.
5. 해결되지 않은 출처 충돌이 없다.
6. 반려된 필수 결과의 대체 자료가 확보됐다.
7. 재조사·재검증·Excel 반영 작업이 실행 중이거나 실패 상태가 아니다.
8. 현재 결과가 상위 단계 변경으로 stale 상태가 아니다.

클릭 시 서버가 같은 조건을 트랜잭션 안에서 다시 검사하고 현재 `validationVersion`을 사용자 승인 버전으로 고정한다. 성공하면 완료 팝업 없이 바로 다음 URL로 이동한다.

```text
/projects/{projectId}/process/valuation
```

서버 검사에서 상태가 바뀌었으면 이동하지 않고 차단 항목으로 포커스를 이동한다. 현재 프로토타입처럼 조건 없이 내부 숫자 step을 `5 → 9`로 바꾸면 안 된다.

### 7.5 현재 화면 확인 결과

현재 React 화면에서 확인한 동작은 다음과 같다.

| 현재 구현 | 확인 결과 |
|---|---|
| route 파일 | validation route가 `app/page.tsx`를 다시 내보낸다. 독립 서버 route·데이터 로더가 아니다. |
| URL 해석 | `app/page.tsx`가 pathname을 읽어 `validation → step 5`로 매핑한다. |
| 화면 데이터 | LG이노텍·참조 보고서·DART·Excel 행이 모듈 상수로 고정돼 있다. |
| 가설 탭 | 질문 그룹, `전체·출처 충돌·확인 완료` 필터, 결과 선택, 원문 패널을 제공한다. |
| 원문 패널 | 페이지·확대 UI와 하이라이트 모양은 있으나 실제 PDF viewer가 아니다. 일부 컨트롤은 동작하지 않는다. |
| 출처 drawer | 질문별 출처 수와 외부 링크를 보여주고 drag·keyboard resize를 지원한다. |
| Excel 탭 | DART 목록과 Excel처럼 보이는 수제 table을 나란히 표시한다. SpreadJS와 실제 workbook은 연결되지 않았다. |
| 분할 작업 영역 | 가설·Excel 모두 pointer와 방향키로 너비를 조절하고 좁은 화면에서 쌓는다. |
| 상태 | `complete`, `conflict` 두 상태만 있으며 실제 충돌 선택·반려·재조사·승인 저장이 없다. |
| 저장 | `자동 저장됨`은 고정 문구이고 `임시 저장`은 toast만 표시한다. |
| 다음 | 데이터 상태와 무관하게 PER 화면으로 이동한다. 완료 팝업은 없다는 점만 목표 동작과 일치한다. |
| 권위 출처 | 가설 결과 일부가 `참조 보고서 PDF`를 원문으로 사용해 기준 문서의 출처 정책과 충돌한다. |
| Excel pane 순서 | 원문 왼쪽·Excel 오른쪽으로, 기준 문서의 Excel 왼쪽·원문 오른쪽 계약과 반대다. |
| 테스트 | route 직접 진입, 탭·drawer·separator 정적 존재만 검사하며 실제 검증·권한·결정 흐름은 검사하지 않는다. |

### 7.6 디자인 기준 충돌과 적용 순서

`DESIGN.md`와 `.omd/preferences.md`의 validation 기록에는 반복 수정 과정에서 서로 다른 지시가 남아 있다. 같은 범위가 충돌하면 더 최신인 명시적 사용자 보정을 적용한다.

| 충돌 범위 | 이전 기록 | 적용할 최신 기준 |
|---|---|---|
| 질문별 출처 패널 위치 | 질문 header 바로 아래 | 해당 질문의 마지막 evidence card 뒤, 다음 질문 전 |
| 질문 header 색 | 어두운 ink·olive, active만 별도 처리 | 확인 질문 card 전체를 `#edf8d1`, 글자를 `#375000`, 세로 accent를 `#92ac48`로 사용 |
| 선택 Evidence 배경 | lime tint | Evidence card는 선택 여부와 관계없이 흰색, 선택은 미세한 하단 edge·focus로 표현 |
| 완료 status chip | green 계열 | `#f5f7f3` 배경과 `#697066` 글자 |
| conflict 표현 | 일반 중립 상태 | `#ffebe9` 배경과 `#b53731` 글자, green outline 금지 |
| 검증 목록 배경 | `#ededed` | 검증 목록·원문 scroll surface는 최종 workspace 보정인 `#f4f5f2` 사용 |
| source scroll surface | paper white | 후속 보정인 `#f4f5f2` 사용, 실제 문서 page 자체는 paper white 유지 |
| validation 탭 | underline·white active | active purpose tab은 dark surface, lime 원형 step badge, 흰 글자 |
| 성공 check glyph | 기본 check | 기존 원형 배경을 유지하고 1px 흰 선, 최종 기록 기준 총 5px 위로 optical offset |

서비스 동작 문서와 디자인 보정이 충돌하면 서비스 동작을 우선한다. 따라서 Excel 탭은 현재 화면의 좌우 배치를 그대로 두지 않고, 기준 문서에 맞춰 실제 Excel을 왼쪽에, 선택 셀의 원문을 오른쪽에 둔다. 각 pane의 시각 구성과 resize interaction은 재사용한다.

### 7.7 기존 디자인 재사용·수정·제거 판정

| 현재 영역 | 판정 | 목표 구현 |
|---|---|---|
| Process 상단 header·좌측 workflow sidebar | 재사용 | 실제 프로젝트·단계 projection과 접근 조건 연결 |
| `STEP 05`, 제목, 짧은 설명 | 재사용 | 설명은 research-plan 번호가 아니라 수집 결과·원문 대조 역할을 유지 |
| HYPOTHESIS·EXCEL purpose tabs | 재사용 | 실제 category 상태·URL 내 선택 상태와 연결 |
| 원형 `01`, `02` badge | 재사용 | 모든 tab 상태에서 원형 유지 |
| desktop tab과 divider 정렬 | 재사용 | 가설 tab은 왼쪽 pane+divider까지, Excel tab은 오른쪽 pane 시작점과 정렬 |
| 가설 질문·Evidence stacked card 흐름 | 재사용 | 실제 질문·답변·stance·검증 상태 데이터로 교체 |
| 완료·충돌 필터 | 재사용·확장 | `재조사 중`, `반려`, `재검증 필요`를 필요 시 추가 |
| 결과 row 전체 선택 | 재사용 | 별도 우측 chevron 없이 전체 row가 선택 affordance |
| 질문별 출처 button·drawer | 재사용 | 원문 version과 실제 URL·locator 연결 |
| drawer·작업 영역 resize | 재사용 | pointer, keyboard, double-click reset, mobile full-width 유지 |
| 내부 PDF viewer 모양 | 구조 재사용 | 실제 source version·page·좌표 highlight viewer로 교체 |
| `signed-url://` demo와 `동작 확인` popup | 제거 | 실제 내부 viewer 또는 공식 외부 URL 이동 |
| 페이지·확대 button | 수정 | 실제 viewer 동작 연결, 미구현이면 숨김 |
| fake Excel table | 교체 | TD-010 SpreadJS React 읽기 전용 workbook |
| DART 왼쪽·Excel 오른쪽 순서 | 수정 | Excel 왼쪽·선택 셀 원문 오른쪽 |
| `Excel 연결 미리보기` 고정 상태 | 수정 | 실제 workbook version·읽기 전용·반영 상태 표시 |
| `참조 보고서 PDF` Evidence | 제거 | 디자인·문체 참고로만 보존하고 검증 결과 목록에서는 제외 |
| 고정 하드코딩 기업·기간·값 | 제거 | 프로젝트·Evidence·workbook API 응답 사용 |
| 고정 `자동 저장됨` | 수정 | 서버 동기화 성공 여부를 실제 표시 |
| toast만 있는 `임시 저장` | 수정 | 미제출 결정 사유 draft를 실제 저장하거나 draft가 없을 때 비활성 |
| 공유 하단 action bar | 재사용 | `다음`의 서버 gate 연결, 완료 modal은 추가하지 않음 |

### 7.8 목표 화면 구성과 기본 검증 흐름

#### 공통 구성

```text
Process header·sidebar
  → 화면 제목
  → HYPOTHESIS / EXCEL purpose tabs
  → category별 분할 workbench
  → 선택 결과의 원문·검증 판정·예외 action
  → 공유 Process 하단 action bar
```

#### 가설 결과 검증

```text
승인한 조사 질문
  → Research Agent 후보 수집
  → 후보 정형 저장
  → Validation Agent가 원문 독립 확인
  → 숫자·합계·증감률은 코드 재계산
  → 통과 결과만 질문별 목록에 노출
  → 사용자가 원문·판정 확인
  → 정상 결과 유지 / 반려 / 재조사 요청
  → 충돌이면 원문 후보 비교 후 채택값 확정
  → 질문 답변 충분성 재계산
```

#### Excel 실제값 검증

```text
검증된 실제값
  → TD-005 MappingSet의 목표 cell 확인
  → Aspose.Cells 작업 사본에 실제값 반영
  → 수식 재계산·참조 무결성 검사
  → SpreadJS 읽기 전용 workbook에 server delta 반영
  → cell 선택
  → 오른쪽 원문의 표·문장 좌표 highlight
  → 값·기간·단위·연결/별도·source 비교
```

검증 화면의 Excel은 미래 추정치를 편집하는 화면이 아니다. 노란 배경·파란 글씨 직접 입력 셀 판정은 보존하지만 이 단계에서는 해당 셀도 읽기 전용이다. 사용자는 다음 PER 밸류에이션 단계에서 허용된 미래 추정 셀만 편집한다.

### 7.9 목표 컴포넌트 구성

| 컴포넌트 | 책임 | 주요 입력 | 주요 출력·이벤트 |
|---|---|---|---|
| `ValidationRoute` | 인증·소유권·단계 gate와 초기 데이터 로드 | `projectId`, session | workspace 또는 redirect·오류 |
| `ValidationPage` | 화면 layout, category, selection, server mutation 조정 | `workspace` | 탭·선택·결정·단계 이동 |
| `ProcessShell` | 공통 header·sidebar·하단 action bar | project projection | 프로젝트·단계 이동 |
| `ValidationPurposeTabs` | HYPOTHESIS·EXCEL 전환 | category summary | category change |
| `ValidationStatusFilters` | 상태별 결과 filtering | count, active filter | filter change |
| `HypothesisValidationPane` | 질문·답변·Evidence 목록 | question groups | result selection |
| `QuestionResultCard` | 질문, 한 줄 답변, 충분성, 결과 수 표시 | question answer | 첫 결과 선택·접기 상태 |
| `ValidationResultCard` | 값·주장, stance, 상태 표시 | result summary | selected result change |
| `QuestionSourcePanel` | 질문에 사용된 source type별 수 | source groups | source drawer open |
| `EvidenceSourceDrawer` | source version 목록과 공식 링크 | question ID, source type | 내부 viewer·외부 URL 열기 |
| `EvidenceViewerPane` | source metadata, 원문 위치, 판정 표시 | result detail, evidence | page·zoom·expand·decision |
| `PdfEvidenceViewer` | PDF source version 렌더·좌표 highlight | artifact, locator | page·zoom |
| `WebEvidenceLink` | 실제 뉴스·HTML URL 열기 | canonical URL, text fragment | 새 탭 이동 |
| `ResultDecisionActions` | 반려·재조사 요청과 사유 입력 | result status, version | decision mutation |
| `ConflictResolutionPanel` | 후보 원문·값 비교와 채택 | conflict group | conflict decision |
| `ExcelValidationPane` | 실제 workbook와 source 비교 | workbook manifest, mappings | cell selection |
| `ValidationWorkbook` | SpreadJS 읽기 전용 workbook | import session, cell metadata | selected cell |
| `ExcelSourceViewer` | 선택 cell의 DART·IR 원문 | mapping, Evidence | source switch·highlight |
| `ValidationProgress` | 수집·검증·Excel 반영 job projection | job summaries | 재시도·상태 갱신 |
| `ValidationStageActions` | 임시 저장, 완료 gate, 다음 이동 | dirty draft, gate | save·approve-and-next |

`PdfEvidenceViewer`와 `ValidationWorkbook`은 category를 선택했을 때 지연 로드한다. PydanticAI, PDF parser, Aspose.Cells와 Temporal client를 브라우저 component에 넣지 않는다.

### 7.10 가설 영역 표시 계약

#### 질문 card

각 승인 질문은 다음을 표시한다.

- 질문 순서와 질문 원문
- AI의 검증 결과 기반 한 줄 답변
- 근거 충분성: `충분`, `조건부`, `불충분`, `재조사 중`
- 지지·반박·중립 결과 수
- 해결되지 않은 충돌·반려·재검증 필요 수

한 줄 답변은 검증된 Evidence만 사용한다. 답변이 충분하지 않으면 결론을 만들지 않고 `검증된 근거가 부족합니다`라고 표시한다.

#### 결과 card

각 결과는 다음 순서로 표시한다.

1. Evidence 역할: `지지`, `반박`, `중립`
2. 검증 상태 또는 예외 상태
3. 주장 제목 또는 지표명
4. 정규화한 사용자 표시값
5. 필요한 경우 기간·단위·연결/별도·값 종류

Evidence card에는 source·문서 helper 문구를 반복하지 않는다. 상세 provenance는 오른쪽 viewer에 둔다.

`확인 완료`는 Validation Agent·코드 검증을 통과했다는 뜻이다. 사용자가 검증 버전 전체를 승인했다는 뜻과 구분한다.

#### 질문별 수집 source

- 선택한 결과가 속한 질문의 마지막 Evidence card 뒤에 source type button을 표시한다.
- 다음 질문 card의 크기·간격을 바꾸지 않는다.
- 총 source 수를 별도 반복하지 않고 source type button별 건수만 표시한다.
- 다른 결과를 선택하면 이전 source panel은 닫히고 새 질문 panel로 교체된다.

#### machine 검증 실패 노출

검증 실패 후보의 주장·값은 검증된 결과처럼 노출하지 않는다.

- 사용자에게는 `검증 실패`, 실패 범주, 영향을 받은 질문과 재조사 가능 여부만 표시한다.
- raw candidate와 Validation Agent 원시 응답은 제한된 내부 artifact로 보존한다.
- 원문 확인을 통과하지 않은 문장을 Evidence card의 값이나 한 줄 답변에 사용하지 않는다.

### 7.11 원문·출처 표시 계약

#### 출처 우선순위

1. DART 공시·재무제표
2. 기업 공식 IR·실적발표·컨퍼런스콜
3. KRX·ECOS
4. 정부기관·공식 산업협회
5. 실제 뉴스 원문
6. 사용자 업로드 자료

이전 분기 증권사 리포트는 디자인, 문체와 과거 판단 참고용이다. 새 사실의 최종 Evidence로 승인할 수 없다.

#### PDF 원문

- 저장한 불변 `sourceVersionId`의 PDF를 연다.
- locator의 `pageIndex`, page label, CropBox 좌표, rotation, bbox·region을 사용한다.
- 정확한 page로 이동하고 문장·표 셀을 highlight한다.
- 문서명, 발행기관, 발행일, 공식 URL, 원문 위치를 함께 표시한다.
- 최신 URL의 다른 PDF에 과거 좌표를 적용하지 않는다.

#### 뉴스·HTML

- 기사 복사본을 REFLO 내부 기사 화면처럼 재배포하지 않는다.
- 실제 `canonicalUrl`을 `target="_blank"`와 `rel="noopener noreferrer"`로 연다.
- 가능한 경우 저장한 Text Fragment를 붙인다.
- Text Fragment 실패 시에도 검증 인용문, prefix·suffix와 위치 metadata를 REFLO panel에 유지한다.
- 유료·뉴스 원문 보존 범위는 TD-012의 법무·운영 정책을 따른다.

#### 구조화 API

DART XBRL, KRX, ECOS, FnGuide처럼 구조화된 값은 endpoint, canonical parameter, response hash, JSON Pointer·XPath와 정규화 결과를 보여줄 수 있어야 한다. 일반 사용자 화면에는 hash와 수집기 버전을 기본 노출하지 않고 감사 상세에서 제공한다.

### 7.12 Excel 영역 표시·검증 계약

#### pane 순서

기준 문서에 따라 desktop과 tablet의 논리 순서는 다음과 같다.

| 왼쪽 pane | divider | 오른쪽 pane |
|---|---|---|
| 업로드한 실제 Excel의 선택 sheet·cell | drag·keyboard resize | 선택 cell의 DART·IR 등 원문 |

모바일에서는 Excel을 먼저, 원문을 그 뒤에 쌓는다. DOM 순서도 이 읽기 순서를 유지한다.

#### workbook

- 업로드한 원본과 같은 `originalWorkbookHash`에서 생성한 프로젝트 작업 사본을 사용한다.
- 보이는 sheet 이름·순서, row·column 크기, format, merge, freeze pane과 chart를 가능한 범위에서 유지한다.
- 숨김 sheet와 `_REFLO_BRIDGE`는 일반 tab에 노출하지 않는다.
- 현재 단계는 모든 cell을 읽기 전용으로 보호한다.
- formula bar는 선택 cell 주소, formula 또는 값과 number format을 읽기 전용으로 표시한다.
- 실제 sheet tab을 사용하고 좌우 방향키 이동을 지원한다.
- cell 색상은 의미 설명일 뿐 client 권한 판정에 사용하지 않는다.

#### 검증 대상 cell

- 공식 실제값으로 채우는 cell만 기본 목록에 포함한다.
- 미래 추정치, Target PER, formula output 자체는 자동 입력 대상에서 제외한다.
- formula output의 정확성은 입력값 반영 뒤 Aspose.Cells가 재계산해 검증한다.
- 한 cell에는 하나의 권위 Evidence만 연결한다.
- 다른 source 후보는 검증 또는 conflict 후보로 보존한다.
- 값, 기간, 단위, 통화, 연결·별도와 실제·잠정·추정 구분이 모두 맞아야 `연결 완료`다.

#### 원문 연결

cell을 선택하면 오른쪽 pane에 다음을 표시한다.

- cell 주소와 stable sheet ID
- workbook version
- 지표명, 입력값, 표시값, 기간, 단위
- 권위 Evidence와 검증 source 후보
- source 문서명·발행기관·발행일
- 원문 page·표·문장 위치
- 원본 값 → 정규화 값 → cell 입력값의 provenance

출처 충돌이 있으면 두 값을 나란히 비교한다. source를 선택하기 전에는 어느 값도 Excel 작업 사본에 최종 반영하지 않는다.

### 7.13 화면 데이터 계약

#### `ValidationWorkspace`

| 필드 | 설명 |
|---|---|
| `projectId` | 서버 발급 프로젝트 ID |
| `projectVersion` | 상위 데이터 변경 감지용 버전 |
| `researchPlanVersion` | 이 검증이 사용하는 승인 조사 계획 |
| `collectionRunId` | 수집 workflow 실행 ID |
| `validationRunId` | 독립 검증 실행 ID |
| `validationVersion` | 사용자 결정과 완료 gate의 낙관적 동시성 버전 |
| `cutoffAt` | 자료 사용 기준일 |
| `status` | 처리·검토·차단·승인 상태 |
| `categories` | hypothesis·excel summary |
| `jobs` | 수집·검증·Excel 반영 projection |
| `stageGate` | 다음 단계 가능 여부와 차단 항목 |

#### `ValidationResult`

| 필드 | 설명 |
|---|---|
| `resultId`, `resultVersion` | 불변 결과 버전 식별 |
| `category` | `hypothesis` 또는 `excel` |
| `questionId` | 가설 결과가 속한 승인 질문 |
| `mappingBindingId` | Excel 결과가 연결된 TD-005 binding |
| `title`, `oneLineValue` | 사용자 표시 제목·값 |
| `stance` | `supporting`, `contradicting`, `neutral` |
| `valueOriginal`, `valueNormalized` | 원문 값과 정규화 값 |
| `unit`, `currency`, `period`, `scope`, `valueKind` | 숫자 의미 계약 |
| `machineStatus` | 독립 검증 상태 |
| `exceptionStatus` | 반려·재조사·충돌·stale 상태 |
| `evidenceIds` | 결과를 뒷받침하는 Evidence version |
| `conflictGroupId` | 충돌 시 후보 묶음 |
| `validatedAt` | 검증 시각 |

#### `QuestionAnswer`

| 필드 | 설명 |
|---|---|
| `questionId`, `questionVersion` | 승인 질문 버전 |
| `answer` | 검증된 Evidence 기반 한 줄 답변 |
| `sufficiency` | `sufficient`, `qualified`, `insufficient`, `reinvestigating` |
| `supportingCount`, `contradictingCount`, `neutralCount` | stance별 결과 수 |
| `required` | 다음 단계 gate 대상 여부 |
| `blockers` | 충돌·누락·반려·stale 원인 |

#### `EvidenceSummary`

TD-012를 따르며 최소 다음을 사용한다.

- `evidenceId`, `evidenceVersion`, `sourceVersionId`, `locatorId`
- source type, 문서 ID, 발행기관, 공식 URL
- `quoteExact`, `quoteNormalized`, quote hash
- 원본·정규화 값, 단위, 통화, 기간, 연결·별도, 값 종류
- validation run, parser·model·prompt·코드 version
- `supports`, `contradicts`, `normalized_from`, `calculated_from` provenance

#### `ExcelValidationBinding`

| 필드 | 설명 |
|---|---|
| `bindingId`, `workbookVersion` | TD-005·TD-010 버전 |
| `sheetId`, `sheetName`, `address` | stable identity와 표시 주소 |
| `metric`, `period`, `unit`, `scope` | cell 의미 |
| `value`, `formattedText` | Aspose.Cells 권위 값 |
| `evidenceId` | 선택된 권위 Evidence |
| `writeStatus` | `pending`, `applied`, `calculated`, `failed`, `stale` |
| `calculationRunId` | Aspose.Cells 실행 |
| `affectedCellIds` | 재계산된 결과 cell |

### 7.14 상태 모델

#### 전체 화면 상태

| 상태 | 의미 | 사용자 동작 |
|---|---|---|
| `COLLECTING` | source 수집 중 | 완료 결과 열람, 이탈 가능 |
| `VALIDATING` | Validation Agent·코드 검사 중 | 완료 결과 열람, 이탈 가능 |
| `REVIEW_BLOCKED` | 필수 실패·누락·충돌 존재 | 원문 확인, 반려·재조사·충돌 해결 |
| `REVIEW_READY` | 모든 자동 검증과 Excel 연결 완료 | `다음`으로 버전 승인 |
| `APPROVING` | 서버가 완료 gate와 버전을 고정 중 | 중복 제출 차단 |
| `APPROVED` | 사용자 승인 버전 고정 | valuation 이동·읽기 전용 열람 |
| `REVALIDATION_REQUIRED` | 상위 버전 변경 | 재검증 실행 전 다음 단계 차단 |
| `FAILED` | workflow 자체 실패 | 원인·재시도·프로젝트 목록 이동 |

#### machine 검증 상태

| 상태 | 화면 노출 |
|---|---|
| `pending` | 최종 크기의 skeleton |
| `passed` | 주장·값과 원문 위치 노출 |
| `failed` | 미검증 주장·값은 숨기고 실패 요약만 노출 |
| `needs_review` | 개별 후보 검증은 통과했으나 충돌·모호성 해결 필요 |
| `stale` | 이전 결과를 읽기 전용으로 표시, 사용 금지 |

#### 사용자·예외 결정 상태

| 상태 | 생성 조건 | 후속 처리 |
|---|---|---|
| `AVAILABLE` | machine 검증 통과 | stage 승인 후보 |
| `REJECTED` | 사용자가 결과 반려 | downstream 사용 제외, 필수 결과면 차단 |
| `REINVESTIGATION_REQUESTED` | 재조사 요청 저장 | 새 ResearchWorkflow 예약 |
| `REINVESTIGATING` | 새 작업 실행 중 | 이전 결과 유지하되 사용 금지 |
| `CONFLICT_UNRESOLVED` | 동일 의미에 서로 다른 검증값 | 후보 비교·사용자 선택 필요 |
| `CONFLICT_RESOLVED` | 사용자가 Evidence 하나 채택 | 선택값을 권위 원천으로 연결 |
| `SUPERSEDED` | 새 결과·결정 version 생성 | 과거 감사 이력으로만 유지 |

`APPROVED`는 화면 전체의 validation version 승인 상태다. 개별 결과의 `확인 완료`와 혼동하지 않는다.

### 7.15 승인·반려·재조사·충돌 처리

#### 승인

- `다음` 클릭이 현재 validation version 전체 승인 행위다.
- 사용자는 정상 결과를 일일이 승인할 필요가 없다.
- 승인 전에 서버가 필수 질문·숫자·Excel 연결·충돌·job 상태를 재검사한다.
- 성공 시 승인 사용자, 시각, project·research plan·Evidence·workbook version을 고정한다.
- 승인 뒤 결과를 변경하면 기존 승인을 수정하지 않고 새 validation version을 만든다.

#### 반려

- 원문은 맞지만 프로젝트 문맥에 부적절하거나 결과를 사용하지 않으려는 경우에 사용한다.
- 반려 사유는 앞뒤 공백 제거 후 5~500자다.
- 반려는 Evidence를 삭제하거나 검증 결과를 `failed`로 바꾸지 않는다.
- 선택 결과를 downstream 사용 대상에서 제외하는 append-only decision을 저장한다.
- 필수 결과 반려로 질문 충분성이 낮아지면 다음 단계를 차단하고 재조사를 안내한다.
- 승인 전에는 새 decision으로 반려를 철회할 수 있다. 승인 뒤 변경은 새 검증 버전과 하위 결과 무효화를 요구한다.

#### 재조사

- 원문 부족, 기간·scope 불일치, 더 최신 공식 자료 필요 또는 반려 대체 자료가 필요한 경우에 사용한다.
- 요청 사유는 5~500자이며 현재 질문·지표·기간을 자동 포함한다.
- 기존 source 계획으로 재시도할 수 있으면 새 ResearchWorkflow를 시작한다.
- source 계획 변경이 필요하면 research-plan으로 이동하는 명시적 동작을 제공한다.
- 기존 결과·Evidence는 삭제하지 않고 새 run의 결과가 이를 supersede한다.
- 진행 중에는 `재조사 중` 상태, 최근 진전 시각과 취소 가능 여부를 표시한다.

#### 출처 충돌

- 동일 기업·지표·기간·단위·연결/별도·값 종류가 같은데 검증된 원문 값이 다를 때만 conflict를 만든다.
- 기준이 다른 값은 억지로 conflict로 묶지 않고 scope mismatch로 분류해 계획·매핑을 수정한다.
- 각 후보는 자체 원문 검증을 통과해야 비교 화면에 나온다.
- 시스템은 출처 우선순위와 권장 이유를 제시할 수 있지만 값을 미리 선택하거나 자동 확정하지 않는다.
- 사용자가 후보 Evidence 하나를 선택하고 5~500자의 선택 이유를 입력한다.
- 선택 Evidence ID, 제외 후보, 사용자, 시각, 이유와 당시 source version을 decision record로 저장한다.
- 해결 뒤 선택값은 `확인 완료`로 이동하고 Excel binding의 단일 권위 원천이 된다.
- 판단할 수 없으면 `재조사 요청`을 선택한다. `충돌 무시`는 제공하지 않는다.

### 7.16 버튼·탭·입력·viewer UI 계약

| ID | 요소·의미 HTML | 노출·활성 조건 | 동작 | 성공 결과 | 실패·접근성 |
|---|---|---|---|---|---|
| VAL-NAV-01 | `프로젝트로 돌아가기` button | 항상 | `/projects` 이동 | 작업은 계속 실행 | 미제출 draft가 있으면 확인 |
| VAL-NAV-02 | workflow sidebar button | 접근 가능한 단계 | 해당 process URL 이동 | 실제 URL 갱신 | 계획 수정 시 무효화 경고 |
| VAL-TAB-01 | HYPOTHESIS `button[role=tab]` | 항상 | 가설 category 선택 | 가설 panel 표시 | `aria-selected`, 좌우 방향키 |
| VAL-TAB-02 | EXCEL `button[role=tab]` | workbook 분석 완료 | Excel category 선택 | SpreadJS 지연 로드 | 준비 전 disabled+이유 |
| VAL-FILTER-01 | 상태 filter button | 가설 category | 결과 목록 filtering | count와 목록 갱신 | `aria-pressed`, 44px hit area |
| VAL-GROUP-01 | 질문 card header button | 질문 존재 | 질문·첫 결과 선택 | card와 viewer 동기화 | 질문 전체가 button임을 명확히 표시 |
| VAL-RESULT-01 | Evidence result row button | machine 통과 결과 | 결과 선택 | 오른쪽 원문·판정 표시 | `aria-current` 또는 `aria-pressed` |
| VAL-SOURCE-01 | source type button | 선택 질문 source 존재 | source drawer 열기 | 해당 유형만 표시 | `aria-haspopup=dialog` |
| VAL-DRAWER-01 | drawer close button | drawer 열림 | 닫기 | trigger로 focus 복귀 | Escape 지원, borderless+focus outline |
| VAL-DRAWER-02 | drawer separator | desktop | 너비 조절 | 360~860px | pointer, 방향키, Home·End, double-click reset |
| VAL-SOURCE-02 | source item anchor | 공식 URL 존재 | 내부 PDF viewer 또는 실제 외부 URL | 정확한 위치 이동 | 외부 URL은 새 탭·noopener |
| VAL-VIEW-01 | `원문에서 열기` button | locator 유효 | 내부 viewer 확대 또는 외부 원문 이동 | page·좌표 highlight | locator 실패 시 metadata와 재시도 |
| VAL-VIEW-02 | page 이전·다음 button | PDF 다중 page | page 이동 | page label 갱신 | 첫·끝 page disabled |
| VAL-VIEW-03 | zoom button | 내부 viewer | 단계별 확대·축소 | 배율 갱신 | 최소·최대에서 disabled |
| VAL-VIEW-04 | expand button | desktop·tablet | 원문 pane 확대·복원 | queue 숨김·복원 | 명확한 Lucide icon·`aria-expanded` |
| VAL-DECISION-01 | `이 결과 반려` button | passed 결과, conflict 아님 | 반려 사유 panel 열기 | draft 입력 표시 | destructive 색 과장 금지 |
| VAL-DECISION-02 | 반려 사유 `textarea` | 반려 panel 열림 | 5~500자 입력 | 제출 가능 | label·문자수·inline 오류 |
| VAL-DECISION-03 | `반려 확정` button | 사유 유효 | decision POST | 결과 `REJECTED` | stale version이면 최신 상태 재조회 |
| VAL-DECISION-04 | `반려 철회` button | 승인 전 `REJECTED` 결과 | 새 `RESTORE` decision 저장 | 결과 `AVAILABLE` | 기존 decision 삭제 금지 |
| VAL-DECISION-05 | `재조사 요청` button | 결과·실패·충돌 | 요청 panel 열기 | 사유 입력 표시 | 이미 실행 중이면 disabled |
| VAL-DECISION-06 | 재조사 사유 `textarea` | 요청 panel 열림 | 5~500자 입력 | 제출 가능 | 질문·지표 자동 context 표시 |
| VAL-DECISION-07 | `재조사 시작` button | 사유 유효 | decision+workflow 시작 | job 상태 표시 | 중복 request 한 번만 실행 |
| VAL-CONFLICT-01 | conflict 후보 radio | unresolved conflict | Evidence 후보 선택 | 비교 panel 선택 상태 | 실제 `input[type=radio]` 또는 동일 semantics |
| VAL-CONFLICT-02 | 선택 이유 `textarea` | 후보 선택 | 5~500자 입력 | 확정 가능 | 선택 이유 label 필수 |
| VAL-CONFLICT-03 | `선택값 확정` button | 후보·이유 유효 | conflict decision 저장 | resolved·Excel 반영 시작 | 자동 추천값 preselect 금지 |
| VAL-EXCEL-01 | sheet tab | Excel category | worksheet 전환 | 실제 sheet 활성화 | `role=tab`, 좌우 방향키 |
| VAL-EXCEL-02 | workbook cell | visible sheet | cell 선택만 허용 | source viewer 갱신 | 편집·formula 입력·paste 거부 |
| VAL-EXCEL-03 | split separator | desktop | Excel·원문 pane resize | 30~70% | pointer·keyboard·reset |
| VAL-SAVE-01 | `임시 저장` button | 미제출 사유 draft 존재 | draft 저장 | 실제 저장 시각 표시 | draft 없으면 disabled 또는 숨김 |
| VAL-NEXT-01 | 공유 footer `다음` button | `stageGate.canProceed` | 검증 버전 승인 | valuation URL 직접 이동 | 완료 modal 없음, gate 실패 focus |

모든 icon-only button에는 한국어 접근성 이름을 제공한다. hover만으로 필요한 정보를 제공하지 않는다.

### 7.17 클라이언트 상태

| 상태 | 타입 | 권위 | 설명 |
|---|---|---|---|
| `activeCategory` | `hypothesis \| excel` | client | 현재 tab |
| `activeFilter` | filter enum | client | 가설 결과 filter |
| `selectedQuestionId` | ID 또는 null | client | 선택 질문 |
| `selectedResultId` | ID 또는 null | client | 선택 결과 |
| `selectedCell` | sheet·address 또는 null | SpreadJS/client | Excel source 연결 |
| `expandedViewer` | boolean | client | 원문 pane 확대 |
| `splitRatio` | number | client preference | desktop pane 비율 |
| `sourceDrawer` | open·question·type·width | client | source drawer |
| `decisionDraft` | action·target·reason | client/server draft | 미제출 사유 |
| `mutationStatus` | idle·submitting·error | client | decision 중복 방지 |
| `workspace` | `ValidationWorkspace` | server | 검증 권위 상태 |
| `jobProjection` | job summary | server | background 진행 |
| `stageGate` | blocker list | server | 다음 활성 조건 |

Evidence, workbook 값, validation status와 stage 완료 여부를 전역 하드코딩 상수에 저장하지 않는다. filter, 선택 ID, pane 비율은 비즈니스 권위 상태가 아니다.

### 7.18 API 계약

아래 경로는 프론트엔드와 백엔드가 공유할 애플리케이션 계약이다. Temporal·PostgreSQL·객체 저장소와 worker 세부 구현은 API 뒤에 둔다.

#### `GET /api/projects/{projectId}/validation`

현재 검증 workspace와 category summary를 조회한다.

지원 query:

| query | 규칙 |
|---|---|
| `category` | `hypothesis` 또는 `excel`, 생략 시 두 summary |
| `status` | 화면 filter enum |
| `cursor` | 결과가 많을 때 opaque cursor |

응답에는 최소 다음이 포함된다.

```json
{
  "workspace": {
    "projectId": "prj_01...",
    "researchPlanVersion": 7,
    "validationVersion": 12,
    "status": "REVIEW_BLOCKED",
    "cutoffAt": "2026-07-17T23:59:59+09:00",
    "jobs": [],
    "stageGate": {
      "canProceed": false,
      "blockers": [
        {
          "code": "UNRESOLVED_SOURCE_CONFLICT",
          "targetId": "conf_01..."
        }
      ]
    }
  },
  "categories": [],
  "nextCursor": null
}
```

#### `GET /api/projects/{projectId}/validation/results/{resultId}`

선택 결과의 Evidence, source metadata, validation checks, conflict와 provenance를 조회한다.

- 요약 목록 응답에 전체 인용문·raw agent 응답을 중복 포함하지 않는다.
- 권한과 project 연결을 다시 확인한다.
- stale result를 조회하면 최신 result ID와 stale 사유를 함께 반환한다.

#### `GET /api/projects/{projectId}/evidence/{evidenceId}/viewer`

source type에 맞는 viewer descriptor를 반환한다.

| source | 반환 |
|---|---|
| 내부 PDF·업로드 | 짧은 만료 import URL, source version, page·bbox·rotation |
| 뉴스·HTML | canonical URL, Text Fragment, exact quote·prefix·suffix |
| 구조화 API | endpoint label, parameter summary, JSON Pointer, 원본·정규화 값 |
| Excel 계산 | workbook version, sheet·cell, dependency path |

presigned URL은 project 소유권 검사 후 발급하며 object key를 API 입력으로 받지 않는다.

#### `GET /api/projects/{projectId}/validation/workbook`

SpreadJS 읽기 전용 표시용 manifest를 반환한다.

- `originalWorkbookHash`
- `workbookVersion`
- 짧은 만료 import session
- visible sheet 목록
- validation target cell set
- read-only reason
- selected cell별 Evidence binding
- client 표시 호환성 경고

SpreadJS client export URL과 편집 가능한 `editableCellSet`은 이 화면에 반환하지 않는다.

#### `POST /api/projects/{projectId}/validation/results/{resultId}/decisions`

반려 또는 재조사 결정을 저장한다.

```http
POST /api/projects/prj_01.../validation/results/res_01.../decisions
Content-Type: application/json
Idempotency-Key: 8b6d...
```

```json
{
  "expectedValidationVersion": 12,
  "action": "REINVESTIGATE",
  "reason": "대상 분기와 일치하는 최신 기업 IR 원문을 다시 확인해야 합니다."
}
```

`action`은 `REJECT`, `RESTORE`, `REINVESTIGATE`만 허용한다. 재조사 성공 응답은 새 validation version과 `jobId`를 반환한다.

#### `POST /api/projects/{projectId}/validation/conflicts/{conflictId}/decision`

```json
{
  "expectedValidationVersion": 12,
  "selectedEvidenceId": "ev_02...",
  "reason": "확정 DART 공시의 연결 기준 값이며 프로젝트 Excel 기준과 일치합니다."
}
```

서버는 후보가 해당 conflict에 속하고 각각 검증을 통과했는지 다시 확인한다. 성공하면 새 decision ID, validation version, Excel 반영 job을 반환한다.

#### `POST /api/projects/{projectId}/validation/drafts`

미제출 반려·재조사·충돌 사유 draft를 저장한다. draft는 승인 Evidence나 decision이 아니며 다음 단계 gate에 영향을 주지 않는다.

#### `POST /api/projects/{projectId}/validation/complete`

검증 승인과 단계 완료를 중복 생성하지 않도록 `Idempotency-Key` header를 필수로 사용한다.

```json
{
  "expectedValidationVersion": 15
}
```

성공 응답:

```json
{
  "approvalId": "val_appr_01...",
  "validationVersion": 15,
  "approvedAt": "2026-07-24T08:00:00Z",
  "nextRoute": "/projects/prj_01.../process/valuation"
}
```

서버는 완료 gate를 원자적으로 재검사한다. 프론트엔드가 보낸 `canProceed`를 신뢰하지 않는다.

#### 작업 상태 갱신

TD-011 PostgreSQL projection을 조회하는 기본 계약은 workspace GET에 포함한다. 초기 구현은 처리 중일 때 backoff polling을 사용할 수 있다. SSE 등 실시간 전송을 도입해도 같은 job ID·상태·진행률 계약을 유지하며 transport 선택은 별도 기술 결정으로 남긴다.

#### 공통 오류

| HTTP | code | 화면 처리 |
|---|---|---|
| `400` | `INVALID_DECISION_REASON` | 해당 textarea 아래 오류 |
| `401` | `AUTH_REQUIRED` | draft 보존 후 로그인, 동일 URL 복귀 |
| `404` | `PROJECT_NOT_FOUND` | 프로젝트 없음과 타인 소유를 구분하지 않는 공통 화면 |
| `409` | `STALE_VALIDATION_VERSION` | 최신 workspace 재조회, 사용자의 미제출 text 유지 |
| `409` | `CONFLICT_ALREADY_RESOLVED` | 최신 decision 표시 |
| `409` | `STAGE_GATE_BLOCKED` | blocker 목록 표시·첫 항목 focus |
| `422` | `INVALID_RESULT_TRANSITION` | 현재 상태에 가능한 action 안내 |
| `423` | `WORKBOOK_UPDATE_IN_PROGRESS` | job 완료 후 재시도 |
| `429` | `RATE_LIMITED` | retry 시각 표시 |
| `500` | `VALIDATION_DECISION_FAILED` | 입력 유지·재시도 |
| `503` | `VALIDATION_WORKER_UNAVAILABLE` | 기존 결과 유지·재시도 또는 목록 이동 |

### 7.19 저장 모델과 권한 규칙

#### append-only 저장

- `source_version`, `evidence`, `validation_run`, `validation_decision`, `conflict_decision`은 이전 승인 이력을 바꾸지 않는다.
- 정정·재조사·재검증은 새 version과 `supersedes` 관계로 저장한다.
- 원문 byte와 page image는 S3 호환 객체 저장소, metadata·locator·결정·provenance는 PostgreSQL에 저장한다.
- 승인 버전은 사용한 research plan, source, Evidence, workbook, calculation run을 고정한다.

#### 최소 결정 record

| 필드 | 규칙 |
|---|---|
| `decision_id` | 서버 생성 불변 ID |
| `project_id` | 서버가 소유권 확인 |
| `validation_version` | 결정 전 예상 version과 성공 후 새 version |
| `target_type`, `target_id` | result 또는 conflict |
| `action` | reject, restore, reinvestigate, select-source |
| `selected_evidence_id` | conflict 선택 시 필수 |
| `reason` | 5~500자 |
| `created_by` | 검증된 세션 사용자 |
| `created_at` | 서버 시각 |
| `supersedes_decision_id` | 결정 변경 시 연결 |

#### 권한

- MVP는 공동 프로젝트와 역할별 승인을 지원하지 않는다.
- 프로젝트 소유자만 결과 결정, 재조사, conflict 선택과 stage 승인을 할 수 있다.
- Validation Agent와 system actor는 machine validation record를 만들 수 있지만 사용자 결정을 대신 만들지 않는다.
- source URL·artifact·workbook download는 매 요청마다 project 소유권을 확인한다.

### 7.20 검증 규칙과 다음 단계 차단

#### 일반 문장

- exact quote가 저장 source version에 존재한다.
- 기업과 기간이 프로젝트와 일치한다.
- 문장 앞뒤 문맥이 주장을 지지·반박·중립 중 어느 역할로 사용하는지와 모순되지 않는다.
- 기준일 이후 자료가 아니다.

#### 재무·운영 숫자

- 일반 문장 규칙을 모두 통과한다.
- 원본 값과 정규화 값을 별도로 보존한다.
- 단위, 통화, 기간, 연결·별도와 실제·잠정·추정 구분이 명시된다.
- 합계·증감률·비율은 Decimal 기반 코드로 재계산한다.
- Excel cell의 metric·기간·scope와 일치한다.
- Aspose.Cells 반영·재계산·formula error·순환참조 검사를 통과한다.

#### 질문 충분성

- 필수 질문마다 최소 한 개 이상의 검증 결과가 있어야 한다.
- 조사 계획이 요구한 핵심 지표가 모두 포함돼야 한다.
- 반증 질문의 결과를 숨기거나 지지 결과만으로 충분 판정하지 않는다.
- 필수 Evidence 반려 또는 stale 상태면 충분성을 다시 계산한다.

#### 차단 항목

- 핵심 숫자 검증 실패
- 필수 질문의 검증된 근거 없음
- 해결되지 않은 source conflict
- Excel 실제값 cell의 원문 연결 실패
- workbook write·재계산 실패
- 재조사·재검증 작업 실행 중
- research plan·workbook·source version 변경으로 stale

### 7.21 로딩·빈 상태·오류·예외 처리

| 상황 | 화면 | 복구 |
|---|---|---|
| 초기 workspace 로딩 | 최종 tab·card·viewer 크기의 skeleton | 완료 후 layout shift 최소화 |
| 수집 중 | source별 진행률·최근 진전·완료 결과 | 화면 이탈 가능 |
| 검증 중 | 완료 결과만 활성, 나머지는 처리 중 | 자동 갱신 |
| 가설 결과 없음 | 질문별 누락 원인과 재조사 | 필수면 다음 차단 |
| Excel target 없음 | 매핑 또는 workbook 분석 오류 | files·research-plan 수정 |
| filter 결과 없음 | `해당 상태 결과가 없습니다` | 전체 filter 복귀 |
| Evidence detail 실패 | 목록·선택 유지, viewer에 재시도 | result detail 재조회 |
| PDF render 실패 | metadata·공식 URL 유지 | viewer 재시도·새 탭 |
| Text Fragment 실패 | 실제 URL은 열고 위치 metadata 유지 | 수동 검색 안내 |
| source URL 변경·삭제 | 저장 source version과 stale 표시 | 재수집·재검증 |
| conflict 후보 일부 로딩 실패 | 자동 선택 금지 | 모두 로드 후 결정 |
| decision 저장 실패 | textarea·선택 유지 | 같은 idempotency key 재시도 |
| stale version | 최신 상태 재조회 | draft text 병합 없이 사용자 확인 |
| Excel import 불일치 | 영향 sheet·cell 경고 | 권위값은 Aspose 유지, 진행 차단 여부 표시 |
| worker 실패 | 원인 code와 재시도 가능 여부 | non-retryable은 계획·파일 수정 |
| 네트워크 끊김 | 기존 데이터 읽기 가능, offline 표시 | 복구 후 projection 재조회 |

현재 결과가 한 건도 없을 때 하드코딩 샘플을 대신 보여주지 않는다.

### 7.22 반응형·접근성 계약

#### desktop

- tablet·desktop 상단 여백은 48px, mobile은 28px를 기준으로 한다.
- purpose tab은 resize pane 경계와 정렬한다.
- 가설·Excel workbench는 각각 resizable split을 사용한다.
- 오른쪽 Evidence pane은 command bar와 맞닿는 위 모서리를 square로 유지한다.
- 목록·source viewer는 독립 scroll을 사용하되 keyboard focus가 갇히지 않는다.

#### tablet·mobile

- `900px` 이하에서는 pane을 한 열로 쌓고 divider를 숨긴다.
- 가설은 질문·Evidence 목록 다음에 원문 viewer를 둔다.
- Excel은 실제 workbook 다음에 source viewer를 둔다.
- source drawer는 mobile에서 전체 폭이다.
- 탭은 같은 순서와 최소 44px hit area를 유지한다.
- card text를 줄여 맞추지 않고 줄바꿈과 세로 확장을 허용한다.

#### 접근성

- tablist는 `aria-selected`, roving `tabIndex`, 좌우 방향키를 지원한다.
- filter는 `aria-pressed` 또는 radio group 중 한 semantics로 통일한다.
- splitter는 `role=separator`, 현재 비율, 최소·최대와 keyboard 조작을 제공한다.
- drawer·decision dialog는 열릴 때 focus 이동, focus trap, Escape, 닫은 뒤 trigger focus 복귀를 제공한다.
- result 선택과 검증 상태는 색뿐 아니라 text·icon으로 구분한다.
- conflict·반려·재조사 상태는 live region으로 과도하게 반복 알리지 않고 mutation 결과만 알린다.
- 성공 check의 optical offset이 glyph clipping이나 screen reader text에 영향을 주면 안 된다.
- `prefers-reduced-motion: reduce`에서는 drawer·tab transition을 제거한다.

### 7.23 현재 프로토타입과 목표 구현의 차이

| 현재 프로토타입 | 목표 구현 | 우선순위 |
|---|---|---|
| validation route가 전체 `app/page.tsx` 재수출 | 서버 인증·소유권 loader가 있는 독립 route | 필수 |
| 모든 상태가 client module 상수 | PostgreSQL projection·API 응답 | 필수 |
| LG이노텍 고정 값·문서·cell | 실제 project·source·workbook version | 필수 |
| 참조 증권사 리포트를 검증 원문으로 사용 | DART·IR 등 권위 source로 교체 | 필수 |
| Validation Agent·코드 검사 없음 | 독립 검증·숫자 재계산 | 필수 |
| complete·conflict 표시만 존재 | 반려·재조사·충돌 결정 state machine | 필수 |
| 충돌을 보여주기만 함 | 후보 원문 비교·사용자 채택·이유 저장 | 필수 |
| source URL이 일반 homepage | 실제 문서 canonical URL·source version locator | 필수 |
| 가짜 PDF page | 실제 source PDF viewer와 좌표 highlight | 필수 |
| 동작 없는 viewer button | 실제 동작 연결 또는 제거 | 필수 |
| 원문 왼쪽·Excel 오른쪽 | Excel 왼쪽·원문 오른쪽 | 필수 |
| HTML/CSS fake spreadsheet | SpreadJS 실제 workbook 읽기 전용 표시 | 필수 |
| Excel 값이 server calculation과 무관 | Aspose.Cells 반영·재계산 결과 | 필수 |
| static `자동 저장됨` | mutation 동기화 상태 | 필수 |
| `임시 저장` toast만 표시 | decision draft 실제 저장 | 필수 |
| `다음`이 무조건 step 9로 이동 | server stage gate·승인 후 valuation route | 필수 |
| Report tab 언제나 이동 | report 존재·접근 상태에 따른 활성화 | 필수 |
| route 존재·정적 selector만 테스트 | 권한·검증·결정·Excel·단계 gate 통합 테스트 | 필수 |

### 7.24 필요한 추가 요소와 제외 요소

#### 추가한다

- 질문별 검증 한 줄 답변과 충분성
- 지지·반박·중립 역할
- machine 검증과 사용자 승인 의미 구분
- 반려 사유 입력·철회
- 재조사 요청·진행 상태
- source conflict 비교·채택 이유
- stale·재검증 필요 상태
- 실제 source version·locator·provenance
- Excel 반영·재계산 job 상태
- 다음 단계 blocker 목록과 첫 blocker 이동

#### 기존 요소에 실제 기능을 연결한다

- 탭, filter, result selection
- page·zoom·expand viewer control
- source drawer와 실제 원문 링크
- pointer·keyboard resize
- sheet tab·formula bar·cell selection
- 자동 저장·임시 저장
- sidebar·Process/Report navigation

#### 제거하거나 추가하지 않는다

- validation 완료 modal
- 검증되지 않은 AI 주장·값
- 이전 증권사 리포트를 새 사실의 권위 Evidence로 승인하는 동작
- conflict 자동 선택
- future estimate 편집
- Excel formula·format·sheet 구조 편집
- client Excel export
- source 전체 count와 card별 중복 helper copy
- 동작 없는 page·zoom·도움말 button
- 화면 내부에서 조사 계획 전체를 다시 편집하는 복잡한 form

### 7.25 기술 배치

| 기술·영역 | 배치 | 판단 |
|---|---|---|
| Next.js App Router | validation route의 인증·소유권·초기 loader | 사용 |
| React Client Component | 탭·선택·viewer·drawer·decision form | 사용 |
| PostgreSQL | workspace projection, Evidence metadata, decision, approval | 사용 |
| S3 호환 객체 저장소 | source PDF·HTML snapshot·workbook·파생 viewer artifact | 사용 |
| Temporal | 수집·검증·재조사·Excel 반영 workflow | 사용 |
| PydanticAI Research Agent | 승인 계획 기반 후보 수집 | backend worker만 |
| PydanticAI Validation Agent | Research 추론 없이 원문 독립 확인 | backend worker만 |
| 결정적 validation code | 숫자·단위·합계·증감률·source identity | backend worker |
| SpreadJS React | 실제 workbook 읽기 전용 UI | Excel tab에서 dynamic import |
| Aspose.Cells for .NET | 실제값 기록·수식 재계산·작업 사본 저장 | .NET worker |
| PDF viewer | source version page·bbox highlight | browser viewer + artifact API |
| TD-001·007·008 보고서 PDF 처리 | 없음 | 이 화면의 Evidence viewer와 혼동해 로드하지 않음 |
| FnGuide provider | 컨센서스 Evidence가 있을 때 backend collection | browser 직접 호출 금지 |

목표 파일 배치는 다음 책임 경계를 권장한다.

- route·server loader: `app/projects/[projectId]/process/validation/page.tsx`
- 화면 component: `features/validation/components/`
- client query·mutation: `features/validation/api/`
- 공유 Evidence viewer: `features/evidence/`
- SpreadJS adapter: `features/workbook/ValidationWorkbook.tsx`
- 상태·API type: `features/validation/contracts.ts`

현재 대형 `app/process.tsx`와 `app/globals.css`에서 디자인을 바꾸지 않고 validation component·style을 먼저 분리한 뒤 실제 API를 연결한다.

### 7.26 구현 순서

1. validation·Evidence·decision·conflict·approval의 API schema와 PostgreSQL model을 확정한다.
2. Research·Validation·숫자 검사 결과를 TD-012 Evidence version으로 저장한다.
3. TD-011 Temporal projection과 재조사·재검증 workflow를 연결한다.
4. 독립 validation route의 인증·소유권·진입 gate를 구현한다.
5. 기존 `ResearchValidation`을 단계 전용 component로 분리하고 hardcoded data를 API 응답으로 교체한다.
6. 질문 답변·stance·충분성·예외 state를 기존 stacked card 디자인에 연결한다.
7. 실제 PDF·뉴스·구조화 API locator viewer를 연결한다.
8. 반려·재조사·conflict decision mutation과 동시성·idempotency를 구현한다.
9. TD-004·005 기반 실제값 반영과 Excel mapping 상태를 연결한다.
10. fake Excel table을 SpreadJS 읽기 전용 workbook으로 교체하고 pane 순서를 수정한다.
11. 공유 하단 action bar에 draft 저장·server gate·직접 valuation 이동을 연결한다.
12. 접근성, responsive, worker 실패, 보안과 회귀 테스트를 통과한다.

### 7.27 완료 조건

- [ ] 비로그인 사용자는 로그인 후 동일 validation URL로 복귀한다.
- [ ] 프로젝트 소유자 외 사용자는 workspace·Evidence·파일·결정을 조회하거나 수정할 수 없다.
- [ ] research-plan 미승인 프로젝트는 가장 이른 미완료 단계로 이동한다.
- [ ] 수집·검증 작업은 화면 이탈 후에도 계속되고 재진입 시 같은 run 상태를 보여준다.
- [ ] Validation Agent는 Research Agent 추론 없이 원문·locator·프로젝트 기준만 받는다.
- [ ] 숫자·합계·증감률·Excel 계산값은 코드·Aspose.Cells 검증을 통과한다.
- [ ] machine 검증 실패 후보는 검증된 값·주장으로 노출되지 않는다.
- [ ] 이전 분기 증권사 리포트가 새 사실의 최종 Evidence로 사용되지 않는다.
- [ ] 질문별 한 줄 답변, 충분성, 지지·반박·중립 결과가 검증 Evidence와 일치한다.
- [ ] PDF Evidence는 저장 source version의 정확한 page·좌표를 highlight한다.
- [ ] 뉴스는 실제 원문 URL을 새 탭으로 열고 Text Fragment 실패 시 fallback 정보를 유지한다.
- [ ] conflict는 양쪽 검증 원문을 표시하고 사용자 선택 전 자동 확정되지 않는다.
- [ ] conflict 선택은 Evidence ID·사용자·시각·이유와 함께 append-only로 저장된다.
- [ ] 반려는 Evidence를 삭제하지 않고 downstream 사용만 제외한다.
- [ ] 재조사는 기존 결과를 보존한 채 새 workflow·version을 만든다.
- [ ] 상위 데이터 변경 시 현재 결과와 하위 결과에 `재검증 필요`가 표시된다.
- [ ] Excel tab은 실제 workbook을 왼쪽, 선택 cell 원문을 오른쪽에 표시한다.
- [ ] SpreadJS workbook의 모든 cell은 validation 단계에서 읽기 전용이다.
- [ ] workbook 표시값과 최종 권위값은 Aspose.Cells 결과를 따른다.
- [ ] source value·Excel cell·formula output·후속 report까지 provenance가 이어진다.
- [ ] `자동 저장됨`은 실제 server sync 완료 뒤에만 표시된다.
- [ ] `임시 저장`은 실제 decision draft를 저장하며 빈 toast button으로 남지 않는다.
- [ ] `다음`은 server gate를 통과해야 활성·성공하고 validation version을 승인한다.
- [ ] `다음` 성공 후 완료 modal 없이 valuation URL로 직접 이동한다.
- [ ] 모든 visible button이 실제 동작하거나 명확한 disabled reason을 가진다.
- [ ] desktop resize, mobile stack, keyboard tab·splitter·drawer·viewer 조작이 동작한다.
- [ ] validation 화면에서 보고서 PDF 생성 엔진이나 client Excel export를 실행하지 않는다.

### 7.28 자동 테스트 시나리오

| 종류 | 시나리오 |
|---|---|
| E2E | 소유자가 validation URL에 직접 진입 |
| E2E | 비로그인 진입 후 Google 로그인·동일 URL 복귀 |
| 보안 | 다른 사용자 projectId로 workspace·Evidence·viewer URL 접근 거부 |
| 보안 | object key·owner ID·decision actor 위조 거부 |
| 단계 | research-plan 미승인 시 이전 단계 이동 |
| 단계 | 수집 중 validation 화면과 프로젝트 목록 진행률 일치 |
| 단계 | 완료 gate 실패 시 첫 blocker focus |
| 단계 | gate 통과 후 modal 없이 valuation URL 이동 |
| 통합 | Research Agent output이 직접 화면에 노출되지 않고 Validation run을 거침 |
| 통합 | Validation Agent 입력에 Research Agent 추론이 포함되지 않음 |
| 통합 | 일반 문장 기업·기간·exact quote 검사 |
| 통합 | 재무 숫자 단위·통화·scope·값 종류 검사 |
| 단위 | 합계·증감률·컨센서스 차이 Decimal 재계산 |
| E2E | HYPOTHESIS·EXCEL tab keyboard 이동 |
| E2E | 전체·충돌·완료 filter count와 결과 일치 |
| E2E | 질문 선택 → Evidence 선택 → source panel 교체 |
| E2E | source panel이 질문의 마지막 Evidence 뒤에 표시 |
| E2E | PDF page·bbox highlight와 expand·zoom·page 이동 |
| E2E | 뉴스 canonical URL·noopener·Text Fragment |
| E2E | Text Fragment 실패 fallback |
| E2E | result 반려 사유 검증·저장·철회 |
| E2E | 필수 result 반려가 다음 단계를 차단 |
| E2E | 재조사 중복 클릭이 workflow 하나만 생성 |
| E2E | 재조사 완료 새 result가 이전 version을 supersede |
| E2E | conflict 후보 미선택·사유 미입력 시 확정 차단 |
| E2E | conflict 선택 뒤 resolved·Excel 반영 상태 |
| 통합 | conflict decision append-only와 과거 승인 재현 |
| 통합 | stale validation version mutation이 `409` 반환 |
| E2E | stale 응답 뒤 입력한 사유 text 유지 |
| E2E | Excel tab의 실제 sheet·cell·formula bar 표시 |
| 보안 | validation workbook의 입력·paste·formula·format 변경 거부 |
| 통합 | Excel 실제값 반영 후 Aspose.Cells formula 결과·version 갱신 |
| 통합 | client 표시값과 Aspose 권위값 불일치 시 server 값 우선 |
| 접근성 | tablist, filter, result row, dialog accessible name |
| 접근성 | pointer·방향키·Home·End·double-click splitter |
| 접근성 | drawer focus trap·Escape·trigger focus 복귀 |
| 반응형 | `900px` 이하 가설·Excel pane 읽기 순서대로 stack |
| 반응형 | mobile source drawer full-width·44px touch target |
| 회귀 | active purpose tab, 질문·Evidence card, conflict·complete color token |
| 회귀 | validation 화면에서 완료 modal이 다시 생기지 않음 |

### 7.29 아직 필요한 제품·기술 결정

두 기준 문서로 화면 동작 대부분을 확정할 수 있지만 다음 항목은 구현 전에 추가 결정이 필요하다.

1. 인증·세션·CSRF의 구체 구현은 홈 명세와 같은 미확정 기술 결정을 따른다.
2. one-way job 갱신을 polling, SSE 또는 다른 transport 중 무엇으로 구현할지 결정해야 한다.
3. 질문별 `sufficient`, `qualified`, `insufficient` 자동 판정 기준과 사용자 override 허용 여부가 필요하다.
4. 선택값·반려·재조사 사유의 최소 5자 규칙을 제품 공통 규칙으로 확정할지 결정해야 한다.
5. validation 승인 뒤 후속 단계가 진행된 상태에서 결정을 바꿀 때 보여줄 하위 무효화 확인 문구가 필요하다.
6. 뉴스·유료 자료의 snapshot 보존·표시·삭제 범위는 TD-012 확정 전환 조건에 남아 있다.
7. SpreadJS 상용·SaaS 배포 라이선스와 실제 workbook 회귀검사는 TD-010 확정 전환 조건에 남아 있다.
8. Aspose.Cells, Temporal, PDF viewer와 Evidence 저장의 production 운영 한도는 TD-004·011·012 조건부 확정 항목을 통과해야 한다.

이 미확정 항목은 현재 화면의 레이아웃, 공식 원문 우선, 독립 검증, conflict 사용자 선택, 읽기 전용 Excel과 직접 valuation 이동 계약을 바꾸지 않는다.
