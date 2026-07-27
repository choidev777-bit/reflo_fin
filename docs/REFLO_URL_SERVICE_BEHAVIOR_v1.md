# REFLO URL별 현재 구현 동작 명세 v1

> 기준일: 2026-07-27
> 기준: `source-react`의 현재 페이지·API·도메인·Worker·테스트 구현
> 용도: 다른 개발 세션이 REFLO의 목적, 단계별 의도, 실제 데이터 계보를 빠르게 복원하기 위한 인수인계 문서

이 문서는 미래 목표가 아니라 **현재 구현된 동작**을 설명한다. `docs/screens/`는 화면 의도와 비교할 때 참고했지만, 충돌하면 실행 코드와 테스트를 기준으로 썼다.

## 1. 서비스 목적

REFLO는 이전 분기 증권사 실적 Review PDF와 분석 Excel을 다음 분기 리서치 초안으로 갱신하는 작업 공간이다.

핵심 입력:

1. 이전 분기 실적 Review PDF
2. 이전 분기 분석 Excel
3. 선택 입력인 현재 분기 IR·잠정실적 PDF
4. 프로젝트 기업, 목표 분기, 기준일, 사용자의 투자의견·가설

핵심 처리:

1. 이전 PDF의 페이지·텍스트·표·차트·스타일을 `Template IR`로 분석한다.
2. Excel의 시트·수식·셀·범위·차트·편집 후보를 분석한다.
3. PDF 의미 슬롯과 Excel/KRX 원천을 `MappingSet`으로 연결한다.
4. 조사 질문을 만들고 공식 자료와 사용자 자료를 수집·검증한다.
5. 승인된 실제값을 원본이 아닌 Excel 복사본에 반영한다.
6. 목표 보고 기간에 맞게 Excel을 롤포워드하고 추정치·PER·목표주가를 계산한다.
7. 승인된 Excel과 근거만 사용해 이전 PDF 구조 위에 새 보고서 초안을 만든다.
8. 검증·승인된 같은 버전에서 PDF와 XLSX를 함께 내보낸다.

서비스의 계산 정본은 LLM 문장이 아니다. **승인된 근거, 승인된 Excel artifact, 승인된 밸류에이션 버전**이다. LLM은 질문·근거 후보·문장·페이지 개요 생성을 보조한다. 공식 수치 선택, Excel 쓰기, 수식 계산, 버전 일치, 완료 차단은 코드가 담당한다.

## 2. URL 흐름과 단계

| 순서 | URL | 내부 stage key | 완료 시 핵심 산출물 |
|---|---|---|---|
| 진입 | `/` | 없음 | 로그인 또는 새 프로젝트 시작 |
| 목록 | `/projects` | 없음 | 프로젝트 생성·검색·재개 |
| STEP 01 | `/projects/:projectId/process/setup` | `setup` | 승인된 프로젝트 설정 버전 |
| STEP 02 | `/projects/:projectId/process/files` | `files` | 확정된 `MappingSet` |
| STEP 03 | `/projects/:projectId/process/hypothesis` | `hypothesis` | 승인된 조사 질문 세트 |
| STEP 04 | `/projects/:projectId/process/research-plan` | `research_plan` | 승인된 수집 계획 및 비동기 조사 작업 |
| STEP 05 | `/projects/:projectId/process/validation` | `validation` | `ValidationApproval`, 검증 값 세트, 검증 Excel |
| STEP 06 | `/projects/:projectId/process/valuation` | `valuation` | 롤포워드된 Excel과 `ValuationApproval` |
| STEP 07 | `/projects/:projectId/process/report-outline` | `report_outline` | 승인된 페이지 개요와 생성된 보고서 초안 |
| 최종 | `/projects/:projectId/report` | 별도 report workflow | 승인 보고서, PDF, XLSX |

페이지 접근은 프로젝트 소유자에게만 허용된다. 선행 단계가 막혔거나 재검증이 필요하면 서버가 해당 프로젝트의 재개 URL로 이동시킨다. `/report`는 실제 보고서가 생성된 뒤에만 열린다.

## 3. 실제 버전 계보

```text
Setup
  └─ Source PDF + Source Excel + optional Current IR + KRX close
       └─ Template IR + Workbook Analysis + MappingSet                 (STEP 02)
            ├─ Approved Question Set                                  (STEP 03)
            └─ Approved Research Plan                                 (STEP 04)
                 └─ Evidence + Validated Value Set
                      └─ Validated Workbook                           (STEP 05)
                           └─ Rolled-forward Valuation Workbook
                                └─ Valuation Approval                 (STEP 06)
                                     └─ Outline Approval
                                          └─ Materialized Report      (STEP 07)
                                               └─ Report Validation
                                                    └─ PDF + XLSX
```

