# STEP 04 → STEP 05 검증 결과 표시 누락 수정 계획

- 문서 상태: 코드 정적 추적 완료, 실행 검증 미수행
- 대상 단계: STEP 05 조사 결과 검증
- 연계 단계: STEP 04 자료 수집 및 계획, STEP 06 밸류에이션
- 작성 기준일: 2026-07-27

## 1. 결론

두 가지를 분리해서 읽어야 한다.

**배선 기준** — STEP 04 수집부터 DB 저장까지는 정상 연결되어 있다. 다만 **STEP 05 읽기 경로에서 3개 상태가 통째로 누락**되어, 해당 상태에 들어간 결과는 화면에 전혀 표시되지 않는다. 그중 출처 충돌은 단계 완료까지 영구 차단한다.

**실행 기준** — "실제로 화면에 보이는가"는 정적 분석으로 판정할 수 없다. `dev:full` 기동 여부, DART·KRX·ECOS·OpenAI 인증정보, 실제 수집된 자료의 내용에 따라 달라진다. 아래 문제 1~5는 코드에서 증명한 것이고, 문제 6은 설계상 정상 동작이지만 사용자에게 "빈 화면"으로 보이는 경로다.

### 근본 원인 (1개)

쓰기 경로와 결정 경로는 `AVAILABLE`, `CONFLICT_UNRESOLVED`, `CONFLICT_RESOLVED`, `REJECTED`, `REINVESTIGATING`, `SUPERSEDED`를 모두 다룬다. 그런데 **모든 읽기 경로가 `exception_status IN ('AVAILABLE', 'CONFLICT_RESOLVED')`로 고정**되어 있다.

반면 완료 게이트(`recomputeStageGate`)는 `exception_status <> 'SUPERSEDED'`로 조회한다. **게이트가 보는 집합과 화면이 보는 집합이 다르다.** 그래서 "완료는 차단되는데 차단 원인이 화면에 없다"가 구조적으로 발생한다.

| 경로 | 필터 | 위치 |
|---|---|---|
| 완료 게이트 | `<> 'SUPERSEDED'` | `phase4-repository.ts:3067` |
| 화면 목록 | `IN ('AVAILABLE','CONFLICT_RESOLVED')` | `phase4-repository.ts:4399` |
| 결과 상세 | `IN ('AVAILABLE','CONFLICT_RESOLVED')` | `phase4-repository.ts:4545` |
| workbook 조회 | `IN ('AVAILABLE','CONFLICT_RESOLVED')` | `phase4-repository.ts:4672`, `4777` |
| 결정(반려/복원/재조사) | `AVAILABLE`, `REJECTED`, `CONFLICT_UNRESOLVED` 허용 | `phase4-repository.ts:4996`, `4998` |

## 2. 추적한 경로

| # | 단계 | 위치 |
|---|---|---|
| 1 | 계획 승인·수집 시작 | `app/api/projects/[projectId]/research-plan/approve-and-start/route.ts:24` |
| 2 | Temporal workflow 분기 | `workers/control/workflows.ts:329`, 분기 조건 `:333` |
| 3 | 수집 (가설·Excel 병렬) | `workflows.ts:336-341` |
| 4 | LLM 후보 추출 | `workflows.ts:344` → `activities.ts:1620` |
| 5 | 독립 검증 | `activities.ts:1668` (가설), `activities.ts:1772` (Excel) |
| 6 | 결과 게시 | `activities.ts:1807` → `POST /internal/v1/jobs/:jobId/results` |
| 7 | 저장 | `phase4-repository.ts:3409` `commitResearchValidationResult` |
| 8 | 화면 조회 | `phase4-repository.ts:4249` `getValidationWorkspace` |
| 9 | 렌더링 | `app/_phase4/ValidationScreen.tsx:918` |

저장 시 생성되는 행:

| 테이블 | INSERT 위치 |
|---|---|
| `evidence` (가설) | `phase4-repository.ts:3692` |
| `validation_result` (가설) | `phase4-repository.ts:3783` |
| `validation_conflict` | `phase4-repository.ts:3826` |
| `validation_question_answer` | `phase4-repository.ts:3909` |
| `evidence` (Excel) | `phase4-repository.ts:3934` |
| `validation_result` (Excel) | `phase4-repository.ts:3975` |

> 분기 참고(확인 필요): `workflows.ts:333`의 세 분기는 서로 다른 payload 동작을 가진다. 어느 분기를 타는지는 Temporal `patched()`의 런타임 상태에 달려 있어 저장소 코드만으로는 확정할 수 없다. 다만 아래 문제 6은 `phase4-separated-hypothesis-excel-v1` 분기에서만 발생하므로, 진단 시 실제 실행이 어느 분기였는지 Temporal 히스토리에서 먼저 확인해야 한다.

