# REFLO 화면 구현 명세: `/projects` 프로젝트 목록

**문서 상태:** 프로젝트 목록 명세 작성 완료

**작성일:** 2026-07-24

**대상:** 현업 배포용 MVP

**상위 문서:** [`REFLO_SCREEN_IMPLEMENTATION_SPEC_v1.md`](../REFLO_SCREEN_IMPLEMENTATION_SPEC_v1.md)

**기준 문서:** [`REFLO_URL_SERVICE_BEHAVIOR_v1.md`](../REFLO_URL_SERVICE_BEHAVIOR_v1.md), [`REFLO_TECHNICAL_DECISIONS_v1.md`](../REFLO_TECHNICAL_DECISIONS_v1.md)

## 2. `/projects` — 프로젝트 목록

### 2.1 명세 상태

| 항목 | 값 |
|---|---|
| URL | `/projects` |
| 접근 권한 | Google 로그인 필수 |
| 주요 목적 | 본인 프로젝트 조회·검색·정렬, 진행·주의 상태 확인, 마지막 유효 단계 재개, 새 리서치 시작 |
| 현재 route 파일 | `source-react/app/projects/page.tsx` |
| 현재 실제 UI 위치 | `source-react/app/page.tsx`의 `ProjectsPage` |
| 현재 주요 표시 컴포넌트 | `ProjectsPage`, `AppHeader`, `Status`, `CreateProjectDialog` |
| 기준 요구사항 | 서비스 동작 명세 2장, 3장, 5장, 7장, 19장 |
| 관련 기술 결정 | TD-011의 PostgreSQL 상태 projection·Temporal 작업 상태·소유권 검증 원칙 |
| 구현 상태 | 하드코딩 목록과 로컬 검색·정렬만 존재, 인증·실제 프로젝트·작업 상태 API 미구현 |

### 2.2 목적과 책임

프로젝트 목록은 로그인 사용자가 본인 프로젝트의 현재 상태를 한눈에 확인하고 필요한 작업으로 돌아가는 화면이다. 다음 책임을 가진다.

1. 검증된 세션 사용자가 소유한 프로젝트만 표시한다.
2. 프로젝트명·기업명·종목코드로 프로젝트를 찾는다.
3. 마지막 저장 시각 등 확정된 기준으로 정렬한다.
4. 7단계 workflow 진행률, 사용자 확인 필요 상태와 실행 중인 장시간 작업 상태를 구분해 표시한다.
5. 프로젝트를 열면 서버가 계산한 마지막 유효 단계로 이동한다.
6. 새 프로젝트 초안을 만들고 실제 `projectId`의 setup URL로 이동한다.

이 화면은 프로젝트 내용을 편집하거나 장시간 작업을 직접 실행하는 곳이 아니다. 삭제·보관, 작업 취소, 단계별 오류 해결은 별도 정책 또는 해당 process 화면이 담당한다.

### 2.3 접근 권한과 사용자 상태별 화면

| 세션 상태 | 화면 |
|---|---|
| 확인 중 | 최종 헤더와 목록 크기를 유지한 로딩 자리표시자 |
| 비로그인 | Google 인증으로 이동하고 `returnTo=/projects` 보존 |
| 로그인 | 본인 프로젝트 목록과 사용자 메뉴 표시 |
| 세션 만료 | 현재 검색·정렬과 작성 중인 프로젝트명을 보존하고 재로그인 안내 |
| 인증 오류 | 목록을 노출하지 않고 로그인 재시도 제공 |

`/projects`는 보호된 route다. 비로그인 사용자에게 빈 목록이나 가짜 샘플 프로젝트를 먼저 보여주지 않는다. 인증 성공 후 반드시 `/projects`로 복귀한다.

### 2.4 기본 사용자 흐름과 URL 이동

#### 프로젝트 재개

```text
/projects 진입
  → 서버 세션·소유권 기준 목록 조회
  → 검색·정렬
  → 프로젝트 행 선택
  → server가 계산한 resumeRoute로 이동
  → 대상 route에서 소유권과 현재 유효 단계 재확인
```

#### 새 리서치 시작

```text
새 리서치 추가하기
  → 프로젝트 이름 입력
  → POST /api/projects
  → 실제 projectId와 currentRoute 수신
  → /projects/{projectId}/process/setup 이동
```

현재 프로토타입의 `"new"`, `project-009150-2026q2` 같은 문자열은 실제 구현에서 생성·이동 계약으로 사용하지 않는다.

### 2.5 현재 화면 확인 결과

2026-07-24 기준 현재 React 화면과 필요한 상호작용만 확인했다.

- 헤더, `최근 프로젝트` 소개 영역, 우측 새 리서치 CTA, 검색·정렬 toolbar, 6열 목록과 연속된 행 디자인이 존재한다.
- 검색은 하드코딩 배열의 기업 관련 문자열만 로컬 필터링한다. 사용자 프로젝트명 검색은 실제로 동작하지 않는다.
- 정렬은 배열 순서를 뒤집는 `최신순`·`오래된순` 가짜 동작이며 저장 시각을 비교하지 않는다.
- 네 프로젝트의 진행률·상태·마지막 활동이 하드코딩되어 있다.
- 모든 마지막 활동이 `방금 전`이며 실제 저장 시각과 연결되지 않는다.
- 행과 `이어하기`·`열기` 버튼은 로컬 `view`와 13단계 내부 step index로 이동한다.
- 새 프로젝트는 서버 생성 없이 `projectId="new"`로 setup 화면에 이동한다.
- `/projects` 직접 진입, 현재 스크린샷 기준선, 삼성전기 `이어하기`의 files URL 이동은 기존 Playwright 검사에서 통과했다.

