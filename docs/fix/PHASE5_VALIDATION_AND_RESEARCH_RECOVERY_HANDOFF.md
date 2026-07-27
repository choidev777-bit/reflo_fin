# Phase 5 조사 결과 검증 및 4→5단계 장애 수정 인수인계

## 1. 문서 목적

이 문서는 `workspace-dev` 브랜치에 반영된 다음 작업을 팀원이 빠르게 검토할 수 있도록 정리한 인수인계 문서다.

- Phase 5 조사 결과 검증의 상태 처리, 필터, 원문 열람 기능
- 업로드 PDF 내부 뷰어와 인증 스트리밍 API
- Phase 2→5 E2E 및 Excel/Phase 6·7에서 함께 발견된 회귀 수정
- 실제 사용자 테스트에서 확인된 4→5단계 뉴스 수집 실패
- 뉴스 조정 후 반복된 Research Agent 입력 한도 초과
- 승인 계획 수정 후 발생한 5단계 리다이렉트 루프
- 현재 검증 결과와 남은 정책·외부 API 확인 항목

기준 브랜치와 커밋 전 상태는 다음과 같다.

- 작업 브랜치: `workspace-dev`
- 작업 시작 기준: `3f817ff` (`main` 최신 반영 merge)
- 대상 저장소: `choidev777-bit/reflo_fin`

---

## 2. 사용자 테스트에서 확인된 장애 흐름

### 2.1 4단계 `다음` 버튼 비활성화

사용자는 1~3단계를 완료하고 4단계에서 각 질문의 출처를 `모두`로 선택했다. 이때 `모두`에는 자동 수집 출처뿐 아니라 다음 수동 자료 출처도 포함됐다.

- `COMPANY_IR`
- `USER_MATERIAL`

현재 계약에서 위 두 출처는 선택만 해서는 유효하지 않다. `research_plan_version.plan_snapshot_json.sourceReferences`에 실제 PDF 또는 공식 URL이 있어야 한다.

검증 함수 `validateResearchPlan()`은 선택된 수동 출처에 연결 자료가 없으면 다음 오류를 만든다.

- `SOURCE_MATERIAL_REQUIRED / COMPANY_IR`
- `SOURCE_MATERIAL_REQUIRED / USER_MATERIAL`

따라서 `validationSummary.valid=false`가 되고, `ResearchPlanScreen`의 `planReady`가 거짓이 되어 4단계 `다음` 버튼이 비활성화된다.

중요한 점은 Phase 2에 업로드한 필수 분석 PDF가 Phase 4의 `sourceReferences`로 자동 승계되지 않는다는 것이다. 즉, 1~3단계 생성 장애가 아니라 Phase 4의 출처 선택 의미와 자료 연결 방식 사이의 UX/연동 문제다.

#### 현재 남은 정책 결정

이번 변경에서는 `모두`의 의미 자체는 바꾸지 않았다. 팀에서 다음 중 하나를 결정해야 한다.

1. `모두`에서 수동 자료 출처를 제외한다.
2. 연결 자료가 있을 때만 `COMPANY_IR`/`USER_MATERIAL`을 선택한다.
3. `모두`를 유지하되 “PDF 또는 URL 연결 필수”를 선택 시점과 하단 버튼 근처에 명확하게 표시한다.
4. Phase 2 업로드 자료 중 적격 자료를 Phase 4 `USER_MATERIAL`로 명시적으로 승계한다.

사용자 관점에서는 1번 또는 2번이 가장 자연스럽다.

### 2.2 뉴스 수집 실패

출처에서 수동 자료와 뉴스를 조정한 뒤 수집을 시작했을 때 실제 로그에서 다음 순서가 확인됐다.

1. 뉴스 검색 Agent 호출 실패
2. 응답 상세: `UsageLimitExceeded`
3. 내부 코드: `NEWS_SEARCH_PROVIDER_UNAVAILABLE`
4. 검색 결과가 없어 `NEWS_NO_ELIGIBLE_ARTICLES:<questionId>` 발생
5. Temporal `researchValidationWorkflow` 전체가 `failed`로 종료

기존 구현은 뉴스가 질문의 선택 출처 중 하나이기만 해도, 해당 질문에 적격 뉴스가 0건이면 다른 DART·ECOS·사용자 자료가 있어도 전체 수집을 실패시켰다.

이는 “후보 0건 또는 특정 보조 출처 0건은 시스템 장애가 아니라 근거 부족으로 검토한다”는 Phase 5 정책과 맞지 않았다.

