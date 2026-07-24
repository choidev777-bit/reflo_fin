# REFLO 화면 구현 명세: `/projects/:projectId/process/valuation` PER 밸류에이션

- **문서 상태:** PER 밸류에이션 명세 1차 작성 완료
- **작성일:** 2026-07-24
- **대상:** 현업 배포용 MVP
- **상위 문서:** [`REFLO_SCREEN_IMPLEMENTATION_SPEC_v1.md`](../REFLO_SCREEN_IMPLEMENTATION_SPEC_v1.md)
- **기준 문서:** [`REFLO_URL_SERVICE_BEHAVIOR_v1.md`](../REFLO_URL_SERVICE_BEHAVIOR_v1.md), [`REFLO_TECHNICAL_DECISIONS_v1.md`](../REFLO_TECHNICAL_DECISIONS_v1.md)
- **디자인 기준:** [`DESIGN.md`](../../DESIGN.md), [`.omd/preferences.md`](../../.omd/preferences.md)

## 8. `/projects/:projectId/process/valuation` — PER 밸류에이션

### 8.1 명세 상태

| 항목 | 값 |
|---|---|
| URL | `/projects/:projectId/process/valuation` |
| 접근 권한 | Google 로그인 사용자 중 해당 프로젝트 소유자 |
| 주요 목적 | 실제 Excel 추정치 입력, 서버 권위 재계산, Forward EPS 확인, Target PER·목표주가 확정 |
| 진입 전 단계 | `/projects/:projectId/process/validation` |
| 정상 이탈 단계 | `/projects/:projectId/process/report-outline` |
| 현재 route 파일 | `source-react/app/projects/[projectId]/process/valuation/page.tsx` |
| 현재 공용 구현 파일 | `source-react/app/page.tsx`, `source-react/app/process.tsx`, `source-react/app/globals.css` |
| 현재 주요 컴포넌트 | `PlannedProcessPage`, `Valuation`, `ScreenHead` |
| 기준 요구사항 | 서비스 동작 명세 2장, 3장, 5장, 13장, 15장 |
| 관련 기술 결정 | TD-003, TD-004, TD-005, TD-010, TD-011, TD-012 |
| 구현 상태 | 하드코딩 React 프로토타입만 존재, SpreadJS·API·Aspose.Cells·저장·권한 미구현 |

### 8.2 목적과 책임

이 화면은 검증 단계에서 확정한 실제값과 사용자가 입력하는 미래 추정치를 프로젝트 Excel 작업 사본에 반영하고, 그 결과로 계산된 Forward EPS에 사용자가 확정한 Target PER을 적용해 목표주가를 결정하는 6단계 화면이다.

이 화면의 책임은 다음과 같다.

1. 업로드한 실제 Excel의 시트·셀·수식·스타일을 브라우저에서 재현한다.
2. TD-003으로 분류된 직접 입력 셀 중 현재 밸류에이션 단계에서 허용된 셀만 편집하게 한다.
3. 모든 입력을 서버의 Aspose.Cells 작업 사본에 저장하고 권위 수식 결과를 다시 받는다.
4. Forward EPS, 현재주가, 이전 보고서 기준값과 선택적 AI 제안을 서로 구분해 보여준다.
5. 사용자가 Target PER 또는 목표주가를 직접 입력하고 최종 값을 승인하게 한다.
6. 최신 Excel 계산 버전과 연결된 밸류에이션 승인 버전을 만들고 페이지 내용 설정 단계로 이동한다.

이 화면은 미래 추정치나 Target PER을 자동 확정하지 않는다. SpreadJS의 계산 결과, React의 `Number` 계산, AI 제안값은 권위값이 아니다.

### 8.3 진입 조건과 접근 제어

#### 인증·소유권

- 로그인하지 않은 사용자는 현재 URL을 `returnTo`로 보존한 뒤 Google 로그인으로 이동한다.
- 서버는 검증된 로그인 세션의 Google 사용자 ID와 프로젝트 소유자를 비교한다.
- 존재하지 않는 프로젝트와 다른 사용자의 프로젝트는 모두 `404 PROJECT_NOT_FOUND`로 처리한다.
- 클라이언트가 보낸 사용자 ID, 소유자 ID, workbook 편집 가능 표시를 신뢰하지 않는다.

#### 업무 선행 조건

다음을 모두 만족해야 정상 편집 상태로 진입한다.

- 파일 적합성 검사가 완료됐다.
- 원본 Excel과 프로젝트별 작업 사본이 존재한다.
- Excel 외부 링크, 지원하지 않는 필수 함수, 손상 또는 미해결 순환참조가 없다.
- 검증 단계의 필수 질문과 핵심 숫자 검증이 완료됐다.
- 출처 충돌이 모두 해결됐다.
- Excel 실제값 셀과 원문 Evidence 연결이 완료됐다.
- 현재 workbook 구조에 대한 TD-003 `editableCellSet`과 TD-005 MappingSet이 유효하다.

선행 조건이 완료되지 않은 최초 직접 진입은 서버가 최신 해결 route를 반환한다. 화면은 임의로 우회 편집을 허용하지 않고 해당 route로 이동하며 이유를 한 줄로 안내한다.

| 차단 상태 | 이동 또는 처리 |
|---|---|
| 인증 필요 | Google 로그인 후 같은 valuation URL 복귀 |
| 프로젝트 없음·타인 소유 | 동일한 404 |
| 검증 미완료·출처 충돌 | validation URL |
| workbook 적합성 실패 | files URL |
| MappingSet 재검증 필요 | files 또는 validation 중 서버가 지정한 route |
| valuation만 오래된 상태 | 화면 진입 허용, 기존 승인값을 `재계산 필요`로 표시하고 편집·재승인 유도 |

### 8.4 사용자 상태별 화면

| 상태 | 주 작업 영역 | 오른쪽 요약 | 하단 액션 |
|---|---|---|---|
| 초기 로딩 | 최종 크기 skeleton | skeleton | 비활성 |
| workbook 불러오는 중 | 파일명·버전 표시, grid skeleton | 이전 권위 결과가 있으면 읽기 전용 표시 | 비활성 |
| 편집 가능 | SpreadJS와 Target PER 입력 | 최신 서버 계산값 | 완료 조건에 따라 활성 |
| 계산 중 | 입력 셀의 pending 상태, 수식 결과는 이전 값 유지 | `계산 중` | `다음` 비활성 |
| 자동 저장 완료 | 최신 workbook version 표시 | 최신 권위 계산값 | 조건 충족 시 활성 |
| 계산 실패 | 실패 batch 원복, 셀별 오류 | 마지막 정상 결과와 오류 | 재시도 전 비활성 |
| stale version | 편집 잠금, 최신 버전 불러오기 | 기존 값은 참고용 | 새로고침 전 비활성 |
| 재검증 필요 | 영향 셀·원인 안내, 필요 시 validation 이동 | 승인 무효 표시 | 비활성 |
| 승인 완료 | 최신 승인값과 version 표시 | 목표주가·상승여력 확정 | `다음` 활성 |
| 보기 전용 | 승인 버전과 계산 경로 조회 | 확정 요약 | 허용된 이전·다음 route 이동 |

### 8.5 기본 PER 밸류에이션 흐름

```text
조사 결과 검증 완료
  → valuation 초기 데이터와 workbook 권한 조회
  → SpreadJS에 최신 작업 사본 로드
  → 미래 추정치 입력 셀 편집
  → cell delta를 서버에 전송
  → Aspose.Cells 작업 사본에 원자적 반영
  → 수식 재계산·오류·참조 무결성 검사
  → 영향 셀·Forward EPS·차트 delta 수신
  → Target PER 근거와 선택적 AI 제안 확인
  → Target PER 또는 목표주가 직접 입력
  → 서버가 Target PER 셀 기록·재계산
  → 목표주가·상승여력·민감도 확인
  → 최신 workbook version에 밸류에이션 승인 고정
  → 페이지 내용 설정으로 이동
```

