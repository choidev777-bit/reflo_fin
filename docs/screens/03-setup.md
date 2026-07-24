# REFLO 화면 구현 명세: `/projects/:projectId/process/setup` 프로젝트 설정

**문서 상태:** 1차 작성 완료

**작성일:** 2026-07-24

**대상:** 현업 배포용 MVP

**상위 문서:** [`REFLO_SCREEN_IMPLEMENTATION_SPEC_v1.md`](../REFLO_SCREEN_IMPLEMENTATION_SPEC_v1.md)

**기준 문서:** [`REFLO_URL_SERVICE_BEHAVIOR_v1.md`](../REFLO_URL_SERVICE_BEHAVIOR_v1.md), [`REFLO_TECHNICAL_DECISIONS_v1.md`](../REFLO_TECHNICAL_DECISIONS_v1.md)

## 1. `/projects/:projectId/process/setup` — 프로젝트 설정

### 1.1 명세 상태

| 항목 | 값 |
|---|---|
| URL | `/projects/:projectId/process/setup` |
| 접근 권한 | Google 로그인 사용자 중 해당 프로젝트 소유자 |
| 주요 목적 | 분석 기업, 대상 연도·분기, 보고서 기준일과 MVP 분석 범위를 확정 |
| 진입 전제 | 서버가 발급한 실제 `projectId`가 존재하고 로그인 사용자가 프로젝트를 소유 |
| 다음 URL | `/projects/{projectId}/process/files` |
| 현재 route 파일 | `source-react/app/projects/[projectId]/process/setup/page.tsx` |
| 현재 route 동작 | 전용 화면 없이 `source-react/app/page.tsx`를 다시 내보냄 |
| 현재 주요 컴포넌트 | `Home`, `PlannedProcessPage`, `ProjectSetup`, `ScreenHead` |
| 기준 요구사항 | 서비스 동작 명세 2장, 3장, 5장, 8장, 19장 |
| 관련 기술 결정 | TD-011의 PostgreSQL 소유권·작업 상태 원칙, TD-014 인증·세션, TD-015 기준일 |
| 구현 상태 | 디자이너 프로토타입만 존재, 인증·소유권·기업 검색·저장 API 미구현 |

### 1.2 목적과 책임

이 화면은 새 프로젝트의 첫 번째 process 단계다. 다음 항목을 서버의 프로젝트 설정으로 확정한다.

1. DART 기업정보와 허용 거래소 종목정보에 연결된 상장 기업
2. 분석 대상 연도
3. 분석 대상 분기
4. 이후 자료 수집의 컷오프가 되는 보고서 기준일
5. MVP 고정 범위인 `실적 Review`, `IT 제조업`, `PER`

이 화면은 프로젝트 이름을 새로 만들거나 수정하지 않는다. 프로젝트 이름은 홈 또는 프로젝트 목록의 프로젝트 생성 흐름에서 이미 저장되어 있다.

이 화면에서는 파일 업로드, PDF·Excel 분석, 조사 질문 생성, 자료 수집, Excel 계산을 시작하지 않는다. 설정 저장과 다음 단계의 잠금 해제까지만 담당한다.

### 1.3 진입 조건

#### 허용 진입

- 홈 또는 프로젝트 목록에서 프로젝트 초안을 만든 직후 실제 `projectId`로 진입한다.
- 프로젝트 목록에서 설정이 미완료된 프로젝트를 이어서 열 수 있다.
- 파일 업로드 이후 단계까지 진행한 소유자가 설정을 다시 확인하거나 수정하기 위해 돌아올 수 있다.
- 소유자는 주소를 직접 입력해 이 URL에 진입할 수 있다.

#### 인증과 소유권

| 상황 | 처리 |
|---|---|
| 비로그인 | Google 로그인으로 이동하고 성공 후 원래 setup URL로 복귀 |
| 로그인·소유권 일치 | setup 데이터 조회 후 화면 표시 |
| 로그인·프로젝트 없음 | 프로젝트를 찾을 수 없는 상태 표시 후 `/projects` 이동 제공 |
| 로그인·다른 사용자 프로젝트 | 존재 여부를 노출하지 않도록 프로젝트 없음과 같은 `404` 처리 |
| 세션 만료 | 현재 입력을 메모리에 유지하고 재로그인 후 저장 재시도 |

클라이언트가 전달한 사용자 ID나 소유자 ID는 사용하지 않는다. URL의 `projectId`와 검증된 로그인 세션을 서버에서 대조한다.

#### 잘못된 URL

- `"new"`는 유효한 프로젝트 식별자가 아니다.
- `/projects/new/process/setup`은 프로젝트 생성 API로 대체해야 하는 현재 프로토타입의 임시 URL이다.
- 형식이 잘못됐거나 존재하지 않는 `projectId`를 임의의 빈 프로젝트로 바꾸지 않는다.

### 1.4 이탈 조건과 URL 이동

| 동작 | 조건 | 결과 |
|---|---|---|
| `프로젝트로 돌아가기` | 소유권 확인 완료 | 저장 가능한 최신 변경을 먼저 반영한 뒤 `/projects` 이동 |
| `Process` | 항상 | 현재 setup URL 유지 |
| `Report` | 생성된 보고서 버전이 있을 때만 | `/projects/{projectId}/report` 이동 |
| 사이드바 이전·완료 단계 | 서버가 해당 단계 접근을 허용 | 해당 process URL 이동 |
| 사이드바 잠긴 이후 단계 | 선행 조건 미충족 | 비활성 상태 유지, 이동하지 않음 |
| 하단 다음 버튼 | 필수 설정이 서버 검증을 통과 | 설정 완료 처리 후 `/projects/{projectId}/process/files` 이동 |
| 브라우저 뒤로 가기 | 라우터 이력 존재 | 이전 URL 이동, 저장 실패 상태면 이탈 경고 |

`프로젝트로 돌아가기`와 다음 단계 이동은 입력 후 예약된 자동 저장을 먼저 정리한다. 다음 단계 이동은 화면의 로컬 상태만 믿지 않고 전체 설정을 서버에서 원자적으로 저장·검증한 성공 응답 뒤에 수행한다.

탭 닫기나 브라우저 강제 종료 시 `pagehide` 전송은 보조 수단으로만 사용할 수 있다. 저장되지 않은 값을 보장하는 유일한 수단으로 사용하지 않는다.

### 1.5 기본 사용자 흐름

#### 최초 설정

```text
setup 진입
  → 프로젝트와 기존 setup 조회
  → 기업명 또는 종목코드 검색
  → 지원 가능한 상장 기업 선택
  → 종목코드·거래소 자동 표시
  → 연도·분기·보고서 기준일 입력
  → MVP 고정 범위 확인
  → 자동 저장
  → 서버 최종 검증
  → 파일 업로드 단계 이동
```

#### 완료된 설정 수정

```text
완료된 setup 재진입
  → 기존 값 표시
  → 값 변경
  → 하위 단계 영향 확인
  → 필요한 경우 재검증 경고와 사용자 확인
  → 새 setup version 저장
  → 영향받는 하위 단계를 재검증 필요로 전환
```

