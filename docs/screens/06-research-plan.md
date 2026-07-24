# REFLO 화면 구현 명세: `/projects/:projectId/process/research-plan` 자료 조사 계획

**문서 상태:** 자료 조사 계획 명세 작성 완료

**작성일:** 2026-07-24

**대상:** 현업 배포용 MVP

**상위 문서:** [`REFLO_SCREEN_IMPLEMENTATION_SPEC_v1.md`](../REFLO_SCREEN_IMPLEMENTATION_SPEC_v1.md)

**기준 문서:** [`REFLO_URL_SERVICE_BEHAVIOR_v1.md`](../REFLO_URL_SERVICE_BEHAVIOR_v1.md), [`REFLO_TECHNICAL_DECISIONS_v1.md`](../REFLO_TECHNICAL_DECISIONS_v1.md)

## 6. `/projects/:projectId/process/research-plan` — 자료 조사 계획

### 6.1 명세 상태

| 항목 | 값 |
|---|---|
| URL | `/projects/:projectId/process/research-plan` |
| 접근 권한 | Google 로그인 필수, 프로젝트 소유자만 접근 |
| workflow 단계 | 7단계 중 STEP 04 |
| 주요 목적 | 승인된 가설 질문과 Excel 실제값 입력 대상의 출처·수집 방식·예상 결과를 확정하고 비동기 수집을 시작 |
| 현재 route 파일 | `source-react/app/projects/[projectId]/process/research-plan/page.tsx` |
| 현재 실제 UI 위치 | `source-react/app/process.tsx`의 `ResearchPlan`, `PlannedProcessPage` |
| 현재 주요 스타일 | `source-react/app/globals.css`의 `.rf-purpose-*`, `.rf-plan-*`, `.rf-source-*`, `.rf-dialog-*` |
| 기준 요구사항 | 서비스 동작 명세 2장, 3장, 4장, 5장, 11장, 16장, 17장, 19장 |
| 관련 기술 결정 | TD-003, TD-004, TD-005, TD-010, TD-011, TD-012, TD-013 |
| 구현 상태 | 하드코딩 plan과 브라우저 메모리 상태만 존재, 실제 저장·업로드·수집·작업 API 미구현 |

### 6.2 화면 목적과 책임

이 화면은 STEP 03에서 사용자가 승인한 조사 질문과 STEP 02에서 분석한 Excel 구조를 실제 자료 수집 작업으로 바꾸는 승인 화면이다. 다음 책임을 가진다.

1. 승인된 가설 질문마다 확인할 지표·사건·문장, 출처, 수집 방식과 예상 결과 유형을 보여준다.
2. 사용자가 이번 실행에 포함할 질문과 질문별 출처를 확정하게 한다.
3. Excel의 공식 실제값 입력 대상 셀마다 지표, 기간, 단위, 연결·별도 기준과 권위 출처를 보여준다.
4. 미래 추정치, 수식 셀, 외부 링크 의존 셀을 자동 수집 대상에서 제외한다.
5. 사용자 파일과 공개 URL을 안전하게 업로드·등록하고 질문에 연결한다.
6. plan을 버전으로 승인하고 Temporal 기반 비동기 수집·추출·독립 검증 작업을 한 번만 시작한다.
7. 실행 중·실패·취소·완료 상태와 복구 동작을 표시하고 STEP 05 검증 화면으로 연결한다.

이 화면은 조사 결과의 사실 여부를 최종 판정하지 않는다. Research Agent가 찾은 후보와 코드 수집값은 독립 검증을 통과하기 전 사용자 결과 목록에 노출하지 않는다. 출처 충돌 선택, 원문 대조와 Evidence 확정은 STEP 05가 담당한다.

### 6.3 진입·이탈 및 단계 이동 조건

#### 진입 조건

다음 조건을 모두 만족해야 편집 가능한 plan을 연다.

- 검증된 Google 세션 사용자와 프로젝트 소유자가 일치한다.
- STEP 01의 기업, 대상 연도·분기, 보고서 기준일, 리포트 유형과 기업 분야가 저장되어 있다.
- STEP 02의 PDF·Excel 적합성 검사가 통과했다.
- 사용할 workbook version과 구조 hash가 유효하다.
- STEP 03의 조사 질문 3~5개가 사용자 승인 상태다.
- 승인 질문 중 반증 질문이 최소 1개 존재한다.

| 진입 상황 | 처리 |
|---|---|
| 비로그인 | Google 로그인 후 현재 URL로 복귀 |
| 다른 사용자 프로젝트·존재하지 않는 프로젝트 | 동일한 `404 PROJECT_NOT_FOUND` |
| 앞 단계 미완료 | 서버가 가장 먼저 필요한 canonical process URL로 redirect |
| PDF·Excel version 변경으로 plan 무효 | 읽기 가능한 stale 안내와 `파일 다시 확인` 이동 제공, 승인·실행 차단 |
| 질문 version 변경으로 plan 무효 | 최신 질문으로 새 draft 생성 안내, 기존 승인 version은 이력으로 유지 |
| 실행 중 job 존재 | 승인된 plan snapshot과 실제 job 진행 상태를 읽기 전용으로 표시 |
| 완료 job 존재 | 완료 상태와 `수집 결과 검증` 이동 표시, plan 변경 시 새 version 필요 |

#### 이탈 조건

- 사용자는 저장된 draft 상태에서 프로젝트 목록이나 완료된 이전 단계로 이동할 수 있다.
- 저장 중이면 route 이동 전에 짧게 완료를 기다리고, 실패하면 `저장하지 않은 변경`을 명시한다.
- STEP 05는 수집 job이 생성된 뒤 접근할 수 있다. `queued`·`running`이면 진행 화면, `succeeded`면 검증 대기열을 표시한다.
- 실행 중 plan은 직접 수정하지 않는다. 변경하려면 먼저 취소를 요청하고 취소 완료 후 새 draft version을 만든다.
- 이전 단계의 입력을 변경하면 현재 plan, 활성 job과 downstream validation 결과를 자동으로 새 값에 맞춰 바꾸지 않는다. 관련 결과를 `재검증 필요`로 전환한다.

### 6.4 현재 화면 확인 결과

2026-07-24 기준 현재 React route와 화면은 다음과 같다.

- route 파일은 전용 화면을 구현하지 않고 공통 `app/page.tsx`를 다시 export한다.
- `app/page.tsx`가 pathname을 읽어 내부 step `4`를 `research-plan` route에 연결한다.
- 실제 화면은 `PlannedProcessPage` 안의 `ResearchPlan`이 렌더링한다.
- 화면 제목, 2개 목적 탭, 공용 출처 카드, 질문·Excel 카드, 출처 dialog, 승인 dialog와 하단 공통 action bar가 존재한다.
- HYPOTHESIS 탭은 질문 전체를 checkbox로 포함·제외하고 공용 출처를 일괄 설정한다.
- EXCEL 탭은 논리 항목 세 개와 하드코딩한 DART·기업 IR 출처를 보여준다.
- 질문·Excel 항목 추가와 `×` 삭제는 브라우저 배열만 바꾼다.
- 사용자 파일은 파일명만 메모리에 저장하며 객체 저장소 업로드, 검사와 질문 연결이 없다.
- 사용자 URL 입력은 현재 실제 `ResearchPlan`에 없다.
- plan, 질문, 출처와 job 상태가 module 전역 변수와 component state에만 남는다.
- 하단 `다음`은 전역 custom event로 승인 dialog를 열고, 3.65초 타이머가 가짜 진행률을 만든 뒤 STEP 05로 이동한다.
- 새로고침, 다른 tab, 다른 device와 서버 재시작 시 plan과 진행 상태를 복구할 수 없다.
- 현재 직접 진입 E2E는 제목 렌더링만 확인하고 plan 저장·실행·실패·권한은 검사하지 않는다.

