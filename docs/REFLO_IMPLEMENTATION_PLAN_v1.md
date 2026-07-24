# REFLO Phase별 구현 계획

이 문서만 전체 구현 순서를 관리한다. 한 번에 한 Phase만 작업한다.

## 실행 규칙

1. 현재 Phase의 체크 항목과 참고 문서만 읽는다. 다른 Phase 문서는 열지 않는다.
2. 항목 하나가 끝날 때마다 `npm run dev`로 로컬 서버를 열어 브라우저에서 직접 확인한다.
3. Phase 종료 시 아래 검사를 모두 통과시킨다.
4. 완료 조건을 통과한 뒤에만 다음 Phase로 이동한다.

## 환경변수

- 실제 키는 `source-react/.env.local`에 준비하며 Git에 포함하지 않는다.
- 변수명 목록은 `source-react/.env.example`을 기준으로 한다.
- Phase 1은 `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`을 사용한다.
- Phase 3은 `OPENAI_API_KEY`를 사용한다.
- Phase 4는 `OPENDART_API_KEY`, `ECOS_API_KEY`, `KRX_API_KEY`를 사용한다.
- 키 값은 문서, 코드, terminal 출력, log와 대화 응답에 표시하지 않는다.
- 키가 없으면 새로 발급하지 말고 누락된 변수명만 보고한다.

```powershell
cd D:\Reflo_fin\source-react
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
```

## Phase 0. 구현 기준선

**상태:** 완료

**참고 문서:** [시스템 아키텍처](./REFLO_SYSTEM_ARCHITECTURE_v1.md), [ERD](./REFLO_ERD_v1.md), [API 명세](./REFLO_API_SPEC_v1.md), [OpenAPI](../contracts/openapi/reflo-v1.yaml), [Worker Schema](../contracts/schemas/README.md)

- [x] 서비스 동작, 아키텍처, ERD와 API 계약 확정
- [x] OpenAPI와 Worker JSON Schema 작성
- [x] Google OAuth/OIDC, PostgreSQL, PDF와 Excel 기술 확정
- [x] 10개 URL의 UI 프로토타입 작성
- [x] PDF와 XLSX fixture 준비
- [x] 로컬 환경변수 파일 준비

**완료 조건:** 계약 검사와 현재 UI의 lint, typecheck, test, build, E2E 통과.

## Phase 1. 로그인·DB·프로젝트