## 3. 발견한 문제

### 문제 1 — 출처 충돌 발생 시 STEP 05 영구 차단 (치명 / 코드로 증명)

**증상**
같은 질문·지표·기간·범위에서 서로 다른 검증값이 2건 이상 나오면 STEP 05를 완료할 수 없다. 화면 목록에는 해당 결과가 아예 없고, 완료 버튼만 막힌 상태가 된다.

**원인 사슬**

1. 쓰기: 충돌이면 `exception_status = 'CONFLICT_UNRESOLVED'` — `phase4-repository.ts:3811`
2. 충돌 행 생성: `validation_conflict.status = 'unresolved'` — `phase4-repository.ts:3826`
3. 읽기 제외: 목록 쿼리가 `CONFLICT_UNRESOLVED`를 필터로 제외 — `phase4-repository.ts:4399`
4. 게이트는 차단: 미해결 충돌마다 `UNRESOLVED_SOURCE_CONFLICT` blocker 추가 — `phase4-repository.ts:3222-3228` (게이트 쿼리 `:3067`은 `<> 'SUPERSEDED'`라 충돌 행이 보인다)
5. UI 도달 불가: `selectedConflict`는 `selectedResultId`로 찾는데(`ValidationScreen.tsx:962-967`), `selectedResultId`는 `publishedResults`에서만 나온다(`:946`). 충돌 결과는 `publishedResults`에 없으므로 **`selectedConflict`는 항상 `null`**
6. 결과: 충돌 해결 UI(`ValidationScreen.tsx:1781`)와 충돌 decision 호출(`:1098`)이 모두 dead code

**수정**
- `phase4-repository.ts:4399`, `:4545`의 필터에 `'CONFLICT_UNRESOLVED'` 추가
- `ValidationScreen.tsx:565-571` `isPublishedResult`가 충돌 결과를 통과시키도록 변경 (아래 문제 5 수정과 함께)
- 결정 API(`:4998`)는 이미 `CONFLICT_UNRESOLVED`를 허용하므로 백엔드 추가 작업 없음

---

### 문제 2 — 반려한 결과가 목록에서 사라져 복원 불가 (높음 / 코드로 증명)

**증상**
결과를 반려하면 목록에서 즉시 사라진다. "반려" 필터 탭 건수는 항상 0이고, 복원 버튼에 도달할 수 없다. 필수 결과를 반려하면 그대로 완료가 차단된다.

**원인 사슬**

1. 반려 저장: `exception_status = 'REJECTED'` — `phase4-repository.ts:5091`
2. 읽기 제외: `:4399`(목록), `:4545`(상세) 둘 다 제외
3. UI 복원 분기 `ValidationScreen.tsx:1813`의 `selectedResult.exceptionStatus === "REJECTED"` — `selectedResult`가 `publishedResults` 출신이므로 **영원히 false**
4. UI 반려 필터 `ValidationScreen.tsx:1011`이 `publishedResults` 위에서 `REJECTED`를 찾음 — **항상 0**
5. 게이트는 차단: 필수 결과 반려 시 `rejectedRequired` — `phase4-repository.ts:3133`

**참고** — 복원 API는 정상 구현되어 있다. `phase4-repository.ts:4996`이 `action === "RESTORE"`일 때 `exception_status === 'REJECTED'`를 요구한다. 읽기 경로만 막혀 있다.

**수정**
- 읽기 필터에 `'REJECTED'` 추가
- `ValidationScreen.tsx:1011` 필터를 `publishedResults`가 아닌 전체 결과 기준으로 변경

---

### 문제 3 — 재조사 요청한 결과가 목록에서 사라짐 (높음 / 코드로 증명)

**증상**
재조사를 요청하면 해당 결과가 목록에서 사라져 진행 상태를 확인할 수 없다. 게이트는 차단된 상태로 남는다.

**원인**
- 재조사 저장: `exception_status = 'REINVESTIGATING'` — `phase4-repository.ts:5047`
- 읽기 제외: `:4399`
- 게이트 차단: `reinvestigating` — `phase4-repository.ts:3136`

**수정**
- 읽기 필터에 `'REINVESTIGATING'` 추가하고 화면에 "재조사 진행 중" 상태로 표시

---

### 문제 4 — 수집 실패한 Excel 대상이 화면에서 사라짐 (중간 / 코드로 증명)

**증상**
DART/KRX/ECOS에서 값을 확정하지 못한 Excel 입력 대상은 Excel 탭 목록에 나타나지 않는다. 완료는 차단되는데, 어떤 check가 왜 실패했는지 화면에서 확인할 수 없다.

