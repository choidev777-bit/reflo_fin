# REFLO 시스템 아키텍처 v1

**문서 상태:** 목표 아키텍처 기준선  
**작성 기준일:** 2026-07-24  
**대상:** 현업 배포용 MVP  
**현재 구현 위치:** `source-react/`  
**관련 문서:**

- [URL별 서비스 동작 명세](./REFLO_URL_SERVICE_BEHAVIOR_v1.md)
- [기술 결정 사항](./REFLO_TECHNICAL_DECISIONS_v1.md)
- [화면 구현 명세 인덱스](./REFLO_SCREEN_IMPLEMENTATION_SPEC_v1.md)
- [작업 로그](./REFLO_WORKLOG.md)

## 1. 문서 목적

이 문서는 REFLO를 어떤 실행 단위로 나누고, 각 단위가 어떤 데이터와 책임을 가지며, 서로 어떻게 통신하는지 정의한다. ERD의 세부 table·column과 API의 endpoint별 payload는 후속 문서에서 정의한다.

핵심 목표는 다음과 같다.

1. 디자이너가 만든 React UI를 다시 설계하지 않고 실제 데이터와 연결한다.
2. 브라우저·API·장시간 작업·파일 처리·Agent의 책임을 분리한다.
3. PDF·Excel·Evidence·보고서를 특정 입력과 도구 버전으로 재현할 수 있게 한다.
4. 사용자 파일과 프로젝트를 로그인 사용자 단위로 격리한다.
5. 서버나 worker가 재시작되어도 장시간 작업을 안전하게 재개한다.

## 2. 현재 상태와 목표 상태

### 2.1 현재 상태

현재 `source-react/`는 표준 Next.js App Router 프로젝트다.

- `/`와 9개 하위 route 파일은 대부분 `app/page.tsx`를 다시 내보낸다.
- `app/page.tsx`, `app/process.tsx`, `app/globals.css`에 화면과 샘플 데이터가 집중돼 있다.
- route 이동은 브라우저 `pushState`와 로컬 React state로 흉내 낸다.
- Google 인증, PostgreSQL, 객체 저장소, API, Temporal, worker와 PydanticAI는 연결되지 않았다.
- 파일 분석, AI 수정, 저장, 진행률과 다운로드는 실제 작업이 아닌 프로토타입 동작이다.

현재 구조는 디자인 기준선으로는 유효하지만 업무 데이터의 권위 시스템으로 사용할 수 없다.

### 2.2 목표 상태

MVP는 다음 구조를 사용한다.

- **Next.js 웹/API 모듈러 모놀리스:** 화면 렌더링, 인증, 동기 API, 도메인 규칙과 장시간 작업 시작
- **PostgreSQL:** 사용자, session, 프로젝트, workflow 상태, version, Evidence와 작업 projection
- **S3 호환 객체 저장소:** 원본과 파생 PDF·XLSX, 원문 snapshot, page image와 최종 artifact
- **Temporal:** 장시간·다단계 작업의 실행 이력, 재시도, 취소와 복구
- **격리 worker:** PDF Python, Excel .NET, Research/Validation Python, PydanticAI Agent
- **SpreadJS React:** validation 읽기 전용 workbook과 valuation 허용 셀 편집

MVP에서는 별도 범용 API microservice를 먼저 만들지 않는다. Next.js의 Node.js server runtime이 웹 BFF와 application service 역할을 함께 맡는다. BFF는 브라우저에 맞는 응답을 제공하는 서버 경계다. PDF·Excel·Agent 실행은 이 process 밖의 worker로 분리한다.

## 3. 아키텍처 원칙

### 3.1 서버 권위

- 브라우저 state, 파일명, 사용자 ID, 계산값과 완료 표시는 권위값이 아니다.
- PostgreSQL의 domain version과 작업 projection이 구조화 상태의 권위다.
- S3 호환 저장소의 hash가 고정된 artifact가 파일 byte의 권위다.
- Excel 계산과 최종 XLSX 저장은 Aspose.Cells가 권위다.
- Agent 출력은 제안이며 Evidence 검증, 결정적 계산과 사용자 승인을 대체하지 않는다.

