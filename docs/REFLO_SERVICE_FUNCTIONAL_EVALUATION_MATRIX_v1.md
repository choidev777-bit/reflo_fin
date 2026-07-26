# REFLO 서비스 기능 종합 평가표 v1

**문서 목적:** REFLO가 의도하고 약속한 전체 서비스 동작을 종단간으로 평가한다.  
**평가 기준:** 현재 구현된 기능 목록이 아니라 목표 사용자 경험과 승인된 제품 계약  
**작성일:** 2026-07-26  
**평가 상태:** 미평가  
**주요 범위:** 프로젝트 설정 → PDF·XLSX 분석·매핑 → 가설 → 자료 수집 → 검증 → Excel 반영 → 밸류에이션 → 보고서 구성·편집 → PDF·XLSX 내보내기

> 이 문서는 나중에 실제 REFLO를 평가할 때 그대로 사용하는 실행용 체크리스트다. 화면이 존재하거나 버튼이 눌리는지만 확인하지 않는다. 각 단계의 결과가 정확하고, 승인된 버전이 다음 단계에 전달되며, 상위 데이터 변경 시 하위 결과가 안전하게 무효화되는지를 함께 판정한다.

## 1. 평가 기준 문서와 충돌 처리

다음 문서를 제품 약속의 근거로 사용한다.

1. [종단간 리서치·Excel·보고서 자동화 완성 계획](./fix/REFLO_END_TO_END_REPORT_AUTOMATION_COMPLETION_PLAN.md)
2. [URL별 서비스 동작 명세](./REFLO_URL_SERVICE_BEHAVIOR_v1.md)
3. [보고서 표·차트 물질화 및 연결 검증 계획](./fix/REPORT_DRAFT_TABLE_CHART_MATERIALIZATION_FIX_PLAN.md)
4. [동적 밸류에이션·보고서 반영 계획](./fix/PHASE06_DYNAMIC_VALUATION_REPORT_FIX_PLAN.md)
5. [자율 뉴스 조사 계획](./fix/PHASE04_AUTONOMOUS_NEWS_RESEARCH_FIX_PLAN.md)
6. [URL별 화면 구현 명세와 화면별 상세 명세](./REFLO_SCREEN_IMPLEMENTATION_SPEC_v1.md)

문서가 충돌하면 다음 순서로 판정한다.

1. 날짜가 더 늦고 `승인됨`, `확정`, `완료 조건`으로 명시된 종단간 계약을 우선한다.
2. 사용자 결과의 정확성·출처 추적·버전 불변성·실패 시 차단 원칙을 UI 편의보다 우선한다.
3. 지원 범위 밖 입력은 성공 여부가 아니라 정확한 거절과 복구 안내를 평가한다.
4. 명시되지 않은 기능을 현재 약속으로 확대 해석하지 않는다.

## 2. 현재 평가 범위

### 2.1 정상 지원 범위

- Google 로그인과 단일 소유자 프로젝트
- IT 제조업 상장사 실적 Review
- PER 밸류에이션
- 텍스트·벡터 객체를 추출할 수 있고 암호화·전자서명이 없는 일반 PDF
- `.xlsx` 작업 파일
- PDF 최대 100페이지, Excel 최대 50시트
- scalar, keyed table, chart series, composite chart, fixed visual
- 선·영역·그룹 막대·누적 막대·콤보·밴드 차트
- DART, 기업 IR, KRX, ECOS, FnGuide 컨센서스, 뉴스, 사용자 자료
- 최종 산출물 PDF와 XLSX

### 2.2 성공 대상이 아닌 입력

다음 항목은 정상 처리로 조용히 통과시키면 실패다. 업로드 또는 매핑 단계에서 구체적인 차단 이유와 다음 행동을 제공해야 한다.

- 암호화·전자서명·손상 PDF 또는 XLSX
- 텍스트를 추출할 수 없는 이미지 전용 PDF
- `.xls`, `.xlsm`, 매크로, DDE, 외부 링크
- 복원할 계열이 없는 차트
- 동률 매핑 후보가 여러 개인 필수 슬롯
- 안전하게 보존할 수 없는 수식·VML·drawing 구조

### 2.3 평가 제외

- 공동 프로젝트와 역할별 승인
- DOCX 내보내기
- AI가 미래 추정치·투자의견·Target PER을 자동 확정하는 기능
- 다른 산업, Preview·산업·이슈 리포트
- PER 이외 밸류에이션 의사결정 모델

P/E·P/B Band 차트는 지원 fixture에 존재할 때 데이터 차트 물질화 대상으로 평가한다. 이것은 PBR을 사용자 밸류에이션 의사결정 모델로 활성화한다는 뜻이 아니다.

### 2.4 평가 용어

- **Fixture:** 결과를 미리 아는 통제된 테스트 입력 파일·자료 묶음
- **Golden manifest:** PDF 블록, Excel 셀·수식, 매핑, 출처, 최종 값의 정답지
- **Provenance:** 값·주장이 어느 원문과 계산 경로에서 왔는지 보여주는 추적 정보
- **Snapshot:** 이후 변경과 분리해 고정한 특정 시점의 자료·계산 상태
- **Lineage:** 상위 입력부터 최종 산출물까지 이어지는 version 계보
- **Materialization:** 승인된 값·표·차트를 실제 보고서 블록으로 생성하는 과정

## 3. 평가 결과와 점수 규칙

### 3.1 결과 코드

| 코드 | 의미 | 점수 계수 |
|---|---|---:|
| `PASS` | 합격 기준을 전부 만족 | 1.0 |
| `PARTIAL` | 핵심 결과는 맞지만 일부 기준·복구·증빙이 부족 | 0.5 |
| `FAIL` | 실행됐으나 결과가 틀리거나 제품 약속을 위반 | 0 |
| `BLOCKED` | 선행 오류·환경 문제·미구현 때문에 평가할 수 없음 | 0 |
| `NOT_RUN` | 아직 실행하지 않음 | 0 |
| `N/A` | 명시된 평가 범위 밖. 사유 기록 필수 | 분모 제외 |

`BLOCKED`와 `NOT_RUN`은 제품이 정상이라는 증거가 아니다. 전체 평가 완료 전까지 0점으로 취급한다.

### 3.2 우선순위와 가중치

| 우선순위 | 의미 | 가중치 |
|---|---|---:|
| `P0` | 재무 정확성, 승인 통제, 계보, 보안, 최종 산출물의 필수 기능 | 5 |
| `P1` | 핵심 사용자 흐름, 복구, 운영 신뢰성 | 3 |
| `P2` | 사용성, 접근성, 성능, 보조 기능 | 1 |

```text
가중 점수 = Σ(항목 가중치 × 결과 계수) ÷ Σ(평가 대상 항목 가중치) × 100
실행 커버리지 = (PASS + PARTIAL + FAIL + BLOCKED 항목 수) ÷ N/A 제외 전체 항목 수 × 100
```

### 3.3 종합 판정

| 판정 | 조건 |
|---|---|
| `정상` | 실행 커버리지 100%, 모든 P0가 PASS, P1 FAIL·BLOCKED 0건, 가중 점수 95점 이상 |
| `조건부 정상` | 실행 커버리지 100%, 모든 P0가 PASS, 데이터·계보·보안 결함 0건, 가중 점수 85점 이상 |
| `비정상` | P0 하나라도 PARTIAL·FAIL·BLOCKED이거나 위 조건을 만족하지 못함 |
| `평가 미완료` | 실행 커버리지 100% 미만 |

## 4. 정량 합격 기준