### 2.6 기존 디자인 재사용·수정·제거 판정

| 현재 영역 | 판정 | 구현 판단 |
|---|---|---|
| 흰색 고정 헤더와 중앙 `Home`·`Project` 내비게이션 | 재사용 | 홈 명세와 같은 실제 세션·사용자 메뉴 연결 |
| 도움말 `?` 버튼 | MVP에서 제거 | 동작·요구사항이 없는 빈 버튼을 남기지 않음 |
| 가짜 `JE` 아바타 | 형태만 재사용 | 실제 Google 프로필 이미지 또는 이름 이니셜로 교체 |
| `RESEARCH WORKSPACE`·`최근 프로젝트` 소개 영역 | 재사용 | `최근 프로젝트` 제목 weight 600과 현재 간격 유지 |
| 우측 `새 리서치 추가하기` CTA | 재사용 | 홈과 같은 생성 dialog·실제 생성 API 연결 |
| 목록의 흰색 bounded surface | 재사용 | 검색, 정렬, 목록 상태를 한 surface 안에 유지 |
| 검색 field | 재사용·수정 | 실제 프로젝트명·기업명·종목코드 서버 검색으로 교체 |
| 정렬 select | 재사용·문구 수정 | `최신순`을 `최근 수정순`으로 명확히 표현 |
| 6열 목록과 연속된 정사각형 행 | 재사용 | 행별 둥근 카드로 분리하지 않음 |
| 기업 이니셜 타일 | 재사용 | 서버 기업명에서 표시값 생성, 기업 미설정 초안에는 중립 아이콘 사용 |
| 진행률 bar | 재사용·의미 수정 | 임의 퍼센트가 아니라 완료된 7단계 비율 표시 |
| 상태 badge | 재사용·확장 | 서버 상태 code를 UI가 제한된 문구·tone으로 변환하고 실행 작업 보조 문구 추가 |
| `최근 활동` 열 | 문구·데이터 수정 | `마지막 저장`으로 바꾸고 실제 `lastSavedAt` 표시 |
| `이어하기`·`열기` 액션 | 재사용·구조 수정 | 로컬 step 변경 대신 실제 `resumeRoute` 링크 |
| 행 전체 `div role="button"` 안의 중첩 버튼 | 수정 | 행을 하나의 실제 링크로 만들고 마지막 셀은 같은 링크의 시각적 액션으로 표현 |
| 사용되지 않는 `projects-metrics`·`record-menu` 스타일 | 구현 시 제거 | 기준 요구사항에 없는 요약 카드·메뉴를 되살리지 않음 |

큰 레이아웃과 시각 계층은 유지한다. 필수 수정은 실제 데이터 연결, 7단계 의미 통일, 검색·정렬 정확성, 인증·권한과 상태 처리다.

### 2.7 목표 컴포넌트 구성

| 컴포넌트 | 책임 | 주요 입력 | 주요 출력·이벤트 |
|---|---|---|---|
| `ProjectsRoute` | 세션 검증, URL query 해석, 첫 목록 조회 | 세션 쿠키, `q`, `sort` | `ProjectsPage` 초기 데이터 또는 로그인 복귀 |
| `ProjectsPage` | 페이지 레이아웃과 목록·dialog 상태 조정 | `initialProjects`, `pageInfo`, `query` | 검색·정렬·추가 조회·생성 |
| `AppHeader` | 공통 로고·내비게이션·사용자 메뉴 | 실제 session | 홈 이동, 사용자 메뉴, 로그아웃 |
| `ProjectsOverview` | 제목과 새 리서치 CTA | 정적 카피 | 생성 dialog 열기 |
| `ProjectToolbar` | 검색과 정렬 | `query`, `sort` | query commit, sort 변경 |
| `ProjectList` | 로딩·목록·빈 상태·오류·pagination | 프로젝트 요약 목록 | 행 이동, 더 보기, 재시도 |
| `ProjectRow` | 한 프로젝트의 표시 계약 | `ProjectSummary` | `resumeRoute` 이동 |
| `WorkflowProgress` | 7단계 완료 비율 표시 | 완료 단계 수, 전체 단계 수 | 없음 |
| `ProjectStatus` | 주의·편집·완료 상태 표시 | 상태 code 목록 | 없음 |
| `BackgroundJobStatus` | 실행 중 작업 종류·상태·별도 진행률 | `activeJob` | 없음 |
| `ProjectEmptyState` | 최초 빈 상태와 검색 결과 없음 구분 | query 유무 | 새 리서치 또는 검색 지우기 |
| `LoadMoreButton` | cursor pagination 추가 조회 | `nextCursor`, 요청 상태 | 다음 page 추가 |
| `CreateProjectDialog` | 홈과 동일한 프로젝트 생성 | open, 초기 이름 | 실제 프로젝트 생성·취소·오류 |

`AppHeader`와 `CreateProjectDialog`는 홈 전용 구현을 복사하지 않고 공통 컴포넌트로 분리한다.

### 2.8 프로젝트 행 표시 계약