### 3.2 불변 원본과 새 version

- 업로드 원본은 수정하지 않는다.
- 상위 입력 변경은 기존 결과를 덮어쓰지 않고 새 version을 만든다.
- 모든 하위 산출물은 자신을 만든 상위 version ID를 기록한다.
- 상위 변경의 영향을 받는 하위 결과는 `stale` 또는 `revalidation_required`가 된다.
- 승인·내보낸 보고서는 이후 데이터 변경으로 자동 수정되지 않는다.

### 3.3 무거운 실행의 격리

- Next.js process에서 PDF parser, PDFium, OpenCV, Aspose.Cells와 업로드 폰트를 실행하지 않는다.
- browser에서 Temporal, 객체 저장소 credential, OpenAI key와 worker 내부 API에 직접 접근하지 않는다.
- 파일 처리 worker는 기본적으로 외부 network를 사용하지 않는다.
- 외부 자료 수집은 allowlist가 적용된 `research-network` worker만 수행한다.

### 3.4 최소 기술

- Vinext, Cloudflare Workers, Wrangler, D1과 OpenAI Sites는 목표 architecture의 구성요소가 아니다.
- Drizzle은 필수 architecture dependency가 아니다. PostgreSQL access와 migration 도구는 구현 전에 별도로 고정한다.
- Redis, 별도 message broker와 검색 cluster는 측정된 필요가 생기기 전 추가하지 않는다.
- 초기 작업 상태 전달은 TD-016의 3초 polling을 사용한다.

## 4. 시스템 컨텍스트

```mermaid
flowchart LR
    User["애널리스트"]
    Browser["REFLO Web<br/>Next.js·React"]
    Google["Google OAuth/OIDC"]
    OpenAI["OpenAI GPT API"]
    Sources["외부 자료원<br/>DART·IR·KRX·ECOS·FnGuide·뉴스"]
    Reflo["REFLO Backend Boundary"]
    Storage["PostgreSQL·S3"]
    Workers["Temporal·격리 Worker"]

    User --> Browser
    Browser --> Google
    Browser --> Reflo
    Reflo --> Storage
    Reflo --> Workers
    Workers --> Storage
    Workers --> OpenAI
    Workers --> Sources
```

신뢰 경계:

1. 브라우저와 모든 외부 provider 입력은 신뢰하지 않는다.
2. Next.js server가 session, project 소유권, 입력 schema와 domain version을 검증한다.
3. worker 결과도 schema, version과 artifact hash 검증을 통과한 뒤에만 domain 상태에 반영한다.

## 5. Container 구조

```mermaid
flowchart TB
    subgraph Client["사용자 환경"]
        UI["Next.js React UI<br/>SpreadJS 포함"]
    end

    subgraph Web["Web/Application 경계"]
        Next["Next.js Node Runtime"]
        Auth["Auth·Session"]
        API["Route Handlers·Application Services"]
        Dispatcher["Outbox Dispatcher"]
    end

    subgraph State["상태·파일"]
        PG[("PostgreSQL")]
        S3[("S3 호환 객체 저장소")]
    end

    subgraph Orchestration["장시간 작업"]
        Temporal["Temporal"]
        FileScan["File Scan Worker"]
        Pdf["Python PDF Worker"]
        Excel[".NET Excel Worker"]
        Research["Research·Validation Worker"]
        Agent["PydanticAI Agent Worker"]
        Publish["Publish Worker"]
    end

    UI --> Next
    Next --> Auth
    Next --> API
    Auth --> PG
    API --> PG
    API --> S3
    API --> Dispatcher
    Dispatcher --> PG
    Dispatcher --> Temporal
    Temporal --> FileScan
    Temporal --> Pdf
    Temporal --> Excel
    Temporal --> Research
    Temporal --> Agent
    Temporal --> Publish
    FileScan --> S3
    Pdf --> S3
    Excel --> S3
    Research --> S3
    Agent --> S3
    Publish --> S3
    FileScan --> PG
    Pdf --> PG
    Excel --> PG
    Research --> PG
    Agent --> PG
    Publish --> PG
```

