# REFLO 작업 문맥 및 기록

이 문서는 REFLO의 현재 구현 상태와 주요 결정을 다음 작업자에게 전달하기 위한 작업 로그다.  
새 작업이 끝날 때마다 아래 `작업 기록 템플릿`을 복사해 최신 기록을 위에 추가한다.

## 1. 프로젝트 목표

REFLO는 금융 리서치 업무를 다음 흐름으로 연결하는 서비스다.

1. 프로젝트와 분석 기준 설정
2. PDF·Excel 업로드 및 검사
3. 투자 의견과 조사 질문 설정
4. 자료 수집 및 계획
5. 조사 결과 검증
6. Excel 기반 밸류에이션
7. 보고서 구성 및 생성

제품 동작과 기술 판단의 기준 문서는 다음 다섯 파일이다.

- [REFLO_URL_SERVICE_BEHAVIOR_v1.md](./REFLO_URL_SERVICE_BEHAVIOR_v1.md)
- [REFLO_TECHNICAL_DECISIONS_v1.md](./REFLO_TECHNICAL_DECISIONS_v1.md)
- [REFLO_SYSTEM_ARCHITECTURE_v1.md](./REFLO_SYSTEM_ARCHITECTURE_v1.md)
- [REFLO_ERD_v1.md](./REFLO_ERD_v1.md)
- [REFLO_API_SPEC_v1.md](./REFLO_API_SPEC_v1.md)

화면별 실제 구현 계약의 목차와 공통 원칙은 다음 인덱스에서 관리하고, 상세 명세는 `docs/screens/` 아래에 URL별로 분리한다.

- [REFLO_SCREEN_IMPLEMENTATION_SPEC_v1.md](./REFLO_SCREEN_IMPLEMENTATION_SPEC_v1.md)

화면·스타일·문구를 변경할 때는 프로젝트 루트의 [DESIGN.md](../DESIGN.md)를 먼저 확인한다.

## 2. 협업 방향

- 디자이너가 만든 React UI와 CSS는 가능한 한 그대로 재사용한다.
- 현재 화면의 하드코딩 데이터는 실제 백엔드 데이터로 교체할 예정이다.
- 화면을 처음부터 다시 디자인하지 않는다.
- 각 URL별 컴포넌트, 버튼, 데이터 연결, 상태, API, 필요한 기술을 명세한 뒤 구현한다.
- 서비스 단계 수는 문서 기준의 7단계로 통일한다.
- Excel형 UI는 밸류에이션 화면에 SpreadJS React를 연결할 예정이다.
- SpreadJS는 표시·입력 UI만 담당하고, 권위 계산과 최종 XLSX 저장은 Aspose.Cells for .NET이 담당한다.
- Agent는 PydanticAI로 구현하고 OpenAI GPT 모델은 server-side 설정으로 연결한다.

## 3. 현재 구현 상태

### 프론트엔드

- 위치: `D:\Reflo_fin\source-react`
- 실행 기반: 표준 Next.js App Router
- 주요 버전:
  - Next.js 16.2.6
  - React 19.2.6
  - TypeScript 5.9.3
  - Tailwind CSS 4.2.1
- 현재 UI는 대부분 하드코딩된 프로토타입이다.
- 백엔드 API와 실제 데이터 저장은 아직 구현되지 않았다.
- URL은 분리됐지만 여러 route 파일이 공통 대형 UI 컴포넌트를 다시 내보내는 구조다.
- 핵심 UI 파일인 `app/page.tsx`, `app/process.tsx`, `app/globals.css`가 매우 크므로 이후 단계별 분리가 필요하다.

### 현재 URL

| 화면 | URL |
|---|---|
| 홈 | `/` |
| 프로젝트 목록 | `/projects` |
| 1. 프로젝트 설정 | `/projects/:projectId/process/setup` |
| 2. 파일 업로드·검사 | `/projects/:projectId/process/files` |
| 3. 투자 의견·조사 질문 | `/projects/:projectId/process/hypothesis` |
| 4. 자료 수집 및 계획 | `/projects/:projectId/process/research-plan` |
| 5. 조사 결과 검증 | `/projects/:projectId/process/validation` |
| 6. PER 밸류에이션 | `/projects/:projectId/process/valuation` |
| 7. 페이지 내용 설정 | `/projects/:projectId/process/report-outline` |
| 보고서 | `/projects/:projectId/report` |

