# REFLO API 명세 v1

**문서 상태:** 구현 전 HTTP 계약 기준선

**작성 기준일:** 2026-07-24

**API major:** v1

**machine-readable 단일 원본:** [`contracts/openapi/reflo-v1.yaml`](../contracts/openapi/reflo-v1.yaml)

**계약 규모:** public path 80개·operation 86개, internal path·operation 5개

**현재 구현 상태:** Next.js Route Handler와 실제 API 호출은 아직 없음

**관련 문서:**

- [시스템 아키텍처](./REFLO_SYSTEM_ARCHITECTURE_v1.md)
- [ERD](./REFLO_ERD_v1.md)
- [Worker JSON Schema](../contracts/schemas/README.md)
- [URL별 서비스 동작 명세](./REFLO_URL_SERVICE_BEHAVIOR_v1.md)
- [기술 결정 사항](./REFLO_TECHNICAL_DECISIONS_v1.md)
- [화면 구현 명세 인덱스](./REFLO_SCREEN_IMPLEMENTATION_SPEC_v1.md)

## 1. 목적과 권위

이 문서는 REFLO browser, Next.js server와 내부 worker가 어떤 HTTP 계약으로 통신하는지 설명한다. endpoint별 field·required·enum·response의 machine-readable 권위는 OpenAPI 파일이다. 이 Markdown은 구현자가 전체 규칙과 화면별 API를 빠르게 이해하기 위한 reference다.

문서 간 충돌 시 다음 순서를 적용한다.

1. 제품 동작과 7단계 책임: 서비스 동작 명세
2. 보안·실행 단위·권위 저장소: 시스템 아키텍처와 기술 결정
3. entity·version·관계: ERD
4. HTTP method·path·payload·status: OpenAPI
5. 화면 표현과 사용자 동작: 화면 구현 명세

화면 명세에 먼저 작성된 payload 예시와 OpenAPI가 다르면 OpenAPI를 구현 기준으로 사용하고 화면 명세를 후속 정리한다. field 의미를 임의로 섞어 사용하지 않는다.

## 2. API 경계

### 2.1 Public application API

- browser가 호출한다.
- URL namespace는 `/api/**`다.
- Google 로그인으로 발급한 server session cookie를 사용한다.
- project-scoped endpoint는 session 사용자와 project owner를 매 요청 다시 대조한다.
- browser는 PostgreSQL, Temporal, 객체 저장소 credential과 OpenAI에 직접 접근하지 않는다.

### 2.2 Internal Worker API

- Workflow Control Worker와 activity worker만 호출한다.
- URL namespace는 `/internal/v1/**`다.
- 사용자 session cookie나 client가 보낸 service ID를 인증으로 인정하지 않는다.
- 짧은 수명의 workload identity와 TLS를 사용한다.
- worker는 PostgreSQL credential을 갖지 않고 progress·result·terminal command를 이 API에 제출한다.

### 2.3 직접 객체 업로드

browser는 public API가 발급한 단일 object용 presigned URL로 quarantine 영역에 직접 업로드할 수 있다. 이것은 객체 저장소 credential을 browser에 주는 것이 아니다.

```text
Browser
  → POST upload session
  ← uploadId + 짧은 만료 presigned URL
  → Object Storage quarantine에 직접 PUT
  → POST upload complete
  ← verifying
  → status API polling
  ← accepted 또는 rejected
```

object key, bucket, storage credential은 public request·response에 포함하지 않는다.

## 3. 버전 정책

- 현재 화면 path와 일치시키기 위해 public v1은 `/api` prefix를 사용한다.
- OpenAPI `info.version`과 `x-reflo-api-major`가 계약 major를 식별한다.
- optional response field 추가처럼 호환 가능한 변경은 v1 안에서 허용한다.
- 기존 field의 타입·의미·enum을 바꾸거나 required request field를 추가하는 변경은 breaking change다.
- breaking change는 `/api/v2`와 새 OpenAPI major로 제공하고 active v1 client와 workflow가 종료될 때까지 v1을 유지한다.
- Internal Worker API는 URL에 `/internal/v1` major를 명시한다.
- 모든 worker payload는 별도의 `schemaVersion`도 포함한다. HTTP major와 artifact schema version은 같은 개념이 아니다.

## 4. 인증·session·CSRF

### 4.1 Session

- Google OAuth/OIDC만 지원한다.
- cookie 이름은 배포 설정으로 주입하되 OpenAPI에서는 `reflo_session`으로 표현한다.
- production cookie는 `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`다.
- idle timeout 7일, absolute timeout 30일이다.
- `GET /api/auth/session`은 비로그인도 정상 `200`으로 반환한다.
- session이 필요한 다른 endpoint는 session이 없거나 만료되면 `401 AUTH_REQUIRED`를 반환한다.

### 4.2 CSRF

CSRF는 사용자의 로그인 cookie를 악용한 외부 사이트 요청을 막는 보호다.