### 2.3 계획 수정 후 페이지 다운처럼 보인 현상

실패 안내에 따라 사용자가 4단계로 돌아가 뉴스 출처를 해제했다. 승인됐던 계획을 수정하면서 다음 상태가 만들어졌다.

- `research_plan`: `in_progress`
- `validation`: `blocked`
- validation blocker: `PLAN_REVALIDATION_REQUIRED`
- `project.current_stage`: 잘못 `validation`에 남음

페이지 접근 가드는 차단된 `/process/validation` 요청을 `project.current_stage`의 canonical route로 보낸다. 그런데 canonical route도 동일한 `/process/validation`이어서 307 redirect가 반복됐다.

브라우저 로그에는 짧은 시간에 `history.replaceState()`가 100회 이상 호출됐다는 `SecurityError`가 확인됐다. 서버 프로세스가 죽은 것은 아니지만 반복 요청 때문에 사용자에게는 페이지가 다운된 것처럼 보였다.

### 2.4 뉴스 조정 후 Research Agent 반복 실패

뉴스를 보조 출처로 낮춘 뒤 새로 시작한 실제 수집 작업은 DART 원문까지 정상 수집했지만, 후보 추출 단계에서 다시 실패했다.

- 실패 위치: `extractResearchCandidates()` → LLM worker `/research/candidates`
- 실제 LLM worker 응답: `UsageLimitExceeded`
- 기존 사용자 오류: `RESEARCH_VALIDATION_FAILED`
- 원인: OpenAI 계정 결제/쿼터가 아니라 애플리케이션의 `UsageLimits(input_tokens_limit=50_000)` 초과

실제 대덕전자 승인 계획으로 입력 크기를 측정한 결과는 다음과 같았다.

- 기존 전체 요청: 약 172KB
- DART source snapshot: 약 132KB
- 축소 후 전체 요청: 약 99KB
- 축소 후 DART: 약 73KB

저장·검증용 원문 snapshot 자체는 문제가 없었다. 동일 DART 데이터를 locator, 수집 메타데이터, Workbook 매핑 필드까지 중복 포함한 채 LLM에 전달한 것이 문제였다.

---

## 3. 반영한 수정

## 3.1 Phase 5 빈 결과와 실패 상태 분리

관련 파일:

- `source-react/server/domain/research-validation.ts`
- `source-react/server/infrastructure/repositories/phase4-repository.ts`
- `source-react/app/_phase4/ValidationScreen.tsx`
- `source-react/app/_phase4/types.ts`

변경 내용:

- 수집 원문은 성공했지만 후보와 Evidence가 모두 0건이면 작업 전체를 실패시키지 않는다.
- 빈 검증 결과를 게시하고 작업을 `succeeded`로 종료한다.
- Phase 5 workspace는 `REVIEW_BLOCKED`로 표시한다.
- 질문은 `근거 부족`, 필수 Excel 대상은 `검증 원문 부족`으로 표시한다.
- 실제 파싱/API/원문 검증 실패는 `FAILED`로 유지한다.
- 실패, 진행 중, 후보 0건 상태를 화면에서 구분한다.
- 실패 상태에서는 실제 오류 코드와 사용자용 요약을 표시한다.
- retryable 실패에는 `다시 시도`를 제공한다.
- `자료 보완하기`를 통해 4단계로 돌아갈 수 있다.
- 실패 또는 빈 결과 상태에서는 불필요한 workbook 요청을 실행하지 않는다.
- 작업 최초 응답에 `requestedAt`, `updatedAt`을 포함해 `Invalid Date` 노출을 제거했다.

## 3.2 뉴스 보조 출처 실패의 graceful degradation

관련 파일:

- `source-react/workers/control/activities.ts`
- `source-react/server/infrastructure/research-sources/adapters.ts`
- `source-react/tests/phase4-domain.test.ts`

변경 내용:

- 뉴스 검색 provider가 일시적으로 unavailable 또는 rate limited이면 빈 뉴스 검색 결과로 계속 진행한다.
- 선택된 뉴스가 0건이어도 다른 수집 원문이 있으면 전체 작업을 실패시키지 않는다.
- `NEWS_NO_ELIGIBLE_ARTICLES` warning을 남긴다.
- 특정 질문의 수집 가능한 출처가 부족하면 `QUESTION_SOURCE_UNAVAILABLE` warning을 남긴다.
- 이후 Evidence가 없는 질문은 Phase 5에서 `근거 부족`으로 표시된다.
- 모든 출처가 실제로 0건인 `RESEARCH_NO_SOURCES`는 계속 실패한다.
- 기업 IR/사용자 자료처럼 사용자가 명시적으로 연결해야 하는 필수 수동 출처가 수집되지 않은 경우도 계속 실패한다.
- 필수 Excel authority 출처가 없는 경우의 fail-closed 정책도 유지한다.