기존 파일과 하위 산출물은 삭제하지 않는다. 어떤 설정이 바뀌었고 어떤 단계가 다시 확인되어야 하는지 기록한다.

### 1.6 현재 UI 구성

현재 화면은 다음 구조를 가진다.

1. 상단 헤더
   - `프로젝트로 돌아가기`
   - `Process`, `Report`
   - 보고서 기준일
   - `작업 흐름`
2. 왼쪽 사이드바
   - 프로젝트 이름·기업·기간
   - 진행률
   - 2–2–3으로 묶은 7단계
3. 본문
   - `STEP 01`
   - `기업 · 작성 정보 입력`
   - 기업 검색
   - 기업 미선택 안내
   - 종목코드·거래소
   - 연도·분기·기준일·리포트 유형·기업 분야
4. 하단 고정 액션 바
   - 자동 저장 표시
   - `임시 저장`
   - `다음`

데스크톱의 빈 상태는 `tmp/review/step-01.png` 기준으로 확인했다. 전체 화면 스크린샷을 새로 만들지 않고 route·컴포넌트·관련 CSS와 이 상태만 대조했다.

### 1.7 기존 디자인 재사용·수정·제거 판정

| 현재 영역 | 판정 | 구현 판단 |
|---|---|---|
| 흰색 상단 헤더와 중앙 `Process`·`Report` | 재사용 | 수동 화면 전환 대신 실제 라우터와 접근 조건 연결 |
| `프로젝트로 돌아가기` | 재사용 | 저장 flush 후 `/projects` 이동 |
| `작업 흐름` 버튼·모달 | 재사용 | 서버 단계 상태 표시, 버튼의 접근성 이름 유지 |
| 검은색 왼쪽 사이드바 | 재사용 | 실제 프로젝트와 서버 단계 상태로 교체 |
| 2–2–3의 7단계 구성 | 그대로 재사용 | 문서 기준 7개 URL과 일치 |
| 단계 번호·활성 lime 표시 | 그대로 재사용 | 현재·완료·잠김 상태를 색 외 표식과 문구로도 구분 |
| 현재 단계 14% 진행 표시 | 재사용 | `1 / 7` 기준 표시, 서버 상태와 동기화 |
| `STEP 01`, 제목, 큰 작업 카드 | 그대로 재사용 | process 제목 weight 500과 현재 여백 유지 |
| 기업 검색 필드 | 재사용 | 하드코딩 필터를 서버 자동완성으로 교체 |
| lime `검색` 버튼 | 재사용 | 클릭·Enter 시 즉시 검색, 입력 중에는 debounce 검색 |
| 기업 후보 행 | 재사용 | DART·거래소 기업 검색 응답을 표시 |
| 기업 미선택 안내 | 그대로 재사용 | 검색 전 초기 안내로 사용 |
| 종목코드·거래소 read-only 필드 | 재사용 | 선택한 기업의 서버 값 표시 |
| 연도·분기 select | 재사용 | 연도는 서버 허용 목록, 분기는 `Q1`–`Q4` 계약에 연결 |
| 날짜 input | 그대로 재사용 | 필드 전체 클릭 시 date picker 열기 |
| 선택 가능한 리포트 유형 | 수정 | `실적 Review` 읽기 전용 고정값으로 교체 |
| 선택 가능한 기업 분야 | 수정 | `IT 제조업` 읽기 전용 고정값으로 교체 |
| 밸류에이션 표시 없음 | 추가 | `PER` 읽기 전용 고정값 표시 |
| 선택에 따라 뒤 구성이 달라진다는 안내 | 수정 | MVP 고정 범위와 향후 확장 미지원 사실을 짧게 표시 |
| `자동 저장됨` 고정 문구 | 수정 | `저장 중`, `저장됨`, `저장 실패` 실제 상태 표시 |
| `임시 저장` | 제거 | 모든 변경 자동 저장 원칙과 중복되고 현재 실제 저장 동작이 없음 |
| `다음` | 재사용·수정 | 서버 완료 API에 연결하고 결과가 분명한 `파일 업로드로` 문구 사용 |
| 하드코딩 `companies` 배열 | 제거 | 검색 API 응답으로 교체 |
| 모든 사이드바 단계의 무조건 클릭 | 제거 | 서버 선행 조건에 따른 잠금 적용 |
| `window.history.pushState` 기반 route 전환 | 제거 | Next.js App Router 이동으로 교체 |
| route별 `app/page.tsx` 재내보내기 | 제거 | setup 전용 route 경계와 서버 데이터 로드 구현 |

레이아웃, 색상, 카드 형태, 간격은 유지한다. 기능 요구사항과 충돌하는 선택 옵션, 가짜 상태와 빈 동작만 교체한다.

프로젝트 설정 필드 label은 `.omd/preferences.md`의 최신 setup 지침대로 `12px`을 유지한다. 다음 버튼의 현재 형태도 유지하되 chevron은 무거운 문자 화살표 대신 흰색의 얇은 선 아이콘을 사용한다.

### 1.8 목표 컴포넌트 구성

| 컴포넌트 | 책임 | 주요 입력 | 주요 출력·이벤트 |
|---|---|---|---|
| `SetupRoute` | 세션·소유권·초기 setup을 서버에서 확인 | `params.projectId`, 세션 쿠키 | 초기 화면 또는 인증·404 처리 |
| `ProcessShell` | 상단 헤더, 사이드바, 본문, 하단 액션 배치 | 프로젝트 요약, workflow 상태 | 프로젝트·단계·보고서 이동 |
| `WorkflowSidebar` | 7단계와 진행률·잠금 상태 표시 | `stageStates`, `currentStage` | 허용된 단계 이동 |
| `ProjectSetupScreen` | setup 입력과 저장 상태 조정 | 초기 `setup`, `projectVersion` | draft 저장, 완료 요청 |
| `CompanyCombobox` | 기업 검색·후보 선택 | 선택 기업, 검색 함수 | `companyId` 선택·해제 |
| `SelectedCompanyMeta` | 종목코드·거래소 표시 | 선택 기업 | 없음 |
| `TargetPeriodFields` | 연도·분기·기준일 입력 | 값, 허용 연도 | 값 변경 |
| `FixedAnalysisContext` | `실적 Review`·`IT 제조업`·`PER` 표시 | 서버 고정값 | 없음 |
| `AutosaveStatus` | 저장 진행·성공·실패 표시 | 저장 상태·시각·오류 | 재시도 |
| `SetupStepFooter` | 다음 단계 이동 | 유효성·저장 상태 | setup 완료 |
| `DownstreamInvalidationDialog` | 기존 하위 결과 영향 확인 | 영향 단계·변경 필드 | 계속 변경·취소 |
| `SetupErrorState` | 초기 조회 실패와 복구 표시 | 오류 코드 | 다시 시도·목록 이동 |

`ProcessShell`과 `WorkflowSidebar`는 다른 process 화면과 공유한다. `ProjectSetupScreen`의 필드 상태를 공용 shell 전체의 대형 state에 섞지 않는다.

### 1.9 화면 데이터

#### 초기 서버 데이터