두 탭의 역할은 다음과 같다.

1. `Forward EPS 계산`: 실제 workbook의 추정치 입력과 수식 결과 확인
2. `Target PER 설정`: Excel 기준값·근거와 사용자 판단을 구분해 최종 배수 승인

탭은 작업 순서를 설명하지만 2번 탭 진입 자체를 막지는 않는다. 다만 필수 입력 누락, 계산 중 또는 계산 실패 상태에서는 Target PER 승인과 다음 단계 이동을 막는다.

### 8.6 기존 디자인 재사용·수정·제거 판정

| 현재 영역 | 판정 | 구현 계약 |
|---|---|---|
| 상단 Process header | 재사용 | 프로젝트 route·Report 접근 가능 상태만 실제 데이터로 연결 |
| 왼쪽 7단계 sidebar | 재사용·수정 | 내부 step 번호가 아닌 서버 단계 상태와 실제 route 사용 |
| `STEP 06 / PER 밸류에이션` heading | 재사용 | 간결한 현재 문구 유지 |
| 2개 full-width 단계 탭 | 그대로 재사용 | 선택 underline, 원형 step marker, 키보드 tab 동작 보완 |
| 왼쪽 하나의 tabbed work card | 그대로 재사용 | 순차 카드를 하나의 공유 card에서 교체하는 구조 유지 |
| 가짜 workbook chrome | 형태 재사용 | 실제 파일명·sheet·range·연결·편집 가능 상태로 교체 |
| 정적 HTML forecast table | 제거·교체 | SpreadJS workbook surface로 교체 |
| 정적 HTML PER 비교 table | 제거·교체 | SpreadJS 읽기 전용 sheet·range 또는 서버 reference table로 교체 |
| FY25·FY26E·FY27E 하드코딩 기간 | 제거 | 실제 workbook의 기간·header·number format 표시 |
| 삼성전자 파일명·셀 주소 | 제거 | 프로젝트의 실제 workbook 이름·sheet·주소 표시 |
| 브라우저 `Number` 기반 EPS 계산 | 제거 | Aspose.Cells 서버 결과만 사용 |
| AI 제안 분리 카드 | 구조 재사용·조건부 노출 | 제안 version·근거가 있을 때만 표시, 자동 확정 금지 |
| AI 제안 카드의 별도 보라색 강조 | 수정 | `DESIGN.md`의 paper·soft·hairline과 REFLO lime 계층 안에서 분리 |
| Target PER boxed input | 그대로 재사용 | unit, focus, 서버 검증, 승인 상태 연결 |
| 목표주가 직접 입력 | 그대로 재사용 | 입력 mode와 역산 PER의 서버 동기화 계약 적용 |
| 오른쪽 sticky 요약 card | 그대로 재사용 | 목표주가를 최우선, 설명과 상승여력을 하위 계층으로 유지 |
| 계산식 card | 그대로 재사용 | raw·formatted 서버 결과로 교체 |
| full-width `민감도 표 보기` | 그대로 재사용 | 서버가 반환한 grid와 선택 cell 표시 |
| 민감도 modal | 재사용·보완 | focus trap, Escape, focus 복귀, mobile scroll 추가 |
| `자동 저장됨` | 수정 | 최신 서버 version 저장 성공일 때만 표시 |
| `임시 저장` | 제거 | 모든 변경 자동 저장 원칙과 중복되고 별도 제품 동작이 없음 |
| `다음` | 재사용·수정 | 최신 승인 version과 서버 완료 조건에 연결 |
| 하드코딩 86% 진행률 | 제거 | 완료된 7단계 수로 계산, valuation 진행 중은 5/7 완료 |
| valuation 다음의 숨은 EvidenceReview | 제거 | valuation에서 report-outline으로 직접 이동 |
| 중복 승인 badge·자동 재계산 helper | 제거 | 입력·계산·승인 상태를 필요한 위치에 한 번만 표시 |

현재 레이아웃의 큰 틀은 유지한다. 필수 구조 변경은 정적 표를 실제 SpreadJS로 교체하고, 선택 셀 정보와 계산·저장·오류 상태를 추가하는 범위다.

### 8.7 목표 컴포넌트 구성

| 컴포넌트 | 책임 | 주요 입력 | 주요 출력·이벤트 |
|---|---|---|---|
| `ValuationRoute` | 세션·소유권·선행 조건 확인, 초기 데이터 제공 | `projectId`, 세션 | redirect 또는 `ValuationPage` |
| `ValuationPage` | 탭·요약·modal·완료 상태 조정 | `ValuationWorkspace` | 단계 이동·승인 |
| `ProcessShell` | 공통 header, sidebar, bottom action bar | 프로젝트·단계 projection | 이전·다음 route 이동 |
| `ValuationStageTabs` | 계산·판단 탭 전환 | active tab | tab change |
| `WorkbookCard` | 실제 workbook chrome와 SpreadJS host | workbook descriptor | ready·load error |
| `SpreadWorkbook` | sheet·cell 표시, selection, 허용 셀 입력 | workbook snapshot, editable set | cell delta batch |
| `SelectedCellInfo` | 선택 셀 이름·주소·값·단위·기간·권한 사유 | selection metadata | 없음 |
| `CalculationStatus` | 계산 중·완료·실패·version 표시 | calculation run | retry |
| `PerReferencePanel` | 이전 보고서·Excel 기준값·원천 위치 | reference rows | source/range inspection |
| `AiPerProposal` | 선택적 AI 범위·근거 제안 | proposal version | draft에 제안값 적용 |
| `TargetPerDecision` | Target PER 입력·승인 | valuation draft | draft update·approve |
| `ValuationSummary` | 목표주가·상승여력·계산식 | 권위 계산 결과 | 목표주가 직접 입력 |
| `SensitivityDialog` | EPS×PER 시나리오 grid | sensitivity response | close |
| `ValuationErrorBoundary` | SpreadJS load·runtime 오류 격리 | error | reload·지원 정보 |

SpreadJS workbook instance는 React 전역 state로 복제하지 않는다. React는 workbook version, 선택 셀 metadata, 요청 상태, draft와 승인 상태만 관리한다.

### 8.8 화면 레이아웃과 반응형

#### Desktop

- 현재처럼 왼쪽 workbench와 오른쪽 valuation summary의 2열을 유지한다.
- 오른쪽 summary는 viewport 안에서 sticky로 유지하되 bottom action bar와 겹치지 않는다.
- SpreadJS host는 현재 workbook card 폭을 채우고, 최소 높이는 실제 행을 읽고 편집할 수 있는 수준으로 확보한다.
- workbook 내부 scroll과 페이지 scroll을 구분한다.

#### Tablet

- 약 1180px 이하에서 workbench와 summary를 한 열로 쌓는다.
- 탭은 두 열을 유지하되 label을 말줄임으로 숨기지 않는다.
- SpreadJS는 가로 scroll과 sheet tab scroll을 workbook 안에서 처리한다.

#### Mobile

- 제목, 탭, workbook, 선택 셀 정보, summary, 하단 액션 순서로 한 열 배치한다.
- SpreadJS host를 작은 HTML 표로 대체하지 않는다.
- 최소 44px interaction target을 유지하고 값·단위 글자를 축소해 억지로 한 행에 넣지 않는다.
- 민감도 grid는 modal 안에서 가로 scroll을 허용한다.
- 지원 가능한 최소 화면 폭과 SpreadJS mobile 편집 품질은 TD-010 확정 전환 검증에 포함한다.