`Outbox Dispatcher`는 DB transaction에 기록된 작업 시작 명령을 Temporal로 전달하는 구성요소다. 요청 도중 process가 종료돼도 명령이 사라지지 않게 하며, 같은 명령을 다시 전달해도 deterministic workflow ID와 idempotency key로 한 번만 적용한다.

## 6. 실행 단위와 책임

| 실행 단위 | 주요 책임 | 소유 데이터 | 금지 |
|---|---|---|---|
| Browser UI | 입력, 화면 상태, polling, Evidence 탐색, SpreadJS 표시·편집 | 저장 전 draft와 UI state | DB·S3·Temporal·OpenAI 직접 접근 |
| Next.js server | 인증, 소유권, 입력 검증, domain command/query, 작업 시작, presigned URL | HTTP session과 request context | 무거운 파일 parser·장시간 Agent 실행 |
| PostgreSQL | 구조화 domain 상태, version, Evidence, 작업 projection, audit metadata | row·transaction | 대형 PDF·XLSX·page image 저장 |
| S3 호환 저장소 | 원본·파생·최종 artifact byte | immutable object | 사용자 권한과 workflow 상태 판정 |
| Temporal | workflow 실행 이력, timer, retry, cancellation | workflow history | 사용자 화면 조회의 직접 권위 |
| File Scan worker | magic byte, 크기, 암호화, 악성·지원 범위 검사 | 검사 결과 artifact | 외부 internet |
| PDF worker | Template IR, 구조 분석, patch, render, 시각 검증 | PDF 파생 artifact | project 승인 판단 |
| Excel worker | workbook 분석, 재계산, 검증, 최종 XLSX 저장 | workbook 파생 artifact | 브라우저 계산값 신뢰 |
| Research worker | 허용 출처 수집, 원문 snapshot, 후보 추출 | source artifact·candidate | unrestricted network |
| Validation worker | 원문 재확인, 값·문맥 검증, Evidence 생성 | validation result·Evidence | Research 추론을 사실로 신뢰 |
| Agent worker | PydanticAI structured output 생성 | 검증 전 Agent result | 권위 계산·최종 사용자 판단 |
| Publish worker | 승인 version 고정, 다운로드 artifact 게시 | final artifact metadata | 검증 실패 결과 게시 |

worker의 DB 권한은 자신의 job 진행률, typed result와 artifact metadata에 필요한 범위로 제한한다. 단계 완료, 사용자 승인과 project 소유권 변경은 Next.js application service만 수행한다.

## 7. Web/Application 내부 구조

Next.js 안에서도 route 파일에 SQL과 domain 규칙을 직접 넣지 않는다.

```text
app/
  route·page·layout
    ↓
server/http/
  session·request schema·response mapping
    ↓
server/application/
  use case·transaction·authorization
    ↓
server/domain/
  entity·version·stage transition·invalidation rule
    ↓
server/infrastructure/
  PostgreSQL·S3·Temporal·provider adapter
```

의존 방향은 위에서 아래로만 흐른다.

- `app/`은 application use case를 호출하며 SQL을 알지 않는다.
- `domain/`은 Next.js, PostgreSQL client, S3 SDK와 Temporal SDK를 import하지 않는다.
- `infrastructure/`는 domain interface를 구현한다.
- worker와 공유하는 계약은 TypeScript class가 아니라 version이 있는 JSON Schema·OpenAPI schema로 교환한다.

## 8. 동기 요청 흐름

프로젝트 설정 저장처럼 짧은 작업은 한 HTTP 요청 안에서 완료한다.

```mermaid
sequenceDiagram
    actor User as 사용자
    participant UI as Browser
    participant API as Next.js API
    participant DB as PostgreSQL

    User->>UI: 설정 저장
    UI->>API: PATCH setup + projectVersion
    API->>API: session·소유권·schema 검증
    API->>DB: transaction과 version 조건부 UPDATE
    alt 최신 version
        DB-->>API: 새 version
        API-->>UI: 200 + canonical project context
    else stale version
        DB-->>API: conflict
        API-->>UI: 409 + 최신 version 재조회 안내
    end
```