| 데이터 | 필드 | 용도 |
|---|---|---|
| 프로젝트 | `projectId`, `name`, `status`, `currentStage`, `version`, `updatedAt` | 헤더·사이드바·저장 동시성 |
| setup | `company`, `targetPeriod`, `cutoffDate`, `reportType`, `companyDomain`, `valuationMethod`, `status`, `version` | 입력 초기값과 완료 여부 |
| 선택 기업 | `companyId`, `corpCode`, `name`, `ticker`, `exchange`, `industry`, `mvpEligible` | 기업 표시와 검증 |
| workflow | `stageStates`, `allowedRoutes`, `downstreamImpact` | 단계 이동·진행률·재검증 안내 |
| 지원 값 | `supportedTargetYears` | 연도 select 구성 |

`reportType`, `companyDomain`, `valuationMethod`의 서버 값은 각각 `EARNINGS_REVIEW`, `IT_MANUFACTURING`, `PER`다. 화면은 이를 한글 표시값으로 바꾸되 사용자가 수정하는 필드로 만들지 않는다.

#### 기업 검색 응답

| 필드 | 의미 |
|---|---|
| `companyId` | REFLO 기업 마스터의 불투명 식별자 |
| `corpCode` | DART 기업 코드 |
| `name` | 정식 기업명 |
| `ticker` | 종목코드 |
| `exchange` | 허용 거래소 |
| `industry` | 동기화된 업종 분류 |
| `listed` | 상장 여부 |
| `mvpEligible` | IT 제조업 MVP 선택 가능 여부 |
| `ineligibilityReason` | 선택할 수 없는 경우의 짧은 이유 |

현재 React의 기업명, 종목코드, 거래소와 업종 문자열은 예시 데이터다. 정적 데이터로 남기지 않는다.

#### 정적 데이터

- 화면 제목과 설명
- 분기 표시명 `1분기`–`4분기`
- 고정 범위의 한글 표시명
- 기업 미선택 안내
- 필드별 입력 안내

### 1.10 클라이언트 상태

| 상태 | 타입 | 초기값 | 설명 |
|---|---|---|---|
| `form` | `SetupDraft` | 서버 setup | 저장할 전체 설정 |
| `companyQuery` | string | 선택 기업명 또는 `""` | 기업 검색어, 저장 대상 아님 |
| `companyOptions` | `CompanyOption[]` | `[]` | 현재 검색 후보 |
| `companySearchStatus` | `idle \| loading \| success \| error` | `idle` | 자동완성 상태 |
| `activeCompanyOption` | number 또는 null | null | 키보드 탐색 후보 |
| `fieldErrors` | 필드별 문자열 | `{}` | 서버·클라이언트 검증 오류 |
| `saveStatus` | `clean \| dirty \| saving \| saved \| error` | `clean` | 자동 저장 상태 |
| `projectVersion` | number | 서버 값 | 낙관적 동시성 |
| `lastSavedAt` | ISO 시각 또는 null | 서버 값 | 저장 완료 표시 |
| `pendingSave` | 변경 snapshot 또는 null | null | debounce 중인 저장 |
| `invalidationPrompt` | 영향 정보 또는 null | null | 하위 결과 변경 확인 |
| `completeStatus` | `idle \| submitting \| error` | `idle` | 다음 단계 이동 상태 |

검색 요청과 저장 요청은 서로 다른 요청 순서를 관리한다. 오래된 검색 응답이나 저장 응답이 최신 입력을 덮어쓰지 않게 한다.

### 1.11 기업 검색 UI 계약

#### 검색 필드

| 항목 | 계약 |
|---|---|
| component | `CompanyCombobox` |
| HTML 의미 | `input[type="search"]` + combobox·listbox 패턴 |
| label | `기업명` |
| required | 예 |
| name | `companyQuery` |
| autocomplete | `off` |
| placeholder | `기업명 또는 종목코드를 입력하세요` |
| 검색 시작 | 앞뒤 공백 제거 후 1자 이상 |
| 자동 검색 | 마지막 입력 뒤 약 250ms |
| 즉시 검색 | `검색` 클릭 또는 Enter |
| 선택 해제 | 선택된 기업명을 편집하면 기존 `companyId` 제거 |
| 오류 위치 | 검색 필드 바로 아래 |

`aria-expanded`, `aria-controls`, `aria-activedescendant`와 후보 `role="option"`을 사용한다. Arrow Up·Down으로 후보 이동, Enter로 선택, Escape로 목록 닫기를 지원한다.

#### 검색 버튼

| 항목 | 계약 |
|---|---|
| 요소 | `button[type="button"]` |
| 표시 문구·접근성 이름 | `검색` |
| 활성 조건 | 정규화된 검색어 1자 이상, 완료 요청 중이 아님 |
| 클릭 | 현재 검색어로 debounce를 기다리지 않고 즉시 요청 |
| loading | 중복 요청을 만들지 않고 진행 상태 표시 |

#### 후보 목록

| 상태 | 화면 |
|---|---|
| 검색 전 | 현재 기업 미선택 안내 유지 |
| 검색 중 | 최종 후보 행 크기의 skeleton 표시 |
| 결과 있음 | 기업명, 종목코드, 거래소와 선택 가능 여부 표시 |
| 결과 없음 | `검색 결과가 없습니다`와 검색어 수정 안내 |
| 검색 실패 | 입력은 유지하고 `다시 검색` 제공 |
| MVP 미지원 | 후보는 볼 수 있지만 비활성 처리하고 사유 표시 |

후보 전체 행은 최소 44px 상호작용 영역을 갖는다. `mvpEligible=false` 후보는 클라이언트에서 선택하지 못하게 하고 서버도 같은 조건을 다시 검사한다.

#### 기업 선택 결과

- 기업명은 검색 필드에 유지한다.
- 종목코드와 거래소를 서버 응답으로 자동 표시한다.
- 종목코드와 거래소는 회색 입력처럼 보이는 편집 컨트롤이 아니라 명확한 읽기 전용 값으로 표시한다.
- 기업명 문자열만 직접 입력한 상태는 선택 완료가 아니다. `companyId`가 있어야 한다.
- 새 기업을 선택하면 파일 업로드 이후 모든 기업 종속 결과가 재검증 대상이다.

### 1.12 입력·고정값 UI 계약

| ID | 필드 | UI | 저장 값 | 검증 | 오류 위치 |
|---|---|---|---|---|---|
| SETUP-FIELD-01 | 기업명 | 검색 combobox | `companyId` | 상장·MVP 지원 기업 선택 | 검색 필드 아래 |
| SETUP-FIELD-02 | 종목코드 | read-only text | 선택 기업의 `ticker` | 서버 기업 마스터 값 | 기업 선택 오류와 함께 |
| SETUP-FIELD-03 | 거래소 | read-only text | 선택 기업의 `exchange` | 허용 거래소 | 기업 선택 오류와 함께 |
| SETUP-FIELD-04 | 분석 대상 연도 | `select` | 정수 연도 | `supportedTargetYears` 중 하나 | 필드 아래 |
| SETUP-FIELD-05 | 분기 | `select` | `Q1 \| Q2 \| Q3 \| Q4` | 네 값 중 하나 | 필드 아래 |
| SETUP-FIELD-06 | 보고서 기준일 | `input[type="date"]` | `YYYY-MM-DD` | 유효한 달력 날짜 | 필드 아래 |
| SETUP-FIXED-01 | 리포트 유형 | read-only context | `EARNINGS_REVIEW` | 서버 고정 | 화면 상단 오류 |
| SETUP-FIXED-02 | 기업 분야 | read-only context | `IT_MANUFACTURING` | 서버 고정 | 화면 상단 오류 |
| SETUP-FIXED-03 | 밸류에이션 | read-only context | `PER` | 서버 고정 | 화면 상단 오류 |

