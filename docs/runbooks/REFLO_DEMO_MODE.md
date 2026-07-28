# 시연 모드 (REFLO_DEMO_MODE)

시연 영상 촬영용으로 STEP 01~07에서 **AI를 호출하는 모든 구간을 고정 응답으로
대체**하는 모드다. AI 외의 기능(파일 업로드·검사, Excel 계산, PDF 렌더링,
내보내기)은 그대로 실제로 동작한다.

목적은 두 가지다.

- **비용**: 실행할 때마다 나가는 AI 호출 비용을 없앤다.
- **재현성**: 촬영을 다시 해도 화면에 같은 질문과 같은 근거가 나온다.

고정 응답은 즉시 만들어지므로 그대로 두면 화면이 깜빡이고 끝나 작업이 실행된
것처럼 보이지 않는다. 그래서 단계마다 지연을 넣는다.

## 켜고 끄기

`source-react/.env.local`에서 조정한다.

```bash
REFLO_DEMO_MODE=1
REFLO_DEMO_HYPOTHESIS_SECONDS=5   # STEP 03 가설 질문 생성
REFLO_DEMO_RESEARCH_SECONDS=15    # STEP 04 자료 수집·검증
REFLO_DEMO_OUTLINE_SECONDS=6      # STEP 07 페이지 구성 제안
REFLO_DEMO_DRAFT_SECONDS=10       # STEP 07 본문 초안 생성
```

값을 바꾼 뒤에는 두 가지를 모두 재시작해야 반영된다.

```bash
cd source-react
npm run compose:local -- up -d --build llm-worker   # LLM worker 컨테이너
# dev:full 재시작 (Next.js + control worker)
```

컨테이너에 값이 들어갔는지 확인:

```bash
docker exec local-llm-worker-1 sh -c 'env | grep REFLO_DEMO | sort'
```

## 적용 범위

AI를 호출하는 지점은 LLM worker의 7개 엔드포인트가 전부이며 모두 덮었다.

| 단계 | 엔드포인트 | 지연 | 지연 위치 |
|---|---|---:|---|
| STEP 03 | `/hypothesis/questions` | 5s | LLM worker |
| STEP 04 | `/research/news-search` | — | 아래 참고 |
| STEP 04 | `/research/candidates` | — | 아래 참고 |
| STEP 04 | `/validation/evidence` | — | 아래 참고 |
| STEP 04 | `/validation/question-answers` | — | 아래 참고 |
| STEP 07 | `/report/outline` | 6s | LLM worker |
| STEP 07 | `/report/draft` | 10s | LLM worker |

STEP 04는 control worker가 이 엔드포인트들을 아예 호출하지 않고 로컬에서
고정 응답을 만든다. 지연은 control worker가 15초를 네 단계로 나눠 적용한다
(수집 30% → 후보 구조화 25% → 원문 검증 25% → 게시 20%). 한 곳에서 15초를
멈추면 진행률 막대가 굳어 보이기 때문이다.

AI를 쓰지 않는 구간은 손대지 않았다. STEP 01 기업 조회, STEP 02 PDF·Excel
검사, STEP 06 Excel 계산, STEP 07 미리보기·내보내기는 실제로 동작한다.

### 예외: STEP 06 입력값

STEP 06은 AI를 쓰지 않지만 **입력값은 시연 모드에서 미리 채운다.** 전망 연도
85칸과 Target PER 두 가지다. 화면에는 `입력값 승인` 한 번만 남는다.

Excel roll-forward가 모델을 한 해 밀기 때문에(`2023~2027F` → `2024~2028F`)
마지막 전망 열은 빈 채로 STEP 06에 도착한다. 그 85칸은 애널리스트가 직접
입력하는 자기 추정치라 어떤 자료에서도 가져올 수 없고, 다 채우기 전에는 승인
게이트(`REQUIRED_INPUT_MISSING`)가 STEP 07로 넘어가는 것을 막는다. 촬영 중에
손으로 칠 수 없으므로 시연 모드에서는 워크북이 처음 열릴 때 값을 넣어 둔다.

- 값: `source-react/server/domain/demo-valuation-forecast.ts`
- 적용: `getValuationWorkspace`가 STEP 06 첫 진입에서 한 번만 실행한다.
  사용자가 이미 입력한 칸은 덮어쓰지 않고, 시트 이름이 안 맞는 다른 기업
  모델에는 아무것도 쓰지 않는다.
- 발표 멘트: 이 칸들은 원래 애널리스트가 직접 입력하는 자리라고 설명하고
  넘어간다. 01 탭에서 노란 배경 칸이 사용자 입력 칸이다.

**Target PER은 41.9배로 확정해 둔다** (`DEMO_TARGET_PER`). Forward EPS 3,033원
기준 목표주가 127,000원, 현재주가 109,400원 대비 상승여력 +16.1%다.