| 열 | 주요 표시 | 보조 표시 | 데이터 없을 때 |
|---|---|---|---|
| 프로젝트 · 기업 | 사용자 프로젝트명 | `기업명 · 종목코드 · 거래소` | `기업 미설정` |
| 리포트 | `대상 연도·분기 · 실적 Review` | `IT 제조업 · PER` | setup 미완료 항목은 `분석 기준 미설정` |
| 진행률 | 7단계 진행 bar와 정수 퍼센트 | 현재 단계의 접근성 설명 | 초안은 `0%` |
| 상태 | 우선순위에 따른 primary 상태 badge | 실행 중 작업이 있으면 작업명·작업 진행률 | 현재 단계의 다음 필요 동작 |
| 마지막 저장 | 상대 시각 | 정확한 KST 시각을 `time` 요소의 title 또는 보조 접근성 이름으로 제공 | 생성 직후 `방금 전` 가능 |
| 액션 | `이어하기`, `진행 보기` 또는 `열기` | 얇은 chevron | 항상 실제 링크 |

현재 UI처럼 기업명만 주요 값으로 쓰면 사용자가 생성 dialog에서 입력한 프로젝트명을 확인할 수 없다. 첫 열의 주요 값은 `project.name`으로 바꾸고 기업 정보는 같은 셀의 보조 정보로 표시한다. 긴 이름은 한 줄 말줄임 처리하되 전체 이름은 접근성 이름과 title에서 확인할 수 있어야 한다.

#### 진행률 계산

프로젝트 진행률은 다음 규칙을 따른다.

```text
workflowProgress = completedStageCount ÷ 7 × 100
```

- 정수로 반올림해 표시한다.
- 현재 단계 내부의 장시간 작업 진행률과 섞지 않는다.
- active job의 퍼센트는 상태 열의 별도 `BackgroundJobStatus`에서 표시한다.
- 7개 process 단계가 모두 완료되면 workflow 진행률을 `100%`로 표시한다. 이후 보고서의 `편집 중`·`내보내기 완료`는 상태 badge로 구분한다.
- 클라이언트가 route 이름이나 기존 13단계 index로 퍼센트를 추정하지 않는다.

### 2.9 상태 표시와 재개 route 규칙

#### primary 상태 우선순위

한 프로젝트에 상태가 여러 개일 수 있으므로 목록의 primary badge는 서버 projection이 다음 우선순위로 결정한다.

1. `job_failed` → `작업 확인 필요`
2. `source_conflict_required` → `충돌 해결 필요`
3. `revalidation_required` → `재검증 필요`
4. active job `queued`·`running` → `분석 대기 중`, `자료 수집 중` 등 작업 종류별 문구
5. `report_editing` → `편집 중`
6. `export_completed` → `내보내기 완료`
7. 현재 단계의 사용자 동작 대기 → `설정 필요`, `파일 업로드 대기`, `질문 승인 필요` 등

색상 tone은 API가 임의 hex나 CSS class로 보내지 않는다. 프론트엔드는 확정된 상태 code를 다음 역할로만 매핑한다.

- 완료: lime tint
- 진행 중: neutral 또는 낮은 압력의 정보색
- 사용자 확인 필요: amber
- 실패·차단: red
- 편집 중: neutral

색만으로 상태를 구분하지 않고 badge 문구와 작업 보조 문구를 함께 제공한다.

#### `resumeRoute`

프론트엔드는 프로젝트의 마지막 유효 단계를 재계산하지 않는다. 서버가 현재 저장 상태와 단계 무효화 관계를 기준으로 canonical `resumeRoute`를 반환한다.

| 프로젝트 상태 | `resumeRoute` 규칙 |
|---|---|
| setup 미완료 초안 | `process/setup` |
| 일반 진행 중 | 현재 진행해야 할 process route |
| 상위 변경으로 하위 무효화 | 가장 먼저 다시 확인해야 하는 process route |
| source 충돌·필수 검증 실패 | 해당 문제를 해결하는 validation route |
| 장시간 작업 실행 중 | 작업을 시작한 process route |
| 보고서 편집 중 | `/projects/{projectId}/report` |
| 최종 내보내기 완료 | `/projects/{projectId}/report` |

대상 route도 요청 시 세션 소유권과 현재 단계 유효성을 다시 확인한다. 오래 열린 목록에서 route가 바뀌었으면 서버가 최신 canonical route로 안전하게 redirect한다.

### 2.10 버튼·링크 계약

| ID | 요소 | 노출·활성 조건 | 동작 | 성공 결과 | 실패 처리 |
|---|---|---|---|---|---|
| PROJECTS-LINK-01 | REFLO 로고 | 항상 | `/` 이동 | 홈 표시 | 없음 |
| PROJECTS-LINK-02 | `Home` | 항상 | `/` 이동 | 홈 표시 | 없음 |
| PROJECTS-LINK-03 | `Project` | 항상 | `/projects` 이동 | 현재 목록 유지 | 없음 |
| PROJECTS-BTN-01 | 사용자 아바타 | 로그인 | 사용자 메뉴 열기 | 프로젝트·로그아웃 메뉴 | 없음 |
| PROJECTS-BTN-02 | 사용자 메뉴 `로그아웃` | 로그인 | 세션 종료 | 공개 홈으로 이동 | 실패 시 메뉴 안 재시도 |
| PROJECTS-BTN-03 | `새 리서치 추가하기` | 로그인 | 생성 dialog 열기 | 입력에 포커스 | 없음 |
| PROJECTS-LINK-04 | 프로젝트 행 | 프로젝트 표시 | `resumeRoute`로 이동 | 마지막 유효 단계 표시 | route에서 404·오류 처리 |
| PROJECTS-BTN-04 | `검색 지우기` | query가 있고 결과가 없음 | query 제거 | 기본 목록 재조회 | 요청 실패 시 재시도 |
| PROJECTS-BTN-05 | `더 보기` | `nextCursor` 존재 | 다음 page 요청 | 기존 목록 뒤에 중복 없이 추가 | 기존 목록 유지, inline 재시도 |
| PROJECTS-BTN-06 | `다시 시도` | 최초 또는 갱신 오류 | 같은 query·sort 재요청 | 목록 갱신 | 오류 유지 |
| PROJECTS-BTN-07 | dialog `생성하기` | 이름 유효, 요청 중 아님 | `POST /api/projects` | 실제 setup URL 이동 | 입력 유지, 오류·재시도 |

