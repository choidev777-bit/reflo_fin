# STEP 04·05 자료조사 미작동 원인 진단 (2026-07-27)

실제 실행 중인 로컬 스택(Next dev + control worker + Docker workers + PostgreSQL + Temporal)에서
재현·계측한 결과다. 추정이 아니라 모두 1차 증거가 있다.

---

## 요약

자료조사는 **두 지점에서 각각 독립적으로 끊긴다.**

| # | 위치 | 증상 | 상태 |
|---|---|---|---|
| A | STEP 04 계획 승인 | `조사 시작` 자체가 불가능 (버튼 비활성 / API 422) | **현재 live · 재현 100%** |
| B | LLM worker Research/News Agent | 실행돼도 503 `UsageLimitExceeded`로 workflow 실패 | **현재 live · 재현함** |
| C | `planNewsSearch` heartbeat timeout | activity가 30초 heartbeat timeout으로 죽음 | 작업 트리에서 이미 수정됨 (미커밋) |

A를 고쳐도 B에서 다시 실패한다.

**중요 — 이 목록은 "지금 막고 있는 것"의 전부이지 "고쳐야 할 것"의 전부가 아니다.**
현재 작업 트리로 자료조사 파이프라인이 끝까지 완주하는 것을 확인한 적이 없다.
A·B를 고친 뒤 뒤쪽 activity(`validateHypothesisPipeline`, `validateOfficialExcelPipeline`,
`publishSeparatedResearchValidation`)와 `/validation/evidence`에서 추가 실패가 나올 수 있다.
근거는 §D에 정리했다.

---

## A. STEP 04 계획 승인이 영구히 차단됨

### 증거

미커밋 코드로 프로젝트 3개 모두 동일하게 실패한다.

```
POST /api/projects/{id}/research-plan/approve-and-start
→ 422 PLAN_VALIDATION_FAILED "조사 계획의 차단 항목을 확인해주세요."
   REPORT_TARGET_CONNECTION_REQUIRED × 4
     - 현재주가
     - 도표 2. PER Band
     - 도표 3. PBR Band
     - 투자지표
```

확인한 프로젝트: `019fa132`(ㄷㄷㄷ), `019fa125`(대대대덕), `019fa033`(44) — 전부 같은 4건.

### 원인 체인

1. `research-report-targets.ts`에 **새로 추가된**(미커밋, 오늘 11:24) `missingExecutableReason` 로직이
   `required && collection_required && executableTargetIds.length === 0` 인 대상의 status를
   `collection_required` → **`connection_required`** 로 승격시킨다.
2. `phase4-repository.ts`에 **새로 추가된**(미커밋, HEAD에 존재하지 않음) `reportTargetValidationIssues()`가
   `required && status === "connection_required"` 를 **차단 issue**로 만든다.
3. 이 issue가 `getResearchPlanWorkspace`의 `validationSummary`와
   `approveResearchPlanAndStart`의 `issues` 양쪽에 주입된다.
4. `ResearchPlanScreen.tsx:507`
   `planReady = validationSummary.valid && saveState === "saved"` → **false**
   `ResearchPlanScreen.tsx:604` footer `다음` 버튼 `disabled` → 승인 dialog 자체를 열 수 없다.

### 사용자가 해결할 수 없는 이유

- **도표 2. PER Band**: sourcePolicy가 `FNGUIDE_CONSENSUS`이고, 코드가 직접
  "FnGuide 자동 수집은 현재 지원하지 않습니다"라고 판정한다. STEP 02에서 아무리 연결해도 해소 불가.
- **현재주가**: 권위 출처가 KRX API다. Excel 수집 target이 없는 게 정상인데도 차단된다.
- **도표 3. PBR Band / 투자지표**: 해당 slot을 참조하는 executable Excel target이
  workbook에 아예 존재하지 않는다(실측: excelTargets 18개는 sheet_13/15/16/17/18/20 7개 slot만 커버).

즉 **어떤 사용자 조작으로도 통과할 수 없는 상태**다.

### 회귀임을 보여주는 증거