### 8.9 SpreadJS 배치 범위

#### 배치한다

SpreadJS는 `Forward EPS 계산` 탭의 workbook 영역을 주 표시·입력 surface로 사용한다.

- 실제 보이는 sheet 이름과 순서
- row·column header
- cell grid
- name box와 formula bar
- 원본 row height·column width·number format·font·fill·border·alignment·merge
- freeze pane, hidden row·column, visible sheet 상태
- workbook 안의 지원 가능한 chart
- 선택 셀과 keyboard navigation
- TD-003·workflow 권한이 허용한 forecast assumption cell 입력
- typed copy·paste

`Target PER 설정` 탭에서는 같은 workbook의 valuation sheet와 관련 range를 읽기 전용으로 표시할 수 있다. 최종 Target PER 입력은 preference에 따라 근거 영역 뒤의 전용 boxed field에서 수행한다. 해당 입력은 서버에서 지정한 Target PER 원천 셀로 기록된다.

#### 배치하지 않는다

- 페이지 header와 sidebar
- AI 제안 card
- 목표주가·상승여력 summary
- 계산식 설명 card
- 민감도 modal
- 승인·다음 버튼
- 감사 이력 전체 화면

이 영역은 일반 React UI로 유지한다. spreadsheet가 아닌 판단·상태 UI를 SpreadJS cell로 만들지 않는다.

#### 로드·번들 규칙

- SpreadJS React와 Excel I/O module은 valuation route에서만 client-side dynamic import한다.
- server render 단계에서 workbook instance를 만들지 않는다.
- 사용하지 않는 Designer Ribbon, collaboration, AI, pivot add-on은 MVP bundle에 넣지 않는다.
- theme CSS는 route에서 필요한 범위로 로드하고 기존 REFLO shell을 덮어쓰지 않게 격리한다.
- production·staging hostname과 정확한 package version은 TD-010 라이선스·버전 정책을 따른다.

### 8.10 SpreadJS와 서버 데이터 동기화 계약

#### 8.10.1 초기 workbook 로드

```text
GET valuation workspace
  → originalWorkbookHash·workbookVersion·snapshotArtifact 확인
  → SpreadJS module 로드
  → 최신 작업 사본 snapshot import
  → workbookVersion과 snapshot version 일치 확인
  → server editableCellSet 적용
  → calculation mode를 manual로 설정
  → 편집 활성화
```

- 브라우저에 표시하는 workbook과 Aspose.Cells 세션은 같은 `originalWorkbookHash`에서 파생된 같은 `workbookVersion`이어야 한다.
- import 완료 전에는 편집하지 못한다.
- 브라우저는 노란 배경·파란 글씨를 다시 판정하지 않는다.
- 서버가 준 `editableCellSet`만 unlock하고 worksheet protection을 적용한다.
- 수식, 검증된 실제값, system 입력값, hidden system sheet와 현재 단계 미허용 셀은 잠근다.
- client protection은 UX 장치다. 실제 권한은 cell update API가 다시 검사한다.
- SpreadJS client formula calculation은 manual mode로 두고 권위 계산에 사용하지 않는다.

#### 8.10.2 입력 batch

단일 셀 입력과 multi-cell paste는 같은 batch delta를 사용한다.

```json
{
  "workbookVersion": 17,
  "editableCellSetVersion": 4,
  "requestId": "9d72b7a8-...",
  "changes": [
    {
      "sheetId": "sheet-forecast",
      "address": "K18",
      "valueType": "number",
      "value": "314200"
    }
  ]
}
```

규칙:

1. 값은 formatted text가 아니라 typed value로 전송한다.
2. decimal은 JSON number가 아니라 정규화된 decimal string으로 전송한다.
3. 빠른 연속 입력은 `150~250ms` 안에서 batch로 묶을 수 있다.
4. paste 대상에 잠긴 셀이 하나라도 있으면 전체 paste를 거절한다.
5. formula, format, merge, row·column, sheet와 chart 구조 변경은 전송하지 않는다.
6. pasted HTML·image·script·formula는 제거하거나 전체 요청을 거절한다.
7. client는 동일 request의 중복 전송에 같은 `requestId`를 사용한다.

#### 8.10.3 서버 적용

```text
세션·소유권 확인
  → expected workbookVersion 확인
  → editableCellSet 재검사
  → batch type·단위·범위 검증
  → Aspose.Cells 작업 사본에 batch 전체 적용
  → 수식 재계산
  → 수식 오류·순환참조·필수 출력·참조 무결성 검사
  → 성공 시 새 workbookVersion과 sparse delta 저장
  → 실패 시 batch 전체 원복
```

성공 응답은 최소 다음을 포함한다.

```json
{
  "workbookVersion": 18,
  "calculationRunId": "calc_01...",
  "appliedChanges": [
    {
      "sheetId": "sheet-forecast",
      "address": "K18",
      "valueType": "number",
      "rawValue": "314200",
      "formattedText": "314,200"
    }
  ],
  "affectedCells": [
    {
      "sheetId": "sheet-valuation",
      "address": "K42",
      "valueType": "number",
      "rawValue": "12401",
      "formattedText": "12,401원",
      "formulaError": null
    }
  ],
  "outputs": {
    "forwardEps": {
      "rawValue": "12401",
      "formattedText": "12,401원",
      "sourceCell": "sheet-valuation!K42"
    }
  },
  "affectedChartIds": [],
  "invalidatedResults": [
    "valuation_approval",
    "report_outline",
    "report_validation"
  ],
  "savedAt": "2026-07-24T12:00:00Z"
}
```

#### 8.10.4 client 반영

- 입력 cell은 pending 상태를 표시할 수 있지만 저장 성공으로 먼저 표시하지 않는다.
- 영향 수식 cell은 서버 응답 전까지 이전 권위값과 `계산 중` 상태를 유지한다.
- 응답은 request sequence와 workbook version이 최신일 때만 적용한다.
- sparse delta 적용 중 SpreadJS paint·event를 suspend하고 한 번에 갱신한다.
- 서버 실패 시 입력 batch 전체를 이전 권위값으로 되돌리고 해당 셀 가까이에 오류를 표시한다.
- `409 STALE_WORKBOOK_VERSION`이면 자동 병합하지 않고 최신 delta 적용 또는 snapshot reload를 요구한다.
- 계산 세션이 사라졌으면 서버가 최신 작업 사본으로 새 Aspose 세션을 복구한 뒤 재시도한다.

### 8.11 선택 셀 정보 계약

기준 문서에 있지만 현재 프로토타입에 없는 요소다. workbook chrome 또는 하단의 compact inspector에 다음을 표시한다.

| 필드 | 예 |
|---|---|
| sheet·주소 | `Forecast!K18` |
| 이름 정의 | `FY27_Revenue` 또는 `없음` |
| 역할 | `사용자 추정치`, `검증된 실제값`, `수식 결과`, `system 값` |
| raw·표시값 | `314200`, `314,200억원` |
| 수식 | 읽기 전용, 존재할 때만 |
| 단위 | 원, 천원, 백만원, 억원, %, 배 등 workbook metadata |
| 기간 | `FY27E`, `3Q26E` 등 실제 mapping metadata |
| 편집 상태 | `편집 가능` 또는 구체적인 읽기 전용 이유 |
| provenance | Evidence 또는 계산 경로가 있을 때 열기 |

셀 선택만으로 서버 요청을 매번 보내지 않는다. 초기 metadata와 현재 delta로 표시하고, 무거운 계산 경로나 Evidence 상세는 명시적 `근거 보기`에서 조회한다.

### 8.12 Target PER·목표주가 입력 계약

#### 입력 mode

`valuationInputMode`는 사용자가 마지막으로 직접 확정하려는 기준을 나타낸다.