연도·분기·기준일은 기업을 선택한 뒤 표시하는 현재 점진적 공개 방식을 유지한다. 재진입 시 저장된 값이 있으면 바로 표시한다.

날짜 필드의 어느 위치를 클릭해도 지원 브라우저에서는 picker가 열린다. 키보드 입력과 브라우저 기본 날짜 접근성도 유지한다.

고정값은 disabled select로 만들지 않는다. 선택할 수 있는 것처럼 보이지 않는 읽기 전용 context 행으로 표시한다. 아직 지원하지 않는 리포트 유형, 업종과 밸류에이션 선택지를 DOM에 숨겨 둔 채 활성화하지 않는다.

보고서 기준일의 미래 허용 범위와 대상 연도·분기와의 시간 관계는 기준 문서에 아직 확정되어 있지 않다. 구현 전 제품 규칙을 추가 확정해야 하며, 그전에는 유효한 날짜 형식과 필수 입력만 검사한다.

### 1.13 버튼과 상호작용 계약

| ID | 화면 요소 | 노출·활성 조건 | 동작 | 성공 결과 | 실패 처리 |
|---|---|---|---|---|---|
| SETUP-BTN-01 | `프로젝트로 돌아가기` | 초기 조회 완료 | 예약 저장을 flush하고 `/projects` 이동 | 프로젝트 목록 표시 | 저장 실패 시 이탈 여부 확인 |
| SETUP-BTN-02 | `Process` | 항상 | 현재 setup route 유지 | 현재 탭 유지 | 없음 |
| SETUP-BTN-03 | `Report` | 보고서 버전 존재 | 보고서 URL 이동 | 보고서 표시 | 미생성 상태에서는 disabled와 이유 제공 |
| SETUP-BTN-04 | `작업 흐름` | 초기 조회 완료 | workflow 모달 열기 | 7단계 상태 표시 | 없음 |
| SETUP-BTN-05 | 기업 `검색` | 검색어 1자 이상 | 기업 검색 즉시 실행 | 후보 표시 | 필드 아래 오류·재시도 |
| SETUP-BTN-06 | 기업 후보 | 후보가 `mvpEligible` | 기업 선택 | 코드·거래소와 나머지 필드 표시 | 미지원 후보는 비활성·사유 |
| SETUP-BTN-07 | 자동 저장 `다시 시도` | 최근 저장 실패 | 최신 form snapshot 저장 | `저장됨` 표시 | 같은 오류 유지 |
| SETUP-BTN-08 | 사이드바 단계 | 서버 접근 허용 | 해당 route 이동 | 단계 화면 표시 | 잠긴 단계는 이동 없음 |
| SETUP-BTN-09 | `파일 업로드로` | 필수값이 클라이언트에서 유효 | 전체 snapshot 저장·완료 요청 | files URL 이동 | 화면 유지, 필드 또는 전역 오류 |
| SETUP-BTN-10 | 재검증 경고 `취소` | 경고 모달 열림 | 변경 취소·서버 값 복원 | 모달 닫힘 | 없음 |
| SETUP-BTN-11 | 재검증 경고 `변경 계속` | 경고 모달 열림 | 하위 단계 무효화 확인과 저장 | 새 version·재검증 상태 표시 | 모달 유지·재시도 |

완료 요청 중에는 입력, 후보 선택과 이중 제출을 잠근다. 다음 버튼 클릭과 form Enter 제출은 같은 완료 로직을 사용한다.

하단의 활성 다음 버튼은 기존 process footer 형태를 유지하고 텍스트와 흰색 얇은 chevron을 함께 중앙 정렬한다. 비활성 상태는 회색과 명시적인 disabled 속성을 사용한다.

### 1.14 자동 저장 계약

모든 변경사항은 서버에 자동 저장한다.

1. 기업 선택, select 변경과 날짜 변경을 `dirty`로 표시한다.
2. 연속 입력은 마지막 변경 후 약 500ms에 하나의 PATCH로 묶는다.
3. 필드 blur, 프로젝트 목록 이동과 다음 단계 이동에서는 예약 저장을 즉시 실행한다.
4. 검색어 자체는 저장하지 않고 선택한 `companyId`만 저장한다.
5. 불완전한 setup도 draft로 저장할 수 있다.
6. 각 요청은 예상 `projectVersion`을 포함한다.
7. 성공 응답의 새 version과 `savedAt`만 최신 저장 상태로 반영한다.
8. 실패 시 입력값을 지우지 않고 `저장 실패`와 재시도를 표시한다.
9. 오래된 응답은 최신 form을 덮어쓰지 않는다.
10. 다음 단계 이동은 debounce 저장 성공 여부와 무관하게 전체 최신 snapshot을 완료 API에 다시 포함한다.

`자동 저장됨`은 서버 성공 응답이 있을 때만 표시한다. 화면 진입 직후, 저장 중 또는 네트워크 오류 상태에 고정 문구를 보여주지 않는다.

### 1.15 API 계약

API 경로는 프론트엔드와 백엔드가 공유할 애플리케이션 계약이다. 저장 구현은 PostgreSQL을 사용하지만 브라우저가 데이터베이스에 직접 접근하지 않는다.

#### `GET /api/projects/{projectId}/process/setup`

프로젝트 소유권을 확인하고 setup 초기 데이터를 반환한다.

성공 응답 예:

```json
{
  "project": {
    "projectId": "prj_01...",
    "name": "삼성전기 2026년 2분기 리서치",
    "status": "draft",
    "currentStage": "setup",
    "version": 3,
    "updatedAt": "2026-07-24T12:00:00Z"
  },
  "setup": {
    "company": null,
    "targetPeriod": null,
    "cutoffDate": null,
    "reportType": "EARNINGS_REVIEW",
    "companyDomain": "IT_MANUFACTURING",
    "valuationMethod": "PER",
    "status": "draft",
    "version": 1
  },
  "workflow": {
    "stageStates": [],
    "allowedRoutes": [
      "/projects/prj_01.../process/setup"
    ],
    "downstreamImpact": []
  },
  "supportedTargetYears": [2025, 2026]
}
```

`supportedTargetYears`의 값은 예시다. 현재 연도를 기준으로 클라이언트가 임의 생성하지 않고 서버의 제품 정책을 사용한다.