| 지표 | 계산 방법 | 합격 기준 |
|---|---|---:|
| 필수 PDF 동적 블록 검출 재현율 | 정확히 검출한 필수 동적 블록 ÷ 정답지의 필수 동적 블록 | 100% |
| 블록 유형 정확도 | 올바른 유형으로 분류한 블록 ÷ 검출 블록 | 100% P0 블록 |
| 필수 매핑 완성도 | confirmed 필수 binding ÷ 필수 동적 slot | 100% |
| 매핑 정확도 | 정답 sheet·cell/range·series에 연결된 binding ÷ confirmed binding | 100% |
| Excel 실제값 입력 정확도 | 올바른 승인값이 올바른 target cell에 기록된 수 ÷ 승인 target cell | 100% |
| 비승인 셀 변경 | 승인 대상이 아닌 값·수식·스타일 변경 수 | 0건 |
| 계산 일치율 | 기준 계산과 서버 재계산 결과가 decimal·반올림 규칙까지 일치한 수 ÷ 핵심 계산 수 | 100% |
| 핵심 provenance 완성도 | 원문 위치 또는 Excel 계산 경로가 있는 핵심 주장·숫자·표·차트 ÷ 전체 핵심 항목 | 100% |
| 과거 동적 값 잔존 | 최종 초안·PDF에서 발견된 이전 분기 기업·기간·수치·목표주가 | 0건 |
| 산출물 snapshot 일치 | preview·승인 PDF·XLSX가 같은 pinned version을 참조하는 비율 | 100% |
| PDF 고정 영역 렌더 일치 | 원본 대비 변경 금지 영역 이미지 비교 | 99.5% 이상 |
| 요소 좌표 오차 | 승인 Template IR 대비 요소 bbox 편차 | 최대 ±0.5pt |
| 페이지 구조 | 페이지 수·크기·순서 | 원본과 100% 동일 |
| 필수 차단 누락 | blocker가 있는데 승인·내보내기가 가능했던 수 | 0건 |
| 사용자 간 정보 노출 | 다른 소유자의 프로젝트·파일·artifact·URL 접근 성공 수 | 0건 |

정답지와 기준 산출물 없이 “비슷해 보임”으로 정량 항목을 PASS 처리하지 않는다.

## 5. 평가 준비물

### 5.1 필수 fixture 세트

| Fixture ID | 목적 | 필수 내용 |
|---|---|---|
| `FX-HAPPY-ISC` | 대표 전체 정상 흐름 | ISC PDF·XLSX, 도표 2·3·7·8·9·10, 도표 6 fixed visual, 재무표 4개 |
| `FX-MULTI-BROKER` | 템플릿 일반화 | 최소 5개 증권사, 총 20~30개 텍스트 기반 PDF 회귀 corpus |
| `FX-PDF-VARIANTS` | PDF 구조 변화 | 페이지 수·좌표·회전·CropBox·Form XObject·font embedding이 다른 표본 |
| `FX-XLSX-VARIANTS` | Excel 구조 변화 | 시트명·순서·출력 셀·입력 스타일·hidden/veryHidden·병합·freeze pane이 다른 표본 |
| `FX-SOURCE-TRUTH` | 자료 수집·검증 | 기준일이 고정된 DART·IR·KRX·ECOS·FnGuide·뉴스 정답 원문 |
| `FX-NEGATIVE` | 실패·보안 | 암호화·손상·이미지 전용 PDF, macro·external link·순환참조 XLSX, 악성 표본 |
| `FX-VERSIONING` | 늦은 결과·무효화 | 실행 중 MappingSet·Workbook·Evidence·Valuation을 변경할 수 있는 복제 프로젝트 |
| `FX-USERS` | 소유권 격리 | 서로 다른 Google 사용자 A·B |

### 5.2 실행 전 정답지

각 정상 fixture에 다음 golden manifest를 먼저 만든다.

- PDF 페이지별 block ID, 유형, bbox, fixed/dynamic 여부
- Excel sheet stable ID, 표시명, cell/range, 수식, number format, unit, period
- 각 PDF slot의 정답 workbook/evidence/valuation binding
- 실제값 target cell과 정답 값
- 재계산 후 Forward EPS, Target PER, 목표주가, 상승여력
- 표의 header·row key·기간 열과 차트 category·series·axis
- 최종 보고서에 남아야 할 값과 제거되어야 할 이전 분기 값
- 원문 URL·문서 ID·페이지·문단·표 좌표

### 5.3 실행 기록

| 항목 | 기록값 |
|---|---|
| 평가 일시 |  |
| 평가자 |  |
| 환경·배포 URL |  |
| build/commit |  |
| 브라우저·OS |  |
| 프로젝트 ID |  |
| fixture와 입력 hash |  |
| 기준일·시간대 |  |
| 주요 job/run ID |  |
| Evidence 저장 경로 |  |

증빙은 가능하면 `평가 실행일/테스트 ID` 단위로 저장한다. 스크린샷만으로 데이터 정확성을 증명하지 말고 API 응답, version ID, artifact hash, workbook diff, PDF render diff를 함께 남긴다.

## 6. 즉시 실패하는 P0 출시 차단 조건

다음 중 하나라도 발생하면 다른 점수와 무관하게 종합 판정은 `비정상`이다.

- 필수 PDF 동적 블록 누락 또는 잘못된 자동 매핑
- 검증되지 않은 값이 Excel·화면·보고서에 반영됨
- 승인하지 않은 Excel 셀·수식·스타일이 변경됨
- Excel 재계산 실패 또는 PDF·XLSX 핵심 숫자 불일치
- 핵심 숫자·주장·표·차트의 출처 또는 계산 경로 누락
- 이전 분기 동적 값이 최신 초안·최종 PDF에 잔존
- 오래된 비동기 결과가 최신 결과로 게시됨
- 상위 version 변경 뒤 하위 승인·내보내기가 계속 가능함
- 필수 blocker가 있는데 승인 또는 내보내기가 가능함
- final PDF가 새 산출물이 아니라 업로드 원본 PDF임
- preview·PDF·XLSX가 서로 다른 snapshot을 사용함
- 재무 표·차트를 결정적 데이터 렌더링 대신 AI 생성 이미지로 만듦
- 다른 사용자의 프로젝트·파일·artifact·다운로드 URL에 접근 가능함

## 7. 단계별 기능 평가표

모든 `결과`의 초기값은 `NOT_RUN`이다. 실행 후 결과 코드와 증빙 또는 결함 ID를 함께 기록한다.

### 7.1 공통 종단간 계약

| ID | 시나리오·행동 | 합격 기준 | 필수 증빙 | 우선순위 | 결과 |
|---|---|---|---|---|---|
| E2E-001 | 정상 fixture로 로그인부터 PDF·XLSX 내보내기까지 한 번에 수행 | 숨은 데이터 수정이나 관리자 개입 없이 전체 흐름 완료 | 전체 화면 녹화, 단계별 version, 최종 artifact | P0 | NOT_RUN |
| E2E-002 | 같은 입력과 같은 승인 결정을 새 프로젝트에서 반복 | 핵심 값·mapping·report snapshot이 재현되고 비결정적 차이가 없음 | 두 실행 manifest diff | P0 | NOT_RUN |
| E2E-003 | 각 단계 완료 직후 새로고침·로그아웃·재로그인 | 저장된 승인 상태와 정확한 재개 route 복원 | 단계별 재진입 화면·API | P1 | NOT_RUN |
| E2E-004 | 정상 흐름 전체에서 사용된 version 계보 추출 | 각 단계가 바로 이전 승인 immutable version ID를 소비 | lineage manifest | P0 | NOT_RUN |
| E2E-005 | 지원하지 않는 입력으로 전체 흐름 시작 | 과거값·placeholder·일반 템플릿으로 조용히 대체하지 않고 명확히 차단 | 오류 코드·복구 안내 | P0 | NOT_RUN |
| E2E-006 | 핵심 숫자 하나를 원문에서 최종 PDF까지 역추적 | 원문 locator → 승인 Evidence → workbook cell/formula → report slot → PDF가 단절 없이 연결 | provenance trace | P0 | NOT_RUN |
| E2E-007 | 최종 결과에서 모든 사용자 확정 항목 확인 | 투자의견·가설·추정치·충돌 선택·PER·목표주가·최종 문장은 사용자 승인값과 일치 | 승인 로그·최종 산출물 | P0 | NOT_RUN |

### 7.2 홈·로그인·프로젝트

