# REFLO 기술 확정 사항 v1

**문서 상태:** 기술 의사결정 기준선  
**작성 기준일:** 2026-07-22  
**연결 문서:** `REFLO_URL_SERVICE_BEHAVIOR_v1.md`, `REFLO_SYSTEM_ARCHITECTURE_v1.md`, `REFLO_ERD_v1.md`, `REFLO_API_SPEC_v1.md`
**운영 방식:** 기술 결정을 하나씩 확정할 때마다 결정 ID를 추가하고 변경 이력을 기록한다.

## 1. 문서 목적

이 문서는 REFLO 구현에 영향을 주는 기술 결정을 누적 관리한다. 요구사항을 다시 설명하기보다 선택한 방식, 선택 이유, 허용하지 않는 방식, 검증 기준, 남은 결정을 기록한다.

결정 상태는 다음 세 가지를 사용한다.

- `확정`: 구현 기준으로 사용한다.
- `일단 확정`: 방향은 확정했지만 구현해보고 아니다 싶으면 다른 기술로 바꿀 수도 있다.
- `미확정`: 비교·검토 중이며 구현 기준으로 사용할 수 없다.

결정 상태와 delivery gate는 분리한다. `일단 확정`은 구현 방향으로 사용할 수 있지만 해당 기술의 표본·라이선스·운영 검증을 통과하기 전 production에 배포할 수 있다는 뜻은 아니다.

## 2. 결정 목록

| ID | 영역 | 결정 | 상태 | 확정일 |
|---|---|---|---|---|
| TD-001 | PDF 생성 | 객체 보존형 하이브리드 패치 방식 채택 | 일단 확정 | 2026-07-22 |
| TD-002 | PDF 폰트 | 관리형 폰트 매칭 후 미확보 폰트는 대체하여 초안 생성 | 확정 | 2026-07-22 |
| TD-003 | Excel 입력 셀 | 노란색 배경과 파란색 글씨 조합으로 직접 입력 셀 판정 | 확정 | 2026-07-22 |
| TD-004 | Excel 수식 재계산 | ClosedXML 0.105.0 기반 독립 계산 서비스 채택 | 확정 | 2026-07-25 |
| TD-005 | PDF↔Excel 매핑 | 의미 슬롯 기반 Scalar·Table·Chart 데이터 매핑 채택 | 확정 | 2026-07-22 |
| TD-006 | Template IR | Page·Block·Slot·Physical Object 계층의 버전형 JSON IR 채택 | 확정 | 2026-07-22 |
| TD-007 | PDF 처리 라이브러리 | PyMuPDF/MuPDF 분석 엔진과 pikepdf/qpdf 정밀 수정 엔진 조합 채택 | 일단 확정 | 2026-07-23 |
| TD-008 | PDF 시각 검증 | PDFium 288 DPI 렌더링과 OpenCV 마스크별 하이브리드 비교 채택 | 일단 확정 | 2026-07-23 |
| TD-010 | 웹 Excel UI | React 전용 workbook grid와 ClosedXML 서버 권위 계산 구조 채택 | 확정 | 2026-07-25 |
| TD-011 | 파일·작업 실행 환경 | S3 호환 불변 객체 저장소, PostgreSQL 메타데이터, Temporal과 사전 가동 격리 워커 조합 채택 | 일단 확정 | 2026-07-23 |
| TD-012 | Evidence 저장 | 원문 객체 저장소와 PostgreSQL 불변 Evidence·locator·provenance 분리 저장 방식 채택 | 일단 확정 | 2026-07-23 |
| TD-013 | 컨센서스 공급자 | FnGuide JSON 기반 격리 공급자, 불변 스냅샷과 기준시점 선택 규칙 채택 | 일단 확정 | 2026-07-23 |
| TD-014 | 인증·세션 | Google 로그인과 PostgreSQL 기반 불투명 server session 채택 | 확정 | 2026-07-24 |
| TD-015 | 보고서 기준일 | 사용자 입력 date-only와 Asia/Seoul 일말 기준 권위 시각 채택 | 확정 | 2026-07-24 |
| TD-016 | 작업 상태 전달 | visibility-aware polling을 MVP 기본 transport로 채택 | 확정 | 2026-07-24 |
| TD-017 | AI Agent | PydanticAI와 OpenAI GPT provider 조합 채택 | 확정 | 2026-07-24 |
| TD-018 | 인증·PostgreSQL 도구 | openid-client, node-postgres, node-pg-migrate 채택과 exact version 고정 | 확정 | 2026-07-25 |
| TD-019 | 파일 입력 운영 정책 | 입력 한도, 악성 검사, 지원 형식, 매핑 보정과 취소 정책 확정 | 확정 | 2026-07-25 |
| TD-020 | Validation 충분성 | 질문 충분성 판정, 조건부 확인과 decision 사유 규칙 확정 | 확정 | 2026-07-25 |
| TD-021 | Valuation 수치·workbook grid | workbook read model, Decimal·반올림·민감도·현재주가 정책 확정 | 확정 | 2026-07-25 |
| TD-022 | Report 편집·미리보기 | editor·PDF viewer, edit lease, import, 보존·경고·파일명 정책 확정 | 확정 | 2026-07-25 |
| TD-023 | Agent 실행 profile | PydanticAI·OpenAI SDK, model, timeout·비용·보존 정책 확정 | 확정 | 2026-07-25 |

### 2.1 Delivery gate

| gate | 대상 | 해제 조건 |
|---|---|---|
| 공통 구현 시작 | 없음 | TD-018 확정으로 Phase 0 도구 선택 완료 |
| Excel worker 구현 | TD-004 | `ClosedXML 0.105.0` 기준 workbook 재계산·왕복 저장·Excel 16.0 교차검증 완료 |
| PDF worker 구현 | TD-007, TD-008 | PyMuPDF·pikepdf·PDFium·OpenCV exact version, AGPL-3.0 소스 제공 경로와 기준 PDF 자동 회귀 확인 |
| React workbook grid 통합 | TD-010, TD-021 | fixture 기반 read model·편집 권한·keyboard·paste·local browser regression 확인 |
| Agent 통합 | TD-017, TD-023 | 고정 package·model profile과 prompt/schema fixture 평가 통과 |
| production 배포 | TD-001, TD-004, TD-007, TD-008, TD-010~TD-013, TD-017, TD-019~TD-023 | AGPL-3.0 대응 소스 공개, third-party 고지, 표본 회귀, 성능·복구·보존 정책 통과 |

TD-002, TD-003, TD-005, TD-006, TD-014~TD-016과 TD-018은 별도 기술 선택 때문에 구현을 막지 않는다. 실제 구현의 test와 migration 완료 조건은 각 명세의 acceptance criteria로 관리한다.

---

## TD-001. PDF 완전 복제 방식

### 상태

`일단 확정`

복제 전략은 확정했다. 폰트 처리 정책은 TD-002로 확정했으며, 세부 라이브러리 조합은 TD-007로 일단 확정했다. 시각 비교 알고리즘은 TD-008에서 별도로 확정한다.

### 배경

REFLO는 업로드된 이전 분기 증권사 PDF의 페이지 수, 크기, 디자인, 고정 자산과 레이아웃을 유지하면서 숫자, 문장, 표, 차트만 새 분기 데이터로 갱신해야 한다.

PDF를 처음부터 다시 만들면 폰트 메트릭, 자간, 행간, 좌표, clipping, transparency, 벡터 객체 차이 때문에 완전 복제 기준을 안정적으로 만족하기 어렵다. 전체 페이지를 이미지로 사용하면 텍스트 선택, 검색, 확대, 인쇄 품질과 근거 좌표 연결이 훼손된다.

### 결정

REFLO의 PDF 생성 방식으로 **원본 PDF 객체를 보존하고 변경 영역만 교체하는 객체 보존형 하이브리드 패치 방식**을 채택한다.

핵심 원칙:

1. 업로드된 이전 분기 PDF를 새 보고서의 기준 자산으로 사용한다.
2. 고정 요소는 추출 후 재생성하지 않고 원본 PDF 객체와 리소스를 최대한 그대로 보존한다.
3. 변경 요소만 식별해 기존 콘텐츠를 물리적으로 제거하고 같은 좌표와 스타일 안에 새 벡터 콘텐츠를 삽입한다.
4. 단순 숫자는 안전한 경우 기존 PDF 렌더링 명령을 최소 수정한다.
5. 문장, 표, 차트는 원본 영역 경계 안에서 벡터로 다시 렌더링한다.
6. 전체 페이지 이미지화는 허용하지 않는다.
7. 생성 후 고정 영역과 변경 영역을 분리해 렌더링 회귀검사를 수행한다.
8. 자동 검사에 실패하면 일반 템플릿으로 대체하지 않고 진행을 차단한다. 단, 원본 폰트 부재는 TD-002에 따라 초안 생성 차단 사유에서 제외한다.

### 처리 구조

```text
원본 PDF 입력
  → 페이지·객체·리소스 분석
  → Template IR 생성
  → 고정 요소 / 변경 요소 / 데이터 연결 요소 분류
  → 변경 요소의 기존 콘텐츠 제거
  → Excel·Evidence·사용자 판단 기반 새 콘텐츠 생성
  → 원본 좌표에 벡터 패치
  → PDF 구조 검사
  → 렌더링 비교 검사
  → 통과 시 보고서 초안 생성 완료
```

### Template IR 최소 정보

페이지별로 다음 정보를 저장한다.

- MediaBox, CropBox, 회전, 페이지 순서
- 콘텐츠 객체의 종류, 좌표, z-order, clipping 영역
- 텍스트의 폰트 리소스, 크기, 색상, 자간, 행간, 정렬
- 이미지, 벡터, Form XObject와 사용 리소스
- 표·차트·본문·제목·고지·고정 디자인 역할
- 고정 요소, 변경 요소, 데이터 연결 요소 분류
- Excel 셀·범위, Evidence, 사용자 판단과의 연결
- 허용 영역, 넘침 규칙, 검증 마스크

Template IR의 상세 스키마는 별도 기술 결정에서 확정한다.

### 변경 요소별 처리 우선순위

#### 1순위: 기존 PDF 명령 최소 수정

동일 폰트와 glyph를 사용할 수 있고 객체 경계가 명확한 숫자·짧은 문자열에 사용한다. 원본 좌표와 스타일 보존성이 가장 높다.

#### 2순위: 객체 제거 후 벡터 재삽입

문장, 표 셀, 제목처럼 기존 명령을 안전하게 수정할 수 없는 요소에 사용한다. 기존 요소를 검색 가능한 상태로 숨겨 두지 않고 물리적으로 제거한 뒤 새 콘텐츠를 넣는다.

#### 3순위: 변경 블록 한정 배경 패치

복잡한 배경과 변경 콘텐츠를 분리할 수 없지만 검증 기준을 만족할 수 있는 경우에만 사용한다. 전체 페이지를 이미지화하지 않으며 새 텍스트와 표는 계속 벡터로 삽입한다.

세 방식 모두 자동 렌더링 비교검사를 통과해야 한다.

### 허용하지 않는 방식

- 전체 페이지를 이미지로 변환한 뒤 텍스트를 올리는 방식
- HTML/CSS를 기준 렌더러로 사용해 PDF 전체를 다시 생성하는 방식
- 원본 PDF를 일반 REFLO 템플릿으로 교체하는 방식
- 원본의 모든 객체를 추출한 뒤 빈 PDF에 전체 재생성하는 방식을 기본값으로 사용하는 것
- 기존 텍스트를 제거하지 않고 흰색 사각형으로 가리기만 하는 방식
- 원본 폰트를 확보하지 못했을 때 사용자에게 알리지 않고 유사 폰트로 대체하는 것
- 글자 크기를 자동으로 줄이거나 페이지를 자동 추가해 넘침을 해결하는 것

### 선택 이유

- 고정 영역은 원본 객체를 재사용하므로 가장 높은 시각 충실도를 확보할 수 있다.
- 변경 영역만 생성하므로 전체 재구축보다 처리량과 생성 속도가 유리하다.
- 텍스트 선택, 검색, 벡터 확대와 인쇄 품질을 유지할 수 있다.
- PDF마다 다른 구조를 Template IR과 변경 영역 단위로 격리할 수 있다.
- 기존 요구사항의 좌표, 렌더링 일치율, 페이지 수 기준을 자동 검증할 수 있다.

### 품질 검증 기준

기존 서비스 동작 명세의 기준을 그대로 적용한다.

- 페이지 크기와 페이지 수가 원본과 동일해야 한다.
- 원본 폰트를 확보한 영역은 글꼴, 스타일, 크기와 색상을 유지해야 한다. 원본 폰트 미확보 영역은 TD-002의 경고·대체 정책을 적용한다.
- 고정 요소와 텍스트 영역의 좌표 오차는 최대 `±0.5pt`다.
- 내용이 바뀌지 않는 영역은 원본 렌더링과 `99.5%` 이상 일치해야 한다.
- 변경 문장, 숫자, 표, 차트는 원본이 정의한 영역을 벗어나면 안 된다.
- 고정 로고, 배경, 고지, 페이지 번호 규칙이 변경되면 안 된다.
- 기존 분기 텍스트가 가려진 상태로 PDF 검색·텍스트 추출 결과에 남으면 안 된다.
- 지원 대상 출력은 텍스트 선택과 검색이 가능한 PDF여야 한다.

시각 비교의 렌더러, DPI, 색공간, anti-aliasing 고정값과 비교 알고리즘은 별도 결정으로 확정한다.

### 진행 차단 조건

다음 중 하나라도 발생하면 자동 완전 복제를 완료 처리하지 않는다.

- 변경 요소와 고정 요소의 경계를 안전하게 분리할 수 없음
- 문자 또는 표가 해석 불가능한 outline·clipping·복합 객체로 구성됨
- 변경 객체 제거 시 고정 벡터·이미지·링크가 훼손됨
- 새 콘텐츠가 원본 영역 안에 들어가지 않음
- PDF 구조 검사 또는 렌더링 비교검사 실패
- 암호화, 손상, 스캔 이미지 등 기존 입력 제한에 해당함

### 기술 구성 결정

TD-007에서 다음 역할 분담을 일단 확정했다.

- PyMuPDF/MuPDF: 객체·좌표 분석, 텍스트·도형 처리, Template IR 생성과 패치 자산 생성
- pikepdf/qpdf: PDF 객체와 리소스 보존, content stream 정밀 수정, Form XObject 교체와 최종 저장
- PDFium: TD-008에서 채택한 독립 렌더링 검증 엔진
- HarfBuzz + FreeType: 한글 포함 글꼴 shaping과 glyph 처리
- SVG 또는 PDF 벡터 출력: 표와 차트 생성

REFLO 전체를 AGPL-3.0으로 공개하고 네트워크 사용자에게 실제 배포 버전의 대응 소스를 제공한다. 따라서 MuPDF/PyMuPDF는 AGPL-3.0 조건으로 사용하며 별도 Artifex 상용 라이선스를 전제로 하지 않는다. 상세 책임 경계, 표본 검증 결과와 준수 조건은 TD-007을 따른다.

### 기술검증 계획

아키텍처 확정 전 실제 증권사 PDF 표본으로 다음을 검증한다.

- 최소 5개 이상 증권사, 총 20~30개 실적 Review PDF
- 숫자, 한글 문장, 표, 차트 교체 성공률
- 원본 폰트 재사용 및 새 glyph 처리 가능률
- 페이지당 분석·생성·검증 시간과 메모리 사용량
- 고정 영역 렌더링 일치율과 좌표 오차
- PDF 검색·텍스트 선택·인쇄 결과
- 실패 문서 유형과 자동 차단 정확도

### 남은 결정

1. 기본 대체 폰트 매핑과 폰트 메트릭 허용 오차
2. 벡터 표·차트 생성 엔진
3. PDF 처리·검증 워커의 큐, 격리와 실행 환경
4. 자동 지원, 사용자 보정 필요, 지원 불가의 적합성 등급
5. `모든 증권사 PDF 지원` 요구사항을 적합성 검사 기반 표현으로 구체화할지 여부

---

## TD-002. PDF 폰트 확보·대체·업로드 정책

### 상태

`확정`

### 결정

PDF 분석으로 폰트 리소스명, 전체 이름, 스타일, 굵기, 내장 여부, subset 여부와 glyph 범위를 식별한다. 식별한 폰트는 다음 우선순위로 적용한다.

1. PDF에 내장된 폰트를 새 콘텐츠에 합법적으로 재사용할 수 있고 필요한 glyph가 모두 있으면 재사용한다.
2. 서비스의 관리형 폰트 저장소에 동일한 전체 폰트가 있으면 해당 폰트를 사용한다.
3. 고객 조직이 이전에 등록한 동일 폰트가 있으면 해당 고객 범위에서 사용한다.
4. 정확한 폰트가 없으면 사용 가능한 대체 폰트로 초안을 생성한다.

관리형 폰트 저장소에는 서비스가 사용·임베딩 권한을 확인한 오픈 라이선스 폰트, 정식 확보한 상용 폰트와 고객별 등록 폰트만 보관한다. 인터넷에서 임의의 폰트 파일을 검색하여 자동 다운로드하지 않는다.

원본 PDF에서 사용한 전체 폰트를 확보하지 못하거나 내장 subset font에 새 콘텐츠에 필요한 glyph가 없더라도 보고서 생성을 중단하지 않는다.

1. 사용 가능한 대체 폰트로 모든 페이지의 보고서 초안을 끝까지 생성한다.
2. 원본 폰트 부재는 오류가 아니라 검토 경고로 처리한다.
3. 경고에는 누락된 원본 폰트, 사용한 대체 폰트, 영향을 받은 페이지와 요소를 표시한다.
4. 초안에는 원본 폰트와의 메트릭 차이에 따른 줄바꿈, 정렬, 영역 넘침 검사를 적용한다.
5. 사용자가 더 높은 복제 정확도를 원하면 `.ttf` 또는 `.otf` 원본 폰트 업로드를 안내한다.
6. 폰트가 업로드되면 영향을 받은 요소를 새 폰트로 다시 렌더링하고 검증한다.
7. 폰트가 없다는 이유만으로 초안 생성 작업을 실패 또는 지원 불가로 종료하지 않는다.

### 품질 표시

- 원본 폰트를 사용한 결과는 폰트 검증 통과로 표시한다.
- 대체 폰트를 사용한 결과는 초안 생성 완료로 표시하되, 원본 폰트 미확보 경고를 유지한다.
- 대체 폰트를 사용한 영역은 PDF 완전 복제 일치율 보장 대상에서 제외하고 영향을 받은 범위를 사용자에게 명시한다.

### 폰트 업로드 범위

- 초기 지원 형식은 `.ttf`와 `.otf`다.
- 폰트 업로드는 필수가 아니라 사용자가 초안 검토 후 선택하는 정확도 개선 절차다.
- 업로드는 보고서마다 반복하지 않고 고객 조직 관리자가 최초 등록하거나 필요할 때 추가한다.
- 업로드한 폰트는 파일 유효성, 악성 파일 여부, glyph 범위와 임베딩 권한을 검사한 뒤 고객별로 격리하여 사용한다.

---

## TD-003. Excel 사용자 직접 입력 셀 판정

### 상태

`확정`

### 배경

REFLO가 입력받는 분석 Excel은 셀 스타일로 사용자가 직접 값을 기록하는 영역을 구분한다. 제공된 기준 Excel에서 노란색 배경과 파란색 글씨가 동시에 적용된 셀은 모두 사용자가 값을 입력하도록 정의된 셀이다.

### 결정

Excel에서 **노란색 배경과 파란색 글씨가 함께 적용된 셀을 사용자 직접 입력 셀로 판정**한다.

1. 두 스타일 조건을 모두 만족해야 한다.
2. 기준 파일의 초기 색상값은 배경 `#FFF2CC`, 글자 `#0000FF`다.
3. 셀 값의 의미, 합계 여부, 다른 시트의 중복값 여부를 근거로 직접 입력 셀 판정을 취소하지 않는다.
4. AI가 셀 의미를 추론하여 직접 입력 셀을 추가하거나 제외하지 않는다.
5. 동일한 경제적 값이 여러 직접 입력 셀에 존재하는 경우에도 각 셀의 분류는 유지한다. 중복값 동기화와 일관성 검사는 별도 기능으로 처리한다.
6. 직접 입력 셀 분류와 실제 편집 권한은 분리한다. 워크플로 단계, 값의 검증 상태와 사용자 역할에 따라 읽기 전용으로 전환할 수 있다.

### 검증 기준

- 원본 Excel의 최종 표시 색상을 기준으로 배경색과 글자색을 판정한다.
- 업로드 분석 결과에 판정된 직접 입력 셀의 시트명, 주소와 스타일 값을 저장한다.
- 원본 수식 셀은 직접 입력 셀 목록과 별도로 보존하고 수식을 임의로 값으로 덮어쓰지 않는다.
- 현재 `fixtures/ISC_095340_Peer_PER_Valuation_v4.xlsx`에서는 해당 스타일 조합으로 판정된 606개 셀을 직접 입력 셀로 인식해야 한다.