원본 파일은 덮어쓰지 않는다. 각 주요 산출물은 resource version, artifact hash, 입력 fingerprint, 상·하위 dependency를 가진다. 상위 파일·설정·매핑·검증 값·Excel·밸류에이션이 바뀌면 관련 하위 승인과 검증은 `revalidation_required` 또는 stale 상태가 된다.

### STEP 02 산출물이 후반 단계에서 쓰이는 방식

| STEP 02 산출물 | 후반 소비자 | 용도 |
|---|---|---|
| `Template IR` | STEP 07, 최종 보고서 | 원본 PDF 페이지 순서, 좌표, 텍스트·시각 블록, 스타일 참조 |
| Workbook Analysis | STEP 03~06 | 시트·범위 맥락, 실제값 입력 위치, 편집 가능 셀, 수식·출력 위치 |
| `MappingSet` | STEP 04~최종 | PDF 의미 슬롯과 Excel/KRX 물리 주소 연결 |
| Source Excel version | STEP 05 | 승인 값을 반영할 불변 원본 |
| KRX 기준일 종가 snapshot | STEP 06 | 현재주가, 상승여력, 밸류에이션 승인 |
| optional Current IR analysis | STEP 03~05 | 현재 분기 공식 사실, 사업부·회사 전망 근거 |

`MappingSet`은 단순 “PDF 문구 ↔ 셀 하나” 목록이 아니다. 안정적인 slot ID, 의미 metric, 물리 시트·주소, 표·차트 topology, 후보 점수·사유를 저장한다. 후반 단계는 이 ID를 통해 같은 데이터의 출처와 목적지를 추적한다.

### 실행 경계

- Next.js App Router가 화면과 `/api`를 함께 제공한다.
- PostgreSQL이 프로젝트, stage, version, 승인, Evidence, 작업 projection의 정본이다.
- MinIO가 원본과 파생 PDF/XLSX 등 대형 artifact를 보관한다.
- Temporal control worker가 파일 검사, Agent 생성, 자료 수집, workbook 반영, 보고서 생성·출력 같은 장시간 작업을 조정한다.
- Python worker가 PDF·LLM 작업, .NET worker가 Excel 분석·수정·재계산을 맡는다.
- 브라우저는 DB, object storage, Temporal, provider credential에 직접 접근하지 않는다.
- `npm run dev`만 실행하면 비동기 작업이 진행되지 않는다. 전체 로컬 흐름은 인프라를 올린 뒤 `npm run dev:full`로 실행해야 한다.

## 4. `/` — 홈

목적: 서비스 설명, 인증, 새 리서치 시작.

현재 동작:

- Google OAuth 로그인을 사용한다.
- 비로그인 사용자가 새 리서치를 누르면 로그인으로 이동한다.
- 로그인 사용자는 프로젝트 생성 dialog를 연다.
- 프로젝트 이름은 공백 정규화 후 1~60자다.
- 생성 성공 시 해당 프로젝트의 setup URL로 이동한다.
- 화면의 6개 흐름 카드는 제품 흐름 요약이다. DB의 실제 process stage는 위 표의 7개다.

산출물: 새 프로젝트와 7개 stage state. 최초에는 `setup`만 진행 가능하고 나머지는 차단된다.

## 5. `/projects` — 프로젝트 목록

목적: 사용자가 소유한 프로젝트 검색·정렬·재개.

현재 동작:

- 프로젝트명, 기업명, 종목코드로 검색한다.
- 최근 수정순, 오래된 수정순, 기업명순 정렬을 지원한다.
- 기업·대상 분기·현재 단계·완료 단계 수(`완료/7`)·재검증 여부를 표시한다.
- 카드와 “이어하기”는 서버가 계산한 canonical resume route로 이동한다.
- 새 리서치 dialog를 열 수 있다.
- 현재 목록 API의 cursor pagination은 실질적으로 구현되지 않아 `nextCursor`가 `null`이다.
- 목록의 주 상태 표시는 `setup_required`, `file_upload_required`, `in_progress` 중심이다. 이전 문서의 세분화된 상태 집합은 현재 목록 API 계약이 아니다.

## 6. `/projects/:projectId/process/setup` — 프로젝트 설정

목적: 이후 모든 수집·기간·가격 계산의 기준을 고정.

사용자 입력:

- 기업명 또는 종목코드 검색 후 지원 기업 선택
- 목표 연도·분기
- 보고서 기준일
- 밸류에이션 방식: `PER`, `PBR`, `EV/EBITDA`, `DCF`

현재 규칙:

- 프로젝트 생성 시 기본 방식은 `PER`다.
- 선택 가능한 목표 연도는 현재 UTC 연도 기준 전년·당년·익년이다.
- 리포트 유형은 실적 Review로 고정된다.
- 기업 업종은 선택 기업의 directory/KRX 정보에서 온다.
- 저장은 낙관적 버전 충돌을 검사한다.
- 이미 완료한 setup의 기업·기간·기준일 등을 바꾸면 후속 리소스와 단계를 재검증 상태로 만들 수 있어 사용자 확인을 요구한다.
- 기존 결과는 즉시 삭제하지 않는다. 새 설정과 맞지 않는 하위 승인을 무효화한다.

완료 조건: 기업, 목표 기간, 기준일, 유효한 밸류에이션 방식이 저장되어야 한다.

현재 구현 한계: setup은 네 가지 방식을 저장하지만 STEP 06 화면·계산·민감도·승인은 **PER 방식만 구현**되어 있다. PBR, EV/EBITDA, DCF를 선택해도 해당 전용 후반 계산 화면으로 분기하지 않는다.

## 7. `/projects/:projectId/process/files` — 파일 업로드·검사·매핑

목적: 이전 보고서의 표현 구조와 Excel 계산 구조를 후속 단계가 사용할 수 있는 버전 계약으로 변환.

### 입력

| slot | 필수 | 형식 | 최대 크기 | 역할 |
|---|---:|---|---:|---|
| 이전 분기 실적 Review | 필수 | PDF | 50 MiB | 보고서 구조·문체·시각 템플릿 |
| 이전 분기 분석 Excel | 필수 | XLSX | 100 MiB | 실제값·추정치·수식·표·차트 계산 모델 |
| 현재 분기 IR·잠정실적 | 선택 | PDF | 50 MiB | 현재 분기 공식 사실과 회사 전망 |

화면도 이 계약에 맞춰 **3개 업로드 카드**를 `① 이전 PDF → ② 이전 Excel → ③ 현재 IR` 순서로 표시한다. 세 번째 카드는 선택이므로 비어 있어도 검사를 시작할 수 있다. 다만 업로드를 시작했다면 `ready` 또는 다시 `empty`가 될 때까지 검사 시작 상태가 열리지 않는다.

업로드는 session 생성 → object 저장 → 완료 확인 순서다. 원본은 immutable artifact로 보존된다.

### 보안·형식 검사

- 확장자와 실제 magic/type 불일치를 거절한다.
- 암호화 PDF를 거절한다.
- PDF embedded file, XFA, Launch, RichMedia, JavaScript 등 위험 구조를 차단한다.
- XLSX macro, external link, embedding, ActiveX 등 위험 구조를 차단한다.
- 운영 환경에서는 ClamAV 검사가 필수다.
- 스캔 이미지처럼 필요한 텍스트·구조를 추출하지 못하는 PDF는 후속 Template IR 적합성 검사를 통과하지 못할 수 있다.

### 비동기 파일 검사

Temporal 작업이 다음을 병렬 처리한다.

1. 이전 PDF → `Template IR`
2. optional 현재 IR → Current IR analysis
3. Excel → workbook structure/formula/style/candidate analysis
4. 기준일 KRX 종가 → market snapshot
5. 위 결과 → `MappingSet`

검사 시작 요청에는 선택된 현재 IR의 file version ID도 함께 고정한다. 현재 IR이 있으면 별도 `current_ir_analysis` resource version과 dependency를 만들며, 이전 PDF의 Template IR과 섞지 않는다.

작업은 취소·재시도를 지원한다.

### PDF·Excel 연결

PDF의 수치, 표, 차트, 제목·서술 영역을 의미 slot으로 만든다. Excel 분석 결과에서 metric alias, 기간, 페이지, 범위 topology, 위치·형식 점수를 사용해 후보를 찾는다.

- 명확한 scalar만 자동 선택한다.
- 표·차트는 단일 셀이 아니라 범위와 행·열 구조를 저장한다.
- 현재주가는 Excel 값이 아니라 KRX 기준일 종가를 권위 원천으로 연결한다.
- 사용자는 후보를 비교하고 다른 후보를 선택할 수 있다.
- 후보 수정은 새 `MappingSet` version을 만든다.
- 필수 slot이 미매핑이면 완료할 수 없다.
- 현재주가, 컨센서스, 밴드 차트, 투자의견처럼 후속 단계가 책임지는 일부 slot은 명시된 deferred policy로 처리할 수 있다.

검사 결과 dialog의 세 탭:

1. PDF 템플릿
2. Excel 모델
3. PDF·데이터 연결

완료 조건:

- 필수 두 파일 존재
- 파일 검사 성공
- mapping 상태 `confirmed`
- 필수 미매핑 수 0
- 화면이 보고 있는 Template IR, Workbook Analysis, MappingSet version이 최신

STEP 02의 primary completion version은 원본 파일이 아니라 **확정된 `MappingSet`**이다.