| 상태 코드 | 오류 코드 | 화면 처리 |
|---|---|---|
| `401` | `AUTH_REQUIRED` | 로그인 후 같은 URL 복귀 |
| `404` | `PROJECT_NOT_FOUND` | 프로젝트 없음 상태와 목록 이동 |
| `429` | `RATE_LIMITED` | 잠시 후 다시 시도 |
| `500` | `SETUP_LOAD_FAILED` | 페이지 단위 재시도 |

#### `GET /api/companies/search`

기업명 또는 종목코드 자동완성을 조회한다.

| 쿼리 | 필수 | 규칙 |
|---|---|---|
| `q` | 예 | trim 후 1자 이상, 최대 40자 |
| `limit` | 아니요 | 기본 10, 최대 20 |

성공 응답 예:

```json
{
  "query": "삼",
  "items": [
    {
      "companyId": "cmp_01...",
      "corpCode": "00126380",
      "name": "삼성전자",
      "ticker": "005930",
      "exchange": "KOSPI",
      "industry": "IT 제조업 · 반도체",
      "listed": true,
      "mvpEligible": true,
      "ineligibilityReason": null
    }
  ]
}
```

검색 인덱스는 DART 기업정보와 허용 거래소 종목정보를 서버에서 동기화한다. 브라우저가 DART나 거래소를 직접 호출하지 않는다.

| 상태 코드 | 오류 코드 | 화면 처리 |
|---|---|---|
| `400` | `INVALID_COMPANY_QUERY` | 검색 필드 아래 규칙 표시 |
| `401` | `AUTH_REQUIRED` | 재로그인 |
| `429` | `RATE_LIMITED` | 입력 유지·재시도 |
| `503` | `COMPANY_SEARCH_UNAVAILABLE` | 검색 실패 안내·재시도 |

#### `PATCH /api/projects/{projectId}/process/setup`

불완전한 값을 포함한 setup draft를 자동 저장한다.

요청 예:

```json
{
  "projectVersion": 3,
  "setup": {
    "companyId": "cmp_01...",
    "targetPeriod": {
      "year": 2026,
      "quarter": 2
    },
    "cutoffDate": "2026-07-17"
  },
  "confirmDownstreamInvalidation": false
}
```

리포트 유형, 기업 분야와 밸류에이션은 클라이언트 선택값으로 받지 않는다. 서버가 MVP 고정값을 적용한다.

성공 응답 예:

```json
{
  "projectVersion": 4,
  "setupVersion": 2,
  "savedAt": "2026-07-24T12:01:00Z",
  "setupStatus": "draft",
  "complete": false,
  "invalidatedStages": []
}
```

| 상태 코드 | 오류 코드 | 화면 처리 |
|---|---|---|
| `400` | `INVALID_SETUP_FIELD` | 해당 필드 아래 오류 |
| `401` | `AUTH_REQUIRED` | 입력 유지 후 재로그인 |
| `404` | `PROJECT_NOT_FOUND` | 목록 이동 제공 |
| `409` | `STALE_PROJECT_VERSION` | 최신 setup 재조회 후 사용자 변경과 비교 |
| `409` | `DOWNSTREAM_INVALIDATION_CONFIRMATION_REQUIRED` | 영향 단계 확인 모달 |
| `422` | `UNSUPPORTED_COMPANY` | 기업 선택 해제·사유 표시 |
| `429` | `RATE_LIMITED` | 자동 재시도 지연과 수동 재시도 |
| `500` | `SETUP_SAVE_FAILED` | 입력 유지·저장 실패 표시 |

#### `POST /api/projects/{projectId}/process/setup/complete`

최신 전체 설정을 저장하고 setup 완료와 다음 단계 잠금 해제를 한 transaction으로 처리한다.

```http
POST /api/projects/prj_01.../process/setup/complete
Content-Type: application/json
Idempotency-Key: 6fc7...
```

요청 예:

```json
{
  "projectVersion": 4,
  "setup": {
    "companyId": "cmp_01...",
    "targetPeriod": {
      "year": 2026,
      "quarter": 2
    },
    "cutoffDate": "2026-07-17"
  },
  "confirmDownstreamInvalidation": false
}
```

성공 응답 예:

```json
{
  "projectVersion": 5,
  "setupVersion": 3,
  "setupStatus": "complete",
  "currentStage": "files",
  "currentRoute": "/projects/prj_01.../process/files",
  "invalidatedStages": []
}
```

같은 `Idempotency-Key`의 재전송은 단계 전환을 중복 적용하지 않고 기존 성공 결과를 반환한다.

| 상태 코드 | 오류 코드 | 화면 처리 |
|---|---|---|
| `400` | `INVALID_SETUP_FIELD` | 필드 오류 |
| `401` | `AUTH_REQUIRED` | 입력 유지 후 재로그인 |
| `404` | `PROJECT_NOT_FOUND` | 목록 이동 제공 |
| `409` | `STALE_PROJECT_VERSION` | 최신 상태 확인 후 재제출 |
| `409` | `DOWNSTREAM_INVALIDATION_CONFIRMATION_REQUIRED` | 영향 단계 확인 모달 |
| `422` | `SETUP_INCOMPLETE` | 누락 필드로 포커스 이동 |
| `422` | `UNSUPPORTED_COMPANY` | 기업 재선택 요구 |
| `429` | `RATE_LIMITED` | 잠시 후 같은 요청 식별자로 재시도 |
| `500` | `SETUP_COMPLETE_FAILED` | 화면 유지·재시도 |

### 1.16 저장 모델

PostgreSQL의 논리 모델은 최소 다음 값을 보존한다.

#### 프로젝트

| 필드 | 규칙 |
|---|---|
| `project_id` | 서버가 생성한 불투명 식별자 |
| `owner_google_user_id` | 검증된 세션에서 획득 |
| `name` | 프로젝트 생성 단계에서 저장된 이름 |
| `current_stage` | `setup` 또는 완료 후 `files` |
| `status` | `draft`, `active`, `revalidation_required` 등 |
| `version` | 동시성 제어용 증가 값 |
| `created_at`, `updated_at` | 서버 시각 |

#### 프로젝트 setup version

| 필드 | 규칙 |
|---|---|
| `setup_version_id` | 불변 version 식별자 |
| `project_id` | 소유권이 확인된 프로젝트 |
| `company_master_id` | 서버 기업 마스터 참조 |
| `target_year` | 서버 허용 연도 |
| `target_quarter` | `Q1`–`Q4` |
| `cutoff_date` | 사용자 입력 `YYYY-MM-DD` |
| `report_type` | `EARNINGS_REVIEW` |
| `company_domain` | `IT_MANUFACTURING` |
| `valuation_method` | `PER` |
| `status` | `draft` 또는 `complete` |
| `created_by` | 검증된 사용자 또는 system actor |
| `created_at` | 서버 시각 |
| `supersedes_setup_version_id` | 이전 setup version |

기업명, 종목코드, 거래소와 업종 표시값은 저장 시점의 기업 마스터 version 또는 snapshot과 연결해 이후 마스터 갱신에도 프로젝트 당시 설정을 재현할 수 있어야 한다.

하위 단계가 존재하는 상태에서 setup을 바꾸면 기존 파일과 산출물을 삭제하지 않고 새 setup version을 만든다. 영향받는 단계와 artifact에는 `revalidation_required`를 기록한다.