---

## TD-004. Excel 수식 재계산 엔진

### 상태

`확정`

현재 MVP fixture의 계산·왕복 저장·Excel 교차검증을 통과했다. 다른 workbook은 업로드 적합성 검사와 함수 allowlist를 통과한 경우에만 지원한다.

### 결정

REFLO의 Excel 분석·입력·수식 재계산·결과 조회·XLSX 저장을 담당하는 주 엔진으로 **ClosedXML 0.105.0 기반 독립 계산 서비스**를 채택한다.

1. Microsoft Excel이 설치되지 않은 격리된 서버 워커에서 실행한다.
2. 업로드한 원본 Excel은 불변 원본으로 보관하고 작업 사본만 ClosedXML로 연다.
3. 사용자 입력값을 셀 주소에 기록한 후 ClosedXML 계산 엔진으로 수식을 재계산한다.
4. 반복 입력 세션에서는 calculation chain을 활성화해 영향받는 계산을 효율적으로 갱신한다.
5. 계산 결과 조회와 최종 XLSX 저장에 같은 엔진을 사용해 이중 계산 엔진 간 불일치를 방지한다.
6. `openpyxl`과 Open XML 처리는 구조 검사·보조 분석 용도로만 허용하며 수식 정답 엔진으로 사용하지 않는다.
7. LibreOffice와 자체 구현 수식 엔진은 주 계산 엔진으로 사용하지 않는다.
8. Microsoft Excel COM 자동화는 검증 기준값 생성에만 사용할 수 있으며 운영 서버 계산 엔진으로 사용하지 않는다.
9. 브라우저의 workbook 표시와 사용자 입력 UI는 TD-010 React workbook grid가 담당하지만 계산 정답과 최종 저장 책임은 ClosedXML에서 이동하지 않는다.

### 처리 구조

```text
Excel 업로드
  → 파일 형식·암호화·외부 링크·매크로·함수 호환성 검사
  → 불변 원본과 작업 사본 생성
  → ClosedXML 계산 세션 로드
  → TD-003 입력 셀과 수식 셀 분류
  → 사용자 또는 시스템 입력값 기록
  → 수식 재계산
  → 오류·순환참조·필수 출력 검사
  → PDF 연결 값과 UI 결과 갱신
  → 계산 결과가 포함된 XLSX 작업 사본 저장
```

PDF 구성요소와 Excel 셀·범위의 영구 매핑 방식은 별도 기술 결정으로 확정한다.

### 기준 표본 검증 결과

검증 파일: `fixtures/ISC_095340_Peer_PER_Valuation_v4.xlsx`

- 시트 13개
- 수식 셀 178개
- 사용 함수 10종: `ABS`, `AVERAGE`, `COUNT`, `IF`, `IFERROR`, `INDEX`, `MATCH`, `MEDIAN`, `ROUND`, `SUM`
- 외부 링크, 매크로, chart, 데이터 연결과 피벗 없음

Microsoft Excel에 저장된 계산 cache와 Excel 16.0 재계산 결과를 기준으로 ClosedXML 0.105.0을 비교했다.

| 검증 항목 | 결과 |
|---|---:|
| 원본 수식 결과 비교 | 178 / 178 일치 |
| 왕복 저장 semantic mismatch | 0개 |
| 왕복 저장 package feature mismatch | 0개 |
| 수식 문자열 변경 | 0개 |
| 저장 전후 수식 수 | 178개 유지 |
| 저장 전후 병합·검증·조건부서식 | 98개·6개·3개 유지 |
| ClosedXML 저장본 Excel 재개방 | 성공 |
| Excel 재개방 후 수식 오류 | 0개 |
| 대표 입력 변경 후 Forward EPS | `5,662.36798509316` |
| 대표 입력 변경 후 Target PER | `54.24150809148` |
| 대표 입력 변경 후 목표주가 | `307,000원` |
| Excel 16.0 교차검증 | 위 대표 출력 전체 일치 |

대표 입력 변경은 `08_Forward_EPS!D16`과 `09_Target_PER!B10`에 각각 `+0.01`을 적용했다. ClosedXML 재계산·저장·재열기 결과와 Excel 16.0 `CalculateFullRebuild` 결과가 일치했다. 원본 fixture는 변경하지 않았다.

### 운영 규칙

- 배포 버전은 검증한 ClosedXML 0.105.0으로 고정한다.
- ClosedXML 버전을 변경하면 전체 Excel 회귀검사를 다시 수행한다.
- 저장은 `EvaluateFormulasBeforeSaving=true`, `ValidatePackage=true`를 사용하고 저장본을 다시 열어 필수 출력과 구조를 검사한다.
- 업로드 시 사용 함수, 외부 링크, 매크로, 배열수식, 순환참조와 데이터 연결을 검사한다.
- 미지원 함수나 기능이 발견되어도 원본을 변경하지 않으며 호환성 경고 또는 지원 불가 상태를 반환한다.
- 입력값, 계산 엔진 버전, 계산 시각, 결과 해시와 오류를 계산 실행 기록에 저장한다.
- 매크로는 실행하지 않는다.
- 외부 링크는 기존 서비스 범위에 따라 지원하지 않는다.

### 확장 지원 조건

1. 최소 5개 이상 증권사, 총 20~30개 실제 분석 Excel 회귀검사
2. 동적 배열, 이름 정의, 복잡한 조회, 순환참조 등 목표 지원 범위별 호환성 검사
3. 대용량 모델의 로드·반복 계산·저장 시간과 메모리 사용량 측정
4. 동시 계산 워커의 격리, 제한시간, 취소와 장애 복구 검증
5. ClosedXML과 모든 직접 의존성의 license notice를 배포 산출물에 포함

---

## TD-005. PDF↔Excel 매핑

### 상태

`확정`

### 배경

PDF의 숫자·표·차트를 Excel의 셀 주소에 직접 연결하면 PDF 객체 분할 방식, Excel 행·열 구조 변경, 표시용 중복 값과 계산 원천의 차이 때문에 매핑이 쉽게 깨진다. 하나의 숫자도 PDF에서는 여러 glyph와 연산자로 나뉠 수 있고, 하나의 표나 차트는 여러 Excel 범위를 사용할 수 있다.

또한 Excel에는 같은 지표의 표시용 값, 계산 결과, 검증용 값이 함께 존재할 수 있다. 여러 후보를 모두 원천으로 취급하면 어느 값이 PDF의 권위 있는 값인지 결정할 수 없으므로 슬롯마다 단일 권위 원천과 별도 검증 원천을 구분해야 한다.

### 결정

PDF 구성요소는 Excel 셀·범위에 직접 연결하지 않고 **의미 슬롯을 거치는 typed mapping 방식**으로 연결한다.

```text
Excel 셀·범위
  → 계산 완료값과 구조 검증
  → 의미 데이터
  → PDF 논리 슬롯
  → PDF content stream 또는 Form XObject 패치 대상
```

핵심 원칙:

1. PDF의 변경 가능한 숫자·표 셀·차트 계열마다 안정적인 `slotId`를 부여한다.
2. `slotId`는 PDF 좌표나 Excel 주소를 포함하지 않는 의미 식별자다.
3. Excel 주소는 `MappingSet`에서 `slotId`에 연결한다.
4. 한 슬롯은 하나의 권위 원천만 가진다. 다른 후보 셀은 검증 원천으로만 등록한다.
5. 하나의 Excel 지표는 여러 PDF 슬롯에서 재사용할 수 있다.
6. 표와 차트는 개별 셀 나열보다 행·열 키와 series 정의가 있는 구조 매핑을 우선한다.
7. PDF는 ClosedXML 재계산이 완료된 값을 읽는다. 수식 문자열이나 저장된 과거 캐시 값을 결과로 사용하지 않는다.
8. Mapping 계층에서는 비즈니스 계산을 수행하지 않는다. 단위 변환, 배율, 반올림, 부호, 빈칸, 접두·접미어와 표시 형식만 허용한다.
9. PDF의 스타일과 좌표는 Template IR이 소유하고 Excel은 값과 데이터 구조만 제공한다.
10. 모든 매핑은 버전 관리하며 승인된 버전을 실행 중 임의 변경하지 않는다.

### 매핑 유형

#### Scalar binding

숫자, 비율, 날짜, 짧은 문자열 하나를 연결한다.

```json
{
  "slotId": "p1.sidebar.target_price",
  "kind": "scalar",
  "source": {
    "sheet": "09_Target_PER",
    "address": "B17",
    "readMode": "calculated_value"
  },
  "valueType": "money",
  "display": {
    "unit": "KRW",
    "rounding": 10000,
    "pattern": "#,##0원"
  }
}
```

#### Keyed table binding

표의 행 이름과 열 머리글을 논리 키로 사용한다. 실제 PDF 표 셀은 `매출액 / 2026E`와 같은 키로 찾고, Excel의 물리적 범위는 검증 가능한 source locator로 저장한다.

```json
{
  "slotId": "p2.income_summary",
  "kind": "table",
  "source": {
    "sheet": "01_분기실적",
    "range": "A6:L23",
    "rowKeyColumn": "A",
    "columnHeaderRow": 6
  }
}
```

병합 셀, 빈 열, 부분 합계, 단위 행은 표 topology에 별도로 기록한다. 행·열 키가 중복되거나 비어 있으면 자동 확정하지 않는다.

#### Chart-series binding

Excel 차트 객체의 모양을 복사하지 않고 category와 series 원천 범위만 연결한다. 차트 종류, 축, 색상, 선 두께, 범례와 레이블 스타일은 Template IR의 PDF 차트 블록이 소유한다.

```json
{
  "slotId": "p4.target_price_history_chart",
  "kind": "chart",
  "categories": {
    "sheet": "05_목표주가이력",
    "range": "G7:G15"
  },
  "series": [
    {
      "seriesId": "target_price",
      "sheet": "05_목표주가이력",
      "range": "H7:H15"
    },
    {
      "seriesId": "market_price",
      "sheet": "_REFLO_BRIDGE",
      "range": "B2:B500"
    }
  ]
}
```

### `_REFLO_BRIDGE` 작업 시트

PDF에 필요한 데이터가 기존 Excel에 없거나 여러 비연속 범위를 하나의 표·차트 입력으로 정규화해야 하면 작업 사본에 시스템 소유 시트 `_REFLO_BRIDGE`를 생성할 수 있다.

- 원본 업로드 파일은 변경하지 않는다.
- 작업 사본에만 생성한다.
- 검증된 DART·KRX·ECOS·IR 값이나 기존 셀 참조 수식을 기록한다.
- 사용자가 직접 입력하는 시트로 취급하지 않는다.
- 시스템 생성값마다 출처 ID, 기준일, 단위와 Evidence 연결을 유지한다.
- 최종 Excel에 포함할 때는 숨김 시트로 저장하되 감사 화면에서 내용을 조회할 수 있어야 한다.

이 시트는 PDF 렌더링을 위한 임의 계산 공간이 아니며, 외부에서 수집한 검증값과 기존 Excel 값을 안정적인 행렬로 연결하는 bridge 역할만 한다.

### Excel source locator와 구조 해시

매핑에는 다음 정보를 저장한다.

- sheet name과 OOXML sheet ID
- 셀 또는 범위 주소
- 행·열 머리글과 주변 label fingerprint
- 값 유형, 수식 여부, number format과 style fingerprint
- 수식 셀의 formula hash
- 예상 행·열 크기
- 권위 원천과 검증 원천 구분

해시는 두 종류로 분리한다.

- `fileHash`: 현재 Excel 파일 버전 식별
- `structureHash`: 시트명, 범위, 수식, 머리글과 스타일 구조 식별

값만 변경되어 `structureHash`가 같으면 기존 매핑을 재사용한다. 시트명, 주소, 수식 또는 구조가 바뀌어 `structureHash`가 달라지면 매핑을 `재검증 필요`로 전환한다.

### MappingSet

```json
{
  "schemaVersion": "1.0",
  "mappingSetId": "map_...",
  "templateId": "tpl_...",
  "workbookStructureHash": "...",
  "workbookVersionId": "...",
  "status": "confirmed",
  "bindings": [],
  "unmappedRequiredSlots": []
}
```

상태는 다음을 사용한다.

- `suggested`: 자동 탐지 후보
- `confirmed`: 사용자 승인과 자동 검증 통과
- `revalidation_required`: Excel 구조 또는 Template IR 변경
- `invalid`: 원천 소실, 타입 불일치 또는 검증 실패

### 리노공업 표본 매핑 기준

리노공업 1Q26 PDF와 Excel 표본에서는 다음 범위를 기준으로 매핑한다.

| PDF 영역 | Excel 권위 원천 후보 | 매핑 유형 |
|---|---|---|
| 1페이지 목표주가 | `09_Target_PER!B17` | Scalar |
| 1페이지 현재주가 | `09_Target_PER!B18` | Scalar |
| 1페이지 Forward EPS | `08_통합_EPS!C31:D31` | Scalar 묶음 |
| 2페이지 요약 손익계산서 | `01_분기실적!A6:L23` | Keyed table |
| 2페이지 부문별 매출 | `02_부문매출!A6:L19` | Keyed table |
| 3페이지 포괄손익계산서 | `03_재무제표!A6:F27` | Keyed table |
| 3페이지 재무상태표 | `03_재무제표!H6:M31` | Keyed table |
| 3페이지 현금흐름표 | `03_재무제표!A34:F50` | Keyed table |
| 3페이지 재무비율 및 주당지표 | `03_재무제표!H34:M49` | Keyed table |
| 4페이지 목표주가 이력 | `05_목표주가이력!A7:H15` | Table·Chart series |
| 4페이지 시장가격 시계열 | `_REFLO_BRIDGE`의 검증된 KRX 데이터 | Chart series |

위 표는 표본의 확정 매핑 결과가 아니라 구현과 기술검증에 사용할 초기 권위 원천 후보다. 같은 지표가 여러 시트에 존재하거나 계산값과 표시값이 허용 오차를 넘어서면 자동 확정하지 않고 사용자 확인을 요구한다.

### 자동 검증

매핑 확정 전 다음을 검사한다.

1. 모든 필수 슬롯에 binding 또는 명시적인 고정·Evidence·사용자 판단 규칙이 존재하는지 확인
2. 셀과 범위가 존재하고 예상 타입·크기·머리글과 일치하는지 확인
3. ClosedXML 재계산 결과에 수식 오류, 외부 링크 또는 순환참조 문제가 없는지 확인
4. 같은 의미 지표의 권위 원천과 검증 원천이 허용 오차 안에서 일치하는지 확인
5. 표의 행·열 키가 고유하고 PDF slot topology와 호환되는지 확인
6. 차트 category와 모든 series 길이가 일치하는지 확인
7. 값의 단위, 기간, 실제·추정 구분과 표시 정밀도가 PDF 의미와 일치하는지 확인
8. 새 값으로 렌더링했을 때 슬롯 경계를 넘지 않는지 확인

대표 슬롯에는 sentinel mutation test를 수행한다. 작업 사본의 원천 셀에 임시 특수값을 넣고 재계산·PDF 패치한 뒤 지정된 슬롯만 바뀌는지 확인하고 원래 값으로 복원한다.

### 허용하지 않는 방식

- PDF 객체 ID와 Excel 셀 주소만 저장하는 1:1 단순 매핑
- PDF 차트를 Excel 차트 이미지로 캡처해 붙이는 방식
- Mapping 계층에서 EPS, PER, 합계, 성장률 같은 비즈니스 계산 수행
- 같은 슬롯에 여러 권위 원천을 두고 실행 시 임의 선택
- Excel 구조가 바뀌었는데 좌표만 같다는 이유로 기존 매핑 재사용
- 필수 슬롯이 미매핑인데 빈칸이나 이전 분기 값으로 내보내기

---

## TD-006. Template IR 스키마

### 상태

`확정`

### 배경

PDF는 의미 중심 문서 형식이 아니라 content stream의 그리기 명령, 리소스, 좌표 변환, clipping, Form XObject와 z-order로 화면을 만든다. 텍스트 bbox와 스타일만 저장하면 실제 객체 제거, 원본 리소스 재사용, 태그 보존과 정확한 재삽입을 수행할 수 없다.

반대로 Excel 매핑을 PDF 구조와 하나의 문서에 강하게 결합하면 Excel 버전이 바뀔 때마다 PDF 분석 결과까지 다시 생성해야 한다. PDF 구조와 데이터 binding은 별도 버전으로 관리하되 안정적인 `slotId`로 연결해야 한다.

### 결정

Template IR은 **Page·Block·Slot·Physical Object 계층의 버전형 JSON 스키마**로 정의한다. 서비스 구현에서는 Pydantic 모델과 JSON Schema를 기준 계약으로 사용한다.

```text
TemplateIR
  → Page
    → Block
      → Slot
        → Physical Object와 Patch Target

MappingSet
  → Slot과 Excel·Evidence·사용자 판단 연결

RenderPlan
  → 특정 실행 버전의 값, 패치 전략과 검증 결과
```

- `TemplateIR`은 PDF 원본 구조와 렌더링 규칙을 저장한다.
- `MappingSet`은 TD-005의 Excel·데이터 연결을 저장한다.
- `RenderPlan`은 특정 실행에서 사용할 값과 실제 패치 명령을 담는 일시적 실행 산출물이다.
- Template IR의 슬롯에는 전체 Excel 주소를 중복 저장하지 않고 binding ID와 요구 타입만 연결한다.

### 문서 루트

```json
{
  "schemaVersion": "1.0",
  "templateId": "tpl_...",
  "templateVersion": 1,
  "source": {
    "pdfHash": "...",
    "pdfVersion": "1.7",
    "parserName": "...",
    "parserVersion": "..."
  },
  "pages": [],
  "resources": {
    "fonts": [],
    "images": [],
    "xobjects": [],
    "styles": [],
    "clipPaths": []
  },
  "validationProfile": {},
  "analysisWarnings": []
}
```

### 좌표계

1. 모든 원본 좌표는 PDF user space와 `pt` 단위로 저장한다.
2. MediaBox와 CropBox의 원점 offset을 보존한다.
3. 페이지 회전을 원본 필드로 보존한다.
4. 객체의 local 좌표, current transformation matrix와 page 좌표 bbox를 함께 저장한다.
5. UI는 `pdfToViewMatrix`와 `viewToPdfMatrix`를 사용해 top-left 좌표계로 변환한다.
6. 변환된 UI 좌표로 원본 PDF 좌표를 덮어쓰지 않는다.
7. bbox만으로 회전·기울어진 텍스트를 표현할 수 없으면 quad와 baseline을 함께 저장한다.
8. 좌표 직렬화 정밀도는 최소 `0.001pt`를 유지한다.

### Page

페이지는 다음 정보를 저장한다.

- page ID, page number와 PDF page object reference
- MediaBox, CropBox, BleedBox, TrimBox와 ArtBox
- rotation과 user unit
- PDF↔UI 좌표 변환 행렬
- page content stream 목록과 resource 상속 정보
- block와 physical object 목록
- 고정·변경·무시 영역 validation mask
- 링크, annotation과 tagged PDF 구조 상태

### Physical Object

지원 유형:

- `text_run`
- `path`
- `image`
- `form_xobject`
- `shading`
- `annotation`
- `marked_content`

각 객체는 다음 공통 정보를 가진다.

```json
{
  "objectId": "p2.text.417",
  "type": "text_run",
  "role": "dynamic_value",
  "bbox": [412.1, 603.2, 438.4, 611.3],
  "quad": [],
  "zOrder": 417,
  "ctm": [1, 0, 0, 1, 0, 0],
  "sourceLocator": {
    "pageObjectRef": "58 0 R",
    "containerPath": ["Page", "Contents", 0],
    "streamObjectRef": "59 0 R",
    "operatorStart": 8021,
    "operatorEnd": 8030,
    "mcid": 331,
    "tokenHash": "..."
  },
  "styleRef": "style.table.number",
  "clipStack": ["clip.77"],
  "resourceRefs": ["font.SFNL"]
}
```

`sourceLocator`는 bbox나 추출 문자열보다 우선하는 실제 패치 위치다. Form XObject 내부 객체는 `containerPath`에 XObject object reference를 포함한다. shared XObject는 수정 전 clone-on-write 필요 여부를 기록한다.

### Text run

텍스트 객체는 다음을 추가 저장한다.

- 원본 문자 코드, Unicode와 glyph ID
- glyph별 advance와 offset
- text matrix와 baseline
- font resource, 크기와 writing mode
- character spacing, word spacing, horizontal scaling과 text rise
- text rendering mode
- fill·stroke 색상과 색공간
- opacity와 blend mode
- line height, alignment와 paragraph 관계
- BDC/BMC tag, MCID와 ActualText 존재 여부
- 원본 추출 문자열과 glyph sequence hash

