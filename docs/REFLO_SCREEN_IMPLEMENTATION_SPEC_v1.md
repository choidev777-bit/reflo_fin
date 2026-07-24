# REFLO URL별 화면 구현 명세 v1

**문서 상태:** 1차 작성·교차 검수 완료
**작성 시작일:** 2026-07-24  
**대상:** 현업 배포용 MVP  
**구현 범위:** 기존 디자이너 UI를 보존하면서 실제 인증·데이터·API·상태를 연결하기 위한 화면별 기준

## 0. 문서 역할

이 문서는 전체 화면 명세의 인덱스와 공통 작성 원칙을 관리한다. 상세 명세는 `docs/screens/` 아래에서 URL별 파일로 관리한다.

판단 우선순위는 다음과 같다.

1. [`REFLO_URL_SERVICE_BEHAVIOR_v1.md`](./REFLO_URL_SERVICE_BEHAVIOR_v1.md)의 제품 동작과 MVP 불변조건
2. [`REFLO_TECHNICAL_DECISIONS_v1.md`](./REFLO_TECHNICAL_DECISIONS_v1.md)의 확정·일단 확정 기술 결정과 delivery gate
3. [`REFLO_API_SPEC_v1.md`](./REFLO_API_SPEC_v1.md)와 [`contracts/openapi/reflo-v1.yaml`](../contracts/openapi/reflo-v1.yaml)의 HTTP 계약
4. 현재 `source-react`의 화면 디자인과 상호작용
5. 각 URL 상세 명세에서 확정한 구현 계약

현재 React 코드는 시각 디자인의 기준이지 제품 동작의 기준이 아니다. 하드코딩 데이터, 가짜 상태, 임시 URL, 동작하지 않는 버튼은 실제 구현으로 교체한다. 화면 구조·크기·색상·간격은 별도 사유가 없는 한 유지한다.

API 경로는 프론트엔드와 백엔드가 공유할 애플리케이션 계약이다. 인증 라이브러리나 백엔드 프레임워크를 나중에 변경하더라도 명세에 정의한 사용자 동작은 유지한다.

## 1. URL별 문서와 작성 상태

| 순서 | URL | 화면 | 상세 문서 | 상태 |
|---|---|---|---|---|
| 01 | `/` | 홈 | [`screens/01-home.md`](./screens/01-home.md) | 1차 작성 완료 |
| 02 | `/projects` | 프로젝트 목록 | [`screens/02-projects.md`](./screens/02-projects.md) | 1차 작성 완료 |
| 03 | `/projects/:projectId/process/setup` | 프로젝트 설정 | [`screens/03-setup.md`](./screens/03-setup.md) | 1차 작성 완료 |
| 04 | `/projects/:projectId/process/files` | 파일 업로드·검사 | [`screens/04-files.md`](./screens/04-files.md) | 1차 작성 완료 |
| 05 | `/projects/:projectId/process/hypothesis` | 투자 의견·조사 질문 | [`screens/05-hypothesis.md`](./screens/05-hypothesis.md) | 1차 작성 완료 |
| 06 | `/projects/:projectId/process/research-plan` | 자료 수집 및 계획 | [`screens/06-research-plan.md`](./screens/06-research-plan.md) | 1차 작성 완료 |
| 07 | `/projects/:projectId/process/validation` | 조사 결과 검증 | [`screens/07-validation.md`](./screens/07-validation.md) | 1차 작성 완료 |
| 08 | `/projects/:projectId/process/valuation` | PER 밸류에이션 | [`screens/08-valuation.md`](./screens/08-valuation.md) | 1차 작성 완료 |
| 09 | `/projects/:projectId/process/report-outline` | 페이지 내용 설정 | [`screens/09-report-outline.md`](./screens/09-report-outline.md) | 1차 작성 완료 |
| 10 | `/projects/:projectId/report` | 보고서 편집·검증·내보내기 | [`screens/10-report.md`](./screens/10-report.md) | 1차 작성 완료 |

10개 URL 문서의 1차 작성은 끝났다. 이후 상세 문서를 변경하면 이 인덱스의 공통 계약과 충돌하지 않는지 함께 확인한다.

## 2. URL 상세 명세의 공통 구성

각 화면 문서는 다음 항목을 같은 순서로 기록한다.

1. 화면 목적과 접근 권한
2. 사용자 상태별 화면
3. 기본 사용자 흐름과 URL 이동
4. 기존 디자인 재사용·변경·제거 판정
5. 목표 컴포넌트 구성
6. 버튼·입력·표·모달 등 UI 요소 계약
7. 화면 데이터와 클라이언트 상태
8. API 요청·응답·오류 계약
9. 저장 모델과 권한 규칙
10. 화면에 들어가는 기술과 들어가면 안 되는 기술
11. 로딩·빈 상태·오류·예외 처리
12. 현재 프로토타입과 목표 구현의 차이
13. 구현 순서, 완료 조건, 자동 테스트
14. 아직 필요한 제품·기술 결정