### 6.5 기존 디자인 재사용·수정·제거 판정

| 현재 영역 | 판정 | 구현 판단 |
|---|---|---|
| 공통 process 헤더·좌측 workflow·하단 action bar | 재사용 | 실제 project·stage·저장·job 상태 연결 |
| `STEP 04`와 `자료 조사 계획` 제목 | 재사용 | 설명은 사용자 승인 책임이 드러나는 문구로 수정 |
| HYPOTHESIS·EXCEL 2개 목적 탭 | 그대로 재사용 | 순서, 2자리 번호, 15px 제목, 선택 선과 keyboard tab 동작 유지 |
| 탭 아래 한 줄 guide | 재사용·문구 수정 | 질문별 출처와 Excel 실제값 계약을 간결하게 안내 |
| HYPOTHESIS 공용 출처 카드 | 재사용·역할 수정 | 질문별 출처의 일괄 기본값·bulk editor로 사용, 질문별 저장값을 덮는 단일 권위 상태로 사용하지 않음 |
| 질문 카드와 22px checkbox·44px hit area | 재사용 | 실제 question ID, 포함 상태, 수집 항목, 방식, 결과 유형과 출처 연결 |
| 질문 카드 2자리 순번 | 재사용 | 화면 순번일 뿐 API 식별자로 사용하지 않음 |
| 질문 카드 `×` 삭제 | 제거 | 질문 편집·삭제는 STEP 03 책임, 이 화면은 포함·제외와 계획만 변경 |
| `확인 질문 추가` 입력 | 제거 | 승인 질문을 이 단계에서 우회 생성하지 않음, 필요하면 STEP 03 이동 |
| 질문별 `확인할 근거` chip | 재사용·확장 | 지표·사건·문장, 수집 방식과 예상 결과 유형을 표시 |
| 출처 일괄 설정 dialog | 재사용·수정 | 문서의 허용 출처, 실제 저장, 파일·URL 연결, 검증 오류 추가 |
| 현재 `고객사 IR`, `공개 산업자료` 독립 선택지 | 제거·정규화 | `기업 IR`의 대상 기업 metadata 또는 사용자 자료로 표현, 기준 문서의 7개 출처 enum만 사용 |
| EXCEL 상단 고정 출처 summary | 재사용·수정 | 항목 유형별 source policy와 연결·별도 기준을 요약 |
| EXCEL 논리 항목 카드 | 재사용·내용 수정 | 실제 sheet·cell·metric·period·unit·scope metadata 표시 |
| EXCEL 카드 `×` 삭제와 `자료 추가` | 제거 | workbook 분석 결과를 임의 삭제·생성하지 않음 |
| 승인 dialog | 재사용 | plan version 요약, 실제 승인·job 생성 요청, 오류와 중복 방지 추가 |
| 승인 dialog의 가짜 진행률·가짜 수집 건수 | 제거 | Temporal job projection의 실제 phase·progress·count만 표시 |
| 실행 중 dialog | 재사용·수정 | 닫기, STEP 05 이동, 취소 요청과 background 실행 안내 제공 |
| `임시 저장` | 재사용 | 실제 versioned save와 오류 복구 연결 |
| `다음` | 재사용 | 유효 draft에서는 승인 dialog, 실행 후에는 `수집 상태 보기` 또는 `수집 결과 검증` 의미로 변경 |

현재 화면의 흰 작업면, 중립 band, hairline, REFLO lime 상태 신호, borderless 질문 목록과 반응형 구조를 유지한다. 제품 동작을 맞추기 위해 필요한 정보와 상태만 추가한다.

### 6.6 목표 사용자 흐름

```text
route 진입
  → 세션·소유권·선행 version 검증
  → 승인 질문 + workbook 실제값 대상 + 기존 plan 조회
  → HYPOTHESIS 질문 포함 여부·질문별 출처 확인
  → 사용자 파일·URL 등록과 질문 연결
  → EXCEL 셀별 지표·기간·단위·연결/별도·출처 확인
  → draft 자동 저장
  → 다음
  → plan 요약·차단 오류 확인
  → 자료 수집 시작
  → plan version 승인 + Temporal job 원자적 생성
  → 실제 queued/running 상태 표시
  → 화면을 떠나도 background 실행
  → /projects/{projectId}/process/validation에서 진행 또는 결과 확인
```

가설 출처의 화면 상단 설정은 선택한 질문에 동일한 출처를 빠르게 적용하는 bulk action이다. 서비스 기준의 질문별 출처 계약을 지키기 위해 각 질문은 최종 `sourceBindingIds`를 별도로 저장한다. 사용자가 한 질문만 다른 출처로 조정하면 카드에 차이를 명시하고 나머지 질문의 설정은 유지한다.

### 6.7 목표 컴포넌트 구성

| 컴포넌트 | 책임 | 주요 입력 | 주요 출력·이벤트 |
|---|---|---|---|
| `ResearchPlanRoute` | 세션·소유권·선행 단계 검증과 초기 조회 | session cookie, `projectId` | 초기 plan 또는 canonical redirect·오류 |
| `ResearchPlanPage` | 전체 layout, tab, draft·job 상태 조정 | `initialPlan`, `prerequisites`, `activeJob` | 저장, 승인, 이동 |
| `ProcessShell` | 공통 header·sidebar·footer | project summary, stage state | route 이동, 저장, next |
| `ResearchPurposeTabs` | HYPOTHESIS·EXCEL 전환 | active purpose, 상태 요약 | tab 변경 |
| `HypothesisPlanPanel` | 질문별 계획 목록과 bulk 출처 설정 | approved questions, source bindings | 포함·출처 변경 |
| `BulkSourceSummary` | 공통 적용 출처와 차이 상태 요약 | selected question IDs, source IDs | source dialog 열기 |
| `HypothesisPlanCard` | 질문, 확인 대상, 방식, 결과 유형, 최종 출처 | question plan | 포함 toggle, 개별 출처 조정 |
| `ExcelPlanPanel` | 실제값 입력 대상 목록 | workbook metadata, cell targets | optional 대상 포함 변경 |
| `ExcelTargetCard` | sheet·cell·metric·period·unit·scope·source 표시 | cell target | 읽기·optional toggle |
| `SourceSelectionDialog` | 기준 출처 선택과 질문 적용 범위 확정 | source options, target question IDs | bulk 또는 개별 source binding 저장 |
| `UserMaterialManager` | 파일 upload와 URL 등록 | project, current materials | artifact·URL source 생성·삭제 |
| `PlanApprovalDialog` | 승인 snapshot 요약과 실행 확인 | plan version, validation result | 승인·job 생성 |
| `ResearchJobStatus` | queued·running·failed·canceled·succeeded 표시 | job projection | validation 이동, retry, cancel |
| `PlanRouteError` | 404·선행 단계·초기 조회 오류 | error code | 이전 단계·재시도 |

탭과 card 표시 컴포넌트 안에 Temporal client, 객체 저장소 credential, PydanticAI 실행 코드를 넣지 않는다.

### 6.8 화면 헤더·목적 탭 UI 계약

#### 화면 카피

| 영역 | 문구 |
|---|---|
| eyebrow | `STEP 04` |
| 제목 | `자료 조사 계획` |
| 설명 | `승인된 가설 질문과 Excel 실제값 입력 대상을 확인하고, 수집할 출처와 방법을 확정합니다.` |
| HYPOTHESIS eyebrow | `HYPOTHESIS` |
| HYPOTHESIS 제목 | `가설 확인을 위한 자료 수집` |
| EXCEL eyebrow | `EXCEL` |
| EXCEL 제목 | `입력값 삽입을 위한 자료 수집` |
| HYPOTHESIS guide | `자료를 수집할 질문과 출처를 확인하세요. 위 설정은 일괄 적용하고 필요한 질문만 개별 조정할 수 있습니다.` |
| EXCEL guide | `실제값 입력 대상의 기간·단위·연결/별도 기준과 출처를 확인하세요. 미래 추정치는 자동 수집하지 않습니다.` |

