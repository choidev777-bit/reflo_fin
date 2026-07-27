# REFLO 화면 구현 명세: `/projects/:projectId/process/hypothesis`

> **2026-07-27 현재 구현 정정 — 이 블록이 아래 초기 3~5개/v3 명세보다 우선한다.**
>
> - 질문은 3~7개이며 화면의 수동 추가 상한도 7개다.
> - canonical prompt는 [`../agents/HYPOTHESIS_AGENT_PROMPT_v4.md`](../agents/HYPOTHESIS_AGENT_PROMPT_v4.md), prompt version은 `hypothesis-v4`, profile은 `hypothesis-openai-v3`, model은 `gpt-5.4-mini`다.
> - 질문에는 `PERFORMANCE`, `DRIVER`, `SEGMENT`, `OUTLOOK`, `VALUATION` role이 저장된다. 현재 질문 행 UI는 role badge를 표시하지 않는다.
> - Agent 생성 결과는 PERFORMANCE, OUTLOOK, VALUATION, DRIVER 또는 SEGMENT coverage를 강제한다.
> - 사용자가 질문을 편집·삭제한 뒤의 최종 승인 API는 role coverage를 다시 검사하지 않고 개수·중복·metadata·input revision만 검사한다.
> - optional 현재 IR은 현재 공식 사실·회사 전망으로, 이전 PDF·Excel은 현재 사실이 아닌 조사 주제·구조 배경으로 질문 생성 snapshot에 전달된다.
> - 아래 본문의 `3~5`, 최대 5개, prompt v3, `optionalContext` 제외 설명은 현재 구현과 다르다. 실제 구현 기준 전체 설명은 [`REFLO_URL_SERVICE_BEHAVIOR_v1.md`](../REFLO_URL_SERVICE_BEHAVIOR_v1.md)의 해당 URL 절을 따른다.

**문서 상태:** 1차 구현 명세 완료
**작성일:** 2026-07-24
**대상:** 현업 배포용 MVP
**상위 문서:** [`REFLO_SCREEN_IMPLEMENTATION_SPEC_v1.md`](../REFLO_SCREEN_IMPLEMENTATION_SPEC_v1.md)
**기준 문서:** [`REFLO_URL_SERVICE_BEHAVIOR_v1.md`](../REFLO_URL_SERVICE_BEHAVIOR_v1.md), [`REFLO_TECHNICAL_DECISIONS_v1.md`](../REFLO_TECHNICAL_DECISIONS_v1.md)

## 1. 명세 상태

| 항목 | 값 |
|---|---|
| URL | `/projects/:projectId/process/hypothesis` |
| 화면 단계 | STEP 03 · 투자 의견 · 조사 질문 |
| 접근 권한 | Google 로그인 사용자 중 해당 프로젝트 소유자 |
| 선행 조건 | 프로젝트 설정 완료, PDF·Excel 업로드와 필수 적합성 검사 완료 |
| 주요 목적 | 잠정 투자의견과 투자 가설을 실제 자료로 검증 가능한 조사 질문 3~5개로 확정 |
| 이전 화면 | `/projects/{projectId}/process/files` |
| 다음 화면 | `/projects/{projectId}/process/research-plan` |
| 현재 route 파일 | `source-react/app/projects/[projectId]/process/hypothesis/page.tsx` |
| 현재 실제 렌더링 경로 | route 재-export → `source-react/app/page.tsx` → `PlannedProcessPage` → `HypothesisSetup` |
| 현재 디자인 파일 | `source-react/app/process.tsx`, `source-react/app/globals.css` |
| 관련 기술 결정 | TD-011의 Temporal·LLM 격리 워커·PostgreSQL 작업 projection, TD-014, TD-016, TD-017, TD-023 |
| 현재 구현 상태 | 하드코딩·브라우저 로컬 상태 기반 프로토타입, 인증·저장·PydanticAI·승인 미연결 |

## 2. 화면 목적과 책임

이 화면은 애널리스트의 현재 관점을 정답으로 확정하는 곳이 아니다. 사용자가 정한 잠정 투자의견과 투자 가설을 Hypothesis Agent가 가설을 뒷받침하기 위해 확인해야 할 조사 질문으로 바꾸고, 사용자가 질문 목록을 편집·정렬·승인하는 곳이다.

이 화면의 책임은 다음과 같다.

1. `BUY`, `HOLD`, `SELL` 중 잠정 투자의견 하나를 기록한다.
2. 사용자의 현재 투자 가설을 자유 입력으로 저장한다.
3. PydanticAI 기반 Hypothesis Agent로 3~5개의 조사 질문을 만든다.
4. 질문이 기업·기간·관찰 지표를 명확히 포함하는지 검증한다.
5. 전체 질문이 가설의 핵심 인과관계와 중요한 하위 주장을 함께 다루는지 검증한다.
6. 사용자가 질문을 추가·수정·삭제·정렬한 뒤 전체 질문 세트를 승인하게 한다.
7. 승인한 질문 버전을 다음 자료 수집 및 계획 단계의 입력으로 고정한다.

다음 작업은 이 화면에서 수행하지 않는다.

- 최종 투자의견 확정
- 조사 출처 선택
- DART·IR·뉴스 수집
- Research Agent 또는 Validation Agent 실행
- Evidence 생성·검증
- Excel 표시·입력·재계산
- 밸류에이션 또는 보고서 생성

## 3. 판단 우선순위와 핵심 결정

이 명세에서는 다음 순서로 판단한다.

1. 서비스 동작 명세의 MVP 불변조건과 10장·16.1장
2. 기술 결정 문서의 TD-011과 공통 소유권·작업 격리 원칙
3. `DESIGN.md`와 `.omd/preferences.md`의 최신 명시적 선호
4. 현재 `HypothesisSetup`의 시각 구조와 상호작용

현재 프로토타입과 기준 문서가 충돌하는 항목은 다음처럼 확정한다.

| 충돌 항목 | 현재 프로토타입 | 목표 계약 |
|---|---|---|
| 잠정 투자의견 | 선택 사항 | `BUY/HOLD/SELL` 중 하나 필수 |
| 질문 생성 | 브라우저 정규식으로 최대 5개 생성 | 서버 PydanticAI Hypothesis Agent가 3~5개 생성 |
| 질문 품질 | 문구만 존재 | 기업·기간·비교 기준·관찰 지표 명확, 핵심 인과관계 포괄 |
| 질문 승인 | 없음 | 현재 입력 revision과 일치하는 질문 세트 전체 승인 필수 |
| 저장 | React 메모리와 모듈 전역변수 | PostgreSQL 자동 저장·버전 관리 |
| 다음 단계 조건 | 가설 문자열만 있으면 활성 | 투자의견·가설·유효한 질문 3~5개·전체 승인 모두 필요 |

`잠정 투자의견은 최종 의견이 아니다`라는 설명은 유지한다. 그러나 조사 방향의 필수 입력이라는 제품 기준이 더 우선하므로 현재의 `선택` 배지와 “선택하지 않아도 진행” 문구는 제거한다.

## 4. 접근 권한과 진입·이탈 조건

### 4.1 접근 권한

- 검증된 Google 로그인 세션이 필요하다.
- 서버가 세션의 Google 사용자 ID와 프로젝트 소유자를 비교한다.
- 클라이언트가 보낸 사용자 ID나 소유자 값을 권한 판정에 사용하지 않는다.
- 공동 프로젝트와 역할별 권한은 MVP 범위가 아니다.
- 존재하지 않는 프로젝트와 다른 사용자 소유 프로젝트는 프로젝트 정보 노출 없이 같은 `PROJECT_NOT_FOUND` 응답으로 처리한다.