자동 저장도 같은 use case를 사용한다. 마지막 응답이 이기는 방식으로 덮어쓰지 않고 project 또는 resource version으로 충돌을 검출한다.

## 9. 비동기 작업 흐름

파일 검사, 자료 수집, Agent 생성과 보고서 export처럼 긴 작업은 HTTP 요청과 분리한다.

```mermaid
sequenceDiagram
    actor User as 사용자
    participant UI as Browser
    participant API as Next.js API
    participant DB as PostgreSQL
    participant D as Outbox Dispatcher
    participant T as Temporal
    participant W as 격리 Worker
    participant S3 as Object Storage

    User->>UI: 검사 시작
    UI->>API: POST command + Idempotency-Key
    API->>DB: job·input version·outbox를 한 transaction에 저장
    API-->>UI: 202 + jobId + queued
    D->>DB: 미전송 outbox 조회
    D->>T: deterministic workflow 시작
    T->>W: version이 고정된 activity 실행
    W->>S3: 임시·결과 artifact 저장
    W->>DB: phase·progress·result projection 갱신
    loop active job
        UI->>API: 3초 polling
        API->>DB: projection 조회
        API-->>UI: operationStatus·progress
    end
    W->>DB: succeeded 또는 failed와 output version 저장
    UI->>API: 최종 상태 조회
    API-->>UI: 결과·다음 가능 동작
```

DB commit은 됐지만 Temporal 시작이 실패한 경우 dispatcher가 재전송한다. Temporal 시작은 됐지만 응답 전 연결이 끊긴 경우 같은 idempotency key가 기존 job을 반환한다.

## 10. 파일 수명주기

```text
upload session 발급
  → quarantine object 직접 업로드
  → server checksum·크기 확인
  → file-scan worker 검사
  → 통과 시 immutable artifact 등록
  → 분석용 working copy 생성
  → 파생 artifact와 입력 version 연결
  → 검증·승인
  → final artifact 게시
```

상태 예:

```text
uploading → quarantined → scanning → accepted | rejected
accepted → processing → ready | failed
ready → superseded
```

- 원본과 승인 artifact는 같은 object key로 덮어쓰지 않는다.
- 임시 object는 최종 결과에 직접 연결할 수 없다.
- 다운로드 URL은 매 요청마다 session과 project 소유권을 확인한 뒤 짧게 발급한다.
- 사용자에게 object key, bucket 이름과 storage credential을 노출하지 않는다.

## 11. URL과 backend 책임 매핑

| URL | 동기 application 책임 | 비동기 책임 | 주요 저장 |
|---|---|---|---|
| `/` | session 조회, 프로젝트 생성 | 없음 | user, session, project |
| `/projects` | 소유 프로젝트 검색·정렬·resume route | active job projection 표시 | project, stage, job projection |
| `process/setup` | 기업·분기·기준일 저장, 단계 완료 | 기업 master 동기화는 별도 운영 작업 | project setup version |
| `process/files` | upload session, 파일 확정, 결과 확인 | scan, PDF·Excel 분석, MappingSet | artifact, Template IR, workbook metadata |
| `process/hypothesis` | 투자의견·가설·질문 편집과 승인 | PydanticAI Hypothesis Agent | hypothesis·question version |
| `process/research-plan` | source·질문·cell 계획 승인 | 자료 수집·후보 추출 | plan, source, collection job |
| `process/validation` | Evidence 선택·반려·재조사·승인 | 원문 독립 검증, workbook read model | Evidence, locator, validation version |
| `process/valuation` | 허용 셀 입력, PER 판단·승인 | Aspose.Cells 재계산·검증 | workbook calculation, valuation version |
| `process/report-outline` | page·slot 구성과 승인 | Outline·Draft Agent | outline version, generation job |
| `/report` | 편집 operation, 검증 요청, 최종 승인 | PDF patch·render·검증·PDF/XLSX export | report version, render plan, final artifact |

