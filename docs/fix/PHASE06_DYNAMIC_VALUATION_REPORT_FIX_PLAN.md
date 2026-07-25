# Phase 06 동적 밸류에이션·보고서 반영 수정 계획

- 문서 상태: 구현 진행 중
- 기준일: 2026-07-25
- 적용 범위:
  - `/projects/:projectId/process/valuation`
  - `/projects/:projectId/process/report-outline`
  - `/projects/:projectId/report`
  - Excel worker 및 PDF worker
- 핵심 원칙: 특정 ISC 샘플 파일의 시트명·셀 주소·PDF 좌표를 하드코딩하지 않는다.

## 1. 목적

사용자가 업로드한 PDF와 XLSX는 파일마다 페이지 수, 시트 구조, 셀 주소,
수식, 표와 차트 위치가 다를 수 있다. REFLO는 특정 샘플 파일의 구조가 아니라
업로드 파일에서 분석한 다음 세 가지 버전 자원을 기준으로 동작해야 한다.

1. PDF에서 추출한 `Template IR`
2. XLSX에서 추출한 `Workbook Read Model`
3. 두 파일의 의미를 연결하는 `MappingSet`

Phase 06은 단순 Excel 뷰어가 아니다. 허용된 Excel 입력을 서버에서 재계산하고,
보고서에 사용할 Forward EPS, Target PER, 목표주가를 사용자가 승인하는
권위값 확정 단계다.

## 2. 목표 동작

```text
사용자 PDF 업로드
  → PDF 구조 분석
  → 파일별 Template IR 생성

사용자 XLSX 업로드
  → workbook 구조·수식·서식 분석
  → 파일별 Workbook Read Model 생성

Template IR + Workbook Read Model
  → semantic metric 후보 탐색
  → 사용자 확인
  → MappingSet 승인

검증 완료
  → Phase 06 Excel 입력
  → ClosedXML 권위 재계산
  → Forward EPS·Target PER·목표주가 확정
  → valuation approval

valuation approval
  → Phase 07 페이지 구성
  → 실제 Excel 표·차트·검증 Evidence 연결
  → 보고서 초안 생성
  → 원본 PDF의 변경 가능 영역에 반영
  → PDF 시각·수치 검증
  → 동일 승인 버전 기반 PDF·XLSX 출력
```

## 3. 현재 구현 상태

| 영역 | 현재 상태 | 판정 |
|---|---|---|
| 업로드 XLSX 기반 화면 | 파일명, 시트, 셀, 수식, 기본 서식을 read model에서 생성 | 구현됨 |
| XLSX 작업 사본 | 원본을 보존하고 변경마다 새 working copy와 version 생성 | 구현됨 |
| 사용자 입력 권한 | 연노랑 배경과 파란 글씨 셀을 허용 목록으로 사용 | 구현됨 |
| 서버 계산 | ClosedXML 0.105.0으로 수식 재계산 | 구현됨 |
| 주요 출력 | MappingSet으로 Forward EPS, Target PER, 목표주가 추출 | 구현됨 |
| Target PER 결정 | PER 직접 입력과 목표주가 역산 mode 지원 | 구현됨 |
| valuation 승인 | workbook, calculation, draft, 현재주가 snapshot 고정 | 구현됨 |
| Phase 07 진입 제어 | 최신 valuation approval이 있어야 활성화 | 구현됨 |
| report outline | Template IR 페이지 구조와 valuation approval을 참조해 생성 | 부분 구현 |
| 보고서 표·차트 | 실제 workbook 범위 대신 placeholder block 사용 | 미완성 |
| PDF 미리보기 | 새 초안이 아니라 업로드 원본 PDF artifact 반환 | 미완성 |
| PDF 생성 worker | `/inspect`만 제공하고 patch/render API가 없음 | 미완성 |
| 최종 export | 새 산출물을 생성하지 않고 원본 PDF와 workbook artifact를 연결 | 미완성 |

현재 관련 구현:

- `workers/excel/Program.cs`
- `source-react/app/_phase5/ValuationWorkbook.tsx`
- `source-react/app/_phase5/ValuationScreen.tsx`
- `source-react/server/infrastructure/repositories/valuation-repository.ts`
- `source-react/server/domain/report.ts`
- `source-react/server/infrastructure/repositories/report-repository.ts`
- `workers/pdf/app.py`

## 4. 변경 불가 설계 원칙

### 4.1 위치가 아니라 의미를 고정한다

다음 위치는 파일마다 달라질 수 있다.

- Excel 시트명과 셀 주소
- 표와 차트 범위
- PDF 페이지 번호와 bbox
- 보고서 블록 순서

다음 semantic metric은 서비스 계약으로 고정한다.

- `forward_eps`
- `target_per`
- `target_price`
- `current_price`
- `revenue`
- `operating_profit`
- `net_income`
- `quarterly_performance_table`
- `financial_statements_table`
- `peer_valuation_table`
- `target_price_history_table`
- `investment_opinion`

실제 파일 위치는 MappingSet version이 연결한다.

### 4.2 자동 추측보다 차단을 우선한다

- 후보가 정확히 하나면 자동 제안할 수 있다.
- 후보가 여러 개면 사용자 확인이 필요하다.
- 필수 metric을 찾지 못하면 Phase 06을 차단한다.
- 업로드 파일 구조가 바뀌면 기존 MappingSet을 재검증한다.
- AI 제안값은 자동 확정하지 않는다.

### 4.3 계산 권위는 서버에만 둔다

- 브라우저 수식과 JavaScript `Number`를 권위값으로 사용하지 않는다.
- 모든 Excel 변경은 ClosedXML 작업 사본에 적용한다.
- 최종 XLSX는 브라우저에서 만들지 않는다.
- PDF에 들어가는 숫자는 최신 valuation approval을 참조한다.

### 4.4 과거 승인 버전은 변경하지 않는다

- 상위 입력이 바뀌면 새 version과 새 approval을 만든다.
- 과거 승인 PDF와 XLSX는 재현 가능해야 한다.
- 최신 파일 변경으로 과거 artifact를 덮어쓰지 않는다.

## 5. Phase 06 Excel 수정 사항

### 5.1 시트 동적 표시 완성

현재 시트 목록은 workbook에서 동적으로 생성되지만 다음 항목을 보완해야 한다.

- worksheet visibility를 read model에 추가한다.
- `hidden`, `veryHidden` 시트는 기본 탭에서 제외한다.
- 관리자가 필요할 때만 숨김 시트를 진단 화면에서 확인한다.
- freeze pane을 원본과 동일하게 적용한다.
- 숨겨진 행·열, 병합 셀, 행 높이, 열 너비를 계속 보존한다.
- workbook에 포함된 차트의 지원 범위와 fallback을 정의한다.
- 시트가 많거나 used range가 큰 파일에는 viewport virtualization을 적용한다.

### 5.2 입력 셀 판별 계약 개선

현재 연노랑 `FFF2CC`와 파란 글씨 `0000FF`를 입력 셀 규칙으로 사용한다.
이 규칙은 호환 가능한 업로드 Excel의 기본 탐지 규칙으로 유지하되 다음을 추가한다.

- workbook 검사 단계에서 탐지된 입력 셀을 사용자에게 미리 보여준다.
- 스타일이 다르지만 의미상 입력 셀인 파일은 수동 allowlist를 지원한다.
- formula cell, merged non-anchor cell, system cell은 allowlist에 들어갈 수 없다.
- editable set 변경은 별도 version으로 관리한다.
- client 표시와 server 권한 검사는 동일한 editable set version을 사용한다.

### 5.3 입력 셀 영향 범위 분류

모든 입력 셀을 동일한 용도로 표시하지 않는다. 파일별 수식 의존성과 MappingSet을
분석해 다음 impact type을 부여한다.

| impact type | 의미 |
|---|---|
| `forward_eps_driver` | Forward EPS 또는 그 선행 수식에 영향을 줌 |
| `target_per_driver` | Target PER 선택·피어 계산에 영향을 줌 |
| `target_price_driver` | 목표주가 계산에 직접 영향을 줌 |
| `report_table_driver` | 보고서 표·차트에는 사용되지만 valuation 출력에는 영향 없음 |
| `source_metadata` | 출처, 메모, 기준일 등 설명 데이터 |
| `inactive_branch` | 현재 선택한 계산 mode에서는 사용되지 않는 입력 |
| `unmapped` | MappingSet과 계산 그래프에서 사용되지 않음 |