### 목표 백엔드 경계

기술 결정 문서 기준의 목표 구조는 다음과 같다.

- PostgreSQL: 프로젝트, 파일 메타데이터, Evidence, provenance
- S3 API 호환 객체 저장소: 원본 PDF·XLSX와 대형 파생 파일
- Temporal: 장시간·다단계 작업 오케스트레이션
- Python 격리 워커: PDF 분석·수정·렌더링·검증
- .NET 격리 워커: Aspose.Cells 기반 Excel 재계산·검증·저장
- SpreadJS React: 브라우저의 Excel 표시·입력 UI

백엔드 기술은 UI 디자인 코드와 분리한다.

## 4. 2026-07-24 작업 기록

### 2026-07-24 — PostgreSQL ERD 기준선 작성

#### 결과

- `REFLO_ERD_v1.md`를 작성하고 사용자·인증·프로젝트부터 7단계와 보고서까지의 PostgreSQL 논리·물리 모델 기준선을 정의했다.
- 공통 `versioned_resource`·`resource_version`, 여러 입력을 함께 고정하는 approval·stage completion과 하위 단계 무효화 구조를 설계했다.
- Temporal job projection, outbox, idempotency, activity attempt, reconciliation과 Internal Worker API 결과 transaction을 table·constraint로 구체화했다.
- S3 artifact metadata, upload quarantine, Source·locator·Evidence·검증·충돌 결정과 FK 기반 provenance 구조를 정의했다.
- 조사 후보와 승인 Evidence를 분리하는 `research_result_version`, Aspose.Cells 권위 workbook·계산·valuation, report revision·edit lease·검증·승인·export 모델을 포함했다.
- 화면 명세의 논리 entity와 물리 table 매핑, 필수 unique·check·index, FK 삭제 정책, DB role과 migration 순서를 추가했다.
- README, 아키텍처, 기술 결정문과 작업 로그에서 ERD를 기준 문서로 연결했다.

#### 검증

- 관련 Markdown 내부 링크 검사: 통과
- ERD code fence 40개, Mermaid diagram 9개와 1~22장 heading 순서 검사: 통과
- 10개 화면 명세의 저장 모델·version·job·Evidence·report entity 교차 대조: 통과
- `git diff --check`: 통과
- 문서만 변경했으므로 애플리케이션 build와 브라우저 검사는 생략했다.

#### 다음 작업

- ERD의 aggregate와 화면별 API 계약을 기준으로 `REFLO_API_SPEC_v1.md`를 작성한다.
- 그 다음 인증·session, project·setup과 공통 version table부터 migration과 수직 기능 구현을 시작한다.

#### Git

- PostgreSQL ERD 기준선: `68c9310`

### 2026-07-24 — 시스템 아키텍처 review 수정

#### 결과

- Temporal Workflow 정의·replay·versioning을 실행하는 `Workflow Control Worker`를 별도 배포 단위와 repository 구조에 추가했다.
- activity worker의 PostgreSQL 직접 접근을 제거하고 service identity 기반 `Internal Worker API`를 통해서만 진행률·typed result·artifact metadata를 반영하도록 경계를 수정했다.
- outbox 상태·lease·중복 시작 정책, PostgreSQL projection과 Temporal history reconciliation, S3 temporary artifact commit·orphan cleanup 절차를 추가했다.
- browser의 presigned URL 직접 업로드 경로와 제한 CORS·완료 검증을 diagram과 파일 수명주기에 반영했다.
- PostgreSQL·S3·Temporal과 서비스 전체의 초기 RPO·RTO, 통합 복구 순서와 분기별 restore test를 정의했다.
- OpenAPI와 JSON Schema의 단일 원본, TS·Python·C# type 생성, schema version과 active workflow 호환성 규칙을 추가했다.
- TD-011의 오케스트레이션·worker 격리·확정 전환 조건을 같은 경계로 갱신했다.

#### 검증

- Markdown 16개 내부 링크, code fence와 JSON 예시 검사: 통과
- activity worker의 PostgreSQL 직접 쓰기 경로 잔존 검사: 없음
- 필수 architecture 보완 section과 `git diff --check`: 통과