| ID | 시나리오·행동 | 합격 기준 | 다음 단계 연계·증빙 | 우선순위 | 결과 |
|---|---|---|---|---|---|
| AUTH-001 | 비로그인 상태로 홈 진입 | 공개 홈과 Google 로그인만 표시하고 가짜 사용자·프로젝트 미노출 | 홈 스크린샷 | P1 | NOT_RUN |
| AUTH-002 | 보호 URL 직접 접근 후 로그인 | 인증 성공 후 처음 요청한 동일 URL로 복귀 | redirect trace | P1 | NOT_RUN |
| AUTH-003 | `새 리서치`를 빠르게 여러 번 클릭 | 프로젝트가 한 번만 생성되고 실제 `projectId` setup URL로 이동 | project ID·요청 ID | P1 | NOT_RUN |
| AUTH-004 | 사용자 A·B로 프로젝트 목록 조회 | 각 사용자에게 본인 소유 프로젝트만 표시 | 계정별 목록 비교 | P0 | NOT_RUN |
| AUTH-005 | 프로젝트명·기업명·종목코드 검색과 정렬 | 전체 소유 프로젝트에서 정확히 검색되고 서버 저장 시각 기준으로 안정 정렬 | 검색·정렬 결과 | P2 | NOT_RUN |
| AUTH-006 | 실행 중·재검증·충돌·편집·완료 프로젝트 표시 | workflow 진행률과 장시간 job 진행률을 구분하고 실제 상태와 일치 | 목록 projection·job 상태 | P1 | NOT_RUN |
| AUTH-007 | 각 상태의 프로젝트 행 선택 | 서버가 계산한 마지막 유효·문제 해결 route로 이동 | 상태별 route 표 | P1 | NOT_RUN |
| AUTH-008 | 세션 만료 후 재로그인 | 작성 중 입력과 의도한 route를 가능한 범위에서 보존하고 다른 사용자 데이터 미노출 | 재인증 전후 화면 | P1 | NOT_RUN |
| AUTH-009 | 존재하지 않거나 다른 사용자 projectId 직접 접근 | 두 경우 모두 정보 노출 없는 동일한 404 처리 | HTTP 응답 | P0 | NOT_RUN |

### 7.3 STEP 01 프로젝트 설정

| ID | 시나리오·행동 | 합격 기준 | 다음 단계 연계·증빙 | 우선순위 | 결과 |
|---|---|---|---|---|---|
| SETUP-001 | 기업명 일부와 종목코드 일부로 검색 | DART·허용 거래소 기반 실제 상장사 후보 표시 | 선택 company ID | P1 | NOT_RUN |
| SETUP-002 | 문자열만 입력하고 후보를 선택하지 않음 | 설정 완료를 허용하지 않음 | field 오류 | P1 | NOT_RUN |
| SETUP-003 | 기업 선택 | 종목코드·거래소·업종이 서버 기준으로 자동 연결 | setup response | P1 | NOT_RUN |
| SETUP-004 | 연도·분기·기준일 누락·오류 입력 | 서버가 전체 설정을 검증하고 다음 단계 차단 | 오류 코드 | P1 | NOT_RUN |
| SETUP-005 | MVP 범위 확인 | 실적 Review·IT 제조업·PER 계약이 명확하고 미지원 선택지를 성공처럼 제공하지 않음 | 저장된 setup | P1 | NOT_RUN |
| SETUP-006 | 기준일 저장 후 자료 수집 실행 | 기준일이 KST `cutoffAt`으로 변환되고 이후 자료가 자동 포함되지 않음 | cutoff와 source 목록 | P0 | NOT_RUN |
| SETUP-007 | 저장 직후 새로고침 | 실제 서버 저장 성공 상태와 입력값 복원 | setup version | P1 | NOT_RUN |
| SETUP-008 | 하위 단계가 있는 상태에서 기업·기간·기준일 변경 | 영향 목록과 확인을 요구하고 새 setup version 생성, 기존 artifact 보존, 관련 하위 단계 재검증 | invalidation event | P0 | NOT_RUN |
| SETUP-009 | 설정 완료 요청 중복 전송 | 단계 전환이 한 번만 발생하고 files가 정확한 setup version을 받음 | transition log | P1 | NOT_RUN |

### 7.4 STEP 02 파일 업로드·PDF/Excel 분석·매핑

| ID | 시나리오·행동 | 합격 기준 | 다음 단계 연계·증빙 | 우선순위 | 결과 |
|---|---|---|---|---|---|
| FILE-001 | 이전 분기 PDF와 실제 XLSX를 각각 업로드 | 두 파일 모두 있어야 검사 가능하고 역할이 뒤바뀌지 않음 | upload manifest | P1 | NOT_RUN |
| FILE-002 | 파일 업로드 완료 | 크기·checksum·magic byte·암호화·악성 여부 확인 후 불변 artifact와 hash 저장 | source artifact IDs | P0 | NOT_RUN |
| FILE-003 | 암호화·손상·이미지 전용·전자서명 PDF 업로드 | 정확한 blocker와 교체 안내를 표시하고 다음 단계 차단 | 오류 코드·화면 | P0 | NOT_RUN |
| FILE-004 | `.xls`·`.xlsm`·macro·DDE·external link·손상 XLSX 업로드 | 실행하지 않고 구체적인 위치·이유와 변환 안내 제공 | 검사 결과 | P0 | NOT_RUN |
| FILE-005 | 정상 PDF 분석 | 페이지 크기·방향·폰트·텍스트·표·차트·이미지·벡터·고정/변경 영역을 golden manifest와 100% 일치하게 추출 | Template IR diff | P0 | NOT_RUN |
| FILE-006 | PDF 블록 유형 검사 | narrative·scalar·table·data_chart·fixed_visual·fixed_decoration을 정확히 구분 | block inventory | P0 | NOT_RUN |
| FILE-007 | 서로 다른 페이지 수·회전·좌표의 PDF 분석 | 특정 증권사·페이지·좌표 하드코딩 없이 파일별 Template IR 생성 | variant 결과 | P0 | NOT_RUN |
| FILE-008 | PDF 완전 복제 검사 | 페이지 수·크기 동일, 고정 영역 99.5% 이상, bbox ±0.5pt 이내, overflow 0 | render diff report | P0 | NOT_RUN |
| FILE-009 | PDF 문체 분석 | 종결·길이·제목·숫자 표기·용어 프로필 생성, 숫자·사실 변경 권한 없음 | style profile version | P1 | NOT_RUN |
| FILE-010 | 정상 XLSX 분석 | 모든 visible·hidden 시트, 값·수식·스타일·병합·이름·표·차트·참조·의존성 추출 | Workbook Analysis diff | P0 | NOT_RUN |
| FILE-011 | 사용자 입력 셀 탐지 | 기본 규칙인 노란 배경+파란 글씨 동시 조건을 정확히 적용하고 수식·merged non-anchor·system cell 제외 | editable set diff | P0 | NOT_RUN |
| FILE-012 | 실제값·추정값·계산 결과 영역 분류 | 미래 추정치와 실제값 target이 혼동되지 않음 | cell role inventory | P0 | NOT_RUN |
| FILE-013 | PDF·XLSX 기업·기간·리포트 유형·밸류에이션 구조 비교 | 불일치는 상세 비교와 교체 액션을 제공하고 차단 | compatibility report | P0 | NOT_RUN |
| FILE-014 | scalar slot 매핑 | EPS·PER·목표주가·현재주가 등 필수 scalar가 의미 기반의 정확한 cell/approval에 연결 | ScalarBinding diff | P0 | NOT_RUN |
| FILE-015 | PDF 표와 Excel 표 매핑 | header·row key·기간·단위·subtotal topology가 맞는 정확한 range에 연결 | TableBinding diff | P0 | NOT_RUN |
| FILE-016 | 재무제표 표 매핑 | 손익계산서·대차대조표·투자지표·현금흐름표를 같은 시트여도 4개 독립 slot/range로 연결 | 4개 binding | P0 | NOT_RUN |
| FILE-017 | PDF 데이터 차트와 Excel 차트 매핑 | 각 차트가 독립 slot이며 category·series별 range·축·단위·실적/추정 경계를 저장 | ChartBinding diff | P0 | NOT_RUN |
| FILE-018 | P/E·P/B Band fixture 매핑 | 기간, 수정주가, 각 band series와 EPS/BPS·multiple·price provenance가 존재 | band manifest | P1 | NOT_RUN |
| FILE-019 | fixed visual 검사 | 사업개요·조직도·도표 6 같은 고정 시각 자료가 차트로 오분류·매핑되지 않음 | fixed block list | P0 | NOT_RUN |
| FILE-020 | 매핑 후보가 정확히 하나인 경우 | 근거와 confidence를 제시하고 정확한 후보만 제안 | mapping proposal | P1 | NOT_RUN |
| FILE-021 | 필수 slot에 동률·모호한 후보가 있는 경우 | 자동 확정하지 않고 사용자 보정 요구, 보정 전 다음 단계 차단 | ambiguity 화면 | P0 | NOT_RUN |
| FILE-022 | 사용자가 매핑 보정 | 새 MappingSet revision을 만들고 과거 version을 덮어쓰지 않음 | revision lineage | P0 | NOT_RUN |
| FILE-023 | 필수 동적 slot 전체 검사 | `unmappedRequiredCount=0`, 모든 필수 entry confirmed, fixed visual은 미매핑 수 제외 | completion response | P0 | NOT_RUN |
| FILE-024 | 검사 중 화면 이탈·재진입 | 같은 inspection 진행 상태를 복원하고 완료 결과가 한 번만 게시 | job/run ID | P1 | NOT_RUN |
| FILE-025 | PDF 또는 XLSX 교체 | 이전 검사·mapping을 stale 처리하고 정확한 범위의 downstream 재검증 | invalidation trace | P0 | NOT_RUN |
| FILE-026 | files 완료 | 최신 passed PDF·XLSX·Template IR·Workbook Analysis·MappingSet version만 STEP 03에 고정 | stage handoff manifest | P0 | NOT_RUN |