분류 방법:

1. MappingSet output cell에서 수식 precedent graph를 역추적한다.
2. report slot에 연결된 range와 cell을 역추적한다.
3. IF, CHOOSE 등 조건 분기는 현재 mode와 전체 가능한 분기를 함께 기록한다.
4. 동일 셀이 여러 출력에 영향을 주면 impact type을 복수로 가진다.
5. 순환 참조, 외부 링크, 지원하지 않는 함수가 있으면 자동 분류를 중단한다.

### 5.4 영향 범위 UX

- 시트 탭에 입력 셀 수와 영향 유형을 표시한다.
- 셀 선택 정보에 `EPS 영향`, `PER 영향`, `보고서 전용` 등을 표시한다.
- `전체`, `EPS`, `PER`, `보고서`, `미사용` 필터를 제공한다.
- inactive 또는 unmapped 입력은 경고하되 임의로 삭제하지 않는다.
- 변경 전 사용자가 “이 값이 무엇을 바꾸는지” 확인할 수 있어야 한다.

### 5.5 재계산 결과 차이 표시

cell PATCH 성공 응답의 `affectedCells`와 주요 output을 UI에서 사용한다.

- 변경 전·후 Forward EPS
- 변경 전·후 Target PER
- 변경 전·후 목표주가
- 변경된 formula cell 수
- 영향받은 보고서 표·차트
- 재승인이 필요한 이유

값이 바뀌지 않은 경우에도 workbook version이 변경됐다는 사실을 구분해서
안내한다.

### 5.6 승인과 무효화 정책 명확화

현재 valuation approval은 전체 workbook artifact를 고정한다. 따라서 어떤
허용 셀이든 변경하면 최신 approval과 downstream 결과를 재검증해야 한다.

UI 상태는 최소 다음을 구분한다.

- `계산 중`
- `계산 완료·결정 필요`
- `결정 반영 완료·승인 필요`
- `승인 완료`
- `workbook 변경으로 재승인 필요`
- `MappingSet 변경으로 재검증 필요`

정상 흐름:

```text
Excel 변경
  → 새 workbook version
  → 기존 valuation approval superseded
  → 기존 report outline revalidation_required
  → Target PER 또는 목표주가 재반영
  → valuation 재승인
  → Phase 07 재활성화
```

## 6. MappingSet 수정 사항

### 6.1 필수 output binding

Phase 06 진입 전 다음 binding이 모두 확정돼야 한다.

- Forward EPS output cell
- Target PER output cell
- 목표주가 output cell
- Target PER 입력 cell 또는 결정 mode 입력 구조

### 6.2 보고서 slot binding

다음 항목은 실제 Template IR slot과 workbook range를 연결한다.

- scalar
- keyed table
- chart data range
- investment opinion
- Evidence-backed narrative

각 binding은 다음 정보를 가져야 한다.

- semantic metric
- source workbook resource version
- sheet stable ID
- cell 또는 range
- number format과 unit
- period axis
- output target page와 slot
- confidence
- 사용자 확인 상태
- provenance node

### 6.3 구조 변경 감지

새 XLSX가 업로드되거나 workbook 구조가 변경되면 다음을 비교한다.

- sheet stable ID와 이름
- used range
- formula signature
- merged range
- output binding cell
- report slot source range

필수 binding이 이동하거나 사라지면 자동으로 새 위치를 선택하지 않고
MappingSet 재확인을 요구한다.

## 7. Phase 07 페이지 내용 설정 수정 사항

Phase 07 화면 자체는 존재한다. 현재 `선행 단계 필요` 표시는 미구현 표시가 아니라
최신 valuation approval이 없을 때의 접근 차단 상태다.

추가 구현:

- valuation approval의 정확한 version을 화면 상단에 표시한다.
- 각 PDF 페이지의 실제 Template IR block과 slot을 표시한다.
- 표·차트 slot에 실제 workbook range와 preview를 연결한다.
- 숫자 slot은 자유 텍스트 복사가 아니라 valuation approval 또는 workbook cell
  reference를 저장한다.
- narrative block은 연결된 Evidence를 표시한다.
- page review 후 upstream binding이 변경되면 해당 page review만 무효화한다.
- 모든 필수 slot, Evidence, MappingSet, page review가 유효해야 outline을 승인한다.

## 8. 보고서 초안 생성 수정 사항

### 8.1 구조화된 초안

보고서 초안은 다음 immutable input version을 고정한다.

- Template IR version
- MappingSet version
- validation approval
- valuation approval
- workbook artifact/version
- report outline approval
- Evidence set

### 8.2 숫자 권위

숫자 블록은 `numericAuthority`에 따라 원천을 고정한다.

- `valuation_approval`
- `workbook_cell`
- `mapping_set_range`
- `market_price_snapshot`

사용자가 편집 가능한 narrative 안에 숫자가 들어가면 저장과 승인 시 권위값과
일치하는지 검사한다.

### 8.3 실제 표·차트 materialization

현재 `Excel 연결 완료` placeholder를 제거하고 다음 데이터를 생성한다.

- 표 header와 row key
- raw decimal
- formatted value
- unit
- period
- source range
- chart series
- legend와 axis

PDF 삽입용 데이터와 화면 편집용 데이터는 동일한 binding snapshot에서 생성한다.

## 9. PDF worker 구현 사항

현재 worker는 `/inspect`만 제공한다. 다음 API 또는 동등한 비동기 job 계약이
필요하다.

### 9.1 Render plan 생성

입력:

- source PDF artifact
- Template IR version
- approved report document
- resolved slot bindings
- font profile

출력:

- 페이지별 patch operation
- 대상 bbox
- patch strategy
- 예상 overflow
- 사용 font
- source provenance

### 9.2 PDF patch

지원 전략:

- `in_place_glyph_replace`
- `operator_replace`
- `form_xobject_replace`
- `block_vector_replace`
- 제한된 `region_background_patch` fallback

고정 영역은 수정하지 않고 Template IR의 dynamic slot만 변경한다.

### 9.3 Preview render

- 새 PDF artifact를 생성한다.
- preview는 새 artifact의 same-origin URL을 반환한다.
- 업로드 원본 PDF artifact를 초안 preview로 반환하지 않는다.
- report version이 바뀌면 이전 preview를 재사용하지 않는다.

### 9.4 PDF 검증

- PDF 구조 parse
- 숫자·단위·기간 검증
- font glyph와 대체 font 검사
- overflow, clipping, z-order 검사
- 고정 영역 visual diff
- 변경 영역 mask 기반 visual diff
- link, annotation, tagged PDF 보존 검사

blocking issue가 하나라도 있으면 report approval과 export를 차단한다.

## 10. 최종 export 수정 사항

현재 export는 source PDF와 workbook artifact를 `ready`로 연결한다. 이를 실제
산출물 생성 흐름으로 교체한다.

### 10.1 PDF

- 승인된 report version으로 새 PDF artifact 생성
- `storage_status='final'`
- render profile과 worker version 기록
- SHA-256과 byte size 기록

### 10.2 XLSX

- valuation approval에 고정된 workbook artifact 사용
- 필요하면 final artifact로 immutable copy
- 브라우저에서 XLSX를 생성하지 않음
- 승인되지 않은 최신 working copy를 export하지 않음

### 10.3 교차 일관성

PDF와 XLSX는 동일한 다음 version을 참조해야 한다.

- valuation approval
- workbook version
- report outline approval
- report approval
- MappingSet
- Evidence set

부분 실패 시 성공 artifact는 유지하고 실패 format만 재시도한다.

## 11. API와 read model 변경

### 11.1 Workbook Read Model

추가 필드 예시:

```json
{
  "sheets": [
    {
      "sheetId": "sheet_13",
      "name": "09_Target_PER",
      "visibility": "visible",
      "freezeRows": 5,
      "freezeColumns": 1
    }
  ],
  "editableCells": [
    {
      "sheetId": "sheet_13",
      "address": "B13",
      "impactTypes": ["target_per_driver", "target_price_driver"],
      "activeInCurrentMode": true,
      "downstreamOutputs": ["target_per", "target_price"]
    }
  ]
}
```

### 11.2 Cell PATCH 응답

추가 또는 명확화할 필드:

```json
{
  "workbookVersion": 5,
  "calculationRunId": "019f...",
  "appliedChanges": [],
  "affectedCells": [],
  "outputDiff": {
    "forwardEps": { "before": "5618.47", "after": "5682.10" },
    "targetPer": { "before": "14.2", "after": "14.2" },
    "targetPrice": { "before": "80000", "after": "81000" }
  },
  "affectedReportBindings": [],
  "invalidatedResults": [
    "valuation_approval",
    "report_outline",
    "report_validation"
  ]
}
```

### 11.3 Report Preview 응답

`artifactId`는 source PDF가 아니라 새 preview PDF artifact여야 한다.

### 11.4 Report Export 응답

각 artifact는 실제 생성된 final artifact ID, SHA, byte size, worker version,
approval version을 반환해야 한다.

## 12. 저장 모델 보완

필요 시 다음 저장 구조를 추가하거나 기존 JSON schema를 확장한다.

- formula dependency graph snapshot
- editable cell impact classification
- workbook range binding snapshot
- report render plan
- preview artifact
- final export artifact
- render validation result
- PDF visual diff result

각 row는 입력 version fingerprint를 가져야 하며 upstream version이 다르면
재사용하지 않는다.

## 13. 구현 우선순위

### P0 — 계산과 산출물 정확성

1. 파일별 formula dependency graph와 input impact classification
2. MappingSet의 scalar·table·chart binding 완성
3. report placeholder를 실제 workbook binding으로 교체
4. PDF worker patch/render API
5. 실제 preview PDF artifact 생성
6. PDF 수치·레이아웃 검증
7. 실제 final PDF·XLSX export

### P1 — 사용자 이해와 workbook 충실도

1. worksheet visibility
2. freeze pane
3. impact type 표시와 필터
4. 변경 전·후 output diff
5. 재승인 사유와 downstream 무효화 표시
6. 대형 workbook virtualization
7. 지원 가능한 chart 표시

### P2 — 운영 안정성

1. worker retry와 timeout
2. partial export retry
3. 과거 승인 산출물 재현
4. artifact retention
5. 성능 지표와 audit log

## 14. 테스트 계획

### 14.1 Excel fixture matrix

최소 다음 구조의 독립 fixture를 사용한다.

- 시트명과 순서가 다른 workbook
- output cell 주소가 다른 workbook
- 입력 셀 스타일이 다른 workbook
- hidden/veryHidden sheet가 있는 workbook
- freeze pane과 merged cell이 있는 workbook
- 대형 used range workbook
- 지원하지 않는 함수가 있는 workbook
- 외부 링크 또는 순환 참조 workbook

### 14.2 PDF fixture matrix

- 페이지 수가 다른 PDF
- 표와 차트 위치가 다른 PDF
- Form XObject를 사용하는 PDF
- shared XObject가 있는 PDF
- font embedding 방식이 다른 PDF
- 회전 페이지가 있는 PDF
- tagged PDF와 annotation이 있는 PDF

### 14.3 필수 시나리오

1. EPS driver 변경 시 Forward EPS와 목표주가가 변경된다.
2. PER driver 변경 시 Target PER과 목표주가가 변경된다.
3. report-only cell 변경 시 EPS가 유지되고 보고서 binding만 변경된다.
4. inactive branch 입력은 현재 output을 바꾸지 않는다.
5. 모든 workbook 변경은 기존 전체-workbook approval을 무효화한다.
6. 재승인 후 Phase 07이 다시 활성화된다.
7. report outline은 새 valuation approval을 고정한다.
8. PDF preview에 승인된 숫자·표·차트가 보인다.
9. PDF 숫자와 XLSX 숫자가 동일하다.
10. 과거 승인 PDF와 XLSX를 다시 다운로드할 수 있다.

## 15. 완료 기준