중요: 이 단계는 Excel 구조와 연결을 분석한다. 보고 연도 헤더를 실제로 이동하는 단계가 아니다. 연도 롤포워드는 STEP 05 검증 Excel이 만들어진 뒤 STEP 06 진입 때 실행된다.

## 8. `/projects/:projectId/process/hypothesis` — 투자의견·조사 질문

목적: 사용자의 현재 판단을 조사 가능한 질문으로 구조화.

사용자 입력:

- 잠정 투자의견 `BUY`, `HOLD`, `SELL`
- 투자 가설/논지

현재 동작:

- 입력은 draft version과 input revision으로 자동 저장된다.
- 질문 생성은 비동기 작업이다.
- canonical prompt는 [`agents/HYPOTHESIS_AGENT_PROMPT_v4.md`](./agents/HYPOTHESIS_AGENT_PROMPT_v4.md)다.
- repository/worker prompt version은 `hypothesis-v4`, 설정 model은 `gpt-5.4-mini`다.
- 질문 수는 **3~7개**다.
- 역할은 `PERFORMANCE`, `DRIVER`, `SEGMENT`, `OUTLOOK`, `VALUATION`이다.
- Agent 생성 결과에는 `PERFORMANCE`, `OUTLOOK`, `VALUATION`, 그리고 `DRIVER` 또는 `SEGMENT`가 있어야 한다.
- 질문마다 목적, 지표, 기간, 비교 기준, 제안 출처, 연속된 우선순위가 있다.
- 사용자는 질문 추가·수정·삭제·순서 변경 후 승인한다.

화면에 보이는 변화:

- 질문 추가 상한과 승인 가능 범위가 기존 5개에서 7개로 늘었다.
- 질문 행은 현재 질문 문장과 순서만 보여준다. 저장된 role은 화면 badge로 노출하지 않는다.
- 사용자가 질문을 추가·수정하면 서버가 문장에서 기업, 기간, 비교 기준, metric을 추출하고 role을 추론한다. 이 metadata를 만들 수 없는 문장은 거절한다.

자료 역할:

- optional 현재 IR은 현재 사실을 제공한다.
- 이전 PDF는 과거 논점·문체 맥락이다.
- 이전 Excel은 시트·metric 맥락이다.
- 이전 자료를 현재 사실로 자동 승격하지 않는다.

질문 생성 workflow는 현재 IR resource version이 있으면 입력 snapshot에 함께 pin한다. 현재 IR의 텍스트는 “현재 분기 공식 사실·회사 전망”으로, 이전 PDF와 Excel은 “현재 사실이 아닌 주제·구조 배경”으로 prompt에 전달한다.

현재 구현에는 별도 “반증 질문” 유형이 없다. 질문 흐름은 실적 → 원인/사업부 → 전망 → 밸류에이션을 지향한다.

완료 조건: 최신 입력 revision과 일치하고 질문별 purpose·period·comparison·metric·출처 metadata가 있는 3~7개 질문 세트를 사용자가 승인해야 한다.

현재 구현 주의점: role coverage는 **Agent 출력 검증 시점**에는 강제되지만, 사용자가 생성 후 질문을 삭제·수정한 뒤 누르는 최종 승인 API는 role coverage를 다시 검사하지 않는다. 최종 승인은 개수, 중복, metadata, input revision만 검사한다. 따라서 “최종 승인 세트도 항상 PERFORMANCE/OUTLOOK/VALUATION/DRIVER-or-SEGMENT를 포함한다”라고 문서화하면 현재 코드보다 강한 설명이 된다.

## 9. `/projects/:projectId/process/research-plan` — 자료 수집 및 계획

목적: 승인 질문과 보고서/Excel 입력 대상을 실제 실행 가능한 수집 계획으로 고정.

화면과 실행은 두 축으로 분리된다.

### 가설 조사 축

- 승인 질문별 포함 여부와 출처를 설정한다.
- 기본 출처:
  - 실적: DART + 기업 IR
  - 원인·사업부·전망: 기업 IR + NEWS
  - 밸류에이션: KRX
- NEWS는 사용자가 기사 URL을 수동 등록하는 방식이 아니라 승인된 기간 안에서 Agent가 검색하는 흐름이다.
- 사용자는 기업 IR 또는 사용자 자료를 PDF 업로드나 공개 URL로 연결할 수 있다.
- optional 현재 IR은 자동 source reference로 이어진다.
- 현재 저장소의 manual material upload 구현은 PDF 중심이다. 화면 정책 문구에 보이는 XLSX/CSV/TXT를 일반 자료 업로드 계약으로 간주하면 안 된다.

### Excel/리포트 입력 축

STEP 02 `MappingSet`과 workbook 분석을 이용해 다음을 만든다.