### 4.2 직접 URL 진입

| 상태 | 처리 |
|---|---|
| 비로그인 | Google 로그인 후 원래 hypothesis URL로 복귀 |
| 프로젝트 없음·타 사용자 소유 | 프로젝트를 노출하지 않는 오류 화면 또는 `/projects` 이동 |
| 프로젝트 설정 미완료 | 마지막 유효 단계인 setup으로 이동하고 이유 표시 |
| PDF·Excel 검사 미완료·실패 | files 화면으로 이동하고 미완료 또는 차단 사유 표시 |
| 선행 조건 완료 | 저장된 hypothesis 초안과 질문 세트를 불러와 화면 표시 |
| 질문 생성 작업 실행 중 | 화면은 열고 현재 입력과 작업 진행 상태 표시 |
| 이미 승인 완료 | 승인 버전 표시, 다음 단계 이동 허용 |
| 상위 파일 버전 변경 | 기존 승인 질문을 `재검증 필요`로 표시하고 재승인 전 진행 차단 |

초기 렌더링에서 하드코딩된 삼성전기 값이나 빈 React 상태를 먼저 성공 화면처럼 표시하지 않는다. 서버가 세션·소유권·선행 조건·저장 초안을 확인하는 동안 최종 레이아웃 크기의 로딩 상태를 사용한다.

### 4.3 이탈

- `프로젝트로 돌아가기`는 저장 확인 후 `/projects`로 이동한다.
- 이전 단계 이동은 `/projects/{projectId}/process/files`로 이동한다.
- 완료하지 않은 초안 상태에서도 이전 화면·프로젝트 목록으로 나갈 수 있다.
- 서버 확인이 끝나지 않은 변경이 있으면 내부 URL 이동 전에 저장을 완료하거나 실패 안내를 표시한다.
- 브라우저 탭 닫기에서는 `keepalive` 저장을 보조 수단으로 사용할 수 있지만, 서버 성공 응답 전 상태를 저장 완료로 표시하지 않는다.
- 승인되지 않은 상태에서 다음 단계 URL을 직접 열면 research-plan 화면도 서버에서 진행을 차단해야 한다.

### 4.4 다음 단계 진행 조건

다음을 모두 만족해야 한다.

1. 잠정 투자의견이 `BUY`, `HOLD`, `SELL` 중 하나다.
2. 투자 가설이 공백 제거 후 비어 있지 않다.
3. 질문이 3~5개다.
4. 모든 질문이 비어 있지 않고 기업·대상 기간·비교 기준·관찰 가능한 지표를 포함한다.
5. 중복 질문이 없다.
6. 질문 세트가 현재 투자의견·가설 `inputRevision`에서 생성됐다.
7. 사용자가 현재 질문 세트 버전 전체를 승인했다.
8. 저장 충돌이나 생성 작업 오류가 남아 있지 않다.

## 5. 사용자 상태별 화면

| 화면 상태 | 표시 내용 | 가능한 동작 |
|---|---|---|
| `loading` | 헤더·세 카드의 최종 크기 skeleton | 없음 |
| `blocked_prerequisite` | 선행 단계 차단 이유와 해당 단계 이동 | files 또는 setup 이동 |
| `empty` | 필수 투자의견·가설 입력, 질문 패널 숨김 | 입력·자동 저장 |
| `draft_saved` | 저장된 입력, 질문이 없으면 생성 CTA | 입력 수정·질문 생성 |
| `generation_queued` | 입력은 유지, 생성 대기 상태 | 페이지 이탈 가능, 중복 생성 금지 |
| `generation_running` | 질문 영역 skeleton과 진행 문구 | 페이지 이탈 가능 |
| `question_review` | 3~5개 질문과 편집·삭제·정렬·추가·승인 | 질문 세트 검토 |
| `stale` | 이전 질문 유지, `다시 생성 필요` 표시 | 재생성, 입력 수정 |
| `approved` | 승인 시각과 승인 상태, 다음 버튼 활성 | 다음 단계 또는 재편집 |
| `save_error` | 마지막 서버 저장 실패와 재시도 | 로컬 입력 보존·재시도 |
| `generation_failed` | 구체적 실패 분류와 다시 만들기 | 재시도 |
| `version_conflict` | 다른 탭의 최신 버전 존재 안내 | 최신 내용 불러오기 |

## 6. 기본 사용자 흐름

### 6.1 최초 작성

```text
hypothesis URL 진입
  → 세션·소유권·files 완료 상태 확인
  → 잠정 투자의견 선택
  → 투자 의견에 대한 설명 입력
  → 자동 저장 완료
  → AI 질문 만들기
  → PydanticAI 질문 생성 작업
  → 검증된 질문 3~5개 표시
  → 질문 추가·수정·삭제·정렬
  → 질문 전체 승인
  → 다음
  → /projects/{projectId}/process/research-plan
```

### 6.2 기존 초안 재개

```text
저장된 초안 로드
  → 현재 inputRevision과 질문 생성 기준 비교
  → 같으면 질문 검토 계속
  → 다르면 이전 질문은 보존하되 다시 생성 필요
```

### 6.3 승인 후 재편집

```text
승인된 투자의견·가설·질문 변경 시도
  → 하위 결과 존재 여부 확인
  → 존재하면 재검증 영향 안내
  → 변경 확정
  → 기존 승인 해제
  → 연결된 하위 단계 revalidation_required
  → 현재 질문 세트 다시 승인
```

## 7. 기존 디자인 재사용·수정·제거 판정

| 현재 영역·동작 | 판정 | 구현 판단 |
|---|---|---|
| 상단 Process 헤더 | 재사용 | 프로젝트·보고서 상태에 실제 URL·가드 연결 |
| 좌측 7단계 사이드바 | 재사용 | 실제 단계 상태와 접근 가능 여부 연결 |
| `STEP 03`, 화면 제목·한 줄 설명 | 그대로 재사용 | `투자의견 · 조사 질문`, 현재 간결한 설명 유지 |
| 세로로 쌓인 흰색 작업 카드 | 재사용 | 정보 구조·간격·반응형 유지 |
| `BUY/HOLD/SELL` 3열 카드 | 재사용, 문구 수정 | 선택 UI 유지, `필수` 상태와 최종 의견 아님을 명시 |
| `선택` 배지와 선택 불필요 문구 | 제거 | 기준 문서와 충돌 |
| `투자 의견에 대한 설명` textarea | 그대로 재사용 | 500자 제한·글자 수·12px 입력 글자 유지 |
| textarea 아래 중복 helper | 추가하지 않음 | 섹션 설명과 placeholder만 사용 |
| `AI 질문 만들기` CTA | 재사용, 동작 교체 | 로컬 정규식 대신 서버 생성 작업 연결 |
| 질문 패널과 행 레이아웃 | 재사용 | 안정적 question ID와 2자리 표시 순서 사용 |
| 질문 `수정`, `삭제`, `추가` | 재사용 | 서버 CRUD·오류·44px target 연결 |
| index 기반 질문 식별 | 제거 | 서버 question ID 사용 |
| 모듈 전역 `prototypeResearchQuestions` | 제거 | 프로젝트별 서버 저장으로 교체 |
| `deriveQuestions` 정규식 생성 | 제거 | PydanticAI canonical prompt로 교체 |
| 생성 signature를 클라이언트 권위값으로 사용 | 제거 | 서버 `inputRevision`을 권위값으로 사용 |
| 질문 전체 승인 UI 없음 | 추가 | 질문 패널 하단에 단일 승인 CTA 추가 |
| 질문 정렬 UI 없음 | 추가 | drag handle과 키보드 이동 동작 추가 |
| 생성·저장 실패 상태 없음 | 추가 | 카드 내부 오류와 재시도 |
| 공용 하단 action bar | 재사용 | 실제 자동 저장 상태, 즉시 저장, 엄격한 다음 조건 연결 |
| 카드의 장식 그림자 | 수정 | `DESIGN.md`에 따라 hairline 중심의 평면 카드로 정리 |

