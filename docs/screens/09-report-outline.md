# REFLO 화면 구현 명세: `/projects/:projectId/process/report-outline` 페이지 내용 설정

**문서 상태:** 페이지 내용 설정 명세 작성 완료
**작성일:** 2026-07-24
**대상:** 현업 배포용 MVP
**상위 문서:** [`REFLO_SCREEN_IMPLEMENTATION_SPEC_v1.md`](../REFLO_SCREEN_IMPLEMENTATION_SPEC_v1.md)
**기준 문서:** [`REFLO_URL_SERVICE_BEHAVIOR_v1.md`](../REFLO_URL_SERVICE_BEHAVIOR_v1.md), [`REFLO_TECHNICAL_DECISIONS_v1.md`](../REFLO_TECHNICAL_DECISIONS_v1.md)

## 1. `/projects/:projectId/process/report-outline` — 페이지 내용 설정

### 1.1 명세 상태

| 항목 | 값 |
|---|---|
| URL | `/projects/:projectId/process/report-outline` |
| 접근 권한 | 로그인한 프로젝트 소유자만 |
| 워크플로 위치 | 7단계 중 7단계 |
| 주요 목적 | 업로드 PDF의 페이지·블록 구조를 유지한 채 새 보고서의 제목, 본문 방향, 판단, 근거와 표·차트 연결을 확인·승인 |
| 현재 route 파일 | `source-react/app/projects/[projectId]/process/report-outline/page.tsx` |
| 현재 실제 화면 파일 | `source-react/app/page.tsx`, `source-react/app/process.tsx`, `source-react/app/globals.css` |
| 현재 주요 컴포넌트 | `Home`, `PlannedProcessPage`, `FinalDecision`, `ScreenHead`, `EvidenceDrawer` |
| 기준 요구사항 | 서비스 동작 명세 2장, 3장, 5장, 14장, 15장, 16장, 19장 |
| 관련 기술 결정 | TD-001, TD-002, TD-005~TD-008, TD-011, TD-012, TD-014~TD-017 |
| 구현 상태 | route만 분리되어 있고 화면·데이터·저장은 공용 Client Component의 하드코딩 프로토타입 |

### 1.2 판단 우선순위

이 화면에서는 다음 순서를 적용한다.

1. 서비스 동작 명세의 원본 PDF 페이지 수·구조 유지, 검증된 데이터만 사용, 페이지별 승인 조건
2. 기술 결정의 Template IR, MappingSet, Evidence version, 불변 산출물과 작업 오케스트레이션
3. 현재 React 화면의 레이아웃, 아코디언, 우측 근거 패널과 시각 표현
4. 현재 하드코딩된 4페이지 구성, 샘플 문구, 페이지 추가와 생성 방식 선택

따라서 현재 UI의 4페이지와 표·차트 개수는 특정 프로토타입의 표시 예시일 뿐 서비스 전역 규칙이 아니다. 실제 페이지 수, 순서, 고정·변경 블록과 표·차트 슬롯은 업로드 PDF에서 확정된 Template IR이 권위값이다.

## 2. 화면 목적과 책임

이 화면은 밸류에이션까지 확정된 프로젝트를 실제 보고서 초안으로 넘기기 전 마지막 구성 승인 단계다.

사용자는 다음을 수행한다.

1. 원본 PDF와 동일한 페이지 순서와 블록 구성을 확인한다.
2. Report Outline Agent가 제안한 리포트 제목·본문 방향·목표주가 판단을 검토하고 수정한다.
3. 각 블록에 연결된 검증 Evidence와 Excel 값을 확인한다.
4. 표·차트가 승인된 MappingSet의 Excel 범위와 연결되었는지 확인한다.
5. 페이지별 구성을 확인한 뒤 전체 구성을 승인하고 보고서 초안 생성을 시작한다.

이 화면은 다음을 수행하지 않는다.

- PDF 페이지 수, 페이지 크기, 고정 디자인이나 블록 좌표 변경
- Excel 셀 값·수식·Target PER 수정
- 검증되지 않은 Evidence 선택
- 출처 충돌 해결
- 보고서 최종 문장 편집과 최종 승인
- PDF·Excel 내보내기

Excel 값 변경은 밸류에이션 화면, 출처 충돌과 Evidence 검증은 검증 화면, 최종 문장 수정은 보고서 편집 화면이 담당한다.

## 3. 접근 권한과 진입 조건

### 3.1 접근 권한

- 검증된 Google 로그인 세션이 필요하다.
- 프로젝트의 `owner_google_user_id`가 세션 사용자와 일치해야 한다.
- 클라이언트가 보낸 사용자 ID, 소유자 ID 또는 페이지 구성 version은 권한 근거로 사용하지 않는다.
- 다른 사용자의 프로젝트는 존재 여부를 추측할 수 없도록 `404`와 같은 일반 응답으로 처리한다.

### 3.2 정상 진입 조건

다음 항목이 모두 유효해야 편집 가능한 화면으로 진입한다.

| 선행 항목 | 요구 상태 |
|---|---|
| 프로젝트 설정 | 완료 |
| PDF·Excel 적합성 검사 | 완료 |
| PDF Template IR | 확정된 version 존재 |
| PDF↔Excel MappingSet | `confirmed`, 필수 slot 미매핑 0건 |
| 투자 가설·조사 질문 | 승인 version 존재 |
| 조사 결과 검증 | 필수 Evidence 검증 완료 |
| 출처 충돌 | 미해결 0건 |
| Excel 실제값 | 원문 연결과 계산 검증 완료 |
| 밸류에이션 | Forward EPS 계산 성공, Target PER·목표주가 사용자 확정 |
| 하위 결과 유효성 | `revalidation_required`가 아님 |

### 3.3 직접 URL 진입

| 상황 | 동작 |
|---|---|
| 비로그인 | Google 로그인 후 원래 report-outline URL로 복귀 |
| 소유권 없음 | 일반 `404` 화면 |
| 존재하지 않는 `projectId` | 일반 `404` 화면 |
| 선행 단계 미완료 | 데이터를 보여주지 않고 필요한 단계와 이동 CTA 표시 |
| 선행 데이터 재검증 필요 | 마지막 저장 outline을 읽기 전용으로 보이고 재검증 필요 배너 표시 |
| outline 생성 작업 진행 중 | 진행 상태를 복구해 표시 |
| 이미 초안 생성 완료 | 승인된 outline 요약과 `보고서 열기` CTA 표시 |

선행 단계 미완료 응답은 `requiredStage`, `resumeRoute`, `reasonCode`를 서버가 반환한다. 클라이언트가 현재 단계를 임의 계산하지 않는다.

## 4. 이탈 조건과 URL 이동

| 동작 | 조건 | 이동·결과 |
|---|---|---|
| `프로젝트로 돌아가기` | 항상 | 저장을 먼저 flush한 뒤 `/projects` |
| 사이드바 이전 단계 | 해당 단계 접근 가능 | 저장을 flush한 뒤 선택한 process URL |
| 브라우저 뒤로가기 | 항상 | 저장된 변경은 유지, 미전송 변경은 전송 시도 |
| `PER 밸류에이션` 이동 | 항상 | `/projects/{projectId}/process/valuation` |
| `Report` 상단 탭 | 초안 생성 완료일 때만 활성 | `/projects/{projectId}/report` |
| 전체 구성 승인 | 모든 완료 조건 충족 | 승인 version 고정, 보고서 초안 생성 시작 |
| 초안 생성 완료 | 서버 작업 성공 | `/projects/{projectId}/report` 이동 가능 |

초안 생성 작업은 화면을 벗어나도 계속된다. 사용자는 프로젝트 목록에서 생성 진행률과 실패 상태를 확인할 수 있다.