- 연결된 scalar에 등록된 DART/KRX 규칙이 있으면 정확한 Excel target 생성
- `12_p4_`, `13_p4_`, `14_p4_`, `15_p4_` 계열 재무제표 시트의 실제값 target 생성
- `08_도표4_`, `10_도표6_`, `11_도표7_` 계열 분기 표 target 생성
- 각 target에 metric, 기간, 연결·별도 기준, 연결/별도 재무제표 범위, 단위, write authority, 정확한 sheet/address 저장
- 밸류에이션 입력은 STEP 04 수집 대상에서 제외하고 STEP 06으로 미룬다.

예를 들어 목표 보고 연도가 2026이면 원본 Excel의 `2025F` 물리 셀이 “검증된 2025 actual을 먼저 쓸 자리”로 잡힐 수 있다. STEP 05가 그 셀에 actual을 넣고, STEP 06 롤포워드가 헤더와 열의 역할을 바꾼다.

리포트 target은 `carry_forward`, `collection_required`, `later_stage`, `connection_required`와 기간별 action을 보여준다. 연결이 없거나 지원하지 않는 대상도 상태를 명시해 계획에 남길 수 있다.

### 실제 지원 출처

- DART
- KRX
- ECOS
- 기업 IR
- 사용자 PDF/공개 URL 자료
- NEWS Agent 검색

`FNGUIDE_CONSENSUS` enum과 일부 정책 코드는 남아 있지만 현재 `sourceOptions()`에서 제외된다. 자동 수집도 `FNGUIDE_SOURCE_UNAVAILABLE`로 막힌다. 따라서 **FnGuide 컨센서스 자동 수집은 현재 미구현**이다.

### 계획 승인 후

승인 시 질문, Excel target, report target, source policy, 입력 version을 immutable snapshot으로 저장하고 Temporal 수집·검증 workflow를 시작한다.

현재 새 workflow는 가설과 Excel을 분리한다.

- 가설: DART/IR/NEWS/사용자/KRX/ECOS 수집 → LLM 후보 추출 → 독립 검증
- Excel: 공식 구조화 원천 수집 → deterministic 값 선택

두 흐름은 source snapshot을 공유할 수 있지만 결과와 판정은 섞지 않는다.

## 10. `/projects/:projectId/process/validation` — 조사 결과·Excel 검증

목적: 원문을 확인하고, 승인된 값만 Excel 복사본과 후속 보고서에 전달.

### 가설 탭

- 질문별 답변, 근거, 지지/반대/중립 stance, 충족도를 표시한다.
- 사용자는 결과 반려·복원·재조사 요청을 할 수 있다.
- qualified 질문은 명시적으로 수락해야 한다.
- 출처 충돌은 사용자가 근거와 이유를 선택해 해결한다.
- DART는 보관한 원문 재무제표 표의 선택 행·필드를 강조한다.
- PDF는 내부 viewer에서 페이지·좌표를 표시한다.
- KRX/ECOS는 선택 record와 field를 구조화해 표시한다.
- NEWS는 수집 시점 본문/정규 URL과 source context를 표시한다.

### Excel 탭

- 검증 workbook read model과 target 셀을 표시한다.
- target별 공식 원문, before/after 값, 쓰기 제안을 연결한다.
- 모든 쓰기 제안에 사용자 결정이 필요하다: 원안 승인, 수정 승인, 반려.
- 수정 승인은 검증된 값과 수치적으로 동등한 표현만 허용한다. 다른 값이면 재검증 대상이다.
- 필수 제안을 반려한 상태로 완료할 수 없다.
- 자동 승인은 없다.

### 공식 Excel 값의 deterministic 규칙

- DART 분기 report code를 정확히 사용한다.
  - 1분기 `11013`
  - 반기 `11012`
  - 3분기 `11014`
  - 사업보고서 `11011`
- 기준일 이전 최신 정정 공시, 기업, 연결/별도 범위를 고정한다.
- 등록 account/statement 규칙으로 정확히 한 행만 선택한다. 다중 후보는 실패다.
- 손익·현금흐름 누적 공시는 2~4분기 단일 분기값으로 차감할 수 있다.
- 재무상태표는 시점 값이라 차감하지 않는다.
- KRX는 종목코드·거래일·종가를 검증한다.
- ECOS는 등록된 series만 사용한다.
- Evidence에는 접수번호, statement/account/field, row fingerprint, 원시값, 정규화값, 단위 변환, 목적 sheet/cell을 남긴다.

### Excel 반영

승인된 제안으로 workbook application을 시작한다.

1. STEP 02의 원본 Excel artifact hash와 구조를 다시 확인한다.
2. `MappingSet`이 허용한 정확한 sheet/address만 쓴다.
3. 수식 셀·비편집 셀·구조 변경을 차단한다.
4. 원본 대신 immutable 복사본에 쓴다.
5. Excel Worker가 재계산하고 필수 출력·구조를 검증한다.
6. 성공 artifact를 `validated_workbook_resource_version_id`로 저장한다.