다음 조건을 모두 만족해야 전체 작업을 완료로 본다.

- 서로 다른 PDF/XLSX fixture에서 하드코딩 없이 동작한다.
- 화면의 시트와 셀은 현재 업로드 workbook에서 생성된다.
- 입력 셀마다 계산·보고서 영향 범위를 확인할 수 있다.
- ClosedXML 결과와 화면 표시값이 일치한다.
- 필수 metric mapping이 없으면 Phase 06이 명확히 차단된다.
- 최신 valuation approval 없이는 Phase 07이 열리지 않는다.
- Phase 07의 표·차트가 실제 workbook range를 참조한다.
- PDF preview가 원본이 아니라 새 report draft artifact다.
- 최종 PDF와 XLSX가 동일한 승인 version을 참조한다.
- PDF의 숫자·표·차트가 승인된 workbook과 일치한다.
- 고정 PDF 영역의 시각적 차이가 허용 기준을 통과한다.
- upstream 변경 시 downstream 결과가 자동으로 stale 처리된다.
- 과거 승인 산출물은 변경되지 않고 재현 가능하다.

## 16. 범위 밖 사항

이번 수정 범위에는 다음을 포함하지 않는다.

- 브라우저에서 Excel 수식을 계산하는 기능
- 브라우저에서 최종 XLSX를 생성하는 기능
- AI 제안값 자동 승인
- 임의 PDF 전체를 자유 형식으로 재디자인하는 기능
- MappingSet 확인 없이 임의 셀과 PDF 영역을 자동 확정하는 기능

## 17. 구현 순서 권고

첫 번째 구현 묶음:

1. workbook dependency graph
2. input impact classification
3. workbook read model/API/UI 반영
4. output diff와 재승인 UX

두 번째 구현 묶음:

1. report slot binding materialization
2. PDF render plan
3. PDF patch worker
4. 실제 preview artifact

세 번째 구현 묶음:

1. PDF 구조·시각 검증
2. report approval gate
3. final PDF·XLSX export
4. 서로 다른 파일 fixture 기반 전체 E2E

이 순서를 따르면 Excel 계산의 의미를 먼저 확정하고, 그 권위값을 보고서와
PDF에 연결한 뒤 최종 산출물을 검증할 수 있다.

## 18. 구현 진행 기록

### 2026-07-25 — 첫 번째 구현 묶음

완료:

- Workbook Read Model `1.2`로 상향
- worksheet `visible`·`hidden`·`very_hidden` 상태 추가
- 기본 Phase 06 탭에서는 visible 시트만 노출
- MappingSet의 세 output에서 역추적한 formula dependency edge 생성
- 입력 셀에 복수 `impactTypes`와 `downstreamOutputs` 추가
- 외부·구조화·동적 참조와 조건 분기는 추측하지 않고 `partial` 경고 표시
- `전체`·`EPS`·`PER`·`목표주가`·`기타·미연결` 영향 필터 추가
- 선택 셀 inspector에 계산 영향 범위 추가
- Cell PATCH 응답에 output 전후 차이와 downstream 무효화 결과 추가
- 재계산 후 EPS·PER·목표주가 전후 값, 변경 수식 수, 재승인 사유 표시
- 기존 allowlist 권한을 유지하면서 새 영향 메타데이터를 병합하도록 갱신

실제 ISC fixture 검증 결과:

- 전체 입력 셀: 484개
- Forward EPS 연결: 7개
- Target PER 연결: 19개
- 목표주가 연결: 26개
- 미연결 또는 아직 보고서 binding이 없는 입력: 458개
- EPS 입력 변경 시 수식 44개 변경과 EPS 전후 값이 UI에 표시됨

남은 항목:

- 조건식의 현재 활성 branch를 판정해 `activeInCurrentMode`를 확정
- MappingSet의 table·chart·source binding을 이용한
  `report_table_driver`·`source_metadata` 분류
- hidden·veryHidden 시트 관리자 진단 화면
- 두 번째 구현 묶음인 실제 PDF slot binding·render plan·preview artifact
- 서로 다른 XLSX·PDF fixture matrix와 전체 E2E 자동화