삭제·보관·복제·공유·작업 취소 버튼은 이번 MVP 목록에 추가하지 않는다. 프로젝트 목록에서 필요한 복구는 프로젝트 행을 열어 해당 process 화면에서 수행한다.

### 2.11 검색 입력 계약

| 속성 | 계약 |
|---|---|
| HTML 요소 | `input type="search"` |
| label | `프로젝트 검색` |
| `name` | `q` |
| placeholder | `프로젝트 · 기업명 · 종목코드 검색` |
| 최대 길이 | 100자 |
| 대상 | 프로젝트명, 기업명, 6자리 종목코드 |
| 실행 | 입력 후 250ms debounce 또는 Enter, 최신 요청만 반영 |
| 정규화 | 앞뒤 공백 제거, Unicode NFC, 연속 공백 축약 |
| URL | commit된 query를 `/projects?q=...`에 반영 |

검색은 현재 표시된 배열만 필터링하지 않고 소유자 범위의 전체 프로젝트를 서버에서 검색한다. 프로젝트명·기업명은 대소문자와 일반적인 공백 차이를 무시하고, 종목코드는 문자열로 비교한다. query가 바뀌면 cursor와 `더 보기` 결과를 초기화한다.

빈 query는 정상 상태이며 최근 수정순 기본 목록을 표시한다. 검색 요청이 연속으로 완료 순서가 바뀌어도 오래된 응답을 최신 결과 위에 적용하지 않는다.

### 2.12 정렬·pagination 계약

#### 정렬

| 표시 문구 | API 값 | 정렬 기준 |
|---|---|---|
| 최근 수정순 | `updated_desc` | `lastSavedAt DESC`, 동률이면 `projectId DESC` |
| 오래된 수정순 | `updated_asc` | `lastSavedAt ASC`, 동률이면 `projectId ASC` |
| 기업명순 | `company_asc` | 기업명 ASC, 기업 미설정 초안은 뒤, 동률이면 `lastSavedAt DESC` |

기본값은 `updated_desc`다. 현재 프로토타입의 배열 index 뒤집기는 제거한다. 정렬을 바꾸면 cursor를 초기화하고 URL의 `sort`를 갱신한다.

#### pagination

- 첫 요청은 최대 20개를 반환한다.
- 더 많은 결과가 있으면 목록 아래에 `더 보기`를 표시한다.
- cursor는 서버가 발급한 불투명 문자열이며 클라이언트가 내용을 만들거나 해석하지 않는다.
- 추가 page 요청 중 기존 목록을 지우지 않는다.
- 같은 `projectId`는 한 번만 표시한다.
- query나 sort가 바뀌면 이전 cursor 응답을 폐기한다.
- 자동 infinite scroll만 사용하지 않고 키보드로 접근 가능한 `더 보기`를 제공한다.

### 2.13 화면 데이터

#### `ProjectSummary`

| 데이터 | 주요 필드 | 용도 |
|---|---|---|
| 식별 | `projectId`, `name`, `version` | 행 key, 표시, stale 상태 판정 |
| 기업 | `company.name`, `company.ticker`, `company.exchange` | 기업 정보와 검색 |
| 분석 기준 | `targetPeriod.year`, `targetPeriod.quarter`, `reportType`, `industry`, `valuationMethod` | 리포트 열 |
| workflow | `workflow.currentStage`, `workflow.completedStageCount`, `workflow.totalStageCount`, `workflow.progressPercent`, `workflow.resumeRoute` | 진행률과 이동 |
| 프로젝트 상태 | `primaryStatusCode`, `attentionCodes` | 상태 badge |
| 실행 작업 | `activeJob` 또는 null | 장시간 분석·수집 진행 상태 |
| 시각 | `lastSavedAt`, `createdAt`, `projectionUpdatedAt` | 정렬, 마지막 저장, 상태 갱신 지연 판단 |

`activeJob`은 최소 다음 값을 가진다.

```json
{
  "jobId": "job_01...",
  "type": "research_collection",
  "status": "running",
  "progressPercent": 42,
  "startedAt": "2026-07-24T10:00:00Z",
  "updatedAt": "2026-07-24T10:03:00Z"
}
```

`type`과 `status`는 제한된 enum이다. 화면 문구는 프론트엔드의 고정 mapping으로 표시한다. Agent가 만든 자유 문장이나 Temporal 내부 activity 이름을 사용자 상태 문구로 그대로 노출하지 않는다.

#### 정적 데이터

- 화면 제목·설명
- 열 이름
- 상태 code별 표시 문구·tone
- 7개 단계 이름과 route mapping
- 정렬 option 문구

### 2.14 클라이언트 상태