## 5. 사용자 상태별 화면

| 상태 | 화면 |
|---|---|
| `loading` | 최종 레이아웃과 같은 크기의 헤더·페이지 아코디언·근거 패널 skeleton |
| `ready` | 페이지 구성 편집, Evidence·시각 요소 확인, 페이지별 확인 가능 |
| `dirty` | 저장 상태 `변경사항 저장 중` |
| `saving` | 입력은 유지하며 저장 상태 spinner 표시 |
| `saved` | 서버 저장 시각과 `자동 저장됨` 표시 |
| `save_error` | 입력 유지, `저장하지 못했습니다`와 재시도 |
| `version_conflict` | 편집 중지, 최신 version 다시 불러오기 안내 |
| `revalidation_required` | 읽기 전용 outline과 무효화 사유·복귀 단계 표시 |
| `outline_generation_running` | Agent 제안 생성 진행률과 화면 이탈 가능 안내 |
| `outline_generation_failed` | 기존 유효 version이 있으면 유지하고 재시도 |
| `approval_blocked` | 미완료 페이지·필수 slot·연결 오류를 페이지별로 표시 |
| `draft_generation_running` | 승인 version, 작업 단계와 진행률 표시 |
| `draft_generation_failed` | 승인 version을 유지하고 재시도·오류 상세 제공 |
| `draft_ready` | 생성 완료 요약과 `보고서 열기` CTA |

## 6. 기본 사용자 흐름

```text
report-outline 진입
  → 세션·소유권·선행 단계 확인
  → Template IR·MappingSet·Evidence·밸류에이션 version 고정
  → 저장된 outline 또는 Report Outline Agent 제안 로드
  → 원본 PDF 순서의 페이지 아코디언 표시
  → 제목·본문 방향·목표주가 판단 검토·수정
  → 각 페이지의 Evidence와 표·차트 연결 확인
  → 페이지별 확인
  → 전체 구성 승인
  → 승인 version 고정
  → ReportWorkflow로 보고서 초안 생성
  → 생성 완료 후 /projects/{projectId}/report
```

### 6.1 최초 진입

저장된 outline version이 없으면 Report Outline Agent 작업을 시작한다. Agent는 다음 확정 version만 입력으로 받는다.

- Template IR
- MappingSet
- Excel 계산 결과
- 검증된 Evidence
- 사용한 컨센서스 snapshot
- 잠정 투자의견과 투자 가설
- 사용자 확정 Target PER·목표주가

Agent는 원본 레이아웃을 변경하거나 새로운 숫자·출처를 만들 수 없다.

### 6.2 재진입

- 마지막 저장 version을 복구한다.
- 열린 아코디언 같은 일시적 UI 상태보다 서버에 저장된 내용이 우선한다.
- 새 Evidence 또는 상위 version이 생겨도 기존 outline을 자동 덮어쓰지 않는다.
- 입력 version이 바뀌면 기존 outline을 `재검증 필요`로 표시하고 사용자가 기준을 다시 생성하도록 한다.

## 7. 페이지 구조 규칙

### 7.1 권위 페이지 구조

- `pages`는 Template IR의 실제 페이지 순서를 그대로 사용한다.
- 페이지 번호와 페이지 수를 추가·삭제·재정렬하지 않는다.
- 고정 디자인·고지 전용 페이지도 목록에서 숨기지 않는다.
- 변경 가능한 block이 없는 페이지는 `고정 페이지`로 표시하고 구성요소를 읽기 전용으로 보여준다.
- 원본의 페이지 크기, 방향, 여백, 고정 자산과 slot 좌표는 이 화면에서 수정할 수 없다.

현재 프로토타입의 4페이지는 고정 계약이 아니다. 기준 표본처럼 원본 PDF가 5페이지라면 5페이지 모두 표시하되, 고정 회사정보·인증 페이지는 읽기 전용일 수 있다.

### 7.2 페이지 아코디언

- 한 페이지를 기본 확장하고 나머지는 접는다.
- 같은 페이지 헤더를 다시 누르면 접을 수 있다.
- 페이지 헤더에는 두 자리 페이지 번호, 페이지 역할, 대표 제목, 확인 상태를 표시한다.
- 확장 상태는 `aria-expanded`, 패널은 `aria-labelledby`로 연결한다.
- 위·아래 방향키로 페이지 헤더 간 이동하고 Enter 또는 Space로 토글할 수 있다.
- 오류가 있는 페이지에는 색상 외에 `연결 필요`, `확인 필요` 텍스트를 함께 표시한다.

### 7.3 섹션 추가·삭제·순서 변경

MVP에서 페이지와 section 구조는 원본 PDF Template IR의 계약이므로 다음 동작을 제공하지 않는다.

| 동작 | MVP 계약 |
|---|---|
| 페이지 추가 | 제공하지 않음 |
| 페이지 삭제 | 제공하지 않음 |
| 페이지 순서 변경 | 제공하지 않음 |
| 고정 section 추가·삭제 | 제공하지 않음 |
| section 순서 변경 | 제공하지 않음 |
| 표·차트 slot 추가·삭제·순서 변경 | 제공하지 않음 |

따라서 현재 프로토타입의 `＋ 페이지 추가`는 제거한다. 드래그 핸들, 위·아래 정렬 버튼, 삭제 버튼도 표시하지 않는다.

원본 PDF 분석 결과에 선택 가능한 대체 slot이나 optional block 개념을 도입하려면 Template IR schema, 렌더링 검증과 사용자 승인 규칙을 별도 기술 결정으로 확정해야 한다. 그 전에는 클라이언트 UI만으로 구조를 변경하지 않는다.

## 8. 페이지별 내용 설정

### 8.1 공통 표시 순서

확장된 페이지는 다음 순서로 표시한다.

1. 페이지의 고정 역할과 변경 가능한 block 요약
2. 제목·본문 방향·사용자 판단 입력
3. 연결된 표·차트 slot 미리보기
4. 페이지에 배치된 Evidence 요약
5. 검증·연결 오류
6. `이 페이지 확인` 액션

반복 안내문과 이미 페이지 헤더에 있는 제목·개수는 다시 표시하지 않는다.

### 8.2 Page 1 핵심 내용

현재 UI의 낮은 소음도와 행형 입력 구조를 유지한다. 별도 설명 카드 없이 다음 핵심 행을 표시한다.

| 행 | 표시 라벨 | 편집 계약 |
|---|---|---|
| 01 | `리포트 제목 :` | Agent 제안을 한 줄에서 수정 |
| 02 | `본문 1_기업 리뷰 :` | 실적 Review의 한 줄 핵심 방향 수정 |
| 03 | `본문 2_기업 전망 :` | 전망의 한 줄 핵심 방향 수정 |
| 04 | `본문 3_목표주가 :` | `유지`, `상향`, `하향` 선택과 한 줄 근거 입력 |

서비스 기준 문서는 제목·소제목 수정을 요구하고 디자인 보정 로그는 별도 제목 입력과 핵심 포인트 입력의 중복을 제거하도록 요구한다. 이를 한 행의 한 줄 값 하나로 통합한다. 이 값이 사용자에게는 제목·본문 방향 수정값이고 Report Draft Agent에는 해당 block의 작성 기준이 된다. 목표주가 행만 방향 selector와 한 줄 근거를 함께 사용한다.

라벨은 section 번호와 주제를 underscore로 연결하고 콜론으로 끝낸다. 예: `본문 1_기업 리뷰 :`.

### 8.3 Page 2 이후