- `git show HEAD:...phase4-repository.ts | grep reportTargetValidationIssues` → 결과 없음 (전부 신규)
- 같은 프로젝트 `019fa132`가 01:53 UTC에는 승인에 성공해 research job을 실제로 실행했다.
  차단 코드는 그보다 뒤인 11:24 KST에 작성됨.
- `tests/research-report-targets.test.ts`는 신규 로직에 맞춰 **executableTarget을 주입하도록 수정**되어
  테스트는 통과한다. 실제 프로젝트 데이터(연결 없음)는 한 번도 테스트되지 않았다.

### 설계 문서와의 충돌

`.omd/preferences.md`의 적용된 교정
`2026-07-27-phase4-remove-blocker-panel`은
"STEP 04 본문 아래의 별도 계획 차단 항목 경고 panel은 표시하지 않고
필요한 상태와 조치는 해당 질문·리포트 입력 대상 안에서 보여준다"이다.
리포트 입력 대상 상태를 **hard blocker**로 올린 것은 이 교정과 반대 방향이다.

`docs/fix/STEP04_05_HYPOTHESIS_EXCEL_PIPELINES.md` §4.3도 `연결 확인`을
처리 방법(상태) 중 하나로 규정하지 STEP 04 승인 게이트로 규정하지 않는다.

### 권장 수정

`reportTargetValidationIssues()`의 결과를 **차단 issue에서 제외**한다.
리포트 입력 대상의 `connection_required` / executable 없음 상태는
대상 card 안의 상태·사유로만 노출하고, STEP 04 승인은 기존 `validateResearchPlan()`만으로 판단한다.

수정 지점 2곳:
- `source-react/server/infrastructure/repositories/phase4-repository.ts` — `getResearchPlanWorkspace`의 `validationIssues` 병합
- 같은 파일 `approveResearchPlanAndStart`의 `issues` 병합

같은 함수 안의 `REPORT_TARGET_NOT_EXECUTABLE` 분기도 함께 처리해야 한다.
지금은 `missingExecutableReason`이 해당 경우를 먼저 `connection_required`로 바꿔버려서
이 분기가 실행되지 않을 뿐이다. `connection_required` 쪽만 고치면 이 분기가 살아나
같은 차단이 다시 발생한다.

---

## B. Research / News Search Agent가 usage limit을 초과함

### 증거 (직접 계측)

최소 payload(질문 1개, `queryLimit: 2`, `discoverLimit: 5`)로 LLM worker를 직접 호출:

```
POST http://127.0.0.1:8093/research/news-search
→ HTTP 503  (26.3s)
   {"detail":"News Search Agent execution failed: UsageLimitExceeded"}
```

컨테이너 안에서 같은 호출을 재현해 실제 예외 메시지를 확보:

```
pydantic_ai.exceptions.UsageLimitExceeded:
Exceeded the input_tokens_limit of 40000 (input_tokens=63137)
```

`input_tokens`는 pydantic-ai에서 **run 전체 누적값**이다.
web search 도구를 쓰는 agent는 턴마다 이전 대화 + 검색 결과를 다시 보내므로 누적 input이 급증한다.

같은 payload로 한도만 올려 재측정하면 사용량이 **실행마다 크게 흔들린다.**

| 실행 | requests | 누적 input_tokens | 결과 |
|---|---:|---:|---|
| 1회차 (한도 40,000) | 2회 이상 | **63,137에서 중단** | 503 UsageLimitExceeded |
| 2회차 (한도 2,000,000) | 1 | **25,413** | 정상 종료 |

즉 web search를 한 번만 돌면 25k, 여러 라운드를 돌면 63k 이상이다.
**40,000이라는 한도가 이 변동폭 한가운데에 있어 간헐적으로 실패한다.**
과거 job 기록도 이와 일치한다 — `019fa12f`의 `planNewsSearch`는 통과했고
`019fa147`의 `planNewsSearch`는 오래 돌다가 죽었다.