### 7.5 STEP 03 투자 가설·조사 질문

| ID | 시나리오·행동 | 합격 기준 | 다음 단계 연계·증빙 | 우선순위 | 결과 |
|---|---|---|---|---|---|
| HYP-001 | 잠정 투자의견과 1~500자 가설 입력 | 자동 저장·새로고침 복원, 잠정 의견을 최종 의견으로 표시하지 않음 | hypothesis version | P1 | NOT_RUN |
| HYP-002 | 질문 생성 실행 | 승인 파일·기업·분기·가설로 실제 자료로 답할 수 있는 3~5개 질문 생성 | generation input/output | P1 | NOT_RUN |
| HYP-003 | 생성 질문 품질 검토 | 지표·기간·비교 기준·제안 출처가 명확하고 핵심 driver 포함 | 질문 정답지 비교 | P1 | NOT_RUN |
| HYP-004 | 반증 가능성 검토 | 가설이 틀릴 가능성을 확인할 질문이 최소 1개 존재 | question set | P1 | NOT_RUN |
| HYP-005 | 질문 추가·수정·삭제·정렬 | 3~5개 범위와 metadata를 유지하고 서버 version에 저장 | CRUD 전후 diff | P1 | NOT_RUN |
| HYP-006 | 질문 전체 승인 | 현재 rating·thesis·question set version을 불변으로 고정 | approval version | P0 | NOT_RUN |
| HYP-007 | 승인 후 가설 또는 질문 변경 | 기존 승인 해제, 하위 조사 결과 보존, research 이후 재검증 필요 | invalidation trace | P0 | NOT_RUN |
| HYP-008 | 생성 중 이탈·실패·재시도 | 작업이 계속되고 기존 입력·질문을 잃지 않으며 obsolete 결과가 최신 set을 덮지 않음 | generation run history | P1 | NOT_RUN |
| HYP-009 | 입력에 Agent 역할 변경·schema 변경 지시 삽입 | 시스템 규칙과 정형 출력 schema가 유지되고 지시문은 데이터로 처리 | 보안 테스트 로그 | P0 | NOT_RUN |

### 7.6 STEP 04 자료 수집 계획·수집 실행

| ID | 시나리오·행동 | 합격 기준 | 다음 단계 연계·증빙 | 우선순위 | 결과 |
|---|---|---|---|---|---|
| RPLAN-001 | 승인 질문 plan 표시 | 질문·목적·지표·기간·비교 기준이 정확한 question version과 일치 | plan response | P1 | NOT_RUN |
| RPLAN-002 | 질문별 출처 선택·제외 | 포함 질문마다 필수 출처 최소 1개, 필수/보조 역할을 구조화해 저장 | source policy | P1 | NOT_RUN |
| RPLAN-003 | Excel 실제값 target 표시 | 모든 실제값 입력 대상의 sheet·cell·metric·period·unit·연결/별도 기준 표시 | target list vs golden | P0 | NOT_RUN |
| RPLAN-004 | 수집 target 자동 분류 | 미래 추정치·수식·외부 link cell은 자동 입력 대상에서 제외 | excluded cell list | P0 | NOT_RUN |
| RPLAN-005 | 손익계산서 등 표 채움 계획 | 재무표 각 항목이 정확한 공식 source·기간·단위와 target range에 연결 | table target plan | P0 | NOT_RUN |
| RPLAN-006 | source별 수집 방식 확인 | DART/XBRL·KRX·ECOS는 코드, IR·뉴스·문서는 Agent 해석 등 약속된 역할 분리 | routing log | P1 | NOT_RUN |
| RPLAN-007 | FnGuide 컨센서스 수집 | 기업·기간·분기/연간·scope·지표·단위가 같은 snapshot만 비교 | source snapshot | P0 | NOT_RUN |
| RPLAN-008 | 컨센서스 차이 계산 | 차이=`actual-consensus`, 차이율=`actual/consensus-1`; 0·빈 값 예외 정확 | calculation evidence | P0 | NOT_RUN |
| RPLAN-009 | 오래되거나 기준일 이후 컨센서스 | pinned cutoff 정책에 맞는 snapshot만 사용하고 actual·forecast를 덮어쓰지 않음 | snapshot selection | P0 | NOT_RUN |
| RPLAN-010 | NEWS 출처 선택 | 사용자에게 기사 URL 입력을 요구하지 않고 승인 질문에서 2~4개 검색어 자동 계획 | news plan | P1 | NOT_RUN |
| RPLAN-011 | 뉴스 검색 기간 계산 | 분기 시작 30일 전부터 cutoff까지, KST·최대 240일·양 끝 포함을 정확히 적용 | publication window | P0 | NOT_RUN |
| RPLAN-012 | 뉴스 원문 적격성 | 실제 상세 기사, canonical URL·매체·제목·발행시각·본문·기업·인용 위치 확인 | article manifest | P0 | NOT_RUN |
| RPLAN-013 | 뉴스 제외·중복 제거 | 목록·블로그·광고·paywall·날짜 미상·기간 밖·동명이인·중복 기사를 제외 | 후보/제외 사유 | P1 | NOT_RUN |
| RPLAN-014 | 뉴스 다양성 | 가능한 경우 3개 이상 매체, 동일 매체 최대 2개, 원발행처 우선 | retained articles | P2 | NOT_RUN |
| RPLAN-015 | 기간 내 적격 뉴스 없음 | required면 실패/차단, supporting이면 경고; 기준일 이후 기사로 보충하지 않음 | job outcome | P0 | NOT_RUN |
| RPLAN-016 | 사용자 파일·URL 추가 | 파일 검사와 URL 보안 검증을 통과한 자료만 별도 사용자 출처로 연결 | artifact/source IDs | P0 | NOT_RUN |
| RPLAN-017 | 계획 승인·실행 중복 클릭 | plan과 모든 input version을 pin하고 수집 job 하나만 생성 | approved plan·job ID | P0 | NOT_RUN |
| RPLAN-018 | 실행 상태 관찰 | timer가 아닌 실제 phase·단조 증가 progress 표시, 화면을 닫아도 계속 실행 | projection history | P1 | NOT_RUN |
| RPLAN-019 | 취소·retryable 실패·재시도 | 취소 후 새 Evidence 미발행, 재시도는 마지막 안전 checkpoint부터 수행 | task history | P1 | NOT_RUN |
| RPLAN-020 | 수집 중간 결과 확인 | partial·검증 전 후보 자료가 사용자 승인 결과나 Excel 입력으로 노출되지 않음 | API/UI 확인 | P0 | NOT_RUN |
| RPLAN-021 | 수집 완료 | 정확한 plan·source snapshot·question·MappingSet version을 STEP 05에 전달 | handoff manifest | P0 | NOT_RUN |