- 페이지의 제목·작성 기준을 임의로 입력하는 자유 형식 필드는 제공하지 않는다.
- Template IR이 정의한 block 이름과 시각 요소를 읽기 전용으로 표시한다.
- 변경 가능한 narrative slot이 실제 원본에 있을 때만 한 줄 작성 방향 입력을 표시한다.
- 표·차트만 있는 페이지는 아코디언 헤더 바로 아래에서 미리보기를 시작한다.
- 원본의 시각 slot 수와 유형을 그대로 사용한다.

현재 프로토타입 fixture는 다음 구성을 시각 기준으로 사용할 수 있다.

| 페이지 | 현재 프로토타입 표시 | 구현 판단 |
|---|---|---|
| 1 | 표 6개 | fixture 예시, 실제 Template IR slot으로 교체 |
| 2 | 표 2개, 차트 없음 | 해당 fixture에서 유지 |
| 3 | 표 4개 | 해당 fixture에서 유지 |
| 4 | 차트 1개, 표 1개 | 해당 fixture에서 유지 |

다른 PDF에 위 개수를 강제하지 않는다.

### 8.4 지지·반박 근거

서비스 기준 문서에 따라 Report Outline Agent는 지지·반박 근거의 배치를 함께 제안해야 한다. 다만 화면에 별도의 `반대 가설` 또는 `counter evidence` 대형 패널을 추가하지 않는다.

- 우측 종합 근거 목록 한 곳에서 `지지`, `반박`, `중립` 방향을 텍스트로 구분한다.
- 반박 근거도 숨기지 않는다.
- 페이지별 배치된 근거 목록에는 해당 block에서의 사용 역할을 표시한다.
- Evidence 행은 선택 checkbox가 아니라 원문을 여는 읽기 전용 버튼이다.
- 사용자가 검증되지 않은 근거를 새로 추가하는 기능은 제공하지 않는다.

## 9. 표·차트와 미리보기

### 9.1 시각 요소 표시

각 시각 요소는 Template IR의 page-local 순서를 사용해 `표1`, `표2`, `차트1`처럼 표시한다.

표·차트 카드에는 다음을 표시한다.

- 시각 요소 유형과 페이지 내 번호
- Template IR block 제목
- 연결 상태: `연결 완료`, `재검증 필요`, `미매핑`
- 권위 Excel sheet·range 또는 bridge ID
- 기간·단위·실제·추정 구분
- 사용한 MappingSet version

표·차트 제목을 입력 필드처럼 보이게 하지 않는다. 이 화면의 표·차트는 읽기 전용 계획 미리보기다.

### 9.2 미리보기 동작

- `페이지 미리보기`는 해당 페이지의 block 배치와 연결값을 읽기 전용으로 보여준다.
- 미리보기는 원본 PDF 좌표와 slot 경계를 사용한다.
- 실제 보고서 초안과 혼동되지 않도록 `구성 미리보기`를 명시한다.
- 미리보기 생성 중에는 최종 영역 크기의 skeleton을 사용한다.
- 표·차트 데이터가 변경되면 관련 미리보기만 갱신한다.
- 여러 페이지를 한 번에 긴 화면으로 펼치지 않고 현재 페이지 단위로 확인한다.

미리보기는 전체 PDF 재생성이나 최종 PDF 시각 검증을 대신하지 않는다. 실제 렌더링과 TD-008 검증은 전체 승인 후 ReportWorkflow에서 수행한다.

### 9.3 연결 오류

다음 상태에서는 시각 요소 카드에 오류를 표시하고 해당 페이지 확인을 차단한다.

- 필수 `slotId` binding 없음
- MappingSet이 `revalidation_required` 또는 `invalid`
- Excel sheet·range 소실
- 표 행·열 topology 불일치
- 차트 category와 series 길이 불일치
- 단위·기간·실제·추정 구분 불일치
- 계산 결과 오류

오류 CTA는 원인에 따라 파일 검사, 검증 또는 밸류에이션 화면으로 이동한다. report-outline 안에서 Excel 주소를 직접 수정하지 않는다.

## 10. 근거 패널

### 10.1 고정 종합 근거 영역

데스크톱에서는 우측에 `메인 가설의 종합 근거` 패널을 sticky로 유지한다. 좁은 화면에서는 페이지 아코디언 아래에 쌓는다.

상단에는 다음을 표시한다.

- 메인 가설
- 현재 잠정 투자의견
- 사용 가능한 검증 Evidence 수
- 반박 또는 충돌 관련 주의 상태

Evidence 행에는 다음을 표시한다.

- 방향: 지지·반박·중립·계산·사용자 판단
- 제목
- 검증된 값 또는 한 줄 요약
- 발행기관·문서명·발행일
- 원문 위치 또는 Excel 계산 경로
- 연결된 페이지·block

전체 항목을 이미 보여주는 경우 헤더에 중복 count badge를 과도하게 추가하지 않는다.

### 10.2 Evidence 행 동작

- 전체 행이 하나의 `<button type="button">`이다.
- 접근성 이름은 `{Evidence 제목} 원문 근거 열기`다.
- checkbox, radio 또는 drag control로 만들지 않는다.
- 클릭하면 기존 `EvidenceDrawer`의 리사이즈 가능한 우측 원문 패널을 재사용한다.
- DART·IR·업로드 PDF는 저장된 source version의 정확한 페이지·좌표를 연다.
- 뉴스는 공식 URL을 새 탭으로 열고 가능한 경우 Text Fragment를 사용한다.
- Excel 계산값은 입력 셀부터 결과 셀까지 계산 경로를 보여준다.

## 11. 목표 컴포넌트 구성

| 컴포넌트 | 책임 | 주요 입력 | 주요 출력·이벤트 |
|---|---|---|---|
| `ReportOutlineRoute` | 세션·소유권·진입 조건 검사와 초기 데이터 제공 | `projectId`, 세션 | ready, blocked, not-found |
| `ReportOutlinePage` | 화면 레이아웃과 저장·승인·생성 상태 조정 | outline view model | patch, approve, navigation |
| `ProcessShell` | 공통 헤더·사이드바·하단 action bar | 프로젝트·단계 상태 | 단계 이동 |
| `OutlineScreenHeader` | 제목, 안내, 기준 초기화 | outline 상태 | reset 요청 |
| `OutlineWorkspace` | 페이지 아코디언과 종합 근거 배치 | pages, evidence | 페이지 선택 |
| `OutlinePageAccordion` | Template IR 페이지 순서와 확인 상태 표시 | page summaries | expand, collapse |
| `OutlinePageEditor` | 선택 페이지의 block·slot 편집 | page detail | slot patch, page review |
| `NarrativeDirectionField` | 제목·본문의 한 줄 방향 입력 | slot value, limits | debounced patch |
| `TargetPriceDirectionField` | 유지·상향·하향과 한 줄 근거 | valuation, slot value | decision patch |
| `VisualSlotPreviewList` | 표·차트와 MappingSet 연결 표시 | visual slots | preview open |
| `PageEvidenceList` | 해당 페이지에 배치된 Evidence 확인 | evidence bindings | source open |
| `OverallEvidencePanel` | 메인 가설의 전체 검증 근거 | hypothesis, evidence | source open |
| `EvidenceDrawer` | 원문·locator·계산 경로 표시 | evidence version | close, resize |
| `OutlineSaveStatus` | 저장 중·저장됨·실패·충돌 표시 | save state | retry |
| `OutlineApprovalDialog` | 전체 구성 승인 확인 | validation summary | confirm, cancel |
| `DraftGenerationStatus` | Temporal projection 진행률·복구 | task projection | report open, retry |

route 파일이 더 이상 `app/page.tsx`를 그대로 re-export하지 않게 한다. 서버 접근 경계와 이 화면의 Client Component를 route 단위로 분리한다.

## 12. 기존 디자인 재사용·수정·제거 판정