탭에는 per-tab 총 개수 badge를 추가하지 않는다. 선택 개수는 해당 panel의 출처 summary나 실제 목록 상태 안에서만 보조 정보로 표시한다.

#### 탭 동작

- `button role="tab"`과 `section role="tabpanel"`을 사용한다.
- `aria-selected`, `aria-controls`, roving `tabIndex`를 유지한다.
- 좌우 방향키로 탭을 순환하고 선택한 panel로 화면 reader 문맥을 연결한다.
- tab 전환은 저장되지 않은 입력을 버리지 않는다.
- URL은 같은 route를 유지한다. browser history에 목적 tab만 반복 추가하지 않는다.
- mobile에서는 탭을 세로로 쌓되 HYPOTHESIS → EXCEL 순서를 유지한다.

### 6.9 HYPOTHESIS 계획 계약

#### 질문 card 표시

| 항목 | 데이터 | 규칙 |
|---|---|---|
| 순번 | 현재 표시 순서 | `01`부터 2자리, question ID로 사용하지 않음 |
| 질문 | 승인된 question text | 이 화면에서 직접 편집하지 않음 |
| 반증 여부 | `falsificationQuestion` | 필요한 경우 `반증 질문` metadata로 표시 |
| 확인 대상 | metrics·events·statements | 추상 질문이 아닌 관찰 가능한 항목 |
| 출처 | 질문별 source bindings | 이름만이 아니라 source ID와 대상 기업·자료 범위 저장 |
| 수집 방식 | `code`, `research_agent`, `code_then_agent` | 사용자에게 이해 가능한 `코드 수집`, `AI 해석`, `코드 수집 후 AI 해석`으로 표시 |
| 예상 결과 | `number`, `table`, `statement`, `event`, `comparison` | 복수 선택 가능 |
| 포함 상태 | `included` | checkbox와 결과형 문구를 함께 표시 |
| 상태 | valid·missing source·stale | 색만이 아니라 명시적 문구 |

#### 포함 규칙

- checkbox는 질문 card 전체 label 안에서 44px hit area를 유지한다.
- 포함 질문은 최소 3개, 최대 5개여야 한다.
- 포함 질문 중 반증 질문이 최소 1개여야 한다.
- 질문을 제외해 위 조건이 깨지면 즉시 되돌리거나 해당 card 아래에 오류를 표시하고 승인 버튼을 비활성화한다.
- 질문 자체의 수정·추가·삭제는 STEP 03으로 이동해 새 question version을 승인해야 한다.
- 포함하지 않은 질문은 삭제하지 않고 plan version에 `included=false`로 저장한다.

#### 출처 적용 규칙

- 상단 `출처 일괄 설정`은 현재 선택된 질문에 source set을 일괄 적용한다.
- 각 질문은 최종 source set을 별도로 저장한다.
- 질문별 개별 조정은 card 안의 조용한 `출처 조정` action 또는 source row 전체 클릭으로 연다.
- bulk 변경 전에 개별 조정이 있으면 `개별 설정도 덮어씁니다`를 명시하고 확인한다.
- 출처가 하나도 없는 포함 질문은 승인할 수 없다.
- 기준일 이후 자료를 사용하도록 계획할 수 없다. 수집기는 `cutoffAt`을 강제한다.

### 6.10 EXCEL 계획 계약

EXCEL 탭은 논리 제목 세 개를 임의로 보여주는 목록이 아니라 STEP 02에서 분석한 실제 workbook의 공식 실제값 입력 대상을 표시한다.

| 표시 항목 | 설명 |
|---|---|
| sheet | 실제 표시 sheet 이름 |
| cell | stable sheet identity와 셀 주소 |
| metric | 셀이 요구하는 지표 |
| period | 대상 연도·분기 또는 기준일 |
| unit | 원, 억원, %, 수량 등 |
| scope | 연결·별도와 필요한 사업부문 |
| value kind | actual·preliminary actual 등 허용 값 종류 |
| source policy | DART·기업 IR·KRX·ECOS·FnGuide 등 cell 유형별 권위·비교 출처 |
| required | workbook 계산·PDF mapping에 필요한 필수 여부 |
| mapping | 연결된 slot 또는 downstream 사용처의 짧은 설명 |

#### 자동 포함·제외

- 공식 자료로 채울 수 있는 빈 실제값 셀을 모두 후보로 만든다.
- 필수 실제값 셀은 기본 포함이며 사용자가 제외할 수 없다. checkbox 대신 `필수 수집` 상태를 표시하거나 disabled 이유를 제공한다.
- optional 실제값 셀만 포함·제외할 수 있다.
- 노란 배경·파란 글씨의 미래 추정치 셀은 이 목록에 넣지 않는다. 해당 셀은 STEP 06에서 사용자가 입력한다.
- 수식 셀은 입력 대상이 아니다.
- 외부 link 의존 셀은 지원하지 않으며 STEP 02 적합성 검사에서 이미 차단되어야 한다.
- Excel target을 이 화면에서 문자열로 추가하거나 삭제하지 않는다.

#### 출처 정책

- 재무 실제치는 DART 구조화 정보 또는 공식 공시를 우선한다.
- 제품·사업부문 지표는 DART와 기업 IR을 함께 확인할 수 있다.
- 시장가격은 KRX, 거시지표는 ECOS를 사용한다.
- FnGuide는 컨센서스 비교 snapshot이며 실제값이나 미래 추정치를 덮어쓰지 않는다.
- 연결·별도는 DART·IR·workbook 기준을 먼저 맞춘다. 기본값으로 연결을 강제하거나 값이 나오는 기준을 임의 선택하지 않는다.
- source policy는 사용자가 승인할 수 있지만 권위 원천과 비교 원천의 역할을 뒤집을 수 없다.

Excel workbook grid를 이 화면에 넣지 않는다. cell 목록과 metadata만 표시하므로 SpreadJS를 로드하지 않는다.

### 6.11 출처·사용자 자료 계약

#### 선택 가능한 출처 enum

| API enum | 화면 문구 | 기본 수집 방식 | 비고 |
|---|---|---|---|
| `DART` | DART 공시 | 코드 또는 코드 후 AI 해석 | 구조화 수치는 코드, 본문·주석은 AI 해석 |
| `COMPANY_IR` | 기업 IR | Research Agent | 발행 기업·문서·페이지 metadata 필요 |
| `NEWS` | 뉴스 | Research Agent | 실제 기사 URL과 발행일 필요 |
| `KRX` | KRX | 코드 수집 | 종목·기준일 검증 |
| `ECOS` | 한국은행 ECOS | 코드 수집 | 통계코드·기간·단위 검증 |
| `FNGUIDE_CONSENSUS` | FnGuide 컨센서스 | 격리 provider 코드 수집 | 실제치 권위 원천 아님 |
| `USER_MATERIAL` | 사용자 자료 | parser 후 Research Agent | 파일 또는 URL |

자유 문자열 source type을 저장하지 않는다. `고객사 IR`은 `COMPANY_IR`에 대상 기업 metadata를 붙여 표현하고, 공개 산업자료는 출처의 발행기관을 가진 사용자 자료 또는 향후 승인된 공식 provider로 등록한다.

#### 사용자 파일