| mode | 사용자가 고정하는 값 | 서버 동작 |
|---|---|---|
| `target_per` | Target PER | Target PER 원천 셀 기록 후 목표주가 재계산 |
| `target_price` | 목표주가 | 역산 PER 계산·Target PER 원천 셀 기록 후 workbook 목표주가 재계산 |

목표주가 직접 입력 mode에서도 formula 결과 cell을 값으로 덮어쓰지 않는다. 서버가 `입력 목표주가 ÷ Forward EPS`로 역산한 PER을 사용자 입력용 Target PER 셀에 기록하고 Aspose.Cells가 기존 목표주가 수식을 다시 계산한다.

workbook의 반올림 규칙 때문에 사용자가 입력한 목표주가와 재계산 결과가 다르면 서버 결과를 권위값으로 표시하고 차이를 입력 field 아래에 명확히 알린다.

#### Target PER field

| 속성 | 계약 |
|---|---|
| 의미 요소 | label이 연결된 text input |
| 접근성 이름 | `사용자 최종 승인 Target PER` |
| input mode | `decimal` |
| 표시 단위 | field 안의 `배` |
| 허용값 | 0보다 큰 decimal, UI 입력 소수 최대 2자리 |
| 저장값 | binary float가 아닌 canonical decimal string |
| 변경 시 | 기존 승인 무효화, draft update·서버 재계산 |
| 오류 위치 | field 바로 아래 |
| 승인 | 별도 `입력값 승인` action |

Target PER의 업무상 최소·최대 범위는 기준 문서에 없다. 임의의 `8~22배` 제한을 구현하지 않는다. 운영상 범위가 필요하면 별도 제품 결정으로 확정한다.

#### 목표주가 field

| 속성 | 계약 |
|---|---|
| 접근성 이름 | `사용자 목표주가` |
| input mode | `numeric` |
| 표시 단위 | field 안의 `원` |
| 허용값 | 0보다 큰 정수 KRW |
| 표시 | 천 단위 comma, font weight 700 |
| 변경 시 | `target_price` mode, 역산 PER·서버 재계산 |
| 오류 위치 | field 바로 아래 |

두 field는 서로 순환해서 client state를 덮어쓰지 않는다. 서버 응답의 `inputMode`, `targetPer`, `targetPrice`를 하나의 valuation draft version으로 적용한다.

### 8.13 계산식·단위·정밀도

#### 표시 계산식

```text
목표주가 = Forward EPS × Target PER
상승여력 = 목표주가 ÷ 현재주가 - 1
역산 PER = 사용자 입력 목표주가 ÷ Forward EPS
```

#### 권위값

| 값 | 권위 원천 |
|---|---|
| forecast 입력 | 서버가 승인한 typed cell value |
| Forward EPS | Aspose.Cells 재계산 완료 cell |
| Target PER | 사용자가 승인한 valuation draft와 연결된 Excel input cell |
| 목표주가 | Aspose.Cells의 mapped 목표주가 cell |
| 현재주가 | 기준일·시장·통화가 명시된 검증 KRX snapshot |
| 상승여력 | 서버 Decimal 계산 또는 workbook mapped 결과 |
| 민감도 값 | 서버 Decimal·Aspose 계산 결과 |

#### 정밀도 규칙

- JavaScript `Number`, `Math.round`와 SpreadJS formula 결과를 저장·승인·보고서 값으로 사용하지 않는다.
- API의 decimal raw value는 string으로 주고받는다.
- Excel 입력값의 단위와 소수 자릿수는 해당 cell의 number format과 metadata를 따른다.
- 화면은 서버가 반환한 `rawValue`와 `formattedText`를 분리한다.
- Forward EPS와 목표주가의 권위 반올림은 mapped workbook 수식과 number format을 따른다.
- 상승여력은 반올림 전 권위 목표주가와 현재주가로 계산하고 화면에는 소수 첫째 자리 `%`를 기본 표시한다.
- 역산 PER은 서버 내부에서 충분한 Decimal 정밀도로 계산하고 입력 field에는 소수 둘째 자리까지 표시한다.
- reference 값은 원 출처의 정밀도를 보존한다. 이전 보고서의 `14.2배`를 임의로 `14.20배`로 바꾸지 않는다.
- 서로 다른 단위의 셀을 UI에서 일괄 `억원`으로 표시하지 않는다.

현재 기술 결정 문서에는 Decimal library, rounding mode와 workbook number format이 없는 derived API 값의 fallback 반올림 방식이 없다. 구현 전에 TD-004 또는 별도 기술 결정에 이를 추가해야 한다. 그 전까지 workbook 계산값이 있는 지표는 workbook formatting을 우선한다.

### 8.14 민감도 표 계약

- modal은 `EPS × PER = 목표주가` 시나리오를 표로 표시한다.
- 행의 EPS와 열의 PER scenario는 서버 응답을 사용한다.
- 현재 승인 후보와 일치하는 cell을 deep green `#557909` text·border와 `#f4f9ea` 배경으로 표시한다.
- 현재 cell은 색 외에 `현재 입력값` 접근성 설명을 가진다.
- 각 cell은 목표주가 formatted text를 표시한다.
- 민감도 값을 선택해 Target PER을 바꾸는 동작은 MVP 기본 기능으로 추가하지 않는다.
- modal 오류는 Target PER 직접 입력과 승인을 막지 않는다.

현재 프로토타입의 고정 `14~18배`, 5개 EPS 행과 `±4%` 생성 규칙은 제품 기준이 아니다. scenario 개수, 간격과 범위는 서버 설정으로 반환해야 하며 정확한 생성 정책은 추가 제품 결정이 필요하다.

### 8.15 AI 제안 계약

AI 제안은 선택 기능이며 다음 조건을 만족할 때만 표시한다.

- 사용한 이전 PER, 실적 변화, 비교 자료와 Evidence ID가 있다.
- proposal version과 생성 시각이 있다.
- 입력 workbook version, 계산 run과 기준일이 명시돼 있다.
- 제안 배수 또는 범위와 짧은 이유가 구조화돼 있다.

`제안값 적용`은 Target PER draft를 채우고 서버 재계산을 실행할 뿐 승인하지 않는다. 사용자가 별도 승인해야 한다. AI 제안이 없거나 실패해도 사용자는 직접 Target PER을 입력해 완료할 수 있다.

기준 문서의 Agent 목록에는 Valuation Proposal Agent와 prompt·Pydantic schema가 정의돼 있지 않다. 별도 기술 결정 전에는 현재 하드코딩된 `16.0배`와 이유를 실제 AI 결과처럼 노출하지 않는다.

### 8.16 버튼·탭·modal UI 계약

| ID | 화면 요소 | 노출·활성 조건 | 동작 | 성공 결과 | 실패 처리 |
|---|---|---|---|---|---|
| VAL-TAB-01 | `Forward EPS 계산` | 항상 | 계산 탭 선택 | SpreadJS forecast 영역 | 없음 |
| VAL-TAB-02 | `Target PER 설정` | 항상 | 판단 탭 선택 | 기준값·제안·입력 영역 | 계산 미완료 시 승인 비활성 |
| VAL-BTN-01 | sheet tab | visible sheet만 | active sheet 변경 | 실제 sheet 표시 | load 오류 안내 |
| VAL-BTN-02 | `근거 보기` | selection에 provenance 존재 | Evidence·계산 경로 열기 | drawer 또는 전용 panel | 원문 오류와 재시도 |
| VAL-BTN-03 | `제안값 적용` | 유효 AI proposal 존재 | proposal 값을 draft에 적용 | 재계산 결과 표시 | draft 유지, 오류 |
| VAL-BTN-04 | `입력값 승인` | 최신 계산 성공, Target PER 유효 | 승인 version 생성 | `승인 완료` | 기존 draft 유지, 오류 |
| VAL-BTN-05 | `민감도 표 보기` | Forward EPS·PER 유효 | 서버 grid 조회·modal 열기 | modal 표시 | inline 재시도 |
| VAL-BTN-06 | 민감도 modal 닫기 | modal 열림 | modal 닫기 | 원래 버튼으로 focus 복귀 | 없음 |
| VAL-BTN-07 | `프로젝트로 돌아가기` | 항상 | `/projects` 이동 | 프로젝트 목록 | pending 입력은 저장 결과 확인 후 이동 |
| VAL-BTN-08 | sidebar 이전 단계 | 접근 가능 단계 | 실제 route 이동 | 해당 화면 | 서버 guard 처리 |
| VAL-BTN-09 | `다음` | 완료 조건 충족 | valuation 단계 완료 | report-outline URL | 현재 화면 유지·오류 |