- 인증된 `GET /api/auth/session` 응답은 session에 연결된 `csrfToken`을 반환한다.
- `POST`, `PUT`, `PATCH`, `DELETE`는 같은 값을 `X-CSRF-Token` header로 제출한다.
- 서버는 허용 origin, `Sec-Fetch-Site`와 token을 함께 검사한다.
- OAuth callback과 객체 저장소 presigned PUT은 각각 OAuth state와 서명된 URL로 보호하므로 이 header를 사용하지 않는다.
- 실패는 `403 CSRF_FAILED`다.

### 4.3 Project 소유권

- project ID나 artifact ID를 아는 사실은 권한이 아니다.
- 다른 사용자 project와 존재하지 않는 project는 모두 `404 PROJECT_NOT_FOUND`로 응답한다.
- nested resource가 해당 project에 속하지 않아도 같은 project-scoped 404 정책을 적용한다.
- MVP에는 공동 project와 역할별 권한이 없다.

## 5. 공통 request 규칙

### 5.1 Header

| header | 사용 | 규칙 |
|---|---|---|
| `Content-Type` | JSON request | `application/json` |
| `Accept` | 기본 | `application/json`; binary endpoint는 명시 media type |
| `X-CSRF-Token` | 모든 public mutation | session 응답에서 받은 token |
| `Idempotency-Key` | 생성·승인·완료·작업 시작·retry·cancel | UUID 권장, 16~128자 |
| `X-Request-Id` | 선택 | client UUID; 없으면 서버 생성 |
| `If-Match` | 일부 versioned command | 화면 cache가 아니라 domain version 확인 보조 |
| `If-None-Match` | polling·조회 | ETag가 같으면 `304` |

### 5.2 Idempotency

멱등성은 같은 command를 재전송해도 결과를 한 번만 만드는 성질이다.

- key scope는 `session user + endpoint operation + project`다.
- 같은 key와 같은 canonical request hash는 기존 성공·active job을 반환한다.
- 같은 key와 다른 request hash는 `409 IDEMPOTENCY_CONFLICT`다.
- network timeout 뒤에는 새 key를 만들지 않고 같은 key로 재전송한다.
- 화면별 저장 request의 `requestId`와 report의 `clientMutationId`는 해당 resource 내부 mutation dedupe key다.
- idempotency 성공 응답은 최초 응답과 같은 핵심 resource·job ID를 반환한다.

필수 endpoint 유형:

```text
project 생성
단계 complete·approval
upload session 생성·complete
inspection·generation·research·preview·validation·export 시작
job retry·cancel
AI proposal apply
report version restore·approve
artifact download URL 발급
```

### 5.3 Optimistic concurrency

낙관적 동시성 제어는 저장 시 “내가 읽은 version이 아직 최신인지” 검사하는 방식이다.

- project aggregate는 `projectVersion`
- stage resource는 `expectedVersion` 또는 domain-specific expected version
- workbook은 `workbookVersion`과 `editableCellSetVersion`
- report는 path의 `versionId`, body의 `expectedVersion`, `editSessionId`
- version mismatch는 `409`이며 서버가 자동 병합하거나 마지막 요청으로 덮어쓰지 않는다.
- conflict 응답은 가능한 경우 `currentVersion`, `currentVersionId`와 canonical reload URL을 `error.meta`에 포함한다.

### 5.4 ID·decimal·시간

- 모든 ID는 의미를 추정하지 않는 opaque string이다.
- ID prefix 예시는 문서 가독성용이며 business rule이 아니다.
- money, ratio, EPS, PER와 큰 정수는 JSON number가 아니라 canonical decimal string으로 교환한다.
- 날짜는 `YYYY-MM-DD`, 시각은 RFC 3339를 사용한다.
- client는 `cutoffDate`만 제출한다. 서버가 Asia/Seoul 일말 `cutoffAt`을 계산한다.
- list pagination cursor는 server 발급 opaque string이다.

## 6. 공통 response 규칙

### 6.1 HTTP status

| status | 의미 |
|---:|---|
| `200` | 동기 조회·변경 성공 |
| `201` | 새 동기 resource 생성 |
| `202` | 장시간 job 접수 |
| `204` | body 없는 성공 |
| `302` | OAuth redirect |
| `304` | ETag 기준 변경 없음 |
| `400` | JSON·query·field 형식 오류 |
| `401` | 로그인 필요·session 만료 |
| `403` | CSRF·origin 또는 public API 접근 정책 실패 |
| `404` | project 없음·타인 소유·project 내부 resource 없음 |
| `409` | version·state·idempotency·선행 단계 충돌 |
| `410` | 만료된 일회성 접근 descriptor |
| `422` | 형식은 맞지만 domain rule 불충족 |
| `423` | 계산·편집 등 일시적 domain lock |
| `429` | rate limit |
| `500` | 예기치 않은 server 실패 |
| `502` | upstream provider 응답 실패 |
| `503` | worker·provider·필수 dependency 일시 불가 |

### 6.2 Error envelope

모든 JSON 오류는 같은 구조를 사용한다.