- 화면은 서버가 응답한 MIME·확장자 allowlist만 파일 선택기에 반영한다. `.pdf`, `.xlsx`, `.csv`, `.docx`, `.pptx`, `.txt`는 초기 지원 후보이며, 실제 허용 목록은 6.28의 parser 지원 범위가 확정되기 전 client에 hardcode하지 않는다.
- legacy binary `.xls`, `.doc`, `.ppt`, 실행 파일, macro 실행과 암호화 파일은 parser·보안 정책이 명시적으로 허용하지 않는 한 제외한다.
- 한 파일 최대 크기와 plan당 파일 수는 서버 정책을 응답으로 제공하고 client·server 양쪽에서 검사한다.
- 파일명은 표시용이며 object key나 권한 판단에 사용하지 않는다.
- browser는 제한된 presigned URL로 quarantine key에 직접 업로드한다.
- 업로드 완료 후 서버 checksum, 실제 MIME, 악성 여부와 parser 지원 범위를 검사한다.
- 검사 통과 artifact만 질문에 연결한다. 실패·검사 중 파일은 승인 count에 포함하지 않는다.
- 파일 삭제는 draft 연결만 제거한다. 승인 plan이나 실행 job이 참조한 불변 artifact를 즉시 물리 삭제하지 않는다.

#### 사용자 URL

- `http` 또는 `https` 공개 URL만 받는다.
- 한 줄에 하나씩 입력하고 앞뒤 공백 제거·중복 제거 후 최대 개수와 길이를 검사한다.
- credential이 포함된 URL, `file:`, `data:`, `javascript:`와 private·loopback·link-local·cloud metadata 주소를 거부한다.
- URL은 browser가 직접 fetch하지 않는다. `research-network` worker가 allowlist·egress proxy와 SSRF 방어를 거쳐 수집한다.
- redirect chain, final URL, canonical URL, 수집시각과 response hash를 source version에 저장한다.
- 뉴스는 전체 복사본을 기사처럼 재배포하지 않고 실제 URL과 검증 locator를 사용한다.

### 6.12 버튼·입력 요소 UI 계약

| ID | 요소 | 노출·활성 조건 | 동작 | 성공 결과 | 실패 처리 |
|---|---|---|---|---|---|
| PLAN-TAB-01 | HYPOTHESIS 탭 | 항상 | 가설 panel 선택 | 질문 plan 표시 | 없음 |
| PLAN-TAB-02 | EXCEL 탭 | 항상 | Excel panel 선택 | cell target 표시 | 없음 |
| PLAN-CHK-01 | 질문 포함 checkbox | editable draft | 질문 포함 상태 변경 | draft dirty·자동 저장 | card inline 오류, 이전 값 유지 |
| PLAN-BTN-01 | `출처 일괄 설정` | 포함 질문 1개 이상, editable draft | source dialog 열기 | bulk source 편집 | 없음 |
| PLAN-BTN-02 | 질문 `출처 조정` | 포함 질문, editable draft | 해당 질문 source dialog 열기 | 개별 source 저장 | 오류 유지·재시도 |
| PLAN-BTN-03 | source dialog 닫기 | dialog 열림, 저장 중 아님 | 변경 폐기·닫기 | 이전 포커스 복귀 | 없음 |
| PLAN-BTN-04 | source dialog `취소` | dialog 열림, 저장 중 아님 | 변경 폐기·닫기 | 이전 포커스 복귀 | 없음 |
| PLAN-BTN-05 | source dialog `설정 저장` | 허용 source 1개 이상 | 선택 범위에 source 적용 | card·summary 갱신 | dialog 유지·오류 표시 |
| PLAN-INP-01 | 사용자 파일 input | `USER_MATERIAL` 선택 | 파일 선택·upload 시작 | 검사 통과 artifact chip | 파일별 오류·재시도·제거 |
| PLAN-INP-02 | 사용자 URL textarea | `USER_MATERIAL` 선택 | URL 목록 입력 | 정규화 URL source 생성 | 줄별 오류 |
| PLAN-CHK-02 | optional Excel target checkbox | optional·editable | 포함 변경 | draft dirty·자동 저장 | 오류 표시 |
| PLAN-BTN-06 | `투자 의견 · 조사 질문으로 돌아가기` | question version 수정 필요 | STEP 03 이동 | question 새 version 작업 | 없음 |
| PLAN-BTN-07 | `임시 저장` | editable·dirty·저장 중 아님 | 즉시 PATCH | `자동 저장됨` 시각 갱신 | footer 오류·재시도 |
| PLAN-BTN-08 | 하단 `다음` | draft valid·저장 완료 | approval dialog 열기 | 승인 요약 표시 | 차단 항목으로 focus 이동 |
| PLAN-BTN-09 | `자료 수집 시작` | approval ready·요청 중 아님 | plan 승인과 job 생성 | queued 상태·job ID 수신 | dialog 유지·재시도 |
| PLAN-LINK-01 | `수집 상태 보기` | job queued·running·cancel requested | STEP 05 이동 | 실제 progress 표시 | route 오류 |
| PLAN-LINK-02 | `수집 결과 검증` | job succeeded | STEP 05 이동 | 검증 대기열 표시 | route 오류 |
| PLAN-BTN-10 | `자료 수집 취소` | queued·running | cancel 요청 | `cancel_requested` 표시 | 기존 job 유지·재시도 |
| PLAN-BTN-11 | `실패 단계 재시도` | retryable failed | 같은 승인 plan으로 retry | 새 attempt 또는 재개 job | 실패 이유 유지 |
| PLAN-BTN-12 | `계획 수정` | canceled 또는 non-retryable failed | 새 draft version 생성 | 편집 상태 복귀 | 생성 실패·재시도 |

질문·Excel 항목의 `×` 삭제 버튼과 새 질문·새 Excel 입력값 자유 입력은 목표 화면에 두지 않는다.

### 6.13 화면 데이터 계약

#### 초기 응답의 핵심 구조

```json
{
  "project": {
    "projectId": "prj_01...",
    "name": "삼성전기 2026년 2분기 리서치",
    "companyName": "삼성전기",
    "ticker": "009150",
    "targetPeriod": "2026Q2",
    "cutoffAt": "2026-07-17T23:59:59+09:00"
  },
  "prerequisites": {
    "workbookVersionId": "wbv_17",
    "workbookStructureHash": "sha256:...",
    "questionSetVersionId": "qsv_04",
    "questionSetApproved": true
  },
  "plan": {
    "planId": "rpl_01...",
    "version": 7,
    "status": "draft",
    "questions": [],
    "excelTargets": [],
    "userMaterials": [],
    "lastSavedAt": "2026-07-24T12:00:00Z"
  },
  "sourceOptions": [],
  "activeJob": null
}
```

#### 질문 plan

| 필드 | 규칙 |
|---|---|
| `questionId` | STEP 03에서 발급한 stable ID |
| `order` | 승인 질문 순서 |
| `text` | 승인 version의 질문 문구 |
| `falsificationQuestion` | 반증 질문 여부 |
| `included` | 이번 plan 포함 여부 |
| `collectionTargets` | 지표·사건·문장과 예상 결과 유형 |
| `sourceBindingIds` | 질문별 최종 출처 binding |
| `collectionMethods` | source별 code·agent 역할 |
| `validationErrors` | source 없음, 기준 불일치 등 정형 오류 |

#### Excel target

| 필드 | 규칙 |
|---|---|
| `targetId` | workbook version 안의 stable 대상 ID |
| `sheetId`, `sheetName`, `address` | 실제 위치 |
| `metric`, `period`, `unit`, `scope` | 수집·검증 기준 |
| `valueKind` | actual·preliminary actual 등 허용 enum |
| `required` | 제외 가능 여부 |
| `included` | optional target의 포함 상태 |
| `sourcePolicy` | 권위·검증·비교 source 역할 |
| `mappingSlotIds` | downstream MappingSet 연결 |
| `excludedReason` | future estimate·formula·external link 등 |

#### 정적 데이터