### 1.17 권한·보안 규칙

1. 모든 조회·검색·저장·완료 API는 검증된 Google 로그인 세션을 요구한다.
2. 프로젝트 소유권은 서버에서 `project_id`와 세션의 Google 사용자 ID로 확인한다.
3. 요청 body에서 `ownerId`, `userId`, `currentStage`, 고정 분석 범위를 받지 않는다.
4. 기업 선택은 `companyId`를 받되 서버가 상장·거래소·MVP 지원 여부를 다시 확인한다.
5. 기업명·프로젝트명·검색어와 오류 문구는 HTML로 해석하지 않고 텍스트로 렌더링한다.
6. 상태 변경 요청에는 인증 방식에 맞는 CSRF 방어를 적용한다.
7. 완료 요청은 요청 식별자와 데이터베이스 제약으로 한 번만 처리한다.
8. 다른 사용자의 프로젝트는 별도 권한 오류로 구분해 존재를 노출하지 않고 `404 PROJECT_NOT_FOUND`로 처리한다.
9. 검색 query, limit과 날짜·연도 입력은 서버에서 길이·형식·범위를 검증한다.
10. 클라이언트의 `mvpEligible`, 단계 잠금, version 값을 권한의 근거로 신뢰하지 않는다.

### 1.18 검증 규칙

#### 필드 검증

| 필드 | 클라이언트 검증 | 서버 권위 검증 |
|---|---|---|
| 기업 | 선택된 `companyId` 존재 | 기업 존재, 상장, 허용 거래소, IT 제조업 MVP 지원 |
| 연도 | 값 존재, 정수 | 서버 허용 연도 목록 포함 |
| 분기 | 값 존재 | `Q1`–`Q4` enum |
| 기준일 | `YYYY-MM-DD` 형식 | 실제 달력 날짜 |
| 고정값 | 화면 표시 확인 | 세 값이 MVP 고정값과 일치 |

문자열 기업명만 입력하고 후보를 선택하지 않은 경우 `상장 기업을 선택해 주세요`를 표시한다. 종목코드와 거래소가 비어 있으면 선택 완료로 처리하지 않는다.

클라이언트의 `canNext`는 빠른 안내용이다. 서버가 완료 가능 여부의 최종 권위다.

#### 기준일의 사용

- 저장된 기준일은 뒤 단계 자료 수집과 컨센서스 snapshot 선택의 컷오프가 된다.
- 기준일 이후 자료는 해당 보고서에 자동 포함하지 않는다.
- 날짜를 바꾸면 조사 계획, Evidence, 컨센서스 snapshot, 보고서 결과가 재검증 대상이 될 수 있다.
- `cutoff_date`는 TD-015에 따라 `Asia/Seoul` 날짜의 마지막 시각인 권위 `cutoff_at`으로 서버에서 변환한다.

### 1.19 하위 단계 무효화

다음 변경은 하위 결과에 영향을 준다.

| 변경 | 최소 영향 |
|---|---|
| 기업 | 업로드 파일 적합성부터 보고서까지 전체 하위 단계 |
| 대상 연도·분기 | 파일 기업·기간 적합성, 조사, Excel, 밸류에이션, 보고서 |
| 보고서 기준일 | 자료 수집, Evidence, 컨센서스, 검증, 보고서 |
| MVP 고정값 | 사용자가 변경할 수 없음 |

하위 작업이 아직 없으면 확인 모달 없이 저장한다. 하위 artifact 또는 완료 단계가 있으면 서버가 `DOWNSTREAM_INVALIDATION_CONFIRMATION_REQUIRED`와 영향 목록을 반환한다.

확인 모달은 다음을 표시한다.

- 바뀐 필드
- 기존 값과 새 값
- `재검증 필요`가 되는 단계
- 기존 파일·결과는 삭제되지 않는다는 설명
- `취소`, `변경 계속`

사용자가 취소하면 서버 저장값과 화면값을 이전 상태로 되돌린다. 계속하면 새 setup version을 저장하고 영향받는 단계만 `재검증 필요`로 전환한다.

### 1.20 단계 이동과 진행률

#### 7단계

| 번호 | 단계 | URL | setup에서의 상태 |
|---|---|---|---|
| 01 | 프로젝트 설정 | `process/setup` | 현재 |
| 02 | 파일 업로드·검사 | `process/files` | setup 완료 후 접근 |
| 03 | 투자 의견·조사 질문 | `process/hypothesis` | 파일 검사 완료 전 잠김 |
| 04 | 자료 수집 및 계획 | `process/research-plan` | 질문 승인 전 잠김 |
| 05 | 조사 결과 검증 | `process/validation` | 수집 실행 전 잠김 |
| 06 | PER 밸류에이션 | `process/valuation` | 검증 완료 전 잠김 |
| 07 | 페이지 내용 설정 | `process/report-outline` | 밸류에이션 완료 전 잠김 |

진행률은 현재 URL의 숫자만 비교해 계산하지 않는다. 서버의 단계 상태를 사용한다.

- 최초 setup: 현재 위치 `1 / 7`, 14%
- 완료 단계: 완료 check와 명시적인 `완료`
- 현재 단계: lime step marker와 `현재`
- 잠긴 단계: muted 처리와 `선행 단계 필요`
- 재검증 단계: 경고 아이콘과 `재검증 필요`

완료된 이전 단계로 돌아갈 수 있다. 잠긴 미래 단계는 사이드바 클릭과 직접 URL 모두에서 진입할 수 없다. 직접 URL 진입 시 서버가 가장 이른 유효 단계의 URL을 반환한다.

### 1.21 로딩·빈 상태·오류·예외 처리

| 상황 | 화면 | 후속 동작 |
|---|---|---|
| 초기 조회 중 | 헤더·사이드바·카드 최종 크기의 skeleton | 입력 비활성 |
| 새 draft·기업 미선택 | 현재 기업 선택 안내 | 검색 대기 |
| 검색어 1자 미만 | 후보 목록 닫힘 | 추가 입력 대기 |
| 기업 검색 중 | 후보 skeleton | 최신 검색만 반영 |
| 검색 결과 없음 | 빈 결과 문구 | 검색어 수정 |
| 미지원 기업 | 후보 비활성·사유 | 지원 기업 선택 |
| 기업 검색 실패 | 입력 유지·재시도 | 같은 query 재요청 |
| 자동 저장 중 | `저장 중` | 추가 변경을 다음 batch에 포함 |
| 자동 저장 실패 | `저장 실패`와 재시도 | 입력 유지 |
| stale version | 최신 서버 상태 비교 안내 | 덮어쓰기 금지, 재적용 선택 |
| 세션 만료 | 입력 유지·로그인 안내 | 재로그인 후 저장 재개 |
| 프로젝트 없음·비소유 | 같은 404 화면 | `/projects` 이동 |
| 완료 검증 실패 | 필드별 오류와 첫 오류 포커스 | 수정 후 재제출 |
| 네트워크 끊김 | offline 안내·저장 실패 | 복구 후 최신 snapshot 재시도 |
| 하위 영향 존재 | 재검증 확인 모달 | 취소 또는 확인 |
| 고정값 서버 불일치 | 페이지 단위 오류 | 입력 진행 차단·재조회 |