### 7.7 STEP 05 조사 결과 검증·Excel 실제값 반영

| ID | 시나리오·행동 | 합격 기준 | 다음 단계 연계·증빙 | 우선순위 | 결과 |
|---|---|---|---|---|---|
| VALD-001 | Validation Agent 입력 검사 | Research Agent의 자유 추론 없이 주장·원문·locator·기업·기간·단위 등 최소 문맥만 전달 | redacted input | P0 | NOT_RUN |
| VALD-002 | 일반 문장 검증 | 원문에 근거 문장이 실제 존재하고 기업·기간이 일치 | quote/locator diff | P0 | NOT_RUN |
| VALD-003 | 재무·운영 숫자 검증 | 통화·단위·scope·기간·actual/잠정/forecast 구분까지 일치 | normalized value | P0 | NOT_RUN |
| VALD-004 | 합계·증감률·컨센서스·Excel 계산 검증 | Agent 답을 사용하지 않고 결정적 코드로 재계산해 정답과 일치 | calculation log | P0 | NOT_RUN |
| VALD-005 | source 우선순위 적용 | DART·IR·KRX·ECOS 등 공식 원천 우선, 이전 증권사 PDF를 새 사실의 최종 근거로 사용하지 않음 | Evidence source types | P0 | NOT_RUN |
| VALD-006 | 검증 실패 후보 확인 | 실패 후보를 검증된 값·주장으로 표시하거나 다음 단계에 전달하지 않음 | failed candidate API/UI | P0 | NOT_RUN |
| VALD-007 | 질문별 결과 표시 | 한 줄 답변·충분성·지지·반박·중립이 승인 Evidence와 정확히 일치 | UI vs Evidence | P1 | NOT_RUN |
| VALD-008 | PDF 원문 열기 | 저장된 source version의 정확한 페이지·bbox를 하이라이트하고 메타데이터 표시 | viewer 증빙 | P0 | NOT_RUN |
| VALD-009 | 뉴스 원문 열기 | 실제 canonical URL을 열고 Text Fragment 실패 시 인용·위치 fallback 유지 | URL·fallback | P1 | NOT_RUN |
| VALD-010 | 출처 충돌 생성 | 양쪽 검증 원문·값·차이를 나란히 표시하고 시스템이 임의 선택하지 않음 | conflict UI | P0 | NOT_RUN |
| VALD-011 | 충돌 값 선택 | Evidence ID·사용자·시각·사유를 append-only로 저장하고 선택값만 confirmed | decision record | P0 | NOT_RUN |
| VALD-012 | 근거 반려·재조사 | 기존 Evidence를 삭제하지 않고 제외하며 새 조사 run/version이 과거를 supersede | version history | P1 | NOT_RUN |
| VALD-013 | Excel 검증 화면 | 실제 workbook 시트·값·수식·스타일을 읽기 전용으로 표시 | workbook screenshot/API | P1 | NOT_RUN |
| VALD-014 | Excel cell 선택 | 선택 cell의 주소·값·기간·단위와 DART/IR 원문 표·문장 위치가 정확히 연결 | cell provenance | P0 | NOT_RUN |
| VALD-015 | 승인된 실제값 Excel 반영 | 각 승인값을 새 작업 사본의 정답 target cell에 100% 정확히 기록 | workbook cell diff | P0 | NOT_RUN |
| VALD-016 | 비승인 영역 보존 | 미승인·반려·forecast·formula·고정 style cell 변경 0건 | full workbook diff | P0 | NOT_RUN |
| VALD-017 | Excel 수식 재계산 | 변경값 반영 후 수식·참조·합계가 성공하고 정답 output과 일치 | worker result | P0 | NOT_RUN |
| VALD-018 | 구조 hash 검사 | 값만 변경되면 binding 유지, sheet/range/formula 구조가 달라지면 매핑 재확인 | structure comparison | P0 | NOT_RUN |
| VALD-019 | provenance 연속성 | source value → Evidence → target cell → formula output → report slot 경로 생성 | lineage graph | P0 | NOT_RUN |
| VALD-020 | 완료 gate | 핵심 숫자 실패·필수 근거 없음·충돌 미해결·cell 원문 연결 실패 중 하나라도 있으면 차단 | blocker response | P0 | NOT_RUN |
| VALD-021 | STEP 05 완료 | Evidence/Validation approval과 Validated Workbook version을 함께 고정해 STEP 06 전달 | handoff manifest | P0 | NOT_RUN |

### 7.8 STEP 06 Excel 추정치·PER 밸류에이션

| ID | 시나리오·행동 | 합격 기준 | 다음 단계 연계·증빙 | 우선순위 | 결과 |
|---|---|---|---|---|---|
| VLT-001 | STEP 06 최초 진입 | STEP 05가 만든 정확한 Validated Workbook version을 로드 | workbook version | P0 | NOT_RUN |
| VLT-002 | workbook 표시 | 실제 파일명·visible 시트·셀·서식·병합·행열 크기·freeze pane을 보존 | UI vs workbook | P1 | NOT_RUN |
| VLT-003 | 입력 가능 cell 검사 | 승인 editable set의 사용자 입력 셀만 편집 가능 | editable set test | P0 | NOT_RUN |
| VLT-004 | formula·actual·hidden·system cell 편집 시도 | 모든 경로에서 거부되고 원본 값·구조 유지 | mutation response | P0 | NOT_RUN |
| VLT-005 | 잠긴 cell을 포함한 multi-cell paste | batch 전체를 원자적으로 거절 | before/after diff | P0 | NOT_RUN |
| VLT-006 | forecast driver 입력 | 새 workbook version 생성, 서버 계산 후 영향 cell·차트·Forward EPS 갱신 | calculation delta | P0 | NOT_RUN |
| VLT-007 | 입력 cell 영향 범위 확인 | EPS·PER·목표주가·보고서 전용·inactive·unmapped 영향이 실제 의존성과 일치 | impact graph | P1 | NOT_RUN |
| VLT-008 | 계산 실패 유도 | batch 전체가 이전 version·값으로 원복되고 성공으로 표시하지 않음 | rollback evidence | P0 | NOT_RUN |
| VLT-009 | Target PER 입력 | 사용자 입력만 허용, 0.1~100.0·소수 한 자리 검증, 자동 AI 확정 없음 | draft/approval | P0 | NOT_RUN |
| VLT-010 | 목표주가 직접 입력 | formula cell을 덮어쓰지 않고 역산 PER을 계산해 workbook과 동기화 | inverse calculation | P0 | NOT_RUN |
| VLT-011 | 목표주가·상승여력 계산 | `Forward EPS×Target PER`, `목표주가/현재주가-1`과 decimal 반올림이 정답과 일치 | calculation comparison | P0 | NOT_RUN |
| VLT-012 | 민감도 분석 | 서버가 계산한 5×5 EPS·PER grid와 현재 선택 지점이 정확 | sensitivity response | P1 | NOT_RUN |
| VLT-013 | 선택 cell·핵심 output provenance | 주소·단위·기간·역할·source와 Forward EPS/PER/가격 원천을 확인 가능 | provenance panel | P0 | NOT_RUN |
| VLT-014 | 저장·원본 보존 | 업로드 원본 XLSX hash 불변, 변경 전후·사용자 이력이 작업 사본에 기록 | artifact hashes | P0 | NOT_RUN |
| VLT-015 | valuation 승인 | 정확한 workbook·calculation run·price snapshot·decision을 immutable version으로 고정 | valuation approval | P0 | NOT_RUN |
| VLT-016 | 승인 후 임의 cell 변경 | 기존 approval을 supersede하고 outline·report·export를 재검증 필요로 전환 | invalidation trace | P0 | NOT_RUN |
| VLT-017 | STEP 06 완료 | blocker 0건일 때만 최신 승인 Workbook과 EPS·PER·가격 snapshot을 STEP 07에 전달 | handoff manifest | P0 | NOT_RUN |
| VLT-018 | 현재주가 snapshot 선택 | 기준일 또는 직전 거래일 KRX 종가를 사용하고 기업·거래소·시각·가격이 immutable snapshot에 고정 | KRX source snapshot | P0 | NOT_RUN |