- 화면 제목·설명과 목적 tab 문구
- source enum별 표시 이름·icon·설명
- 수집 방식·예상 결과·job 상태 code별 사용자 문구
- 오류 code별 복구 action 문구

Agent가 만든 자유 문장을 버튼 label, status code와 권한 판단값으로 사용하지 않는다.

### 6.14 클라이언트 상태

| 상태 | 타입 | 초기값 | 설명 |
|---|---|---|---|
| `activePurpose` | `hypothesis \| excel` | `hypothesis` | 현재 tab |
| `draftPlan` | `ResearchPlanDraft` | 서버 plan | 편집 중 plan |
| `serverVersion` | integer | 서버 version | optimistic concurrency |
| `dirty` | boolean | `false` | 저장되지 않은 변경 |
| `saveStatus` | `idle \| debouncing \| saving \| saved \| error \| conflict` | `idle` | 자동·수동 저장 |
| `sourceDialog` | null 또는 적용 범위 | `null` | bulk·개별 source 편집 |
| `materialUploads` | file별 upload state | 서버 상태 | upload·검사 |
| `approvalStatus` | `closed \| validating \| ready \| starting \| error` | `closed` | 승인 dialog |
| `job` | null 또는 `ResearchJobProjection` | 서버 active job | 비동기 실행 상태 |
| `jobRefreshStatus` | `idle \| polling \| delayed \| error` | `idle` | 진행 상태 갱신 |
| `routeError` | 정형 오류 또는 null | 서버 초기값 | 접근·초기 조회 오류 |

module 전역 변수, `window` custom event와 hardcoded 배열을 권위 상태로 사용하지 않는다. 서버 plan version과 job projection이 권위값이다.

### 6.15 plan 검증 규칙

승인 dialog를 열기 전에 client에서 빠르게 검사하고, 승인·실행 API가 같은 규칙을 server에서 다시 검사한다.

1. 포함 질문이 3~5개다.
2. 포함 질문 중 반증 질문이 최소 1개다.
3. 모든 포함 질문에 source가 하나 이상 있다.
4. 각 질문의 지표·사건·문장과 예상 결과 유형이 비어 있지 않다.
5. source별 수집 방식이 기준 문서의 code·Research Agent 역할과 일치한다.
6. 모든 필수 Excel target이 포함되어 있다.
7. Excel target의 metric, period, unit과 연결·별도 기준이 확정되어 있다.
8. 미래 추정치와 수식 셀이 자동 입력 대상으로 포함되지 않았다.
9. FnGuide는 actual source가 아닌 comparison source로만 연결된다.
10. 모든 사용자 파일이 검사 통과 상태다.
11. 모든 URL이 허용 scheme·public network·길이·개수 규칙을 통과한다.
12. plan이 참조하는 question set, workbook, MappingSet과 cutoff version이 최신이다.
13. 이미 동일 plan version의 active job이 존재하지 않는다.

전체 오류를 첫 오류 하나로 숨기지 않는다. tab별 오류 개요를 제공하고 첫 문제 card로 focus를 이동한다.

### 6.16 저장·버전·상위 변경 규칙

- checkbox, source와 material 연결 변경은 500ms 안팎 debounce로 자동 저장한다.
- `임시 저장`은 debounce를 기다리지 않고 같은 PATCH를 즉시 실행한다.
- 각 요청은 예상 plan version과 고유 request ID를 포함한다.
- batch 전체를 원자적으로 반영하고 성공 시 새 version과 정규화된 plan delta를 반환한다.
- stale version이면 자동 병합하지 않는다. 최신 plan을 조회하고 사용자에게 다른 tab 변경 여부를 알린다.
- 동일 request ID 재전송은 한 번만 반영한다.
- 승인 시 mutable draft를 수정하지 않고 immutable approved plan version을 만든다.
- job은 approved plan version, question set version, workbook version, MappingSet, cutoff와 source artifact version을 고정한다.
- 승인 후 새 자료나 수정 공시가 생겨도 해당 실행의 입력을 자동 변경하지 않는다.
- 상위 단계 version 변경은 기존 승인 plan과 job 이력을 보존하고 새 draft를 `revalidation_required`로 만든다.

### 6.17 API 계약

#### `GET /api/projects/{projectId}/research-plan`

현재 사용자가 소유한 프로젝트의 초기 plan, 선행 version, source option과 active job projection을 조회한다.

| 상태 | 오류 code | 화면 처리 |
|---|---|---|
| `401` | `AUTH_REQUIRED` | 현재 URL을 보존해 로그인 |
| `404` | `PROJECT_NOT_FOUND` | 존재·소유권 구분 없이 404 |
| `409` | `PREREQUISITE_INCOMPLETE` | 서버가 제공한 canonical 이전 route 이동 |
| `409` | `PLAN_REVALIDATION_REQUIRED` | stale 안내와 새 draft 생성 |
| `500` | `RESEARCH_PLAN_LOAD_FAILED` | 전체 오류 상태와 재시도 |

#### `PATCH /api/projects/{projectId}/research-plan`

draft 변경을 batch 저장한다.

```http
PATCH /api/projects/prj_01.../research-plan
Content-Type: application/json
If-Match: "7"
Idempotency-Key: 7a4d...
```

```json
{
  "expectedVersion": 7,
  "changes": [
    {
      "op": "set_question_included",
      "questionId": "q_01",
      "included": true
    },
    {
      "op": "set_question_sources",
      "questionId": "q_01",
      "sourceBindingIds": ["src_dart", "src_ir"]
    }
  ]
}
```

성공 시 새 `version`, 저장된 delta, `validationSummary`와 `lastSavedAt`을 반환한다.

| 상태 | 오류 code | 처리 |
|---|---|---|
| `400` | `INVALID_PLAN_CHANGE` | 관련 card·field inline 오류 |
| `409` | `PLAN_VERSION_CONFLICT` | 최신 version 조회, 자동 덮어쓰기 금지 |
| `409` | `PLAN_LOCKED_BY_ACTIVE_JOB` | 읽기 전용 전환과 job 상태 표시 |
| `422` | `PLAN_VALIDATION_FAILED` | tab별 오류 개요 |
| `500` | `RESEARCH_PLAN_SAVE_FAILED` | local 변경 유지·재시도 |

#### `POST /api/projects/{projectId}/research-plan/approve-and-start`

현재 plan을 승인하고 Research workflow를 원자적으로 시작한다.

```http
POST /api/projects/prj_01.../research-plan/approve-and-start
Content-Type: application/json
Idempotency-Key: 2f35...
```

```json
{
  "planId": "rpl_01...",
  "expectedVersion": 12
}
```

성공은 `202 Accepted`다.

```json
{
  "approvedPlanVersionId": "rplv_12",
  "job": {
    "jobId": "job_01...",
    "status": "queued",
    "phase": "preparing",
    "progressPercent": 0,
    "retryable": false,
    "validationRoute": "/projects/prj_01.../process/validation"
  }
}
```

승인 version 생성과 workflow 시작 중 하나만 성공한 상태를 외부에 노출하지 않는다. 같은 idempotency key의 재전송은 기존 job을 반환한다.

| 상태 | 오류 code | 처리 |
|---|---|---|
| `409` | `RESEARCH_JOB_ALREADY_ACTIVE` | 기존 job projection 표시 |
| `409` | `PLAN_VERSION_CONFLICT` | 최신 plan 재검토 |
| `422` | `PLAN_VALIDATION_FAILED` | 승인 dialog 닫지 않고 차단 항목 표시 |
| `503` | `WORKFLOW_START_UNAVAILABLE` | plan draft 유지·같은 key로 재시도 |

#### job 조회·취소·재시도

```text
GET  /api/projects/{projectId}/research-jobs/{jobId}
POST /api/projects/{projectId}/research-jobs/{jobId}/cancel
POST /api/projects/{projectId}/research-jobs/{jobId}/retry
```