질문 1개·`queryLimit 2`·`discoverLimit 5`에서 나온 수치다.
실제 계획은 질문 5개·`queryLimit 4`·`discoverLimit 20`이므로 더 크지만,
**그 값은 실측하지 않았다.** 한도를 정할 때는 실제 계획 payload로 다시 측정해야 한다.

### 같은 원인의 과거 실패

`019fa12f` job(01:27 UTC)은 `extractResearchCandidates`에서 실패했다.

```
Research Agent 503: {"detail":"Research Agent execution failed: UsageLimitExceeded"}
  at callResearchAgent (workers/control/activities.ts:751)
```

`/research/candidates`는 `input_tokens_limit=50_000`, `request_limit=2`다.
입력에 수집한 DART·IR·뉴스 원문 전체가 들어가므로 news-search보다 초과 여지가 더 크다.

### 부수 문제: 실패 원인이 감춰짐

`workers/llm/app.py`의 예외 처리는 `type(error).__name__`만 반환한다.

```python
raise HTTPException(
    status_code=503,
    detail=f"News Search Agent execution failed: {type(error).__name__}",
)
```

`UsageLimitExceeded`만으로는 input/output/request 중 무엇이 걸렸는지 알 수 없다.
이 때문에 원인 파악에 컨테이너 내부 재현이 필요했다.

### 권장 수정

1. web search를 사용하는 agent의 `input_tokens_limit`을 **실제 계획 payload로 실측한 뒤** 재산정한다.
   구체적인 숫자를 여기서 제시하지 않는 이유는 위 표대로 변동폭이 크고,
   실제 규모(질문 5개)를 측정하지 않았기 때문이다. 추정치를 코드에 넣지 말 것.
2. 무한 비용을 막는 상한은 유지하되, **request_limit / output_tokens_limit** 로 제어하고
   누적 input 상한은 실제 도구 사용량을 반영한다.
   `/research/candidates`의 `request_limit=2`는 `ModelRetry` 검증기가 한 번만 재시도해도 소진된다.
3. 503 detail에 `str(error)`를 포함시켜 어떤 한도가 걸렸는지 드러낸다.
   (외부 노출이 아니라 내부 worker → control worker 경로다.)

> **이건 설정 변경이 아니라 비용 결정이다.**
> 이 한도들은 사용자 OpenAI 키의 지출 상한 역할을 한다.
> 올리면 실패는 줄지만 실행당 비용이 올라간다. 얼마까지 허용할지는 사용자가 정해야 한다.

---

## C. planNewsSearch heartbeat timeout (작업 트리에서 이미 수정됨)

`019fa147` job(01:53 UTC) 실패:

```
WORKFLOW_EXECUTION_FAILED
  Activity task timed out → activity Heartbeat timeout
  activityType: planNewsSearch, heartbeatTimeout: 30s
  lastHeartbeatDetails: {"phase":"searching_news","progressPercent":30}
```

마지막 heartbeat는 `recordJobProgress`가 보낸 것이고, 그 뒤 LLM worker 응답을 기다리는 동안
heartbeat가 끊겨 30초 timeout에 걸렸다.

**현재 작업 트리에는 이미 수정이 들어가 있다.**
`workers/control/activity-heartbeat.ts`(신규 파일)와 `runWithPeriodicActivityHeartbeat` 래핑이
`git diff`상 전부 `+` 라인이며, `callNewsSearchAgent`/`callResearchAgent`가 이를 사용한다.
control worker도 11:28 KST에 재시작되어 이 코드를 적재하고 있다.

다만 **B 때문에 아직 런타임에서 검증되지 않았다.** B를 고친 뒤 재확인이 필요하다.

---

## D. 아직 확인하지 못한 구간

A가 승인을 막고 B가 첫 activity에서 끊기기 때문에, 그 뒤 구간은 **한 번도 실행되지 않았다.**

미확인 activity:
`collectHypothesisBundle` · `collectOfficialExcelBundle` ·
`validateHypothesisPipeline` · `validateOfficialExcelPipeline` · `publishSeparatedResearchValidation`