화면을 새로운 대시보드로 다시 디자인하지 않는다. 기존 `.rf-research-screen`, `.rf-stack`, `.rf-panel`, `.rf-opinion-grid`, `.rf-thought-box`, `.rf-question-panel`의 DOM 책임과 시각 흐름을 단계별 컴포넌트로 옮기는 방식이 우선이다.

### 7.1 필요한 추가 요소

| 추가 요소 | 필요한 이유 | 배치 |
|---|---|---|
| generation 진행·실패 영역 | 서버 Agent 작업은 즉시 끝나지 않으며 화면 이탈 뒤에도 계속됨 | 질문 패널 자리 |
| 질문 전체 승인 CTA | 기준 문서의 사용자 승인 조건 충족 | 질문 패널 footer |
| pointer·keyboard 정렬 control | 중요도 순서를 보존하고 drag 전용 접근성 문제 방지 | 각 질문 행 |
| stale·obsolete 안내 | 입력 변경과 늦은 Agent 응답의 오적용 방지 | 질문 패널 header |
| save error·version conflict 복구 | 자동 저장 실패와 다중 탭 충돌 처리 | 관련 카드와 공용 footer |
| 하위 재검증 경고 dialog | 승인 뒤 변경이 이후 결과에 미치는 영향 확인 | 변경 확정 직전 |

별도의 과거 보고서 참고 sidebar, 출처 선택, Evidence 미리보기는 추가하지 않는다. 현재 단계의 결정에 필요하지 않거나 다음 단계 책임과 중복된다.

## 8. 목표 컴포넌트 구성

| 컴포넌트 | 책임 | 주요 입력 | 주요 출력·이벤트 |
|---|---|---|---|
| `HypothesisRoute` | 세션·소유권·선행 조건 확인, 초기 데이터 로드 | route `projectId`, 세션 쿠키 | 준비된 화면 또는 접근 가드 |
| `ProcessShell` | 공용 헤더·사이드바·하단 action bar | 프로젝트·단계 상태 | 단계 이동 |
| `HypothesisScreen` | 화면 상태와 세 영역 조정 | project context, draft, question set | 저장·생성·승인 |
| `ProvisionalRatingField` | `BUY/HOLD/SELL` 단일 선택 | 현재 rating, disabled | rating 변경 |
| `ThesisField` | 투자 가설 입력과 글자 수 | thesis, maxLength | debounced 저장 |
| `QuestionGenerationAction` | 생성·재생성 요청과 진행 상태 | input revision, generation | 생성 시작·재시도 |
| `QuestionSetPanel` | 질문 목록·검증·전체 승인 | questions, status, version | CRUD·정렬·승인 |
| `QuestionRow` | 질문 표시·인라인 편집·삭제·순서 이동 | question, index | edit·delete·reorder |
| `QuestionComposer` | 사용자 질문 추가 | count, validation | add |
| `RevalidationWarningDialog` | 승인 또는 하위 결과 무효화 영향 확인 | invalidated stages | 변경 진행·취소 |
| `SaveStatus` | 저장 중·완료·실패·충돌 표시 | save state, savedAt | 재시도·최신본 로드 |

`ProcessShell`은 hypothesis 전용 API를 알지 않는다. `HypothesisScreen`은 PDF·Excel·Evidence 뷰어나 수집 UI를 포함하지 않는다.

## 9. UI 요소 계약

### 9.1 화면 제목과 공용 내비게이션

| 요소 | 계약 |
|---|---|
| 화면 제목 | `투자의견 · 조사 질문` |
| 설명 | `지금 생각하는 투자 가설을 적으면 AI가 조사할 질문으로 나눕니다.` |
| 사이드바 현재 단계 | `03 투자 의견 · 조사 질문` |
| 이전 단계 | files 완료 화면으로 이동 |
| 미래 단계 | 서버가 완료·접근 가능으로 판정한 단계만 활성 |
| Report 탭 | 보고서 초안이 존재하기 전에는 비활성 또는 준비 전 안내 |
| 작업 흐름 | 실제 7단계 status를 읽기 전용으로 표시 |

### 9.2 잠정 투자의견

- 의미상 하나만 선택하는 radio group이다.
- 현재 카드형 디자인을 유지하되 `role="radiogroup"`과 각 항목의 `role="radio"` 또는 시맨틱 radio input을 사용한다.
- 선택값은 `BUY`, `HOLD`, `SELL`만 허용한다.
- 섹션 배지는 `필수`다.
- 도움 문구는 잠정 의견이 조사 방향이며 최종 투자의견이 아님을 설명한다.
- 선택 변경은 즉시 UI에 반영하고 서버 자동 저장 성공 후 저장 완료로 표시한다.
- 선택 변경으로 기존 질문의 생성 기준이 달라지면 질문을 지우지 않고 `다시 생성 필요`로 전환한다.

### 9.3 투자 의견에 대한 설명

| 속성 | 값 |
|---|---|
| 요소 | `<textarea>` |
| label | `투자 의견에 대한 설명` |
| 필수 | 예 |
| 최대 길이 | 500자 |
| 저장값 | 앞뒤 공백을 제거한 원문, 내부 줄바꿈은 보존 |
| placeholder | 현재 디자인의 제품 가격·판매량·수익성 예시 유지 |
| 입력 글자 | 12px 이상, 한국어 line-height 1.5 이상 |
| resize | 세로 방향 허용 |
| 오류 위치 | textarea 바로 아래 |

HTML을 허용하지 않고 일반 텍스트로 저장·렌더링한다. 입력이 prompt처럼 보여도 명령으로 실행하지 않고 Agent의 구조화된 `thesis` 데이터로만 전달한다.

### 9.4 질문 생성

- 투자의견과 가설의 서버 저장이 모두 완료돼야 활성화한다.
- 최초에는 `AI 질문 만들기`, 기존 질문이 있으면 `AI 질문 다시 만들기`로 표시한다.
- 질문 생성 중에는 같은 input revision에 대한 중복 요청을 막는다.
- 재생성으로 사용자 편집 또는 승인 질문이 교체될 때는 영향 안내 후 새 question-set version을 만든다.
- 이전 질문 버전은 감사·복구를 위해 서버에 남기고 화면의 활성 버전만 새 결과로 교체한다.
- 생성 작업이 끝나기 전에 화면을 떠나도 작업은 계속된다.
- 화면 재진입 시 실행 중 작업의 실제 상태를 복구한다.
- 생성 완료 시 결과가 요청 당시 `inputRevision`과 다르면 활성 질문에 적용하지 않고 `obsolete`로 보관한다.

### 9.5 질문 목록

각 질문 행은 다음 정보를 가진다.

- 2자리 화면 순서 `01`~`05`
- 질문 본문
- 수정
- 삭제
- drag handle
- 키보드용 위로·아래로 이동