- 취소와 재시도는 각각 idempotency key를 사용한다.
- retry는 승인 plan version을 바꾸지 않고 retryable activity checkpoint부터 재개한다.
- 입력 오류·지원하지 않는 파일·source 정책 오류는 retryable이 아니며 plan 수정 또는 앞 단계 수정이 필요하다.
- browser는 Temporal API나 workflow ID에 직접 접근하지 않는다.

#### 사용자 파일 upload session

```text
POST /api/projects/{projectId}/source-uploads
POST /api/projects/{projectId}/source-uploads/{uploadId}/complete
GET  /api/projects/{projectId}/source-uploads/{uploadId}
```

첫 요청은 제한된 presigned URL, object key가 아닌 `uploadId`, 크기·형식 제한과 만료시각을 반환한다. complete 요청 뒤 검사 결과가 `accepted`가 되어야 plan source binding으로 사용할 수 있다.

### 6.18 비동기 실행·진행·재시도·취소 상태

#### job 상태

| 상태 | 화면 | 사용자 동작 |
|---|---|---|
| `queued` | 실제 대기 상태와 0% 표시 | STEP 05 이동, background 계속, 취소 |
| `running` | phase, progress, 최근 갱신 시각 | STEP 05 이동, background 계속, 취소 |
| `cancel_requested` | 종료 요청 처리 중, 중복 취소 차단 | 기다리기·프로젝트 목록 이동 |
| `canceled` | 취소 완료와 partial 결과 비공개 안내 | 계획 수정·같은 plan 재시작 |
| `failed` retryable | 실패 phase와 사용자용 오류 code | 실패 단계 재시도·로그 상세 |
| `failed` non-retryable | 입력·source 수정 필요 이유 | plan 또는 이전 단계 수정 |
| `succeeded` | 수집·추출·독립 검증 준비 완료 | `수집 결과 검증` |

#### phase

사용자에게는 내부 activity 이름 대신 다음 제한된 phase를 표시한다.

1. `preparing` — 승인 plan과 source version 고정
2. `collecting_code_sources` — DART·KRX·ECOS·FnGuide 코드 수집
3. `collecting_documents` — IR·뉴스·사용자 자료 확보
4. `extracting_candidates` — Research Agent와 parser가 후보 구조화
5. `validating_evidence` — Validation Agent와 결정적 코드 독립 검증
6. `publishing_projection` — STEP 05 검증 대기열 게시

progress는 Temporal activity의 완료 단위와 실제 checkpoint에서 계산한다. 시간을 기준으로 임의 증가시키지 않는다. 수집 건수와 추출 건수는 backend가 확정한 값만 표시하고, 검증 전 후보의 내용은 표시하지 않는다.

#### 상태 갱신

- route가 보이는 동안 3초 간격으로 job projection을 조회한다.
- document가 hidden이면 polling을 중단하고 다시 보일 때 즉시 갱신한다.
- `ETag`를 제공하면 `If-None-Match`를 사용한다.
- 15초 이상 projection 갱신이 없으면 성공으로 추정하지 않고 `상태 갱신 지연`을 표시한다.
- polling 실패 시 마지막 정상 상태를 유지하고 재시도한다.
- job 완료·실패·취소 후 polling을 중단한다.

#### 취소

- `queued`·`running`에서만 취소할 수 있다.
- 취소 확인은 현재 phase와 `지금까지의 임시 결과는 최종 결과로 사용되지 않습니다`를 표시한다.
- 요청 후 즉시 `canceled`로 보이지 않고 `cancel_requested`를 표시한다.
- 실행 중 자식 process는 grace period 후 종료하고 시작하지 않은 activity는 실행하지 않는다.
- temporary artifact는 publish하지 않고 정리 workflow 대상으로 남긴다.
- 이미 `succeeded`한 job은 취소할 수 없다.

#### 재시도

- network timeout, 429, 5xx, worker·I/O 장애처럼 retryable 오류만 사용자가 재시도할 수 있다.
- 자동 재시도를 모두 소진한 뒤에만 사용자 `실패 단계 재시도`를 노출한다.
- 완료 checkpoint와 불변 artifact를 재사용하고 전체 수집을 무조건 처음부터 반복하지 않는다.
- parser가 확인한 암호화·손상·미지원 형식, 외부 link Excel, source policy 오류는 재시도 버튼 대신 수정 경로를 제공한다.
- partial artifact를 성공 결과로 게시하지 않는다.

### 6.19 로딩·빈 상태·오류·예외 처리

| 상황 | 사용자 화면 | 복구 |
|---|---|---|
| 최초 로딩 | 최종 tab·card 크기의 skeleton | plan 또는 오류 표시 |
| 승인 질문 없음 | STEP 03 필요 안내 | `투자 의견 · 조사 질문으로 돌아가기` |
| Excel target 없음 | workbook 분석 결과 설명 | 필수 actual target이 없으면 정상 empty, 분석 미완료면 STEP 02 |
| source option 조회 실패 | 기존 plan은 읽기 가능, 출처 편집·승인 차단 | 재시도 |
| 자동 저장 실패 | 변경 유지, footer `저장 실패` | 즉시 재시도 |
| version conflict | 상대 변경 version 안내 | 최신 plan 다시 불러오기 |
| file upload 실패 | 파일별 오류, 다른 plan 유지 | 해당 파일 재시도·제거 |
| file 검사 실패 | 이유와 지원 형식 | 파일 교체 |
| URL 수집 전 검증 실패 | 줄별 URL 오류 | 수정 |
| 승인 검증 실패 | tab별 차단 수와 card 오류 | 수정 후 다시 승인 |
| workflow 시작 실패 | approval dialog와 plan 유지 | 같은 idempotency key 재시도 |
| job 상태 갱신 실패 | 마지막 상태와 지연 안내 | 자동·수동 재시도 |
| source 수집 일부 실패 | job phase 실패 또는 source별 warning | 필수 source면 실패, optional이면 사용자 확인 후 계속 |
| FnGuide 최신 수집 실패 | 마지막 정상 snapshot 시각·stale 표시 | snapshot 확인 또는 컨센서스 비교 제외 |
| 세션 만료 | local draft와 적용 중 dialog 상태 보존 | 재로그인 후 server version과 병합 여부 확인 |
| upstream version 변경 | stale banner, 실행 차단 | 새 draft 생성·재검토 |

empty 상태를 하드코딩 sample 질문이나 Excel 항목으로 채우지 않는다.

### 6.20 저장 모델과 권한·보안 규칙

#### PostgreSQL 최소 모델

- `research_plan`, `research_plan_version`
- `research_plan_question`
- `research_plan_question_source`
- `research_plan_excel_target`
- `research_source_binding`
- `user_material`
- `research_job_projection`
- 승인·취소·retry audit record

approved plan version은 최소 다음 참조를 고정한다.

- project·owner
- question set version
- workbook version과 structure hash
- MappingSet version
- cutoff
- source binding·사용자 material artifact version
- collector·normalizer·provider version
- 생성자·승인자와 시각

#### 권한·보안

1. 모든 조회·저장·upload·승인·job action은 검증된 session owner와 project owner를 server에서 대조한다.
2. client가 보낸 사용자 ID, owner ID, object key, `editable`, `approved`, progress와 source 검증 결과를 신뢰하지 않는다.
3. 다른 사용자의 project·artifact·job 접근은 동일한 404로 처리한다.
4. presigned URL은 한 quarantine key, 크기, content type과 짧은 만료시간으로 제한한다.
5. Research Agent 입력에 포함된 파일·웹 문장은 데이터다. 역할 변경·도구 실행·출력 형식 변경 명령으로 취급하지 않는다.
6. network worker는 private·loopback·link-local·metadata endpoint와 승인되지 않은 redirect를 차단한다.
7. macro, DDE, 외부 workbook link와 임의 script를 실행하지 않는다.
8. plan·job 상태 변경 요청은 CSRF 방어와 idempotency를 적용한다.
9. 오류 응답에 Temporal 내부 ID, object key, credential, 원시 agent prompt·응답과 stack trace를 노출하지 않는다.
10. 승인·취소·retry와 source 변경은 사용자, 시각, 전후 version을 감사 기록에 남긴다.