## 3. HTML·React 코드 기록 원칙

기존 React 코드를 문서에 통째로 복사하지 않는다. 코드와 문서가 따로 변경되어 불일치하는 문제를 막기 위해 UI 요소는 계약 표로 기록한다.

버튼과 입력 요소에는 필요한 경우 다음 정보를 적는다.

- 컴포넌트명
- 의미에 맞는 HTML 요소
- 표시 문구와 접근성 이름
- `type`, `name`, `autocomplete` 같은 핵심 속성
- 노출·활성·비활성 조건
- 클릭·입력·제출 이벤트
- 연결하는 상태와 API
- 검증 규칙과 오류 표시 위치

포커스 처리, 접근성 구조, 브라우저 기본 동작처럼 표만으로 오해하기 쉬운 부분에만 짧은 JSX 예시를 사용한다.

## 4. 화면 간 공통 불변조건

- 로그인은 Google 계정만 사용한다.
- 모든 프로젝트·파일·산출물은 검증된 로그인 세션의 사용자 소유권으로 서버에서 격리한다.
- 클라이언트가 전달한 사용자 ID나 프로젝트 소유권을 신뢰하지 않는다.
- 서버가 발급한 실제 `projectId`만 URL에 사용한다.
- 상위 단계 데이터 변경으로 하위 결과가 무효화되면 `재검증 필요` 상태를 표시한다.
- 화면에 보이는 버튼은 실제 동작을 갖거나 제거한다.
- 하드코딩 데이터는 API 응답 또는 명시적인 정적 카피로 구분한다.
- React workbook grid, PDF·Excel 워커, Temporal, Agent 코드는 실제 사용하는 URL에만 배치한다.
- 디자이너의 레이아웃과 시각 표현은 기능·접근성·요구사항 충돌이 없는 한 유지한다.

## 5. canonical workflow 계약

`REFLO_URL_SERVICE_BEHAVIOR_v1.md`의 명칭과 순서를 모든 화면, API와 테스트에서 사용한다.

| 순서 | `stageKey` | 표시명 | route |
|---|---|---|---|
| 01 | `setup` | 프로젝트 설정 | `/projects/{projectId}/process/setup` |
| 02 | `files` | 파일 업로드·검사 | `/projects/{projectId}/process/files` |
| 03 | `hypothesis` | 투자 의견·조사 질문 | `/projects/{projectId}/process/hypothesis` |
| 04 | `research_plan` | 자료 수집 및 계획 | `/projects/{projectId}/process/research-plan` |
| 05 | `validation` | 조사 결과 검증 | `/projects/{projectId}/process/validation` |
| 06 | `valuation` | PER 밸류에이션 | `/projects/{projectId}/process/valuation` |
| 07 | `report_outline` | 페이지 내용 설정 | `/projects/{projectId}/process/report-outline` |

`/projects/{projectId}/report`는 7단계 완료 뒤 사용하는 산출물 편집·검증·내보내기 workspace다. process 단계 수나 진행률에 여덟 번째 단계처럼 포함하지 않는다.

- `currentStage`, `requiredStage`와 `stageStates[].stage`는 위 snake_case `stageKey`만 사용한다.
- 브라우저 route segment는 표의 kebab-case 경로를 사용한다.
- 진행률과 `resumeRoute`는 서버가 완료·무효화 상태로 계산한다. 클라이언트가 URL 숫자나 과거 13단계 인덱스로 계산하지 않는다.
- 완료된 이전 단계는 다시 열 수 있고, 잠긴 미래 단계는 직접 URL에서도 같은 server guard를 거친다.
- valuation 다음에는 별도 Evidence Review 단계를 두지 않고 `report-outline`으로 이동한다.
- validation의 다음 동작과 valuation의 다음 동작은 완료 모달 없이 각각 valuation과 report-outline으로 직접 이동한다.

## 6. 공통 데이터·API 표기 계약

### 6.1 path parameter

- 화면 route 제목처럼 route pattern을 설명할 때는 `:projectId`를 사용할 수 있다.
- 실제 이동 예시는 `/projects/{projectId}/...`로 적는다.
- API 명세의 path parameter는 `/api/projects/{projectId}/...`처럼 중괄호로 통일한다.
- 응답의 `nextRoute`와 `resumeRoute`는 같은 origin의 허용된 실제 URL만 반환한다.