| 현재 영역 | 판정 | 구현 판단 |
|---|---|---|
| process 헤더·어두운 사이드바·하단 action bar | 재사용 | 공통 shell로 분리하고 실제 단계·저장 상태 연결 |
| `STEP 07 / 페이지 내용 설정` 헤더 | 재사용 | 안내 문구를 간결한 작업 중심 카피로 수정 |
| 헤더의 `기준 초기화` | 수정 재사용 | 확인 dialog, 서버 reset API, 감사 version 연결 |
| 2열 outline workspace | 재사용 | 왼쪽 페이지 구성, 오른쪽 종합 근거 구조 유지 |
| 페이지 아코디언 | 재사용 | 실제 Template IR page와 확인·오류 상태 연결 |
| Page 1 행형 입력 | 재사용 | 하드코딩 문구를 Agent 제안과 저장값으로 교체 |
| 목표주가 `유지·상향·하향` selector | 재사용 | 확정 밸류에이션과 일관성 검증 연결 |
| 표·차트 compact card | 재사용 | 실제 slot·mapping metadata와 미리보기 연결 |
| 우측 메인 가설·종합 근거 | 재사용 | fallback 가설·6건 샘플을 API 데이터로 교체 |
| Evidence 원문 drawer | 재사용 | Evidence version과 실제 locator API 연결 |
| `자동 저장됨` | 수정 재사용 | 실제 저장 state·서버 시각 표시 |
| `임시 저장` | 제거 | 모든 변경 자동 저장; 실패 상태에서만 `다시 저장` 제공 |
| `＋ 페이지 추가` | 제거 | 원본 PDF 페이지 수·구조 불변조건과 충돌 |
| 페이지·section 삭제/정렬 UI | 추가하지 않음 | Template IR 구조 변경 금지 |
| 4페이지 하드코딩 | 제거 | 실제 Template IR 페이지 목록으로 교체 |
| 하드코딩 표·차트·Evidence | 제거 | MappingSet·Evidence API 응답으로 교체 |
| `완료` | 수정 재사용 | `페이지 구성 승인`으로 결과 중심 문구 사용 |
| AI 초안/빈 텍스트 2개 생성 방식 dialog | 제거 | 기준 문서에 없는 선택지; 한 개 승인 확인 dialog로 교체 |
| 상단 `Report` 무조건 이동 | 수정 | 초안 생성 완료 후에만 활성 |
| 사이드바 자유 단계 이동 | 수정 | 접근 가능한 단계와 저장 flush 조건 적용 |

현재 디자인의 white/soft surface, hairline, 12px 안팎 radius, lime 선택 신호와 고정 우측 패널은 유지한다. 새 장식 색, 무거운 shadow 또는 별도 대시보드형 카드 묶음을 추가하지 않는다.

## 13. 버튼·입력·정렬 요소 UI 계약

### 13.1 버튼

| ID | 화면 요소 | 노출·활성 조건 | 동작 | 성공 결과 | 실패 처리 |
|---|---|---|---|---|---|
| OUTLINE-BTN-01 | `프로젝트로 돌아가기` | 항상 | 저장 flush 후 목록 이동 | `/projects` | 저장 실패 시 이탈 선택 안내 |
| OUTLINE-BTN-02 | 페이지 아코디언 헤더 | page 존재 | expand/collapse | 해당 패널 표시 | 없음 |
| OUTLINE-BTN-03 | `기준 초기화` | 편집 가능, 생성 중 아님 | reset 확인 dialog | Agent 기준 새 outline version | 기존 값 유지, 오류 |
| OUTLINE-BTN-04 | `페이지 미리보기` | preview 가능한 page | 읽기 전용 preview 표시 | 현재 구성 확인 | 실패 이유와 재시도 |
| OUTLINE-BTN-05 | Evidence 행 | validated Evidence | 원문 drawer 또는 공식 URL | 정확한 source locator 표시 | locator 오류 안내 |
| OUTLINE-BTN-06 | `이 페이지 확인` | page validation 통과 | page review 저장 | `확인 완료` 상태 | 페이지 내부 오류 강조 |
| OUTLINE-BTN-07 | `다시 저장` | save error | 동일 patch 재전송 | saved | 오류 유지 |
| OUTLINE-BTN-08 | `페이지 구성 승인` | 모든 페이지 확인·검증 통과 | 승인 dialog 열기 | dialog 표시 | 차단 목록 표시 |
| OUTLINE-BTN-09 | 승인 dialog `취소` | dialog 열림 | dialog 닫기 | 이전 포커스 복귀 | 없음 |
| OUTLINE-BTN-10 | 승인 dialog `승인하고 초안 생성` | latest version 유효 | outline 승인·ReportWorkflow 시작 | 생성 상태 표시 | 승인 version 유지, 재시도 |
| OUTLINE-BTN-11 | `보고서 열기` | draft ready | report route 이동 | `/projects/{projectId}/report` | draft 상태 재조회 |

모든 주요 action은 최소 44px 상호작용 영역을 갖는다. 기본 버튼 type은 `button`이며 전체 승인만 dialog 안의 명시적 action으로 실행한다.

### 13.2 입력

| ID | 필드 | HTML | 규칙 | 저장 대상 | 오류 위치 |
|---|---|---|---|---|---|
| OUTLINE-IN-01 | 리포트 제목 | `<input type="text">` | trim 후 1~80자, 줄바꿈 금지 | narrative slot value | 해당 행 아래 |
| OUTLINE-IN-02 | 기업 리뷰 한 줄 방향 | `<input type="text">` | trim 후 1~120자, 줄바꿈 금지 | narrative slot value | 해당 행 아래 |
| OUTLINE-IN-03 | 기업 전망 한 줄 방향 | `<input type="text">` | trim 후 1~120자, 줄바꿈 금지 | narrative slot value | 해당 행 아래 |
| OUTLINE-IN-04 | 목표주가 방향 | `<select>` | `유지`, `상향`, `하향` | user-judgment slot | 해당 행 아래 |
| OUTLINE-IN-05 | 목표주가 핵심 근거 | `<input type="text">` | trim 후 1~120자 | user-judgment slot | 해당 행 아래 |
| OUTLINE-IN-06 | Template IR narrative slot | `<input>` 또는 짧은 `<textarea>` | slot schema의 max length·line count | slot value | 해당 block 아래 |

- `name`은 `pages.{pageId}.slots.{slotId}.value` 형태의 안정적 식별자를 사용한다.
- placeholder는 예시를 강요하지 않고 `핵심 포인트를 한 줄로 입력하세요.`처럼 목적만 설명한다.
- focus는 기존 field 경계 안의 lime-deep border 하나로 표시한다.
- 입력 시 페이지의 `확인 완료`를 `확인 필요`로 되돌린다.
- 입력 중 client preview는 허용하지만 서버 저장 성공 전 완료 상태로 표시하지 않는다.

### 13.3 정렬 요소

페이지·section·visual slot 정렬 control은 제공하지 않는다. 순서는 Template IR의 `pageNumber`, block의 `zOrder`·논리 순서와 page-local slot 순서를 따른다.

접근성상 정렬 불가능한 항목을 drag 가능한 것처럼 보이게 하는 grip icon을 표시하지 않는다.

## 14. 저장 상태와 기준 초기화

### 14.1 자동 저장

- 입력 변경은 약 `500ms` debounce 후 batch patch로 저장한다.
- 포커스 이동, 페이지 확인, 단계 이동과 전체 승인 전에는 pending patch를 즉시 flush한다.
- 저장 중 새 변경이 생기면 이전 응답이 최신 값을 덮어쓰지 않게 request sequence와 outline version을 확인한다.
- 같은 request ID 재전송은 한 번만 반영한다.