특히 `/validation/evidence`는 B와 같은 실패가 날 가능성이 높다.
`workers/llm/app.py`의 나머지 agent endpoint도 전부 같은 수준의 한도를 쓴다.

| endpoint | input_tokens_limit | output | request_limit |
|---|---:|---:|---:|
| `/research/news-search` | 40,000 | 6,000 | 8 |
| `/research/candidates` | 50,000 | 8,000 | 2 |
| `/validation/evidence` | 50,000 | 8,000 | 2 |
| `/validation/question-answers` | 30,000 | 3,000 | 2 |
| `/report/outline` | 50,000 | 8,000 | 2 |
| `/report/draft` | 50,000 | 8,000 | 2 |

`/validation/evidence`는 후보 목록에 **수집한 원문 전체**를 함께 넣는다.
질문 1개짜리 검색이 이미 25k–63k를 쓰는 것을 감안하면 50,000은 위태롭다.
다만 실행해 보지 않았으므로 **추정이다.** A·B를 고친 뒤 실제로 확인해야 한다.

---

## E. 동시에 작업 중인 다른 agent

`.codex_tmp/per-band-inspect-019fa132/` 가 **11:34**에 생성돼 있다(이 진단 요청 직전).
내용은 업로드된 workbook에서 `06_도표2_PER_Band`, `07_도표3_PBR_Band`, `14_p4_투자지표`,
`02_p1_Consensus` 시트를 직접 열어보는 스크립트다.
§A의 차단 대상과 정확히 같은 항목이며, Codex kernel 프로세스도 아직 살아 있다.

즉 다른 agent가 **"이 대상들을 연결 가능하게 만드는"** 방향으로 접근 중일 수 있다.
그 방향과 §A의 권장 수정("차단하지 말 것")은 서로 다른 해법이므로 **조율이 필요하다.**

- 매핑을 고쳐 4개 대상이 실제로 연결되면 → 차단 로직을 그대로 둬도 통과한다.
  단 `도표 2. PER Band`의 `FNGUIDE_CONSENSUS`는 코드가 "지원하지 않음"으로 판정하므로
  매핑만으로는 해소되지 않는다.
- 이 진단은 **코드를 수정하지 않았다.** 해당 파일들을 다른 agent가 편집 중이므로
  충돌을 피하려 의도적으로 손대지 않았다. 적용 여부와 방향은 사용자가 정해야 한다.

---

## 검증 방법

A와 B를 고친 뒤 다음이 모두 통과해야 한다.

1. STEP 04에서 `다음` 버튼이 활성화되고 `자료 수집 시작`이 열린다.
2. `research_collection` job이 `succeeded`로 끝난다.
   ```sql
   SELECT job_type, operation_status, current_phase, error_code
   FROM workflow_job ORDER BY requested_at DESC LIMIT 5;
   ```
3. Temporal history에 `planNewsSearch`·`collectHypothesisBundle`·`collectOfficialExcelBundle`·
   `extractResearchCandidates` 가 모두 `ACTIVITY_TASK_COMPLETED`로 남는다.
   ```
   docker exec local-temporal-1 temporal workflow show \
     --workflow-id "reflo:{jobId}" --address 172.18.0.9:7233 --namespace default --output json
   ```
4. STEP 05에 실제 출처와 Evidence가 표시된다.

---

## 진단에 사용한 명령

```bash
# 실패한 job 확인
docker exec local-postgres-1 psql -U reflo -d reflo -c \
  "SELECT job_id, job_type, operation_status, current_phase, error_code, requested_at
   FROM workflow_job ORDER BY requested_at DESC LIMIT 15;"

# 실제 실패 원인 (workflow_job.error_summary는 사용자용 문구라 원인이 안 보인다)
docker exec local-temporal-1 temporal workflow show \
  --workflow-id "reflo:019fa147-18c8-7005-8f3a-2968a8f582e6" \
  --address 172.18.0.9:7233 --namespace default --output json

# LLM worker 직접 호출로 usage limit 재현
curl -X POST -H "Content-Type: application/json" \
  --data-binary @news.json http://127.0.0.1:8093/research/news-search
```