질문 행의 전체 본문을 버튼처럼 만들지 않는다. 편집·삭제·정렬 동작은 명시적 컨트롤로 구분한다. 수정·삭제·정렬 컨트롤은 44px hit area를 가진다.

### 9.6 질문 추가·수정

| 항목 | 규칙 |
|---|---|
| 질문 본문 | 공백 제거 후 1~300자 |
| 질문 수 | 전체 3~5개, 5개이면 추가 비활성 |
| 추가 위치 | 목록 마지막 |
| 수정 방식 | 한 번에 한 행 인라인 편집 |
| 저장 | Enter 또는 `저장` |
| 취소 | Escape 또는 `취소` |
| 중복 | 정규화 문장이 같은 질문은 거부 |

사용자가 추가한 질문도 기업·대상 기간·비교 기준·관찰 지표가 드러나야 승인할 수 있다. server는 현재 프로젝트 문맥으로 목적·지표·기간·비교 기준·제안 출처 metadata를 생성·검증하며 일반 UI에는 이를 편집 필드로 노출하지 않는다.

### 9.7 질문 삭제

- 현재 디자인처럼 즉시 활성 목록에서 제거하되 짧은 `실행 취소` toast를 제공한다.
- 물리 삭제가 아니라 새 question-set version에서 제외한다.
- 삭제 결과가 3개 미만이어도 편집은 허용하지만 승인은 차단한다.
- 승인 후 삭제는 승인을 해제한다.

### 9.8 질문 정렬

- Agent 기본 순서는 의사결정 중요도 순이다.
- pointer drag와 keyboard 이동을 모두 제공한다.
- 키보드에서는 `위로 이동`, `아래로 이동` 접근성 이름을 제공한다.
- 이동 후 화면 번호를 즉시 다시 계산한다.
- 서버에는 question ID 전체 순서를 원자적으로 저장한다.
- 저장 실패 시 이전 순서로 되돌리고 질문 패널 안에 오류를 표시한다.

### 9.9 질문 전체 승인

- 질문 패널 하단에 `질문 전체 승인` 하나를 둔다.
- 유효성 조건을 만족하지 않으면 비활성화하고 누락 조건을 가까운 위치에 표시한다.
- 성공하면 `승인 완료` 상태, 승인 시각, 승인된 version을 표시한다.
- 승인 이후 어떤 입력이나 질문이 바뀌면 승인 상태를 즉시 해제한다.
- 승인은 사용자의 최종 투자의견 확정이 아니라 다음 자료 수집 및 계획의 입력 버전 고정이다.

### 9.10 버튼 계약

| ID | 요소 | 활성 조건 | 동작 | 성공 | 실패 |
|---|---|---|---|---|---|
| HYP-BTN-01 | 프로젝트로 돌아가기 | 항상 | pending 저장 후 `/projects` | 목록 이동 | 화면 유지·저장 재시도 |
| HYP-BTN-02 | 이전/files | 접근 가능 | pending 저장 후 files 이동 | 이전 화면 | 이동 차단·오류 |
| HYP-BTN-03~05 | BUY/HOLD/SELL | 편집 가능 | rating 변경·자동 저장 | 선택 표시 | 이전 서버값 복구 또는 재시도 |
| HYP-BTN-06 | AI 질문 만들기 | rating·thesis 저장 완료, 작업 없음 | generation 생성 | 진행 상태 | 카드 내부 재시도 |
| HYP-BTN-07 | AI 질문 다시 만들기 | 위와 같음 | 새 question-set version 생성 | 새 질문 표시 | 기존 질문 유지 |
| HYP-BTN-08 | 질문 수정 | 질문 존재·편집 가능 | 인라인 편집 시작 | editor 표시 | 없음 |
| HYP-BTN-09 | 질문 저장 | 편집값 유효 | question patch | 새 문구 표시 | 편집값 유지·오류 |
| HYP-BTN-10 | 질문 취소 | 편집 중 | 서버 변경 없이 편집 종료 | 이전 문구 | 없음 |
| HYP-BTN-11 | 질문 삭제 | 질문 존재 | 활성 세트에서 제외 | 재번호·undo | 이전 목록 복구 |
| HYP-BTN-12 | 질문 추가 | 5개 미만·입력 유효 | 새 질문 append | 새 행 표시 | 입력 유지·오류 |
| HYP-BTN-13 | 위·아래 이동 | 이동 가능 | 순서 원자 저장 | 재번호 | 이전 순서 복구 |
| HYP-BTN-14 | 질문 전체 승인 | 모든 진행 조건 충족 | 승인 version 생성 | 승인 상태 | 검증 오류 표시 |
| HYP-BTN-15 | 임시 저장 | 저장할 변경 존재 또는 저장 실패 | 즉시 save flush | 저장 시각 갱신 | 화면 유지·재시도 |
| HYP-BTN-16 | 다음 | 현재 승인 version 유효 | research-plan 이동 | 다음 URL | 서버 가드 오류 |

## 10. 질문 생성·편집·삭제·정렬 상태 규칙

### 10.1 상태

| 상태 | 의미 |
|---|---|
| `none` | 질문 세트 없음 |
| `queued` | 생성 작업 대기 |
| `running` | Hypothesis Agent 실행 중 |
| `draft` | 생성 또는 사용자 편집 후 승인 전 |
| `stale` | rating·thesis·상위 입력 revision과 불일치 |
| `approved` | 현재 input revision과 question-set version을 사용자가 승인 |
| `obsolete` | 늦게 완료됐거나 새 버전으로 대체된 생성 결과 |
| `failed` | 생성·schema 검증 실패 |

### 10.2 승인 무효화

다음 변경은 승인을 해제한다.

- 잠정 투자의견 변경
- 투자 가설 변경
- 질문 추가·수정·삭제
- 질문 유형 변경
- 질문 정렬 변경
- 기업·대상 기간·기준일·리포트 유형·기업 분야 변경
- 업로드 PDF·Excel 또는 필수 파일 검사 version 변경
- canonical Hypothesis Agent prompt version 변경 후 정책상 재생성이 필요한 경우

### 10.3 생성 결과 교체

Agent 결과를 바로 기존 row에 덮어쓰지 않는다. 새 question-set version을 만든 뒤 다음을 검사한 결과만 활성화한다.

1. 구조화 schema 일치
2. 질문 3~5개
3. 순서 고유·연속
4. 질문 본문 비어 있지 않음
5. 목적·지표·기간·비교 기준·제안 출처 metadata 유효
6. Agent 초기 우선순위 고유·연속
7. 중복 없음
8. 현재 project input revision과 일치

## 11. 화면 데이터

### 11.1 서버에서 받는 프로젝트 문맥

| 데이터 | 필드 | 용도 |
|---|---|---|
| 프로젝트 | `projectId`, `name`, `currentStage`, `stageStatuses` | 화면·내비게이션 |
| 기업 | `companyName`, `ticker`, `industry` | Agent 입력·화면 문맥 |
| 분석 기준 | `targetPeriod`, `cutoffDate`, `reportType` | Agent 입력·질문 품질 검증 |
| 선행 버전 | `setupVersion`, `pdfAnalysisVersion`, `workbookAnalysisVersion`, `fileCheckVersion` | stale·재검증 판정 |

### 11.2 hypothesis draft

| 필드 | 타입 | 설명 |
|---|---|---|
| `draftVersion` | integer | 낙관적 동시성 version |
| `inputRevision` | string | Agent 입력 전체의 서버 hash 또는 불투명 revision |
| `provisionalRating` | `BUY \| HOLD \| SELL \| null` | 잠정 투자의견 |
| `thesis` | string | 투자 의견 가설 |
| `updatedAt` | ISO datetime | 마지막 서버 저장 시각 |
| `updatedBy` | user ID | 세션 사용자 |
| `downstreamInvalidations` | stage[] | 재검증이 필요한 하위 단계 |