```json
{
  "error": {
    "code": "OUTLINE_VERSION_CONFLICT",
    "message": "다른 탭에서 페이지 구성이 변경되었습니다.",
    "requestId": "c26f03ce-24d0-4be8-9a0e-a1507cebe778",
    "retryable": false,
    "details": [
      {
        "path": "changes[0].slotId",
        "code": "STALE_VALUE",
        "message": "최신 버전을 다시 불러오세요."
      }
    ],
    "meta": {
      "currentVersion": 8,
      "resumeRoute": "/projects/prj_01/process/report-outline"
    }
  }
}
```

규칙:

- `code`는 stable machine code다.
- `message`는 사용자에게 보여줄 수 있지만 UI 문구의 유일한 원본은 아니다.
- field 오류는 `details[].path`로 정확한 입력 위치를 가리킨다.
- retry 가능한 오류는 `retryable=true`와 가능하면 `retryAfter`를 포함한다.
- 선행 단계 오류는 `requiredStage`와 `resumeRoute`를 `meta`에 포함한다.
- stack trace, SQL, object key, bucket, worker host, Temporal workflow ID, provider credential과 Agent prompt를 반환하지 않는다.

### 6.3 Request 추적

- 모든 response는 `X-Request-Id`를 반환한다.
- API 오류 body의 `requestId`와 header는 같다.
- job 생성 response는 public `jobId`를 반환한다.
- internal workflow ID는 browser에 노출하지 않는다.

## 7. 장시간 job 계약

### 7.1 공통 projection

```json
{
  "jobId": "job_01...",
  "jobType": "research",
  "operationStatus": "running",
  "validity": "current",
  "phase": "collecting_documents",
  "progressPercent": 42,
  "progressMode": "determinate",
  "heartbeatAt": "2026-07-24T12:00:00Z",
  "retryable": false,
  "error": null,
  "links": {
    "self": "/api/projects/prj_01/research-jobs/job_01"
  }
}
```

`operationStatus`:

```text
queued
running
succeeded
failed
cancel_requested
cancelled
```

`validity`:

```text
current
obsolete
```

시간으로 임의 progress를 증가시키지 않는다. 처리량을 계산할 수 없으면 `progressMode=indeterminate`와 phase만 반환한다.

### 7.2 Polling

- active 상태는 visible document에서 3초 간격으로 조회한다.
- hidden이면 중단하고 visible 또는 focus 시 즉시 한 번 조회한다.
- terminal 상태에서 중단한다.
- 일시 실패 시 마지막 정상 projection을 유지하고 최대 30초까지 backoff한다.
- status GET은 가능하면 `ETag`를 반환한다.
- `If-None-Match`가 같으면 `304`와 body 없음이다.
- heartbeat가 늦어도 client가 성공·실패를 추정하지 않는다.

### 7.3 Retry·cancel

- retry와 cancel은 새 command이므로 각각 `Idempotency-Key`를 요구한다.
- cancel은 즉시 `cancelled`가 아니라 `cancel_requested`를 반환할 수 있다.
- retry는 immutable input version을 유지하고 새 activity attempt를 만든다.
- validation·지원 범위·손상 파일 오류는 retryable이 아니다.
- 성공 artifact가 있는 partial export는 성공 파일을 다시 만들지 않는다.

## 8. Public endpoint catalog

field 수준 계약은 OpenAPI schema를 사용한다. 아래 표의 “주요 오류” 외에도 인증·project ownership·CSRF·rate limit 공통 오류가 적용된다.

### 8.1 인증·기업·프로젝트

| Method | path | 성공 | 멱등성 | 주요 오류 |
|---|---|---:|---:|---|
| `GET` | `/api/auth/session` | `200` | 아니요 | 없음 |
| `GET` | `/api/auth/google/start` | `302` | 아니요 | `INVALID_RETURN_TO` |
| `GET` | `/api/auth/google/callback` | `302` | OAuth state | `OAUTH_STATE_INVALID`, `OAUTH_CALLBACK_FAILED` |
| `POST` | `/api/auth/logout` | `204` | 아니요 | `CSRF_FAILED` |
| `GET` | `/api/companies/search` | `200` | 아니요 | `INVALID_COMPANY_QUERY`, `COMPANY_SEARCH_UNAVAILABLE` |
| `GET` | `/api/projects` | `200` | 아니요 | `INVALID_PROJECT_QUERY`, `PROJECT_STATUS_UNAVAILABLE` |
| `POST` | `/api/projects` | `201` | 필수 | `INVALID_PROJECT_NAME`, `IDEMPOTENCY_CONFLICT` |

### 8.2 STEP 01 프로젝트 설정

| Method | path | 성공 | 주요 오류 |
|---|---|---:|---|
| `GET` | `/api/projects/{projectId}/process/setup` | `200` | `PROJECT_NOT_FOUND`, `SETUP_LOAD_FAILED` |
| `PATCH` | `/api/projects/{projectId}/process/setup` | `200` | `INVALID_SETUP_FIELD`, `STALE_PROJECT_VERSION`, `DOWNSTREAM_INVALIDATION_CONFIRMATION_REQUIRED`, `UNSUPPORTED_COMPANY` |
| `POST` | `/api/projects/{projectId}/process/setup/complete` | `200` | `SETUP_INCOMPLETE`, `STALE_PROJECT_VERSION`, `UNSUPPORTED_COMPANY` |