#### 다음 작업

- 수정된 architecture를 기준으로 outbox, job, artifact, version과 Evidence 관계를 포함한 ERD를 작성한다.

#### Git

- 시스템 아키텍처 경계 보강: `08877db`

### 2026-07-24 — 시스템 아키텍처 기준선 작성

#### 결과

- `REFLO_SYSTEM_ARCHITECTURE_v1.md`를 작성하고 현재 UI 프로토타입과 목표 production 구조를 분리했다.
- MVP를 Next.js Node.js 웹/API 모듈러 모놀리스, PostgreSQL, S3 호환 객체 저장소, Temporal과 격리된 PDF·Excel·Research/Validation·PydanticAI worker로 구성했다.
- 브라우저, application service, worker, PostgreSQL, 객체 저장소와 Temporal의 권위 데이터와 금지 책임을 구분했다.
- DB commit 뒤 장시간 작업 시작이 유실되지 않도록 PostgreSQL outbox와 deterministic Temporal workflow 시작 흐름을 명시했다.
- 동기 저장, 비동기 작업, 파일 수명주기, version 무효화, 인증·보안, 재시도·취소, 관측성, 배포 단위와 목표 repository 구조를 정의했다.
- 10개 URL을 동기 application 책임, 비동기 책임과 주요 저장소에 매핑했다.
- 구현 순서를 계약 완성 → 인증·프로젝트 수직 흐름 → 파일·작업 기반 → 7단계 기능으로 확정했다.

#### 검증

- README와 기술 결정문·작업 로그에서 아키텍처 문서 접근 경로 확인
- Markdown 16개 내부 링크, code fence와 JSON 예시 검사: 통과
- `git diff --check`: 통과
- 문서만 변경했으므로 애플리케이션 build와 브라우저 검사는 생략했다.

#### 다음 작업

- 아키텍처의 사용자·session·project·version·artifact·job·Evidence·report 경계를 ERD로 구체화한다.

#### Git

- 시스템 아키텍처 기준선: `21b4c99`

### 2026-07-24 — MVP 플랫폼 기본값과 PydanticAI·OpenAI 결정

#### 결과

- TD-014로 Google 로그인과 PostgreSQL 기반 불투명 server session을 확정했다.
- TD-015로 사용자의 `cutoffDate`를 `Asia/Seoul` 일말의 권위 `cutoffAt`으로 변환하는 규칙을 확정했다.
- TD-016으로 active job의 3초 visibility-aware polling, hidden·terminal 중단과 오류 backoff를 확정했다.
- TD-017로 Style Profile, Hypothesis, Research/Validation, Report Outline·Draft Agent를 PydanticAI로 구현하고 OpenAI GPT provider를 연결하기로 했다.
- OpenAI API key는 `llm` worker secret으로 제한하고, 정확한 GPT model ID는 Agent별 server configuration과 평가 결과로 고정하도록 했다.
- validation의 SpreadJS 읽기 전용, valuation의 허용 셀 편집 원칙을 유지했다.
- 로컬 `docs/pydantic_ai_guide.md`와 현재 PydanticAI 공식 OpenAI provider·structured output·retry·usage limit 문서를 대조했다.

#### 검증

- 추적 중인 Markdown 14개 내부 링크, code fence와 JSON 예시 검사: 통과
- 기존 timezone·transport·provider 미확정 표현의 잔존 여부와 `git diff --check`: 통과
- 문서만 변경했으므로 애플리케이션 build와 브라우저 검사는 생략했다.

#### 남은 결정

- TD-014 계약을 구현할 Google OAuth/OIDC package와 정확한 version
- SpreadJS 상용·SaaS 라이선스, package version과 배포 hostname
- Agent별 정확한 GPT model ID, 비용·token·timeout 한도와 prompt·응답 보존 정책
- Temporal·PDF·Excel worker의 production resource·동시성 한도

#### 다음 작업

- 인증 package를 확정하고 프로젝트·session·workflow 데이터 모델과 API 구현 계획을 작성한다.

#### Git

- MVP 플랫폼 기본값과 Agent 결정: `4d3305f`

### 2026-07-24 — 03~10 화면 명세 통합 및 전체 교차 검수