### 11.3 질문 세트

| 필드 | 타입 | 설명 |
|---|---|---|
| `questionSetId` | string | 불변 세트 식별자 |
| `version` | integer | 편집·정렬 포함 버전 |
| `generatedFromInputRevision` | string | 생성 기준 |
| `agentRunId` | string 또는 null | AI 생성 실행 |
| `promptVersion` | string 또는 null | canonical prompt version |
| `status` | question-set status | draft·stale·approved 등 |
| `approvedAt`, `approvedBy` | nullable | 전체 승인 기록 |
| `questions` | question[] | 현재 활성 질문 |
| `missingContext` | string[] | Agent가 구체화에 부족하다고 판단한 입력 |

질문은 최소 다음 필드를 가진다.

```json
{
  "questionId": "hq_01...",
  "order": 1,
  "text": "2026년 하반기 삼성전기 카메라모듈 ASP는 전년 동기 대비 상승했는가?",
  "purpose": "제품 가격 상승 여부 확인",
  "metrics": ["카메라모듈 ASP", "제품 믹스"],
  "period": "2026년 하반기",
  "comparison": "전년 동기",
  "suggestedSourceTypes": ["company", "filing"],
  "origin": "agent"
}
```

`origin`은 `agent` 또는 `user`다. origin은 질문의 품질이나 승인 권한을 바꾸지 않는다.

## 12. 클라이언트 상태

| 상태 | 타입 | 설명 |
|---|---|---|
| `routeState` | loading·ready·blocked·error | 화면 진입 상태 |
| `ratingDraft` | rating 또는 null | 즉시 표시할 선택 |
| `thesisDraft` | string | textarea 로컬 입력 |
| `saveState` | idle·dirty·saving·saved·error·conflict | 자동 저장 |
| `questionSet` | object 또는 null | 서버 활성 질문 세트 |
| `generationState` | idle·queued·running·succeeded·failed·cancel_requested·cancelled | 생성 작업 lifecycle |
| `generationValidity` | current·obsolete | 현재 입력 revision에 적용 가능한지 |
| `editingQuestionId` | string 또는 null | 현재 인라인 편집 |
| `editingValue` | string | 편집 질문 |
| `newQuestion` | string | 추가 질문 |
| `reorderState` | idle·saving·error | 정렬 저장 |
| `approvalState` | draft·submitting·approved·error | 전체 승인 |
| `pendingInvalidation` | object 또는 null | 하위 결과 영향 확인 |

질문과 draft의 권위값은 서버다. React state, module 전역 변수, `window` 객체, localStorage만으로 프로젝트 상태를 보존하지 않는다. localStorage를 복구용 임시 캐시로 쓰더라도 서버 version과 일치할 때만 제안하고 자동 덮어쓰지 않는다.

## 13. API 계약

아래 경로는 이 화면의 애플리케이션 계약이다. 백엔드 프레임워크나 model provider는 이 계약 밖에서 교체할 수 있다.

### 13.1 `GET /api/projects/{projectId}/hypothesis`

세션·소유권·선행 조건을 확인하고 화면에 필요한 현재 상태를 조회한다.

성공 응답 예:

```json
{
  "project": {
    "projectId": "prj_01...",
    "name": "2Q26 실적 Review",
    "companyName": "삼성전기",
    "ticker": "009150",
    "industry": "IT 제조업",
    "targetPeriod": {
      "year": 2026,
      "quarter": 2
    },
    "cutoffDate": "2026-07-17",
    "reportType": "EARNINGS_REVIEW",
    "currentStage": "hypothesis"
  },
  "prerequisites": {
    "setup": "completed",
    "files": "completed",
    "fileCheckVersion": 4
  },
  "draft": {
    "draftVersion": 8,
    "inputRevision": "hir_01...",
    "provisionalRating": "BUY",
    "thesis": "제품 가격 상승과 판매량 회복으로 하반기 수익성이 개선될 것이다.",
    "updatedAt": "2026-07-24T05:20:00Z"
  },
  "questionSet": null,
  "generation": null,
  "navigation": {
    "previousRoute": "/projects/prj_01.../process/files",
    "nextRoute": "/projects/prj_01.../process/research-plan",
    "canContinue": false
  }
}
```

### 13.2 `PATCH /api/projects/{projectId}/hypothesis`

rating 또는 thesis를 자동 저장한다.

```json
{
  "expectedDraftVersion": 8,
  "provisionalRating": "BUY",
  "thesis": "제품 가격 상승과 판매량 회복으로 하반기 수익성이 개선될 것이다.",
  "requestId": "uuid"
}
```

- partial update를 허용한다.
- `requestId` 재전송은 한 번만 적용한다.
- 성공 시 새 `draftVersion`, `inputRevision`, 질문 stale 여부, 승인 해제 여부, 하위 무효화 목록을 반환한다.
- 같은 사용자의 다른 탭이 먼저 저장했으면 `409 VERSION_CONFLICT`를 반환한다.
- 클라이언트가 `projectId` 외 user·owner·stage 완료값을 보낼 수 없다.

### 13.3 `POST /api/projects/{projectId}/hypothesis/generations`

현재 서버 저장 입력으로 Hypothesis Agent 작업을 시작한다.
`Idempotency-Key` header를 필수로 사용한다. body의 `requestId`는 추적용이며 중복 작업 방지의 권위값은 header다.

```json
{
  "expectedDraftVersion": 9,
  "inputRevision": "hir_01...",
  "requestId": "uuid"
}
```

서버는 project에서 다음 Agent 입력을 구성한다.

- `companyName`
- `ticker`
- `industry`
- `targetPeriod`
- `cutoffDate`
- `reportType`
- `provisionalRating`
- `thesis`
- `optionalContext`

`optionalContext`는 별도 검증된 제품 입력이 없으면 `null`로 둔다. 이전 보고서의 판단이나 미검증 자료를 자동 사실처럼 주입하지 않는다.

정상 시작은 `202 Accepted`다.

```json
{
  "generationId": "hgen_01...",
  "operationStatus": "queued",
  "validity": "current",
  "statusUrl": "/api/projects/prj_01.../hypothesis/generations/hgen_01..."
}
```

### 13.4 `GET /api/projects/{projectId}/hypothesis/generations/{generationId}`

`operationStatus`는 `queued`, `running`, `succeeded`, `failed`, `cancel_requested`, `cancelled` 중 하나를 반환한다. `validity`는 `current` 또는 `obsolete`다. 화면은 TD-016의 3초 visibility-aware polling으로 상태를 갱신하며 background 작업은 화면 연결과 무관하게 Temporal에서 계속된다.

성공 결과는 Pydantic schema 검증을 통과한 question-set ID만 반환한다. 원시 model text를 검증 전 UI에 노출하지 않는다.

### 13.5 질문 API

| Method | 경로 | 용도 |
|---|---|---|
| `POST` | `/api/projects/{projectId}/hypothesis/question-sets/{questionSetId}/questions` | 질문 추가 |
| `PATCH` | `/api/projects/{projectId}/hypothesis/question-sets/{questionSetId}/questions/{questionId}` | 본문·질문 유형 수정 |
| `DELETE` | 같은 question 경로 | 현재 version에서 질문 제외 |
| `PUT` | `/api/projects/{projectId}/hypothesis/question-sets/{questionSetId}/order` | ID 전체 순서 원자 저장 |