원본이 tagged PDF면 기존 BDC·MCID 안에서 안전하게 치환하는 전략을 우선한다. block 전체를 교체해 기존 MCID가 사라지면 구조 트리를 갱신하거나 해당 출력의 tagged 상태를 명시적으로 재검증한다.

### Resource

#### Font resource

- PDF resource name과 object reference
- BaseFont와 전체 이름
- subtype, encoding과 ToUnicode 존재 여부
- embedded 여부와 font program hash
- subset 여부와 현재 glyph 범위
- 외부 확보 폰트 ID와 라이선스 상태
- TD-002 대체 폰트와 메트릭 차이

#### Image와 Form XObject

- object reference, bbox, matrix와 사용 페이지
- 이미지 픽셀 크기, 색공간, filter와 hash
- Form XObject의 resource, content stream과 공유 여부
- 원본 재사용, clone-on-write 또는 전체 교체 가능 여부

#### Style과 clip path

동일 스타일과 clipping 경로는 ID 기반으로 중복 제거한다. 색상은 단순 RGB hex뿐 아니라 원본 color space와 원시 component를 보존한다.

### Block

Block은 물리 객체를 실제 교체 가능한 의미 단위로 묶는다.

역할 유형:

- `fixed_design`
- `title`
- `narrative`
- `scalar_group`
- `table`
- `chart`
- `disclosure`
- `page_number`
- `evidence_text`
- `user_judgment`

Block은 bbox, object ID, slot ID, 허용 영역, patch strategy, overflow 규칙과 검증 마스크를 가진다. 고정 요소와 변경 요소가 겹치면 교차 object와 삭제 위험을 별도 기록한다.

### Slot

```json
{
  "slotId": "p2.income_summary.revenue.2026e",
  "blockId": "p2.income_summary",
  "valueType": "decimal",
  "semanticKey": {
    "metric": "revenue",
    "period": "2026E",
    "unit": "KRW_BILLION"
  },
  "required": true,
  "styleRef": "style.table.number",
  "targetObjectIds": ["p2.text.417"],
  "bindingRefs": ["binding.revenue.2026e"],
  "overflow": "reject"
}
```

Slot은 데이터 의미와 PDF 출력 위치를 연결하지만 Excel 물리 주소의 권위 원본은 MappingSet이 소유한다.

### Patch strategy

다음 enum을 사용한다.

- `fixed`: 원본 객체 보존
- `in_place_glyph_replace`: 기존 text 명령의 glyph만 최소 치환
- `operator_replace`: 지정 연산자 구간 제거 후 새 벡터 명령 삽입
- `form_xobject_replace`: 독립 Form XObject 교체
- `block_vector_replace`: 논리 block 전체를 벡터로 재생성
- `region_background_patch`: 허용된 변경 영역에 한정한 배경 패치 후 벡터 삽입

각 Block은 기본 전략과 허용 fallback 목록을 가진다. TD-001의 우선순위를 벗어난 자동 fallback은 허용하지 않는다.

### Validation mask

페이지마다 다음 영역을 분리한다.

- `fixed`: 원본과 렌더링 일치율 검사
- `dynamic`: 경계, overflow와 스타일 검사
- `ignore`: 렌더러별 비결정적 메타 영역만 제한적으로 제외
- `protected`: 로고, 고지, 링크처럼 변경 금지

mask는 rect 또는 path로 저장하고 관련 block·object ID를 연결한다. 전체 페이지의 흰 여백이 일치율을 높이지 않도록 고정 영역 기준으로 비교한다.

### 불변성과 버전 관리

- 원본 PDF hash가 다르면 같은 Template IR로 처리하지 않는다.
- 분석 결과를 직접 수정하지 않고 새 `templateVersion`을 생성한다.
- MappingSet 변경은 Template IR version을 올리지 않는다.
- block 경계, slot, patch target 또는 resource가 변경되면 Template IR version을 올린다.
- parser, font, renderer와 비교 알고리즘 버전을 실행 기록에 저장한다.
- RenderPlan에는 사용한 Template IR, MappingSet, Excel 계산 결과와 Evidence 버전을 모두 고정한다.

### 스키마 검증 규칙

1. 모든 객체 ID, block ID와 slot ID가 문서 안에서 고유해야 한다.
2. 모든 bbox와 path는 페이지 CropBox 또는 명시적 bleed 허용 영역 안에 있어야 한다.
3. 모든 source locator의 stream과 token hash가 원본 PDF와 일치해야 한다.
4. 변경 block은 최소 하나의 slot 또는 명시적인 생성 규칙을 가져야 한다.
5. 필수 slot은 확인된 binding 또는 고정·Evidence·사용자 판단 규칙을 가져야 한다.
6. fixed·protected 영역과 삭제 대상이 안전하지 않게 교차하면 자동 지원하지 않는다.
7. 필요한 glyph와 font 사용 권한을 확인하지 못하면 TD-002 경고를 연결한다.
8. 표 topology와 차트 series shape가 MappingSet의 데이터 구조와 일치해야 한다.
9. patch strategy와 fallback은 TD-001에서 허용한 방식이어야 한다.

### 허용하지 않는 방식

- bbox와 추출 텍스트만 저장하고 content stream 위치를 저장하지 않는 IR
- UI용 top-left 좌표만 저장하고 PDF 원본 좌표와 행렬을 버리는 방식
- PDF 구조와 Excel 물리 주소를 하나의 수정 가능한 JSON에 강하게 결합하는 방식
- glyph, clipping, transparency, z-order와 shared XObject 정보를 생략하는 방식
- mutable Template IR 한 개를 모든 프로젝트가 덮어쓰는 방식
- 검증 마스크 없이 전체 페이지 pixel 일치율 하나만 저장하는 방식

---

## TD-007. PDF 처리 라이브러리

### 상태

`일단 확정`

라이브러리 조합, 책임 경계와 AGPL-3.0 사용 방침은 확정했다. 최소 5개 증권사, 총 20~30개 PDF 패치 회귀검사를 통과하면 `확정`으로 전환한다.

### 결정

REFLO의 PDF 처리 라이브러리로 **PyMuPDF/MuPDF 분석 엔진과 pikepdf/qpdf 정밀 수정 엔진의 조합**을 채택한다.

1. PyMuPDF/MuPDF는 PDF를 읽고 페이지·텍스트·glyph·도형·이미지·Form XObject·좌표를 분석한다.
2. PyMuPDF/MuPDF는 Template IR과 Patch Plan을 만들고 새 텍스트·벡터 패치 자산을 생성한다.
3. pikepdf/qpdf는 불변 원본 PDF를 다시 열어 지정된 content stream operator, 리소스와 Form XObject를 수정한다.
4. 최종 PDF 저장 책임은 pikepdf/qpdf에만 둔다. PyMuPDF와 pikepdf가 같은 출력 파일을 번갈아 저장하지 않는다.
5. 저장 후 qpdf 구조 검사를 통과해야 한다.
6. PDFium은 주 편집 엔진에 포함하지 않고 TD-008에서 채택한 독립 렌더링 검증 엔진으로 사용한다.
7. PDF 처리는 Python 기반 전용 워커 경계 안에서 실행한다. 큐, 컨테이너 격리, 제한시간과 재시도 정책은 TD-011에서 확정한다.
8. 직접 MuPDF C API를 연결하는 방식은 초기 구현에서 사용하지 않는다. 계측 결과 Python binding 경계가 병목으로 확인된 기능만 후속 최적화 대상으로 삼는다.

### 책임 분리

| 책임 | 주 엔진 | 처리 범위 |
|---|---|---|
| 문서 열기와 적합성 검사 | PyMuPDF/MuPDF | 암호화, 페이지, box, rotation, 객체 유형과 렌더링 가능 여부 |
| 의미·좌표 분석 | PyMuPDF/MuPDF | text run, glyph, bbox, quad, baseline, path, image, Form XObject와 z-order |
| Template IR·Patch Plan 생성 | REFLO + PyMuPDF/MuPDF | TD-006 객체와 PDF 물리 객체 연결, 교체 경계와 전략 결정 |
| 폰트 shaping | HarfBuzz + FreeType | TD-002 정책에 따른 glyph shaping, advance와 subset 생성 |
| content stream 정밀 수정 | pikepdf/qpdf | `Tj`·`TJ` operand와 operator 묶음 교체, BDC·EMC·MCID 범위 보존 |
| 리소스 처리 | pikepdf/qpdf | `/Font`, `/XObject`, `/ExtGState` 추가, shared XObject clone-on-write |
| 표·차트 패치 삽입 | pikepdf/qpdf | TD-009 엔진이 만든 PDF 벡터/Form XObject 삽입 |
| 최종 저장과 구조 검사 | pikepdf/qpdf | xref, object stream, 압축, 선형화와 `qpdf --check` |
| 독립 시각 검증 | PDFium + OpenCV | TD-008 renderProfile 렌더링과 validation mask별 기준 이미지 비교 |

### 처리 흐름

```text
불변 원본 PDF
  → PyMuPDF/MuPDF 구조·좌표 분석
  → Template IR + MappingSet + Patch Plan
  → Excel 재계산 결과와 Evidence 연결
  → 텍스트·표·차트 벡터 패치 자산 생성
  → pikepdf/qpdf로 원본 stream·resource·Form XObject 정밀 교체
  → qpdf 구조 검사
  → TD-008 독립 렌더링·시각 비교
  → 결과 PDF와 검증 기록 저장
```

문서 하나의 분석 결과를 재사용하고, pikepdf/qpdf는 실제 변경 대상 stream만 해석한다. 최종 저장은 한 번만 수행한다.

### 수정 전략 우선순위

1. **기존 `Tj`·`TJ` operand 최소 교체**

   같은 폰트와 glyph를 사용할 수 있고 문자열 경계가 명확한 숫자·짧은 문구에 사용한다. 기존 BDC·EMC, MCID, text matrix와 graphics state를 유지한다.

2. **operator 묶음 교체**

   문장 또는 표 셀처럼 하나 이상의 text operator를 교체해야 할 때 사용한다. 대상 graphics state와 clipping 범위를 함께 추적한다.

3. **Form XObject 또는 block 벡터 교체**

   표와 차트처럼 다수의 path·text operator가 하나의 논리 객체를 이루면 내부 연산자를 개별 수정하지 않고 새 Form XObject로 교체한다.

4. **허용 영역 배경 패치 후 벡터 삽입**

   TD-001에서 허용된 독립 영역에만 사용한다.

5. 위 전략으로 고정 객체와 안전하게 분리할 수 없으면 자동 처리를 차단한다.

PyMuPDF redaction은 객체 탐색과 기술검증에는 사용할 수 있지만 운영 기본 삭제 방식으로 사용하지 않는다. bbox와 겹치는 인접 글자, 표선 또는 벡터 객체까지 제거할 수 있고 새 콘텐츠가 기존 tagged PDF 구조에 자동으로 연결되지 않기 때문이다.

### Source locator 규칙

pikepdf/qpdf 저장 과정에서 stream 직렬화와 xref가 달라질 수 있으므로 파일의 절대 byte offset을 장기 식별자로 사용하지 않는다. TD-006 `sourceLocator`는 최소 다음 값을 가진다.

- page object reference
- container와 Form XObject 경로
- content stream object reference와 stream 배열 index
- operator ordinal 시작·종료 위치
- BDC·BMC tag와 MCID
- 원본 operand 또는 operator 묶음의 token hash
- 사용한 font·XObject·ExtGState resource reference

패치 직전에 object reference, operator 범위와 token hash를 다시 검사한다. 하나라도 일치하지 않으면 저장하지 않고 Template IR 재분석을 요구한다.

### 객체 보존의 의미

객체 보존은 원본 파일과 byte-for-byte 동일함을 의미하지 않는다. 다음을 보존 기준으로 사용한다.

- 변경하지 않은 고정 콘텐츠의 의미와 렌더링 결과
- 재사용 가능한 원본 PDF 객체와 리소스
- 페이지 box, rotation, 좌표와 z-order
- 텍스트 검색·선택과 인쇄 품질
- 링크, annotation과 tagged PDF 구조

pikepdf는 저장할 때 incremental update를 하나의 비증분 PDF로 합칠 수 있다. 원본의 기존 전자서명은 콘텐츠 변경과 함께 유효하지 않게 되므로 서명된 PDF는 적합성 검사에서 별도로 차단하거나 사용자 확인 대상으로 분류한다. 원본 파일과 원본 hash는 항상 별도로 보존한다.

### 라이선스와 버전 정책

- REFLO 저장소와 네트워크 서비스는 AGPL-3.0으로 공개하며 MuPDF와 PyMuPDF도 AGPL-3.0 조건으로 사용한다.
- 배포 화면은 공개 저장소와 실제 배포 commit의 대응 소스를 받을 수 있는 `소스 코드` 링크를 제공한다.
- `LICENSE`, PyMuPDF/MuPDF 저작권 고지와 third-party notice를 배포물에서 제거하지 않는다.
- API key, session secret, 사용자 파일과 데이터베이스 내용은 소스 저장소에 포함하지 않는다.
- pikepdf의 MPL-2.0과 qpdf의 Apache-2.0 고지 의무를 배포 산출물에 반영한다.
- PyMuPDF와 포함된 MuPDF, pikepdf와 qpdf 버전 조합을 검증 프로필에 고정한다.
- 라이브러리 버전을 변경하면 TD-007 구조 회귀검사와 TD-008 시각 회귀검사를 모두 다시 수행한다.
- parser, writer, font engine과 renderer 버전을 RenderPlan 및 작업 실행 기록에 저장한다.

### 기준 표본 분석 결과

기준 파일:

- `fixtures/ISC_1Q26_실적리뷰_삼성증권.pdf`
  - SHA-256: `bf0c8d6809d8ecda2503c2db1396bb86ce1a83c3f7a318409c61c7aeca326a16`
  - Microsoft Word 2021 생성, PDF 1.7, A4 5페이지
  - tagged PDF이며 암호화, JavaScript와 AcroForm 없음
- `fixtures/ISC_095340_Peer_PER_Valuation_v4.xlsx`
  - SHA-256: `beb08debf740796cfbac9f9bbc61a2b636ae166b2e194f1aec99c87a8792b20d`
  - 13개 시트, 수식 셀 178개, chart 없음
  - VBA, 외부 workbook link, connection과 pivot table 없음

PDF 구조 분석:

| 페이지 | 추출 문자 수 | 주요 성격 |
|---|---:|---|
| 1 | 2,281 | 표지·본문·요약 표 |
| 2 | 3,188 | 분기 손익·부문 표 |
| 3 | 2,926 | 재무·밸류 표 |
| 4 | 1,430 | 공시 문구·차트 영역 |
| 5 | 161 | 회사 정보·인증 영역 |

- page resource 전체에서 서로 다른 font 16개, image 3개와 Form XObject 3개를 확인했다.
- pikepdf 10.10.0이 71,389개 content instruction을 오류 없이 parse했다.
- pikepdf 왕복 저장 뒤 pdfplumber의 text·font·bbox signature가 모두 일치했다.
- PDFium 288 DPI 렌더링에서 5페이지 모두 difference bbox가 없고 최대 channel 차이는 0이었다.
- 이 결과는 원본 보존·분석·저장 경계를 검증한다. 숫자·한글 문장·표·차트 실제 교체는 아래 확정 전환 조건에서 별도로 검증한다.

Excel과 PDF의 대응:

| PDF 영역 | Excel 기준 영역 | 패치 단위 |
|---|---|---|
| 1페이지 핵심 투자지표·Valuation summary | `00_요약`, `09_Target_PER` | Scalar·Table |
| 실적 추이·추정 변경 | `01_실적추이`, `02_추정변경` | Keyed Table |
| 목표주가·peer valuation | `03_목표주가`, `04_피어실적`, `05_피어밸류` | Scalar·Keyed Table |
| 재무·Forward EPS | `06_재무요약`, `08_Forward_EPS` | Keyed Table·Scalar |
| 검증·Target PER | `07_출처검증`, `09_Target_PER` | Scalar·Table |

이 표본은 PyMuPDF/MuPDF가 의미·좌표를 분석하고 pikepdf/qpdf가 태그와 원본 stream 구조를 보존하며 패치하는 역할 분리가 적합함을 보여 준다. 다만 실제 수정·저장 성공률과 성능은 아래 확정 전환 검증에서 측정한다.

### 확정 전환 조건

다음을 모두 만족하면 상태를 `확정`으로 전환한다.

1. 배포 URL에서 `LICENSE`, 공개 저장소와 실제 배포 commit의 대응 소스 접근을 검증한다.
2. 최소 5개 증권사, 총 20~30개 PDF에 대해 숫자, 한글 문장, 표와 차트 패치를 수행한다.
3. `in_place_glyph_replace`, `operator_replace`, `form_xobject_replace`, `block_vector_replace`를 각각 최소 한 번 이상 검증한다.
4. 고정 영역은 TD-001의 렌더링 일치율과 좌표 오차 기준을 통과한다.
5. 변경 영역은 overflow, clipping, z-order와 font glyph 검사를 통과한다.
6. 검색·복사한 텍스트, tagged PDF, 링크, annotation과 인쇄 결과가 허용 기준을 만족한다.
7. 손상 PDF, 암호화 PDF, 서명 PDF와 shared XObject 문서의 차단·처리 정책이 예상대로 동작한다.
8. 문서별 분석·패치·저장 시간의 p50·p95, peak RSS와 출력 크기를 기록하고 운영 한도를 정한다.
9. 별도 프로세스에서 실행한 TD-008 검증 렌더러의 시각 회귀검사를 통과한다.

### 허용하지 않는 방식

- PyMuPDF redaction과 overlay만으로 모든 PDF를 수정하는 방식
- pikepdf/qpdf만으로 텍스트 레이아웃과 좌표 의미를 직접 추론하는 방식
- PDFium을 REFLO의 주 PDF 편집·저장 엔진으로 사용하는 방식
- PyMuPDF와 pikepdf가 동일한 출력 파일을 교대로 저장하는 방식
- PDF content stream 전체를 불필요하게 normalize하거나 재생성하는 방식
- Form XObject 내부의 복잡한 차트를 선분 단위로 직접 갱신하는 방식
- 원본 PDF를 덮어쓰거나 원본 hash 없이 결과만 저장하는 방식
- 동일 `Document` 객체를 여러 thread에서 동시에 처리하는 방식
- AGPL-3.0 대응 소스와 고지 없이 PyMuPDF/MuPDF 기반 서비스를 배포하는 방식

---

## TD-008. PDF 시각 검증 엔진

### 상태

`일단 확정`

렌더러, 최종 판정 DPI, 색공간, anti-aliasing 원칙과 비교 알고리즘은 확정했다. 최소 5개 증권사, 총 20~30개 PDF 회귀검사와 의도적 오류 주입 검사를 통과하고 운영 성능 한도를 정하면 `확정`으로 전환한다.

### 결정

REFLO의 PDF 시각 검증 엔진으로 **고정 버전 PDFium 렌더러와 OpenCV 기반 마스크별 하이브리드 비교**를 채택한다.

1. PDFium은 TD-007의 MuPDF 생성·분석 경계와 분리된 독립 검증 프로세스에서 실행한다.
2. 최종 합격 판정은 `288 DPI`로 렌더링한 불투명 `8-bit sRGB RGB` 이미지로 수행한다.
3. 원본과 결과 PDF에 동일한 PDFium binary, font set, 렌더링 flag와 실행 환경을 적용한다.
4. TD-006의 `fixed`, `dynamic`, `ignore`, `protected` validation mask마다 서로 다른 검증 규칙을 적용한다.
5. `fixed`와 `protected` 영역은 RGB 절대차와 연결요소 분석으로 검사하고, 좌표 이동은 PDF 구조 좌표와 raster edge distance를 함께 검사한다.
6. `dynamic` 영역은 원본과의 픽셀 유사도를 합격 조건으로 사용하지 않고 slot 경계, overflow, clipping, z-order와 스타일 계약을 검사한다.
7. SSIM은 진단과 검토 우선순위 산정에만 사용하고 합격 기준으로 사용하지 않는다.
8. 비교 전에 이미지를 자동 정렬, 이동 또는 왜곡 보정하지 않는다.

### 선택 이유

- PDF 생성·분석에 사용하는 MuPDF와 다른 렌더러로 결과를 검사해 동일 구현의 오류가 생성과 검증에 함께 전파될 가능성을 낮춘다.
- `288 DPI`에서는 PDF 좌표 `1pt`가 정확히 `4px`이므로 TD-001의 최대 좌표 오차 `±0.5pt`를 `±2px`로 판정할 수 있다.
- 단일 전체 페이지 유사도 대신 validation mask를 사용해 넓은 흰 여백이 오류를 숨기지 않게 한다.
- 절대차, 연결요소와 edge distance를 함께 사용하면 작은 숫자, 글자, 표선, 로고와 국소 좌표 이동을 검출하고 오류 위치를 설명할 수 있다.
- 원본 렌더링을 템플릿 버전별로 캐시하고 결과 페이지만 다시 렌더링할 수 있어 반복 보고서 생성의 비용을 줄일 수 있다.