| 저장 상태 | 표시 |
|---|---|
| `idle` | 저장 상태를 과도하게 강조하지 않음 |
| `saving` | `변경사항 저장 중` |
| `saved` | `자동 저장됨 · HH:mm` |
| `offline` | `오프라인 · 연결 후 저장` |
| `error` | `저장하지 못했습니다` + `다시 저장` |
| `conflict` | `다른 탭의 최신 변경이 있습니다` + 다시 불러오기 |

### 14.2 기준 초기화

`기준 초기화`는 원본 파일, Template IR, MappingSet, Evidence 또는 밸류에이션을 변경하지 않는다.

1. 현재 미저장 변경을 flush한다.
2. `현재 입력을 AI 추천 기준으로 되돌립니다` 확인 dialog를 연다.
3. 사용자가 확인하면 현재 고정 input version으로 Report Outline Agent 제안을 다시 생성한다.
4. 기존 outline version은 보존하고 새 version을 만든다.
5. 모든 페이지 확인 상태를 `확인 필요`로 되돌린다.

초기화 중에는 중복 요청을 차단하며, 실패하면 기존 편집값을 유지한다.

## 15. 페이지 확인·전체 승인·초안 생성

### 15.1 페이지 확인

페이지 확인은 사용자가 해당 페이지의 다음 항목을 봤음을 기록한다.

- 변경 가능한 모든 필수 block 값
- 표·차트 MappingSet 연결
- 해당 페이지의 Evidence 배치
- 원본 구조와 고정 요소 요약
- 경고와 사용자 판단

확인 후 page 내용, 연결 version 또는 upstream version이 바뀌면 확인 상태는 자동 무효화된다.

### 15.2 전체 승인 조건

다음 조건을 모두 만족해야 `페이지 구성 승인`을 활성화한다.

- Template IR의 모든 페이지가 목록에 있고 순서가 동일함
- 모든 필수 dynamic slot에 값 또는 허용된 연결 규칙 존재
- 모든 필수 표·차트 slot이 confirmed MappingSet과 연결됨
- 모든 Evidence가 `passed` 상태이며 source version·locator 존재
- unresolved source conflict 0건
- 밸류에이션 version 유효
- 모든 페이지 사용자 확인 완료
- outline이 최신 input version을 참조
- 저장 중·저장 오류·version conflict 없음

### 15.3 승인 dialog

dialog는 하나의 승인 결과에 집중한다.

- 제목: `페이지 구성을 승인할까요?`
- 설명: 승인 version으로 보고서 초안을 생성하며 페이지 수와 레이아웃은 원본 PDF를 유지한다.
- 요약: 페이지 수, narrative block 수, 표·차트 수, Evidence 수, 입력 version
- secondary: `취소`
- primary: `승인하고 초안 생성`

기준 문서에 없는 `AI 초안`과 `빈 텍스트 영역` 2개 생성 방식 선택은 제공하지 않는다. 빈 구조 생성이 필요하면 별도 제품 결정 후 추가한다.

### 15.4 초안 생성

승인 성공 시 다음 version을 불변으로 고정한다.

- Template IR
- 문체 프로필
- MappingSet
- Excel 계산 결과
- 검증 Evidence
- 컨센서스 snapshot
- 잠정 투자의견·가설
- Target PER·목표주가
- report outline 승인 version

Report Draft Agent는 승인된 block 안에서만 문장을 작성한다. 새 숫자·출처·판단을 만들거나 페이지를 추가할 수 없다.

## 16. 화면 데이터

### 16.1 서버 view model

```json
{
  "project": {
    "projectId": "prj_01...",
    "name": "삼성전기 2026년 2분기 리서치",
    "companyName": "삼성전기",
    "ticker": "009150",
    "targetPeriod": {
      "year": 2026,
      "quarter": 2
    },
    "cutoffDate": "2026-07-17",
    "currentStage": "report_outline"
  },
  "prerequisites": {
    "ready": true,
    "revalidationRequired": false,
    "blockingItems": []
  },
  "inputVersions": {
    "templateVersion": 3,
    "mappingSetId": "map_01...",
    "workbookVersion": 17,
    "evidenceSetVersion": 8,
    "valuationVersion": 4,
    "styleProfileVersion": 2
  },
  "outline": {
    "outlineId": "out_01...",
    "version": 6,
    "status": "editing",
    "savedAt": "2026-07-24T12:00:00Z",
    "pages": []
  },
  "mainHypothesis": {},
  "evidenceSummary": [],
  "draftTask": null
}
```

### 16.2 페이지 데이터

| 필드 | 설명 |
|---|---|
| `pageId` | Template IR의 안정적 page ID |
| `pageNumber` | 원본 PDF 순서 |
| `pageLabel` | 원본 표시 번호 |
| `widthPt`, `heightPt`, `rotation` | 원본 페이지 규격 |
| `role` | 핵심 리뷰, 재무제표, 고지 등 |
| `editable` | 변경 가능한 block 존재 여부 |
| `reviewStatus` | `needs-review`, `reviewed`, `invalidated` |
| `blocks` | Template IR block 목록 |
| `visualSlots` | table·chart slot과 binding 상태 |
| `evidenceBindings` | 이 페이지에 배치된 Evidence version |
| `validationErrors` | 페이지 단위 차단 오류 |

### 16.3 block·slot 데이터

| 필드 | 설명 |
|---|---|
| `blockId` | Template IR block ID |
| `role` | title, narrative, table, chart, disclosure, user_judgment 등 |
| `required` | 전체 승인 필수 여부 |
| `fixed` | 변경 금지 여부 |
| `slotId` | 의미 slot ID |
| `valueType` | string, decision, scalar, table, chart |
| `suggestedValue` | Agent 제안 |
| `userValue` | 사용자 저장값 |
| `maxLength`, `maxLines` | 원본 영역 기반 입력 제한 |
| `bindingStatus` | confirmed, revalidation-required, invalid |
| `sourceRefs` | MappingSet·Evidence·사용자 판단 연결 |

### 16.4 클라이언트 상태

| 상태 | 타입 | 설명 |
|---|---|---|
| `expandedPageId` | string 또는 null | 열린 아코디언 |
| `draftValues` | slot별 local value | 입력 중 표시값 |
| `pendingChanges` | patch 목록 | 아직 저장하지 않은 변경 |
| `saveStatus` | idle/saving/saved/offline/error/conflict | 저장 UI |
| `expectedVersion` | number | optimistic concurrency |
| `previewPageId` | string 또는 null | 미리보기 대상 |
| `sourceEvidenceId` | string 또는 null | 원문 drawer |
| `resetDialogOpen` | boolean | 기준 초기화 확인 |
| `approvalDialogOpen` | boolean | 전체 승인 확인 |
| `draftTask` | task projection 또는 null | 초안 생성 상태 |

프로젝트, outline, Evidence와 version의 권위값은 서버다. React state만으로 단계 완료나 승인 상태를 결정하지 않는다.

## 17. API 계약

### 17.1 `GET /api/projects/{projectId}/report-outline`

세션·소유권·선행 조건을 확인하고 화면 view model을 반환한다.

| 상태 코드 | 의미 | 화면 처리 |
|---|---|---|
| `200` | 조회 성공 | 상태에 맞는 화면 |
| `401` | 로그인 필요 | 로그인 후 원래 URL 복귀 |
| `404` | 없음 또는 권한 없음 | 일반 not-found |
| `409` | 선행 조건 미충족 | `requiredStage`·`resumeRoute` CTA |
| `409` | 재검증 필요 | 읽기 전용·복귀 안내 |
| `500` | 조회 실패 | 전체 오류·재시도 |

### 17.2 `POST /api/projects/{projectId}/report-outline/generations`