## 3.3 승인 계획 수정 시 현재 단계 복귀

관련 파일:

- `source-react/server/infrastructure/repositories/phase4-repository.ts`

변경 내용:

- 승인된 조사 계획을 수정해 validation을 무효화할 때 `project.current_stage`도 `research_plan`으로 되돌린다.
- project `row_version`과 `updated_at`을 함께 갱신한다.
- 이후 사용자는 차단된 5단계가 아니라 수정이 필요한 4단계로 정상 복귀한다.

## 3.4 페이지 접근 canonical route 안전장치

관련 파일:

- `source-react/server/infrastructure/repositories/project-repository.ts`

변경 내용:

- `project.current_stage`의 route가 현재 `allowedRoutes`에 없으면 그 route를 canonical route로 사용하지 않는다.
- 접근 가능한 단계 중 가장 뒤의 route를 fallback으로 사용한다.
- 접근 가능한 단계가 하나도 없을 경우에만 setup route로 fallback한다.
- 데이터 불일치가 다시 발생하더라도 차단된 route가 자기 자신으로 redirect되는 루프를 방지한다.

## 3.5 Phase 5 기본 필터와 결과 분류

관련 파일:

- `source-react/app/_phase4/ValidationScreen.tsx`
- `source-react/app/globals.css`

변경 내용:

- 기본 필터를 검증 통과 결과인 `확인 완료`로 변경했다.
- 기본 노출 조건은 `machineStatus=passed`이면서 반려·재조사·충돌 상태가 아닌 결과다.
- 충돌, 반려, 실패 결과는 별도 필터에서 확인한다.
- 기본 필터가 비었을 때 다른 상태별 건수를 함께 안내한다.
- 다음 단계와 보고서에는 기존처럼 통과하고 승인 가능한 Evidence만 전달한다.

## 3.6 업로드 PDF 내부 원문 뷰어

관련 파일:

- `source-react/app/_phase4/EvidencePdfViewer.tsx`
- `source-react/app/_phase4/evidence-pdf-viewer.module.css`
- `source-react/app/projects/[projectId]/evidence/[evidenceId]/page.tsx`
- `source-react/app/api/projects/[projectId]/evidence/[evidenceId]/source/route.ts`
- `source-react/server/domain/research-validation.ts`
- `source-react/server/infrastructure/repositories/phase4-repository.ts`

변경 내용:

- Evidence 생성 시 `quoteExact`가 있는 PDF 페이지를 찾아 `locator.pageNumber`와 `textFragment`를 저장한다.
- 과거 Evidence에 페이지 번호가 없으면 PDF 텍스트 레이어 검색으로 페이지를 찾는다.
- `ResultDetail.evidence.sourceAccess`에 내부 뷰어, 원문 스트림, 페이지, 하이라이트 문장을 제공한다.
- 업로드 artifact는 Evidence와 실제 연결된 경우에만 스트리밍한다.
- 프로젝트 소유권과 Evidence 연결 여부를 검사한다.
- Range 요청을 지원하고 부분 응답은 `206`으로 반환한다.
- 응답은 `private, no-store`로 제공한다.
- PDF.js 뷰어는 지정 페이지 이동, exact quote 하이라이트, 확대/축소를 지원한다.
- HTML 원문은 가능한 경우 `#:~:text=` fragment를 사용한다.

## 3.7 Excel/Phase 6·7 회귀 수정

Phase 2→5 E2E를 실제 6페이지 fixture로 확장하면서 후속 단계에서 드러난 문제도 함께 수정했다.

관련 파일:

- `source-react/server/infrastructure/services/workbook-output-bindings.ts`
- `source-react/server/infrastructure/repositories/valuation-repository.ts`
- `source-react/server/infrastructure/repositories/report-repository.ts`
- `source-react/server/domain/report.ts`
- `source-react/workers/control/mapping-rules.ts`
- `workers/excel/Program.cs`
- `workers/excel/WorkbookApplicationEngine.cs`
- `workers/excel/WorkbookRollForwardEngine.cs`

주요 변경:

- ClosedXML 저장 시 drawing/chart 호환성 문제를 완화하고 보호해야 하는 OOXML part를 복원한다.
- 수식 출력의 fallback hash를 지원한다.
- 현재 재무제표 sheet 이름과 기간 표기를 인식한다.
- 절대 참조 `$B$6` 형태의 Target PER mode를 파싱한다.
- 기존 workbook에 이미 있던 formula error는 baseline으로 취급하고 새 오류만 차단한다.
- optional unmapped visual slot은 Phase 7 페이지 검토를 막지 않는다.
- required unconfirmed visual slot은 계속 차단한다.
- E2E는 필수 P/E/P/B 매핑이 없을 때 보안 정책대로 차단되는지 확인한다.

## 3.8 Research/Validation Agent 입력 축소와 오류 분류

관련 파일:

- `source-react/server/domain/research-agent-payload.ts`
- `source-react/workers/control/activities.ts`
- `source-react/workers/control/workflows.ts`
- `workers/llm/app.py`
- `source-react/tests/research-agent-payload.test.ts`

변경 내용:

- DB와 Evidence 검증에 사용하는 전체 source snapshot은 그대로 보존한다.
- LLM 전송 시에만 별도의 최소 projection을 만든다.
- DART는 계정명, 재무제표 구분, 당기/전기 금액, 사업연도와 REFLO 기간만 전달한다.
- ECOS는 통계 코드·항목·단위·시점·값만 전달한다.
- PDF는 페이지 번호와 텍스트를 유지하고 object key, parser, 해시 등 저장 메타데이터를 제외한다.
- HTML/뉴스는 본문과 출처 확인에 필요한 메타데이터만 전달한다.
- 질문은 포함된 질문만, Excel 대상은 포함된 대상의 지표·기간·단위·범위·권위 출처만 전달한다.
- 후보 생성뿐 아니라 독립 Validation Agent에도 같은 source projection을 적용한다.
- LLM worker가 `UsageLimitExceeded`를 잡아 HTTP 413과 제한 원인을 반환한다.
- control workflow는 이를 `RESEARCH_AGENT_INPUT_LIMIT` 또는 `VALIDATION_AGENT_INPUT_LIMIT`로 구분하고 무의미한 자동 재시도를 하지 않는다.
- 알 수 없는 예외는 기존의 일반 사용자 오류를 유지한다.

---

## 4. 테스트 및 검증 결과

### 4.1 전체 TypeScript 테스트

```bash
cd source-react
npm test
```

결과:

- 전체: 192
- 통과: 181
- 실패: 0
- 환경 의존 skip: 11

### 4.2 타입 검사

```bash
cd source-react
npm run typecheck
```

결과: 통과

### 4.3 정적 검사와 빌드

- `npm run lint`: 오류 0, 기존 warning 23
- `REFLO_NEXT_DIST_DIR=.runtime/next-build npx next build --webpack`: 통과
- `git diff --check`: 통과

### 4.4 LLM worker

실제 컨테이너 이미지 재빌드 후 Python 계약 테스트:

- 11/11 통과
- 컨테이너 healthcheck 통과
- E2E 종료 후 `REFLO_LLM_TEST_FIXTURE=0` 실제 API 모드로 복구

### 4.5 Excel worker

Docker SDK 환경에서 Excel worker 테스트:

- 11/11 통과

### 4.6 E2E

fixture 환경에서 다음 흐름을 확인했다.

- 파일 업로드
- Phase 2 검사와 매핑
- Phase 3 질문 생성/승인
- Phase 4 수집 계획
- 수집 retry
- Phase 5 결과 검증
- PDF 원문 스트림과 Range `206`
- 지정 페이지 이동과 quote 하이라이트
- Excel 탭
- Phase 6 valuation
- Phase 7 report outline
- 최종 PDF/XLSX export

결과:

- Chromium 시나리오 10/10 통과
- 전체 수행 시간 약 2.2분
- 최종 종단간 시나리오는 업로드부터 PDF/XLSX export까지 약 1.5분

---

## 5. 로컬 사용자 프로젝트 복구 내역

장애를 재현한 로컬 프로젝트:

- project ID: `019fa12d-aeb8-757c-a183-65afb20de11b`
- 기업: 대덕전자

확인된 실패 작업:

- `019fa143-9f9c-72cd-b290-9f394b1dccc1`: `NEWS_NO_ELIGIBLE_ARTICLES`
- `019fa158-4b1c-791b-80d8-ce756da5c12e`: 기존 일반 `RESEARCH_VALIDATION_FAILED`
- `019fa159-b315-74bf-8565-349bffd8ee2e`: 기존 일반 `RESEARCH_VALIDATION_FAILED`
- `019fa169-f77f-79b2-bac9-1d70cc2d3abc`: 기존 일반 `RESEARCH_VALIDATION_FAILED`