Excel의 `적정 P/E`(27.82배 = Peer 평균)를 그대로 쓰지 않는 이유가 있다. 그
모델은 주가 52,500원 시점에 만들어져서, 현재주가에 대면 목표주가가 84,000원으로
내려가고 상승여력이 **-23%**가 된다. STEP 03에서 입력하는 강세 투자의견과
STEP 07 보고서가 정면으로 어긋난다. 이 회귀는 테스트가 막는다.

사용자가 화면에서 다른 값을 반영했으면 draft 행이 이미 있으므로 시드가 건드리지
않는다. 촬영 중에 값을 바꿔 보여줘도 된다.

시연 모드를 켜기 **전에** 만든 프로젝트는 자동으로 채워지지 않는다. 그때는
한 번만 실행한다.

```bash
cd source-react
npx tsx scripts/demo-fill-forecast-column.ts <projectId>            # 계획만
npx tsx scripts/demo-fill-forecast-column.ts <projectId> --apply    # 반영
```

`fixtures/`의 Valuation 모델이 아닌 다른 기업·분기로 촬영하려면
`DEMO_FORECAST_CELLS`를 그 모델에 맞게 새로 만들어야 한다. 값이 하나도 안 맞으면
시드가 0건이 되고 STEP 06에서 다시 막힌다. 이 회귀는
`source-react/tests/demo-valuation-forecast.test.ts`가 막는다.

## 시연 시나리오 (대덕전자 1Q26)

STEP 02에 넣는 파일은 `fixtures/`에 있다.

- `4Q25_대덕전자_실적리뷰_하나증권.pdf` — 직전 보고서
- `대덕전자_353200_4Q25_Valuation_하나증권_2_최종.xlsx` — 밸류에이션 모델
- `대덕전자26-1분기.pdf` — 26년 1분기 IR

STEP 03 투자의견은 다음 문장을 입력한다.

> 대덕전자는 AI·데이터센터와 위성통신 수요를 기반으로 1Q26 이후 실적 상승
> 사이클을 이어가며, 현 주가는 이를 충분히 반영하지 못했다고 본다.

질문 5개는 `workers/llm/app.py`의 `demo_proposal()`에 고정돼 있다. STEP 04
출처는 DART 공시와 기업 IR로 묶는다.

### 다른 기업·분기로 바꾸려면

시연 질문은 **대덕전자 2026년 1분기 전용**이다. 질문 본문에 1Q26·2Q26이
들어 있고, 질문 검증 규칙(`validate_proposal`)이 보고서 기준 분기에서
다음 분기 표현을 요구한다. 다른 분기로 촬영하려면 `demo_proposal()`의 질문
본문과 `period`·`comparison`을 함께 고쳐야 한다.

## 테스트 fixture와의 관계

`REFLO_LLM_TEST_FIXTURE`(E2E용)가 켜져 있으면 시연 모드는 **양보한다**.
두 모드는 같은 LLM worker 컨테이너를 쓰는데, E2E는 다른 기업(`095340`)과
다른 분기를 쓰고 `[fixture:fail-twice]` 재시도 경로까지 검사한다. 시연 질문은
그 입력에서 검증을 통과하지 못하고, 시연 지연이 걸리면 E2E도 그만큼 느려진다.

따라서 `npm run test:e2e`는 시연 모드를 켜 둔 채로 실행해도 된다.

### E2E를 돌린 뒤에는 시연 모드가 꺼진 채로 남는다

Playwright의 `webServer`는 `npm run db:up`을 자기 환경으로 실행하고, 그 환경에는
`REFLO_LLM_TEST_FIXTURE=1`이 들어 있다. compose가 이 값을 컨테이너에 그대로
넘기므로 **E2E가 끝난 뒤에도 컨테이너에 `REFLO_LLM_TEST_FIXTURE=1`이 남는다.**
위 우선순위 규칙 때문에 시연 모드는 조용히 꺼진 상태가 된다.

촬영 직전에 반드시 확인한다.

```bash
docker exec local-llm-worker-1 sh -c 'env | grep REFLO_LLM_TEST_FIXTURE'
```

`0`이 아니면 되살린다.

```bash
cd source-react
env -u REFLO_LLM_TEST_FIXTURE npm run compose:local -- up -d --force-recreate llm-worker
```

**증상**: STEP 03에서 질문이 5초를 기다리지 않고 즉시 나오고, 질문 문구가
대덕전자 시연 질문이 아니라 일반 회귀 검증용 문구다.

## 주의

STEP 04에서는 원문 수집과 조사 후보를 **함께** 고정한다. 근거 검증이
"인용문이 수집한 원문 안에 실제로 존재하는가"를 확인하기 때문에, 원문만 실제로
수집하고 후보만 고정하면 인용문이 원문과 맞지 않아 근거가 전부 걸러진다.
그러면 STEP 04는 100%로 끝나는데 STEP 05가 비는 화면이 된다.

이 회귀는 `source-react/tests/demo-research-bundle.test.ts`가 막는다.