탭은 `role="tablist"`, `role="tab"`, `aria-selected`, `aria-controls`, roving `tabIndex`를 사용한다. Left·Right arrow로 이동하고 선택된 panel에 연결한다.

민감도 modal은 제목 연결, focus trap, Escape, backdrop 닫기, body scroll lock과 focus 복귀를 제공한다. 서버 요청 중에는 중복으로 열지 않는다.

### 8.17 화면 데이터

#### 초기 서버 데이터

| 묶음 | 주요 필드 | 용도 |
|---|---|---|
| project | `projectId`, 기업, 대상 기간, 기준일, 단계 상태 | header·guard |
| workbook | `artifactId`, `originalWorkbookHash`, `workbookVersion`, 파일명, visible sheets | SpreadJS load |
| permissions | `editableCellSetVersion`, editable·required cells, read-only reasons | client UX·server 검증 |
| calculation | `calculationRunId`, status, outputs, formula errors | 요약·완료 조건 |
| selection metadata | sheet ID, cell address, name, role, unit, period, provenance | 선택 셀 정보 |
| references | 이전 보고서·Excel 기준값·source location | PER 근거 |
| current price | snapshot ID, 값, 통화, 기준시각, Evidence | 상승여력 |
| valuation draft | draft version, input mode, PER, 목표주가, 승인 상태 | 판단 입력 |
| AI proposal | optional proposal version·근거·값 | 선택적 제안 |
| completion | `canApprove`, `canComplete`, blocker codes | 버튼 상태 |

#### 정적 데이터

- 화면 제목과 짧은 설명
- 두 탭 이름
- 계산식 label
- 상태 code별 사용자 문구
- 버튼 label

기업명, workbook 파일명, sheet, 기간, 셀 주소, 수치, 현재주가, PER, 목표주가와 근거 문장은 정적 데이터가 아니다.

### 8.18 클라이언트 상태

| 상태 | 타입 | 설명 |
|---|---|---|
| `activeTab` | `excel \| decision` | 선택 탭 |
| `workbookLoadStatus` | `idle \| loading \| ready \| error` | SpreadJS import |
| `workbookVersion` | integer | 최신 서버 작업 사본 version |
| `editableCellSetVersion` | integer | 편집 권한 version |
| `pendingBatch` | cell delta batch 또는 null | 서버 확인 대기 입력 |
| `calculationStatus` | `idle \| calculating \| success \| error` | Aspose 계산 상태 |
| `selectedCell` | metadata 또는 null | inspector |
| `draft` | valuation draft | PER·목표주가 입력 mode |
| `approval` | approval summary 또는 null | 최신 승인 |
| `sensitivityStatus` | `closed \| loading \| open \| error` | modal |
| `pageError` | 정형 오류 또는 null | route-level 오류 |

SpreadJS cell matrix와 전체 workbook JSON을 React state에 저장하지 않는다.

### 8.19 API 계약

경로는 화면과 backend가 공유할 애플리케이션 계약이다. 구체적인 Next.js handler 또는 별도 backend framework는 미확정이다.

#### `GET /api/projects/{projectId}/valuation`

초기 workspace와 route guard를 조회한다.

성공 응답의 최소 구조:

```json
{
  "project": {
    "projectId": "prj_01...",
    "companyName": "리노공업",
    "targetPeriod": {
      "year": 2026,
      "quarter": 2
    },
    "cutoffDate": "2026-07-24",
    "cutoffAt": "2026-07-24T23:59:59+09:00"
  },
  "workbook": {
    "artifactId": "art_01...",
    "originalWorkbookHash": "sha256:...",
    "workbookVersion": 17,
    "displayName": "리노공업_2Q26_PER_Valuation_Model.xlsx",
    "snapshotUrl": "/api/projects/prj_01.../valuation/workbook?version=17",
    "visibleSheets": []
  },
  "permissions": {
    "editableCellSetVersion": 4,
    "editableCells": [],
    "requiredEditableCells": [],
    "readOnlyReasons": {}
  },
  "calculation": {
    "calculationRunId": "calc_01...",
    "status": "success",
    "forwardEps": {
      "rawValue": "12401",
      "formattedText": "12,401원",
      "sourceCell": "08_통합_EPS!D31"
    }
  },
  "valuationDraft": {
    "draftVersion": 7,
    "inputMode": "target_per",
    "targetPer": "14.2",
    "targetPrice": "176094",
    "approvedVersion": null
  },
  "completion": {
    "canApprove": true,
    "canComplete": false,
    "blockers": ["VALUATION_NOT_APPROVED"]
  }
}
```

#### `GET /api/projects/{projectId}/valuation/workbook?version={workbookVersion}`

- 소유권을 다시 확인한 뒤 해당 version의 작업 사본 snapshot을 반환한다.
- 응답은 SpreadJS가 import할 수 있는 검증된 XLSX 또는 별도 확정한 SJS 형식이다.
- object key와 저장소 credential을 노출하지 않는다.
- version이 최신 workspace descriptor와 다르면 `409 WORKBOOK_VERSION_MISMATCH`를 반환한다.
- client export 용도로 사용하지 않는다.

#### `PATCH /api/projects/{projectId}/valuation/workbook/cells`

8.10의 batch delta를 적용한다.

| 상태 코드 | 오류 code | 화면 처리 |
|---|---|---|
| `400` | `INVALID_CELL_VALUE` | 해당 cell·inspector 오류 |
| `400` | `FORMULA_INPUT_NOT_ALLOWED` | 전체 batch 원복 |
| `401` | `AUTH_REQUIRED` | 재로그인 후 최신 version reload |
| `404` | `PROJECT_NOT_FOUND` | 공통 404 |
| `409` | `STALE_WORKBOOK_VERSION` | 편집 잠금·최신 version 반영 |
| `409` | `EDITABLE_CELL_SET_CHANGED` | 권한·snapshot reload |
| `422` | `READ_ONLY_CELL` | 전체 paste·batch 거절 |
| `422` | `FORMULA_CALCULATION_FAILED` | 원복, 계산 오류 표시 |
| `422` | `CIRCULAR_REFERENCE` | 원복, 차단 |
| `429` | `RATE_LIMITED` | 입력 보존, 지연 재시도 |
| `503` | `CALCULATION_SESSION_UNAVAILABLE` | 세션 복구 후 재시도 |

#### `PUT /api/projects/{projectId}/valuation/draft`

Target PER 또는 목표주가 draft를 갱신하고 Aspose.Cells를 재계산한다.

```json
{
  "workbookVersion": 18,
  "draftVersion": 7,
  "requestId": "uuid",
  "inputMode": "target_per",
  "targetPer": "16.0"
}
```

성공 시 새 workbook version, draft version, 권위 Target PER·목표주가·상승여력, calculation run과 invalidated result 목록을 반환한다.