### 렌더링 프로필

검증 실행마다 다음 값을 하나의 versioned `renderProfile`로 고정하고 기록한다.

| 항목 | 결정값 |
|---|---|
| renderer | PDFium |
| binding | Python 워커의 `pypdfium2`; 필요하면 raw PDFium API 사용 |
| final DPI | `288` |
| preliminary DPI | 선택적 `144`; 조기 실패 탐지 전용 |
| bitmap | PDFium BGRA 또는 BGRx buffer |
| comparison color | 불투명 흰 배경에 합성한 `8-bit sRGB RGB` |
| execution | CPU 전용, 별도 프로세스, 페이지 단위 처리 |
| text rendering | OS native text와 LCD subpixel rendering 비활성화 |
| anti-aliasing | PDFium 기본 grayscale smoothing 유지 |
| annotation | 출력 정책상 보이는 annotation만 원본과 결과에 동일하게 포함 |
| background | `#FFFFFF`, alpha 제거 |

PDFium의 native text 경로는 사용하지 않고 동일한 bitmap 경로로 렌더링한다. `FPDF_LCD_TEXT`는 사용하지 않으며 text, image와 path의 anti-aliasing을 임의로 끄지 않는다. annotation, printing mode와 byte order flag는 profile에 명시하고 원본과 결과에 동일하게 적용한다.

PDFium binary와 wrapper는 정확한 버전, build hash, target OS와 CPU architecture를 고정한다. font package, locale, ICC 처리 설정 또는 renderer가 바뀌면 기존 baseline image를 재사용하지 않고 전체 TD-008 회귀검사를 다시 수행한다.

### DPI 결정

- `144 DPI`는 `1pt = 2px`이고 `0.5pt = 1px`이므로 빠른 사전 검사에는 사용할 수 있지만 최종 좌표 판정에는 여유가 작다.
- `288 DPI`는 `1pt = 4px`이고 `0.5pt = 2px`이므로 좌표 기준을 정수 pixel로 안정적으로 표현한다.
- `300 DPI`는 일반적인 인쇄 해상도지만 PDF point와 pixel이 정수 비율로 대응하지 않는다.
- `576 DPI`는 더 세밀하지만 같은 페이지에서 `288 DPI`보다 pixel 수와 원시 bitmap 메모리가 약 4배이므로 기본값으로 사용하지 않는다.

최종 승인과 내보내기 전에는 모든 페이지를 `288 DPI`로 검사한다. `144 DPI` 사전 검사는 명백한 실패의 조기 종료에만 사용하며 최종 검사를 대체하지 않는다.

### 마스크별 검증 규칙

#### `fixed`

원본과 시각적으로 같아야 하는 영역이다.

1. 원본과 결과 RGB image에서 mask가 참인 pixel만 비교한다.
2. 각 pixel의 `max(abs(ΔR), abs(ΔG), abs(ΔB)) <= 2`이면 일치 pixel로 판정한다.
3. `일치 pixel 수 / fixed mask pixel 수`가 `99.5%` 이상이어야 한다.
4. 불일치 pixel은 8-neighbor connected component로 묶고 bbox, 면적, 최대 색상차와 관련 Template IR object를 기록한다.
5. 전체 페이지가 아니라 `fixed` mask pixel 수를 분모로 사용한다.

#### `protected`

로고, 법정 고지, 인증 표시, 변경 금지 배경처럼 한 pixel의 실질적 변경도 허용하지 않는 영역이다.

- RGB channel 허용차 `2`를 적용한 뒤 불일치 pixel이 없어야 한다.
- mask 경계와 겹치는 dynamic object가 있으면 렌더링 전 구조 검사에서 먼저 실패시킨다.
- 작은 connected component를 자동으로 제거하거나 무시하지 않는다.

#### `dynamic`

내용 변경이 예정된 문장, 숫자, 표와 차트 영역이다. 원본 내용과 새 내용이 다르므로 픽셀 일치율을 사용하지 않는다.

- 새 객체의 PDF bbox, transformed path와 clip path가 허용 slot 또는 block 경계 안에 있어야 한다.
- raster image에서 dynamic mask 바깥 guard 영역에 새 ink가 생기면 overflow 후보로 판정한다.
- anti-aliasing coverage만 발생한 경계 `1px`은 구조 좌표 검사를 통과한 경우에만 허용할 수 있다.
- font, size, color, alignment, line height와 chart·table style은 RenderPlan과 Template IR 계약을 검사한다.
- 기존 분기 텍스트가 PDF 검색·추출 결과 또는 content stream에 남아 있으면 시각 통과 여부와 관계없이 실패한다.

#### `ignore`

- renderer별로 비결정적일 수 있고 업무 내용과 무관한 영역만 사전에 등록한다.
- 빈 여백, 비교하기 어려운 영역 또는 실패를 회피할 목적의 자동 ignore 생성은 허용하지 않는다.
- ignore mask의 생성·변경은 새 Template IR version과 사용자 또는 운영자 검토 기록을 요구한다.
- 페이지별 ignore 면적과 사유를 검증 결과에 저장한다.

### 좌표 오차 검사

좌표 오차는 raster 검사 하나에 의존하지 않는다.

1. TD-006 Template IR과 결과 PDF 객체에서 bbox, quad, baseline, matrix와 clip path를 PDF point 단위로 비교한다.
2. 구조적으로 비교 가능한 fixed·protected 객체는 최대 오차가 `±0.5pt` 이하여야 한다.
3. raster image에서는 기준과 결과의 edge map을 만들고 양방향 distance transform으로 edge displacement를 구한다.
4. `288 DPI`에서 의미 있는 connected component의 edge displacement가 `2px`를 초과하면 좌표 오류로 판정한다.
5. protected 영역은 작은 component도 검사하며, fixed 영역의 noise 제외 기준은 회귀검사로 확정해 renderProfile에 버전 관리한다.

자동 image registration, phase correlation, feature matching 또는 최적 이동량 적용은 좌표 오차를 숨길 수 있으므로 합격 판정 전에 사용하지 않는다. 위치 추정값은 실패 원인 설명용으로만 계산할 수 있다.

### 비교 처리 흐름

```text
원본 PDF + 원본 hash + Template IR
  → renderProfile 고정
  → 원본 baseline image 조회 또는 PDFium 288 DPI 렌더링
  → 결과 PDF 구조·페이지 box·rotation 검사
  → 결과 PDFium 288 DPI 렌더링
  → RGB·배경·channel order 정규화
  → validation mask rasterize
  → fixed·protected RGB 절대차와 connected component 분석
  → PDF 좌표 비교와 edge distance 검사
  → dynamic overflow·clip·style·잔존 텍스트 검사
  → SSIM 진단값과 diff artifact 생성
  → mask별 합격 여부 집계
  → 전체 통과 시에만 최종 승인 가능
```

페이지 크기, pixel dimensions, CropBox 또는 rotation이 다르면 image resize로 보정하지 않고 즉시 실패시킨다.

### SSIM 사용 범위

SSIM은 다음 목적으로만 사용한다.

- fixed 영역에서 다수의 작은 차이가 발생했을 때 사용자 검토 우선순위 산정
- renderer나 font package 업그레이드 전후의 영향 분석
- diff 화면에 사람이 인지하기 쉬운 요약값 제공

SSIM 점수가 높더라도 RGB 일치율, protected 영역, 좌표, overflow 또는 구조 검사를 실패하면 최종 결과는 실패다. perceptual hash도 같은 이유로 합격 기준으로 사용하지 않는다.

### 결과와 진단 산출물

검증 실행은 최소 다음 정보를 저장한다.

- 원본·결과 PDF hash와 Template IR·RenderPlan version
- PDFium, `pypdfium2`, OpenCV와 font package version
- renderProfile ID와 전체 설정 hash
- 페이지별 box, rotation, pixel dimensions와 처리 시간
- mask별 pixel 수, 일치율, 차이 pixel 수와 최대 channel 차이
- 좌표 최대 오차와 edge displacement 통계
- connected component별 page, bbox, 면적, mask와 관련 object ID
- 원본 image, 결과 image, 색상 강조 diff image와 mask overlay
- dynamic overflow, clipping, style과 잔존 텍스트 검사 결과
- 최종 통과·실패와 실패 사유 code

baseline image와 검증 image는 원본 PDF hash와 renderProfile hash를 함께 key로 사용한다. hash가 다르면 기존 baseline을 재사용하지 않는다.

### 성능 정책

- 원본 baseline은 `templateVersion + originalPdfHash + renderProfileHash` 단위로 한 번 렌더링하고 캐시한다.
- 결과 PDF는 페이지 단위로 렌더링·비교하고 즉시 bitmap 메모리를 해제한다.
- 서로 다른 페이지는 격리된 worker process에서 병렬 처리할 수 있지만 하나의 PDFium document handle을 여러 thread가 동시에 공유하지 않는다.
- RGB 절대차가 없는 영역에는 connected component, edge와 SSIM 계산을 생략한다.
- `144 DPI` 사전 검사에서 페이지 box 불일치, 대규모 fixed 변경 또는 protected 변경이 확인되면 조기 실패시킬 수 있다.
- 최종 통과 후보는 사전 검사 결과와 관계없이 전체 페이지 `288 DPI` 검사를 완료해야 한다.
- PNG encoding은 비교 완료 후 진단 artifact가 필요한 경우에만 수행하고, 비교는 raw bitmap 또는 NumPy view에서 수행한다.

### 대안 검토

| 대안 | 검토 결과 |
|---|---|
| PDFium + 전체 페이지 pixel exact match | 단순하고 빠르지만 anti-aliasing 미세차와 넓은 흰 여백 때문에 단독 판정으로 사용하지 않음 |
| PDFium + SSIM 단독 | 국소 숫자·글자·표선 오류를 숨길 수 있어 진단 지표로만 사용 |
| MuPDF 렌더링 검증 | 편집·분석 엔진과 구현을 공유하므로 독립 검증 기본값으로 사용하지 않음 |
| Poppler Splash/Cairo | 독립성은 높지만 backend와 화면·인쇄 mode에 따른 차이를 추가로 고정해야 하므로 호환성 회귀검사 후보로 유지 |
| Ghostscript | 인쇄·색상 검증에는 유용하지만 별도 라이선스와 운영 설정이 필요하므로 기본 엔진으로 사용하지 않음 |
| PDFium + Poppler 이중 판정 | 렌더러 호환성 검사는 강화되지만 비용과 판정 복잡도가 증가하므로 야간·릴리스 회귀검사 후보로 유지 |
| ImageMagick CLI 비교 | prototype에는 사용할 수 있지만 mask·object 연결과 상세 오류 모델을 구현하기 어려워 운영 기본 비교 엔진으로 사용하지 않음 |

### 허용하지 않는 방식

- 전체 페이지 SSIM, PSNR 또는 perceptual hash 하나만으로 합격시키는 방식
- validation mask 없이 전체 페이지 pixel 수를 일치율 분모로 사용하는 방식
- 비교 전에 결과 image를 자동 이동·확대·축소·왜곡해 원본에 맞추는 방식
- 원본과 결과를 서로 다른 renderer version, font set 또는 OS 설정으로 렌더링하는 방식
- `144 DPI` 사전 검사만으로 최종 승인하는 방식
- dynamic 영역을 원본 픽셀과 같아야 한다고 판정하는 방식
- protected 영역의 작은 차이 component를 noise로 자동 삭제하는 방식
- 승인 기록 없이 ignore mask를 자동 확장하는 방식
- MuPDF 하나로 생성과 최종 독립 시각 검증을 모두 완료하는 방식
- renderer, 비교 알고리즘과 profile version을 기록하지 않는 방식

### 확정 전환 조건

다음을 모두 만족하면 상태를 `확정`으로 전환한다.

1. 최소 5개 증권사, 총 20~30개 실적 Review PDF의 원본 baseline을 안정적으로 재현한다.
2. 같은 PDF를 같은 profile로 10회 반복 렌더링했을 때 모든 비교 image와 metric이 동일하다.
3. fixed 영역에 `0.25pt`, `0.5pt`, `0.75pt` 이동을 주입해 허용 경계가 의도대로 동작한다.
4. 숫자 한 자리, 한글 한 글자, `1px` 상당 표선, 로고 일부와 색상 오차를 주입해 검출한다.
5. dynamic 내용 변경은 허용하되 slot overflow, clipping, z-order와 잔존 텍스트를 모두 검출한다.
6. protected 변경과 승인되지 않은 ignore mask 변경을 항상 차단한다.
7. PDFium·font package upgrade 시 baseline invalidation과 전체 회귀검사가 동작한다.
8. 페이지별 렌더링·비교 시간의 p50·p95, peak RSS, baseline cache 크기와 동시 작업 처리량을 측정해 TD-011 운영 한도를 정한다.
9. PDF viewer 및 실제 인쇄 표본에서 자동 판정 결과와 사람이 확인한 결과 사이의 false pass와 false fail을 기록하고 허용 수준을 정한다.

---

## TD-010. 웹 Excel UI

### 상태

`확정`

MVP는 범용 Excel 편집기가 아니라 검증된 workbook을 읽고 허용 셀만 수정하는 UI다. 따라서 상용 spreadsheet component 없이 server read model 기반 React workbook grid를 사용한다.

### 배경

REFLO는 업로드한 분석 Excel의 실제 sheet 구조, 값, 수식, 스타일, 병합, 숨김 상태, 표와 차트를 브라우저에서 보여 주고 TD-003에서 판정한 사용자 직접 입력 셀만 편집하게 해야 한다. 일반 data grid는 행 중심 데이터 표시에는 적합하지만 기존 workbook의 sheet·cell 중심 구조와 Excel 서식을 그대로 표현하는 데 추가 구현이 많이 필요하다.

TD-004의 ClosedXML은 서버에서 Excel 파일을 분석하고 수식을 재계산하며 최종 XLSX를 저장하는 엔진이다. 브라우저는 XLSX를 직접 해석하지 않고 서버가 만든 versioned workbook read model만 표시한다.

### 결정

REFLO의 웹 Excel UI로 **React 전용 workbook grid를 채택하고, ClosedXML 0.105.0을 유일한 권위 계산·저장 엔진으로 유지**한다.

1. React workbook grid는 worksheet 표시, sheet tab, cell selection, 허용 셀 입력, 복사·붙여넣기와 formula bar를 담당한다.
2. ClosedXML은 원본·작업 사본 로드, TD-003 입력 셀 판정, 값 기록, 수식 재계산, 오류 검사와 최종 XLSX 저장을 담당한다.
3. 브라우저는 수식을 계산하지 않으며 최종 값, PDF 연결 값, 검증 결과 또는 저장 결과의 정답을 만들지 않는다.
4. 브라우저는 셀 색상을 다시 해석해 편집 권한을 결정하지 않고 서버가 제공한 versioned `editableCellSet`만 신뢰한다.
5. 수식, 검증된 실제값, 시스템 입력값과 권한이 없는 셀은 읽기 전용으로 표시한다.
6. 사용자 입력은 cell delta로 서버에 전송하고 ClosedXML 재계산이 성공한 뒤 반환된 영향 셀 delta로 화면을 갱신한다.
7. 원본 XLSX는 불변으로 유지하고 모든 입력과 계산은 프로젝트별 작업 사본에만 반영한다.
8. 최종 내보내기는 client export가 아니라 TD-004 ClosedXML 작업 사본으로 수행한다.

### 선택 이유

- MVP는 row·column 삽입, formula 작성, 임의 서식, workbook 구조 변경과 client XLSX export를 지원하지 않아 범용 spreadsheet component가 필요하지 않다.
- server read model이 sheet·cell·style·merge·editable set을 명시하므로 browser와 계산 엔진의 해석 차이를 줄일 수 있다.
- 상용 UI 라이선스, hostname key와 평가판 watermark가 없고 필요한 interaction만 React로 검증할 수 있다.
- 화면과 계산 정답 엔진을 분리하므로 UI 구현이 최종 Excel 값과 PDF 숫자를 바꾸지 않는다.

### 책임 분리

| 책임 | 주 엔진 | 규칙 |
|---|---|---|
| XLSX 원본 보존 | 파일 저장소 | 사용자 업로드 원본 hash와 파일을 변경하지 않음 |
| workbook 적합성 검사 | ClosedXML | 외부 링크, 함수, 수식, 병합, chart와 숨김 sheet 검사 |
| 입력 셀 판정 | ClosedXML + TD-003 | 최종 표시 배경·글자색 기준으로 server에서 판정 |
| workbook 화면 표시 | React workbook grid | server read model의 sheet·cell·style·merge·chart snapshot을 표시 |
| 편집 권한 | REFLO backend | `editableCellSet`과 workflow 상태를 기준으로 결정 |
| 사용자 입력 UX | React workbook grid | selection, editor, keyboard, copy·paste와 validation message |
| 수식 재계산 | ClosedXML + TD-004 | 모든 권위 결과와 오류를 계산 |
| 영향 셀 갱신 | REFLO API | 재계산된 sparse cell delta를 UI에 반환 |
| 최종 XLSX 저장 | ClosedXML | 프로젝트 작업 사본을 저장·검사·내보내기 |
| PDF 연결 값 | TD-005 MappingSet | ClosedXML 재계산 완료 값만 조회 |

### 화면 구성

기본 화면은 다음 요소를 제공한다.

- 원본 workbook의 보이는 sheet 이름과 순서를 유지한 sheet tab
- row·column header, grid, formula bar와 name box
- 원본 row height, column width, number format, font, fill, border, alignment와 merge 표시
- freeze pane, hidden row·column과 visible sheet 상태 유지
- 원본 chart가 존재하는 위치의 chart 표시
- 선택 셀의 sheet name, address, name, 원본 값, 표시값, formula, 단위, 기간과 provenance panel 연결
- 사용자 직접 입력 셀, 검증된 실제값, formula cell과 system cell의 상태 표시
- 서버 계산 중, 재검증 필요, 오류와 저장 완료 상태

숨김 sheet는 일반 sheet tab에 노출하지 않는다. `_REFLO_BRIDGE`와 같은 시스템 sheet는 별도 감사 화면에서 읽기 전용으로 조회할 수 있으며 사용자가 편집하거나 workbook 구조를 변경할 수 없다.

### workbook 로드 방식

```text
원본 XLSX 업로드
  → ClosedXML 적합성 검사
  → 불변 원본 + 프로젝트 작업 사본 생성
  → TD-003 editableCellSet과 cell metadata 생성
  → workbookVersion 발급
  → API가 versioned workbook read model 생성
  → React grid가 동일 original hash의 read model 표시
  → backend metadata로 cell permission 적용
  → 사용자 입력 대기
```

- 브라우저 read model과 ClosedXML 작업 사본은 동일한 `originalWorkbookHash`와 `workbookVersion`을 가져야 한다.
- read model 로드가 끝나기 전에는 편집을 허용하지 않는다.
- ClosedXML 적합성 검사를 통과하지 않은 파일을 grid에서 임시 편집하게 하지 않는다.
- visible sheet의 used range를 우선 전송하며 큰 sheet는 row·column window로 나눠 요청한다.
- 지원되지 않거나 단순화된 Excel 기능은 호환성 경고와 영향 범위를 표시한다.

### 편집 권한 모델

서버는 workbook version마다 최소 다음 정보를 제공한다.

```json
{
  "originalWorkbookHash": "sha256:...",
  "workbookVersion": 17,
  "editableCells": [
    "01_분기실적!G12",
    "01_분기실적!H12"
  ],
  "readOnlyReasons": {
    "01_분기실적!I12": "formula",
    "_REFLO_BRIDGE!B7": "system_verified_value"
  }
}
```

- 편집 허용 여부는 sheet name 문자열만이 아니라 내부 sheet ID와 row·column 좌표를 함께 사용한다.
- `editableCells`는 TD-003의 직접 입력 셀 중 현재 workflow 상태에서 편집이 허용된 교집합이다.
- 색상은 사용자 안내와 TD-003 판정 근거이며 client authorization 수단이 아니다.
- formula 입력, formatting 변경, row·column 삽입·삭제, merge 변경, sheet 추가·삭제·이름 변경과 chart 구조 변경은 MVP에서 허용하지 않는다.
- 일반 입력은 number, string, date, boolean과 blank의 typed value만 허용한다.
- paste 대상에 읽기 전용 셀이 하나라도 포함되면 전체 paste를 원자적으로 거절한다. 일부 셀만 조용히 적용하지 않는다.
- multi-cell paste는 최대 크기, type, locale number·date parsing과 허용 cell set을 server에서도 다시 검사한다.

### 입력과 재계산 프로토콜

단일 셀 입력과 paste는 같은 batch delta 계약을 사용한다.

```json
{
  "workbookVersion": 17,
  "requestId": "uuid",
  "changes": [
    {
      "sheetId": "sheet-01",
      "address": "G12",
      "valueType": "number",
      "value": 125000
    }
  ]
}
```

처리 흐름:

1. client가 허용 cell, type와 기본 validation을 검사한다.
2. 빠른 연속 입력은 약 `150~250ms` 범위에서 하나의 batch로 묶을 수 있다.
3. backend가 사용자, project, workbook version, request ID와 cell permission을 다시 검사한다.
4. ClosedXML 작업 사본에 batch 전체를 하나의 transaction 단위로 적용한다.
5. 수식을 재계산하고 formula error, 순환참조, 필수 출력과 참조 무결성을 검사한다.
6. 성공하면 새 `workbookVersion`, 저장된 입력값과 영향받은 계산 셀의 sparse delta를 반환한다.
7. 실패하면 batch 전체를 적용 전 상태로 되돌리고 cell별 오류를 반환한다.
8. client는 최신 request sequence와 일치하는 응답만 적용한다.

응답에는 최소 다음을 포함한다.

- 새 workbook version과 계산 실행 ID
- 적용된 입력 셀의 typed value와 formatted text
- 영향받은 formula cell의 value, formatted text와 error
- 갱신이 필요한 chart·table·PDF slot ID
- 재검증이 무효화된 하위 결과 목록
- 저장·계산 시간과 경고

### 계산 권위와 화면 동작

- client formula engine은 두지 않는다.
- 사용자가 입력한 셀 값은 즉시 editor에 유지하되 관련 formula 결과는 ClosedXML 응답 전까지 이전 값과 `계산 중` 상태로 표시한다.
- PDF, valuation, validation과 최종 XLSX는 client preview 값을 읽지 않는다.
- formula 문자열은 화면에 읽기 전용으로 표시할 수 있지만 client에서 수정하거나 새 formula를 입력할 수 없다.
- 서버 계산 실패 시 성공한 것처럼 client 값만 남기지 않고 입력 이전 상태로 복구한다.

### 동시성과 버전 관리

MVP는 공동 편집을 지원하지 않지만 같은 사용자가 여러 browser tab을 열 수 있으므로 optimistic concurrency를 적용한다.

- 모든 변경 요청은 예상 `workbookVersion`과 idempotent `requestId`를 포함한다.
- version이 오래됐으면 서버는 변경을 자동 병합하지 않고 최신 delta 또는 reload 요구를 반환한다.
- 같은 request ID의 재전송은 한 번만 적용한다.
- 응답 순서가 바뀌어도 client는 오래된 version을 최신 화면 위에 적용하지 않는다.
- 성공한 입력마다 변경 전후 값, 사용자 ID, 시각, 계산 실행 ID와 새 version을 감사 기록에 저장한다.

### 성능 정책

- workbook 전체를 하나의 React component state로 복제하지 않고 sheet별 normalized cache와 viewport slice로 관리한다.
- React는 현재 sheet, 선택 셀 metadata, viewport, server status와 version만 활성 상태로 관리한다.
- cell selection·scroll event를 매번 전역 상태나 서버로 전송하지 않는다.
- XLSX I/O는 browser bundle에 넣지 않는다. chart는 server가 제공한 SVG 또는 image snapshot만 필요 시 로드한다.
- visible sheet를 우선 활성화하고 무거운 hidden·background sheet UI는 생성하지 않는다.
- 변경 시 전체 workbook JSON이나 XLSX를 왕복하지 않고 sparse typed delta만 전송한다.
- ClosedXML 계산 session을 반복 입력 동안 재사용하고 매 입력마다 원본 XLSX를 다시 열지 않는다.
- 계산 응답도 전체 sheet가 아니라 영향받은 cell·table·chart delta만 반환한다.
- chart는 관련 series가 변경된 경우에만 갱신한다.
- multi-cell 화면 갱신은 paint·event를 suspend한 뒤 batch 적용하고 한 번만 다시 그린다.
- project 이동이나 장시간 유휴 시 계산 session을 checkpoint하고 해제하는 정책은 TD-011에서 확정한다.

### 오류와 호환성 처리

다음은 자동으로 품질을 낮춰 표시하지 않고 경고 또는 진행 차단 대상으로 분류한다.

- React read model이 표현하지 못하는 workbook feature
- ClosedXML 작업 사본과 React read model에서 date serial, number format, error value 또는 formula cached value가 다름
- sheet name, used range, merge, hidden state, chart series 또는 named range 불일치
- client 화면에서 보이는 값과 ClosedXML 권위 값 불일치
- editableCellSet에 없는 셀 변경 시도
- stale workbook version, 중복되지 않은 out-of-order 요청 또는 계산 session 손실
- formula error, 순환참조, 외부 링크와 지원하지 않는 함수

client 표시 불일치는 원본 또는 server 작업 사본을 수정해 맞추지 않는다. 호환성 보고서에 기능, sheet, address와 사용자 영향을 기록한다.

### 보안 원칙

- client가 보낸 user ID, editable flag, formula result와 workbook version을 그대로 신뢰하지 않는다.
- 변경 요청의 project 소유권과 cell permission은 검증된 로그인 session으로 server에서 다시 확인한다.
- formula, external link, DDE, macro와 임의 script는 browser 입력을 통해 추가할 수 없다.
- pasted HTML은 style과 executable content를 제거하고 typed cell value만 허용한다.
- 다운로드는 server가 저장·검사한 ClosedXML 작업 사본에 대해서만 허용한다.

### 대안 검토

| 대안 | 검토 결과 |
|---|---|
| SpreadJS | Excel형 UI와 XLSX I/O는 강하지만 상용·SaaS 배포 라이선스와 hostname key가 필요해 오픈소스·단기 배포 조건과 맞지 않음 |
| Syncfusion React Spreadsheet | Excel형 UI와 formula를 제공하지만 별도 라이선스·import/export·ClosedXML 간 이중 계산 경계가 늘어남 |
| Handsontable + HyperFormula | cell 입력과 grid 성능은 좋지만 기존 workbook의 chart·shape·이름 정의·복잡한 style 재현을 REFLO가 추가 구현해야 함 |
| AG Grid Enterprise | 대규모 행 중심 데이터에는 강하지만 기존 Excel workbook을 그대로 편집하는 spreadsheet UI가 아니므로 요구사항과 맞지 않음 |
| Univer | open-source core와 formula worker가 장점이나 XLSX import/export, chart, printing 등 필요한 기능의 Pro·server 의존성과 제품 성숙도를 별도 검증해야 함 |
| Jspreadsheet | 가벼운 입력 grid에는 적합하지만 실제 증권사 workbook의 고충실도 재현과 서버 권위 동기화를 추가 검증해야 함 |
| 자체 Canvas/WebGL grid | 특정 성능은 높지만 MVP fixture 크기에는 과도하다. 우선 semantic HTML/CSS grid로 구현하고 계측 후에만 검토 |
| Microsoft Excel for the web embedding | 실제 Excel 호환성은 높지만 외부 Microsoft 저장소·인증·문서 서버 경계와 REFLO의 자체 파일·권한 모델이 강하게 결합됨 |

### 라이선스와 버전 정책

- React grid는 REFLO AGPL-3.0 소스의 일부이며 상용 key나 watermark를 사용하지 않는다.
- ClosedXML 0.105.0과 직접 의존성의 MIT·third-party notice를 배포 산출물에 포함한다.
- ClosedXML version을 변경하면 workbook 재현, cell permission, formula 계산과 저장 회귀검사를 다시 수행한다.
- client bundle에는 XLSX parser, formula engine, designer, collaboration, AI와 pivot module을 포함하지 않는다.

### 허용하지 않는 방식

- workbook 전체 편집기를 흉내 내며 지원하지 않는 Excel 기능을 제공하는 것처럼 표시하는 방식
- browser가 셀의 노란 배경·파란 글씨를 다시 판정해 편집 권한을 결정하는 방식
- client 계산 결과를 ClosedXML 검증 없이 PDF나 최종 Excel 값으로 사용하는 방식
- client가 보낸 formula result, editable flag 또는 sheet protection을 server가 신뢰하는 방식
- 입력할 때마다 전체 XLSX를 client와 server 사이에서 다시 업로드·다운로드하는 방식
- 수식 셀, 검증된 실제값, hidden system sheet 또는 workbook 구조를 browser에서 수정하는 방식
- paste 대상의 일부만 조용히 적용하고 나머지를 버리는 방식
- client export 파일을 최종 산출물로 제공하는 방식
- 호환되지 않는 Excel 기능을 사용자에게 알리지 않고 삭제하거나 단순화하는 방식
- React read model과 ClosedXML 값이 다를 때 client 값을 우선하는 방식

### 구현 acceptance criteria

1. 기준 `fixtures/ISC_095340_Peer_PER_Valuation_v4.xlsx`의 13개 sheet, style, 98개 merge, 178개 formula와 hidden state를 read model로 재현한다.
2. TD-003의 직접 입력 셀 중 workflow가 허용한 셀만 편집되고 우회 입력, formula 입력과 보호 셀 paste가 차단된다.
3. 화면 표시값이 TD-004 ClosedXML 결과와 일치한다.
4. number, percentage, date, blank, negative value, Korean text와 multi-cell paste의 typed value 변환을 검증한다.
5. active sheet 최초 표시 시간, scroll·selection 응답성, input-to-authoritative-result latency와 browser peak memory를 측정한다.
6. stale version, 중복 request, out-of-order response, 계산 실패와 session 복구에서 값이 중복 적용되거나 유실되지 않는다.
7. Chrome과 Edge에서 keyboard, IME 한글 입력, clipboard, zoom과 accessibility 기본 동작을 로컬 서버 화면으로 검증한다.

---

## TD-011. 파일·작업 실행 환경

### 상태

`일단 확정`

저장·실행 구조와 기본 정책은 확정한다. 실제 PDF·Excel·조사 작업의 p50·p95, peak RSS, 동시 처리량과 비용을 측정해 작업별 자원 한도와 제한시간을 보정하면 `확정`으로 전환한다.

### 배경

REFLO는 사용자 업로드 PDF·Excel·폰트, 수집한 원문, 중간 분석 결과와 최종 PDF·XLSX를 보존해야 한다. PDF 분석·렌더링, Excel 재계산, Research·Validation Agent와 최종 검증은 처리 시간이 서로 다르고 일부는 수 분 이상 실행된다. 화면을 닫아도 작업이 계속되어야 하며 서버나 워커가 재시작되어도 완료한 단계를 잃지 않아야 한다.

업로드 파일은 신뢰할 수 없는 입력이다. PDF·폰트·Excel parser와 렌더링 라이브러리는 API 서버와 분리된 환경에서 실행하고, 한 고객의 파일이나 작업이 다른 사용자에게 노출되거나 전체 서비스 자원을 고갈시키지 않게 해야 한다.

### 결정

REFLO의 파일·작업 실행 환경으로 다음 조합을 채택한다.

1. 원본과 생성 파일은 **S3 API 호환 객체 저장소**에 저장한다.
2. 파일 소유권, 논리 버전, hash, 작업 상태와 산출물 연결은 **PostgreSQL**에 저장한다.
3. 장시간·다단계 작업의 오케스트레이션은 **Temporal**을 사용한다.
4. PDF Python, Excel .NET, 조사·검증과 LLM 작업은 별도 task queue와 별도 워커 이미지로 분리한다.
5. 워커는 사전 가동된 격리 컨테이너 풀로 운영하고 실제 파일 작업은 작업별 자식 프로세스에서 실행한다.
6. 원본과 승인된 중간·최종 산출물은 불변 artifact로 취급한다. 수정은 덮어쓰기가 아니라 새 논리 버전 생성으로 처리한다.

### 파일 저장 구조

```text
Browser
  → server가 upload session과 제한된 presigned URL 발급
  → quarantine/{ownerScopeId}/{uploadId} 직접 업로드
  → server가 upload 완료·크기·checksum 확인
  → 격리 워커가 형식·암호화·악성 여부·지원 범위 검사
  → 검사 성공 시 immutable/{ownerScopeId}/{sha256}/{artifactId} 등록
  → PostgreSQL file_version과 object version 연결
```

- API server가 대용량 파일 byte를 중계하지 않고 browser가 객체 저장소로 직접 업로드한다.
- presigned URL은 단일 object key, 허용 크기, content type과 짧은 만료시간으로 제한한다.
- multipart upload는 완료 전 `uploading` 상태로 관리하고 중단된 part와 orphan object를 주기적으로 정리한다.
- 업로드가 끝난 뒤 server 또는 검사 워커가 전체 byte 기준 SHA-256을 계산하고 저장소 checksum과 대조한다.
- 파일명은 표시용 metadata일 뿐 object key나 권한 판정에 사용하지 않는다.
- client가 전달한 object key, owner ID, hash와 검사 결과를 신뢰하지 않는다.
- 원본 PDF·Excel·폰트는 변경하지 않는다. 분석·재계산·렌더링은 별도 작업 사본에서 수행한다.
- 동일 byte 중복 제거는 동일 owner scope 안에서만 허용한다. 서로 다른 사용자 사이의 전역 중복 제거는 파일 존재 여부 노출과 권한 결합을 피하기 위해 사용하지 않는다.
- S3 version ID는 장애·실수 복구 수단이다. 사용자에게 보이는 버전과 재현성은 REFLO의 `file_version`과 SHA-256으로 관리한다.
- Object Lock 또는 동등한 WORM 기능은 검증 완료 Evidence 원문, 승인된 최종 보고서와 감사 보존 대상에 선택 적용한다. 임시 파일과 삭제 요청 대상 전체에 일괄 적용하지 않는다.

### 최소 파일 메타데이터

| 필드 | 규칙 |
|---|---|
| `artifact_id` | REFLO 내부 불변 식별자 |
| `owner_google_user_id` | 검증된 로그인 session에서 얻은 소유자 ID |
| `project_id` | server가 소유권을 확인한 프로젝트 |
| `artifact_kind` | upload, source, working-copy, render, validation, final 등 |
| `object_key` | server만 생성; 사용자 입력 금지 |
| `object_version_id` | 저장소가 반환한 version ID |
| `sha256` | 전체 원본 byte 기준 lowercase hex |
| `byte_size`, `media_type` | server 검증값 |
| `original_filename` | 표시용으로만 사용하고 path 문자는 정규화 |
| `created_at`, `created_by` | 생성 시각과 사용자·system actor |
| `supersedes_artifact_id` | 새 논리 버전이 대체하는 이전 artifact |
| `retention_class` | temporary, project, evidence, final, legal-hold |

모든 조회·다운로드·presigned URL 발급은 검증된 Google 사용자 ID와 project 소유권을 server에서 다시 확인한다. object key를 알고 있다는 사실은 권한으로 인정하지 않는다.

### 작업 오케스트레이션

대표 workflow는 다음과 같다.

- API는 job, 고정 input version과 outbox command를 하나의 PostgreSQL transaction에 저장한다.
- Outbox Dispatcher는 deterministic workflow ID로 Temporal execution을 시작한다.
- Workflow Control Worker는 Workflow 정의, activity 순서, replay·versioning, cancellation과 reconciliation을 담당한다.
- PDF·Excel·Research·Agent activity worker는 PostgreSQL에 직접 쓰지 않고 service identity로 Internal Worker API에 진행률과 typed result를 제출한다.
- Internal Worker API가 project·job·input version·artifact hash를 다시 검증하고 domain transaction과 projection을 갱신한다.

```text
FileIngestWorkflow
  → ValidateUpload
  → AnalyzePdf 또는 AnalyzeExcel
  → BuildTemplateIR과 MappingSet

ResearchWorkflow
  → CollectSource[]
  → ExtractCandidate[]
  → ValidateEvidence[]
  → 사용자 검토 projection 갱신

ReportWorkflow
  → RecalculateExcel
  → FreezeEvidenceVersion
  → BuildRenderPlan
  → RenderPdf
  → StructuralValidation
  → VisualValidation
  → PublishDraft
```

- Temporal workflow에는 작은 식별자와 결정 상태만 저장한다. PDF·XLSX byte, 페이지 image와 대형 agent 응답은 객체 저장소에 두고 artifact ID만 전달한다.
- 각 activity는 같은 입력으로 다시 실행되어도 결과가 중복 생성되거나 상태가 이중 적용되지 않게 idempotent하게 구현한다.
- idempotency key는 기본적으로 `workflowId + activityType + inputVersionHash`로 만든다.
- 완료 artifact가 이미 존재하고 입력·도구 버전이 같으면 기존 결과를 재사용한다.
- workflow 이벤트는 내부 복구 이력으로 사용한다. 사용자 진행률과 목록 조회는 PostgreSQL projection table에 별도로 반영한다.
- 새 배포가 진행 중 workflow의 replay를 깨뜨리지 않게 workflow versioning 정책을 사용한다.

### Task queue와 워커 분리

| Task queue | 실행 환경 | 주요 작업 |
|---|---|---|
| `workflow-control` | Node.js control worker | Workflow 정의·replay·versioning·reconciliation |
| `file-scan` | 제한된 검사 container | MIME·magic byte·암호화·악성·크기 검사 |
| `pdf-analysis` | Python PDF worker | PyMuPDF 분석, Template IR 입력 생성 |
| `pdf-render` | Python PDF worker | pikepdf/qpdf 수정, PDFium 렌더링 |
| `pdf-visual-verify` | Python CV worker | OpenCV 마스크 비교 |
| `excel-calc` | .NET worker | ClosedXML 로드·재계산·저장 |
| `research-network` | network 허용 worker | DART·IR·KRX·ECOS·FnGuide 컨센서스·뉴스 수집 |
| `evidence-validation` | 검증 worker | 원문 재확인, 정규화와 Evidence 생성 |
| `llm` | agent worker | PydanticAI agent 실행 |
| `publish` | 제한된 server worker | 승인 버전 고정, 다운로드 artifact 게시 |

무거운 PDF 렌더링이 짧은 Excel 계산이나 상태 갱신을 막지 않도록 queue, autoscaling 기준과 동시 실행 수를 분리한다. 우선순위가 필요하면 사용자 대기 작업과 background 재처리를 별도 queue로 분리하며 한 queue 안의 무제한 우선순위는 사용하지 않는다.

### 워커 격리와 자원 정책

- API·web process 안에서 PDF parser, PDFium, OpenCV, ClosedXML과 업로드 폰트를 직접 실행하지 않는다.
- activity worker에 PostgreSQL credential을 제공하지 않는다. domain과 projection 변경은 service-authenticated Internal Worker API만 수행한다.
- 워커 container는 non-root, read-only root filesystem, privilege escalation 금지, capability 제거와 runtime default seccomp를 기본으로 한다.
- host path와 Docker socket을 mount하지 않는다.
- 작업마다 전용 임시 directory를 만들고 완료·실패·취소 후 삭제한다.
- 원본은 read-only로 내려받고 결과는 새 object key로 업로드한다.
- 파일 처리 워커는 기본적으로 외부 network egress를 차단한다.
- `research-network`만 allowlist와 egress proxy를 통해 외부에 접근한다. private·loopback·link-local 주소와 cloud metadata endpoint는 차단한다.
- CPU, memory, process 수, 열린 파일 수와 임시 disk quota를 worker 종류별로 제한한다.
- PDFium document handle, ClosedXML workbook instance와 임시 파일을 작업 간 공유하지 않는다.
- 서로 다른 PDF 페이지는 별도 process에서 병렬화할 수 있지만 같은 handle을 여러 thread가 공유하지 않는다.
- memory limit 초과 또는 비정상 종료는 해당 작업 실패로 격리하고 worker node 전체 장애로 확산시키지 않는다.

사전 가동 container pool로 library와 font cache의 cold start를 줄이되, 각 파일은 자식 process에서 처리해 작업 종료 후 parser 상태와 memory를 폐기한다. 고위험 입력이나 enterprise 보안 요구에는 작업별 container 또는 microVM을 별도 실행 등급으로 제공할 수 있다.

### 제한시간·heartbeat·재시도

초기 운영값은 다음과 같다. hard limit은 실제 표본 p95와 최대 지원 문서 크기를 측정해 보정한다.

| 작업 | 초기 제한시간 | 자동 재시도 |
|---|---:|---:|
| upload 완료·형식·악성 검사 | 60초 | infrastructure 오류만 최대 2회 |
| PDF 분석 | 페이지당 30초, 문서당 10분 | worker·I/O 오류 최대 2회 |
| PDF 렌더링 | 페이지당 60초, 문서당 15분 | worker·I/O 오류 최대 2회 |
| 전체 시각 검증 | 15분 | infrastructure 오류 최대 1회 |
| Excel 로드·재계산·저장 | 60초 | process 장애 최대 1회 |
| 외부 URL 요청 | 요청당 30초 | 429·5xx·timeout 최대 3회 |
| Research workflow | 전체 30분 | 실패 activity 단위 재시도 |
| 단일 LLM 호출 | 5분 | 429·5xx·timeout 최대 3회 |
| 최종 PDF 생성·검증 | 20분 | infrastructure 오류 최대 1회 |