### 7.9 STEP 07 페이지 내용 설정

| ID | 시나리오·행동 | 합격 기준 | 다음 단계 연계·증빙 | 우선순위 | 결과 |
|---|---|---|---|---|---|
| OUT-001 | STEP 07 최초 진입 | 최신 valuation approval이 없으면 차단, 있으면 exact version 표시 | gate response | P0 | NOT_RUN |
| OUT-002 | 페이지 구조 표시 | Template IR과 같은 페이지 수·순서·block·slot을 표시 | page inventory | P0 | NOT_RUN |
| OUT-003 | 고정·동적 영역 구분 | 페이지·section·slot 추가·삭제·순서 변경 불가, fixed 영역 보호 | mutation tests | P0 | NOT_RUN |
| OUT-004 | Outline Agent 추천 | 승인 Evidence·Workbook·Valuation만 사용하고 새 숫자·출처·페이지·block을 만들지 않음 | agent input/output | P0 | NOT_RUN |
| OUT-005 | 제목·소제목·전개 방향 편집 | 허용 text만 저장되고 숫자 권위값은 자유 텍스트로 복사하지 않음 | outline diff | P1 | NOT_RUN |
| OUT-006 | 표·차트 slot 검토 | 실제 Template IR slot, confirmed MappingSet, sheet/range preview·단위·기간 표시 | slot cards | P0 | NOT_RUN |
| OUT-007 | 지지·반박·중립 Evidence 검토 | 누락 없이 표시하고 정확한 source locator를 열 수 있음 | Evidence list/viewer | P1 | NOT_RUN |
| OUT-008 | 각 페이지 확인 후 내용 변경 | 해당 페이지 확인 상태만 무효화 | page review history | P1 | NOT_RUN |
| OUT-009 | 미매핑·stale·invalid slot 존재 | 전체 승인을 차단하고 Step 2 연결 수정 경로 제공 | blocker/route | P0 | NOT_RUN |
| OUT-010 | 전체 승인 | Template IR·MappingSet·Workbook·Evidence·Valuation·Outline version을 고정 | outline approval manifest | P0 | NOT_RUN |
| OUT-011 | 승인 중복 클릭·화면 이탈 | materialization task 하나만 생성되고 백그라운드 실행·복원 | task ID·projection | P1 | NOT_RUN |
| OUT-012 | 초안 생성 실패 | 원본 PDF를 완료 초안으로 표시하지 않고 실패 이유·재시도·상위 이동 제공 | failure UI | P0 | NOT_RUN |

### 7.10 보고서 초안 물질화·편집

| ID | 시나리오·행동 | 합격 기준 | 다음 단계 연계·증빙 | 우선순위 | 결과 |
|---|---|---|---|---|---|
| RPT-001 | `/report` 최초 진입 | 승인 Evidence·Workbook·Valuation·Outline을 사용한 materialized draft가 이미 표시 | report manifest | P0 | NOT_RUN |
| RPT-002 | 원본 PDF와 초안 비교 | 원본은 비교 보기에서만 보이고 기본 문서는 새 report draft artifact | artifact IDs | P0 | NOT_RUN |
| RPT-003 | scalar 물질화 | EPS·PER·목표주가·현재주가 등 모든 scalar가 원래 slot에서 최신 승인값으로 교체 | scalar diff | P0 | NOT_RUN |
| RPT-004 | 재무표 물질화 | 손익계산서·대차대조표·투자지표·현금흐름표가 각각 최신 값의 독립 표로 생성 | table snapshots | P0 | NOT_RUN |
| RPT-005 | 데이터 차트 물질화 | 모든 차트가 최신 category·series·axis·단위·실적/추정 구분으로 재생성 | chart data diff | P0 | NOT_RUN |
| RPT-006 | 차트 디자인 보존 | 이전 분기 style template의 색·선·축·범례·라벨 스타일을 기본 사용 | visual diff | P1 | NOT_RUN |
| RPT-007 | fixed visual 보존 | 도표 6·로고·배경·고지 등 고정 영역이 원본 그대로이며 편집 hotspot 없음 | fixed mask diff | P0 | NOT_RUN |
| RPT-008 | 과거 값 잔존 검사 | 이전 기업·연도·분기·날짜·목표주가·동적 문구 잔존 0건 | old-value scan | P0 | NOT_RUN |
| RPT-009 | 차트·표 선택 | 각 차트와 4개 재무표가 서로 겹치지 않는 독립 block으로 한 개씩 선택 | interaction recording | P1 | NOT_RUN |
| RPT-010 | `연결 확인` 열기 | Workbook/Mapping version, stable sheet ID, range, formula, format, category, series, axis, Evidence를 읽기 전용으로 표시 | provenance panel | P0 | NOT_RUN |
| RPT-011 | 보고서 화면에서 연결 변경 시도 | 직접 변경 불가, Step 2에서 새 MappingSet revision을 만드는 경로 제공 | UI/route | P0 | NOT_RUN |
| RPT-012 | ChartStudio에서 호환 차트 형태 변경 | 적용 전 preview, data hash·category·series·단위·실적/추정 구분 불변, 새 report version 생성 | before/after manifest | P0 | NOT_RUN |
| RPT-013 | 의미를 훼손하는 차트 선택 시도 | 시계열 원형 차트·축 의미 변경 등 비호환 유형을 제공하거나 적용하지 않음 | allowlist evidence | P1 | NOT_RUN |
| RPT-014 | TableStudio 편집 | 너비·정렬·강조·표시 단위 등 표현만 변경하고 raw 값·수식 결과 불변 | table hash diff | P0 | NOT_RUN |
| RPT-015 | 허용 본문 편집·저장 | typed operation으로 저장, 새로고침 복원, undo·redo와 revision 일관 | operation log | P1 | NOT_RUN |
| RPT-016 | AI 문장 수정 | 적용 전 diff, 선택 block 한정, 숫자·Evidence·투자의견·가정·사실 불변 | proposal diff | P0 | NOT_RUN |
| RPT-017 | Excel 연결 숫자 직접 편집 시도 | 자유 텍스트 변경을 차단하고 STEP 05/06 이동 경로 제공 | interaction result | P0 | NOT_RUN |
| RPT-018 | 문장 overflow 발생 | 의미·숫자·근거를 보존해 축약 후 사용자 확인; 글자 축소·자동 페이지 추가 금지 | render attempt | P0 | NOT_RUN |
| RPT-019 | 선택 block 근거 확인 | PDF/HTML/API 원문 또는 Excel 계산 경로를 정확히 재현 | provenance trace | P0 | NOT_RUN |
| RPT-020 | 두 탭 동시 편집 | edit lease·conflict로 최신 변경을 보호하고 조용한 덮어쓰기 없음 | concurrency log | P1 | NOT_RUN |
| RPT-021 | 보고서 변경 후 preview·검증 상태 | 기존 preview·validation·approval·export 가능 상태를 즉시 stale 처리 | invalidation trace | P0 | NOT_RUN |
| RPT-022 | materialization 중 input version 변경 | 오래된 task 결과를 active report로 게시하지 않음 | obsolete task log | P0 | NOT_RUN |
| RPT-023 | 표·차트 생성 방식 검사 | 숫자·표·차트는 승인 데이터에서 결정적 코드로 생성하며 AI 이미지 생성 결과를 사용하지 않음 | render pipeline·artifact type | P0 | NOT_RUN |
| RPT-024 | 빈 값·음수·오류·단위 표본 물질화 | 빈 값, `#N/A`, 음수, %, 배, 원·천원·백만원·억원을 승인 number format 정책대로 표시 | formatted/raw value diff | P0 | NOT_RUN |

### 7.11 최종 검증·승인·내보내기