| 상태 | 타입 | 초기값 | 설명 |
|---|---|---|---|
| `searchInput` | string | URL `q` | 사용자가 입력 중인 값 |
| `committedQuery` | string | 정규화된 URL `q` | 서버 요청에 사용한 query |
| `sort` | sort enum | URL 또는 `updated_desc` | 정렬 |
| `projects` | `ProjectSummary[]` | 서버 초기 데이터 | 현재 표시 목록 |
| `listStatus` | `loading \| success \| empty \| error` | 서버 결과 | 최초 목록 상태 |
| `refreshStatus` | `idle \| refreshing \| stale \| error` | `idle` | background 상태 갱신 |
| `nextCursor` | string 또는 null | 서버 page info | 더 보기 |
| `loadMoreStatus` | `idle \| loading \| error` | `idle` | pagination 상태 |
| `createDialogOpen` | boolean | `false` | 생성 dialog |
| `projectName` | string | `""` | 생성 입력 |
| `createStatus` | `idle \| submitting \| error` | `idle` | 생성 요청 |

검색·정렬은 URL query가 복귀 기준이다. 프로젝트 목록과 active job 상태의 권위값은 서버다. 현재 프로토타입의 `projects` 상수, 배열 index, 로컬 step과 `time="방금 전"`을 권위 상태로 사용하지 않는다.

### 2.15 목록·작업 상태 갱신

- 페이지 최초 데이터는 보호된 server route에서 조회한다.
- active job이 하나라도 `queued`, `running`, `cancel_requested`이면 현재 query·sort·표시 개수를 유지해 5초 간격으로 목록 projection을 다시 조회할 수 있다.
- document가 hidden이면 polling을 중단하고 다시 보일 때 즉시 한 번 갱신한다.
- active job이 없으면 자동 polling을 중단하고 window focus 시에만 재검증한다.
- 응답의 `ETag`를 사용할 수 있으면 `If-None-Match`로 변경이 없는 응답을 줄인다.
- background 갱신 실패 시 기존 목록을 지우지 않고 `상태 갱신 지연`과 재시도를 표시한다.
- `projectionUpdatedAt`이 running 상태인데 30초 이상 갱신되지 않았으면 job을 성공처럼 보이지 않고 `상태 갱신 지연`으로 표시한다.

목록은 Temporal API를 브라우저에서 직접 호출하지 않는다. Temporal workflow와 activity가 PostgreSQL projection을 갱신하고, 화면은 해당 projection API만 조회한다.

### 2.16 API 계약

#### `GET /api/projects`

로그인 사용자가 소유한 프로젝트 요약 목록을 조회한다.

| query | 필수 | 규칙 |
|---|---|---|
| `q` | 아니요 | 정규화 후 0~100자, 프로젝트명·기업명·종목코드 검색 |
| `sort` | 아니요 | `updated_desc`, `updated_asc`, `company_asc`; 기본 `updated_desc` |
| `cursor` | 아니요 | 서버 발급 불투명 cursor |
| `limit` | 아니요 | 기본 20, 최대 100 |

클라이언트는 `ownerUserId`를 전달하지 않는다. 서버는 검증된 세션의 Google 사용자 ID로 쿼리 범위를 고정한다.

성공 응답:

```json
{
  "items": [
    {
      "projectId": "prj_01...",
      "name": "삼성전기 2026년 2분기 리서치",
      "version": 8,
      "company": {
        "name": "삼성전기",
        "ticker": "009150",
        "exchange": "KOSPI"
      },
      "targetPeriod": {
        "year": 2026,
        "quarter": 2
      },
      "reportType": "earnings_review",
      "industry": "it_manufacturing",
      "valuationMethod": "per",
      "workflow": {
        "currentStage": "files",
        "completedStageCount": 1,
        "totalStageCount": 7,
        "progressPercent": 14,
        "resumeRoute": "/projects/prj_01.../process/files"
      },
      "primaryStatusCode": "file_upload_required",
      "attentionCodes": [],
      "activeJob": null,
      "lastSavedAt": "2026-07-24T12:00:00Z",
      "createdAt": "2026-07-24T11:00:00Z",
      "projectionUpdatedAt": "2026-07-24T12:00:01Z"
    }
  ],
  "pageInfo": {
    "nextCursor": null,
    "hasNextPage": false
  },
  "generatedAt": "2026-07-24T12:00:02Z"
}
```

| 상태 코드 | 오류 code | 화면 처리 |
|---|---|---|
| `400` | `INVALID_PROJECT_QUERY` | 잘못된 URL query를 기본값으로 정리하고 안내 |
| `401` | `AUTH_REQUIRED` | 현재 URL을 `returnTo`로 보존해 Google 로그인 |
| `429` | `RATE_LIMITED` | 기존 목록 유지, 잠시 후 재시도 |
| `500` | `PROJECT_LIST_FAILED` | 최초면 오류 상태, 갱신이면 기존 목록 유지 |
| `503` | `PROJECT_STATUS_UNAVAILABLE` | 저장된 목록을 표시할 수 있으면 stale 안내, 없으면 재시도 |

#### `POST /api/projects`

홈 명세 1.12의 프로젝트 생성 계약을 그대로 사용한다. `/projects`에서 별도 생성 형식이나 별도 임시 ID를 만들지 않는다.

#### 프로젝트 route 접근

`resumeRoute`의 각 보호된 route는 다음을 다시 검사한다.