- 재시도 간격은 기본 `5초 → 20초 → 60초` exponential backoff와 jitter를 사용한다.
- 암호화 PDF, 스캔 이미지 PDF, 잘못된 파일, 지원하지 않는 Excel 함수·외부 링크, parser가 반복해서 확인한 구조 오류는 non-retryable로 분류한다.
- 장시간 activity는 현재 page, 처리 개수와 최근 진전 시각을 heartbeat로 보낸다.
- page 단위 독립 결과는 불변 artifact로 checkpoint하여 전체 문서를 처음부터 다시 처리하지 않는다.
- 사용자가 취소하면 아직 시작하지 않은 activity를 중단하고 실행 중인 자식 process에 정상 종료 신호를 보낸 뒤 grace period 후 강제 종료한다.
- timeout·취소·worker 장애로 종료된 작업이 partial artifact를 최종 결과로 게시하지 못하게 `temporary` 상태와 publish 단계를 분리한다.

### 대안 검토

| 대안 | 검토 결과 |
|---|---|
| server local disk | 단일 개발 환경에는 빠르지만 다중 instance, 장애 복구와 worker 공유를 충족하지 못해 production 원본 저장소로 사용하지 않음 |
| NAS·공유 filesystem | 기존 file API 사용은 쉽지만 확장·잠금·장애 경계와 다중 region 운영이 불리해 주 저장소로 채택하지 않음 |
| PostgreSQL BLOB | 작은 payload에는 원자성이 좋지만 PDF·XLSX·page image가 DB backup·replication·I/O를 지배하므로 사용하지 않음 |
| PostgreSQL `SKIP LOCKED` queue | 초기 구현은 단순하지만 장기 workflow의 timer, heartbeat, replay, 단계 재시도와 취소를 직접 구현해야 하므로 주 queue로 사용하지 않음 |
| Redis·Celery·BullMQ | 짧은 독립 작업 처리량은 높지만 전체 workflow 상태와 정확한 복구·보상을 추가 구현해야 하므로 REFLO의 주 orchestration으로 사용하지 않음 |
| RabbitMQ | routing과 acknowledgement는 강하지만 업무 workflow 이력은 별도 시스템이 필요해 주 orchestration으로 사용하지 않음 |
| SQS + Batch/Fargate | 관리형 확장은 유력하나 provider 종속과 작업별 cold start가 있으므로 현재 기본안으로 채택하지 않음 |
| 작업마다 새 Kubernetes Job | 격리는 높지만 page·짧은 계산마다 pod cold start 비용이 커서 기본값으로 사용하지 않음 |

### 허용하지 않는 방식

- 원본 파일을 덮어쓰거나 같은 object key의 최신 값만으로 보고서를 재현하는 방식
- client가 전달한 user ID·project ID·object key만으로 파일 접근을 허용하는 방식
- API server process에서 업로드 PDF·Excel·폰트 parser를 실행하는 방식
- queue message 안에 PDF·XLSX 또는 page image 전체를 넣는 방식
- 모든 오류를 동일하게 재시도하거나 무제한 재시도하는 방식
- idempotency와 결과 중복 검사를 구현하지 않은 activity
- 파일 처리 워커에 unrestricted internet과 cloud metadata 접근을 허용하는 방식
- 완료되지 않은 partial artifact를 사용자 다운로드나 후속 단계에 노출하는 방식

### 확정 전환 조건

1. 기준 PDF·Excel과 최대 지원 크기 표본으로 queue 대기, 처리시간 p50·p95, peak RSS, CPU와 임시 disk를 측정한다.
2. PDF·Excel·Research worker별 동시 실행 수와 autoscaling 기준을 정한다.
3. worker 강제 종료, node 재시작, Temporal 장애와 network 단절 후 workflow가 완료 지점부터 복구되는지 검증한다.
4. 동일 activity를 중복 전달해도 artifact와 DB 변경이 한 번만 적용되는지 검증한다.
5. 취소·timeout 시 자식 process, 임시 object와 multipart upload가 남지 않는지 검증한다.
6. owner·project가 다른 사용자의 object key를 알고 있어도 조회·다운로드할 수 없는지 검증한다.
7. production 객체 저장소, Temporal 운영 방식과 backup·복구 목표를 확정한다.
8. 임시·프로젝트·Evidence·최종 artifact의 보존기간과 삭제 절차를 TD-012 정책과 함께 확정한다.
9. Temporal history·PostgreSQL projection·S3 artifact 불일치를 reconciliation이 탐지·복구하는지 검증한다.

### 참고 기준

- Temporal Documentation: <https://docs.temporal.io/>
- Amazon S3 Versioning: <https://docs.aws.amazon.com/AmazonS3/latest/userguide/versioning-workflows.html>
- Amazon S3 Object Lock: <https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lock.html>
- Amazon S3 object integrity: <https://docs.aws.amazon.com/AmazonS3/latest/userguide/checking-object-integrity.html>
- Kubernetes container security context: <https://kubernetes.io/docs/tasks/configure-pod-container/security-context/>

---

## TD-012. Evidence 저장 방식

### 상태

`일단 확정`

원문과 Evidence의 불변 저장, locator와 provenance 구조는 확정한다. 뉴스·유료 자료의 보존 권한, 고객 삭제 요청과 감사 보존기간을 법무·운영 정책으로 확정하고 표본 문서의 위치 재현 검증을 통과하면 `확정`으로 전환한다.

### 배경

REFLO의 모든 핵심 숫자와 보고서 주장은 원문 위치 또는 Excel 계산 경로를 가져야 한다. Validation Agent는 Research Agent의 추론을 신뢰하지 않고 공식 URL, 문서 ID, 페이지·문단 위치와 정규화 값을 받아 원문을 독립적으로 다시 확인한다.

URL과 인용문 문자열만 저장하면 웹페이지 수정·삭제, PDF 교체, redirect와 parser 변경 후 당시 검증 결과를 재현할 수 없다. 반대로 대형 원문 파일과 page image를 관계형 DB에 직접 저장하면 backup·replication·검색 성능이 저하된다. 원문 byte 보존, 정확한 위치 이동, 버전 고정, 출처 충돌과 보고서까지 이어지는 계보를 함께 만족해야 한다.

### 결정

REFLO Evidence는 **원문 byte와 대형 파생물은 객체 저장소, 구조화 metadata·locator·검증 결과·provenance는 PostgreSQL**에 분리 저장한다.

1. 수집하거나 업로드한 원문은 `source_version`마다 불변 artifact로 보존한다.
2. Evidence는 원문을 수정하지 않고 특정 `source_version`과 locator를 참조한다.
3. Evidence 정정·재수집·재검증은 기존 row 수정이 아니라 새 version 생성과 `supersedes` 관계로 처리한다.
4. 보고서, Excel 값과 RenderPlan은 사용한 Evidence version ID를 고정한다.
5. 검색 index와 vector embedding은 재생성 가능한 파생물이며 원본 또는 권위 Evidence 저장소로 사용하지 않는다.

### 논리 데이터 모델

```text
source
  └─ source_version
       ├─ source_artifact
       ├─ source_locator
       └─ evidence
            ├─ evidence_value
            ├─ validation_run
            └─ provenance_edge
                 ├─ claim
                 ├─ excel_cell_value
                 ├─ report_block
                 └─ render_plan
```

### 최소 entity

#### `source`

- 논리적으로 같은 문서·공시·기사·dataset을 나타낸다.
- `source_type`: DART, COMPANY_IR, KRX, ECOS, FNGUIDE_CONSENSUS, OFFICIAL, NEWS, USER_UPLOAD
- 공식 문서 ID, 발행기관과 canonical URL을 가진다.
- URL만으로 동일 source를 판정하지 않는다. DART 접수번호, 문서 ID 등 안정적인 공식 식별자가 있으면 우선 사용한다.

#### `source_version`

- 특정 시점에 확보한 원문 snapshot이다.
- `source_version_id`, `source_id`, `artifact_id`
- `sha256`, byte size, MIME type
- `requested_url`, `canonical_url`, `final_url`
- `captured_at`, `published_at`, `effective_at`
- HTTP status, Content-Type, ETag, Last-Modified와 redirect chain
- 수집기·parser 이름과 version
- 접근권한, 라이선스·보존 등급과 삭제 상태

`captured_at`은 REFLO가 확보한 시각, `published_at`은 출처의 발행 시각, `effective_at`은 데이터가 의미하는 기준 시각이다. 세 값을 하나의 날짜로 합치지 않는다.

#### `source_locator`

- 하나의 원문 안에서 Evidence가 존재하는 정확한 위치를 나타낸다.
- locator는 PDF, HTML, spreadsheet, structured API 유형별 typed field를 갖고 출처별 추가 정보만 JSONB에 저장한다.
- locator의 핵심 조회 필드인 page index, sheet name, cell range와 exact quote hash는 일반 column과 index로 둔다.

#### `evidence`

- `evidence_id`, `evidence_version`, `source_version_id`, `locator_id`
- `quote_exact`, `quote_normalized`, `quote_sha256`
- `claim_type`: fact, metric, event, definition, supporting, contradicting
- 원본 값과 정규화 값, 단위, 통화, 기간, 연결·별도 기준, 실제·추정 구분
- 검증 상태, 검증 시각과 최신 validation run ID
- `supersedes_evidence_id`와 정정 이유

#### `validation_run`

- validation 대상 Evidence와 결과: passed, failed, needs-review
- 검증 코드 version, model·prompt version, 실행 시각
- 원문 존재, 문맥, 기업·기간, 단위, 값 정규화와 계산 검증 결과
- 실패 이유와 사용자 판단이 필요한 항목

Validation Agent의 자유 형식 설명만 저장하지 않고 판정 항목을 구조화한다. 원시 agent 응답은 별도 제한 접근 artifact로 보존할 수 있다.

#### `provenance_edge`

- `from_type`, `from_id`, `to_type`, `to_id`, `relation_type`
- 관계 예: `extracted_from`, `normalized_from`, `calculated_from`, `supports`, `contradicts`, `rendered_in`, `supersedes`
- 원문 → Evidence → Excel 입력값 → 수식 결과 → 보고서 문장·표·차트까지의 경로를 표현한다.
- Excel 계산 경로는 Evidence를 수식 결과에 직접 연결해 생략하지 않고 입력 셀과 계산 dependency를 거친다.

### PDF 위치 저장 규칙

PDF locator는 최소한 다음 정보를 저장한다.

```json
{
  "page_index": 4,
  "page_label": "5",
  "coordinate_space": "pdf_points_cropbox",
  "bbox": [72.1, 181.4, 511.8, 215.2],
  "page_width": 595.0,
  "page_height": 842.0,
  "page_rotation": 0,
  "quote_exact": "2026년 1분기 매출액은 ...",
  "quote_normalized": "2026년 1분기 매출액은 ...",
  "char_start": 3812,
  "char_end": 3841,
  "page_text_sha256": "...",
  "page_render_sha256": "..."
}
```

- `page_index`는 0-based 내부 번호, `page_label`은 문서에 표시되는 번호다.
- bbox는 PDF point 단위의 CropBox 좌표계를 기본으로 한다.
- MediaBox, CropBox, rotation과 화면 좌표 변환 matrix를 source version 또는 page metadata에 함께 저장한다.
- 표·차트처럼 여러 영역인 Evidence는 하나의 큰 bbox로 합치지 않고 ordered region 배열을 저장할 수 있다.
- exact quote, character offset와 bbox를 함께 저장한다. 어느 한 방식만 저장하지 않는다.
- page text와 검증용 render의 hash를 저장해 동일 source version에서 parser·renderer 결과가 바뀌었는지 감지한다.
- UI는 저장된 source version을 열어 같은 좌표를 highlight한다. 최신 URL의 다른 PDF에 기존 좌표를 적용하지 않는다.

### HTML·뉴스 위치 저장 규칙

HTML locator는 다음을 함께 저장한다.

- 사용자가 입력하거나 수집 계획에 있던 `requested_url`
- redirect 후 `final_url`과 문서가 선언한 `canonical_url`
- `captured_at`, HTTP status, Content-Type, ETag, Last-Modified와 redirect chain
- exact quote, normalized quote, prefix, suffix와 본문 character offset
- 가능하면 CSS selector 또는 XPath와 구조화 section heading
- 생성한 `#:~:text=` Text Fragment
- 원 응답 또는 보존이 허용된 snapshot의 SHA-256
- 추출 본문과 extraction parser version

CSS selector, XPath, character offset 또는 Text Fragment 중 하나만으로 위치를 표현하지 않는다. 사이트 개편이나 동적 markup 변경에 대비해 exact quote와 prefix·suffix를 함께 보존한다.

보존 권한이 있는 공개·공식 웹 원문은 HTTP 응답과 수집 metadata를 WARC 또는 동등한 재현 가능한 snapshot으로 저장할 수 있다. JavaScript 실행 결과가 근거인 경우 raw response만으로 재현되지 않으므로 허용 범위 안에서 최종 DOM snapshot과 근거 영역 screenshot을 파생 artifact로 추가한다.

뉴스·유료 자료는 전체 본문을 일반 사용자에게 기사처럼 재배포하지 않는다. 계약·저작권 정책상 전체 snapshot 보존이 허용되지 않으면 공식 URL, 최소 검증 인용문, 본문·인용문 hash, 위치·발행·수집 metadata와 내부 검증 결과만 보존한다. 구체적 보존 범위는 출처별 policy로 관리한다.

### 구조화 API·Excel 위치 저장 규칙

#### DART·KRX·ECOS 등 구조화 API

- 공식 문서·접수·통계 식별자
- API endpoint와 요청 parameter의 canonical form
- response 원본 artifact와 SHA-256
- JSON Pointer 또는 XPath
- 기업·통계 코드, 기간, 단위, 연결·별도, 값 종류
- 정규화 전 원본 값과 정규화 후 값

#### Excel

- workbook artifact와 version ID
- sheet의 표시명과 stable sheet identity
- cell 또는 range 주소
- 원본 값, formula, number format와 계산 version
- 직접 입력값이면 연결 Evidence ID
- 계산값이면 dependency graph 또는 계산 경로 artifact ID

### 인용문과 hash 정규화

- `quote_exact`는 원문에서 추출한 문자열을 보존하며 UI 인용과 재검증의 기준이다.
- `quote_normalized`는 Unicode NFC, 줄바꿈·공백 정규화 등 검색용 변환 결과다.
- 대소문자, 숫자, 소수점, 통화와 단위를 의미상 변경하지 않는다.
- `quote_sha256`은 정규화 규칙 version과 정규화 문자열을 함께 canonical encoding한 값으로 계산한다.
- 파일 SHA-256, page text SHA-256, quote SHA-256의 목적을 구분하고 서로 대체하지 않는다.
- JSON hash가 필요하면 field 순서와 숫자·날짜 표현을 정한 canonical JSON 규칙을 사용한다.

### 버전·정정·충돌 규칙

- `source_version`, `evidence`와 `validation_run`은 append-only다.
- 원문 재수집 결과 byte가 같아도 수집 시각과 HTTP metadata가 필요하면 새 capture를 기록할 수 있으나 동일 artifact를 참조한다.
- 인용문, 값, 단위, locator 또는 검증 결과가 바뀌면 새 Evidence version을 생성한다.
- 이전 Evidence는 삭제·수정하지 않고 `superseded` 상태와 대체 ID를 기록한다.
- DART와 IR처럼 서로 다른 원문 값은 한 Evidence로 합치지 않는다. 각각 저장한 뒤 `contradicts` edge와 차이 원인을 연결한다.
- 사용자 선택은 원 Evidence를 바꾸지 않고 선택한 Evidence ID, 사용자, 시각과 이유를 별도 decision record로 남긴다.
- 이미 승인한 보고서는 당시 고정한 source·Evidence·Excel·RenderPlan version을 계속 참조한다.
- 새 공시나 정정자료가 수집되면 기존 보고서를 자동 변경하지 않고 stale·revalidation 필요 상태로 표시한다.

### 검색과 성능

- source ID, project ID, source type, captured·published date, validation status와 hash는 B-tree index를 사용한다.
- exact quote 검색은 별도 검색 column과 PostgreSQL full-text 또는 trigram index를 사용한다.
- 출처별 가변 metadata는 JSONB에 저장하고 실제 조회 패턴이 있는 경로만 GIN 또는 expression index를 만든다.
- 대형 raw HTML, WARC, PDF, page image와 agent raw response를 JSONB에 넣지 않는다.
- vector embedding과 외부 검색 index는 Evidence ID와 version을 key로 사용하고 원문·권위 판정을 대신하지 않는다.
- page preview는 파생 image를 cache하되 source artifact와 rendering profile hash가 같은 경우에만 재사용한다.

### 보안·보존·삭제

- source와 Evidence 조회는 project 소유권과 검증된 Google 사용자 ID를 server에서 확인한다.
- 내부 원문 snapshot과 agent raw response는 일반 보고서 사용자보다 좁은 접근권한을 적용할 수 있다.
- object 저장은 server-side encryption을 사용하고 전송은 TLS로 제한한다.
- 임시 수집물, 프로젝트 원문, 검증 Evidence, 최종 산출물과 legal hold를 서로 다른 retention class로 관리한다.
- 프로젝트 삭제 요청은 DB row만 지우지 않고 object version, 파생 cache, 검색 index와 backup 만료 절차까지 추적하는 deletion workflow로 처리한다.
- 감사 보존이나 legal hold가 삭제 요청보다 우선해야 하는 범위는 약관·법무 정책으로 명시하고 사용자에게 고지한다.
- Object Lock은 보존 의무가 확정된 artifact version에만 적용한다.

### 대안 검토

| 대안 | 검토 결과 |
|---|---|
| URL과 인용문만 저장 | 원문 변경·삭제 후 검증을 재현할 수 없으므로 허용하지 않음 |
| 모든 원문과 page image를 PostgreSQL BLOB에 저장 | DB backup·replication·I/O가 대형 binary에 지배되므로 사용하지 않음 |
| Evidence 전체를 비정형 JSON 한 개로 저장 | 초기 구현은 빠르지만 관계 무결성, 핵심 index와 버전 고정이 약하므로 핵심 field에는 사용하지 않음 |
| 검색 engine을 원본 저장소로 사용 | index 재구축·분석기 변경과 eventual consistency 때문에 권위 저장소로 사용하지 않음 |
| graph database를 주 저장소로 사용 | provenance 탐색에는 유리하지만 현재 규모에서 운영 복잡도가 크므로 PostgreSQL edge table로 시작함 |
| 최신 URL을 매번 다시 열어 검증 | 당시 원문 version을 보장하지 못하므로 보조 확인에만 사용함 |

### 허용하지 않는 방식

- source version 없이 최신 object key나 최신 URL만 Evidence가 참조하는 방식
- exact quote 없이 AI 요약문만 저장하는 방식
- PDF page number만 저장하고 좌표·인용문·좌표계를 저장하지 않는 방식
- HTML CSS selector 또는 Text Fragment 하나만 저장하는 방식
- Evidence 값이나 검증 상태를 UPDATE하여 이전 승인 보고서의 근거가 바뀌는 방식
- DART·IR 충돌 값을 덮어쓰거나 한 값으로 임의 병합하는 방식
- vector database의 검색 결과를 검증된 Evidence로 간주하는 방식
- 사용자에게 보여줄 필요가 없다는 이유로 수집기·parser·model·prompt version을 누락하는 방식
- 뉴스 snapshot을 권한 검토 없이 일반 사용자에게 원문 기사처럼 제공하는 방식

### 확정 전환 조건

1. DART PDF, 기업 IR PDF, HTML 뉴스, 구조화 API와 사용자 업로드 문서 표본에 대해 저장 후 원문의 정확한 위치를 다시 연다.
2. PDF CropBox·회전·page label이 다른 표본에서 bbox highlight가 원문 영역과 일치한다.
3. HTML markup 변경 또는 Text Fragment 실패 시 exact quote·prefix·suffix로 근거를 복구할 수 있는지 검증한다.
4. 동일 원문의 정정·재수집·Evidence 정정과 충돌 선택 후 이전 보고서가 과거 version을 그대로 재현하는지 검증한다.
5. 원문 → Evidence → Excel 입력 → 계산값 → 보고서 문장·표·차트의 provenance 경로가 끊김 없이 조회되는지 검증한다.
6. source별 전체 본문·snapshot 보존과 표시 권한, 보존기간과 삭제 예외를 법무·운영 정책으로 확정한다.
7. project 삭제 workflow가 object version, 파생물, 검색 index와 backup 만료 상태를 추적하는지 검증한다.
8. Evidence 조회량과 page preview 부하에서 PostgreSQL·객체 저장소의 p95 응답시간과 저장 비용을 측정한다.

### 참고 기준

- WARC ISO 28500 개요: <https://www.loc.gov/preservation/resources/rfs/webarchives.html>
- PostgreSQL JSONB indexing: <https://www.postgresql.org/docs/current/datatype-json.html>
- PostgreSQL GIN indexes: <https://www.postgresql.org/docs/current/gin.html>
- Amazon S3 object integrity: <https://docs.aws.amazon.com/AmazonS3/latest/userguide/checking-object-integrity.html>