setup mutation에서 `valuationMethod`는 `PER`, `PBR`, `EV_EBITDA`, `DCF` 중 하나를 받는다. `reportType`, `companyDomain`, `cutoffAt`, owner와 완료 상태는 client 입력으로 받지 않으며, `companyDomain`은 선택 기업의 KRX 업종에서 서버가 결정한다.

### 8.3 STEP 02 파일 업로드·검사

| Method | path | 성공 | 주요 오류 |
|---|---|---:|---|
| `GET` | `/api/projects/{projectId}/process/files` | `200` | `FILES_PREREQUISITE_INCOMPLETE`, `FILES_STATE_LOAD_FAILED` |
| `POST` | `/api/projects/{projectId}/files/upload-sessions` | `201` | `INVALID_FILE_TYPE`, `FILE_TOO_LARGE` |
| `POST` | `/api/projects/{projectId}/files/upload-sessions/{uploadId}/complete` | `202` | `CHECKSUM_MISMATCH`, `UPLOAD_EXPIRED` |
| `DELETE` | `/api/projects/{projectId}/files/upload-sessions/{uploadId}` | `204` | `UPLOAD_ALREADY_COMMITTED` |
| `POST` | `/api/projects/{projectId}/file-inspections` | `202` | `FILE_NOT_ACCEPTED`, `STALE_FILE_VERSION` |
| `GET` | `/api/projects/{projectId}/file-inspections/{inspectionId}` | `200/304` | `INSPECTION_NOT_FOUND` |
| `POST` | `/api/projects/{projectId}/file-inspections/{inspectionId}/retry` | `202` | `STALE_INSPECTION_INPUT`, `JOB_NOT_RETRYABLE` |
| `POST` | `/api/projects/{projectId}/mapping-sets/{mappingSetId}/revisions` | `200` | `MAPPING_VERSION_CONFLICT`, `MAPPING_CHANGE_INVALID` |
| `POST` | `/api/projects/{projectId}/process/files/complete` | `200` | `INSPECTION_NOT_PASSED`, `MAPPING_NOT_CONFIRMED`, `STALE_PROJECT_VERSION` |

지원 파일 role은 `previous_report_pdf`, `analysis_workbook` 두 개다. TD-019에 따라 PDF는 50 MiB·100 page, XLSX는 100 MiB·50 sheet·전체 used-range 2,000,000 cell·sheet당 500,000 cell로 제한한다. upload session은 `maxSizeBytes`를 반환하며 complete 성공 전 object는 검사 입력이 아니다.

### 8.4 STEP 03 투자 의견·조사 질문

| Method | path | 성공 | 주요 오류 |
|---|---|---:|---|
| `GET` | `/api/projects/{projectId}/hypothesis` | `200` | `HYPOTHESIS_PREREQUISITE_INCOMPLETE` |
| `PATCH` | `/api/projects/{projectId}/hypothesis` | `200` | `VERSION_CONFLICT`, `INVALID_RATING`, `INVALID_THESIS` |
| `POST` | `/api/projects/{projectId}/hypothesis/generations` | `202` | `INPUT_REVISION_CHANGED`, `AGENT_UNAVAILABLE` |
| `GET` | `/api/projects/{projectId}/hypothesis/generations/{generationId}` | `200/304` | `GENERATION_NOT_FOUND` |
| `POST` | `/api/projects/{projectId}/hypothesis/question-sets/{questionSetId}/questions` | `200` | `QUESTION_COUNT_INVALID`, `QUESTION_TEXT_INVALID`, `QUESTION_METADATA_INVALID`, `VERSION_CONFLICT` |
| `PATCH` | `/api/projects/{projectId}/hypothesis/question-sets/{questionSetId}/questions/{questionId}` | `200` | `QUESTION_TEXT_INVALID`, `QUESTION_METADATA_INVALID`, `VERSION_CONFLICT` |
| `DELETE` | `/api/projects/{projectId}/hypothesis/question-sets/{questionSetId}/questions/{questionId}` | `200` | `VERSION_CONFLICT` |
| `PUT` | `/api/projects/{projectId}/hypothesis/question-sets/{questionSetId}/order` | `200` | `QUESTION_ORDER_INVALID`, `VERSION_CONFLICT` |
| `POST` | `/api/projects/{projectId}/hypothesis/question-sets/{questionSetId}/approval` | `200` | `QUESTION_COUNT_INVALID`, `QUESTION_METADATA_INVALID`, `INPUT_REVISION_CHANGED` |

질문 생성 결과는 Pydantic schema와 domain validation을 모두 통과한 뒤에만 API에 나타난다. 각 질문은 목적·지표·기간·비교 기준·제안 출처를 가지며 원시 model text는 반환하지 않는다.
사용자가 질문을 추가하거나 본문을 수정하면 server가 현재 프로젝트 문맥으로 같은 metadata를 다시 생성·검증한다.

### 8.5 STEP 04 자료 수집 및 계획