| ID | 시나리오·행동 | 합격 기준 | 필수 증빙 | 우선순위 | 결과 |
|---|---|---|---|---|---|
| EXP-001 | 출력 미리보기 생성 | 브라우저 캡처가 아닌 server-rendered 새 PDF artifact를 사용 | preview artifact/hash | P0 | NOT_RUN |
| EXP-002 | 본문·표·차트 숫자 교차 검사 | 모든 raw decimal·formatted 값·단위·반올림이 승인 Workbook과 일치 | reconciliation report | P0 | NOT_RUN |
| EXP-003 | EPS·PER·목표주가·상승여력 재계산 | 승인 snapshot과 정답 계산에 100% 일치 | validation details | P0 | NOT_RUN |
| EXP-004 | 주장·출처 검사 | 모든 핵심 문장에 승인 Evidence·locator 존재, cutoff 이후 source 0건 | Evidence coverage report | P0 | NOT_RUN |
| EXP-005 | 구조·시각 검사 | 페이지 수·크기 동일, 고정 영역 99.5% 이상, bbox ±0.5pt 이내 | PDF diff report | P0 | NOT_RUN |
| EXP-006 | overflow·clipping·font·z-order 검사 | overflow·clipping 0건, font 부재 경고와 실제 overflow blocker를 구분 | render validation | P0 | NOT_RUN |
| EXP-007 | blocker 주입 | 차단 오류 하나라도 있으면 승인·export 버튼과 API 모두 거부 | UI/API response | P0 | NOT_RUN |
| EXP-008 | 최종 승인 | exact report version과 exact validation run을 immutable approval로 저장 | report approval | P0 | NOT_RUN |
| EXP-009 | 승인 후 편집 | 과거 승인본을 바꾸지 않고 새 working version과 재검증 상태 생성 | version history | P0 | NOT_RUN |
| EXP-010 | PDF·XLSX export | 두 형식만 생성하고 DOCX는 제공하지 않음 | export manifest | P1 | NOT_RUN |
| EXP-011 | final PDF 확인 | source PDF와 다른 새 artifact이며 최신 동적 값이 실제 PDF 객체·렌더에 반영 | source/final hash·render | P0 | NOT_RUN |
| EXP-012 | final XLSX 확인 | valuation approval에 pinned된 서버 작업 사본이며 브라우저 생성본이 아님 | workbook hash/version | P0 | NOT_RUN |
| EXP-013 | PDF·XLSX snapshot 비교 | MappingSet·Evidence·Workbook·Valuation·Outline·Report version이 모두 동일 | manifest comparison | P0 | NOT_RUN |
| EXP-014 | 한 형식만 실패 | 성공 artifact 유지, 실패 형식만 재시도하고 중복 생성·버전 혼선 없음 | partial/retry history | P1 | NOT_RUN |
| EXP-015 | 화면 이탈·worker 재시작·URL 만료 | export 상태 복원, 만료 URL만 재발급하고 artifact 재생성·권한 우회 없음 | task/download logs | P1 | NOT_RUN |
| EXP-016 | 과거 승인 version 재다운로드 | 당시 snapshot의 PDF·XLSX를 동일 hash 또는 동일 내용으로 재현 | historical artifacts | P0 | NOT_RUN |
| EXP-017 | preview와 final PDF 렌더 경로 비교 | 두 산출물이 동일 canonical Render Scene·renderer 계약을 사용하고 브라우저 overlay 전용 표현이 final에서 사라지지 않음 | render scene/hash comparison | P0 | NOT_RUN |

## 8. 단계 간 연결·버전 계보 평가표

이 절은 각 단계가 개별적으로 PASS여도 반드시 별도로 실행한다.

### 8.1 Handoff 계약

| ID | 이전 단계 산출물 → 다음 단계 | 합격 기준 | 필수 증빙 | 우선순위 | 결과 |
|---|---|---|---|---|---|
| LINK-001 | Setup → Files | files가 정확한 company·period·cutoff·setup version으로 적합성 검사 | input manifest | P0 | NOT_RUN |
| LINK-002 | Files → Hypothesis | 최신 passed PDF/XLSX·Template IR·Workbook Analysis·MappingSet만 사용 | version refs | P0 | NOT_RUN |
| LINK-003 | MappingSet → Research plan | 질문 metric과 Excel actual target이 confirmed semantic slot을 참조 | target refs | P0 | NOT_RUN |
| LINK-004 | Hypothesis approval → Research plan | 승인한 3~5개 질문과 metadata가 변형 없이 plan에 표시 | version diff | P0 | NOT_RUN |
| LINK-005 | Research plan → Collection job | 승인 source·기간·cutoff·artifact version이 job input에 pin | job input | P0 | NOT_RUN |
| LINK-006 | Collection → Validation | raw 후보가 먼저 노출되지 않고 source snapshot·locator가 독립 검증 입력으로 전달 | envelope trace | P0 | NOT_RUN |
| LINK-007 | Validation → Validated Workbook | 승인 Evidence 값만 정답 target cell에 기록되고 decision ID 연결 | application plan/result | P0 | NOT_RUN |
| LINK-008 | Validated Workbook → Valuation | STEP 06이 정확한 validated artifact와 재계산 결과를 사용 | workbook refs | P0 | NOT_RUN |
| LINK-009 | Valuation → Outline | EPS·PER·목표주가·현재주가 snapshot과 approval이 slot에 연결 | outline refs | P0 | NOT_RUN |
| LINK-010 | Outline → Materializer | Template IR·MappingSet·Workbook·Evidence·Valuation·Outline exact versions 고정 | task input | P0 | NOT_RUN |
| LINK-011 | Materializer → Editor | 검증 전·부분·원본 fallback이 아닌 완료 report version만 공개 | publication event | P0 | NOT_RUN |
| LINK-012 | Report approval → Export | exact report·validation snapshot으로 PDF·XLSX 생성, export 시 최신값 재조회 금지 | export input | P0 | NOT_RUN |

### 8.2 상위 변경과 하위 무효화

| ID | 변경 시나리오 | 유지해야 할 것 | 재검증·재생성해야 할 것 | 우선순위 | 결과 |
|---|---|---|---|---|---|
| INV-001 | 기업·기준일·기간 변경 | 과거 승인본·원본 artifact | files 이후 전체 | P0 | NOT_RUN |
| INV-002 | PDF 교체 | 원본 Workbook | Template IR·MappingSet·outline·report·export | P0 | NOT_RUN |
| INV-003 | XLSX 값 변경·구조 동일 | Template IR·조건부 MappingSet | validation·workbook apply·valuation·report | P0 | NOT_RUN |
| INV-004 | XLSX 구조 변경 | Template IR | Workbook Analysis·MappingSet 이후 전체 | P0 | NOT_RUN |
| INV-005 | MappingSet revision 변경 | PDF·XLSX source artifact | research target·validation·valuation·outline·report | P0 | NOT_RUN |
| INV-006 | Evidence 승인·충돌 결정 변경 | 파일·매핑·과거 Evidence | Validated Workbook 이후 전체 | P0 | NOT_RUN |
| INV-007 | Workbook 추정 cell 변경 | 파일·Evidence·과거 workbook | valuation·outline·report·export | P0 | NOT_RUN |
| INV-008 | Valuation 변경 | 파일·Evidence·승인 workbook | outline·report·export | P0 | NOT_RUN |
| INV-009 | Outline 변경 | 모든 앞 단계 승인본 | materialization·report validation·export | P0 | NOT_RUN |
| INV-010 | 본문·표시 차트 변경 | pinned data snapshot | preview·validation·approval·export | P0 | NOT_RUN |
| INV-011 | 무효화 뒤 기존 승인본 열기 | 당시 version으로 읽기·재현 가능, active 최신본으로 오인하지 않음 | historical view | P0 | NOT_RUN |
| INV-012 | 오래된 job이 무효화 뒤 완료 | 결과를 보존해도 active projection으로 게시하지 않음 | late result log | P0 | NOT_RUN |

## 9. 실패 복구·보안·운영 평가표