**원인 사슬**

1. 쓰기: Excel 결과는 `machineStatus`가 실패여도 저장되고(`phase4-repository.ts:3995`), 근거를 만들지 못하면 `evidence_ids = []`가 된다(`:3927-3973`)
2. 읽기 제외: `machine_status = 'passed' AND cardinality(evidence_ids) > 0` — `phase4-repository.ts:4397-4398`
3. 화면 추가 제외: `verifiedWorkbook`이 `validationTargets`를 검증 성공분으로만 필터 — `ValidationScreen.tsx:937-939`
4. 게이트 차단: `EXCEL_EVIDENCE_MISSING` — `phase4-repository.ts:3229-3246`

**문제 1~3보다 완화된 이유** — blocker 메시지에 `시트명!주소`가 포함되어 최소한 위치는 알 수 있다. 다만 실패 사유(checks_json)는 볼 수 없다.

**수정**
- `ValidationScreen.tsx:937-939`의 `verifiedWorkbook` 필터 제거
- 읽기 쿼리에서 `machine_status`·`cardinality` 조건을 제거하고, 대신 화면에서 상태 배지로 구분

---

### 문제 5 — 충돌 필터 탭이 잘못된 집합을 셈 (낮음 / 코드로 증명)

`ValidationScreen.tsx:997-1000`이 `result.exceptionStatus.includes("CONFLICT")`로 세는데, `publishedResults`에 남아 있는 유일한 CONFLICT 계열은 이미 **해결된** `CONFLICT_RESOLVED`다. 의도한 "미해결 충돌"과 정반대 집합을 센다.

**수정** — `exceptionStatus === 'CONFLICT_UNRESOLVED'`로 변경 (문제 1 수정 후에만 의미가 생긴다)

---

### 문제 6 — 검증 통과 근거가 0건이어도 작업은 "성공"으로 끝남 (설계 동작 / 사용자에게는 빈 화면)

이건 버그가 아니라 현재 설계의 결과이지만, "수집했는데 아무것도 안 보인다"의 가장 흔한 원인이 될 수 있으므로 함께 기록한다.

1. `activities.ts:1748` — evidence를 `machineStatus === 'passed'`인 것만 남긴다
2. `activities.ts:1749-1759` — 0건이어도 **예외를 던지지 않고** 빈 결과로 정상 반환
3. `research-question-answers.ts:119-130` — 근거 0건이면 `verdict: 'indeterminate'`, caveat `"검증을 통과한 근거가 없습니다."`
4. 저장은 성공하고 workflow도 succeeded로 끝난다. 화면에는 질문만 있고 결과가 0건이다

**대비되는 동작** — 구 경로(`validateAndPublishResearch`)는 같은 상황에서 `RESEARCH_EVIDENCE_EMPTY`로 **실패시킨다**(`activities.ts:1890-1892`). 신규 실행이 타는 separated 경로만 조용히 성공한다.

**수정 방향(선택)**
- `validateHypothesisPipeline`이 `machineStatus !== 'passed'` 근거도 payload에 포함하고, 저장 시 `machine_status`로 구분해 화면에서 "검증 실패" 상태로 노출
- 또는 최소한 화면에 "검증 통과 근거 0건"과 `bundle.warnings` 내용을 표시

## 4. 수정 우선순위

| 순위 | 작업 | 파일 | 성격 | 효과 |
|---|---|---|---|---|
| 1 | `exception_status` 필터를 게이트 기준(`<> 'SUPERSEDED'`)에 맞춤 | `phase4-repository.ts:4399`, `:4545` | 상태 복원 | 문제 1·2·3 동시 해결 |
| 2 | `isPublishedResult` 폐기 → 상태 배지로 교체 | `ValidationScreen.tsx:565-571`, `:918` | 표시 변경 | 각 상태를 구분해 표시 |
| 3 | 필터 탭 조건 정정 | `ValidationScreen.tsx:997-1012` | 표시 변경 | 충돌·반려 탭 정상화 |
| 4 | `machine_status`·`cardinality` 조건 완화 | `phase4-repository.ts:4397-4398`, `ValidationScreen.tsx:937-939` | **판정 기준 변경** | 문제 4 해결 |
| 5 | 근거 0건 사유 표시 | `activities.ts:1748-1759` | 표시 변경 | 문제 6 완화 |

### 1번과 4번은 성격이 다르다

`isPublishedResult`는 세 조건을 한꺼번에 검사하지만, 되돌리는 의미가 서로 다르다.