#### `POST /api/projects/{projectId}/valuation/approve`

최신 계산과 사용자 판단을 하나의 불변 승인 version으로 고정한다.
`Idempotency-Key` header를 필수로 사용한다. body의 `requestId`는 추적용이다.

```json
{
  "workbookVersion": 19,
  "draftVersion": 8,
  "calculationRunId": "calc_02...",
  "currentPriceSnapshotId": "snap_01...",
  "requestId": "uuid"
}
```

서버는 요청 version이 모두 최신인지, 필수 입력과 오류가 없는지 다시 검사한다. 성공 응답은 `valuationApprovalVersion`, 승인자, 승인시각, target PER, Forward EPS, 목표주가, 상승여력과 `canComplete`를 반환한다.

#### `POST /api/projects/{projectId}/valuation/sensitivity`

최신 workbook·draft version에 대한 sensitivity grid를 반환한다.

```json
{
  "workbookVersion": 19,
  "draftVersion": 8
}
```

응답은 EPS axis, PER axis, 각 cell의 raw·formatted 목표주가, 현재 cell 좌표와 생성 규칙 version을 포함한다.

#### `POST /api/projects/{projectId}/valuation/complete`

승인된 최신 version으로 valuation 단계를 완료한다.
`Idempotency-Key` header를 필수로 사용한다. body의 `requestId`는 추적용이며 중복 완료 방지의 권위값은 header다.

```json
{
  "valuationApprovalVersion": 3,
  "requestId": "uuid"
}
```

성공 응답:

```json
{
  "currentStage": "report_outline",
  "nextRoute": "/projects/prj_01.../process/report-outline"
}
```

같은 idempotency key 재전송은 한 번만 완료 처리한다. 완료 modal은 표시하지 않고 `nextRoute`로 직접 이동한다.

### 8.20 저장 모델과 감사 이력

#### 불변 artifact

- 업로드 원본 Excel
- valuation 진입 기준 작업 사본 snapshot
- 계산 checkpoint 작업 사본
- 최종 승인에 연결된 XLSX 작업 사본

원본은 수정하지 않는다. 최종 XLSX는 SpreadJS client export가 아니라 Aspose.Cells 작업 사본에서 생성한다.

#### PostgreSQL 최소 모델

| 모델 | 최소 필드 |
|---|---|
| `workbook_version` | project, original hash, artifact, structure hash, version, created at |
| `editable_cell_set` | workbook version, set version, sheet ID, address, role, required, read-only reason |
| `cell_change` | before·after typed value, user, request ID, workbook versions, changed at |
| `calculation_run` | input version, Aspose version, status, errors, result hash, duration |
| `valuation_draft` | draft version, input mode, PER, requested target price, workbook version |
| `valuation_approval` | approval version, calculation run, EPS, PER, 목표주가, current price snapshot, user, time |
| `stage_completion` | project, stage, approval version, completed at |

승인 레코드는 append-only다. 입력이나 상위 Evidence가 바뀌면 기존 승인을 수정하지 않고 `superseded`·`revalidation_required`로 표시한 뒤 새 승인 version을 만든다.

### 8.21 자동 저장·재계산·무효화

- 성공한 cell batch와 valuation draft update는 즉시 자동 저장한다.
- `자동 저장됨`은 서버가 반환한 version과 `savedAt`을 반영한 뒤에만 표시한다.
- 화면 이탈 전 pending batch가 있으면 짧게 완료를 기다리고, 실패하면 사용자가 입력 손실 여부를 알 수 있게 막는다.
- 계산 성공 전에는 결과·승인을 최신으로 표시하지 않는다.
- forecast 입력이 바뀌면 Forward EPS, Target PER 기반 목표주가, 상승여력, 민감도, valuation 승인, report outline과 report 검증이 무효화될 수 있다.
- Target PER만 바뀌면 목표주가·상승여력·민감도와 downstream 보고서 결과를 무효화한다.
- current price snapshot을 바꾸면 상승여력과 승인 version을 다시 계산·승인한다.
- 단순 selection·scroll·tab 이동은 저장 이벤트가 아니다.

### 8.22 완료 조건과 단계 이동

`다음`은 서버가 아래 조건을 모두 확인했을 때만 활성화한다.

- 최신 workbook snapshot이 정상 로드됐다.
- 모든 `requiredEditableCells`가 유효한 typed value를 가진다.
- pending cell batch가 없다.
- 최신 Aspose calculation run이 성공했다.
- 수식 오류, 순환참조, 합계 불일치와 참조 무결성 오류가 없다.
- Forward EPS 계산이 성공했고 PER 방식 적용 가능한 값이다.
- Target PER이 0보다 큰 값으로 확정됐다.
- 현재주가 snapshot이 유효하다.
- 최신 workbook·draft·calculation run에 연결된 valuation approval이 존재한다.
- MappingSet과 workbook structure hash가 유효하다.
- 하위 결과가 이미 존재하면 무효화 상태가 정상 기록됐다.

정상 이동:

```text
/projects/{projectId}/process/valuation
  → /projects/{projectId}/process/report-outline
```

valuation 뒤에 별도 Evidence Review 단계를 두지 않는다.

#### sidebar 이동

- 완료된 이전 단계는 실제 route link로 다시 열 수 있다.
- 아직 열 수 없는 미래 단계는 button처럼 보이더라도 비활성 상태와 이유를 제공한다.
- 이전 단계 수정으로 valuation이 무효화될 수 있음을 해당 화면의 저장 시점에 안내한다.
- valuation 완료 전 `Report`를 눌러 완성 보고서 화면으로 우회하지 못한다.
- 이미 보고서 초안이 존재하면 Report link는 열 수 있지만 stale 상태와 최신 승인 version 불일치를 report route가 다시 검사한다.

### 8.23 권한·보안 규칙

1. 모든 API는 세션 사용자와 project 소유자를 서버에서 다시 확인한다.
2. workbook version, editable set, cell role, formula 여부와 sheet identity를 서버가 검증한다.
3. formula, external link, DDE, macro와 임의 script를 browser 입력으로 추가할 수 없다.
4. 매크로는 실행하지 않는다.
5. paste HTML·image와 executable content를 저장하지 않는다.
6. snapshot URL은 짧은 수명과 project 범위를 가지며 object key를 권한으로 사용하지 않는다.
7. SpreadJS license key는 backend credential이나 권한 수단으로 사용하지 않는다.
8. 다른 사용자의 artifact ID, workbook version, request ID를 재사용해도 접근할 수 없다.
9. 오류 응답에 원본 object key, Google subject, stack trace와 worker 내부 경로를 노출하지 않는다.
10. 변경·승인·완료 request는 CSRF 방어와 idempotency를 적용한다.

### 8.24 로딩·빈 상태·오류·예외 처리

| 상황 | 사용자 화면 | 후속 동작 |
|---|---|---|
| SpreadJS module 로딩 | 최종 host 크기 skeleton | 준비 후 import |
| workbook import 실패 | 파일명·version·구체 오류와 `다시 불러오기` | 같은 snapshot 재시도 |
| editable cell 없음 | 읽기 전용 workbook과 원인 | 필수 입력이 없다면 PER 판단으로 진행 |
| 필수 입력 누락 | cell과 완료 blocker 표시 | 입력 대기 |
| 계산 중 | 이전 결과 유지, `계산 중` | 중복 승인 차단 |
| cell 검증 실패 | batch 원복, cell 오류 | 수정 후 재입력 |
| formula error·순환참조 | 계산 오류와 영향 cell | 다음 차단, files 또는 지원 안내 |
| stale workbook | grid 잠금, 최신 version 안내 | delta 적용 또는 reload |
| 계산 session 종료 | `계산 세션 복구 중` | 최신 checkpoint로 복구 |
| 네트워크 단절 | pending을 성공 처리하지 않음 | 연결 복구 후 재시도 또는 원복 |
| current price 없음 | 상승여력 `계산 불가` | snapshot 확보 전 승인 차단 |
| AI 제안 없음·실패 | 제안 card 숨김 또는 비차단 안내 | 직접 입력 가능 |
| 민감도 실패 | modal 안 오류·재시도 | approval은 유지 |
| 승인 version 충돌 | 최신 결과와 입력값 비교 | 재승인 |
| 세션 만료 | workbook 편집 잠금 | 재로그인 후 최신 version reload |
| 상위 결과 변경 | `재검증 필요` | server가 지정한 해결 route |