저장된 outline이 없거나 기준 초기화를 실행할 때 Report Outline Agent 제안 생성을 시작한다.

요청:

```json
{
  "expectedInputVersions": {
    "templateVersion": 3,
    "mappingSetId": "map_01...",
    "workbookVersion": 17,
    "evidenceSetVersion": 8,
    "valuationVersion": 4
  },
  "mode": "initial"
}
```

`mode`는 `initial` 또는 `reset`이다. `Idempotency-Key`를 필수로 사용한다.

응답은 `202 Accepted`와 `taskId`를 반환한다. 같은 input version과 request ID의 중복 작업을 만들지 않는다.

### 17.3 `PATCH /api/projects/{projectId}/report-outline`

batch slot 변경을 자동 저장한다.

```json
{
  "expectedVersion": 6,
  "requestId": "uuid",
  "changes": [
    {
      "pageId": "p1",
      "slotId": "p1.narrative.review",
      "value": "고부가 제품 믹스 개선으로 수익성이 회복됐다"
    }
  ]
}
```

성공 응답:

```json
{
  "outlineVersion": 7,
  "savedAt": "2026-07-24T12:01:00Z",
  "invalidatedPageIds": ["p1"],
  "validationErrors": []
}
```

- 서버가 slot 존재, 편집 가능 여부, 길이와 타입을 다시 검사한다.
- fixed slot, page 순서, block 좌표 변경 요청은 거절한다.
- version이 오래되면 `409 OUTLINE_VERSION_CONFLICT`를 반환한다.

### 17.4 `POST /api/projects/{projectId}/report-outline/pages/{pageId}/review`

페이지 확인 상태를 저장한다.

```json
{
  "expectedOutlineVersion": 7
}
```

페이지 validation 실패 시 `422 PAGE_OUTLINE_INVALID`와 field·slot 오류를 반환한다.

### 17.5 `POST /api/projects/{projectId}/report-outline/approve`

전체 outline을 승인하고 보고서 초안 생성을 시작한다.

```json
{
  "expectedOutlineVersion": 7,
  "expectedInputVersions": {
    "templateVersion": 3,
    "mappingSetId": "map_01...",
    "workbookVersion": 17,
    "evidenceSetVersion": 8,
    "valuationVersion": 4
  }
}
```

성공 응답:

```json
{
  "outline": {
    "outlineId": "out_01...",
    "version": 7,
    "status": "approved",
    "approvedAt": "2026-07-24T12:02:00Z"
  },
  "draftTask": {
    "taskId": "task_01...",
    "operationStatus": "queued",
    "reportRoute": "/projects/prj_01.../report"
  }
}
```

이 endpoint도 `Idempotency-Key`를 사용한다. 중복 클릭으로 여러 보고서 초안을 만들지 않는다.

### 17.6 `GET /api/projects/{projectId}/tasks/{taskId}`

Temporal 내부 상태를 사용자용 projection으로 반환한다.

| `operationStatus` | 표시 |
|---|---|
| `queued` | 생성 대기 |
| `running` | 현재 단계와 진행률 |
| `succeeded` | report version과 route |
| `failed` | 사용자용 실패 사유와 retry 가능 여부 |
| `cancelled` | 취소됨 |

클라이언트는 Temporal workflow ID나 내부 queue 이름에 의존하지 않는다.

### 17.7 `GET /api/projects/{projectId}/evidence/{evidenceVersionId}`

원문 drawer에 필요한 source version, locator, exact quote, provenance와 사용 block을 반환한다.

객체 저장소 key나 무제한 presigned URL을 직접 노출하지 않는다. 모든 원문 조회와 다운로드는 세션·프로젝트 소유권을 다시 확인한다.

## 18. 오류 코드와 화면 처리

| 오류 코드 | 의미 | 화면 처리 |
|---|---|---|
| `AUTH_REQUIRED` | 세션 없음 | 로그인 후 복귀 |
| `PROJECT_NOT_FOUND` | 없음 또는 권한 없음 | 일반 404 |
| `OUTLINE_PREREQUISITE_INCOMPLETE` | 선행 단계 미완료 | 필요한 단계 CTA |
| `OUTLINE_REVALIDATION_REQUIRED` | 상위 version 변경 | 읽기 전용·재검증 |
| `OUTLINE_VERSION_CONFLICT` | 다른 탭에서 저장 | 최신 version 다시 불러오기 |
| `OUTLINE_SLOT_READ_ONLY` | fixed slot 변경 시도 | 변경 취소·안내 |
| `OUTLINE_VALUE_INVALID` | 타입·길이 오류 | 해당 field 아래 |
| `PAGE_OUTLINE_INVALID` | 페이지 확인 차단 | 페이지 오류 요약 |
| `OUTLINE_APPROVAL_BLOCKED` | 전체 승인 조건 미충족 | 차단 페이지로 이동 |
| `OUTLINE_GENERATION_FAILED` | Agent 제안 생성 실패 | 기존 version 유지·재시도 |
| `REPORT_DRAFT_GENERATION_FAILED` | 초안 생성 실패 | 승인 version 유지·재시도 |
| `RATE_LIMITED` | 요청 제한 | 잠시 후 재시도 |

서버 내부 stack trace, Agent prompt, 객체 저장소 key와 worker 경로는 사용자 오류 메시지에 포함하지 않는다.

## 19. 저장 모델과 version 규칙

PostgreSQL에 최소 다음 논리 entity를 저장한다.

| entity | 주요 역할 |
|---|---|
| `report_outline` | 프로젝트의 현재 outline 식별자와 상태 |
| `report_outline_version` | input version과 Agent·사용자 수정 결과의 불변 version |
| `report_outline_page_review` | 페이지별 사용자 확인과 무효화 이력 |
| `report_outline_slot_value` | slot별 제안값·사용자값·출처 |
| `report_outline_approval` | 전체 승인 사용자·시각·version |
| `report_draft_task_projection` | 초안 생성 사용자용 상태 |
| `provenance_edge` | Evidence·Excel·outline block·report block 연결 |

### 19.1 version 원칙

- 승인된 outline은 UPDATE로 덮어쓰지 않는다.
- 사용자가 승인 후 내용을 변경하면 새 outline version을 만들고 다시 페이지 확인·전체 승인을 받아야 한다.
- 상위 데이터 변경으로 outline이 무효화돼도 과거 승인 version은 삭제하지 않는다.
- report version은 사용한 outline version을 고정한다.
- Report Outline Agent model·prompt·schema version을 저장한다.
- reset, 사용자 수정, page review, 승인과 재시도 actor·시각을 감사 기록에 남긴다.

## 20. 권한과 보안

1. 모든 GET·PATCH·승인·원문 조회에서 검증된 세션 사용자와 프로젝트 소유자를 확인한다.
2. client가 보낸 `projectId`, `outlineVersion`, `pageId`, `slotId`가 해당 프로젝트의 현재 Template IR에 속하는지 검사한다.
3. HTML이 포함된 사용자 입력은 text로 렌더링한다.
4. Agent 입력에 포함된 사용자 문구와 원문은 데이터이며 system prompt를 변경할 명령으로 취급하지 않는다.
5. Agent 출력은 Pydantic schema 검증 후 저장한다.
6. Agent가 반환한 Evidence ID, Excel slot과 page block이 고정 input version에 실제 존재하는지 결정적 코드로 검사한다.
7. 상태 변경 요청에는 CSRF 방어를 적용한다.
8. 승인·초안 생성은 idempotency와 optimistic concurrency를 함께 사용한다.
9. Report·원문 object 접근 URL은 짧은 만료와 단일 artifact 범위로 제한한다.

## 21. 로딩·빈 상태·예외 처리