### 6.2 프로젝트 context

화면 간 전달되는 프로젝트 context의 최소 표기는 다음과 같다.

```json
{
  "projectId": "prj_01...",
  "company": {
    "companyId": "cmp_01...",
    "name": "삼성전기",
    "ticker": "009150",
    "exchange": "KRX"
  },
  "targetPeriod": {
    "year": 2026,
    "quarter": 2
  },
  "cutoffDate": "2026-07-17",
  "reportType": "EARNINGS_REVIEW",
  "companyDomain": "IT_MANUFACTURING",
  "valuationMethod": "PER",
  "currentStage": "research_plan"
}
```

- `targetPeriod`는 API와 저장 계약에서 `{ year, quarter }` 객체다. `2Q26`, `2026Q2`, `2026 2Q`는 화면 표시용 label일 뿐 저장값이 아니다.
- 사용자가 입력하는 값은 date-only `cutoffDate`다. TD-015에 따라 서버가 `Asia/Seoul` 날짜의 마지막 시각을 권위 `cutoffAt`으로 파생하며 클라이언트가 `cutoffAt`을 권위값으로 보내지 않는다.
- API enum은 `EARNINGS_REVIEW`, `IT_MANUFACTURING`, `PER`처럼 명세의 대문자 값을 사용하고 화면에서 한글 label로 변환한다.
- opaque identity는 `...Id`로 표기한다. immutable version은 opaque `...VersionId` 또는 `{ resourceId, version }` 쌍으로 참조한다. 숫자 `version` 또는 `revision`은 해당 프로젝트·resource 범위의 낙관적 동시성 값이며 단독 전역 식별자로 사용하지 않는다.

### 6.3 공통 오류

| HTTP | 공통 code | 의미와 화면 처리 |
|---|---|---|
| `401` | `AUTH_REQUIRED` | 현재 URL과 안전한 draft를 보존하고 Google 로그인 뒤 복귀 |
| `404` | `PROJECT_NOT_FOUND` | 없음과 타인 소유를 구분하지 않는 공통 화면 |
| `409` | `PREREQUISITE_INCOMPLETE` | `requiredStage`, `resumeRoute`, `reasonCode`를 표시하고 가장 이른 유효 단계로 이동 |
| `409` | domain version conflict | 자동 덮어쓰기 없이 최신 version 재조회 |
| `422` | domain validation failure | 관련 field·blocker 가까이에 오류 표시 |
| `429` | `RATE_LIMITED` | 재시도 가능 시각 또는 지연 안내 |
| `500`·`503` | server·dependency failure | 기존 입력 유지, 안전한 재시도 제공 |

화면별 상세 code는 공통 의미를 더 구체화할 수 있지만 HTTP 의미와 소유권 은닉 정책을 바꾸지 않는다. 새 작업 생성, 단계 완료, 승인, 재시도와 취소처럼 중복 부작용이 생길 수 있는 요청은 `Idempotency-Key` header를 사용한다. body의 `requestId`는 추적·batch dedup 보조값일 수 있지만 header를 대신하지 않는다.

## 7. 비동기 작업 공통 계약

Temporal 내부 workflow ID와 activity 이름은 브라우저에 노출하지 않는다. PostgreSQL projection과 domain API가 사용자 표시의 권위다.

공통 lifecycle:

```text
queued → running → succeeded | failed
                 ↘ cancel_requested → cancelled
```

- 영문 상태는 `cancelled`로 통일한다.
- `passed`, `blocked`, `partially_succeeded`는 lifecycle이 아니라 domain 결과다.
- `current`, `obsolete`, `revalidation_required`, `stale`은 결과의 유효성이다.
- 각 화면은 domain ID인 `inspectionId`, `generationId`, `jobId`, `taskId`, `exportId`를 유지할 수 있지만 `operationStatus`, `phase`, `progressPercent`, `heartbeatAt`, `retryable`, 사용자용 error code의 의미는 같아야 한다.
- 진행률은 완료 unit이나 versioned stage weight로 서버가 계산한다. 시간 경과로 임의 증가시키지 않는다.
- 화면 이탈·새로고침·worker 재시작 후에도 같은 projection에서 상태를 복원한다.
- TD-016에 따라 초기 구현은 active job을 3초 간격으로 확인하는 visibility-aware polling을 사용한다. hidden 상태와 terminal 상태에서는 중단하고 일시적 오류는 최대 30초까지 backoff한다.

## 8. 단계 간 version·무효화 계약