가짜 workbook·샘플 숫자로 오류 상태를 채우지 않는다.

### 8.25 접근성 계약

- 모든 일반 action은 실제 `button` 또는 `a`를 사용한다.
- Target PER·목표주가 input은 visible label 또는 명확한 접근성 이름과 field 단위가 있다.
- 상태는 색만으로 전달하지 않고 `편집 가능`, `읽기 전용`, `계산 중`, `승인 완료` 문구를 제공한다.
- workbook host에는 용도와 기본 keyboard 사용법을 간단히 제공한다.
- SpreadJS의 keyboard navigation과 accessibility option을 목표 browser에서 검증한다.
- 선택 셀 정보는 screen reader가 주소·역할·값·단위를 읽을 수 있어야 한다.
- 계산 완료·실패는 과도하게 반복되지 않는 `aria-live` 영역으로 알린다.
- modal focus trap과 닫기 후 focus 복귀를 보장한다.
- horizontal scroll 영역은 keyboard focus가 가능하고 scroll 가능함을 접근성 이름으로 설명한다.
- `prefers-reduced-motion`에서는 tab·modal transition을 즉시 전환한다.

### 8.26 화면에 들어가는 기술과 들어가면 안 되는 기술

| 기술·영역 | valuation에서의 위치 | 판단 |
|---|---|---|
| Next.js App Router | 보호 route·초기 server data·redirect | 사용 |
| React Client Component | tabs, summary, dialog, request 상태 | 사용 |
| SpreadJS React | 실제 workbook 표시·허용 셀 입력 | 사용 |
| SpreadJS Excel I/O | 최신 작업 사본 import | 사용 |
| Aspose.Cells for .NET | 권위 재계산·검증·XLSX 저장 | backend 사용 |
| PostgreSQL | version·delta·calculation·approval·감사 | 사용 |
| S3 호환 저장소 | 원본·작업 사본 snapshot | backend 사용 |
| Temporal | 긴 checkpoint·복구 작업이 필요할 때 | backend 간접 사용 |
| TD-005 MappingSet | EPS·PER·목표주가 cell·PDF slot 연결 | 사용 |
| Evidence·provenance | current price·PER 근거·계산 경로 | 사용 |
| PydanticAI | 선택적 PER 제안 | 새 결정 전 필수 경로에서 사용 금지 |
| SpreadJS client export | 최종 XLSX | 사용 금지 |
| browser formula engine | 권위 계산 | 사용 금지 |
| HTML data table | 실제 workbook 대체 | 사용 금지 |
| PDF 워커 | valuation 화면 계산 | 호출하지 않음 |

### 8.27 현재 프로토타입과 목표 구현의 차이

| 현재 프로토타입 | 목표 구현 | 우선순위 |
|---|---|---|
| route가 공용 `app/page.tsx` 재노출 | valuation 전용 보호 route·data boundary | 구현 품질 |
| `baseline-project`·`new` 허용 | 실제 project ID와 소유권 guard | 필수 |
| 삼성전자 파일명·고정 sheet·cell | 실제 workbook metadata | 필수 |
| HTML table을 Excel처럼 표시 | SpreadJS 실제 workbook | 필수 |
| 세 개 forecast row만 편집 | server `editableCellSet` 전체 중 현재 단계 허용 셀 | 필수 |
| 모든 forecast 값이 `억원` | cell별 실제 단위·format | 필수 |
| React state가 workbook 값 소유 | SpreadJS instance + server version | 필수 |
| 브라우저 `Number`와 고정 비율로 EPS 계산 | Aspose.Cells 권위 수식 | 필수 |
| 현재주가 `165000` 하드코딩 | 검증 KRX snapshot | 필수 |
| 이전 PER 14.2·기준 15.0·AI 16.0 하드코딩 | versioned reference·optional proposal | 필수 |
| Target PER 범위를 UI `8~22`로 암묵 제한 | 별도 결정 전 positive decimal만 검증 | 필수 |
| 목표주가 client 직접 반올림 | workbook·server Decimal 결과 | 필수 |
| 저장·API·오류 없음 | batch delta·자동 저장·원복·version conflict | 필수 |
| 승인 state가 local boolean | 불변 approval version | 필수 |
| `다음`이 항상 활성 | 서버 완료 조건 | 필수 |
| 진행 중 valuation이 86% | 완료 단계 기준 5/7 표시 | 필수 |
| 임시 저장 버튼 | 성공 자동 저장 status만 유지 | 필수 |
| 숨은 EvidenceReview internal step | report-outline 직접 이동 | 필수 |
| selected cell metadata 없음 | compact cell inspector | 필수 |
| static 5×5 sensitivity | 서버 scenario grid | 필수 |
| 기존 테스트는 direct route·screenshot만 확인 | 권한·계산·저장·충돌·접근성 통합 테스트 | 필수 |

### 8.28 누락 요소와 추가·제거 기능

#### 추가한다

- 실제 선택 셀 정보와 읽기 전용 이유
- workbook load·계산·저장 version 상태
- 계산 실패 시 cell별 오류와 batch 원복
- current price snapshot의 기준시각·출처
- approval version과 최신 계산 연결
- stale workbook 복구
- `다시 불러오기`, 문맥별 `다시 시도`
- formula·Evidence 계산 경로 열기

#### 기존 요소에 실제 기능을 연결한다

- 두 valuation 탭
- workbook sheet tab
- forecast 입력 cell
- AI 제안 적용
- Target PER 입력·승인
- 목표주가 직접 입력
- 민감도 표
- 자동 저장 status
- 다음 단계 이동

#### 제거한다

- 동작이 없는 임시 저장
- 하드코딩 회사·기간·파일·cell·수치
- 브라우저 권위 계산
- 중복 승인 badge와 자동 계산 helper
- valuation 뒤 EvidenceReview 단계
- 아무 동작 없는 Report 우회

#### 이번 MVP에 추가하지 않는다

- workbook formula·format·sheet 구조 편집
- 목표주가 formula cell 직접 덮어쓰기
- 민감도 cell 클릭으로 즉시 승인
- 비교기업 peer multiple 자동 선택
- 실시간 공동 편집
- SpreadJS client XLSX export
- PBR·EV/EBITDA·DCF 전환

### 8.29 구현 순서

1. TD-010의 SpreadJS 라이선스·package version과 배포 hostname 범위를 확정한다.
2. valuation 전용 route guard와 초기 workspace API를 구현한다.
3. workbook snapshot·editable cell·selection metadata 계약을 Aspose 분석 결과와 연결한다.
4. SpreadJS를 route 전용 dynamic import로 배치하고 실제 작업 사본을 불러온다.
5. server editable set을 SpreadJS protection과 cell UX에 투영한다.
6. batch cell delta, Aspose calculation session, sparse response와 원복을 구현한다.
7. Forward EPS·current price·reference row를 실제 versioned 데이터로 교체한다.
8. Target PER·목표주가 input mode와 draft update API를 구현한다.
9. AI proposal은 별도 schema가 확정된 경우에만 연결한다.
10. sensitivity server 계산과 modal을 연결한다.
11. valuation approval과 stage complete API를 구현한다.
12. auto-save status, stale version, 오류·복구·접근성을 검증한다.
13. current React UI와 screenshot 기준으로 시각 회귀를 수행하되 fake Excel 표는 기준에서 제외한다.