### 6.21 기술 배치

| 기술·영역 | 이 화면에서의 위치 | 판단 |
|---|---|---|
| Next.js App Router | 보호 route, 초기 plan·권한 조회 | 사용 |
| React Client Component | tab, checkbox, dialog, autosave, upload·job polling | 사용 |
| PostgreSQL | plan version·source binding·job projection | 사용 |
| S3 호환 객체 저장소 | 사용자 파일과 수집 원문 불변 artifact | 직접 credential 없이 upload session으로 사용 |
| Temporal | 수집·추출·검증 workflow와 retry·cancel | backend에서 사용, browser 직접 연결 금지 |
| `research-network` worker | DART·IR·KRX·ECOS·FnGuide·뉴스·URL 수집 | 승인 후 사용 |
| PydanticAI Research Agent | IR·뉴스·업로드 자료 해석과 후보 구조화 | 승인 후 worker에서 사용 |
| Validation Agent·결정적 코드 | 후보 독립 검증 | 같은 workflow의 후속 phase, 검증 전 결과 노출 금지 |
| FnGuideConsensusProvider | 승인 endpoint와 snapshot policy | 컨센서스 source가 포함된 경우 사용 |
| TD-012 Evidence 저장 | source version·locator·provenance 생성 | 수집·검증 worker에서 사용 |
| Aspose.Cells | STEP 02가 만든 workbook metadata의 권위 | 이 route 요청에서 workbook을 다시 열거나 재계산하지 않음 |
| SpreadJS | 없음 | cell metadata 목록이므로 번들에 포함하지 않음 |
| PDF patch·PDFium·OpenCV | 없음 | 보고서 생성·검증 단계 기술이므로 호출하지 않음 |

무거운 worker와 provider SDK를 route client bundle에 포함하지 않는다.

### 6.22 반응형·접근성 계약

#### 반응형

- Desktop에서는 현재 좌측 workflow와 한 개의 주 작업 column을 유지한다.
- 두 목적 탭은 같은 폭으로 한 surface 안에 배치한다.
- Tablet에서는 탭 가독성이 유지되는 동안 가로 배치를 사용하고 card padding만 줄인다.
- Mobile에서는 HYPOTHESIS와 EXCEL 탭을 순서대로 쌓고 active tab을 lime leading edge로 구분한다.
- 질문·Excel card는 내부 scroll을 만들지 않고 내용 높이만큼 확장한다.
- source dialog의 2열 option grid는 mobile에서 1열로 바꾼다.
- footer action은 좁은 화면에서 full width로 배치하되 44px target을 유지한다.

#### 접근성

- 목적 tab은 `tablist`·`tab`·`tabpanel` 관계와 방향키 동작을 제공한다.
- checkbox는 native input을 유지하고 visual box만 custom 처리한다.
- 포함 상태는 `체크됨`뿐 아니라 `이 질문으로 자료 수집`, `자료 수집 안 함`, `필수 수집`처럼 결과를 읽게 한다.
- card 안에 label과 delete button 같은 중첩 interactive 구조를 만들지 않는다.
- source dialog는 열릴 때 제목 또는 첫 option으로 focus를 옮기고 focus를 가둔다.
- Escape와 닫기 후에는 dialog를 연 action으로 focus를 돌린다. 저장·승인·취소 요청 중에는 실수로 닫히지 않는다.
- upload, 저장, job progress와 오류는 `aria-live`에서 변화할 때 한 번만 알린다.
- progress는 `role="progressbar"`, `aria-valuenow`, phase text와 최근 갱신 시각을 제공한다.
- 색상만으로 포함·제외·실패·완료를 구분하지 않는다.
- `prefers-reduced-motion: reduce`에서는 tab·progress transition과 spinner motion을 축소하거나 정적으로 표시한다.

### 6.23 현재 프로토타입과 목표 구현의 차이

| 현재 프로토타입 | 목표 구현 | 우선순위 |
|---|---|---|
| 공통 `app/page.tsx` 재export route | 전용 보호 route와 초기 server 조회 | 구현 품질 |
| module 전역 질문·출처 | versioned server plan | 필수 |
| 가짜 질문·Excel 항목 | 승인 question set·workbook target API | 필수 |
| 상단 공용 출처만 저장 | 공용 bulk UI + 질문별 최종 source binding | 필수 |
| source method·result type 없음 | 질문별 방식·예상 결과 표시 | 필수 |
| 기준 문서 밖 source 문자열 | 7개 허용 enum과 metadata | 필수 |
| 파일명만 client state 저장 | quarantine upload·검사·불변 artifact | 필수 |
| 사용자 URL 없음 | 안전한 URL 등록·수집 | 필수 |
| Excel 논리 제목만 표시 | 실제 sheet·cell·period·unit·scope 표시 | 필수 |
| 미래 추정치·필수 여부 구분 없음 | TD-003·workbook metadata 기반 제외·잠금 | 필수 |
| 질문·Excel 항목을 이 단계에서 추가·삭제 | STEP 03·workbook 분석 책임으로 되돌림 | 필수 |
| `다음`이 custom event 실행 | save·approve-and-start API | 필수 |
| 3.65초 timer·가짜 38건/146개 | 실제 Temporal projection | 필수 |
| 실행 중 dialog를 닫거나 취소할 수 없음 | background 계속·STEP 05 이동·cancel | 필수 |
| retry·non-retryable 구분 없음 | phase별 retry와 수정 경로 | 필수 |
| 새로고침 시 상태 유실 | plan·job 복구 | 필수 |
| 화면에서 모든 미래 단계로 이동 가능 | server stage gate·canonical redirect | 필수 |
| source·job 권한 검증 없음 | owner·project server 검증 | 필수 |
| 제목 렌더 E2E만 존재 | 저장·승인·job·권한·오류 테스트 | 필수 |

### 6.24 필요한 추가 요소와 제거 요소

#### 추가한다

- 질문별 수집 방식·예상 결과 유형·최종 출처 표시
- 질문별 출처 조정 action
- Excel cell 위치·기간·단위·연결/별도·필수 여부
- 사용자 URL 입력과 파일별 upload·검사 상태
- autosave 실패·version conflict·stale plan 안내
- 실제 job phase·progress·최근 갱신 시각
- retryable 실패의 재시도, 실행 중 취소, 완료 후 STEP 05 이동
- 선행 단계 미완료·무효 상태의 복구 action

#### 기존 요소에 실제 기능을 연결한다

- 목적 탭
- 질문 포함 checkbox
- 출처 일괄 설정 dialog
- 사용자 파일 추가
- `임시 저장`
- 하단 `다음`
- 승인·진행 dialog

#### 제거한다

- 질문 card `×` 삭제
- 이 화면의 `확인 질문 추가`
- Excel card `×` 삭제와 자유 `자료 추가`
- 기준 문서에 없는 source option
- hardcoded 예상 수집 건수·완료 건수
- timer 기반 progress
- `prototypeResearchQuestions`, `prototypeHypothesisSources`
- `reflo:open-research-approval`, `reflo:start-research` custom event

### 6.25 구현 순서