| Method | path | 성공 | 주요 오류 |
|---|---|---:|---|
| `GET` | `/api/projects/{projectId}/research-plan` | `200` | `PREREQUISITE_INCOMPLETE`, `PLAN_REVALIDATION_REQUIRED` |
| `PATCH` | `/api/projects/{projectId}/research-plan` | `200` | `INVALID_PLAN_CHANGE`, `PLAN_VERSION_CONFLICT`, `PLAN_LOCKED_BY_ACTIVE_JOB` |
| `POST` | `/api/projects/{projectId}/research-plan/approve-and-start` | `202` | `PLAN_VALIDATION_FAILED`, `RESEARCH_JOB_ALREADY_ACTIVE`, `WORKFLOW_START_UNAVAILABLE` |
| `GET` | `/api/projects/{projectId}/research-jobs/{jobId}` | `200/304` | `JOB_NOT_FOUND` |
| `POST` | `/api/projects/{projectId}/research-jobs/{jobId}/cancel` | `202` | `JOB_NOT_CANCELLABLE` |
| `POST` | `/api/projects/{projectId}/research-jobs/{jobId}/retry` | `202` | `JOB_NOT_RETRYABLE` |
| `POST` | `/api/projects/{projectId}/source-uploads` | `201` | `INVALID_FILE_TYPE`, `FILE_TOO_LARGE` |
| `POST` | `/api/projects/{projectId}/source-uploads/{uploadId}/complete` | `202` | `CHECKSUM_MISMATCH`, `UPLOAD_EXPIRED` |
| `GET` | `/api/projects/{projectId}/source-uploads/{uploadId}` | `200/304` | `UPLOAD_NOT_FOUND` |

plan approval, immutable input 고정, job과 outbox 생성은 한 transaction이다. 조사 자료는 plan당 파일 10개·URL 20개, PDF 50 MiB, XLSX 100 MiB, CSV 10 MiB, UTF-8 TXT 5 MiB까지 허용한다. 조사 workflow 성공 전에는 4단계를 완료하지 않는다.

### 8.6 STEP 05 조사 결과 검증

| Method | path | 성공 | 주요 오류 |
|---|---|---:|---|
| `GET` | `/api/projects/{projectId}/validation` | `200/304` | `PREREQUISITE_INCOMPLETE`, `PLAN_REVALIDATION_REQUIRED` |
| `GET` | `/api/projects/{projectId}/validation/results/{resultId}` | `200` | `RESULT_NOT_FOUND` |
| `GET` | `/api/projects/{projectId}/evidence/{evidenceId}/viewer` | `200` | `EVIDENCE_NOT_FOUND`, `SOURCE_ACCESS_RESTRICTED` |
| `GET` | `/api/projects/{projectId}/validation/workbook` | `200` | `WORKBOOK_VERSION_MISMATCH` |
| `POST` | `/api/projects/{projectId}/validation/results/{resultId}/decisions` | `200/202` | `STALE_VALIDATION_VERSION`, `INVALID_RESULT_TRANSITION` |
| `POST` | `/api/projects/{projectId}/validation/conflicts/{conflictId}/decision` | `200/202` | `CONFLICT_ALREADY_RESOLVED`, `STALE_VALIDATION_VERSION` |
| `POST` | `/api/projects/{projectId}/validation/drafts` | `200` | `INVALID_DECISION_REASON` |
| `POST` | `/api/projects/{projectId}/validation/complete` | `200` | `STAGE_GATE_BLOCKED`, `WORKBOOK_UPDATE_IN_PROGRESS` |

decision은 기존 Evidence를 수정·삭제하지 않는다. 사유는 5~500자다. TD-020의 `qualified`만 `ACCEPT_QUALIFIED`로 확인할 수 있고 `insufficient`는 우회할 수 없다. 재조사는 새 job과 새 validation version을 만들 수 있다.

### 8.7 STEP 06 PER 밸류에이션

| Method | path | 성공 | 주요 오류 |
|---|---|---:|---|
| `GET` | `/api/projects/{projectId}/valuation` | `200` | `VALUATION_PREREQUISITE_INCOMPLETE` |
| `GET` | `/api/projects/{projectId}/valuation/workbook` | `200` binary | `WORKBOOK_VERSION_MISMATCH` |
| `PATCH` | `/api/projects/{projectId}/valuation/workbook/cells` | `200` | `STALE_WORKBOOK_VERSION`, `READ_ONLY_CELL`, `FORMULA_CALCULATION_FAILED` |
| `PUT` | `/api/projects/{projectId}/valuation/draft` | `200` | `VALUATION_VERSION_CONFLICT`, `FORMULA_CALCULATION_FAILED` |
| `POST` | `/api/projects/{projectId}/valuation/approve` | `200` | `VALUATION_APPROVAL_BLOCKED`, `CALCULATION_STALE` |
| `POST` | `/api/projects/{projectId}/valuation/sensitivity` | `200` | `SENSITIVITY_INPUT_INVALID` |
| `POST` | `/api/projects/{projectId}/valuation/complete` | `200` | `VALUATION_NOT_APPROVED`, `STALE_VALUATION_VERSION` |

decimal 입력은 string이다. Target PER은 0.1~100.0, 소수점 한 자리이며 직접 목표주가는 1~1,000,000,000원의 정수다. React workbook grid는 표시·입력 UI이며 API response의 ClosedXML 계산 결과만 권위값이다.