완료 조건:

- 포함된 필수 결과가 passed/qualified accepted 상태
- 반려·stale·재조사·미해결 conflict 없음
- 값·기간·scope·unit·provenance 완전
- 모든 Excel 제안 결정 완료
- workbook application 성공
- 검증 Excel artifact 최신

완료 산출물:

- `ValidationApproval`
- `ValidatedValueSet`
- `ValidatedWorkbook`

## 11. `/projects/:projectId/process/valuation` — Excel 롤포워드·PER 밸류에이션

목적: STEP 05에서 공식 실제값이 반영된 Excel을 목표 보고 기간으로 전진시키고, 사용자가 추정치·PER·목표주가를 확정.

### 진입 시 Excel 준비

화면을 열면 서버가 최신 `ValidationApproval`, `ValidatedValueSet`, `ValidatedWorkbook`, `MappingSet`, KRX 가격 snapshot의 일치 여부를 확인한다. 그 뒤 Excel Worker의 `/valuation/prepare`가 롤포워드를 실행한다.

롤포워드는:

- 연도 헤더가 이미 목표 기간이면 다시 이동하지 않는다.
- 정확히 5개 연속 연도, 2개 actual + 3개 forecast 구조를 기대한다.
- 변경된 경우 새 immutable valuation workbook artifact를 만든다.
- 동일 입력 재실행에 같은 결과가 나오는 idempotent 동작이다.

### 연도 이동의 실제 예

목표 보고 연도 2026의 표준 연간 기간:

```text
2024 actual | 2025 actual | 2026F | 2027F | 2028F
```

이전 분기 Excel:

```text
2023 | 2024 | 2025F | 2026F | 2027F
```

실제 처리:

1. STEP 04가 원본의 `2025F` 물리 셀을 2025 actual 입력 target으로 계획한다.
2. STEP 05가 검증·승인된 2025 actual을 그 셀에 기록해 `ValidatedWorkbook`을 만든다.
3. STEP 06 준비가 전체 5년 window를 한 칸 전진시킨다.

```text
이전 2024 actual        → 새 2024 actual
검증된 2025 actual      → 새 2025 actual
이전 2026F             → 새 2026F
이전 2027F             → 새 2027F
새 2028F input          → 비움
```

즉 사용자가 제시한 변환:

```text
2023 2024 2025F 2026F 2027F
              ↓
2024 2025 2026F 2027F 2028F
```

이 흐름이 현재 코드와 테스트에 구현되어 있다. 단순히 헤더 문자열만 바꾸지 않는다. 실제값 주입, 열 이동, 새 추정 연도 입력 준비, 수식 재생성, 후속 report period 검증까지 연결된다.

현재 롤포워드 인식 범위:

- 연간 재무제표: visible sheet 이름이 `12_p4_`, `13_p4_`, `14_p4_`, `15_p4_`로 시작
- 모델 시트: `M1_` 계열
- 수정후/수정전 기준표: `10_...(수정후|revised)`와 `11_...(수정전|prior|before)` 패턴

세부 동작:

- 새 마지막 forecast 입력 셀은 비우고 노란 배경 `#FFF2CC`, 파란 글자 `#0000FF`로 표시한다.
- 이 셀들은 사용자 편집 manifest에 들어간다.
- 실제 재무제표 actual 셀은 system writable이다.
- `M1_` 입력 행은 forecast를 왼쪽으로 이동하고 마지막 forecast를 비운다.
- `M1_` 수식 행의 새 마지막 열은 왼쪽 수식을 상대 A1 참조로 번역해 만든다.
- 이미 수식인 셀은 불필요하게 덮어쓰지 않는다.
- 수정후 기준표가 바뀌면 수정전 시트에 값 snapshot을 만들고 `도표 6`을 `도표 7`, `수정후`를 `수정전`으로 바꾼다.

### 화면 동작

두 탭:

1. Excel 추정치
2. PER·목표주가 결정

사용자는 manifest가 허용한 노란색/파란색 비수식 셀만 편집한다. 저장 때마다 Excel Worker가 새 workbook version을 만들고 수식을 재계산한다. Forward EPS, Target PER cell, 목표주가, 영향 받은 보고서 binding을 다시 읽는다.

결정 방식:

- Target PER 직접 입력: `0.1~100.0`, 소수점 한 자리
- 목표주가 직접 입력: `1~1,000,000,000`원 정수
- 목표주가 직접 입력 시 `목표주가 ÷ Forward EPS`로 PER을 역산해 Excel 입력 셀에 반영
- 목표주가와 상승여력은 Excel 출력 및 KRX 현재주가로 확인
- PER/EPS 민감도 표 제공