1. 전용 보호 route와 세션·project owner·stage gate를 구현한다.
2. question set·workbook target에서 draft plan을 생성하는 PostgreSQL 모델을 만든다.
3. `GET`·`PATCH research-plan`과 optimistic concurrency·autosave를 구현한다.
4. 현재 `ResearchPlan`을 전용 component로 분리하고 hardcoded 배열을 API 데이터로 교체한다.
5. 공용 출처 UI를 질문별 binding의 bulk editor로 연결하고 개별 조정을 추가한다.
6. Excel 논리 항목을 실제 cell metadata로 교체하고 future estimate·필수 target 규칙을 적용한다.
7. S3 upload session, 파일 검사, URL 안전 검증과 material binding을 구현한다.
8. plan validator와 승인 summary를 구현한다.
9. `approve-and-start`와 Temporal Research workflow·PostgreSQL job projection을 연결한다.
10. 실제 progress, background 실행, cancel·retry와 STEP 05 이동을 연결한다.
11. stale version·상위 변경·session 만료·오류·빈 상태를 구현한다.
12. keyboard, focus, mobile과 자동 테스트를 검증한다.

### 6.26 완료 조건

- [ ] 비로그인 사용자는 Google 로그인 후 같은 research-plan URL로 복귀한다.
- [ ] 로그인 사용자는 본인 프로젝트의 plan만 조회·수정·실행할 수 있다.
- [ ] 선행 단계가 미완료이거나 무효면 올바른 canonical route 또는 복구 안내를 제공한다.
- [ ] HYPOTHESIS와 EXCEL 탭의 순서·시각 구조·keyboard 동작이 유지된다.
- [ ] 승인 질문 3~5개와 반증 질문 여부가 실제 question set version에서 표시된다.
- [ ] 각 포함 질문에 확인 대상, 출처, 수집 방식과 예상 결과 유형이 표시된다.
- [ ] 상단 공용 출처 변경이 선택 질문에 bulk 적용되고 질문별 최종 source set이 별도로 저장된다.
- [ ] 포함 질문은 3~5개이며 반증 질문 최소 1개와 source 최소 1개 규칙을 지킨다.
- [ ] Excel 탭이 실제 sheet·cell·metric·period·unit·scope를 표시한다.
- [ ] 미래 추정치·수식·외부 link 셀을 자동 입력 대상으로 포함하지 않는다.
- [ ] 필수 Excel target은 제외할 수 없고 optional target만 명시적으로 변경할 수 있다.
- [ ] FnGuide 컨센서스가 actual·미래 추정치를 덮어쓰지 않는다.
- [ ] 사용자 파일이 객체 저장소 upload와 검사 통과 후에만 plan에 연결된다.
- [ ] 사용자 URL은 server-side 안전 검증과 network 격리를 거친다.
- [ ] draft 변경이 자동 저장되고 수동 저장·오류·version conflict를 복구할 수 있다.
- [ ] 승인 시 plan version과 모든 입력 version이 불변 snapshot으로 고정된다.
- [ ] 중복 클릭·재전송에도 Temporal job이 하나만 생성된다.
- [ ] progress가 timer가 아니라 실제 job projection에서 표시된다.
- [ ] 화면을 닫거나 프로젝트 목록으로 이동해도 job이 계속 실행된다.
- [ ] queued·running job을 취소하고 retryable failure를 checkpoint부터 재시도할 수 있다.
- [ ] 검증 전 후보 자료와 partial artifact가 사용자 결과로 노출되지 않는다.
- [ ] queued·running·succeeded 상태에서 STEP 05의 적절한 화면으로 이동한다.
- [ ] upstream version 변경 시 기존 결과를 자동 변경하지 않고 재검증 필요 상태를 표시한다.
- [ ] mobile, keyboard, screen reader와 reduced motion 환경에서 핵심 동작이 가능하다.
- [ ] 이 route bundle에 SpreadJS, Aspose.Cells, PDF patch·PDFium·OpenCV와 worker SDK가 포함되지 않는다.
- [ ] 동작하지 않는 추가·삭제·가짜 진행 UI가 남아 있지 않다.

### 6.27 자동 테스트 시나리오

| 종류 | 시나리오 |
|---|---|
| E2E | owner 사용자의 route 직접 진입과 실제 plan 렌더링 |
| E2E | 비로그인 진입, Google 로그인, 원래 URL 복귀 |
| E2E | 선행 단계 미완료·stale workbook·stale question version의 복구 route |
| E2E | HYPOTHESIS·EXCEL tab 클릭과 좌우 방향키 전환 |
| E2E | 질문 포함·제외, 3개 미만·반증 질문 없음 차단 |
| E2E | 공용 source bulk 적용과 질문별 개별 source 유지 |
| E2E | source 없음 질문의 승인 차단과 focus 이동 |
| E2E | 실제 Excel target metadata·필수·optional 상태 표시 |
| E2E | 미래 추정치와 수식 cell이 자동 수집 목록에 없음 |
| E2E | 사용자 파일 upload 성공·검사 실패·교체·제거 |
| E2E | 여러 URL 입력의 줄별 오류·중복 제거 |
| E2E | autosave 성공·실패·수동 재시도·version conflict |
| E2E | 승인 요약 후 job 생성, 중복 클릭에도 job 한 개 |
| E2E | queued·running 실제 progress와 background 실행 |
| E2E | running 취소 요청·cancel requested·canceled |
| E2E | retryable 실패의 checkpoint 재시도 |
| E2E | non-retryable 실패가 plan·이전 단계 수정 action 제공 |
| E2E | running·succeeded에서 validation route 이동 |
| 통합 | DART·IR·KRX·ECOS·FnGuide·뉴스 수집 method routing |
| 통합 | FnGuide 연결·별도 명시, cutoff snapshot, stale 확인과 비교 제외 |
| 통합 | approved plan에 question·workbook·MappingSet·artifact version 고정 |
| 통합 | Temporal retry·worker 재시작·중복 activity의 idempotency |
| 통합 | cancel 후 partial artifact 비공개와 cleanup 상태 |
| 보안 | 다른 owner의 plan·artifact·job 조회·수정·취소가 동일 404 |
| 보안 | 위조 owner ID·object key·approved flag·progress 값 거부 |
| 보안 | private IP·metadata endpoint·credential URL·위험 redirect 차단 |
| 보안 | upload MIME 위장·macro·암호화·악성 파일 차단 |
| 보안 | 사용자 파일·웹 문장의 prompt injection이 Agent 권한·출력 schema를 변경하지 못함 |
| 접근성 | tab 관계, checkbox 이름, dialog focus trap·Escape·focus 복귀 |
| 접근성 | progress·save·upload·오류 live 안내가 중복되지 않음 |
| 반응형 | desktop, tablet, mobile tab·card·dialog·footer layout |
| 시각 회귀 | 현재 STEP 04 HYPOTHESIS·EXCEL의 핵심 레이아웃과 REFLO lime 상태 신호 유지 |

### 6.28 아직 필요한 제품·기술 결정

화면 동작은 이 명세로 구현할 수 있지만 다음 항목은 구현 전에 기준 문서 또는 운영 정책에서 수치·목록을 확정해야 한다.

1. 사용자 자료의 파일당 최대 크기, plan당 파일·URL 최대 개수
2. `.docx`, `.pptx`, `.csv`, `.txt` parser와 legacy Office 형식 지원 범위
3. 질문별 source 추천을 만드는 규칙의 code·Agent 책임과 prompt version
4. source별 필수·optional 실패가 전체 job을 막는 정확한 정책
5. job progress weight와 사용자에게 노출할 정형 오류 code 전체 목록
6. 수집 완료 뒤 STEP 05로 자동 이동할지 사용자의 `수집 상태 보기` 선택을 기다릴지에 대한 최종 UX 정책
7. Google OAuth·세션·CSRF 구현 방식

미확정 수치나 source 정책을 client hardcode로 확정하지 않는다. 운영 policy가 정해지기 전에는 서버가 제공하는 제한과 오류 code를 화면이 표시하는 구조로 구현한다.