#### 결과

- 별도 작업에서 작성한 `03-setup.md`부터 `10-report.md`까지의 커밋을 화면 번호순으로 `main`에 통합했다.
- `/`, `/projects`, 7개 프로세스 단계, 완료 후 보고서 작업 공간까지 총 10개 URL의 1차 화면 구현 명세를 완성했다.
- 공식 단계명과 stage key, URL 이동 순서, `{projectId}` API path 표기, 공통 프로젝트 context와 `targetPeriod`, 오류·권한·멱등성, 비동기 작업 상태와 산출물 version 무효화 규칙을 전 화면에서 통일했다.
- 마스터 명세에 URL별 기술 배치 표를 추가해 SpreadJS, PostgreSQL, S3, Temporal, PDF·Excel 워커와 Agent의 사용 위치 및 사용하지 않을 위치를 명확히 했다.
- 보고서 화면은 8번째 프로세스 단계가 아니라 7단계 완료 후 진입하는 작업 공간으로 확정했다.

#### 검증

- Markdown 내부 링크, code fence, JSON 예시 문법 검사: 통과
- 03→04→05→06→07→08→09→10 단계 이동 경로 검사: 통과
- 구 단계명, `:projectId` API 표기, 문자열 `targetPeriod`, `canceled`, `report-outline` stage key, `412` 선행 단계 응답 잔존 검사: 없음
- `git diff --check`: 통과
- 문서만 변경했으므로 애플리케이션 build와 브라우저 동작 검사는 생략했다.

#### 미해결 결정

- Google OAuth/OIDC 라이브러리, session 저장·만료·회전, CSRF 정책
- `cutoffDate`를 권위 시각 `cutoffAt`으로 바꾸는 timezone·day-end 규칙
- SpreadJS 라이선스, package version, 배포 hostname과 지원 브라우저
- Temporal·PDF·Excel worker의 production timeout, resource와 동시성 제한
- PDF 처리 라이브러리의 상용 배포 라이선스와 실제 증권사 표본 검증
- Agent model·provider·비용 한도·prompt/schema version·원시 응답 보존 정책
- 실시간 상태 전송을 초기 polling에서 SSE·WebSocket으로 바꿀 기준

#### 다음 작업

- 위 미해결 결정 중 구현 기반을 막는 항목을 먼저 확정한 뒤, 데이터 모델·API 모듈·구현 순서가 포함된 개발 계획을 작성한다.
- 첫 구현 단위는 인증/session, PostgreSQL 프로젝트·workflow 기반, `/projects`와 `process/setup`의 실제 데이터 연결로 잡는다.

#### Git

- 03~10 번호순 통합: `6e1f5ec`, `4eea358`, `62b56aa`, `9810647`, `26f8bfc`, `1ea451c`, `b816382`, `b69f19e`
- 전체 교차 검수 및 마스터 명세 갱신: `4f58339`

### 2026-07-24 — `/projects` 프로젝트 목록 구현 명세

#### 결과

- 기준 문서와 현재 React 코드·화면을 대조해 `docs/screens/02-projects.md`를 작성하고 마스터 명세의 상태와 링크를 갱신했다.
- 기존 연속형 프로젝트 표 디자인은 유지하고, 하드코딩 목록·로컬 검색·배열 순서 정렬·가짜 route 이동을 실제 데이터·검색·정렬·`resumeRoute` 계약으로 전환했다.
- 소유자 권한, 7단계 진행률, Temporal 작업 상태 projection, 생성·목록 API, 빈 상태·오류·pagination, 접근성, 완료 조건과 테스트 시나리오를 명시했다.
- 프로젝트 삭제·보관·공유와 동작 없는 도움말은 MVP에서 제외하고, 검색 지우기·재시도·더 보기·로그아웃만 필요한 추가 동작으로 판정했다.

#### 검증

- `/projects` 직접 진입·스크린샷과 프로젝트 `이어하기` URL 이동 Playwright 검사: 3개 통과
- 문서 필수 섹션·로컬 링크·code fence와 `git diff --check`: 통과

#### 다음 작업

- `/projects/:projectId/process/setup` 화면 명세를 작성한다.

#### Git

- 프로젝트 목록 화면 명세: `1a5866e`