### 8.8 STEP 07 페이지 내용 설정

| Method | path | 성공 | 주요 오류 |
|---|---|---:|---|
| `GET` | `/api/projects/{projectId}/report-outline` | `200` | `OUTLINE_PREREQUISITE_INCOMPLETE`, `OUTLINE_REVALIDATION_REQUIRED` |
| `POST` | `/api/projects/{projectId}/report-outline/generations` | `202` | `OUTLINE_GENERATION_FAILED` |
| `PATCH` | `/api/projects/{projectId}/report-outline` | `200` | `OUTLINE_VERSION_CONFLICT`, `OUTLINE_SLOT_READ_ONLY`, `OUTLINE_VALUE_INVALID` |
| `POST` | `/api/projects/{projectId}/report-outline/pages/{pageId}/review` | `200` | `PAGE_OUTLINE_INVALID` |
| `POST` | `/api/projects/{projectId}/report-outline/approve` | `202` | `OUTLINE_APPROVAL_BLOCKED`, `REPORT_DRAFT_GENERATION_FAILED` |
| `GET` | `/api/projects/{projectId}/tasks/{taskId}` | `200/304` | `TASK_NOT_FOUND` |
| `GET` | `/api/projects/{projectId}/evidence/{evidenceVersionId}` | `200` | `EVIDENCE_NOT_FOUND`, `SOURCE_ACCESS_RESTRICTED` |

outline generation·patch·approval은 Template IR의 page 수·좌표·fixed block을 바꾸지 않는다.

### 8.9 보고서 workspace

#### Bootstrap·version

| Method | path | 성공 |
|---|---|---:|
| `GET` | `/api/projects/{projectId}/report` | `200` |
| `GET` | `/api/projects/{projectId}/report/pages/{pageId}` | `200` |
| `GET` | `/api/projects/{projectId}/report/versions` | `200` |
| `POST` | `/api/projects/{projectId}/report/versions/{versionId}/restore` | `201` |

#### Edit session·저장

| Method | path | 성공 |
|---|---|---:|
| `POST` | `/api/projects/{projectId}/report/edit-sessions` | `201` |
| `POST` | `/api/projects/{projectId}/report/edit-sessions/{sessionId}/heartbeat` | `200` |
| `POST` | `/api/projects/{projectId}/report/edit-sessions/{sessionId}/takeover` | `200` |
| `PATCH` | `/api/projects/{projectId}/report/versions/{versionId}` | `200` |
| `DELETE` | `/api/projects/{projectId}/report/edit-sessions/{sessionId}` | `204` |

주요 오류는 `REPORT_VERSION_CONFLICT`, `EDIT_SESSION_CONFLICT`, `INVALID_REPORT_OPERATION`, `BLOCK_OVERFLOW`다. edit lease는 120초, heartbeat는 30초이며 server 시각상 만료된 lease만 takeover할 수 있다. autosave 성공은 새 report version과 block revision을 반환한다.

#### AI·첨부

| Method | path | 성공 |
|---|---|---:|
| `POST` | `/api/projects/{projectId}/report/ai-proposals` | `202` |
| `GET` | `/api/projects/{projectId}/report/ai-proposals/{proposalId}` | `200/304` |
| `POST` | `/api/projects/{projectId}/report/ai-proposals/{proposalId}/apply` | `200` |
| `POST` | `/api/projects/{projectId}/report/imports` | `201` |
| `GET` | `/api/projects/{projectId}/report/imports/{importId}` | `200/304` |
| `POST` | `/api/projects/{projectId}/report/imports/{importId}/complete` | `202` |

AI proposal은 TD-023 Agent profile로 실행하고 diff 확인 전 본문을 바꾸지 않는다. apply는 숫자·Evidence·투자의견·사용자 가정 보존을 다시 검사한다. report import는 CSV 10 MiB, XLSX 25 MiB, PNG·JPEG 15 MiB·20 MP만 허용하며 이미지 OCR은 MVP에서 제외한다. 다른 직접 업로드와 마찬가지로 upload session 생성과 `complete`를 분리한다.

#### 근거·미리보기·검증·승인

| Method | path | 성공 |
|---|---|---:|
| `GET` | `/api/projects/{projectId}/report/blocks/{blockId}/provenance` | `200` |
| `POST` | `/api/projects/{projectId}/report/previews` | `202` |
| `GET` | `/api/projects/{projectId}/report/previews/{previewId}` | `200/304` |
| `POST` | `/api/projects/{projectId}/report/validations` | `202` |
| `GET` | `/api/projects/{projectId}/report/validations/{runId}` | `200/304` |
| `POST` | `/api/projects/{projectId}/report/validations/{runId}/acknowledgements` | `200` |
| `POST` | `/api/projects/{projectId}/report/versions/{versionId}/approve` | `200` |

승인은 exact report version과 exact validation run이 같고 blocking issue가 0개일 때만 성공한다. 주요 오류는 `VALIDATION_STALE`, `APPROVAL_VERSION_MISMATCH`, `UNVERIFIED_VALUE`다.

#### Export·download