- 검증된 세션 사용자와 프로젝트 소유자 일치
- 프로젝트 존재 여부
- 현재 단계 접근 가능 여부
- stale `resumeRoute`일 때 최신 canonical route

존재하지 않거나 다른 사용자가 소유한 `projectId`는 존재 여부를 노출하지 않도록 동일한 `404 PROJECT_NOT_FOUND`로 처리한다.

### 2.17 저장 모델과 권한 규칙

프로젝트 목록 조회를 위해 PostgreSQL에 최소 다음 projection이 필요하다.

| 필드 | 규칙 |
|---|---|
| `project_id` | 서버 생성 불투명 ID |
| `owner_google_user_id` | 검증된 로그인 세션에서 획득 |
| `name` | 사용자 프로젝트명 |
| `company_id`, `company_name`, `ticker`, `exchange` | setup 완료 전 null 허용 |
| `target_year`, `target_quarter` | setup 완료 전 null 허용 |
| `report_type`, `industry`, `valuation_method` | MVP 고정값 또는 setup 결과 |
| `current_stage` | 7단계 enum |
| `completed_stage_count` | 0~7 |
| `primary_status_code`, `attention_codes` | 목록 projection |
| `last_saved_at` | 실제 자동 저장 성공 시각 |
| `version` | optimistic concurrency와 projection 판정 |

장시간 작업은 별도 job projection에 최소 다음 값을 가진다.

- `job_id`, `project_id`, `workflow_id`
- `job_type`, `status`, `progress_percent`
- `started_at`, `updated_at`, `completed_at`
- 실패 시 사용자 표시 가능한 정형 `error_code`

권한 규칙:

1. 모든 목록 query는 세션의 Google 사용자 ID를 server-side 조건으로 강제한다.
2. request query, cookie 외 사용자 입력, URL의 `projectId`만으로 소유권을 판정하지 않는다.
3. 목록 응답에 내부 Google subject, object key, Temporal workflow ID와 원시 오류 stack을 노출하지 않는다.
4. 다른 사용자 프로젝트에 대한 직접 URL·API 접근은 404로 처리한다.
5. `resumeRoute`는 같은 REFLO origin의 허용 route 형식만 생성한다.
6. 검색은 parameterized query를 사용하고 wildcard·정규화 값으로 SQL 구조를 바꿀 수 없게 한다.

### 2.18 화면에 들어가는 기술과 들어가면 안 되는 기술

| 기술·영역 | `/projects`에서의 위치 | 판단 |
|---|---|---|
| Next.js App Router | 보호 route, 세션·초기 목록 server 조회 | 사용 |
| React Client Component | 검색 debounce, 정렬, 더 보기, dialog, 상태 polling | 사용 |
| Google OAuth·server session | 접근 권한과 사용자 메뉴 | 필수, 구체 라이브러리는 미확정 |
| PostgreSQL | 소유자 범위 목록과 project/job projection | 사용 |
| Temporal | backend가 장시간 작업 상태 projection 갱신 | 간접 사용, 브라우저 직접 연결 금지 |
| S3 호환 저장소 | 목록 API에 artifact byte를 제공하지 않음 | 직접 사용하지 않음 |
| SpreadJS | 없음 | 번들에 포함하지 않음 |
| Aspose.Cells | 없음 | 목록 route에서 호출하지 않음 |
| PDF Python worker·PDFium·OpenCV | 없음 | 목록 route에서 호출하지 않음 |
| PydanticAI Agent | 없음 | 목록 조회·검색·상태 문구에 사용하지 않음 |

목록 API는 데이터와 상태 projection만 반환한다. 파일·원문·Excel·Agent payload를 목록 응답에 포함하지 않는다.

### 2.19 로딩·빈 상태·오류·예외 처리

| 상황 | 사용자 화면 | 후속 동작 |
|---|---|---|
| 최초 목록 로딩 | 검색 toolbar와 최종 행 높이의 skeleton | 완료 후 목록 또는 빈 상태 |
| 프로젝트 없음 | `아직 프로젝트가 없습니다`와 `새 리서치 시작` | 생성 dialog |
| 검색 결과 없음 | `검색 결과가 없습니다`와 `검색 지우기` | 기본 목록 복귀 |
| 최초 목록 실패 | 구체적 오류와 `다시 시도` | 같은 query·sort 요청 |
| background 갱신 실패 | 기존 목록 유지, `상태 갱신 지연` | 자동 또는 수동 재시도 |
| 더 보기 실패 | 기존 목록 유지, 목록 아래 inline 오류 | 같은 cursor 재시도 |
| 세션 만료 | 검색·정렬·dialog 입력 보존 | 재로그인 후 `/projects` 복귀 |
| 프로젝트가 다른 tab에서 삭제·권한 변경 | route에서 404 | 목록으로 돌아가기 |
| stale `resumeRoute` | 최신 route로 server redirect | 사용자 입력 손실 없이 계속 |
| active job 실패 | `작업 확인 필요` 상태 | 행을 열어 실패 단계 확인 |
| 프로젝트 생성 실패 | dialog와 이름 유지 | 같은 idempotency key로 재시도 |

빈 상태와 오류 상태에 샘플 프로젝트를 섞지 않는다.

### 2.20 반응형·접근성 계약

#### 반응형