### 2026-07-24 — `/` 홈 화면 구현 명세

#### 목표

- 두 기준 문서와 현재 React 디자인을 대조해 홈의 컴포넌트·버튼·데이터·API·상태·기술 위치를 확정한다.

#### 결과

- `REFLO_SCREEN_IMPLEMENTATION_SPEC_v1.md`를 전체 목차·공통 원칙 인덱스로 만들었다.
- `/` 홈 상세 명세는 `docs/screens/01-home.md`로 분리했다.
- 기존 헤더·히어로·모달 디자인은 재사용하고 인증 상태와 실제 프로젝트 생성만 연결하도록 정리했다.
- Google 로그인, 실제 `projectId`, 7단계 표시, 사용자 메뉴·로그아웃, 오류·보안·테스트 조건을 명시했다.
- 홈에서 사용하지 않는 SpreadJS, Temporal, PDF·Excel 워커, Agent는 로드하지 않도록 명시했다.
- 인증 라이브러리·세션 정책·CSRF 방식은 기술 결정 문서에 추가해야 할 미확정 항목으로 분리했다.

#### 다음 작업

- 같은 문서에 `/projects` 명세를 이어서 작성한다.

### 2026-07-24 — 개발 기준선 완료

#### 목표

- 이후 기능 구현에서 기존 UI가 깨지는지 빠르게 확인할 수 있는 로컬 품질 기준선을 만든다.

#### 변경

- React 렌더 중 ref 접근, effect 내 동기 상태 갱신, 전역 변수 변경으로 발생하던 ESLint 오류 7개를 제거했다.
- Playwright와 Chromium 기반 로컬 E2E 검사를 추가했다.
- 홈, 프로젝트 목록, 7개 process URL, 보고서까지 총 10개 URL 직접 진입을 검사한다.
- 홈의 새 프로젝트 생성과 프로젝트 목록의 이어하기를 실제 클릭해 URL 이동을 검사한다.
- 프로젝트 목록, PER 밸류에이션, 보고서 3개 대표 화면의 스크린샷 기준선을 저장했다.
- 브라우저 검사 중 발견한 보고서 표의 중복 React key 콘솔 오류를 수정했다.
- `npm run check`로 린트, 타입, 기존 테스트, 빌드, E2E를 한 번에 실행할 수 있게 했다.

#### 검증

- `npm run lint`: 오류 0개, 기존 경고 20개
- `npm run typecheck`: 통과
- `npm test`: 4개 통과
- `npm run build`: 통과
- `npm run test:e2e:update`: 15개 통과
- E2E는 로컬에서 4개 worker로 병렬 실행하며 약 18초가 걸렸다.

#### 남은 작업

- 경고 20개는 사용되지 않는 레거시 프로토타입 코드, `<img>` 최적화, 접근성 속성 문제다.
- 실제 API, 인증, DB, 파일 처리, SpreadJS 연결은 아직 구현되지 않았다.
- 다음 작업은 문서 기준의 URL별 화면·버튼·데이터·API 명세 확정이다.

#### Git

- React 린트 오류 제거: `43da66e`
- 브라우저에서 발견한 중복 key 수정: `63f7261`
- Playwright 기준선 추가: `4892525`

### 2026-07-24 — UI 기술 스택 정리

#### 목표

디자이너 UI는 보존하면서 생성 템플릿에 붙어 있던 불필요한 기술 스택을 제거하고, 표준 Next.js에서 실행되게 만든다.

#### 결정

- Vinext는 실험적 호환 계층이므로 제거했다.
- Cloudflare Workers, Wrangler, D1, OpenAI Sites 설정은 UI에 필요하지 않아 제거했다.
- Drizzle은 스키마와 실제 DB 사용이 없어 제거했다.
- D1은 SQLite 기반이며 REFLO 문서의 PostgreSQL 결정과 맞지 않는다.
- Cloudflare R2는 향후 S3 호환 객체 저장소 후보가 될 수 있지만 현재 UI 프로젝트에는 포함하지 않는다.

#### 제거한 항목