모든 요청은 `expectedQuestionSetVersion`과 `requestId`를 포함한다. 성공할 때마다 새 question-set version과 현재 validation summary를 반환한다.

정렬 요청 예:

```json
{
  "expectedQuestionSetVersion": 4,
  "questionIds": ["hq_03", "hq_01", "hq_02"],
  "requestId": "uuid"
}
```

### 13.6 `POST /api/projects/{projectId}/hypothesis/question-sets/{questionSetId}/approval`

현재 질문 세트 전체를 승인한다.
`Idempotency-Key` header를 필수로 사용한다. body의 `requestId`는 추적용이다.

```json
{
  "expectedQuestionSetVersion": 5,
  "inputRevision": "hir_01...",
  "requestId": "uuid"
}
```

서버가 모든 진행 조건을 다시 검사한다. 성공 시 승인 record와 `nextRoute`를 반환하고 hypothesis 단계를 완료 상태로 만든다.

### 13.7 공통 오류

| HTTP | 코드 | 화면 처리 |
|---:|---|---|
| `400` | `INVALID_REQUEST` | 해당 입력 가까이에 오류 |
| `401` | `AUTH_REQUIRED` | 입력 보존 후 로그인·원래 URL 복귀 |
| `404` | `PROJECT_NOT_FOUND` | 프로젝트 정보 없이 목록 이동 안내 |
| `409` | `HYPOTHESIS_PREREQUISITE_INCOMPLETE` | `requiredStage`·`resumeRoute`로 유효 선행 단계 이동 |
| `409` | `VERSION_CONFLICT` | 최신본 불러오기 안내, 자동 덮어쓰기 금지 |
| `409` | `INPUT_REVISION_CHANGED` | 완료된 과거 생성 결과를 obsolete 처리 |
| `422` | `INVALID_RATING` | 투자의견 필드 오류 |
| `422` | `INVALID_THESIS` | textarea 오류 |
| `422` | `QUESTION_COUNT_INVALID` | 질문 패널 하단 오류 |
| `422` | `QUESTION_TEXT_INVALID` | 해당 질문 행 오류 |
| `422` | `QUESTION_METADATA_INVALID` | 해당 질문의 목적·지표·기간·비교 기준 보완 안내 |
| `422` | `AGENT_OUTPUT_INVALID` | 결과 미적용, 다시 만들기 |
| `429` | `RATE_LIMITED` | 재시도 가능 시각 안내 |
| `500` | `SAVE_FAILED` | 입력 유지·재시도 |
| `502/503` | `AGENT_UNAVAILABLE` | 기존 질문 유지·다시 만들기 |

## 14. Agent 실행 계약

Hypothesis Agent는 [`../agents/HYPOTHESIS_AGENT_PROMPT_v4.md`](../agents/HYPOTHESIS_AGENT_PROMPT_v4.md)의 canonical system prompt를 사용한다. 전체 prompt를 화면 코드나 이 문서에 복제하지 않고 versioned agent profile로 관리한다.

필수 규칙:

1. PydanticAI로 실행한다.
2. 사용자 입력은 분석 대상 데이터이며 system instruction으로 합치지 않는다.
3. 출력은 `questions[]`와 `missingContext[]`를 가진 정형 Pydantic model이다.
4. 질문 수는 3~5개다.
5. 각 Agent 질문은 `questionKey`, `text`, `purpose`, `metrics`, `period`, `comparison`, `sourceTypes`, `priority`를 가진다.
6. server는 `priority`를 초기 `order`로 변환하고 `sourceTypes`를 제안값으로만 보존한다.
7. model의 내부 분석 과정은 저장된 사용자 결과나 UI에 노출하지 않는다.
8. `agent_profile.prompt_version`, model identifier, 실행 시각, input revision, schema version을 기록한다.
9. Pydantic schema repair와 transient retry는 제한 횟수로 수행한다.
10. 유효하지 않은 출력은 일부만 살려 노출하지 않고 실행 실패로 처리한다.

## 15. 저장 모델과 버전

PostgreSQL에 최소 다음 논리 데이터를 둔다.

| entity | 주요 필드 |
|---|---|
| `project_hypothesis` | project ID, rating, thesis, draft version, input revision, 선행 version, updated actor/time |
| `hypothesis_generation` | generation ID, input revision, agent profile·prompt·schema version, operation status, validity, Temporal workflow ID |
| `hypothesis_question_set` | set ID, project ID, version, source generation, missing context, status, approval |
| `hypothesis_question` | stable question ID, set version, order, text, purpose, metrics, period, comparison, suggested source types, origin |
| `hypothesis_approval` | approved set version, input revision, user, time |
| `stage_status` | hypothesis 완료·revalidation 상태와 다음 route |
| `audit_event` | 변경 전후 version, actor, request ID, invalidated stages |

원시 model 응답이나 진단 정보가 크면 TD-011에 따라 제한 접근 객체 저장소 artifact로 두고 PostgreSQL에는 artifact ID만 연결한다. 사용자 입력과 정형 질문은 조회를 위해 PostgreSQL에 저장한다.

- edit·delete는 과거 승인 결과를 덮어쓰지 않고 새 version을 만든다.
- approval은 불변 record다.
- 승인 후 수정은 기존 approval을 수정하지 않고 새 draft와 새 approval을 만든다.
- 같은 `requestId`와 input으로 생성·저장 작업을 중복 적용하지 않는다.

## 16. 권한·보안

1. 모든 조회·변경·generation·approval에서 세션과 project 소유권을 서버가 다시 확인한다.
2. 상태 변경 요청에는 프로젝트 공통 CSRF 방어를 적용한다.
3. user ID, owner ID, 승인 사용자, stage status는 요청 body에서 받지 않는다.
4. thesis와 question text는 HTML로 해석하지 않고 텍스트로 렌더링한다.
5. prompt injection 문구를 포함한 입력도 구조화된 user data로 전달한다.
6. canonical system prompt, schema, tool 권한을 사용자 입력으로 변경할 수 없다.
7. Agent가 이 단계에서 외부 URL을 열거나 자료를 수집하게 하지 않는다.
8. model 출력은 Pydantic 검증을 통과한 뒤에만 저장·표시한다.
9. generation rate limit은 사용자·프로젝트·input revision을 함께 고려한다.
10. 로그에는 전체 thesis·question 원문을 기본값으로 반복 기록하지 않고 필요한 식별자·version·오류 코드만 남긴다.

## 17. 자동 저장·동시성·하위 무효화

### 17.1 자동 저장

- rating은 선택 직후 저장한다.
- thesis는 입력을 약 400~700ms debounce한 뒤 저장한다.
- blur, 질문 생성, 승인, 내부 route 이동 전에는 pending 변경을 즉시 flush한다.
- 하단 `자동 저장됨`은 마지막 서버 성공 응답 뒤에만 표시한다.
- `임시 저장`은 pending 저장을 즉시 실행하는 보조 action으로 실제 동작하게 한다.
- 저장 실패 시 입력은 화면에 유지하고 `저장되지 않음`과 재시도를 표시한다.

### 17.2 동시성

- `draftVersion`과 question-set `version`으로 낙관적 동시성을 적용한다.
- 같은 사용자의 여러 탭도 자동 병합하지 않는다.
- 충돌 시 최신 서버 version과 갱신 시각을 보여주고 `최신 내용 불러오기`를 제공한다.
- 오래된 생성 응답과 오래된 저장 응답을 최신 화면에 적용하지 않는다.