## 12. 데이터 소유권과 일관성

### 12.1 권위 저장소

| 데이터 | 권위 저장소 |
|---|---|
| 사용자·session·project·stage | PostgreSQL |
| 구조화 Evidence·locator·provenance | PostgreSQL |
| 작업의 사용자 표시 상태 | PostgreSQL projection |
| workflow 재시도·timer·실행 history | Temporal |
| PDF·XLSX·원문·image·대형 result | S3 호환 저장소 |
| 브라우저의 workbook 표현 | SpreadJS instance, 비권위 |

### 12.2 version 고정

장시간 작업을 시작할 때 입력 version 집합을 고정한다.

```text
job.input_versions = {
  setupVersion,
  sourceFileVersionIds,
  hypothesisVersionId,
  researchPlanVersionId,
  evidenceSetVersionId,
  workbookVersionId,
  valuationVersionId,
  outlineVersionId
}
```

작업 완료 시 현재 version과 입력 version이 다르면 결과를 삭제하지 않고 `obsolete`로 저장한다. 사용자는 최신 입력으로 재실행할 수 있고 과거 실행은 감사·비교에 남는다.

### 12.3 단계 무효화

```mermaid
flowchart LR
    Setup["설정"]
    Files["파일·매핑"]
    Hypothesis["가설·질문"]
    Research["조사 계획·수집"]
    Validation["Evidence 검증"]
    Valuation["밸류에이션"]
    Outline["페이지 구성"]
    Report["보고서"]

    Setup --> Files --> Hypothesis --> Research --> Validation --> Valuation --> Outline --> Report
```

상위 version 변경은 영향을 받는 가장 이른 하위 단계부터 `revalidation_required`로 만든다. 어떤 단계로 복귀할지는 서버가 `resumeRoute`로 계산한다.

## 13. 인증·권한·보안

### 13.1 인증과 session

- TD-014에 따라 Google OAuth/OIDC만 사용한다.
- PostgreSQL에 hash된 불투명 session token을 저장한다.
- cookie는 production에서 `HttpOnly`, `Secure`, `SameSite=Lax`를 적용한다.
- idle 7일, absolute 30일 만료와 즉시 로그아웃 폐기를 적용한다.
- 상태 변경 요청은 same-origin과 CSRF 보호를 사용한다. CSRF는 사용자의 로그인 상태를 악용한 외부 사이트 요청을 차단하는 보호다.

### 13.2 프로젝트 격리

- 모든 query와 command는 session 사용자와 project owner를 server-side 조건으로 포함한다.
- 다른 사용자 소유 project와 존재하지 않는 project는 같은 `404 PROJECT_NOT_FOUND`를 반환한다.
- object key, artifact ID와 project ID를 알고 있어도 권한이 되지 않는다.
- MVP에는 공동 프로젝트와 역할별 권한이 없다.

### 13.3 파일과 network

- upload는 quarantine을 거쳐 검사 통과 후에만 immutable artifact가 된다.
- file worker는 non-root, read-only root filesystem, 제한된 CPU·memory·disk로 실행한다.
- file worker의 internet 접근과 cloud metadata endpoint 접근을 차단한다.
- research worker는 승인 host allowlist와 redirect·private IP 차단을 적용한다.

### 13.4 Agent 보안

- `OPENAI_API_KEY`는 `llm` worker secret으로만 주입한다.
- 사용자 입력과 수집 문서 안의 명령은 data로 취급하고 system instruction으로 실행하지 않는다.
- Agent output은 Pydantic schema와 domain rule을 통과해야 저장된다.
- 원시 reasoning은 화면, Evidence와 일반 로그에 저장하지 않는다.
- model, prompt, schema, tool version과 token usage는 실행 metadata로 남긴다.

## 14. 신뢰성·재시도·취소