---

## TD-013. FnGuide 컨센서스 공급자

### 상태

`일단 확정`

FnGuide의 서버 자동수집, 캐시, 원본 저장, 정규화, 파생 계산과 보고서 출력 권한을 확보했다는 제품 책임자의 확인을 전제로 한다. 공급자 계약과 저장 경계는 확정했으며, PostgreSQL·객체 저장소·Temporal 운영 경로와 세전이익·추정기관수의 추가 공급 경로를 연결하면 `확정`으로 전환한다.

### 결정

1. `https://wcomp.fnguide.com`의 기업정보 화면이 사용하는 JSON 응답을 `FnGuideConsensusProvider`로 격리한다.
2. HTML 표는 컨센서스 값 수집 경로로 사용하지 않는다.
3. 허용 endpoint는 `getCnsPerforTrend`, `getCnsPerforTrendChart`, `getCnsTrendYYMM`, `getCnsTrend`, `getCnsTrendChart`다.
4. `cmp_cd`는 6자리 ASCII 종목코드만 허용한다.
5. `consol_typ`은 DART 실제치, 기업 IR과 Excel 기준을 먼저 일치시킨 뒤 호출자가 `C` 또는 `P`를 명시한다. 공급자는 기본값을 두거나 값이 나오는 기준을 임의 선택하지 않는다.
6. `select_gsym`은 `getCnsTrendYYMM`이 반환한 `YYMM`만 사용한다. 클라이언트가 기간 코드를 추측해 만들지 않는다.
7. `data_typ`은 endpoint별 enum으로 분리하고 응답 header, row name과 provider metric code를 함께 검증한다.
8. 실제치는 DART 또는 기업 공식 IR을 권위 원천으로 유지한다. FnGuide 값은 컨센서스 비교·검증·보고서 근거에만 사용하며 실제치 셀과 사용자 미래 가정 셀을 덮어쓰지 않는다.

### 값과 비교

- 지원 지표: 매출액, 영업이익, 당기순이익, EPS, PER, Forward 12M PER, 목표주가, 투자의견 점수
- `getCnsPerforTrendChart`의 `ACT_VAL`·`CNS_VAL`은 FnGuide가 제공한 실적·당시 추정 비교 묶음으로 저장한다. 별도 관측시각이 없으므로 임의의 `observed_at`을 만들지 않는다.
- 컨센서스 대비 차이 금액은 `actual - consensus`, 차이율은 `(actual / consensus - 1) × 100`으로 서버 `Decimal`에서 계산한다.
- 컨센서스가 `null`이면 비교를 만들지 않는다. `0`이면 차이 금액만 만들고 차이율은 `비교 불가`다.
- 세전이익과 추정기관수는 승인된 JSON endpoint에서 제공되지 않는다. 별도 FnGuide 공급 endpoint 또는 사용자 기준시점 자료가 없으면 해당 필드만 `미확보`로 두고 관련 비교·표시를 제외한다.

### 스냅샷과 기준시점

성공한 HTTP 응답의 원본 body bytes를 불변 artifact로 저장한다. 응답 header는 `Date`, `ETag`, `Last-Modified`, `Content-Type`, `Cache-Control`, `Expires`, `Vary` allowlist만 원형 보존하고 credential·cookie 관련 header는 저장하지 않는다. 다음 metadata를 분리한다.

- provider, endpoint와 canonical parameter hash
- `retrieved_at`, provider가 명시한 `observed_at`, `observed_at_precision`
- 추정 대상 기간, 분기·연간, 연결·별도와 지표
- response SHA-256, HTTP Date, ETag, Last-Modified, Content-Type
- collector·normalizer version과 schema fingerprint
- license policy와 retention class

선택 규칙:

1. 보고서 `cutoff_at` 이하에 REFLO가 직접 확보한 스냅샷이 있으면 `retrieved_at`이 가장 늦은 값을 사용한다.
2. 직접 스냅샷이 없으면 FnGuide 추이의 `observed_at` 이하 최신값을 사용한다.
3. FnGuide가 날짜만 제공하면 look-ahead 방지를 위해 해당 날짜의 다음 날 00:00 KST부터 사용 가능하다고 본다.
4. 사용자가 업로드한 기준시점 자료가 있으면 사용자 확인 후 사용할 수 있다.
5. 모두 없으면 최신값을 과거값처럼 소급하지 않고 컨센서스 비교만 제외한다.

초안 생성 시 선택한 `snapshot_id`, `source_version_id`와 Evidence version을 보고서 version에 고정한다. 이후 새 스냅샷이나 과거 정정값이 생겨도 승인된 보고서를 자동 변경하지 않는다. 같은 논리 키와 관측일의 값이 달라지면 새 snapshot을 추가하고 `supersedes_snapshot_id`로 연결한다.

### 호출·장애 정책

- 호스트별 동시 요청 1개와 최소 요청 간격은 단일 process가 아니라 모든 research worker가 공유하는 분산 semaphore와 rate limiter로 강제한다. 최소 간격과 일일 호출 한도는 FnGuide 허가 문서의 조건을 server configuration으로 반영한다.
- `429`, `5xx`, timeout만 제한 횟수로 exponential backoff와 jitter를 적용한다. `Retry-After`가 있으면 허용된 최대 대기시간 안에서 우선 적용하고, 한도를 넘으면 재시도하지 않고 `PROVIDER_UNAVAILABLE`로 종료한다.
- 일반 `4xx`, Content-Type 변경, JSON schema·metric header 불일치는 재시도하지 않고 `SOURCE_FORMAT_CHANGED` 또는 `PROVIDER_UNAVAILABLE`로 종료한다.
- HTTPS와 승인 host만 허용하고 다른 host redirect를 거부한다.
- 성공 응답만 캐시한다. cache key에는 endpoint, 전체 canonical parameter와 collector version을 포함한다.
- FnGuide 허가 문서의 자동수집, 캐시, 원본 저장, 보존기간, 정규화·파생 계산, 고객 보고서 표시·배포 범위, 호출 한도와 허가 철회일을 versioned provider policy로 등록한다. 실행과 snapshot에는 적용한 `provider_policy_version`과 retention class를 기록한다.
- 세전이익과 추정기관수는 승인된 추가 공급 경로가 없으면 `미확보`로 유지한다. 관련 값, 비교와 품질 설명을 보고서에 추정하거나 대체 생성하지 않는다.
- 마지막 정상 snapshot 사용 시 snapshot 시각과 stale 정도를 표시하고 사용자 확인을 받는다.
- snapshot이 없으면 사용자 Excel·PDF 업로드를 요청하고, 그것도 없으면 실제 실적 분석은 계속하되 컨센서스 비교만 제외한다.

### 2026-07-23 live smoke test

리노공업 `058470`, 별도 `P`, 분기 `Q`, 영업이익, `202606`으로 승인 host를 직접 호출했다.

| 항목 | 확인 결과 |
|---|---|
| 요청 수 | JSON endpoint 5회, 직렬 실행 |
| Content-Type | 모두 `application/json` |
| 관측 기준일 | 2026-07-22 |
| 2Q26 영업이익 컨센서스 | 660.00억원 |
| 목표주가 컨센서스 | 136,000원 |
| 투자의견 점수 | 4.00 |
| 최근 완료 비교 | 1Q26 실제 473.01억원, 당시 컨센서스 467.71억원 |
| 형식 검증 | metric header, 기간, 단위, 연결 기준 통과 |
| 확인된 미지원 필드 | 세전이익, 추정기관수 |

같은 종목을 연결 `C`로 조회하면 주요 값이 `null`이므로 `P`를 명시하지 않는 기본 연결 정책은 허용하지 않는다.

구현 spike:

- `workers/research/reflo_research/providers/fnguide_consensus.py`
- `workers/research/reflo_research/fnguide_probe.py`
- `workers/research/tests/test_fnguide_consensus.py`

### 확정 전환 조건

1. FnGuide 허가 문서의 자동수집·캐시·원본 저장·보존기간·가공·고객 보고서 표시·배포 범위, 호출 한도와 철회 조건을 versioned provider policy에 등록한다.
2. 원본 response artifact, `consensus_snapshot`과 정규화 값을 PostgreSQL·객체 저장소에 append-only로 저장한다.
3. Temporal activity에 모든 worker가 공유하는 provider별 분산 concurrency·rate limit, timeout, `Retry-After` 기반 retry, circuit breaker와 cache를 연결한다.
4. 연결·별도 기업, 컨센서스 미제공 기업, 0·null 값, provider 정정과 endpoint 형식 변경 회귀검사를 통과한다.
5. 세전이익·추정기관수가 필요한 템플릿에 대해 추가 공급 경로 또는 표시 제외 규칙을 승인한다.
6. 보고서 `cutoff_at` 선택, date-only look-ahead 차단, stale 사용자 승인과 report snapshot 고정을 통합 테스트한다.

---

## TD-014. Google 인증과 서버 세션

### 상태

`확정`

### 결정

MVP 인증은 **Google OAuth/OIDC 로그인만 제공하고, 로그인 결과로 PostgreSQL 기반의 불투명 server session을 발급**한다.

1. 사용자 식별자는 email 문자열이 아니라 검증된 Google issuer와 subject 조합을 기준으로 한다.
2. 브라우저 cookie에는 예측 불가능한 session token만 저장하고 사용자 ID, Google access token과 refresh token을 넣지 않는다.
3. session token 원문은 PostgreSQL에 저장하지 않고 hash, 사용자, 생성·최근 사용·만료·폐기 시각을 저장한다.
4. cookie는 production에서 `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`를 적용한다.
5. 기본 만료는 7일 idle timeout과 30일 absolute timeout이며 로그아웃·계정 연결 해제 시 즉시 폐기한다.
6. 상태 변경 요청은 same-origin 검증과 선택한 인증 라이브러리의 CSRF 보호를 적용한다.
7. 모든 project·artifact 권한은 요청 body의 사용자 ID가 아니라 검증된 session 사용자로 다시 확인한다.

구체적인 Next.js 인증 package는 구현 시작 시 현재 지원 버전과 database session 지원을 확인해 고정한다. package 선택은 위 session·소유권 계약을 바꿀 수 없다.

## TD-015. 보고서 기준일의 권위 시각

### 상태

`확정`

### 결정

MVP의 대상 기업과 자료 기준 시간대는 **`Asia/Seoul`**로 고정한다.

1. 사용자는 화면과 API에서 date-only `cutoffDate`를 `YYYY-MM-DD`로 입력한다.
2. 서버는 해당 날짜의 KST 마지막 시각을 `cutoffAt`으로 파생하고 UTC `timestamptz`로 저장한다.
3. 예를 들어 `2026-07-17`은 `2026-07-17T23:59:59.999999+09:00`, 즉 `2026-07-17T14:59:59.999999Z`까지를 포함한다.
4. 조회·Evidence 선택·Agent 입력과 보고서 snapshot은 서버가 계산한 `cutoffAt` 이하만 허용한다.
5. 클라이언트가 보낸 `cutoffAt`은 권위값으로 사용하지 않는다.
6. 해외 시장을 지원할 때는 project별 market timezone을 추가하고 별도 결정으로 확장한다.

## TD-016. 장시간 작업 상태 전달

### 상태

`확정`

### 결정

MVP는 **PostgreSQL 작업 projection을 3초 간격으로 조회하는 visibility-aware polling**을 사용한다.

1. `queued`, `running`, `cancel_requested`일 때만 polling한다.
2. document가 hidden이면 polling을 중단하고 다시 visible이 되거나 window focus를 얻을 때 즉시 한 번 조회한다.
3. `succeeded`, `failed`, `cancelled`에 도달하면 자동 polling을 중단한다.
4. 일시적 실패는 마지막 정상 상태를 유지하고 최대 30초까지 지수 backoff한다.
5. 가능하면 `ETag`와 `If-None-Match`로 변경 없는 응답 비용을 줄인다.
6. SSE·WebSocket은 동시 작업량과 요청 부하 또는 사용자 체감 지연이 실제 문제로 측정될 때 별도 결정으로 도입한다.

transport를 바꾸더라도 job ID, `operationStatus`, phase, progress, heartbeat와 오류 계약은 유지한다.

## TD-017. PydanticAI와 OpenAI GPT 연결

### 상태

`확정`

Agent framework와 provider를 확정한다. Agent별 model ID, reasoning, token·timeout·비용·rate limit 기본값은 TD-023을 따른다.

### 결정

REFLO의 Style Profile, Hypothesis, Research/Validation, Report Outline·Draft Agent는 **PydanticAI를 공통 Agent framework로 사용하고 OpenAI의 GPT 모델을 server-side provider로 연결**한다.

1. OpenAI 연결은 PydanticAI의 공식 OpenAI provider와 Responses model adapter를 사용한다.
2. `OPENAI_API_KEY`와 provider credential은 `llm` worker의 secret으로만 주입하며 브라우저, Next.js client bundle, API 응답과 로그에 노출하지 않는다.
3. model ID는 Agent별 server configuration으로 주입한다. 화면 코드와 prompt에 특정 model 문자열을 직접 고정하지 않는다.
4. Agent 결과는 가능한 경우 Pydantic `output_type`으로 구조화하고 저장 전에 schema·도메인 검증을 통과시킨다.
5. prompt, output schema, tool과 model configuration은 version을 저장해 같은 산출물의 생성 조건을 추적할 수 있게 한다.
   Hypothesis Agent의 canonical prompt와 입출력 계약은 [`agents/HYPOTHESIS_AGENT_PROMPT_v3.md`](./agents/HYPOTHESIS_AGENT_PROMPT_v3.md)를 단일 원본으로 사용하고 `prompt_version = hypothesis-v3`를 기록한다.
6. output validation retry, HTTP retry와 `UsageLimits`는 서로 분리해 제한한다. 무제한 재시도와 무제한 tool call을 허용하지 않는다.
7. 모델의 원시 reasoning은 사용자에게 표시하거나 권위 Evidence로 저장하지 않는다. 검증된 결과, 사용 모델·설정 version, token usage, latency와 사용자용 오류를 실행 기록에 남긴다.
8. Agent 출력은 제안 또는 구조화 초안이며 Evidence, 권위 계산, 사용자 승인과 server validation을 우회할 수 없다.

### 확정 전환 조건

1. Agent별 후보 GPT 모델을 고정 평가 세트로 비교해 정확도, schema 통과율, latency와 비용을 기록한다.
2. Agent별 request·response token, tool call, timeout, retry와 일·사용자별 비용 한도를 정한다.
3. prompt·응답의 보존기간, 암호화, 운영자 열람과 개인정보 제거 정책을 확정한다.
4. 검증을 통과한 PydanticAI와 OpenAI SDK의 정확한 version을 lock file에 고정한다.
5. provider 장애, rate limit, malformed output, timeout과 stale input version 회귀검사를 통과한다.

## TD-018. Google OIDC·PostgreSQL 구현 도구

### 상태

`확정`

### 결정

Next.js server의 Google OIDC와 PostgreSQL access·migration 도구를 다음 exact version으로 고정한다.

| 역할 | package | version | 설치 위치 |
|---|---|---:|---|
| Google OAuth 2.0·OIDC client | `openid-client` | `6.8.4` | `source-react` runtime dependency |
| PostgreSQL client·pool | `pg` | `8.22.0` | `source-react` runtime dependency |
| PostgreSQL TypeScript type | `@types/pg` | `8.20.0` | `source-react` development dependency |
| PostgreSQL migration runner | `node-pg-migrate` | `9.0.0` | `source-react` development dependency |

`source-react/package-lock.json`이 설치 version의 단일 lock이다. 범위 version과 별도 인증 framework를 추가하지 않는다.

### 인증 구현 경계

1. `openid-client`의 Google discovery와 Authorization Code Flow를 사용한다.
2. 매 login attempt마다 PKCE `code_verifier`, `state`와 OIDC `nonce`를 생성한다.
3. callback에서 redirect URI, state, PKCE, nonce, issuer, audience와 ID Token을 검증한다.
4. 검증된 `iss`와 `sub`만 identity key로 사용한다. email은 표시·연락 metadata다.
5. Google access token과 refresh token은 REFLO session token으로 사용하거나 browser cookie에 저장하지 않는다.
6. login attempt의 verifier·state·nonce는 짧은 TTL, 일회성, hash 또는 authenticated encryption 상태로 저장하고 callback 성공·실패 뒤 폐기한다.
7. callback 완료 뒤 REFLO가 별도 random opaque session token을 발급한다.
8. PostgreSQL에는 session token 원문이 아니라 SHA-256 hash만 저장한다.
9. 상태 변경 요청은 same-origin 검증과 session-bound CSRF secret 검증을 모두 통과한다.
10. `returnTo`는 same-origin allowlist path만 허용한다.

Auth.js·Better Auth 같은 상위 인증 framework의 기본 session table을 사용하지 않는다. 기본 token 저장 방식이 TD-014의 hash-only session 계약과 달라질 수 있고, REFLO의 identity·session rotation·CSRF·감사 경계를 custom adapter에 숨기기 때문이다.

### PostgreSQL 구현 경계

1. application query는 `pg.Pool`을 공유한다.
2. parameterized query만 사용하고 identifier는 allowlist 밖에서 문자열 조합하지 않는다.
3. transaction은 `pool.query`가 아니라 `pool.connect()`로 얻은 같은 client에서 `BEGIN`·`COMMIT`·`ROLLBACK`을 수행한다.
4. checked-out client는 성공·실패와 무관하게 `finally`에서 release한다.
5. domain transaction helper는 callback 밖으로 client를 노출하지 않는다.
6. migration은 `node-pg-migrate`의 timestamped TypeScript migration으로 작성한다.
7. migration table은 application table과 구분하고 advisory lock을 사용한다. CI·배포의 concurrent invocation은 wait 또는 단일 runner로 직렬화한다.
8. production runtime role은 migration 권한을 갖지 않는다. migration은 `reflo_migrator` 전용 credential로 실행한다.
9. down migration은 local·test 복구 보조다. production rollback은 forward-fix와 복구 절차를 기본으로 한다.

### 선택 이유

- `openid-client`는 framework session 정책을 강제하지 않고 OIDC discovery, PKCE, state, nonce와 authorization response validation을 제공한다.
- `pg`는 PostgreSQL protocol과 transaction 경계를 직접 드러내 ERD의 transaction invariant와 role 분리를 구현하기 쉽다.
- `node-pg-migrate`는 SQL에 가까운 versioned migration과 PostgreSQL advisory lock을 제공한다.
- ORM model을 권위 원본으로 추가하지 않아 ERD, migration SQL과 OpenAPI·Worker schema의 책임이 겹치지 않는다.

### 검증 기준

1. Google callback의 state·nonce·PKCE 누락, 재사용, issuer·audience mismatch와 외부 `returnTo`가 거부된다.
2. 같은 Google issuer·subject의 동시 첫 login이 계정을 중복 생성하지 않는다.
3. DB dump, log와 browser cookie 어디에도 Google token·REFLO session 원문이 없다.
4. session idle 7일, absolute 30일, rotation, revoke와 logout이 TD-014를 따른다.
5. transaction 중간 실패가 부분 write를 남기지 않는다.
6. migration concurrent 실행이 advisory lock으로 직렬화되고 이미 적용한 migration을 중복 실행하지 않는다.
7. application runtime role로 DDL과 migration table 변경이 거부된다.

### 참고

- openid-client v6.8.4: <https://github.com/panva/openid-client/tree/v6.8.4>
- node-postgres pooling: <https://node-postgres.com/features/pooling>
- node-postgres transactions: <https://node-postgres.com/features/transactions>
- node-pg-migrate migrations: <https://salsita.github.io/node-pg-migrate/migrations/>

---

## TD-019. 파일 입력 운영 정책

### 상태

`확정`

### 입력 한도

MVP 기본값은 server configuration으로 관리하고 upload session 응답의 `maxSizeBytes`와 화면 helper에 그대로 반영한다.

| 입력 | 최대 크기 | 구조 한도 | upload session |
|---|---:|---:|---:|
| 이전 보고서 PDF | 50 MiB | 100 page | 15분 |
| 분석 workbook `.xlsx` | 100 MiB | 50 sheet, 전체 used-range cell 2,000,000개, sheet당 500,000개 | 15분 |
| 조사 자료 PDF | 50 MiB | 100 page | 15분 |
| 조사 자료 `.xlsx` | 100 MiB | 분석 workbook과 같은 cell 한도 | 15분 |
| 조사 자료 UTF-8 CSV | 10 MiB | 500,000 row | 15분 |
| 조사 자료 UTF-8 TXT | 5 MiB | 200,000 line | 15분 |

한도를 넘은 파일은 parser에 전달하지 않고 `FILE_TOO_LARGE` 또는 `FILE_STRUCTURE_LIMIT_EXCEEDED`로 차단한다. used-range가 서식만 적용된 빈 tail 때문에 비정상적으로 커도 자동 축소하지 않고 사용자에게 workbook 정리를 요청한다.