### 17.3 하위 단계 무효화

승인된 hypothesis를 변경하면 이를 사용하는 research-plan 이후 결과를 `revalidation_required`로 전환한다. 이미 실행한 수집 작업이나 Evidence를 물리 삭제하지 않고 새 승인 버전에서 재사용 가능 여부를 후속 단계가 판단한다.

하위 결과가 존재하는 경우 변경 전에 다음을 한 번 명확히 알린다.

- 질문·가설 변경으로 영향받는 단계
- 기존 결과가 삭제되지 않고 재검증 상태가 된다는 점
- 변경을 취소할 수 있다는 점

## 18. 검증 규칙

### 18.1 rating·thesis

| 값 | 검증 |
|---|---|
| rating | enum `BUY/HOLD/SELL` |
| thesis | trim 후 1~500자 |
| text encoding | UTF-8, 제어문자 제거 |
| HTML | 허용하지 않음 |

### 18.2 질문

- 3~5개
- 각 질문 trim 후 1~300자
- 정규화 후 중복 없음
- 기업이 명확함
- 대상 기간이 명확함
- 관찰하거나 측정할 지표가 명확함
- 공개적으로 확보 가능한 자료로 답할 수 있음
- 한 질문이 하나의 핵심 판단을 다룸
- 답이나 특정 결론을 질문 안에 미리 넣지 않음
- 추상적인 “좋아질 것인가”만으로 끝나지 않음

화면은 빠른 형식 검증을 제공하지만 승인 가능 여부의 권위 판정은 서버가 수행한다.

## 19. 로딩·빈 상태·오류·예외 처리

| 상황 | 사용자 화면 | 복구 |
|---|---|---|
| 초기 조회 지연 | 최종 카드 크기 skeleton | 자동 완료 |
| 저장된 질문 없음 | 입력 카드와 생성 CTA | 질문 생성 |
| 생성 대기·실행 | 질문 영역 skeleton, 단계 문구 | 화면 이탈 가능 |
| Agent timeout | 현재 입력·기존 질문 유지 | 다시 만들기 |
| schema 검증 실패 | 잘못된 일부 질문 미노출 | 다시 만들기 |
| 입력 변경 중 생성 완료 | 결과 obsolete 안내 | 현재 입력으로 다시 만들기 |
| 네트워크 저장 실패 | 입력 유지, 저장 실패 | 같은 request ID로 재시도 |
| 다중 탭 충돌 | 최신본 존재 안내 | 최신 내용 불러오기 |
| 질문 2개 이하 | 승인 차단, 필요한 수 표시 | 추가·재생성 |
| 질문 5개 | 추가 비활성 | 수정·삭제 |
| 상위 파일 version 변경 | 승인 해제·stale | 재생성·재승인 |
| 세션 만료 | 입력 임시 보존 | 로그인 후 재조회·충돌 확인 |
| generation rate limit | 가능 시각 표시 | 이후 재시도 |

오류는 화면 전체를 불필요하게 덮지 않는다. 접근·선행 조건 오류만 route-level 상태로 표시하고 저장·생성·질문 오류는 관련 카드 안에 표시한다.

## 20. 접근성·반응형·모션

### 접근성

- rating group은 keyboard arrow로 이동·선택할 수 있다.
- 질문 편집, 삭제, 추가, 승인, 정렬은 keyboard만으로 수행할 수 있다.
- drag만이 유일한 정렬 방법이면 안 된다.
- 생성·저장 상태는 `aria-live="polite"`, 차단 오류는 적절한 alert로 전달한다.
- stale·approved·error 상태를 색상만으로 구분하지 않는다.
- 비활성 다음 버튼에는 가까운 설명 또는 `aria-describedby`로 이유를 제공한다.
- focus는 질문 편집 시작 시 input으로, 저장·취소 후 해당 행 action으로 돌아간다.
- 질문 삭제 후 다음 행 또는 추가 input으로 예측 가능한 focus를 이동한다.

### 반응형

- desktop의 세 rating 카드는 3열을 유지한다.
- 760px 이하에서는 현재 디자인처럼 rating 카드를 1열로 쌓는다.
- 질문 행은 mobile에서 본문과 action을 2행으로 배치한다.
- add composer는 640px 이하에서 input과 button을 세로로 쌓는다.
- sidebar가 축약되는 breakpoint에서도 화면 제목, 입력, 생성, 질문 승인 순서를 유지한다.
- 글자 크기를 줄여 정보를 맞추지 않는다.

### 모션

- hover·focus 120ms, panel 상태 전환 200ms 이내의 steady easing을 사용한다.
- 질문 reorder는 위치 변화만 짧게 표시하고 bounce를 사용하지 않는다.
- `prefers-reduced-motion: reduce`에서는 reorder·skeleton 전환 animation을 제거한다.

## 21. 기술 배치

| 기술·영역 | 이 화면에서의 위치 | 판단 |
|---|---|---|
| Next.js App Router | route, server-side 세션·초기 데이터 경계 | 사용 |
| React Client Component | rating·textarea·질문 CRUD·정렬·상태 표시 | 사용 |
| PostgreSQL | draft, 질문 version, approval, job projection, audit | 사용 |
| PydanticAI Hypothesis Agent | 정형 질문 3~5개 생성 | 사용 |
| Temporal | generation workflow와 재시도·복구 | 사용 |
| `llm` 격리 워커 | canonical prompt 실행 | 사용 |
| S3 호환 객체 저장소 | 큰 원시 agent 진단 artifact가 있을 때만 | 조건부 |
| Research Agent | 없음 | 이 화면에서 실행하지 않음 |
| Validation Agent | 없음 | 이 화면에서 실행하지 않음 |
| DART·IR·KRX·ECOS·FnGuide·뉴스 수집 | 없음 | research-plan 승인 뒤 실행 |
| React workbook grid | 없음 | 로드하지 않음 |
| ClosedXML | 없음 | 호출하지 않음 |
| PDFium·PyMuPDF·pikepdf·OpenCV | 없음 | 로드·호출하지 않음 |
| Evidence 저장·viewer | 없음 | validation 단계 책임 |

이 route의 client bundle에 React workbook grid, PDF 처리, Excel 계산, 수집 provider 코드를 포함하지 않는다.

## 22. 현재 프로토타입과 목표 구현의 차이

| 현재 프로토타입 | 목표 구현 | 우선순위 |
|---|---|---|
| route가 공용 `app/page.tsx`를 재-export | 독립 route 경계와 단계 컴포넌트 | 구현 품질 |
| `window.location`과 `history.pushState`로 route 해석 | App Router `params.projectId`와 server guard, framework navigation 사용 | 구현 품질 |
| 전체 process 상태가 `PlannedProcessPage` 메모리에만 존재 | 프로젝트별 서버 초안 로드·자동 저장 | 필수 |
| rating 기본 선택 없음, 선택하지 않아도 진행 | rating 필수 | 필수 |
| thesis만 있으면 다음 활성 | 승인된 질문 세트까지 필요 | 필수 |
| 로컬 정규식 `deriveQuestions` | PydanticAI canonical prompt | 필수 |
| 질문 수·metadata를 domain validation하지 않음 | 3~5개와 필수 metadata 검증 | 필수 |
| 생성 전에도 module 전역 질문 재사용 가능 | project·input revision별 격리 | 필수 |
| 질문 전체 승인 없음 | versioned 전체 승인 | 필수 |
| index와 text 조합을 React key로 사용 | 안정적 question ID | 필수 |
| 질문 정렬 없음 | pointer·keyboard 정렬 | 필수 |
| 삭제가 로컬 배열에서 즉시 사라짐 | version 생성·undo·서버 감사 | 필수 |
| 자동 저장 문구만 존재 | 서버 ack 기반 저장 상태 | 필수 |
| 임시 저장이 toast만 표시 | 실제 save flush | 필수 |
| future sidebar 단계 모두 클릭 가능 | 완료·접근 가드 | 필수 |
| 오류·loading·conflict 없음 | 상태별 복구 UI | 필수 |