- 각 하위 산출물은 자신을 만든 상위 immutable version을 모두 참조한다.
- 상위 변경은 과거 산출물을 삭제·덮어쓰지 않고 새 version을 만든다.
- 영향을 받는 하위 단계는 `revalidation_required` 또는 `stale`로 전환한다.
- `resumeRoute`는 가장 먼저 다시 확인해야 하는 단계로 향한다.
- 보고서 draft와 export는 사용한 Template IR, MappingSet, workbook, Evidence set, valuation, outline version을 고정한다.
- 새 source나 계산 결과가 생겨도 이미 승인·내보낸 report version을 자동 변경하지 않는다.

## 9. URL별 기술 배치

| URL | 브라우저·화면 기술 | backend·worker 기술 | 넣지 않는 기술 |
|---|---|---|---|
| `/` | Next.js·React 인증/생성 UI | 세션·PostgreSQL | workbook grid, Temporal, PDF·Excel·Agent |
| `/projects` | 목록·검색·정렬·projection | PostgreSQL project/job projection | workbook grid, PDF·Excel·Agent runtime |
| `process/setup` | form·기업 검색 | 세션·PostgreSQL·기업 master | S3, Temporal, workbook grid, PDF·Excel·Agent |
| `process/files` | upload·결과 비교 UI | S3 호환 저장소, Temporal, PDF worker, ClosedXML 분석 | workbook grid |
| `process/hypothesis` | 질문 편집·승인 UI | PydanticAI Hypothesis Agent, Temporal, PostgreSQL | Research/Validation Agent, workbook grid, PDF·Excel worker |
| `process/research-plan` | 계획·source·cell metadata UI | Research/Validation Agent, network worker, Temporal, S3 | workbook grid, PDF patch·render |
| `process/validation` | Evidence viewer, React 읽기 전용 workbook grid | Validation workflow, ClosedXML, source/PDF viewer API | workbook 편집·client export |
| `process/valuation` | React workbook grid 편집 UI, 일반 React 판단 UI | ClosedXML 권위 계산·저장, PostgreSQL | browser 권위 계산, client XLSX export |
| `process/report-outline` | page·slot 구성 UI | Report Outline/Draft Agent, Temporal, Template IR | workbook grid, browser PDF·XLSX 생성 |
| `/report` | Template IR 기반 report editor | PDF·Excel·Agent worker, Temporal, 검증·export | workbook grid, browser 최종 export |

React workbook grid는 validation에서 읽기 전용, valuation에서 허용 셀 편집용이다. 두 화면 모두 계산 권위는 ClosedXML이며 최종 XLSX를 브라우저에서 만들지 않는다.

## 10. 확정된 MVP 구현 기본값

- 인증은 Google 로그인만 제공하고 PostgreSQL 기반 불투명 server session을 사용한다. 세부 계약은 TD-014를 따른다.
- 보고서 기준일은 `Asia/Seoul`의 date-only 입력과 KST 일말 `cutoffAt`을 사용한다. 세부 계약은 TD-015를 따른다.
- 작업 진행 상태는 3초 visibility-aware polling으로 조회한다. SSE·WebSocket은 초기 구현 범위가 아니다.
- React workbook grid는 validation에서 읽기 전용, valuation에서 허용 셀만 편집 가능하게 사용한다.
- Agent는 PydanticAI와 OpenAI GPT provider를 사용한다. 정확한 GPT model ID와 비용 한도는 Agent별 평가 후 server configuration으로 고정한다.

## 11. 교차 검수 결과와 남은 결정

2026-07-24에 10개 URL 명세를 함께 검수해 단계명, stage key, route 전이, path parameter, 소유권 오류, 비동기 취소 상태와 기술 위치를 이 문서의 공통 계약으로 통일했다.

10개 URL의 application contract 구현을 막는 미결정 항목은 없다.

- Google OIDC·PostgreSQL 도구는 TD-018에서 exact version까지 확정했다.
- 파일 입력 한도·악성 검사·지원 형식·취소는 TD-019를 따른다.
- Validation 충분성·조건부 확인·decision 사유는 TD-020을 따른다.
- workbook read model, Decimal·반올림·민감도·현재주가는 TD-021을 따른다.
- Report editor·PDF viewer·edit lease·import·보존은 TD-022를 따른다.
- Agent model·package·timeout·비용·raw 보존은 TD-023을 따른다.

AGPL-3.0 대응 소스 공개, third-party notice, production provider·resource sizing, 실제 PDF·workbook 표본 회귀와 법적 보존기간은 production deployment gate다. 구현 contract를 다시 미정 상태로 만들지 않는다. polling 부하나 사용자 지연이 측정 기준을 넘을 때만 TD-016을 새 decision으로 개정해 SSE·WebSocket을 검토한다.