- Vinext와 Vite 관련 패키지·설정
- Cloudflare Vite 플러그인, Workers 타입, Wrangler, Worker 진입점
- OpenAI Sites 호스팅 설정과 빌드 플러그인
- Drizzle ORM, Drizzle Kit, D1 예제와 빈 DB 스키마
- 중복 pnpm 설정
- Vinext로 생성된 `static-html` 정적 배포본
- Sites 전용 설치·빌드·검증 스크립트
- 사용되지 않던 ChatGPT 호스팅 인증 helper

#### 보존한 항목

- `source-react/app/`의 React UI
- 전체 CSS와 시각 디자인
- UI 컴포넌트
- `source-react/public/`의 이미지와 다운로드 샘플
- 서비스 문서와 디자인 시스템
- 분리된 URL 구조

#### Git 기록

| 목적 | 커밋·태그 |
|---|---|
| 정리 전 원본 체크포인트 | `00b3aab` |
| 정리 전 태그 | `before-stack-cleanup` |
| 표준 Next.js 정리 완료 | `7c78d7c` |

정리 작업 전체를 되돌리려면 다음 명령을 사용한다.

```powershell
cd D:\Reflo_fin
git revert 7c78d7c
```

#### 검증 결과

- `npm run typecheck`: 통과
- `npm test`: 4개 테스트 통과
- `npm run build`: 통과
- Next.js가 홈, 프로젝트, 7개 process URL, 보고서 URL을 모두 인식함
- 브라우저에서 전체 URL의 대표 문구와 화면 렌더링 확인
- 브라우저 콘솔 오류 없음
- Vinext·Cloudflare·Wrangler·Drizzle 런타임 참조 없음

#### 당시 알려진 문제

- 기존 하드코딩 UI에는 ESLint 오류 7개와 경고가 남아 있었다. 오류 7개는 위 개발 기준선 작업에서 해결했다.
- 타입검사와 프로덕션 빌드는 통과하므로 현재 실행에는 영향을 주지 않는다.
- 아직 실제 API, 인증, DB, 파일 업로드, 작업 진행 상태, SpreadJS가 연결되지 않았다.
- 대형 단일 컴포넌트를 단계별 컴포넌트로 나누기 전에는 기능 추가 시 충돌 위험이 높다.

## 5. 로컬 실행

```powershell
cd D:\Reflo_fin\source-react
npm ci
npm run dev
```

브라우저에서 `http://localhost:3000`을 연다.

프로덕션 빌드 확인:

```powershell
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
npm run start
```

## 6. 다음 우선 작업

1. worker artifact JSON Schema와 TS·Python·C# 생성 규칙을 작성한다.
2. Google OAuth/OIDC package, PostgreSQL access·migration 도구를 확정하고 SpreadJS 라이선스를 확인한다.
3. PostgreSQL migration, 인증/session, 프로젝트 소유권과 7단계 workflow 기반을 구현한다.
4. `app/page.tsx`와 `app/process.tsx`를 디자인 변화 없이 URL별 컴포넌트로 분리한다.
5. `/projects`와 `process/setup`부터 실제 API·데이터를 연결하고 로컬 서버에서 확인한다.
6. `files`부터 `report`까지 한 화면씩 구현하며 각 단계마다 lint, typecheck, test, build와 브라우저 동작을 확인한다.
7. 밸류에이션 화면의 가짜 Excel 영역은 SpreadJS로 교체하고, 권위 계산·저장은 Aspose.Cells worker에 연결한다.

## 7. 작업 기록 규칙

- 최신 작업을 `4. 작업 기록` 바로 아래에 추가한다.
- 채팅 전문을 복사하지 않고 결정과 결과만 적는다.
- 변경 파일, 검증 명령, 미해결 문제, Git 커밋을 반드시 남긴다.
- UI 변경은 적용한 디자인 기준을 함께 기록한다.
- 기술 결정을 변경하면 관련 기준 문서의 결정 ID도 함께 적는다.

## 8. 작업 기록 템플릿

```markdown
### YYYY-MM-DD — 작업 제목

#### 목표

- 이번 작업에서 해결하려는 문제

#### 결정

- 선택한 방향과 이유

#### 변경

- 변경한 파일과 사용자에게 보이는 결과

#### 검증

- 실행한 명령
- 확인한 URL 또는 시나리오
- 결과

#### 남은 작업

- 아직 해결하지 않은 문제

#### Git

- 커밋: `해시`
```