- Desktop에서는 현재 6열 연속 table형 레이아웃을 유지한다.
- Tablet에서는 간격을 줄이고 필요한 경우 table surface 안에서만 가로 스크롤을 허용한다.
- Mobile에서는 각 행의 정보를 세로로 쌓아 읽을 수 있게 하고 페이지 전체가 980px 고정폭 목록 때문에 가로 스크롤되지 않게 한다.
- Mobile에서도 행은 한 목록의 연속 record로 유지하고 장식용 개별 card radius를 추가하지 않는다.
- 검색과 정렬은 mobile에서 전체 폭으로 쌓고 CTA의 hit area는 44px 이상 유지한다.

#### 접근성

- 검색은 visible label 또는 접근성 이름이 있는 `type="search"`를 사용한다.
- 정렬 select는 `정렬` label을 가진다.
- 프로젝트 행은 실제 `href`가 있는 링크여야 하며 Enter, 새 tab 열기, 주소 복사가 가능해야 한다.
- `div role="button"` 안에 별도 button을 중첩하지 않는다.
- 진행 bar는 숫자만 보지 않아도 `7단계 중 1단계 완료, 14%`처럼 읽을 수 있어야 한다.
- 상태와 active job은 색 외에 명시적 문구를 제공한다.
- `lastSavedAt`은 `<time dateTime>`으로 표현하고 상대 시각과 정확한 시각을 모두 접근 가능하게 한다.
- 목록 갱신은 포커스를 강제로 이동하지 않는다. 검색 결과 수와 오류는 적절한 `aria-live` 영역에서 한 번만 안내한다.
- loading 중 최종 목록과 같은 크기를 유지해 레이아웃 이동을 줄인다.

### 2.21 현재 프로토타입과 목표 구현의 차이

| 현재 프로토타입 | 목표 구현 | 우선순위 |
|---|---|---|
| route가 공통 대형 `app/page.tsx`를 다시 export | `/projects` 전용 보호 route와 컴포넌트 분리 | 구현 품질 |
| 네 프로젝트 상수 | 소유자 범위 `GET /api/projects` | 필수 |
| 프로젝트명이 목록에 없음 | 첫 열에 실제 사용자 프로젝트명 표시 | 필수 |
| code 필드에 기업명·거래소만 포함 | 실제 6자리 종목코드·거래소 표시 | 필수 |
| 기업 관련 문자열만 로컬 검색 | 프로젝트명·기업명·종목코드 server 검색 | 필수 |
| 배열 index로 최신·오래된순 | `lastSavedAt` 기반 안정 정렬 | 필수 |
| 임의 23·40·76% | 완료된 7단계 기반 진행률 | 필수 |
| 13단계 내부 step으로 route 결정 | server `resumeRoute` | 필수 |
| 상태 문구·tone 하드코딩 | 제한된 상태 code와 projection | 필수 |
| 실행 중 분석·수집 작업 표시 없음 | active job 종류·상태·별도 진행률 표시 | 필수 |
| 모든 시간이 `방금 전` | 실제 `lastSavedAt` 상대·정확 시각 | 필수 |
| `projectId="new"`로 생성 | 실제 project 초안 생성과 실제 ID | 필수 |
| 가짜 `JE`, 도움말 빈 버튼 | 실제 사용자 메뉴, 도움말 제거 | 필수 |
| 빈·검색 없음·API 오류 없음 | 구분된 빈 상태·오류·재시도 | 필수 |
| pagination 없음 | cursor와 조건부 `더 보기` | 운영 필수 |
| 행 `role=button` 안에 action button | 하나의 semantic link 행 | 접근성 |
| mobile에서 고정폭 table 가능 | 좁은 화면 stacked record | 접근성 |

### 2.22 필요한 추가 버튼·누락 기능 검토

#### 추가한다

- 검색 결과가 없을 때 `검색 지우기`
- 최초·갱신·pagination 오류의 문맥별 `다시 시도`
- page가 더 있을 때만 `더 보기`
- 실제 사용자 메뉴의 `로그아웃`

#### 기존 요소에 실제 기능을 연결한다

- `새 리서치 추가하기`
- 프로젝트 행의 `이어하기`·`진행 보기`·`열기`
- 검색 field와 정렬 select

#### 이번 MVP에 추가하지 않는다

- 프로젝트 삭제·보관·복제·공유
- 공동 소유자·역할 관리
- active job 취소·재시작
- 요약 metric 카드
- 행별 kebab menu
- 수동 전체 새로고침 버튼
- 동작이 없는 도움말 버튼

active job은 조건부 polling과 window focus 갱신으로 최신화한다. 별도 새로고침 버튼을 기본 UI에 추가해 정보 밀도를 높이지 않는다.

### 2.23 구현 순서

1. 홈 명세에 남은 Google 인증·세션 기술 결정을 확정하고 `/projects` 보호 route를 구현한다.
2. PostgreSQL project 목록 projection과 Temporal job projection을 설계한다.
3. `GET /api/projects`의 소유자 범위 검색·정렬·cursor 계약을 구현한다.
4. 현재 `ProjectsPage`를 전용 route와 목표 컴포넌트로 분리한다.
5. 하드코딩 목록을 `ProjectSummary` 응답으로 교체한다.
6. 사용자 프로젝트명·기업·7단계 진행률·상태·마지막 저장 표시를 연결한다.
7. 로컬 검색·배열 index 정렬을 URL query 기반 server 요청으로 교체한다.
8. 행 이동을 실제 `resumeRoute` 링크로 교체하고 각 route의 소유권·canonical redirect를 구현한다.
9. 홈과 공통인 `CreateProjectDialog`를 실제 `POST /api/projects`에 연결한다.
10. active job 조건부 polling, 빈 상태, stale 상태, 오류와 pagination을 구현한다.
11. semantic link, keyboard, mobile stacked record와 자동 테스트를 검증한다.