### 8.30 완료 조건

- [ ] 로그인한 프로젝트 소유자만 valuation을 조회·수정할 수 있다.
- [ ] 다른 사용자 프로젝트는 동일 404로 처리된다.
- [ ] validation 선행 조건을 우회해 편집할 수 없다.
- [ ] 실제 workbook 파일명, visible sheet와 기간·cell format이 표시된다.
- [ ] 가짜 HTML 표가 실제 SpreadJS workbook으로 교체된다.
- [ ] server editable set에 포함된 현재 단계 셀만 편집할 수 있다.
- [ ] 수식·실제값·system cell·hidden sheet·workbook 구조는 수정할 수 없다.
- [ ] multi-cell paste가 잠긴 셀을 포함하면 전체가 거절된다.
- [ ] client formula 결과가 권위값·PDF·최종 XLSX에 사용되지 않는다.
- [ ] cell 입력은 versioned batch로 Aspose.Cells에 반영된다.
- [ ] 계산 성공 시 sparse cell·chart·Forward EPS delta가 화면에 반영된다.
- [ ] 계산 실패 시 batch 전체가 이전 값으로 원복된다.
- [ ] stale·중복·out-of-order 응답이 최신 화면을 덮어쓰지 않는다.
- [ ] 선택 셀의 주소, 값, 단위, 기간, 역할과 provenance를 확인할 수 있다.
- [ ] Target PER은 사용자가 직접 입력·승인한다.
- [ ] AI 제안 적용이 자동 승인을 만들지 않는다.
- [ ] 목표주가 직접 입력은 formula cell을 덮어쓰지 않고 역산 PER을 통해 재계산된다.
- [ ] Forward EPS·Target PER·목표주가·현재주가·상승여력의 권위 원천이 구분된다.
- [ ] 모든 decimal 계산이 binary float가 아닌 서버 Decimal·Aspose 결과를 사용한다.
- [ ] 민감도 grid는 서버 scenario와 권위 계산값을 표시한다.
- [ ] 원본 Excel은 변경되지 않고 프로젝트 작업 사본과 변경 이력이 남는다.
- [ ] 최신 workbook·draft·calculation run에 연결된 approval version이 생성된다.
- [ ] `다음`은 모든 blocker가 해결됐을 때만 활성화된다.
- [ ] 완료 시 modal 없이 report-outline URL로 직접 이동한다.
- [ ] valuation 뒤 별도 EvidenceReview 단계가 없다.
- [ ] pending 입력·오류·세션 만료 상태에서 입력 손실을 성공처럼 표시하지 않는다.
- [ ] keyboard로 tab, workbook, 입력, 승인, 민감도 modal과 다음 이동을 사용할 수 있다.
- [ ] mobile·tablet에서도 값과 단위를 읽고 workbook을 조작할 수 있다.
- [ ] 최종 XLSX는 SpreadJS export가 아니라 Aspose.Cells 작업 사본에서 생성된다.

### 8.31 자동 테스트 시나리오

| 종류 | 시나리오 |
|---|---|
| E2E | 소유자가 valuation URL에 직접 진입하고 실제 workbook을 본다 |
| E2E | 비로그인 direct URL이 로그인 후 같은 URL로 복귀한다 |
| E2E | validation 미완료 프로젝트가 해결 route로 이동한다 |
| E2E | forecast cell 입력 후 계산 중·저장 완료·Forward EPS 갱신 |
| E2E | Target PER 입력·승인 후 목표주가·상승여력 갱신 |
| E2E | 목표주가 직접 입력 후 역산 PER과 workbook 목표주가 동기화 |
| E2E | 민감도 modal 열기·닫기·현재 cell 확인 |
| E2E | 최신 승인 완료 후 report-outline URL 직접 이동 |
| E2E | mobile에서 sheet 이동·cell 입력·summary 확인 |
| 통합 | XLSX snapshot original hash와 Aspose session hash 일치 |
| 통합 | TD-003 style 판정과 workflow editable set 교집합 |
| 통합 | 단일 cell·multi-cell paste의 원자적 적용 |
| 통합 | 보호 cell 포함 paste 전체 거절 |
| 통합 | Aspose sparse delta가 SpreadJS displayed value와 일치 |
| 통합 | calculation failure 시 workbook version과 값 원복 |
| 통합 | stale version·중복 request·out-of-order response 처리 |
| 통합 | session 손실 후 최신 checkpoint 복구 |
| 통합 | forecast 변경 시 valuation·outline·report 결과 무효화 |
| 통합 | approval이 정확한 workbook·draft·run·price snapshot을 고정 |
| 단위 | decimal string parsing, 음수·0·빈 값·소수 scale 검증 |
| 단위 | 목표주가·상승여력·역산 PER 계산과 표시 precision |
| 단위 | cell별 원·천원·백만원·억원·%·배 format |
| 보안 | 다른 owner의 project·artifact·workbook version 접근 거부 |
| 보안 | 위조 editable flag·formula result·owner ID 무시 |
| 보안 | formula·DDE·external link·macro·HTML·image paste 차단 |
| 보안 | snapshot URL scope·만료·object key 비노출 |
| 접근성 | valuation tab arrow navigation과 panel 연결 |
| 접근성 | input label·unit·오류·계산 status 안내 |
| 접근성 | SpreadJS keyboard navigation과 선택 셀 정보 읽기 |
| 접근성 | 민감도 modal focus trap·Escape·focus 복귀 |
| 성능 | 기준 12-sheet workbook 최초 표시 시간과 peak memory |
| 성능 | 3배 stress workbook scroll·selection·input latency |
| 성능 | input-to-authoritative-result p50·p95 |
| 시각 회귀 | 기존 2열 workbench·tab·summary·bottom bar 보존 |
| 시각 회귀 | 선택 민감도 cell의 `#557909`·`#f4f9ea` 상태 |

### 8.32 아직 필요한 제품·기술 결정

다음 항목은 두 기준 문서에 없거나 TD-010의 확정 전환 조건에 남아 있다.

1. SpreadJS 정확한 package version, 상용·SaaS 라이선스와 production·staging hostname 범위
2. Next.js에서 workbook snapshot을 XLSX로 직접 전달할지 SJS·server-converted format으로 전달할지
3. Target PER 업무상 최소·최대 범위와 입력 소수 자릿수의 최종 운영 정책
4. derived Decimal 값의 rounding mode와 workbook format이 없을 때의 fallback
5. 민감도 EPS·PER axis의 개수·간격·범위 생성 규칙
6. Valuation AI proposal의 Agent 책임, Pydantic output schema, prompt version과 근거 최소 요건
7. 현재주가 snapshot의 정확한 기준시점과 사용자가 수동 갱신할 수 있는지
8. Aspose calculation session의 유휴 checkpoint·해제 시간
9. SpreadJS import 호환성 차이가 진행 차단인지 경고인지 정하는 feature별 표
10. mobile 최소 지원 폭과 SpreadJS 편집 품질 기준

이 항목이 미확정이어도 다음 불변조건은 바뀌지 않는다.

- 사용자가 추정치·Target PER·목표주가를 확정한다.
- SpreadJS는 표시·입력 UI다.
- Aspose.Cells가 유일한 계산·검증·저장 권위다.
- 원본 Excel은 수정하지 않는다.
- formula와 검증된 실제값은 보호한다.
- AI 제안은 선택 사항이며 자동 승인되지 않는다.
- valuation 완료 후 report-outline으로 직접 이동한다.