- API command는 `Idempotency-Key`를 사용한다. 같은 요청의 재전송은 기존 job 또는 결과를 반환한다.
- Temporal activity는 입력 version hash와 도구 version으로 중복 결과를 검출한다.
- validation 오류와 지원하지 않는 파일은 재시도하지 않는다.
- network timeout, `429`, `5xx`와 worker process 장애만 제한 횟수로 재시도한다.
- 장시간 activity는 phase, 처리 개수와 최근 진전 시각을 heartbeat로 보낸다.
- 취소는 `cancel_requested`를 거쳐 자식 process를 종료하고 `cancelled`로 확정한다.
- partial artifact는 `temporary` 상태로 격리하며 publish worker만 최종 artifact를 게시한다.

초기 timeout과 retry 수치는 TD-011을 따르며 실제 표본 p95와 peak resource 측정 후 조정한다.

## 15. 상태 조회와 사용자 경험

- active job은 3초 간격으로 조회한다.
- document가 hidden이면 polling을 중단한다.
- 다시 visible이 되거나 window focus를 얻으면 즉시 조회한다.
- terminal 상태에서 polling을 중단한다.
- 일시적 실패는 마지막 정상 데이터를 유지하고 최대 30초까지 backoff한다.
- 상태 응답은 `operationStatus`, `phase`, `progressPercent`, `heartbeatAt`, `retryable`, 사용자용 error code를 공통으로 사용한다.
- Temporal workflow ID와 내부 activity 이름은 브라우저에 노출하지 않는다.

## 16. 관측성과 감사

### 16.1 공통 식별자

모든 요청과 작업은 다음 식별자를 연결한다.

- `requestId`
- `traceId`
- `userId`
- `projectId`
- domain job ID
- input version ID 집합
- artifact ID
- workflow ID는 내부 로그에서만 사용

### 16.2 주요 metric

- API latency·error rate
- DB connection·slow query·version conflict
- outbox backlog와 dispatch latency
- Temporal queue wait·workflow duration·retry·cancellation
- worker별 p50·p95, CPU, peak RSS와 temporary disk
- source provider latency·rate limit·format change
- Agent schema 실패율, token, latency와 비용
- PDF 구조·시각 검증 실패율
- Excel 재계산·호환성 실패율

### 16.3 로그 금지 정보

- session token·OAuth token·OpenAI key
- presigned URL 전체와 storage credential
- 원문 파일 byte와 사용자 문서 전체
- 원시 model reasoning
- 불필요한 개인정보와 전체 prompt

감사 로그는 누가 어떤 version을 만들고 승인·반려·재실행·내보냈는지 기록한다. 일반 application log와 감사 기록의 보존 정책은 분리한다.

## 17. 배포 단위와 환경

### 17.1 배포 단위

1. `web`: Next.js Node.js runtime
2. `workflow-dispatcher`: outbox 전달과 짧은 orchestration support
3. `worker-file-scan`
4. `worker-pdf`
5. `worker-excel`
6. `worker-research-validation`
7. `worker-agent`
8. `worker-publish`
9. PostgreSQL
10. S3 호환 객체 저장소
11. Temporal

web과 worker는 같은 release version을 공유할 수 있지만 독립적으로 배포·확장한다. Next.js Edge runtime에는 DB·Temporal·파일 처리 책임을 넣지 않는다.

### 17.2 환경 분리

| 환경 | 목적 | 데이터 |
|---|---|---|
| local | 개발·단일 사용자 확인 | 합성·비민감 표본 |
| test/CI | unit·integration·contract·E2E | 매 실행 격리 fixture |
| staging | 실제 배포 구조·회귀·부하 검증 | 비식별 표본 |
| production | 사용자 업무 | 암호화·backup·감사 정책 적용 |

환경마다 DB, bucket, Temporal namespace, OAuth client와 OpenAI key를 분리한다. production 원본을 local·CI로 복사하지 않는다.

### 17.3 미확정 infrastructure 선택

다음 provider 선택은 아직 architecture에 고정하지 않는다.