완료 전:

- 롤포워드 기간 헤더 일치
- 필수 입력 셀 값 존재
- 최신 Excel 재계산 성공
- Forward EPS, Target PER, 목표주가가 양수
- draft 값과 Excel 출력 일치
- 최신 KRX snapshot, MappingSet, validated workbook, structure hash 일치
- 사용자 입력값 승인

추정치가 바뀌면 기존 valuation approval, report outline, report validation이 무효화된다.

완료 산출물은 승인된 valuation workbook artifact와 `ValuationApproval`이다. 이 Excel이 보고서 표·차트·수치와 최종 XLSX의 정본이다.

## 12. `/projects/:projectId/process/report-outline` — 페이지 내용 설정

목적: 이전 PDF의 페이지 구조를 유지하면서 새 분기 보고서에 들어갈 제목·서술 방향·데이터 slot을 승인.

입력 버전:

- `Template IR`
- 확정 `MappingSet`
- `ValidationApproval`
- 승인 valuation workbook와 `ValuationApproval`
- 최신 승인 hypothesis

현재 동작:

- 원본 PDF 페이지 순서대로 outline을 만든다.
- 코드 기반 fallback outline을 먼저 만들고 Report Outline Agent가 제목·소제목·요약을 제안한다.
- 사용자는 페이지 제목, narrative block의 소제목·요약을 수정한다.
- 페이지별 visual slot의 연결 상태와 원천을 본다.
- 페이지마다 “확인 완료” 처리한다.
- 전체 제안을 다시 생성할 수 있다.
- 상위 version이 바뀌면 기존 outline은 재검증 상태가 된다.

페이지 확인 조건:

- 제목 존재
- 필요한 서술 내용 존재
- 해당 페이지 visual slot이 모두 confirmed

승인 시:

1. 모든 페이지 검토와 version 일치를 검사한다.
2. outline approval을 저장한다.
3. 비동기 report materialization 작업을 시작한다.
4. 승인 Excel에서 scalar·table·chart를 snapshot으로 재료화한다.
5. 각 block에 source refs와 materialization snapshot ID를 고정한다.
6. 보고서 초안 생성 성공 후 `/projects/:projectId/report`를 연다.

현재 구현은 원본 PDF의 page count/order, 객체 좌표, 스타일·고정 자산 참조를 보존하고 편집 영역을 덮어쓰는 방식이다. “텍스트 선택 가능한 모든 증권사 PDF를 무조건 지원”하거나 “모든 입력에서 픽셀 단위 완전 복제”한다는 보장은 현재 코드 계약이 아니다. Template IR 검사와 materialization/render 검증을 통과한 입력만 지원한다.

## 13. `/projects/:projectId/report` — 초안 편집·검증·내보내기

목적: 생성된 초안을 근거와 함께 검토하고 같은 승인 버전의 PDF·XLSX를 발행.

### 초안 데이터

초안은 다음을 함께 고정한다.

- 원본 PDF/Template IR version
- `MappingSet`
- 승인 hypothesis
- 검증 Evidence와 `ValidationApproval`
- 승인 valuation workbook와 `ValuationApproval`
- outline approval
- block별 materialization snapshot

표·차트·수치 block은 승인 valuation workbook read model에서 만든다. 값, 시트·범위, Evidence, 계산 경로가 provenance panel에 표시된다. Excel 연결이 없거나 read model 범위가 없으면 해당 block은 차단 상태가 된다.

### 편집

- 한 보고서에 활성 편집 session 하나만 허용한다.
- session은 heartbeat와 lease를 가진다.
- 다른 session이 잡고 있으면 읽기 전용이며 명시적 takeover를 지원한다.
- 편집 가능한 text block만 수정한다.
- 한 block text는 비어 있을 수 없고 최대 2,000자다.
- undo/redo는 현재 브라우저 편집 기록으로 제공한다.
- 저장은 새 report version을 만든다.
- 이전 version 목록 조회와 복원을 지원한다.
- 수정하면 기존 preview, validation, export 상태가 stale이 된다.

AI 문장 다듬기:

- 선택한 block과 사용자 요청만 Agent에 보낸다.
- 원문과 제안문을 비교한 뒤 사용자가 적용한다.
- 적용도 새 report version이다.
- AI가 검증 수치·근거·판단을 직접 바꾸는 권한은 없다.

### PDF 미리보기

- 비동기 PDF Worker가 source PDF와 render plan으로 미리보기를 만든다.
- 원본 page 구조와 target rectangle에 새 text/data materialization을 렌더링한다.
- block overflow, source/template 불일치, render 실패를 차단한다.
- 최신 ready preview만 승인·내보내기에 사용한다.

### 최종 검증