| 상황 | 사용자 화면 | 후속 동작 |
|---|---|---|
| outline 최초 생성 중 | 페이지 구조 skeleton, 현재 작업 | 화면 이탈 가능 |
| 원본에 변경 가능한 block 없음 | 고정 페이지 목록과 설명 | 페이지 확인 후 승인 가능 여부 서버 판정 |
| Evidence 0건 | 단순 빈 상태가 아니라 선행 검증 미완료로 차단 | 검증 화면 이동 |
| 표·차트 0건 | 원본이 실제로 없는 페이지면 정상 | narrative만 확인 |
| 필수 Mapping 누락 | 관련 visual slot 오류 | 파일 검사 화면 이동 |
| 저장 중 네트워크 단절 | local 입력 유지, 오프라인 상태 | 재연결 후 같은 request ID 재전송 |
| 세션 만료 | 입력 local buffer 유지 | 재로그인 후 version 확인·저장 |
| 다른 탭 저장 | 현재 입력 자동 병합 금지 | 최신 version 확인 후 다시 적용 |
| Evidence source locator 실패 | row 유지, 원문 열기 오류 | 재검증 요청 |
| Agent schema 오류 | 잘못된 제안 노출 금지 | generation 재시도 |
| 초안 생성 timeout | 승인 version 유지 | task 상태 재조회·재시도 |
| 폰트 미확보 | 초안 생성 차단 아님 | 영향을 받을 페이지와 대체 폰트 경고 |
| 문장 영역 넘침 예상 | 해당 block 경고 | 문구 축약 또는 승인 전 수정 |

## 22. 상위 데이터 변경과 재검증

다음 변경은 report-outline 확인과 승인을 무효화한다.

- 원본 PDF 또는 Template IR 변경
- Excel 구조·MappingSet 변경
- 검증 Evidence의 정정·교체·충돌 결정 변경
- 사용자 추정치 변경
- Forward EPS, Target PER 또는 목표주가 변경
- 잠정 투자의견·투자 가설 변경
- 사용 컨센서스 snapshot 변경

무효화 시 기존 사용자 입력을 삭제하지 않고 읽기 전용으로 보존한다. 화면 상단에 변경 원인, 영향 페이지와 돌아갈 단계가 표시되어야 한다.

새 공시나 정정자료가 수집됐다는 이유만으로 승인 outline과 보고서를 자동 변경하지 않는다. 새 source version을 사용할지 사용자가 확인한 뒤 새 outline version을 만든다.

## 23. 기술 배치

| 기술·영역 | 이 화면에서의 위치 | 판단 |
|---|---|---|
| Next.js App Router | route 접근 경계와 서버 초기 데이터 | 사용 |
| React Client Component | 아코디언, 입력, drawer, dialog, 저장 상태 | 사용 |
| PostgreSQL | outline version·slot·review·approval·task projection | 사용 |
| PydanticAI Report Outline Agent | 최초 제안·기준 초기화 | 서버 작업으로 사용 |
| Temporal | Agent 제안과 보고서 초안 생성 workflow | 사용 |
| S3 호환 객체 저장소 | Template IR·원문·preview·draft artifact | 서버를 통해 사용 |
| Template IR | 페이지·block·slot·고정 구조 권위값 | 필수 |
| MappingSet | 표·차트·Excel 연결 권위값 | 필수 |
| Evidence 저장 구조 | 원문·locator·provenance | 필수 |
| SpreadJS | 없음 | 전체 workbook UI를 이 화면에 로드하지 않음 |
| Aspose.Cells | 직접 없음 | 확정 계산 결과를 서버가 읽어 제공 |
| PyMuPDF·pikepdf·PDFium·OpenCV | 직접 없음 | 워커의 preview·초안·검증 단계에서만 실행 |
| PDF worker | 직접 호출 금지 | API·Temporal 경계로만 실행 |

브라우저 bundle에 SpreadJS, Aspose.Cells, PDF parser, renderer, OpenCV 또는 Agent runtime을 포함하지 않는다.

## 24. 반응형·접근성 계약

### 24.1 반응형

- desktop: process sidebar + 왼쪽 페이지 아코디언 + sticky 종합 근거 패널
- `1050px` 이하 작업 영역: outline을 한 열로 전환하고 근거 패널을 아래에 배치
- mobile: process sidebar를 숨기고 헤더의 `작업 흐름`으로 단계 확인
- mobile의 페이지 입력 행은 번호·라벨 다음 줄에 field를 배치
- 표·차트 preview는 한 열로 쌓고 글자 크기를 줄여 맞추지 않는다.
- 하단 primary action은 화면 폭을 확보하고 최소 44px target을 유지한다.

### 24.2 접근성

- 페이지 목록은 heading과 button 기반 아코디언으로 구성한다.
- 상태는 색상만으로 전달하지 않는다.
- 저장 상태는 `role="status"`와 과도하지 않은 live region을 사용한다.
- 승인 실패는 오류 요약에서 해당 page·field로 포커스를 이동할 수 있어야 한다.
- dialog는 포커스를 가두고 Escape·닫기 후 원래 버튼으로 포커스를 복귀한다.
- Evidence drawer는 `aria-label`, close button과 keyboard resize를 제공한다.
- `prefers-reduced-motion`에서는 disclosure·drawer transition을 즉시 전환한다.

## 25. 현재 프로토타입과 목표 구현의 차이

| 현재 프로토타입 | 목표 구현 | 우선순위 |
|---|---|---|
| route가 공용 `app/page.tsx` re-export | route별 서버 경계와 화면 컴포넌트 분리 | 필수 |
| `demo`, `new` 같은 임시 project ID 허용 | 서버 발급 실제 projectId와 소유권 확인 | 필수 |
| 4페이지 하드코딩 | 실제 Template IR 페이지 수·순서 | 필수 |
| 5페이지 이상 임의 추가 가능 | 페이지 추가 제거 | 필수 |
| 페이지 삭제·정렬 계약 없음 | 원본 구조 불변을 명시하고 control 미제공 | 필수 |
| Page 1 샘플 문구와 fallback 가설 | Agent 제안·사용자 저장값·실제 가설 | 필수 |
| 표·차트 목록 하드코딩 | Template IR·MappingSet 응답 | 필수 |
| Evidence 6건 하드코딩 | 검증 Evidence version·locator | 필수 |
| 표·차트 제목만 표시 | mapping 상태·range·단위·preview | 필수 |
| 모든 페이지 확인 없이 완료 가능 | 페이지별 확인과 전체 승인 조건 | 필수 |
| `자동 저장됨`이 정적 문구 | 실제 versioned autosave | 필수 |
| `임시 저장`이 local toast만 표시 | 제거, 실패 시 retry만 제공 | 필수 |
| 초기화가 local state reset | 확인 dialog·새 outline version·감사 기록 | 필수 |
| Evidence drawer가 샘플 source | source version·locator API | 필수 |
| `완료`가 생성 방식 선택 popup | 한 개 승인 dialog와 초안 생성 workflow | 필수 |
| 초안 생성이 즉시 client route 전환 | Temporal 작업·진행·실패·복구 | 필수 |
| Report 탭 항상 이동 가능 | draft ready 이후 활성 | 필수 |
| sidebar에서 선행 단계 자유 이동 | 저장·접근 조건 적용 | 구현 품질 |
| client 전체 state가 새로고침 시 소실 | 서버 version 복구 | 필수 |

## 26. 누락 요소와 필요한 결정

### 26.1 기준 문서로 확정 가능한 누락 요소

현재 화면에는 다음이 없으므로 구현해야 한다.