**참고 문서:** [인증·프로젝트 ERD](./REFLO_ERD_v1.md#4-인증프로젝트공통-version), [인증·session API](./REFLO_API_SPEC_v1.md#4-인증sessioncsrf), [홈](./screens/01-home.md), [프로젝트 목록](./screens/02-projects.md), [프로젝트 설정](./screens/03-setup.md)

- [x] 로컬 PostgreSQL과 migration 구성
- [x] DB 연결, transaction과 repository 공통 코드 구현
- [x] Google login, callback과 logout 구현
- [x] server session, cookie와 CSRF 보호 구현
- [x] user, project, setup과 stage version 저장 구현
- [x] 홈, 프로젝트 목록과 setup 화면을 실제 API에 연결
- [x] project owner 검사와 version conflict 처리
- [x] integration test와 E2E 작성

**브라우저 확인:** 로그인 → 프로젝트 생성 → setup 저장 → 새로고침 → 재로그인 흐름이 유지되고, 다른 사용자 접근과 오래된 version 저장은 차단된다.

**완료 조건:** 홈부터 setup 저장까지 하드코딩 데이터가 없고 공통 검사를 통과한다.

## Phase 2. 파일 업로드·작업 기반

**참고 문서:** [비동기 작업·파일 아키텍처](./REFLO_SYSTEM_ARCHITECTURE_v1.md#9-비동기-작업-흐름), [파일 API](./REFLO_API_SPEC_v1.md#83-step-02-파일-업로드검사), [파일 화면](./screens/04-files.md), [Worker Schema](../contracts/schemas/README.md), [TD-019](./REFLO_TECHNICAL_DECISIONS_v1.md#td-019-파일-입력-운영-정책)

- [ ] 로컬 객체 저장소와 Temporal 구성
- [ ] upload session과 제한된 업로드 URL 구현
- [ ] quarantine, artifact와 file version 저장 구현
- [ ] outbox dispatcher와 job projection 구현
- [ ] Workflow Control Worker와 Internal Worker API 연결
- [ ] Python PDF worker와 .NET Excel worker의 최소 실행 경로 구현
- [ ] polling, retry, cancel과 reconciliation 구현
- [ ] 파일 화면을 실제 API와 작업 상태에 연결
- [ ] integration test와 E2E 작성

**브라우저 확인:** fixture PDF·XLSX 업로드, 검사 진행, 실패·재시도·취소와 재시작 후 복구가 동작한다.

**완료 조건:** 검사 결과와 artifact가 저장되고, 검사 완료 전에는 다음 단계로 이동할 수 없으며 공통 검사를 통과한다.

## Phase 3. 투자 의견·조사 질문

**참고 문서:** [가설 화면](./screens/05-hypothesis.md), [Agent Prompt](./agents/HYPOTHESIS_AGENT_PROMPT_v2.md), [TD-023](./REFLO_TECHNICAL_DECISIONS_v1.md#td-023-agent-실행-profile)

**PydanticAI 문서 조회 규칙:**

1. Context7의 `/pydantic/pydantic-ai`에서 현재 작업 주제만 조회한다.
2. 공식 Pydantic 문서와 공식 GitHub source만 구현 근거로 사용한다.
3. `docs/pydantic_ai_guide.md`는 로컬 검색용 원본이므로 전체를 읽지 않는다.
4. Context7에 고정 version `2.17.0` 자료가 없거나 내용이 충돌할 때만 `rg`로 위 파일의 관련 절을 찾아 필요한 범위만 읽는다.
5. 조회 범위는 Agents, Dependencies, Output, OpenAI, Function Tools, Retries와 Testing 중 현재 작업에 필요한 절로 제한한다.
6. 모델 기억, 블로그와 오래된 예제에 의존하지 않는다.

- [ ] hypothesis version과 approval 저장 구현
- [ ] PydanticAI Hypothesis Agent와 OpenAI 호출 구현
- [ ] Agent 출력 schema 검증과 오류 처리
- [ ] 질문 수정, 재생성과 승인 구현
- [ ] hypothesis 화면을 실제 API에 연결
- [ ] integration test와 E2E 작성

**브라우저 확인:** 투자 의견 입력 → 질문 생성 → 수정 → 승인 흐름과 실패 재시도가 동작한다.

**완료 조건:** 승인된 질문과 입력 version이 함께 고정되고 공통 검사를 통과한다.

## Phase 4. 자료 수집·검증

**참고 문서:** [조사 계획 화면](./screens/06-research-plan.md), [검증 화면](./screens/07-validation.md), [검증 API](./REFLO_API_SPEC_v1.md#86-step-05-조사-결과-검증), [TD-020](./REFLO_TECHNICAL_DECISIONS_v1.md#td-020-validation-충분성사용자-결정)

- [ ] research plan 작성, 수정과 승인 구현
- [ ] DART, ECOS, KRX와 공개 URL 수집 adapter 구현
- [ ] source snapshot과 Research Agent workflow 구현
- [ ] Validation Agent와 Evidence 판정 구현
- [ ] React workbook 읽기 전용 grid 구현
- [ ] research-plan과 validation 화면을 실제 API에 연결
- [ ] 재조사, 반려, qualified 승인과 충분성 gate 구현
- [ ] integration test와 E2E 작성

**브라우저 확인:** 계획 승인 → 수집 진행 → 원문 대조 → Evidence 승인·반려 → 재조사 흐름이 동작하고 Excel은 읽기 전용이다.

**완료 조건:** 승인된 Evidence만 다음 단계로 전달되고 모든 Evidence에서 원문과 version을 추적할 수 있으며 공통 검사를 통과한다.

## Phase 5. Excel·PER 밸류에이션

**참고 문서:** [밸류에이션 화면](./screens/08-valuation.md), [밸류에이션 API](./REFLO_API_SPEC_v1.md#87-step-06-per-밸류에이션), [TD-021](./REFLO_TECHNICAL_DECISIONS_v1.md#td-021-valuation-수치react-workbook-grid-통합)

- [ ] workbook read model API 구현
- [ ] React workbook grid의 허용 셀 편집 구현
- [ ] patch 저장과 version conflict 처리
- [ ] ClosedXML 재계산, 검증과 XLSX 저장 구현
- [ ] EPS, Target PER, 목표주가와 상승여력 계산 연결
- [ ] valuation version과 approval 구현
- [ ] valuation 화면을 실제 API에 연결
- [ ] integration test와 E2E 작성

**브라우저 확인:** 허용 셀 편집 → 저장 → 재계산 → 승인 → XLSX 다운로드가 동작하며 잠긴 셀과 잘못된 값은 차단된다.

**완료 조건:** fixture workbook의 계산 결과가 기준 결과와 일치하고 승인 version과 XLSX artifact가 고정되며 공통 검사를 통과한다.

## Phase 6. 보고서 생성·내보내기

**참고 문서:** [페이지 내용 설정](./screens/09-report-outline.md), [보고서 화면](./screens/10-report.md), [보고서 API](./REFLO_API_SPEC_v1.md#89-보고서-workspace), [TD-022](./REFLO_TECHNICAL_DECISIONS_v1.md#td-022-report-편집미리보기운영-정책)

- [ ] report outline 저장과 승인 구현
- [ ] 승인 outline 기반 AI 초안 생성 구현
- [ ] report revision과 edit session 구현
- [ ] PDF preview와 report editor 연결
- [ ] 숫자, Evidence와 레이아웃 검증 구현
- [ ] PDF와 XLSX export 구현
- [ ] report-outline과 report 화면을 실제 API에 연결
- [ ] 파일별 실패와 재시도 구현
- [ ] integration test와 E2E 작성

**브라우저 확인:** outline 승인 → 초안 생성 → 편집 → 검증 → PDF·XLSX 다운로드가 동작하고 근거 없는 숫자는 승인이 차단된다.

**완료 조건:** PDF와 XLSX가 같은 승인 version을 사용하고 입력·Evidence 추적이 가능하며 공통 검사를 통과한다.

## Phase 7. 전체 검증·배포

**참고 문서:** [배포 아키텍처](./REFLO_SYSTEM_ARCHITECTURE_v1.md#17-배포-단위와-환경), [기술 결정](./REFLO_TECHNICAL_DECISIONS_v1.md), [Third-party 고지](../THIRD_PARTY_NOTICES.md), [AGPL](../LICENSE)

- [ ] 7단계 전체 happy path E2E 작성
- [ ] 권한, 충돌, 취소, 재시도와 복구 E2E 작성
- [ ] fixture 기반 PDF·XLSX 산출물 교차검증
- [ ] production DB, 객체 저장소와 Temporal 구성
- [ ] web과 worker 배포 및 secret 등록
- [ ] migration, backup과 restore 검사
- [ ] 공개 저장소와 배포 commit의 소스 코드 링크 추가
- [ ] AGPL과 third-party notice 검사
- [ ] 배포 URL smoke test

**브라우저 확인:** 배포 환경에서 로그인부터 최종 PDF·XLSX 다운로드까지 전체 흐름을 직접 수행한다.

**완료 조건:** production smoke test와 backup 복원 검사가 통과하고 최종 파일을 실제 PDF viewer와 Excel에서 연다.

## 현재 작업

다음 구현 대상은 **Phase 1. 로그인·DB·프로젝트**다.