현재 blocking 검사:

- 원본과 페이지 수·순서 불일치
- 빈 report block
- 존재하지 않는 Evidence 참조
- 편집 영역이 원본 텍스트를 완전히 덮지 못함
- 미확정 data binding
- 승인 Excel에서 materialization 미완료
- 연간 재무표 헤더가 목표 5개 기간과 불일치
- PER, 목표주가, Forward EPS가 `ValuationApproval`과 불일치
- PDF render의 blocking issue

일부 font 대체, 낮은 해상도 이미지, optional source link, 경미한 pixel diff는 허용 가능한 warning code다. warning은 확인할 수 있지만 blocking issue가 하나라도 있으면 승인할 수 없다.

### 승인·내보내기

순서:

1. 최신 report version PDF preview 생성
2. 같은 version 최종 validation 통과
3. report version 승인
4. 같은 승인·validation version으로 export 생성

내보내기는 PDF와 XLSX를 반드시 함께 요청한다.

- PDF: 최신 승인 report version의 ready preview artifact
- XLSX: STEP 06에서 승인된 같은 valuation workbook artifact

따라서 최종 XLSX에는 STEP 05의 검증 실제값, STEP 06의 연도 롤포워드, 사용자 추정치, PER·목표주가 계산이 반영된다. 보고서 표·차트·수치도 그 Excel version을 사용하므로 두 산출물의 숫자 계보가 같다.

export는 비동기 작업이며 상태 조회, 실패 artifact 재시도, 취소, 다운로드를 지원한다.

## 14. 현재 구현과 이전 문서의 주요 불일치

| 이전 문서 내용 | 현재 구현 |
|---|---|
| 문서는 목표 서비스 동작 정의 | 이 문서는 현재 실행 코드 기준으로 수정 |
| STEP 02는 이전 PDF와 Excel 두 파일 화면 | 필수 이전 PDF·Excel + 선택 현재 IR의 3-slot 화면 |
| 질문 3~5개 | 3~7개 |
| Hypothesis prompt v3 | canonical prompt v4, `hypothesis-v4` |
| 생성 질문과 최종 승인 질문 모두 role coverage 보장 | 생성 output만 coverage 강제. 사용자 편집 후 승인 API는 role coverage를 재검사하지 않음 |
| FnGuide 컨센서스 자동 수집 | 현재 source option에서 제외, 자동 수집 미지원 |
| 모든 selectable PDF 지원·완전 복제 보장 | Template IR/매핑/render 검증을 통과한 PDF만 지원. 보편적 pixel-perfect 보장 없음 |
| 파일 단계에서 Excel을 다음 연도로 변환하는 것으로 오해 가능 | STEP 02는 구조 분석·매핑. 실제값은 STEP 05, 롤포워드는 STEP 06 진입 |
| PBR/EV/EBITDA/DCF까지 후반 계산 가능해 보임 | setup 저장은 가능하지만 현재 STEP 06은 PER 전용 |
| Research Agent가 Excel 실제값도 판단 | Excel 실제값은 등록 규칙과 공식 구조화 원천으로 deterministic 수집 |
| Excel 자동 반영 | 모든 쓰기 제안에 사용자 결정 필요. 승인본의 복사본에만 반영 |
| 원본 Excel이 후반에 계속 사용 | STEP 05 검증 Excel → STEP 06 롤포워드/계산 Excel → 최종 XLSX로 version 전진 |
| 최종 PDF만 보고서 정본 | 최종 PDF와 XLSX가 동일한 report/valuation approval 계보를 공유 |

## 15. 다른 세션이 반드시 유지해야 할 불변조건

1. 상위 version ID와 artifact hash를 생략하고 “최신 파일”만 참조하지 않는다.
2. 이전 PDF는 현재 사실의 권위 출처가 아니라 구조·과거 맥락이다.
3. 현재 실제값은 DART/IR 등 검증 근거를 거쳐 STEP 05에서 Excel 복사본에 쓴다.
4. `2025F` 같은 물리 셀이 STEP 05 전에는 forecast였어도, 목표 기간 롤포워드 전 actual 입력 target이 될 수 있다.
5. 롤포워드는 검증 실제값 반영 후 실행한다.
6. 새 마지막 forecast 입력은 비우고 사용자가 채우게 한다. 수식 셀은 규칙으로 재생성한다.
7. 보고서 숫자는 승인 valuation workbook 밖에서 LLM이 새로 계산하지 않는다.
8. Excel 수정은 valuation approval과 보고서 결과를 무효화한다.
9. 최종 PDF와 XLSX는 같은 승인 report/validation/valuation lineage에서 내보낸다.
10. FnGuide, 비-PER 밸류에이션, 모든 PDF 완전 복제를 현재 지원 기능으로 설명하지 않는다.