| Method | path | 성공 |
|---|---|---:|
| `POST` | `/api/projects/{projectId}/report/exports` | `202` |
| `GET` | `/api/projects/{projectId}/report/exports/{exportId}` | `200/304` |
| `POST` | `/api/projects/{projectId}/report/exports/{exportId}/retry` | `202` |
| `POST` | `/api/projects/{projectId}/report/exports/{exportId}/cancel` | `202` |
| `POST` | `/api/projects/{projectId}/artifacts/{artifactId}/download` | `200` |

PDF와 XLSX를 파일별 상태로 반환한다. `outcome=partial`이면 성공 파일은 다운로드할 수 있고 실패 파일만 retry한다. DOCX는 MVP에 없다.

## 9. Internal Worker API

### 9.1 Security

- 모든 operation은 `workloadIdentity` security scheme이 필요하다.
- token의 subject·audience·workload role을 검증한다.
- workload role별 허용 command와 job type을 제한한다.
- public session cookie·CSRF token은 내부 권한이 아니다.
- response에 다른 project의 정보나 사용자 문서 원문을 포함하지 않는다.

### 9.2 Endpoint

| Method | path | caller | 목적 |
|---|---|---|---|
| `POST` | `/internal/v1/jobs/{jobId}/progress` | activity worker | 단조 증가 sequence의 progress·heartbeat 제출 |
| `POST` | `/internal/v1/jobs/{jobId}/results` | activity worker | typed result와 temporary artifact descriptor 제출 |
| `POST` | `/internal/v1/jobs/{jobId}/terminal` | Workflow Control Worker | terminal outcome과 output version commit 요청 |
| `GET` | `/internal/v1/reconciliation/jobs` | Workflow Control Worker | active·stale projection batch 조회 |
| `POST` | `/internal/v1/reconciliation/jobs/{jobId}` | Workflow Control Worker | Temporal 관측 상태와 repair command 제출 |

### 9.3 Progress command

필수값:

- `schemaVersion`
- `sequence`
- `inputVersionIds`
- public `phase`
- `progressMode`, `progressPercent`
- `heartbeatAt`
- optional 처리량 counter

같은 sequence와 같은 payload는 성공으로 처리한다. 낮은 sequence는 무시한 현재 projection을 반환하고, 같은 sequence의 다른 payload는 `409 PROGRESS_SEQUENCE_CONFLICT`다.

### 9.4 Result command

필수값:

- `schemaVersion`
- `sequence`
- `inputVersionIds`
- `resultType`
- versioned typed payload
- temporary artifact descriptor
- tool name·version

request body의 machine-readable 권위는 [`worker-result-envelope.schema.json`](../contracts/schemas/v1/worker-result-envelope.schema.json)이다. `resultType`별 payload, artifact descriptor와 worker error code는 [`contracts/schemas/`](../contracts/schemas/README.md)에서 함께 version 관리한다.

Internal API는 object metadata와 checksum, job·project·input version을 다시 확인한다. 검증 전 artifact를 DB output version에 연결하지 않는다.

### 9.5 Terminal·reconciliation

- terminal status는 `succeeded`, `failed`, `cancelled`만 허용한다.
- `succeeded`는 필요한 result command와 output artifact가 모두 commit된 경우만 허용한다.
- Temporal은 terminal인데 projection이 active면 terminal command를 같은 key로 재제출한다.
- projection만 active이고 execution이 없으면 outbox 상태를 확인한 뒤 재dispatch 또는 `reconciliation_required`로 전환한다.
- reconciliation repair도 idempotency key와 audit event를 남긴다.

## 10. 주요 schema

### 10.1 Stage key

```text
setup
files
hypothesis
research_plan
validation
valuation
report_outline
```

report는 8번째 stage가 아니다.

### 10.2 Version reference

```json
{
  "versionId": "rv_01...",
  "version": 7,
  "lifecycleStatus": "draft",
  "validityStatus": "current",
  "createdAt": "2026-07-24T12:00:00Z"
}
```

API의 숫자 `version`은 한 resource stream 안의 optimistic concurrency 값이다. job·approval·artifact 연결은 내부적으로 `versionId`를 고정한다.

### 10.3 Source·Evidence locator

- PDF: source version, 0-based page index, label, CropBox point bbox, rotation, exact quote
- HTML: canonical URL, Text Fragment, exact quote, prefix·suffix
- structured API: endpoint label, canonical parameter summary, JSON Pointer
- Excel: workbook version, stable sheet ID, cell/range, formula와 dependency path

viewer descriptor의 URL은 짧게 만료되며 API가 object key를 입력으로 받지 않는다.

### 10.4 Workbook cell

```json
{
  "sheetId": "sheet-forecast",
  "address": "K18",
  "valueType": "number",
  "value": "314200"
}
```

- `number` value는 decimal string
- formula·format·merge·row·column·sheet·chart 구조 변경 금지
- multi-cell paste 중 잠긴 셀이 하나라도 있으면 전체 batch 실패
- 성공 response의 sparse delta와 새 workbook version만 React workbook grid에 반영

### 10.5 Report operation

초기 허용 operation:

```text
replace_text
replace_block_text
apply_ai_proposal
apply_table_binding
apply_chart_binding
undo
redo
```

operation type별 payload는 OpenAPI discriminator를 사용한다. `fixed`, `protected_numeric` block과 숫자 binding은 text operation으로 수정할 수 없다.

## 11. Cache·binary·download

- project bootstrap과 workspace GET은 private cache이며 shared CDN cache 금지다.
- session·project response는 기본 `Cache-Control: private, no-store`다.
- polling GET은 `ETag`를 사용할 수 있지만 다른 사용자와 공유하지 않는다.
- workbook은 same-origin versioned JSON read model로 제공하고 PDF preview URL만 짧게 만료한다.
- `POST artifacts/{artifactId}/download`는 권한 검사 후 새 URL을 발급한다.
- 만료 URL을 갱신할 때 artifact를 재생성하지 않는다.
- binary response는 안전한 `Content-Type`, `Content-Disposition`과 `X-Content-Type-Options: nosniff`를 사용한다.

## 12. Rate limit 기준

정확한 수치는 부하 측정 후 운영 설정으로 조정하되 key와 응답 계약은 고정한다.

| 범위 | key |
|---|---|
| 인증 시작 | IP + browser state |
| 일반 조회 | session user |
| project mutation | session user + project |
| Agent·workflow 시작 | session user + project + operation |
| upload session | session user + project |
| internal command | workload identity + job |

`429`는 `Retry-After` header와 `RATE_LIMITED` error를 반환한다. client는 같은 command의 idempotency key를 유지한다.

## 13. 구현 배치

```text
source-react/
  app/api/
    auth/
    companies/
    projects/
  server/http/
    auth
    request-validation
    response-mapping
  server/application/
    projects
    setup
    files
    hypothesis
    research
    validation
    valuation
    report-outline
    report
  server/domain/
  server/infrastructure/

contracts/
  openapi/
    reflo-v1.yaml
    redocly.yaml
  schemas/
```

Route Handler는 SQL, S3 SDK, Temporal Workflow와 PydanticAI를 직접 실행하지 않는다. application use case를 호출하고 HTTP mapping만 담당한다.

## 14. 구현 순서

1. OpenAPI lint·breaking change 검사와 type generation을 CI에 추가한다.
2. 공통 error, request ID, session·CSRF와 project owner middleware를 구현한다.
3. `/api/auth/session`, `/api/projects`, setup 수직 흐름을 구현한다.
4. upload session, artifact와 공통 job projection을 구현한다.
5. file inspection과 stage completion을 연결한다.
6. hypothesis·research·validation·valuation·outline 순서로 구현한다.
7. report revision·edit session·validation·approval·export를 구현한다.
8. Internal Worker API와 worker contract fixture를 실제 worker 언어별로 검증한다.

각 단계에서 OpenAPI response fixture, application integration test와 browser 화면을 함께 확인한다.

## 15. Contract test 기준

OpenAPI lint 기준 명령:

```powershell
npx -y @redocly/cli lint contracts/openapi/reflo-v1.yaml --config contracts/openapi/redocly.yaml
```

- 모든 path·method에 unique `operationId`가 있다.
- 모든 public mutation은 session·CSRF를 요구한다.
- 지정된 command endpoint는 `Idempotency-Key`를 요구한다.
- 모든 `{projectId}` endpoint는 project owner 검사를 통과해야 한다.
- request의 알 수 없는 top-level field는 거부한다.
- decimal string, date, version과 enum validation이 TS·Python·C#에서 같다.
- error response는 공통 envelope를 따른다.
- 다른 사용자 project·artifact·Evidence·job은 동일한 404다.
- stale version mutation은 409이며 기존 데이터를 바꾸지 않는다.
- job status는 PostgreSQL projection과 일치하고 Temporal ID를 노출하지 않는다.
- ETag 304는 body를 반환하지 않는다.
- binary response는 object key·credential을 노출하지 않는다.
- report approval은 exact validation run mismatch를 거부한다.
- internal command는 workload identity·sequence·input version·artifact hash를 검증한다.

## 16. 완료 조건

- [x] OpenAPI가 문법·reference validation을 통과한다.
- [x] 모든 화면 명세 endpoint가 OpenAPI path에 존재한다.
- [x] 모든 OpenAPI operation이 이 문서의 catalog에 존재한다.
- [x] auth·CSRF·소유권·idempotency·version 규칙이 공통 component로 재사용된다.
- [x] project·job·artifact·Evidence·workbook·report ID가 opaque하게 처리된다.
- [x] public response에 object key·Temporal workflow ID·provider credential이 없다.
- [x] job과 report 상태 enum이 ERD·화면 명세와 일치한다.
- [x] decimal·date·cutoff 규칙이 TD-015와 일치한다.
- [x] React workbook grid와 ClosedXML의 권위 경계가 request·response에 반영된다.
- [x] Agent output이 proposal·draft이고 승인·Evidence를 우회하지 않는다.
- [x] Internal Worker API가 PostgreSQL direct write를 대체한다.
- [x] README·아키텍처·ERD·기술 결정문에서 API 명세로 이동할 수 있다.