- **1번 (`exception_status` 완화)** — 결정 API가 이미 `AVAILABLE`·`REJECTED`·`CONFLICT_UNRESOLVED`를 정상 입력으로 받고 있다(`phase4-repository.ts:4996`, `:4998`). 화면만 못 보고 있던 상태를 되살리는 것이므로 판정 기준이 바뀌지 않는다.
- **4번 (`machine_status = 'passed'`, `cardinality(evidence_ids) > 0` 완화)** — "무엇을 결과로 인정하는가" 자체가 바뀐다. 검증에 실패했거나 근거가 하나도 없는 행이 목록에 들어온다. 화면에서 반드시 "검증 실패" 상태로 구분해 표시해야 하며, 성공 건수 집계·정렬·기본 선택 로직도 함께 확인해야 한다.

두 작업을 한 커밋에 섞지 않는 편이 안전하다.

### 하위 소비 경로 안전성 (확인 완료)

1번 수정으로 `results[]`에 미검증 상태가 섞여도 **권위 경로는 영향을 받지 않는다.** 확인한 근거:

| 경로 | 재확인 방식 | 위치 |
|---|---|---|
| `getValidationWorkspace` 소비자 | 서버 측 소비자 없음 — `app/api/.../validation/route.ts`에서 화면으로만 전달 | `validation/route.ts:21` |
| Excel 쓰기 제안 생성 | `validation_result`를 **독립 쿼리**로 다시 조회하며 strict 필터 유지 | `phase4-repository.ts:4772-4777` |
| 충돌 해결 후 재집계 | `NOT IN ('REJECTED','REINVESTIGATING','SUPERSEDED','CONFLICT_UNRESOLVED')` | `phase4-repository.ts:5283-5289` |
| Workbook 반영 | 미해결 충돌을 `VALIDATED_VALUE_CONFLICT_UNRESOLVED`로 명시 차단 | `workbook-application.ts:383-389` |
| 완료 게이트 | 자체 쿼리(`<> 'SUPERSEDED'`)로 재계산 | `phase4-repository.ts:3067` |

즉 `getValidationWorkspace`의 `results[]`는 **표시 전용 payload**이며, 값의 권위는 서버가 매번 다시 판정한다.

**단, 화면 쪽 파생값 1곳은 함께 고쳐야 한다** — `ValidationScreen.tsx:929-933`의 `verifiedExcelTargetIds`가 `publishedResults`에서 파생된다. 2번 작업으로 `isPublishedResult`를 그냥 제거하면 검증 실패 대상까지 "검증됨"으로 취급된다. 이 파생값은 `machineStatus === 'passed' && evidenceIds.length > 0` 조건을 **명시적으로 유지**해야 한다(서버가 제안을 거부하므로 데이터 손상은 없지만, 화면이 잘못된 상태를 보여준다).

**그 밖의 주의** — `getValidationWorkbook`(`:4672`, `:4777`)의 필터는 "검증을 통과한 값만 Excel에 반영한다"는 STEP 05 불변조건이므로 **현행 유지**한다. 목록·상세 조회만 완화한다.

## 5. 회귀 방지

현재 `tests/`에 STEP 04 commit → STEP 05 read 왕복을 검증하는 통합 테스트가 없다. `phase4-workbook-application.integration.test.ts`는 Excel 반영만 다룬다.

추가 권장 테스트:

1. 충돌 1건을 포함한 payload를 `commitResearchValidationResult`로 저장한 뒤, `getValidationWorkspace`가 해당 결과와 `conflicts` 항목을 **함께** 반환하는지 확인
2. 결과 1건을 반려한 뒤 목록에 `exceptionStatus: 'REJECTED'`로 남아 있고 복원이 가능한지 확인
3. Excel 대상 1건이 `machineStatus: 'failed'`, `evidence: []`로 저장됐을 때 목록에 나타나는지 확인
4. 게이트 blocker의 `targetId`가 모두 목록에 존재하는 결과를 가리키는지 검사하는 불변조건 테스트 (게이트와 목록의 집합 불일치를 구조적으로 막는다)

## 6. 실행 검증이 필요한 항목

정적 분석으로 판정할 수 없어 실제 기동이 필요한 것들:

- `npm run dev:full` 기동 여부 (`npm run dev`만으로는 Temporal 작업이 진행되지 않는다)
- OpenDART·KRX·ECOS·OpenAI 인증정보 유효성 — 없으면 `RESEARCH_NO_SOURCES` 등으로 작업 자체가 실패한다
- 진행 중이던 workflow가 있다면 어느 patch 분기를 타는지 (Temporal 히스토리 의존)
- 실제 프로젝트 데이터에서 충돌·반려가 발생하는지 (데이터 의존)