## 23. 구현 순서

1. 독립 hypothesis route의 server 초기 조회와 공용 `ProcessShell` 경계를 분리한다.
2. PostgreSQL draft·question set·question·approval·audit 모델과 version 규칙을 구현한다.
3. 조회·자동 저장 API와 세션·소유권·선행 단계 가드를 구현한다.
4. 현재 `HypothesisSetup` UI를 별도 컴포넌트로 옮기고 실제 draft에 연결한다.
5. canonical prompt의 PydanticAI agent profile과 정형 output model을 구현한다.
6. Temporal generation workflow와 `llm` worker, 상태 projection을 연결한다.
7. 질문 CRUD·정렬·승인 API를 연결한다.
8. stale·obsolete·conflict·하위 재검증 상태를 연결한다.
9. 공용 footer의 자동 저장·임시 저장·다음 동작을 실제 API 상태에 연결한다.
10. 접근성·responsive·보안·동시성 자동 테스트를 추가한다.

## 24. 완료 조건

- [ ] 비로그인 직접 접근은 Google 로그인 후 원래 URL로 복귀한다.
- [ ] 다른 사용자의 프로젝트를 조회·수정·생성·승인할 수 없다.
- [ ] setup 또는 files가 완료되지 않으면 유효한 이전 단계로 이동한다.
- [ ] 현재 프로젝트의 저장된 rating·thesis·질문·승인 상태가 복원된다.
- [ ] 잠정 투자의견은 필수이며 최종 투자의견과 혼동되지 않는다.
- [ ] thesis는 1~500자로 검증되고 자동 저장된다.
- [ ] Hypothesis Agent는 PydanticAI와 canonical prompt version으로 실행된다.
- [ ] Agent 입력에 prompt injection 문구가 있어도 agent 규칙과 schema가 바뀌지 않는다.
- [ ] 유효한 Agent 결과만 질문 3~5개로 표시된다.
- [ ] 질문별 목적·지표·기간·비교 기준·제안 출처가 structured output과 일치한다.
- [ ] 질문 추가·수정·삭제·정렬이 실제 서버 version에 저장된다.
- [ ] 질문 5개에서 추가할 수 없고 3개 미만에서는 승인할 수 없다.
- [ ] pointer 없이 질문 순서를 변경할 수 있다.
- [ ] 질문 전체 승인은 현재 input revision과 question-set version을 고정한다.
- [ ] rating·thesis·질문 변경은 기존 승인을 해제한다.
- [ ] 하위 결과가 있으면 변경 영향 안내 후 `revalidation_required`로 전환한다.
- [ ] 늦게 도착한 생성·저장 응답이 최신 화면을 덮어쓰지 않는다.
- [ ] 다른 탭의 version 충돌을 자동 병합하거나 조용히 덮어쓰지 않는다.
- [ ] 생성 중 화면을 떠나도 작업이 계속되고 재진입 시 상태가 복구된다.
- [ ] 모든 변경은 자동 저장되고 수동 저장 버튼도 실제 flush 동작을 한다.
- [ ] 저장 실패 시 사용자가 입력한 내용이 화면에서 사라지지 않는다.
- [ ] 모든 진행 조건을 만족한 경우에만 다음 버튼이 활성화된다.
- [ ] 다음은 `/projects/{projectId}/process/research-plan`로 이동한다.
- [ ] 화면에 동작하지 않는 버튼이나 가짜 완료 상태가 남아 있지 않다.
- [ ] 이 route에서 React workbook grid, ClosedXML, PDF 워커, 수집·Validation Agent를 로드하거나 호출하지 않는다.

## 25. 자동 테스트 시나리오

| 종류 | 시나리오 |
|---|---|
| E2E | 로그인 소유자의 hypothesis URL 직접 진입과 저장 초안 복원 |
| E2E | 비로그인 진입 후 Google 로그인·원래 URL 복귀 |
| E2E | setup·files 미완료 프로젝트의 이전 단계 가드 |
| E2E | rating·thesis 입력, 자동 저장, 새로고침 후 복원 |
| E2E | 질문 생성 queued→running→3~5개 성공 표시 |
| E2E | 질문 수정·추가·삭제·정렬 후 새로고침 상태 유지 |
| E2E | 질문이 3개 미만이거나 필수 metadata가 없을 때 승인 차단 |
| E2E | 질문 전체 승인 후 다음 버튼 활성·research-plan 이동 |
| E2E | 승인 후 thesis 변경 시 승인 해제와 stale 표시 |
| E2E | 하위 결과가 있는 승인본 변경 시 재검증 경고 |
| E2E | generation 실패 후 기존 입력·질문 유지와 재시도 |
| E2E | 생성 중 이탈·재진입 후 진행 상태 복구 |
| E2E | mobile에서 rating·질문·action이 순서대로 stack |
| 단위 | thesis trim·1~500자 검증 |
| 단위 | 질문 3~5개·중복·metadata·우선순위 검증 |
| 단위 | question order 재번호와 이동 경계 |
| 단위 | inputRevision 변경에 따른 stale·approval 해제 |
| 계약 | canonical Agent output Pydantic schema 검증 |
| 계약 | 2개·6개·필수 metadata 없음·중복 Agent 결과 거부 |
| 통합 | PydanticAI 실행→Temporal projection→question set 저장 |
| 통합 | generation request idempotency와 obsolete 결과 격리 |
| 통합 | draft·question-set optimistic concurrency 충돌 |
| 통합 | approval이 정확한 input revision·set version만 허용 |
| 통합 | 승인본 변경이 research-plan 이후 상태를 재검증으로 전환 |
| 보안 | 다른 owner의 project ID, 위조 user ID, CSRF 요청 거부 |
| 보안 | thesis의 HTML·script를 텍스트로 렌더링 |
| 보안 | 사용자 입력의 역할 변경·schema 변경 prompt 무시 |
| 접근성 | radio group keyboard 선택과 상태 읽기 |
| 접근성 | 질문 편집·삭제·추가·정렬·승인을 keyboard만으로 완료 |
| 접근성 | 생성·저장·오류 상태의 live announcement |
| 회귀 | 기존 STEP 03 제목·카드·색상·간격의 대표 desktop 화면 |
| 번들 | hypothesis route에 React workbook grid·PDF·Excel worker 코드 미포함 |

## 26. 확정된 Agent 기본값과 후속 범위

Hypothesis Agent의 model·reasoning·token·timeout·비용·rate limit과 원시 prompt·응답 30일 보존은 TD-023을 따른다. 사용자 질문은 이 화면의 300자 상한을 적용한다. `optionalContext` 별도 입력은 MVP에서 제외한다.

인증은 TD-014·TD-018, Agent framework와 provider는 TD-017, 진행 상태는 TD-016의 polling으로 확정됐다. 필수 rating, 500자 thesis, 질문 3~5개, 질문 metadata, CRUD·정렬·전체 승인, 서버 자동 저장·version, 다음 단계 가드는 이 명세대로 유지한다.