오류는 원인과 회복 행동을 함께 표시한다. toast만으로 필수 입력 오류나 저장 실패를 전달하지 않는다.

### 1.22 접근성·반응형 계약

#### 접근성

- 모든 field는 programmatic label을 가진다.
- 필수 표시는 색뿐 아니라 `required`와 오류 문구로 전달한다.
- combobox는 키보드 탐색과 screen reader 상태를 제공한다.
- 검색 후보와 사이드바 버튼은 최소 44px 상호작용 영역을 갖는다.
- read-only 값은 disabled input이 아니라 읽기 전용 정보 구조로 제공한다.
- 저장 상태와 완료 오류는 필요한 경우 `aria-live`로 알린다.
- 첫 완료 오류로 포커스를 이동하고 오류 요약에서 해당 필드로 이동할 수 있게 한다.
- 재검증 모달은 포커스를 가두고 닫은 뒤 변경 필드로 포커스를 돌려준다.
- 모션 감소 설정에서는 hover·상태 전환 animation을 제거한다.

#### 반응형

| 구간 | 동작 |
|---|---|
| 데스크톱 `>1024px` | 전체 사이드바, 한 줄 또는 다열 form, 고정 footer 유지 |
| 태블릿 `640–1024px` | sidebar 폭 축소, 기간 필드를 2열로 재배치 |
| 모바일 `<640px` | sidebar 숨김, `작업 흐름`으로 단계 확인, 입력 1열, 다음 버튼 full width |

모바일에서도 고정 분석 범위 세 항목을 축약해 숨기지 않는다. 1열로 쌓아 읽을 수 있게 한다.

### 1.23 필요한 추가 요소

현재 프로토타입에 없지만 실제 동작에 필요한 요소다.

1. 세션·프로젝트 초기 조회 loading과 404 화면
2. 실제 기업 검색 loading·빈 결과·오류 상태
3. MVP 미지원 기업의 disabled 상태와 이유
4. `실적 Review`·`IT 제조업`·`PER` 고정 범위 영역
5. 실제 자동 저장 상태와 재시도
6. 필드별 검증 오류
7. 하위 결과 재검증 영향 확인 모달
8. 사이드바 단계 잠금·재검증 상태
9. 저장 version 충돌 처리
10. Report 미생성 상태의 비활성 처리

이 요소는 기존 흰색 작업 카드, neutral surface, hairline과 lime 상태 신호 안에서 추가한다. 새로운 색상 체계나 무거운 shadow card를 만들지 않는다.

### 1.24 기술 배치

| 기술·영역 | setup에서의 위치 | 판단 |
|---|---|---|
| Next.js App Router | 동적 setup route, 서버 초기 데이터 로드, URL 이동 | 사용 |
| React Client Component | combobox, form, 자동 저장, 모달 | 사용 |
| 서버 인증·세션 | route와 API 소유권 확인 | 필수, 구체 라이브러리는 미확정 |
| PostgreSQL | 프로젝트, setup version, workflow 상태, 기업 마스터 metadata | 사용 |
| 기업 검색 서비스 | DART·허용 거래소 동기화 인덱스 조회 | 사용 |
| S3 호환 객체 저장소 | 없음 | 파일이 없는 단계이므로 호출하지 않음 |
| Temporal | 없음 | setup 저장은 짧은 동기 transaction |
| PDF Python 워커 | 없음 | 파일 단계 전이므로 로드·호출 금지 |
| Aspose.Cells .NET 워커 | 없음 | Excel 단계 전이므로 호출 금지 |
| SpreadJS React | 없음 | workbook UI가 없는 화면이므로 번들에 포함 금지 |
| PydanticAI Agent | 없음 | 설정 확정에 AI 사용 금지 |

#### 목표 파일 경계

- `app/projects/[projectId]/process/setup/page.tsx`
  - route parameter 수신
  - 서버 세션·소유권·초기 데이터 조회
- `app/projects/[projectId]/process/_components/ProcessShell.tsx`
  - process 공용 header·sidebar·footer
- `app/projects/[projectId]/process/setup/_components/ProjectSetupScreen.tsx`
  - setup 화면 조정
- `app/projects/[projectId]/process/setup/_components/CompanyCombobox.tsx`
  - 기업 검색 UI
- `app/projects/[projectId]/process/setup/_lib/setup-validation.ts`
  - client 공통 검증
- API route 또는 별도 backend adapter
  - 프로젝트 setup 조회·자동 저장·완료·기업 검색

실제 backend가 별도 서비스로 분리되더라도 위 route와 API 계약은 유지한다.

### 1.25 현재 프로토타입과 목표 구현의 차이

| 현재 프로토타입 | 목표 구현 | 우선순위 |
|---|---|---|
| setup route가 `app/page.tsx` 재사용 | setup 전용 route와 서버 데이터 경계 | 필수 |
| browser에서 pathname 수동 해석 | App Router params와 router 이동 | 필수 |
| `"new"` project ID 허용 | 서버 실제 `projectId`만 허용 | 필수 |
| 인증·소유권 없음 | Google 세션과 project owner 검증 | 필수 |
| 기업 7개 하드코딩 | DART·거래소 기반 검색 API | 필수 |
| 검색 버튼 동작 없음 | 자동완성·즉시 검색 동작 | 필수 |
| 비-MVP 기업도 선택 가능 | IT 제조업 MVP 대상만 완료 가능 | 필수 |
| 리포트 유형 여러 개 선택 | `실적 Review` 고정 | 필수 |
| 기업 분야 여러 개 선택 | `IT 제조업` 고정 | 필수 |
| PER 표시 없음 | `PER` 고정값 표시 | 필수 |
| 연도 2025·2026 하드코딩 | 서버 지원 연도 목록 | 필수 |
| form state가 route 이동 시 소실 | setup version 자동 저장 | 필수 |
| 항상 `자동 저장됨` | 실제 저장 상태 | 필수 |
| 가짜 `임시 저장` | 제거 | 필수 |
| 다음 버튼이 local step만 변경 | 완료 API 성공 후 files URL 이동 | 필수 |
| 모든 단계 클릭 가능 | 서버 단계 잠금 | 필수 |
| 변경 영향 처리 없음 | 하위 단계 재검증 | 필수 |
| 프로젝트명 fallback으로 ID 표시 | 실제 프로젝트 이름 표시 | 필수 |
| 대형 `app/page.tsx`·`app/process.tsx` 결합 | route·shell·screen 단위 분리 | 구현 품질 |

### 1.26 구현 순서