- 실제 세션·소유권 guard
- 선행 단계 미완료·재검증 필요 상태
- 실제 Template IR page·block·slot
- 페이지별 확인 상태와 invalidation
- MappingSet·Evidence 연결 오류
- 실제 자동 저장·version 충돌
- Agent generation 진행·실패 상태
- 승인 version 고정
- ReportWorkflow 진행·복구
- 고정 페이지 표시
- 반박 Evidence를 포함한 배치 확인

### 26.2 별도 제품·기술 결정이 필요한 항목

1. Report Outline Agent의 canonical prompt와 Pydantic output schema
2. 제목·본문 방향의 Template IR slot별 최대 글자 수 계산 방식
3. outline 구성 미리보기 artifact 형식과 갱신 SLA
4. 빈 텍스트 구조 생성 mode를 MVP에 추가할지 여부
5. optional·repeatable block과 사용자 구조 변경을 향후 지원할지 여부
6. 인증·세션·CSRF 구현 기술

초안 생성 진행 상태는 TD-016의 polling으로 확정됐다. 나머지 항목이 미확정이어도 페이지 수·구조 불변, 검증 데이터만 사용, page 확인·전체 승인, version 고정과 초안 생성 계약은 유지한다.

## 27. 구현 순서

1. route를 공용 `app/page.tsx` re-export에서 분리하고 서버 session·소유권 guard를 구현한다.
2. Template IR·MappingSet·Evidence·valuation을 조합한 report-outline view model을 구현한다.
3. Report Outline Agent schema와 generation workflow를 구현한다.
4. 현재 2열 레이아웃·아코디언·근거 패널에 실제 view model을 연결한다.
5. 하드코딩 4페이지·표·차트·Evidence와 `페이지 추가`를 제거한다.
6. slot 입력, validation과 versioned autosave를 구현한다.
7. EvidenceDrawer를 source version·locator API에 연결한다.
8. 페이지별 확인과 invalidation을 구현한다.
9. 전체 승인과 ReportWorkflow 시작·task projection을 구현한다.
10. blocked·loading·empty·error·offline·conflict·revalidation 상태를 구현한다.
11. 접근성, 반응형, 동시성, 권한과 workflow 복구 테스트를 추가한다.

## 28. 완료 조건

- [ ] 로그인한 프로젝트 소유자만 화면을 조회·수정할 수 있다.
- [ ] 비로그인은 로그인 후 원래 URL로 복귀한다.
- [ ] 선행 단계 미완료와 재검증 필요 상태가 올바른 복귀 route를 표시한다.
- [ ] 실제 Template IR의 모든 페이지가 같은 수·순서로 표시된다.
- [ ] 고정 페이지와 변경 가능한 페이지가 구분된다.
- [ ] 페이지·section·표·차트 추가·삭제·정렬 control이 없다.
- [ ] Report Outline Agent는 고정된 검증 version만 사용한다.
- [ ] Agent가 새로운 숫자·출처·페이지·block을 만들 수 없다.
- [ ] 제목·본문 방향·목표주가 판단이 실제 API에 저장된다.
- [ ] Page 1의 핵심 행이 한 줄 중심의 읽기 쉬운 입력 구조를 유지한다.
- [ ] 표·차트가 Template IR slot과 confirmed MappingSet을 표시한다.
- [ ] 표·차트 제목과 preview가 editable control처럼 보이지 않는다.
- [ ] 지지·반박·중립 Evidence가 숨김 없이 표시된다.
- [ ] Evidence 행이 실제 source version의 정확한 원문 위치를 연다.
- [ ] 각 페이지를 확인할 수 있고 변경 시 확인 상태가 무효화된다.
- [ ] 모든 필수 page·slot·mapping·Evidence가 유효할 때만 전체 승인이 가능하다.
- [ ] 자동 저장이 version·request ID를 사용하고 중복·역순 응답을 안전하게 처리한다.
- [ ] 저장 실패 시 입력을 잃지 않고 재시도할 수 있다.
- [ ] 다른 탭의 최신 변경을 자동 병합하거나 덮어쓰지 않는다.
- [ ] 기준 초기화가 기존 version을 보존하고 새 제안 version을 만든다.
- [ ] 전체 승인 시 사용한 Template IR·MappingSet·Excel·Evidence·valuation·outline version이 고정된다.
- [ ] 중복 승인 클릭이 하나의 ReportWorkflow만 생성한다.
- [ ] 초안 생성은 화면을 벗어나도 계속되고 프로젝트 목록에서 상태를 확인할 수 있다.
- [ ] 초안 생성 완료 후 실제 report route를 열 수 있다.
- [ ] 화면에서 SpreadJS, Aspose.Cells, PDF parser와 Agent runtime을 직접 로드하지 않는다.
- [ ] keyboard만으로 아코디언, 입력, 원문 drawer, 페이지 확인과 전체 승인을 수행할 수 있다.
- [ ] desktop·tablet·mobile에서 내용이 잘리지 않고 최소 target 크기를 유지한다.

## 29. 자동 테스트 시나리오

| 종류 | 시나리오 |
|---|---|
| E2E | 소유자의 정상 진입과 실제 Template IR 페이지 렌더링 |
| E2E | 비로그인 진입 후 Google 로그인·원래 URL 복귀 |
| E2E | 다른 사용자 프로젝트 접근 거부 |
| E2E | 선행 validation 미완료 시 검증 화면 CTA |
| E2E | 밸류에이션 재검증 필요 시 읽기 전용 전환 |
| E2E | Page 1 입력 자동 저장과 새로고침 복구 |
| E2E | 페이지 아코디언 expand/collapse와 keyboard 이동 |
| E2E | Evidence 행 클릭 후 정확한 PDF page·locator 표시 |
| E2E | Excel 계산 Evidence의 dependency path 표시 |
| E2E | 페이지 확인 후 slot 수정 시 확인 상태 무효화 |
| E2E | 모든 page 확인 전 전체 승인 차단 |
| E2E | 전체 승인 후 draft task 진행·완료·report 이동 |
| E2E | draft generation 실패 후 승인 version 유지·재시도 |
| E2E | 화면 이탈 후 프로젝트 목록에서 생성 진행률 확인 |
| 단위 | 제목·한 줄 방향 trim, 길이와 줄바꿈 검증 |
| 단위 | 목표주가 방향 enum 검증 |
| 단위 | page·block·slot 순서가 Template IR과 동일한지 검증 |
| 단위 | page validation과 전체 approval 조건 |
| 통합 | Agent 출력의 page·slot·Evidence ID 존재 검증 |
| 통합 | MappingSet 미매핑·구조 hash 변경 시 승인 차단 |
| 통합 | outline 승인 version과 report version provenance 연결 |
| 통합 | 상위 workbook·valuation 변경 시 outline invalidation |
| 동시성 | 오래된 outline version patch의 `409` 처리 |
| 동시성 | 역순 autosave 응답이 최신 입력을 덮어쓰지 않음 |
| 동시성 | 동일 request ID·승인 중복 클릭의 단일 반영 |
| 보안 | 위조 owner ID, pageId, slotId, artifact key 거부 |
| 보안 | fixed slot·페이지 순서·block 좌표 변경 요청 거부 |
| 보안 | Agent prompt injection 입력과 schema 밖 출력 거부 |
| 접근성 | 아코디언 ARIA 연결, dialog focus trap·복귀 |
| 접근성 | 상태를 색상 없이 인식, 오류 요약에서 field 이동 |
| 반응형 | 1050px 이하 한 열 전환과 mobile 입력 stack |
| 회귀 | 현재 fixture의 Page 2 표 2개·차트 0개 표시 |
| 회귀 | 현재 fixture의 Page 4 표 1개·차트 1개 표시 |
| 회귀 | 원본 5페이지 PDF의 고정 5페이지가 누락되지 않음 |