뒤의 세 작업은 모두 후보 추출 시 로컬 Research Agent 입력 한도를 넘은 동일 장애였다. 기존 실패 job은 감사 기록으로 남고 자동 변경하지 않는다.

현재 로컬 프로젝트 상태:

- `project_status`: `revalidation_required`
- `current_stage`: `validation`
- 최신 research job: `failed`

이는 수정 전 작업의 실패 기록이 남은 상태다. 새 코드로 확인하려면 Phase 5의 `다시 시도`로 새 attempt를 시작해야 한다. fixture E2E와 실제 데이터 입력 크기 검증은 완료했지만, 실제 대덕전자 계획·원문을 외부 OpenAI API로 보내는 호출은 데이터 외부 전송에 대한 사용자 명시 승인을 기다리고 있다.

---

## 6. 팀원이 우선 검토할 부분

1. `출처 설정 → 모두`의 제품 의미를 확정해야 한다.
   - 현재 수동 자료까지 포함되므로 별도 PDF/URL 없이는 진행할 수 없다.
2. 뉴스 provider 장애를 warning으로 낮추는 범위가 적절한지 확인한다.
   - 다른 원문이 하나라도 있으면 진행한다.
   - 모든 원문이 없으면 계속 실패한다.
3. `project.current_stage` 복귀와 canonical fallback이 다른 재검증 흐름에 영향을 주지 않는지 확인한다.
4. 사용자 명시 승인 후 실제 대덕전자 계획과 DART 원문으로 Research/Validation Agent 정상 경로를 한 번 검증한다.
5. KRX 승인 전 환경에서 KRX 실패가 필수 KRX 대상만 차단하는지 실제 API로 확인한다.
6. P/E·P/B band에 필요한 실제 원천 데이터와 mapping source를 확정해 최종 export E2E를 완성한다.

---

## 7. 재현 및 확인 절차

### 뉴스 장애 회귀 확인

1. 질문 출처에 `NEWS`와 `DART` 또는 `ECOS`를 함께 설정한다.
2. 뉴스 Agent를 빈 결과 또는 provider unavailable로 만든다.
3. 수집을 시작한다.
4. 전체 job이 `failed`가 아닌지 확인한다.
5. Phase 5에서 뉴스 Evidence가 없는 질문이 `근거 부족`으로 표시되는지 확인한다.
6. DART/ECOS Evidence는 정상 노출되는지 확인한다.

### 단계 복귀 회귀 확인

1. Phase 4 계획을 승인하고 수집을 시작해 Phase 5에 진입한다.
2. `자료 보완하기`로 Phase 4로 돌아간다.
3. 승인됐던 질문 출처를 수정한다.
4. `project.current_stage`가 `research_plan`으로 변경되는지 확인한다.
5. `/process/validation`을 직접 열었을 때 307 반복 없이 Phase 4로 한 번만 이동하는지 확인한다.
6. 변경 계획을 다시 승인하면 새 research job으로 Phase 5에 진입하는지 확인한다.

### PDF 원문 확인

1. 사용자 PDF에서 생성된 Evidence를 선택한다.
2. 원문 열기를 누른다.
3. 내부 PDF.js 뷰어가 지정 페이지로 이동하는지 확인한다.
4. exact quote가 하이라이트되는지 확인한다.
5. 원문 API Range 요청이 `206`인지 확인한다.
6. 다른 사용자 또는 연결되지 않은 artifact 요청이 `404`인지 확인한다.

---

## 8. 주의 사항

- 실제 OpenAI/뉴스 provider를 사용한 최신 핫픽스 이후의 자동 재수집은 비용과 사용량 제한 때문에 수행하지 않았다.
- 실제 대덕전자 입력을 외부 OpenAI API에 보내는 검증은 데이터 전송에 대한 사용자 명시 승인을 기다린다.
- 뉴스가 없는 경로와 provider 장애 fallback은 단위 테스트와 fixture E2E로 검증했다.
- fixture 전체 E2E와 실제 외부 API 검증은 목적이 다르므로 둘을 구분해야 한다.
- `.env.local`의 실제 API key나 비밀값은 커밋하지 않는다.
- 로컬 DB 프로젝트 복구 SQL은 다른 환경에 그대로 적용하지 않는다.