- Next.js·worker container hosting
- managed PostgreSQL provider
- S3 호환 provider와 Object Lock 지원
- Temporal Cloud 또는 self-hosted
- secret manager, log·metric·trace platform

어떤 provider를 선택해도 이 문서의 service·data·trust boundary는 유지해야 한다.

## 18. 목표 repository 구조

실제 directory 생성은 구현 계획에 따라 순차 진행한다.

```text
Reflo_fin/
  source-react/
    app/                       # route·page·route handler
    server/
      http/                    # session·schema·response mapping
      application/             # use case
      domain/                  # stage·version·invalidation rule
      infrastructure/          # PostgreSQL·S3·Temporal adapter
    tests/
    e2e/
  contracts/
    openapi/                   # 외부 HTTP 계약
    schemas/                   # worker·artifact JSON Schema
  workers/
    file-scan/
    pdf/
    research-validation/
    agent/
    excel/
    publish/
  infra/
    local/                     # local service 구성
    migrations/                # PostgreSQL migration
  docs/
```

초기에는 기존 `source-react`를 유지한다. UI를 새 프로젝트로 옮기거나 전체 CSS를 다시 만드는 작업은 하지 않는다.

## 19. 구현 순서

### Phase 0. 계약 완성

1. ERD 문서 작성
2. API 통합 문서와 OpenAPI 초안 작성
3. worker JSON Schema와 오류 code 목록 작성
4. Google OAuth/OIDC package, PostgreSQL access·migration 도구 확정

### Phase 1. 기반 수직 흐름

1. local PostgreSQL과 migration 실행
2. Google login·server session 구현
3. user·project·setup·stage version 구현
4. `/` → `/projects` → `process/setup` 실제 데이터 연결
5. 새로고침·재로그인·다른 사용자 접근·version conflict 검증

### Phase 2. 파일과 작업 기반

1. 객체 저장소와 upload session
2. artifact·file version과 quarantine
3. outbox, job projection과 Temporal 연결
4. file scan·PDF·Excel worker 최소 실행
5. polling·retry·cancel·worker 재시작 검증

### Phase 3. 7단계 기능

1. hypothesis와 PydanticAI
2. research plan·수집·validation
3. SpreadJS validation read model
4. SpreadJS valuation edit와 Aspose.Cells 계산
5. report outline·draft·편집·검증·export

각 phase는 lint, typecheck, unit, integration, build와 브라우저 E2E를 통과한 뒤 다음 phase로 이동한다.

## 20. 아키텍처 검증 기준

- 브라우저 bundle에 DB·S3·Temporal·OpenAI credential과 worker library가 없다.
- 다른 사용자의 project·artifact를 ID 추측으로 조회·수정·다운로드할 수 없다.
- DB commit 직후 web process가 종료돼도 outbox 작업이 결국 시작된다.
- 같은 command와 activity가 중복 전달돼도 결과가 한 번만 반영된다.
- worker 종료·Temporal 재시작·network 단절 후 완료 지점부터 복구된다.
- 상위 version 변경 뒤 과거 결과가 최신 결과처럼 표시되지 않는다.
- 승인되지 않은 Evidence·계산·보고서 artifact를 publish할 수 없다.
- 최종 PDF와 XLSX에서 사용한 모든 입력·Evidence·도구 version을 추적할 수 있다.
- 현재 10개 URL의 핵심 UI 구조가 backend 연결 후에도 유지된다.

## 21. 남은 결정

아키텍처 구현 전에 다음을 확정한다.

1. Google OAuth/OIDC package와 정확한 version
2. PostgreSQL client·query·migration 도구
3. production infrastructure provider
4. SpreadJS와 Aspose.Cells 상용 배포 라이선스
5. Agent별 GPT model ID, token·비용·timeout 한도
6. worker별 production resource·동시성·autoscaling 값
7. artifact·Evidence·감사 로그의 보존·삭제 정책

ERD는 이 문서의 소유권·version·artifact·Evidence·job 경계를 table 관계로 구체화한다. API 문서는 application use case, 오류, idempotency와 polling 계약을 endpoint별로 구체화한다.