조사 plan 하나에는 사용자 파일 최대 10개와 공개 URL 최대 20개를 연결할 수 있다. DOCX·PPTX와 legacy Office 형식은 MVP에서 받지 않는다.

### 악성 검사·quarantine

1. 모든 직접 업로드는 quarantine object에 저장한다.
2. MIME, magic byte, container 구조와 SHA-256을 먼저 검사한다.
3. 악성 검사는 `ClamAV 1.4.5 LTS`를 격리 scan worker에서 실행한다. production image는 version tag와 image digest를 함께 고정한다.
4. signature는 `freshclam` 또는 내부 mirror로 갱신한다. 마지막 성공 갱신이 24시간을 넘으면 새 upload acceptance를 차단한다.
5. 불완전 upload는 24시간, 악성·형식·구조 검사 실패 object는 7일 뒤 삭제한다. 보안 사고 조사 hold가 있으면 별도 보존한다.
6. accepted 원본은 project 보존정책을 따른다. quarantine object를 accepted key로 rename하지 않고 새 immutable artifact로 commit한다.

### 지원·거절 범위

- PDF는 암호화되지 않은 단일 일반 PDF만 받는다.
- 전자서명 PDF는 원본 보존만으로 해결되지 않는다. 콘텐츠 변경이 서명을 무효화하므로 활성 template 입력으로 거절한다.
- PDF portfolio, embedded file, XFA, 실행 action, multimedia와 지원하지 않는 annotation subtype은 거절한다.
- Excel은 `.xlsx`만 받는다. 암호화 workbook, `.xlsm`, `.xls`, external link, DDE와 macro 입력은 MVP에서 거절한다.
- 지원하지 않는 기능을 제거하거나 평탄화해 통과시키지 않는다.

### 매핑 보정·취소

- 자동 매핑이 실패한 slot은 서버가 검증한 workbook range 후보만 사용자에게 보여준다.
- 사용자는 PDF slot 하나와 후보 range 하나를 연결하고 preview를 확인할 수 있다. 임의 formula, 임의 sheet 구조 변경과 raw address 문자열 저장은 허용하지 않는다.
- 유효 후보가 없으면 파일 교체 또는 운영자 지원으로 보낸다. 필수 slot은 미매핑 상태로 다음 단계에 진행할 수 없다.
- queued·running inspection은 사용자가 취소할 수 있다. 취소는 현재 job을 terminal `cancelled`로 만들고 temporary output을 게시하지 않는다.
- 취소한 job 자체를 재개하지 않는다. 같은 accepted file version으로 새 idempotency key를 사용해 새 inspection을 시작한다. 완료·commit된 inspection은 취소할 수 없다.

### 검증 기준

- 한도 경계값, MIME 위장, zip bomb, macro, embedded file, 암호화와 ClamAV EICAR fixture를 자동 검사한다.
- TD-011 제한시간과 resource quota 안에서 기준 PDF·XLSX와 최대 한도 stress fixture를 처리한다.
- 취소 직후 worker 종료, temporary artifact cleanup, 동일 file version 재실행과 중복 commit 방지를 검증한다.

---

## TD-020. Validation 충분성·사용자 결정

### 상태

`확정`

### 질문 충분성

Validation service가 다음 deterministic rule version으로 질문별 상태를 계산한다. Agent가 상태를 임의 확정하지 않는다.

| 상태 | 판정 |
|---|---|
| `sufficient` | 계획의 필수 지표·기간·비교 기준이 모두 검증 Evidence로 covered되고 핵심 숫자는 권위 원천 또는 독립 재계산을 통과하며 unresolved conflict·stale·반려 필수 결과가 없음 |
| `qualified` | 최소 한 개 검증 Evidence와 핵심 지표 coverage는 있으나 단일 원천, 간접 원천 또는 비핵심 보조 지표 누락 중 하나가 있음. unresolved conflict·핵심 숫자 실패는 없음 |
| `insufficient` | 필수 지표·기간·scope 누락, 검증 Evidence 부재, 핵심 숫자 실패, unresolved conflict, stale 또는 반려로 필수 coverage가 깨짐 |
| `reinvestigating` | 대체 자료 수집·재검증 job이 active |

`sufficient`는 별도 override가 없다. `qualified`만 사용자가 `ACCEPT_QUALIFIED` decision과 5~500자 이유를 남겨 다음 단계에 사용할 수 있다. `insufficient`와 `reinvestigating`은 사용자 확인으로 우회할 수 없다.

### decision 사유

- 반려, 반려 철회, 재조사, conflict source 선택과 조건부 근거 확인의 사유는 trim 후 5~500자다.
- client와 OpenAPI, application service, PostgreSQL CHECK가 같은 범위를 사용한다.
- 상태 변경은 append-only decision이다. 이전 decision row를 수정·삭제하지 않는다.

### 하위 무효화 문구

승인 뒤 decision을 변경해 downstream 결과가 존재하면 다음 공통 확인문을 사용한다.

> 이 결정을 변경하면 밸류에이션과 보고서가 재검증 필요 상태로 전환됩니다. 기존 승인본과 내보낸 파일은 보존됩니다.

사용자가 확인한 뒤에만 새 validation version을 만들고 영향받는 최신 downstream projection을 `revalidation_required`로 바꾼다.

---

## TD-021. Valuation 수치·React workbook grid 통합

### 상태

`확정`

### package·license

| 역할 | package | version |
|---|---|---:|
| workbook UI | REFLO React workbook grid | repository version |
| server Decimal | `decimal.js` | `10.6.0` |
| 권위 Excel 계산 | `ClosedXML` | `0.105.0` |

- grid는 validation·valuation route에서만 load하며 XLSX parser와 formula engine을 client bundle에 포함하지 않는다.
- workbook은 권한 검사된 same-origin API가 반환한 versioned JSON read model로 불러온다. client JSON을 권위 저장 format으로 사용하지 않는다.
- localhost, staging과 production에서 같은 AGPL-3.0 소스를 사용하며 별도 distribution key는 없다.
- 지원 browser는 desktop Chrome·Edge·Firefox 최신 2개 major와 Safari 최신 major다. CI는 Chromium을 기본 회귀 대상으로 사용하고 release candidate에서 Edge·Firefox·Safari manual smoke test를 수행한다.

### 입력·Decimal·반올림

- Target PER 직접 입력은 `0.1` 이상 `100.0` 이하, 소수 첫째 자리까지 허용한다.
- 목표주가 직접 입력은 `1`원 이상 `1,000,000,000`원 이하의 정수다. 서버가 역산 PER을 계산하고 사용자가 그 값을 다시 승인한다.
- binary float 계산을 금지한다. Next.js application 계산은 `decimal.js`, Excel 결과는 ClosedXML의 numeric 결과를 invariant decimal string으로 정규화해 사용한다.
- workbook number format과 MappingSet `display.rounding`이 있으면 이를 우선한다.
- 둘 다 없을 때 fallback은 `ROUND_HALF_UP`이다. 목표주가는 1,000원 단위, PER은 0.01배, 상승여력은 0.1% 단위로 표시한다.
- 저장값은 반올림 전 decimal string이다. 표시 반올림값을 계산 입력으로 재사용하지 않는다.

### 민감도·현재주가·계산 session

- 민감도는 5×5다. EPS axis는 기준 EPS의 `-10%, -5%, 0%, +5%, +10%`, PER axis는 기준 PER의 `-2.0, -1.0, 0, +1.0, +2.0`배다.
- PER axis가 `0.1` 미만이면 `0.1`로 clamp하고 중복 axis는 제거한다. 제거 후 행·열 수를 response에 그대로 반환한다.
- 현재주가는 KRX의 기준일 종가 immutable snapshot이다. 기준일이 휴장일이면 직전 거래일 종가를 사용하고 실제 거래일을 표시한다.
- MVP에서 사용자가 현재주가만 수동 갱신하지 않는다. 기준일 변경은 setup에서 새 version과 downstream 무효화를 만든다.
- calculation session은 최근 성공 workbook checkpoint를 15분 idle 동안 유지하고 60분에 강제 종료한다. 종료 뒤에는 최신 immutable checkpoint에서 새 session을 만든다.

### MVP 범위

Valuation AI proposal은 MVP에서 제외한다. UI는 하드코딩 제안을 표시하지 않는다. 별도 Agent profile·schema·평가가 승인된 뒤 optional feature로 추가한다.

### 반응형

- 1024px 이상은 React workbook grid의 cell 직접 편집을 제공한다.
- 640~1023px은 grid 선택과 별도 선택-cell 입력 panel을 함께 제공한다.
- 640px 미만은 grid를 읽기 전용으로 유지하고 허용 cell을 순서형 입력 목록으로 제공한다.
- 모든 폭에서 같은 server editable set과 ClosedXML 계산 계약을 사용한다.

---

## TD-022. Report 편집·미리보기·운영 정책

### 상태

`확정`

### editor·저장

| 역할 | package | version |
|---|---|---:|
| editor core | `@tiptap/core` | `3.29.0` |
| React adapter | `@tiptap/react` | `3.29.0` |
| 기본 extension 묶음 | `@tiptap/starter-kit` | `3.29.0` |

- editor는 client-only이며 `immediatelyRender: false`로 초기화한다.
- 허용 schema는 paragraph, text, hardBreak, bulletList, orderedList, listItem과 bold·italic mark다. heading은 Template IR block type이 소유하므로 사용자가 임의 생성하지 않는다.
- paste와 Agent output은 허용 schema로 sanitize한다. 임의 HTML, style, link, image node와 script는 버린다.
- Tiptap JSON과 DOM은 권위 저장값이 아니다. adapter가 기존 `replace_text`·`replace_block_text` typed operation과 안정적 text offset으로 변환한다.
- 서버 권위는 report block text, block revision과 typed operation log다. editor package를 바꿔도 wire contract는 유지한다.

### PDF preview

- browser viewer는 `pdfjs-dist@6.1.200`을 client-only로 사용한다.
- PDF.js worker는 같은 package version으로 고정하고 `GlobalWorkerOptions.workerSrc`를 workbook과 무관한 전용 chunk로 설정한다.
- 서버가 만든 PDF artifact만 viewer에 전달한다. URL은 same-origin, 짧은 만료, byte range와 project owner 검사를 지원한다.
- canvas, text layer와 page coordinate transform을 함께 사용해 선택·검색·Evidence highlight를 지원한다.
- page가 10개를 넘으면 viewport 기준 현재 page 앞뒤 2개만 render하고 나머지는 고정 크기 placeholder로 유지한다. thumbnail도 보이는 범위부터 lazy render한다.

### edit lease

- lease TTL은 120초다.
- active editor는 30초마다 heartbeat를 보낸다. 성공 response가 lease를 다시 120초로 연장한다.
- browser hidden 상태에서도 active editor heartbeat는 유지한다. offline이면 저장 성공을 표시하지 않는다.
- server 시각이 `expiresAt` 이상일 때만 takeover를 허용한다. takeover는 원자적으로 기존 session을 `expired` 처리하고 새 session을 만든다.
- 명시적 닫기·로그아웃은 lease를 즉시 반환한다. 평문 lease token은 저장하지 않는다.

### 생성 mode·첨부

- MVP는 승인된 outline에서 AI 초안을 생성하는 한 가지 mode만 제공한다. 빈 텍스트 영역 생성 mode는 제외한다.
- 표 import는 UTF-8 CSV 최대 10 MiB 또는 `.xlsx` 최대 25 MiB다.
- 차트·그림 import는 PNG·JPEG 최대 15 MiB, 최대 20 megapixel이다.
- PDF import와 image OCR은 MVP에서 제외한다. image는 새 숫자의 Evidence가 아니라 사용자가 확인한 시각 자료로만 연결한다.
- 모든 import는 TD-019 quarantine·ClamAV 검사를 통과해야 한다.

### 보존

| 대상 | 보존 |
|---|---|
| report version·승인 PDF·XLSX | project 수명 + 삭제 요청 뒤 30일 recovery window |
| preview PDF·thumbnail·visual diff | 생성 후 30일 |
| AI proposal raw diff | 생성 후 30일 |
| 실패 export·실패 import artifact | 7일 |
| 불완전 upload | 24시간 |

legal hold와 보안 사고 hold가 있으면 자동 삭제보다 우선한다.

### 확인 가능한 warning

사용자가 확인만으로 통과할 수 있는 code는 다음 네 개다.

- `FONT_SUBSTITUTED_WITHIN_METRIC_TOLERANCE`
- `LOW_RESOLUTION_SOURCE_IMAGE`
- `OPTIONAL_SOURCE_LINK_UNAVAILABLE`
- `MINOR_DYNAMIC_PIXEL_DIFF`

고정·보호 영역 변경, overflow, 숫자·Evidence·rating·가정 불일치, stale input과 font metric 허용치 초과는 확인으로 우회할 수 없는 blocking issue다.

### 파일명

최종 파일명은 다음 형식이다.

```text
{기업명}_{종목코드}_{YYYY}Q{분기}_실적Review_v{reportVersion}_{YYYYMMDD}.{pdf|xlsx}
```

금지 문자는 `_`로 바꾸고 연속 `_`는 하나로 합친다. 확장자를 포함해 120자 이내로 자르고 같은 이름이 충돌하면 report version ID의 앞 8자를 붙인다. 조직별 임의 파일명 template은 MVP에서 제공하지 않는다.

---

## TD-023. Agent 실행 profile

### 상태

`확정`

### package·API

| 역할 | package·API | version·값 |
|---|---|---|
| Agent framework | `pydantic-ai` | `2.17.0` |
| OpenAI Python SDK | `openai` | `2.48.0` |
| OpenAI API | Responses API | `v1` |
| 기본 model | OpenAI GPT | `gpt-5.4-mini` |

고속·고용량 workload용으로 설계된 `gpt-5.4-mini`를 기본값으로 사용한다. model alias를 임의의 `latest` 문자열로 바꾸지 않는다. 각 실행은 `agent_profile_version`, prompt version, output schema version, provider가 반환한 model ID와 token usage를 저장한다.

### 초기 profile

| Agent | reasoning | input token 상한 | output token 상한 | timeout | 실행당 비용 상한 |
|---|---|---:|---:|---:|---:|
| Hypothesis | `medium` | 50,000 | 8,000 | 120초 | USD 1 |
| Research·Validation 보조 추론 | `medium` | 120,000 | 16,000 | 300초 | USD 4 |
| Report Outline·Draft | `medium` | 200,000 | 32,000 | 300초 | USD 8 |
| Report text proposal | `low` | 40,000 | 8,000 | 120초 | USD 1 |

비용 상한은 server가 요청 전 예상치와 실행 중 usage를 함께 검사한다. 상한 초과 결과를 부분 성공으로 게시하지 않는다. 사용자당 Agent mutation은 시간당 20회, report text proposal은 10분당 10회, 프로젝트당 active Agent job은 2개로 제한한다.

### raw prompt·응답 보존

- 원시 prompt·응답은 암호화 artifact로 30일 보존한다.
- project owner와 명시적으로 권한을 받은 운영자만 감사 사유를 남기고 열람할 수 있다.
- application log에는 원문, Evidence quote, 사용자 업로드 내용과 provider response body를 남기지 않는다.
- model·prompt·schema·usage·오류 code·hash만 포함한 redacted trace는 180일 보존한다.
- 30일이 지나면 raw artifact를 삭제해도 승인 output, Pydantic structured result, provenance와 hash는 유지한다.
- OpenAI API 전송 전 secret, session token, 불필요한 개인정보와 다른 프로젝트 자료를 제거한다.

### 변경 gate

model, reasoning, prompt 또는 schema 변경은 새 `agent_profile_version`과 고정 fixture 평가를 만든다. 구조 validation, prompt injection, 숫자 보존, 지지·반박 균형, 비용·timeout 회귀를 통과한 profile만 활성화한다.

### 참고

- OpenAI model guidance: <https://developers.openai.com/api/docs/guides/latest-model>
- GPT-5.4 mini: <https://developers.openai.com/api/docs/models/gpt-5.4-mini>
- ClosedXML: <https://github.com/ClosedXML/ClosedXML>
- GNU AGPL v3.0: <https://www.gnu.org/licenses/agpl-3.0.html>
- Tiptap React: <https://tiptap.dev/docs/editor/getting-started/install/react>
- PDF.js: <https://mozilla.github.io/pdf.js/>
- ClamAV LTS: <https://docs.clamav.net/faq/faq-eol.html>

---

## 3. 변경 이력

| 날짜 | 변경 내용 |
|---|---|
| 2026-07-22 | 문서 생성. TD-001 객체 보존형 하이브리드 PDF 패치 전략 일단 확정 |
| 2026-07-22 | TD-002 확정. 원본 폰트가 없어도 대체 폰트로 전체 초안을 생성하고 경고하며, 폰트 업로드는 선택 절차로 제공 |
| 2026-07-22 | TD-002 보완. 내장 폰트, 관리형 저장소, 고객 등록 폰트, 대체 폰트 순서와 임의 웹 다운로드 금지 정책 명시 |
| 2026-07-22 | TD-003 확정. 노란색 배경과 파란색 글씨 조합을 Excel 사용자 직접 입력 셀로 판정 |
| 2026-07-22 | TD-004 당시 결정(후속 개정으로 폐기). Aspose.Cells for .NET 독립 계산 서비스를 Excel 주 재계산 엔진으로 채택하고 표본 검증 결과 기록 |
| 2026-07-22 | TD-005 확정. 의미 슬롯 기반 Scalar·Keyed Table·Chart-series PDF↔Excel 매핑, 구조 해시, MappingSet과 `_REFLO_BRIDGE` 정책 명시 |
| 2026-07-22 | TD-006 확정. Page·Block·Slot·Physical Object 계층, 원본 PDF 좌표·source locator·patch strategy·validation mask를 포함하는 버전형 Template IR 채택 |
| 2026-07-23 | TD-007 일단 확정. 리노공업 PDF·Excel 표본 구조 분석을 바탕으로 PyMuPDF/MuPDF 분석 엔진과 pikepdf/qpdf 정밀 수정·최종 저장 엔진 조합 채택 |
| 2026-07-23 | TD-008 일단 확정. PDFium 288 DPI·불투명 sRGB 렌더링과 OpenCV validation mask별 RGB 절대차·연결요소·좌표 edge 검사를 채택하고 SSIM은 진단용으로 제한 |
| 2026-07-23 | TD-010 당시 결정(후속 개정으로 폐기). SpreadJS React를 웹 Excel 표시·입력 UI로 채택하고 Aspose.Cells를 유일한 서버 권위 계산·검증·최종 XLSX 저장 엔진으로 유지 |
| 2026-07-23 | TD-011 일단 확정. S3 호환 불변 객체 저장소, PostgreSQL 파일 메타데이터, Temporal workflow와 사전 가동 격리 워커를 채택하고 queue·timeout·retry·취소 정책 명시 |
| 2026-07-23 | TD-012 일단 확정. 원문·대형 파생물은 객체 저장소, Evidence·locator·validation·provenance는 PostgreSQL에 append-only로 보존하는 구조 채택 |
| 2026-07-23 | TD-013 일단 확정. FnGuide JSON 공급자 격리, 명시적 연결·별도 기준, 불변 원본·정규화 snapshot, look-ahead 방지와 보고서 snapshot 고정 규칙을 채택하고 리노공업 live smoke test 통과 |
| 2026-07-24 | TD-014 확정. Google 로그인과 PostgreSQL 불투명 server session, cookie·소유권·CSRF 기준 채택 |
| 2026-07-24 | TD-015 확정. `Asia/Seoul` date-only 기준일과 KST 일말 `cutoffAt` 파생 규칙 채택 |
| 2026-07-24 | TD-016 확정. 3초 visibility-aware polling과 terminal stop·error backoff를 MVP 상태 전달 방식으로 채택 |
| 2026-07-24 | TD-017 일단 확정. PydanticAI와 OpenAI GPT provider 조합을 채택하고 정확한 model·비용 한도는 평가 후 고정 |
| 2026-07-25 | TD-018 확정. `openid-client@6.8.4`, `pg@8.22.0`, `node-pg-migrate@9.0.0`, `@types/pg@8.20.0`을 채택하고 package lock에 고정 |
| 2026-07-25 | TD-019~TD-023 당시 확정. 파일 운영 한도·검사, Validation 충분성, Valuation 수치·SpreadJS, Report editor·viewer·lease, Agent 실행 profile의 구현 기본값을 고정했으며 TD-021의 UI 기술은 후속 개정으로 교체 |
| 2026-07-25 | AGPL-3.0 공개 방침 확정. PyMuPDF/MuPDF를 AGPL 조건으로 유지하고 상용 라이선스 구매 gate 제거 |
| 2026-07-25 | TD-004·TD-010·TD-021 개정. Aspose.Cells·SpreadJS를 ClosedXML 0.105.0·React workbook grid로 교체하고 ISC fixture 및 Excel 16.0 교차검증 결과 기록 |