### 2.24 완료 조건

- [ ] 비로그인 `/projects` 접근은 Google 로그인 후 원래 URL로 복귀한다.
- [ ] 로그인 사용자는 본인이 소유한 프로젝트만 볼 수 있다.
- [ ] 다른 사용자 프로젝트는 목록·검색 결과에 포함되지 않는다.
- [ ] 목록에 실제 프로젝트명, 기업명, 종목코드, 거래소, 대상 분기, 리포트 유형, 기업 분야가 표시된다.
- [ ] setup 미완료 초안도 `기업 미설정` 상태로 목록에 표시된다.
- [ ] 검색이 프로젝트명·기업명·종목코드 전체 소유 프로젝트를 대상으로 동작한다.
- [ ] 정렬이 실제 `lastSavedAt`과 안정 tie-breaker를 사용한다.
- [ ] 진행률이 문서 기준 7단계 완료 수에서 계산된다.
- [ ] 장시간 작업 진행률은 workflow 진행률과 분리해 표시된다.
- [ ] `재검증 필요`, `충돌 해결 필요`, `편집 중`, `내보내기 완료` 상태를 구분해 표시한다.
- [ ] 프로젝트 행은 서버가 계산한 실제 `resumeRoute`로 이동한다.
- [ ] stale route와 단계 무효화가 최신 canonical route로 보정된다.
- [ ] 마지막 저장 시각은 실제 서버 시각이며 상대·정확 시각을 확인할 수 있다.
- [ ] 새 리서치는 서버에서 한 번만 생성되고 실제 `projectId`의 setup URL로 이동한다.
- [ ] 최초 빈 상태와 검색 결과 없음이 구분된다.
- [ ] 최초·갱신·더 보기 실패가 기존 데이터를 불필요하게 지우지 않는다.
- [ ] active job이 있으면 화면을 벗어나지 않아도 projection 상태가 갱신된다.
- [ ] `더 보기`는 cursor가 있을 때만 표시되고 중복 행을 만들지 않는다.
- [ ] 프로젝트 행은 semantic link이며 중첩 interactive control이 없다.
- [ ] mobile에서 프로젝트 정보를 가로 스크롤 없이 읽고 열 수 있다.
- [ ] 동작하지 않는 도움말·행 메뉴·삭제·보관 버튼이 남아 있지 않다.
- [ ] `/projects` 번들에서 SpreadJS, PDF·Excel 워커와 Agent 코드를 로드하거나 호출하지 않는다.

### 2.25 자동 테스트 시나리오

| 종류 | 시나리오 |
|---|---|
| E2E | 비로그인 `/projects` 접근, Google 로그인, 원래 URL 복귀 |
| E2E | 로그인 사용자의 목록 직접 진입과 실제 데이터 렌더링 |
| E2E | 프로젝트 행 선택 후 stage별 `resumeRoute` 이동 |
| E2E | 재검증·충돌 상태 프로젝트가 문제 해결 route로 이동 |
| E2E | 편집 중·내보내기 완료 프로젝트가 report route로 이동 |
| E2E | 프로젝트 생성 성공 후 실제 setup URL 이동 |
| E2E | 검색 결과 없음, 검색 지우기, 기본 목록 복귀 |
| E2E | cursor `더 보기` 성공·실패·재시도 |
| E2E | mobile stacked record와 검색·정렬 사용 |
| 통합 | 프로젝트명·기업명·종목코드 검색 |
| 통합 | 세 정렬 option과 동률 tie-breaker |
| 통합 | 7단계 진행률과 active job 진행률 분리 |
| 통합 | Temporal job projection 갱신과 stale 상태 표시 |
| 통합 | 상위 단계 변경 후 `resumeRoute`·재검증 상태 변경 |
| 통합 | 같은 생성 idempotency key가 프로젝트 하나만 생성 |
| 보안 | 다른 owner 프로젝트가 목록·검색·cursor 결과에서 제외 |
| 보안 | 다른 owner `projectId` 직접 접근이 동일 404 |
| 보안 | 위조 owner ID, 외부 `resumeRoute`, SQL wildcard·injection 입력 거부 |
| 접근성 | 검색·정렬 label, semantic link, 진행률·상태·시간 접근성 이름 |
| 접근성 | loading·오류 갱신 시 포커스 유지와 `aria-live` 중복 안내 방지 |
| 시각 회귀 | desktop 연속 table 행, toolbar, CTA와 프로젝트 상태 표시 |

### 2.26 아직 필요한 제품·기술 결정

프로젝트 목록의 사용자 동작은 확정할 수 있지만 다음 항목은 별도 결정 또는 운영 정책이 필요하다.

1. 홈 명세와 공통인 Google OAuth·세션 라이브러리, 만료·갱신·CSRF 방식
2. project·job PostgreSQL projection의 구체 스키마와 index
3. 프로젝트 보존기간과 향후 삭제·보관 정책
4. 장시간 작업 progress 산정 방식과 사용자 표시 가능한 오류 code 목록
5. 전체 프로젝트 수가 커질 때 검색에 PostgreSQL trigram index를 적용할 기준

삭제·보관 정책이 확정되기 전까지 관련 버튼과 API를 임의로 추가하지 않는다.