1. Google 인증·세션 방식과 공용 project owner guard를 확정한다.
2. PostgreSQL 프로젝트·setup version·workflow 상태 모델을 구현한다.
3. DART·허용 거래소 기업 마스터 동기화와 검색 API를 구현한다.
4. setup 조회·draft PATCH·complete POST API를 구현한다.
5. 현재 process shell의 header·sidebar·footer를 route 공용 컴포넌트로 분리한다.
6. setup route의 `app/page.tsx` 재내보내기를 전용 route 구현으로 교체한다.
7. 기존 `ProjectSetup` 디자인을 전용 screen 컴포넌트로 옮긴다.
8. 하드코딩 기업과 선택 가능한 비-MVP option을 실제 검색·고정값으로 교체한다.
9. 자동 저장, version 충돌과 하위 재검증 확인을 연결한다.
10. 다음 단계 잠금 해제와 실제 files URL 이동을 연결한다.
11. 단위·통합·E2E·접근성 테스트를 추가한다.

### 1.27 완료 조건

- [ ] 비로그인 사용자는 Google 로그인 후 원래 setup URL로 돌아온다.
- [ ] 로그인 사용자는 본인이 소유한 실제 프로젝트만 조회·수정할 수 있다.
- [ ] `"new"`와 다른 사용자 프로젝트로 setup을 만들거나 열 수 없다.
- [ ] route가 `app/page.tsx` 전체를 다시 내보내지 않는다.
- [ ] 직접 URL 진입 시 project와 기존 setup이 서버에서 로드된다.
- [ ] `삼`처럼 기업명 일부 또는 종목코드 일부로 후보를 검색할 수 있다.
- [ ] 후보 선택 시 종목코드와 거래소가 서버 값으로 표시된다.
- [ ] 기업명 문자열 입력만으로 선택 완료가 되지 않는다.
- [ ] 비상장·미지원 업종 기업은 setup 완료에 사용할 수 없다.
- [ ] 연도, 분기와 기준일이 필수로 검증된다.
- [ ] 리포트 유형은 `실적 Review`, 기업 분야는 `IT 제조업`, 밸류에이션은 `PER`로 표시·저장된다.
- [ ] 미지원 option을 선택할 수 있는 select가 남아 있지 않다.
- [ ] 변경은 draft 상태에서도 자동 저장된다.
- [ ] 실제 저장 성공 전 `자동 저장됨`을 표시하지 않는다.
- [ ] 저장 실패 시 입력값이 유지되고 재시도할 수 있다.
- [ ] 동시 탭의 stale version이 최신 설정을 조용히 덮어쓰지 않는다.
- [ ] 하위 단계가 있는 setup 변경은 영향 목록과 확인을 요구한다.
- [ ] 기존 하위 artifact를 삭제하지 않고 `재검증 필요`로 전환한다.
- [ ] 완료 API가 전체 설정을 다시 검증하고 한 번만 단계 전환한다.
- [ ] 성공 후 `/projects/{projectId}/process/files`로 이동한다.
- [ ] 필수값이 없거나 서버 검증이 실패하면 현재 화면에 머문다.
- [ ] 잠긴 미래 단계와 미생성 Report로 이동할 수 없다.
- [ ] 키보드만으로 기업 검색·선택, 필드 입력과 완료가 가능하다.
- [ ] 모바일에서 sidebar 없이도 작업 흐름과 다음 동작에 접근할 수 있다.
- [ ] setup route에서 SpreadJS, Aspose.Cells, PDF 워커, Temporal과 Agent 코드를 로드하거나 호출하지 않는다.

### 1.28 자동 테스트 시나리오

| 종류 | 시나리오 |
|---|---|
| E2E | 실제 project ID setup URL 직접 진입과 기존 값 표시 |
| E2E | 비로그인 direct URL → Google 로그인 → 동일 URL 복귀 |
| E2E | 다른 사용자 project ID가 동일한 404 처리 |
| E2E | `삼` 검색 → 삼성전자 후보 → 선택 → 코드·거래소 표시 |
| E2E | 종목코드 일부 검색 |
| E2E | 미지원 기업 후보 disabled와 이유 |
| E2E | 필수 연도·분기·기준일 누락 시 다음 비활성·오류 |
| E2E | 세 필드 입력 → 자동 저장 → 저장 완료 상태 |
| E2E | 완료 성공 → 실제 files URL 이동 |
| E2E | 완료 500 실패 → 화면·입력 유지 → 재시도 성공 |
| E2E | 이중 클릭과 재전송에도 완료 transition 한 번 |
| E2E | 완료된 setup의 기업 변경 → 재검증 모달 → 취소 |
| E2E | 완료된 setup의 기준일 변경 → 확인 → 하위 단계 재검증 표시 |
| E2E | 잠긴 사이드바 미래 단계 클릭 불가 |
| E2E | Report 미생성 상태 이동 불가 |
| 단위 | 기업 검색 query trim·1자·40자 검증 |
| 단위 | 연도 목록, 분기 enum, 날짜 형식 검증 |
| 단위 | 기업명만 있고 `companyId`가 없는 상태는 미완료 |
| 단위 | 오래된 검색 응답이 최신 후보를 덮어쓰지 않음 |
| 단위 | 오래된 저장 응답이 최신 form·version을 덮어쓰지 않음 |
| 단위 | autosave debounce와 blur·next flush |
| 통합 | setup 조회 시 세션 owner와 project owner 일치 |
| 통합 | 고정 분석 범위 조작 요청을 서버가 무시·거부 |
| 통합 | unsupported company ID 완료 거부 |
| 통합 | stale project version 충돌 |
| 통합 | 완료 transaction이 setup version·current stage를 함께 저장 |
| 통합 | 하위 artifact가 있는 변경은 확인 전 반영되지 않음 |
| 통합 | 확인 후 하위 artifact 보존과 재검증 상태 생성 |
| 보안 | 위조 owner ID, 다른 project ID, CSRF 요청 거부 |
| 보안 | 검색어·기업명·프로젝트명이 HTML로 실행되지 않음 |
| 접근성 | combobox Arrow·Enter·Escape와 screen reader 상태 |
| 접근성 | 오류 요약·첫 오류 focus·저장 상태 live announcement |
| 접근성 | 재검증 모달 focus trap·닫기·focus 복귀 |
| 반응형 | 데스크톱 sidebar와 모바일 작업 흐름 대체 동작 |
| 시각 회귀 | 초기 기업 미선택, 기업 선택 후 전체 form, 재검증 모달의 필요한 세 상태만 검사 |

### 1.29 아직 필요한 제품·기술 결정

setup의 핵심 동작은 확정할 수 있지만 다음 항목은 기준 문서에 추가 결정이 필요하다.

1. Google OAuth·세션 라이브러리와 세션 만료·갱신 정책
2. 기업 마스터의 DART·거래소 동기화 주기와 장애 시 stale 허용 범위
3. `IT 제조업` MVP 적격 업종 분류표와 경계 기업 처리
4. `supportedTargetYears`의 과거·미래 범위
5. 보고서 기준일이 미래 날짜일 때의 허용 여부
6. 대상 연도·분기와 보고서 기준일 사이의 유효 관계

날짜 변환은 TD-015에 따라 `Asia/Seoul` 일말 `cutoffAt`으로 확정됐다. 나머지 결정이 남아 있어도 기존 layout 재사용 범위, 기업 선택 필요성, MVP 고정값, 자동 저장, 소유권, 하위 재검증과 다음 단계 이동 계약은 이 명세대로 유지한다.