| ID | 시나리오·행동 | 합격 기준 | 필수 증빙 | 우선순위 | 결과 |
|---|---|---|---|---|---|
| OPS-001 | 모든 장시간 작업 중 화면 이탈·재접속 | 같은 run의 실제 상태·progress·결과 복원 | run IDs | P1 | NOT_RUN |
| OPS-002 | 중복 클릭·재전송 | 프로젝트·inspection·generation·collection·approval·export가 각각 한 번만 반영 | idempotency logs | P0 | NOT_RUN |
| OPS-003 | worker timeout·종료·재시작 | retryable 여부를 정확히 분류하고 안전 checkpoint부터 재개 | task history | P1 | NOT_RUN |
| OPS-004 | queued/running job 취소 | 새 결과 미발행, partial artifact 비공개, 임시 자원 정리 | cancel audit | P1 | NOT_RUN |
| OPS-005 | non-retryable 입력 오류 | 무한 재시도 없이 교체·보정·이전 단계 이동 액션 제공 | error UI | P1 | NOT_RUN |
| OPS-006 | 역순·늦은 API 응답 | 최신 입력·version·화면 상태를 덮어쓰지 않음 | request/version trace | P0 | NOT_RUN |
| OPS-007 | 사용자 A가 B의 ID·URL·artifact key 사용 | 목록·API·viewer·download 모두 정보 노출 없는 거부 | 보안 로그 | P0 | NOT_RUN |
| OPS-008 | 만료·변조 signed URL 사용 | 소유권과 scope 재검증 없이 재발급·다운로드 불가 | URL test | P0 | NOT_RUN |
| OPS-009 | 악성 PDF·XLSX·zip bomb·OOXML·path traversal 표본 | worker·web process·다른 사용자에 영향 없이 격리·거절 | sandbox logs | P0 | NOT_RUN |
| OPS-010 | 사용자 URL로 private IP·localhost·metadata·위험 redirect 요청 | 모든 DNS/IP·redirect 단계에서 차단 | network policy log | P0 | NOT_RUN |
| OPS-011 | 문서·뉴스에 prompt injection 삽입 | 문서는 데이터로만 처리되고 Agent 도구·role·schema·권한 불변 | Agent audit | P0 | NOT_RUN |
| OPS-012 | 뉴스·유료 자료 표시 | 기사 전체 재배포 없이 최소 인용·요약·URL·locator만 노출 | UI·stored artifact policy | P1 | NOT_RUN |
| OPS-013 | 일반 로그 검사 | 원문·검색어 전문·secret·object key·로컬 경로 없이 ID·hash·상태 중심 | log sample | P1 | NOT_RUN |
| OPS-014 | 오류 발생 후 사용자 입력 | 입력·승인 가능한 과거 version이 사라지지 않고 재시도 가능 | before/after state | P1 | NOT_RUN |

## 10. 사용성·접근성·성능 평가표

| ID | 시나리오·행동 | 합격 기준 | 필수 증빙 | 우선순위 | 결과 |
|---|---|---|---|---|---|
| UX-001 | 키보드만으로 정상 E2E의 핵심 작업 수행 | 로그인 이후 각 단계 입력·검토·승인·내보내기 가능 | 키보드 실행 녹화 | P2 | NOT_RUN |
| UX-002 | modal·drawer·viewer·splitter 사용 | focus 진입·가두기·Escape·호출 위치 복귀와 이름·상태 제공 | 접근성 검사 | P2 | NOT_RUN |
| UX-003 | 오류·진행·포함·선택 상태 확인 | 색상만으로 전달하지 않고 텍스트·아이콘·ARIA 상태 제공 | 접근성 tree | P2 | NOT_RUN |
| UX-004 | desktop·tablet·mobile 핵심 흐름 | 정보 손실 없이 사용 가능하며 PDF 페이지 내부 좌표를 모바일에서 임의 재배치하지 않음 | viewport screenshots | P2 | NOT_RUN |
| UX-005 | `prefers-reduced-motion` | 장식 전환을 줄여도 모든 기능과 상태 인지가 동일 | reduced-motion run | P2 | NOT_RUN |
| PERF-001 | file inspection 30회 이상 측정 | 지원 범위 fixture에서 p95 30초 이내 | timing report | P2 | NOT_RUN |
| PERF-002 | Workbook 적용·재계산 30회 이상 측정 | p95 30초 이내, 정확성 검사를 생략하지 않음 | timing report | P2 | NOT_RUN |
| PERF-003 | report materialization 30회 이상 측정 | p95 20초 이내 | timing report | P2 | NOT_RUN |
| PERF-004 | PDF preview render 30회 이상 측정 | p95 30초 이내 | timing report | P2 | NOT_RUN |
| PERF-005 | cached chart variant preview 30회 이상 측정 | p95 200ms 이내, data hash 불변 | timing/data report | P2 | NOT_RUN |

## 11. 평가 집계표

| 영역 | P0 PASS/대상 | P1 PASS/대상 | P2 PASS/대상 | PARTIAL | FAIL | BLOCKED | NOT_RUN | 영역 점수 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 공통 E2E |  |  |  |  |  |  |  |  |
| 홈·로그인·프로젝트 |  |  |  |  |  |  |  |  |
| STEP 01 설정 |  |  |  |  |  |  |  |  |
| STEP 02 파일·매핑 |  |  |  |  |  |  |  |  |
| STEP 03 가설·질문 |  |  |  |  |  |  |  |  |
| STEP 04 수집 계획·실행 |  |  |  |  |  |  |  |  |
| STEP 05 검증·Excel 반영 |  |  |  |  |  |  |  |  |
| STEP 06 밸류에이션 |  |  |  |  |  |  |  |  |
| STEP 07 보고서 구성 |  |  |  |  |  |  |  |  |
| 보고서 초안·편집 |  |  |  |  |  |  |  |  |
| 검증·승인·내보내기 |  |  |  |  |  |  |  |  |
| 단계 간 연결·무효화 |  |  |  |  |  |  |  |  |
| 복구·보안·운영 |  |  |  |  |  |  |  |  |
| 사용성·성능 |  |  |  |  |  |  |  |  |
| **전체** |  |  |  |  |  |  |  |  |

### 최종 판정

| 항목 | 결과 |
|---|---|
| 실행 커버리지 |  |
| 가중 점수 |  |
| P0 비합격 수 |  |
| P1 FAIL·BLOCKED 수 |  |
| 즉시 실패 조건 발생 여부 |  |
| 종합 판정 | 평가 미완료 |
| 판정 사유 |  |

## 12. 결함 기록 양식

| 결함 ID | 연관 테스트 ID | 심각도 | 재현 절차 | 실제 결과 | 기대 결과 | 영향받은 downstream | 증빙 | 상태 |
|---|---|---|---|---|---|---|---|---|
|  |  |  |  |  |  |  |  |  |

심각도는 다음처럼 기록한다.

- `Critical`: 재무값 오류, 잘못된 자동 매핑, 비승인 쓰기, 계보·보안·최종 산출물 위반
- `High`: 핵심 단계 진행 불가, 잘못된 차단·무효화, 복구 불가
- `Medium`: 핵심 결과는 맞지만 일부 기능·상태·증빙이 불완전
- `Low`: 접근성·표현·보조 사용성 문제

## 13. 권장 실행 순서

1. `FX-HAPPY-ISC` 정답지와 입력 hash를 고정한다.
2. `E2E-001`을 먼저 실행해 첫 blocker를 찾는다.
3. 실패한 단계의 세부 항목을 실행해 원인을 분리한다.
4. 정상 흐름을 완료한 뒤 `LINK-*`와 `INV-*`를 실행한다.
5. `FX-PDF-VARIANTS`, `FX-XLSX-VARIANTS`, `FX-MULTI-BROKER`로 일반화를 평가한다.
6. `FX-NEGATIVE`, `FX-VERSIONING`, `FX-USERS`로 실패 복구와 보안을 평가한다.
7. 최종 PDF·XLSX를 golden manifest와 기계적으로 비교한다.
8. 모든 `NOT_RUN`을 제거하고 점수·판정·결함 목록을 작성한다.

평가 도중 blocker를 우회하기 위해 DB 값을 직접 수정하거나 승인 flag를 강제로 바꾸면 해당 종단간 항목은 PASS가 아니다. 우회한 지점은 `BLOCKED`로 남기고, 우회 뒤의 하위 항목은 별도 진단 결과로만 기록한다.
