# REFLO 화면 구현 명세: `/projects/:projectId/process/files`

**문서 상태:** 파일 업로드·검사 화면 명세 작성 완료
**작성일:** 2026-07-24
**대상:** 현업 배포용 MVP
**상위 문서:** [`REFLO_SCREEN_IMPLEMENTATION_SPEC_v1.md`](../REFLO_SCREEN_IMPLEMENTATION_SPEC_v1.md)
**기준 문서:** [`REFLO_URL_SERVICE_BEHAVIOR_v1.md`](../REFLO_URL_SERVICE_BEHAVIOR_v1.md), [`REFLO_TECHNICAL_DECISIONS_v1.md`](../REFLO_TECHNICAL_DECISIONS_v1.md)

## 1. `/projects/:projectId/process/files` — 파일 업로드·검사

### 1.1 명세 상태

| 항목 | 값 |
|---|---|
| URL | `/projects/:projectId/process/files` |
| 접근 권한 | Google 로그인 사용자 중 해당 프로젝트 소유자 |
| 표시 단계 | `STEP 02` |
| 주요 목적 | 이전 분기 실적 Review PDF와 실제 분석 Excel을 업로드·분석하고 새 보고서 제작 계약을 확정 |
| 현재 route 파일 | `source-react/app/projects/[projectId]/process/files/page.tsx` |
| 현재 실질 구현 | route가 `source-react/app/page.tsx`를 다시 내보내고 `PlannedProcessPage`의 `FileUpload`를 표시 |
| 현재 주요 컴포넌트 | `PlannedProcessPage`, `FileUpload`, `UploadBox`, `PdfReportAnalysisBody`, `ReportPageCarousel` |
| 기준 요구사항 | 서비스 동작 명세 2장, 3장, 5장, 9장, 19장 |
| 관련 기술 결정 | TD-001~TD-008, TD-010~TD-012, TD-014, TD-016 |
| 구현 상태 | 시각 프로토타입만 존재, 실제 업로드·저장·파일 검사·작업 복구·Excel 분석·매핑 미구현 |

### 1.2 화면 목적과 책임

이 화면은 두 원본 파일을 단순 첨부하는 곳이 아니다. 다음 단계부터 사용할 PDF 템플릿, 문체 프로필, Excel 구조와 PDF↔Excel 연결을 생성하고 검증하는 계약 단계다.

화면의 책임은 다음과 같다.

1. 이전 분기 실적 Review PDF와 그 보고서 작성에 사용한 실제 Excel을 각각 한 개씩 받는다.
2. 업로드 byte를 사용자·프로젝트 범위에 격리해 불변 원본으로 저장한다.
3. PDF 입력 적합성, 템플릿 구조와 완전 복제 가능성을 검사한다.
4. Excel 구조, 수식, 외부 링크, 직접 입력 셀과 재계산 호환성을 검사한다.
5. 프로젝트 기업·보고서 유형·밸류에이션 방식과 두 파일의 일치 여부를 검사한다.
6. PDF의 변경 가능 구성요소와 Excel 값·범위 사이의 필수 매핑을 생성·검증한다.
7. 사용자가 결과와 차단 사유를 확인하고 필요한 파일 교체 또는 매핑 보정을 수행하게 한다.
8. 모든 차단 검사를 통과한 파일 버전과 분석 버전을 확정한 뒤 투자 의견·조사 질문 단계로 이동한다.

이 화면에서는 조사 참고자료를 받지 않는다. DART, IR, 뉴스, 사용자 참고 파일과 URL은 자료 수집 및 계획 화면에서 연결한다. 미래 추정치를 입력하거나 Excel을 편집하지도 않는다.

### 1.3 판단 우선순위

현재 UI의 다음 문구와 동작은 기준 요구사항보다 우선하지 않는다.

- `표준 모델 Excel`, `서비스용 표준 모델 Excel`이 아니라 사용자가 실제 업무에서 사용하는 분석 Excel을 받는다.
- 파일명에 기업명이나 종목코드가 포함됐는지로 기업을 판정하지 않는다.
- 클라이언트 타이머가 만든 진행률을 실제 검사 진행률로 사용하지 않는다.
- PDF 결과만 확인하고 통과시키지 않는다. Excel 분석과 PDF↔Excel 매핑도 통과해야 한다.
- 하드코딩된 `template_id`, `schema v2.1`, `12개 시트`, 정적 ISC 미리보기는 실제 분석 응답으로 교체한다.
- 필수 매핑이 없거나 외부 링크가 있는 Excel을 일반 템플릿으로 낮춰서 통과시키지 않는다.

현재 React는 레이아웃과 상호작용 형태의 기준으로 사용한다. 제품 판정은 서버와 격리 워커 결과를 권위값으로 사용한다.

### 1.4 진입 조건과 접근 처리

#### 정상 진입

다음 조건을 모두 만족해야 한다.

- 유효한 Google 로그인 세션이 있다.
- URL의 `projectId`가 실제 서버 발급 식별자다.
- 세션 사용자가 프로젝트 소유자다.
- 프로젝트 설정 단계가 저장 완료 상태다.
- 기업, 종목코드, 거래소, 대상 연도·분기, 기준일, 리포트 유형과 기업 분야가 유효하다.

#### 직접 URL 진입

| 상황 | 처리 |
|---|---|
| 비로그인 | Google 로그인 후 원래 files URL로 복귀 |
| 다른 사용자 프로젝트 | 존재 여부를 노출하지 않는 `404 PROJECT_NOT_FOUND` 공통 화면 |
| 존재하지 않는 `projectId` | 프로젝트 없음 화면 |
| setup 미완료 | setup URL로 이동하고 `프로젝트 설정을 먼저 완료해 주세요` 안내 |
| 이미 업로드·검사 중 | 서버 작업 상태부터 복원 |
| 검사 통과 후 재진입 | 확정된 두 파일과 결과 요약 표시 |
| 상위 설정 변경으로 결과 무효 | 기존 결과를 보존해 표시하되 `재검증 필요`로 전환 |

클라이언트가 `currentStep`이나 소유자 ID를 보내 단계 진입 권한을 만들 수 없다. 서버가 프로젝트 상태와 소유권을 판정한다.

### 1.5 이탈 조건과 단계 이동

| 이동 | 허용 조건 | 결과 |
|---|---|---|
| 프로젝트 목록으로 이동 | 항상 | 업로드 중인 브라우저 전송은 취소 확인, 서버에 제출된 검사는 계속 실행 |
| setup으로 이동 | 항상 | 저장된 파일은 유지, setup 값이 바뀌면 현재 검사 결과를 `재검증 필요`로 전환 |
| 아직 완료하지 않은 후속 단계로 이동 | 불가 | 현재 화면 유지, 차단 사유 안내 |
| hypothesis로 이동 | 검사 `passed`, 필수 매핑 `confirmed`, 결과 검토 완료 | 파일·분석 버전을 단계 입력으로 고정하고 hypothesis URL로 이동 |
| 이미 완료한 후속 단계에서 이 화면으로 복귀 | 가능 | 파일 교체 전 하위 결과 무효화 범위를 먼저 표시 |

정상 다음 URL은 다음과 같다.

```text
/projects/{projectId}/process/hypothesis
```

`결과 확인` 대화상자의 `다음`이 성공적으로 단계 완료 요청을 처리한 뒤 이동한다. 현재처럼 클라이언트 상태만 바꾸어 바로 이동하지 않는다.

### 1.6 기본 사용자 흐름

```text
files URL 진입
  → 프로젝트·권한·기존 파일 상태 조회
  → 이전 분기 PDF 선택
  → 제한된 업로드 URL로 직접 업로드
  → 서버 byte·checksum·형식·악성 여부 검사
  → 실제 분석 Excel 선택·업로드·검사
  → 두 파일이 ready이면 검사 실행
  → PDF 분석과 Excel 분석을 병렬 실행
  → PDF↔Excel 매핑과 두 파일 적합성 검사
  → 결과 요약 표시
  → 필요하면 파일 교체 또는 필수 매핑 보정
  → 전체 통과 결과 확인
  → 분석 버전 확정
  → hypothesis URL 이동
```

브라우저가 닫혀도 `검사 실행` 이후 Temporal에 제출된 작업은 계속된다. 재진입 시 PostgreSQL 작업 projection에서 현재 상태를 복원한다.

## 2. 기존 디자인 재사용·수정·제거 판정

### 2.1 전체 UI 판정

| 현재 영역 | 판정 | 구현 판단 |
|---|---|---|
| 상단 Process 헤더 | 재사용 | 프로젝트 복귀, Process 활성 상태, 작업 흐름 버튼 유지 |
| 좌측 7단계 사이드바 | 재사용·권한 보완 | 2–2–3 그룹과 `STEP 02` 활성 표현 유지, 미완료 후속 단계 이동은 서버 상태로 차단 |
| 단계 제목과 설명 | 문구 수정 | `이전 분기 PDF와 실제 분석 Excel을 업로드하고 호환성을 확인합니다`처럼 실제 입력을 설명 |
| 두 개의 업로드 카드 | 재사용 | PDF와 Excel의 병렬 2열 구조, 필수 표시, 드롭 영역 유지 |
| `① 과거 실적 Review PDF` | 문구 수정 | `① 이전 분기 실적 Review PDF` |
| `② 표준 모델 Excel` | 문구 수정 | `② 실제 분석 Excel` |
| 업로드 전 주의 카드 | 재사용·내용 보완 | 두 파일 필수와 대표 차단 조건을 간결하게 표시 |
| 업로드 완료 체크 표시 | 재사용 | 서버 검증을 통과한 `ready`에서만 성공 표시 |
| `파일 교체` | 재사용 | 새 불변 파일 버전을 업로드하고 이전 버전을 보존 |
| 결과 요약 카드 | 재사용·확장 | PDF·Excel·매핑의 서버 검사 상태와 실제 진행률 표시 |
| `검사 실행` | 재사용 | Temporal 검사 workflow를 멱등 시작 |
| 클라이언트 10% 증가 타이머 | 제거 | 서버가 보고한 stage·progress 또는 불확정 진행 상태 사용 |
| 파일명 기반 기업 판정 | 제거 | PDF·Excel 내용과 프로젝트 기업 메타데이터를 서버에서 검사 |
| 기업 불일치 경고 대화상자 | 재사용·일반화 | PDF/Excel/프로젝트 중 어느 값이 다른지와 교체 대상을 표시 |
| PDF 분석 결과 대화상자 | 재사용·확장 | 하나의 상위 제목 행을 유지하고 PDF·Excel·매핑 결과 탭을 추가 |
| 원본/감지 결과 전환 | 재사용 | 실제 업로드 원본의 보안 미리보기와 해당 분석 버전 결과를 사용 |
| 보고서 페이지 캐러셀 | 재사용 | 실제 페이지 수와 파생 미리보기로 교체, 넓은 화면 바깥 화살표·작은 화면 하단 배치 유지 |
| 정적 ISC 이미지와 영역 수 | 제거 | 현재 프로젝트 분석 artifact와 실제 영역 집계로 교체 |
| Excel 단독 분석 페이지 | 만들지 않음 | 동일 결과 대화상자의 `Excel 모델` 탭에서 확인 |
| 하단 `자동 저장됨` | 수정 | 실제 서버 저장 상태와 마지막 반영 시각 표시 |
| 하단 `임시 저장` | 이 화면에서 제거 | 업로드·파일 선택·검사 결과가 즉시 서버 저장되므로 별도 의미가 없음 |
| 일반 하단 `다음` | 표시하지 않음 | 현재 디자인처럼 결과 대화상자에서만 다음 단계 확정 |

### 2.2 시각·카피 원칙

- 기존 검정·라임 정체성, 흰 카드, hairline, 10~12px 카드 모서리와 8~10px 컨트롤 모서리를 유지한다.
- 라임은 업로드 준비 완료, 검사 통과, 결과 확정과 같은 명확한 성공·주요 다음 상태에만 사용한다.
- 업로드 실패·차단은 원인과 복구 액션을 함께 표시하며 색만으로 구분하지 않는다.
- 분석 결과 카드에서 중복 설명과 0건 상태 요약을 반복하지 않는다.
- 결과 대화상자는 흰 표면, 하나의 상위 제목 행과 테두리 없는 닫기 버튼을 사용한다.
- 결과 확정 버튼은 `#c8ff3d`와 near-black text를 사용한다.
- 다음 버튼의 chevron은 얇은 선 아이콘을 사용하고 레이블과 한 묶음으로 중앙 정렬한다.
- 페이지 캐러셀은 원본과 분석 결과에서 동일한 키보드·스와이프·페이지 점 이동을 제공한다.
- 결과 대화상자의 비교 액션은 넓은 화면에서 닫기 버튼 아래쪽 우상단에 두고, 작은 화면에서는 본문 위에 배치한다.
- 동작 상태 문구는 `AI가 분석합니다` 같은 모호한 표현보다 `PDF 텍스트 구조 분석 중`, `Excel 수식 재계산 중`처럼 현재 작업을 말한다.

## 3. 사용자 상태별 화면

| 화면 상태 | 업로드 카드 | 결과 영역 | 주요 액션 |
|---|---|---|---|
| `loading` | 최종 크기 skeleton | 기존 결과가 있으면 유지 | 없음 |
| `empty` | 두 드롭 영역 | 필수 파일 안내 | 파일 선택 |
| `partial` | 한 파일 ready, 다른 카드 empty | 남은 파일 안내 | 나머지 파일 선택 |
| `uploading` | 파일별 byte 진행률·취소 | 검사 실행 비활성 | 취소·재시도 |
| `verifying` | 서버 검증 중 | 형식·checksum 검사 상태 | 대기 |
| `ready` | 두 파일 성공 | 검사 대기 요약 | 검사 실행 |
| `queued` | 파일 교체 잠금 또는 확인 필요 | 대기 순서와 시작 대기 | 화면 이탈 가능 |
| `running` | 확정된 입력 버전 표시 | 서버 stage·진행률 | 작업 취소 정책에 따른 취소, 화면 이탈 |
| `blocked` | 원인 파일 강조 | 차단 항목과 복구 방법 | 파일 교체·매핑 보정 |
| `failed` | 원본 보존 | 재시도 가능한 시스템 실패 | 실패 단계 재시도 |
| `passed` | 확정 후보 표시 | PDF·Excel·매핑 결과 요약 | 결과 확인 |
| `revalidation_required` | 기존 파일 유지 | 변경 원인과 무효 범위 | 재검사 |
| `obsolete` | 새 버전 표시 | 이전 실행 결과는 기록용 | 최신 버전으로 검사 |

이 표의 화면 상태는 `operationStatus`, `outcome`, `validity`를 조합한 view state다. `blocked`, `passed`, `obsolete`를 비동기 lifecycle `status`로 저장하지 않는다.

성공·실패 상태가 바뀔 때 카드 전체가 사라지지 않는다. 사용자가 어떤 파일을 검사했는지 계속 확인할 수 있어야 한다.

## 4. 파일 입력 계약

### 4.1 이전 분기 실적 Review PDF

| 항목 | 계약 |
|---|---|
| 필수 여부 | 필수, 정확히 1개 활성 버전 |
| 확장자 | `.pdf` |
| 실제 형식 | 서버 magic byte와 parser로 PDF 확인 |
| 지원 문서 | 문자를 드래그해 선택할 수 있는 텍스트 레이어가 있는 비암호화 PDF |
| 사용 목적 | 페이지 템플릿, 고정 자산, 변경 영역, 문체 프로필과 출력 레이아웃 생성 |
| 차단 | 스캔 이미지 전용, 암호화, 손상, 실적 Review 아님, 기업 불일치, 분석·복제 검증 실패 |
| 보존 | 원본 byte와 SHA-256을 불변 artifact로 저장 |

전자서명 PDF, 포트폴리오 PDF, 첨부 파일과 특수 annotation의 지원 범위는 구현 전 추가 결정이 필요하다. 지원하지 않는 기능은 원본을 변환해 조용히 제거하지 않는다.

### 4.2 실제 분석 Excel

| 항목 | 계약 |
|---|---|
| 필수 여부 | 필수, 정확히 1개 활성 버전 |
| 확장자 | MVP에서 `.xlsx` |
| 실제 형식 | 서버 OOXML 구조와 Aspose.Cells로 확인 |
| 사용 목적 | 실제값·추정값·수식·표·차트·PDF 연결 원천 |
| 직접 입력 셀 | 최종 표시 배경 `#FFF2CC`와 글자 `#0000FF`를 동시에 가진 셀 |
| 차단 | 암호화·손상, 지원하지 않는 외부 링크, 필수 수식 오류, 순환참조, 미지원 기능으로 권위 계산 불가 |
| 매크로 | 실행하지 않음; MVP `.xlsx` 밖의 매크로 통합문서는 활성 입력으로 받지 않음 |
| 보존 | 원본은 불변, 분석·재계산은 프로젝트 작업 사본에서 수행 |

시트 수, schema version과 `template_id`를 고정 가정하지 않는다. 실제 분석 결과에서 시트, 숨김 시트, 수식, 스타일, 병합, 이름 정의, 표와 차트를 기록한다.

### 4.3 공통 제한

파일 크기, PDF 최대 페이지 수, Excel 최대 used-cell 수와 업로드 제한시간은 서버 설정으로 관리하고 업로드 세션 응답으로 화면에 표시한다. 기준 문서에 수치가 확정되지 않았으므로 React에 임의의 숫자를 하드코딩하지 않는다.

브라우저의 `accept`와 크기 검사는 빠른 안내일 뿐이다. 최종 허용 여부는 업로드 후 서버 검사 결과가 결정한다.

## 5. 목표 컴포넌트 구성

| 컴포넌트 | 책임 | 주요 입력 | 주요 출력·이벤트 |
|---|---|---|---|
| `FilesRoute` | 세션·소유권·setup 완료 여부 확인, 초기 projection 조회 | `projectId`, 세션 쿠키 | 초기 화면 또는 redirect/error |
| `FilesPage` | 두 파일 슬롯, 검사 상태와 대화상자 조정 | 초기 `FilesScreenData` | 업로드·검사·확정 이벤트 |
| `ProcessShell` | 공통 헤더·사이드바·하단 저장 상태 | 프로젝트와 단계 상태 | 프로젝트 이동, 이전 단계 이동 |
| `FileSlotCard` | 파일 선택·드롭·진행·교체·오류 표시 | `role`, `upload`, `artifact` | select, drop, retry, cancel, replace |
| `UploadProgress` | 실제 byte와 서버 검증 단계 표시 | 전송 progress, upload 상태 | 취소·재시도 |
| `InspectionSummary` | PDF·Excel·매핑 진행과 최종 판정 | `inspectionRun` | 검사 실행, 결과 열기, 재시도 |
| `InspectionStageList` | 현재 stage와 완료·실패 항목 표시 | stage projection | 실패 항목 포커스 |
| `InspectionResultDialog` | 결과 검토와 다음 단계 확정 | PDF·Excel·Mapping 결과 | 탭 전환, 확정, 닫기 |
| `PdfAnalysisPanel` | 원본/감지 결과와 복제 가능성 표시 | PDF analysis artifact | 원본 비교, 페이지 이동 |
| `ReportPageCarousel` | 다중 페이지 미리보기 | 보안 미리보기 목록 | 이전·다음·페이지 선택 |
| `WorkbookAnalysisPanel` | 시트·수식·입력 셀·외부 링크 결과 요약 | workbook analysis | 상세 항목 열기 |
| `MappingReviewPanel` | PDF slot↔Excel binding 상태와 차단 항목 표시 | `MappingSet` | 후보 선택, 범위 확인, 재검증 |
| `MappingCorrectionDrawer` | 모호하거나 미매핑인 필수 slot 보정 | slot, candidate ranges | mapping 저장 |
| `FileMismatchDialog` | 기업·유형·밸류에이션 불일치 설명 | mismatch detail | 닫기, 교체 대상 포커스 |
| `ServerSaveStatus` | 마지막 서버 저장·연결 상태 표시 | save projection | 재연결 안내 |

`UploadBox`는 `FileSlotCard`로 역할을 명확히 하되 현재 카드 마크업과 CSS를 가능한 한 재사용한다. 파일 처리 API와 비즈니스 판정을 표시 컴포넌트 안에 넣지 않는다.

## 6. 버튼과 입력 요소 UI 계약

### 6.1 파일·검사 액션

| ID | 요소 | HTML·접근성 | 활성 조건 | 동작 | 성공 결과 | 실패 처리 |
|---|---|---|---|---|---|---|
| FILE-IN-01 | PDF 파일 입력 | `input type="file" accept=".pdf,application/pdf"`; 레이블 `이전 분기 실적 Review PDF 선택` | 검사 확정 처리 중이 아닐 때 | 한 파일 선택 | 업로드 세션 생성 | 카드 안에 즉시 오류 |
| FILE-IN-02 | Excel 파일 입력 | `input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"` | 검사 확정 처리 중이 아닐 때 | 한 파일 선택 | 업로드 세션 생성 | 카드 안에 즉시 오류 |
| FILE-DROP-01 | PDF 드롭 영역 | 실제 button 또는 키보드 포커스 가능한 label, drag 상태를 색 외 테두리·문구로 표시 | FILE-IN-01과 같음 | drop 파일을 동일 입력 흐름으로 처리 | 업로드 시작 | 복수 파일·잘못된 형식 거절 |
| FILE-DROP-02 | Excel 드롭 영역 | FILE-DROP-01과 동일 | FILE-IN-02와 같음 | 동일 | 업로드 시작 | 동일 |
| FILE-BTN-01 | `업로드 취소` | `button type="button"` | `preparing \| uploading` | multipart/session 취소 | 카드 empty 또는 이전 ready 버전 복원 | 취소 실패 시 재조회 |
| FILE-BTN-02 | `업로드 재시도` | button | 재시도 가능한 upload 실패 | 같은 논리 요청 ID로 새 제한 URL 발급 | 이어받기 또는 미완료 part 재전송 | 만료·checksum 오류 구분 |
| FILE-BTN-03 | `파일 교체` | button, 파일 종류 포함 접근성 이름 | ready 이후 | 새 파일 선택기 열기 | 새 파일 버전 생성 | 이전 활성 버전 유지 |
| FILE-BTN-04 | `검사 실행` | button | 두 슬롯이 ready이고 같은 최신 project version일 때 | inspection workflow 멱등 시작 | `202`, queued/running 표시 | 화면 유지, 재시도 안내 |
| FILE-BTN-05 | `결과 확인` | button, `aria-haspopup="dialog"` | 최신 run이 passed 또는 사용자 조치 가능한 blocked | 결과 대화상자 열기 | 첫 차단 탭 또는 PDF 탭 포커스 | 결과 재조회 |
| FILE-BTN-06 | `검사 재시도` | button | infrastructure 실패 또는 재시도 가능한 stage | 실패 stage부터 새 attempt | running | non-retryable이면 파일 교체 안내 |
| FILE-BTN-07 | `재검증` | button | 상위 설정·파일·매핑 변경으로 stale | 최신 입력 버전으로 새 run | running | 기존 passed 결과 보존 |

파일 input을 `display:none`으로 숨긴 뒤 키보드가 접근할 수 없는 label만 남기지 않는다. native input은 visually hidden 처리하고, 포커스 가능한 선택 버튼과 연결한다.

### 6.2 결과 대화상자

| ID | 요소 | 노출 조건 | 동작 | 비고 |
|---|---|---|---|---|
| FILE-DLG-01 | `PDF 템플릿` 탭 | 결과 존재 | PDF 분석 결과 표시 | `role="tab"`과 `aria-selected` |
| FILE-DLG-02 | `Excel 모델` 탭 | 결과 존재 | workbook 분석 결과 표시 | 실제 파일명과 읽기 전용 상태 표시 |
| FILE-DLG-03 | `PDF↔Excel 매핑` 탭 | mapping 결과 존재 | confirmed·ambiguous·unmapped slot 표시 | 필수 차단 수를 탭 보조 텍스트로 표시 |
| FILE-BTN-08 | `원본 비교` / `감지 결과 보기` | PDF 탭 | 같은 페이지의 원본과 분석 overlay 전환 | 현재 캐러셀 상호작용 재사용 |
| FILE-BTN-09 | 이전·다음 페이지 | 다중 페이지 | 한 페이지 이동 | 방향키·스와이프 지원 |
| FILE-BTN-10 | 페이지 점 | 다중 페이지 | 해당 페이지 이동 | 현재 페이지에 `aria-current="page"` |
| FILE-BTN-11 | `매핑 보정` | 필수 ambiguous/unmapped 존재 | 보정 drawer 열기 | 일반 결과에서는 숨김 |
| FILE-BTN-12 | `매핑 저장 후 재검증` | 모든 필수 보정 입력 유효 | 새 MappingSet version 저장·관련 stage 재실행 | 전체 파일을 재업로드하지 않음 |
| FILE-BTN-13 | 닫기 `×` | 항상 | 대화상자 닫기 | 결과는 서버에 유지, 호출 버튼으로 포커스 복귀 |
| FILE-BTN-14 | `다음` | 최신 run passed, mapping confirmed, 검토 완료 | 단계 완료 API 호출 | 성공 후 hypothesis URL 이동 |

대화상자 밖 클릭과 Escape는 저장된 결과를 버리지 않고 닫는다. `다음` 요청 중에는 중복 제출을 막고 닫기·탭 변경을 잠시 비활성화한다. 대화상자는 포커스를 가두고 닫힌 뒤 `결과 확인`으로 돌려준다.

### 6.3 공통 내비게이션

| 요소 | 계약 |
|---|---|
| `프로젝트로 돌아가기` | 업로드 전송 중이면 취소될 수 있음을 확인, 검사 workflow는 계속됨을 안내 |
| `Process` | 현재 활성 상태, 현재 URL 유지 |
| `Report` | 보고서가 아직 없으면 비활성 또는 현재 유효 단계 안내; 빈 보고서 화면으로 이동하지 않음 |
| 좌측 setup 단계 | 이동 허용 |
| 좌측 후속 단계 | 완료된 단계까지만 이동 허용, files 미완료 시 hypothesis 이후 차단 |
| `작업 흐름` | 현재 서버 단계 상태를 읽기 전용으로 표시 |

## 7. 업로드 상태와 진행 계약

### 7.1 파일별 상태

```text
empty
  → preparing
  → uploading
  → verifying
  → ready
```

실패·중단 분기:

```text
preparing/uploading → failed_retryable | cancelled
verifying → rejected | failed_retryable
ready → superseded
```

| 상태 | 화면 표시 | 허용 액션 |
|---|---|---|
| `preparing` | 업로드 준비 중 | 취소 |
| `uploading` | 전송 byte / 전체 byte와 백분율 | 취소 |
| `verifying` | `파일 무결성 확인 중` indeterminate | 화면 이탈 |
| `ready` | 파일명, 검증 크기, 업로드 시각 | 교체 |
| `failed_retryable` | 네트워크·저장소 오류와 재시도 | 재시도·교체 |
| `rejected` | 구체적인 비지원 이유 | 교체 |
| `cancelled` | 취소됨 | 다시 선택 |
| `superseded` | 일반 화면에서는 숨기고 이력에 보존 | 없음 |

브라우저가 알 수 있는 전송 byte만 실제 백분율로 표시한다. 서버 검증과 분석의 세부 작업량을 알 수 없을 때 임의의 퍼센트를 만들지 않고 단계명과 indeterminate progress를 사용한다.

### 7.2 직접 업로드

1. 브라우저가 파일명, byte 크기, MIME 후보와 파일 역할로 upload session을 요청한다.
2. 서버가 프로젝트 소유권과 역할별 활성 세션을 확인하고 제한된 presigned URL 또는 multipart 정보를 반환한다.
3. 브라우저는 `quarantine/{ownerScopeId}/{uploadId}`에 직접 전송한다.
4. 서버는 완료 요청 후 저장소 크기·checksum을 확인한다.
5. 격리 검사 워커가 magic byte, 암호화, 악성 여부와 지원 형식을 검사한다.
6. 통과 파일만 immutable artifact와 project file version으로 등록한다.

파일명은 표시용 metadata일 뿐 object key, 기업 판정, 중복 판정과 권한에 사용하지 않는다.

### 7.3 중단·재개

- 단일 part 전송 실패는 제한 URL이 유효하면 해당 전송을 재시도한다.
- multipart는 완료된 part를 서버에서 조회해 이어받을 수 있다.
- URL 만료 시 같은 upload session의 권한을 다시 확인한 뒤 새 URL만 발급한다.
- checksum 불일치 part는 다시 전송하고, 전체 byte SHA-256 불일치는 artifact 등록을 차단한다.
- 사용자가 파일을 교체하면 미완료 upload를 취소하고 새 upload ID를 사용한다.
- 중단된 part와 orphan quarantine object는 보존 정책에 따라 background cleanup한다.

## 8. 검사 흐름과 상태

### 8.1 검사 실행 단위

한 inspection run은 다음 버전을 입력으로 고정한다.

- 프로젝트 설정 version
- PDF artifact와 file version
- Excel artifact와 file version
- PDF·Excel parser/worker version
- PDF render profile version
- Aspose.Cells version
- 기존 MappingSet이 있으면 해당 version

입력 version이 바뀌면 실행 중 결과를 최신 결과로 적용하지 않는다. 기존 run은 `obsolete`로 끝내거나 안전하게 취소하고 새 run을 시작한다.

### 8.2 검사 단계

| 순서 | stage | 실행 주체 | 핵심 결과 |
|---:|---|---|---|
| 1 | `upload_validation` | file-scan worker | 형식·암호화·악성·checksum 판정 |
| 2A | `pdf_preflight` | Python PDF worker | 텍스트 레이어, 페이지, box, 손상·암호화 판정 |
| 2B | `excel_preflight` | .NET Excel worker | workbook 로드, 외부 링크·매크로·함수·무결성 판정 |
| 3A | `pdf_template_analysis` | Python PDF worker | Template IR, page/block/slot/object와 자산 |
| 3B | `excel_structure_analysis` | .NET Excel worker | sheet, formula, style, input cell, structure hash |
| 4A | `pdf_style_profile` | text parser + Style Profile Agent | 문체 프로필 version |
| 4B | `excel_recalculation` | Aspose.Cells | 수식 재계산·오류·순환참조 결과 |
| 5 | `pdf_visual_validation` | PDFium + OpenCV worker | 고정 영역·좌표·동적 영역 품질 결과 |
| 6 | `pair_compatibility` | 결정적 backend 검사 | 기업·기간·문서 유형·PER 구조 일치 |
| 7 | `mapping_build` | mapping service | suggested MappingSet |
| 8 | `mapping_validation` | mapping service + Excel worker | 필수 slot 완성도·타입·단위·경계 검증 |
| 9 | `finalize` | Temporal workflow | passed/blocked, version과 projection 저장 |

PDF와 Excel의 독립 단계는 병렬 실행할 수 있다. 매핑은 두 분석 결과가 준비된 뒤 시작한다.

### 8.3 검사 run lifecycle·outcome·validity

비동기 lifecycle과 검사 결과, version 유효성을 하나의 `status` enum으로 섞지 않는다.

| 구분 | 값 | 의미 |
|---|---|---|
| `operationStatus` | `idle` | 실행 전 |
| `operationStatus` | `queued` | Temporal 제출 완료, worker 대기 |
| `operationStatus` | `running` | 하나 이상의 stage 실행 중 |
| `operationStatus` | `cancel_requested` | 안전한 취소 처리 중 |
| `operationStatus` | `succeeded` | workflow가 끝나 domain outcome 확정 |
| `operationStatus` | `failed` | infrastructure 또는 worker 실패로 완료하지 못함 |
| `operationStatus` | `cancelled` | 사용자 또는 시스템이 안전하게 취소 |
| `outcome` | `pending` | 아직 검사 결과 미확정 |
| `outcome` | `passed` | 모든 필수 검사 통과 |
| `outcome` | `blocked` | 입력·호환성·필수 매핑 문제로 사용자 조치 필요 |
| `validity` | `current` | 현재 입력 version에 적용 가능 |
| `validity` | `obsolete` | 상위 설정·파일·매핑 version 변경으로 적용 불가 |
| `validity` | `revalidation_required` | 새 입력으로 다시 검사해야 함 |

### 8.4 진행률 표시

- 서버 projection이 완료 stage와 현재 stage를 제공한다.
- byte나 페이지·시트처럼 분모가 확인된 stage에서만 stage 내부 진행률을 표시한다.
- 전체 퍼센트가 필요하면 versioned stage weight로 서버가 계산한 값만 사용한다.
- 마지막 heartbeat 시각이 운영 한도를 넘으면 `진행 확인 중`으로 표시하고 상태 재조회를 제공한다.
- 페이지 분석 checkpoint가 있으면 재시도 시 완료 페이지를 다시 처리하지 않는다.
- 화면을 떠나도 검사 상태는 프로젝트 목록에 표시한다.

## 9. PDF 분석·검증 계약

### 9.1 추출 결과

- 페이지 크기·순서·방향·box·여백·배경
- text run, glyph, 폰트·크기·두께·색상·자간·행간과 좌표
- 문단, 제목, 소제목, 본문, 고지와 페이지 번호 역할
- 선, 도형, 이미지, 벡터, Form XObject, clipping과 z-order
- 표 행·열·병합·테두리·정렬·숫자 형식
- 차트 종류·축·범례·데이터 라벨·색상과 series 구조
- fixed·dynamic·protected·ignore validation mask
- 고정 자산과 새 분기에 변경될 slot
- 문체 프로필

### 9.2 통과 기준

- 페이지 크기와 페이지 수를 원본 계약에 보존할 수 있다.
- 변경하지 않는 영역을 원본 객체와 자산으로 재사용할 수 있다.
- 고정 요소와 텍스트 영역의 좌표 오차가 최대 `±0.5pt`다.
- 고정 영역의 PDFium 288 DPI 렌더링 일치율이 `99.5%` 이상이다.
- protected 영역에는 허용차 적용 후 실질적 차이가 없다.
- 변경 영역이 원본 slot 경계를 넘지 않는다.
- 텍스트 선택·검색 가능한 출력 전략을 만들 수 있다.
- 기존 분기 텍스트를 가리기만 하고 검색 결과에 남기는 전략을 사용하지 않는다.

폰트 미확보만으로 분석을 실패시키지 않는다. 대체 폰트와 영향 페이지·요소를 경고로 저장하고 이후 초안 검토에서 원본 폰트 업로드를 선택적으로 안내한다.

### 9.3 PDF 결과 UI

PDF 탭에는 다음만 우선 표시한다.

- 파일명, SHA-256 축약값, 페이지 수와 분석 version
- 텍스트 선택 가능·비암호화·실적 Review·기업 일치 상태
- Template IR 생성, 복제 가능성, 폰트 경고와 전체 차단 수
- 원본과 감지 결과 페이지 캐러셀
- 감지된 표·차트·본문·고정 영역의 실제 집계
- 차단 또는 경고를 선택했을 때 영향 페이지·영역

parser 내부 객체 수를 무조건 노출하지 않는다. 사용자의 교체·보정 판단에 필요한 결과부터 보여준다.

## 10. Excel 분석·검증 계약

### 10.1 추출 결과

- 모든 보이는 시트와 숨김 시트
- 셀 값, 수식, 최종 표시 스타일, 병합과 number format
- 이름 정의, 표, 차트와 수식 dependency
- 실제값·추정값·계산 결과 영역
- 노란 배경·파란 글씨를 동시에 가진 직접 입력 셀
- 외부 workbook link, data connection, macro와 미지원 함수
- `fileHash`, `structureHash`, workbook version
- Aspose.Cells 재계산 결과와 오류

### 10.2 통과 기준

- Aspose.Cells가 원본을 손상 없이 로드하고 작업 사본을 생성할 수 있다.
- 외부 링크가 없거나 계산에 의존하지 않는다. MVP에서는 외부 링크가 필요하면 차단한다.
- 필수 수식에 오류·지원 불가 함수·해결되지 않은 순환참조가 없다.
- 시트·수식·표·차트와 필요한 스타일을 목표 범위에서 보존할 수 있다.
- 직접 입력 셀 목록을 서버가 재현 가능하게 저장한다.
- PDF slot에 필요한 권위 계산값을 읽을 수 있다.
- 프로젝트 기업·기간·PER 모델과 호환된다.

### 10.3 Excel 결과 UI

Excel 탭은 실제 workbook 편집 화면이 아니라 검사 결과 요약이다.

- 실제 파일명과 workbook version
- 보이는 시트·숨김 시트·수식·표·차트·직접 입력 셀 수
- 외부 링크, 미지원 함수, 계산 오류와 호환성 경고
- 주요 시트 이름과 역할
- PDF 연결에 사용하는 후보 범위
- Aspose.Cells engine version과 계산 성공 여부

전체 workbook을 React state로 복제하지 않는다. 기본 결과 요약에는 SpreadJS를 로드하지 않는다. 사용자가 매핑 후보의 실제 범위를 확인해야 할 때만 read-only SpreadJS viewer를 동적 로드할 수 있으며, 계산 정답과 저장 책임은 계속 Aspose.Cells에 있다.

## 11. PDF↔Excel 매핑 계약

### 11.1 매핑 원칙

- PDF 좌표와 Excel 주소를 직접 1:1 결합하지 않고 안정적인 의미 `slotId`를 사용한다.
- scalar, keyed table, chart series를 구분한다.
- 한 slot은 하나의 권위 원천만 가진다.
- 다른 후보 셀은 검증 원천으로만 저장한다.
- PDF 스타일과 좌표는 Template IR, 값과 데이터 구조는 Excel·MappingSet이 소유한다.
- 값만 바뀌고 `structureHash`가 같으면 mapping을 재사용할 수 있다.
- 구조가 바뀌면 `revalidation_required`로 전환한다.

### 11.2 사용자 보정

자동 매핑 결과가 모호하거나 필수 slot이 미매핑이면 결과 대화상자에서 다음을 제공한다.

1. PDF 페이지·블록·slot 의미와 미리보기
2. Excel 후보 시트·셀/범위, 표시값, 수식 여부와 label fingerprint
3. 권위 원천 후보 하나 선택
4. 후보가 없을 때 read-only workbook에서 범위 지정
5. 선택 후 타입·기간·단위·표 topology·차트 series 길이 재검증

사용자 선택은 원 분석 결과를 수정하지 않고 새 MappingSet version을 만든다. 필수 slot이 모두 `confirmed`가 될 때까지 다음 단계는 차단한다.

## 12. 화면 데이터와 클라이언트 상태

### 12.1 서버 데이터

| 데이터 | 주요 필드 | 용도 |
|---|---|---|
| 프로젝트 | `projectId`, `version`, `owner`, `setup`, `currentStage` | 권한·진입·단계 이동 |
| 파일 슬롯 | `role`, `activeFileVersionId`, `status` | PDF·Excel 카드 |
| upload | `uploadId`, `status`, `bytes`, `expiresAt`, `retryable` | 전송 진행 |
| artifact | `artifactId`, `fileVersionId`, `filename`, `byteSize`, `sha256`, `mediaType` | 원본 식별·표시 |
| inspection run | `inspectionId`, `inputVersions`, `operationStatus`, `outcome`, `validity`, `stage`, `progressPercent`, `heartbeatAt` | 검사 진행 |
| PDF result | `templateVersion`, `styleProfileVersion`, `pages`, `warnings`, `previewArtifacts` | PDF 결과 |
| Excel result | `workbookVersion`, `structureHash`, `sheets`, `formulaSummary`, `editableCellSummary` | Excel 결과 |
| MappingSet | `mappingSetId`, `version`, `status`, `bindings`, `unmappedRequiredSlots` | 매핑 결과 |
| capability | `canUpload`, `canInspect`, `canConfirm`, `blockers` | 버튼 권한 |

원본 byte, 전체 page image와 workbook JSON은 초기 화면 응답에 포함하지 않는다. 보안 미리보기와 상세 결과는 권한 확인 후 필요한 artifact만 지연 조회한다.

### 12.2 클라이언트 상태

| 상태 | 타입 | 설명 |
|---|---|---|
| `selectedLocalFiles` | 역할별 `File \| null` | 전송 시작 전 로컬 참조 |
| `transferProgress` | 역할별 byte progress | 브라우저 직접 업로드 진행 |
| `activeDialogTab` | `pdf \| excel \| mapping` | 결과 대화상자 탭 |
| `pdfPreviewMode` | `detected \| original` | PDF 비교 모드 |
| `selectedPreviewPage` | number | 캐러셀 현재 페이지 |
| `mappingDraft` | 변경된 binding 입력 | 저장 전 임시 보정 |
| `dialogOpen` | boolean | 결과 대화상자 |
| `focusedErrorId` | string 또는 null | 오류에서 관련 입력 이동 |

파일·검사·단계 완료의 권위 상태는 서버다. `fileCheckPassed`, 파일명 문자열, `CustomEvent("reflo:file-check")` 같은 전역 브라우저 이벤트를 권위값으로 사용하지 않는다.

## 13. API 계약

아래 경로는 화면이 의존할 애플리케이션 계약이다. 객체 저장소·Temporal·워커 세부 endpoint는 브라우저에 노출하지 않는다.

### 13.1 `GET /api/projects/{projectId}/process/files`

화면 초기 상태와 최신 projection을 조회한다.

성공 응답에는 프로젝트 setup 요약, 두 파일 슬롯, 활성 upload, 최신 inspection, 결과 요약과 capability를 포함한다.

| 상태 코드 | 오류 코드 | 화면 처리 |
|---|---|---|
| `401` | `AUTH_REQUIRED` | 로그인 후 같은 URL 복귀 |
| `404` | `PROJECT_NOT_FOUND` | 프로젝트 없음과 타인 소유를 구분하지 않는 공통 화면 |
| `409` | `FILES_PREREQUISITE_INCOMPLETE` | `requiredStage`·`resumeRoute`를 사용해 setup URL 이동 |
| `500` | `FILES_STATE_LOAD_FAILED` | 기존 화면을 유지하고 재시도 |

### 13.2 `POST /api/projects/{projectId}/files/upload-sessions`

파일 역할별 제한된 upload session을 만든다.

요청 예:

```json
{
  "role": "previous_report_pdf",
  "filename": "Lino_1Q26_Report.pdf",
  "byteSize": 1245678,
  "mediaType": "application/pdf"
}
```

Excel 역할은 `analysis_workbook`을 사용한다. 사용자 ID, object key, 검사 결과와 최종 hash는 요청으로 받지 않는다.

응답은 `uploadId`, 허용 방식, part 정보 또는 presigned URL, 만료시각과 서버 제한을 반환한다.

### 13.3 `POST /api/projects/{projectId}/files/upload-sessions/{uploadId}/complete`

직접 업로드 완료를 알린다. 저장소가 반환한 part ETag·checksum 정보를 제출할 수 있지만 서버가 저장소와 전체 byte를 다시 검증한다.

성공 시 `202 Accepted`와 `verifying` 상태를 반환한다. 격리 검사가 끝나기 전에는 artifact를 검사 입력으로 사용할 수 없다.

### 13.4 `DELETE /api/projects/{projectId}/files/upload-sessions/{uploadId}`

미완료 upload와 multipart를 취소한다. 이미 immutable artifact로 등록된 원본은 이 endpoint로 삭제하지 않는다.

### 13.5 `POST /api/projects/{projectId}/file-inspections`

최신 두 파일로 검사를 시작한다.

```http
POST /api/projects/prj_01.../file-inspections
Idempotency-Key: 50db...
If-Match: "project-version-7"
```

```json
{
  "pdfFileVersionId": "filever_pdf_03",
  "workbookFileVersionId": "filever_xlsx_02"
}
```

성공 시 `202 Accepted`와 `inspectionId`, `operationStatus=queued`, `outcome=pending`, `validity=current`를 반환한다. 같은 입력 version과 idempotency key 재전송은 같은 실행을 반환한다.

### 13.6 `GET /api/projects/{projectId}/file-inspections/{inspectionId}`

stage, 진행률, heartbeat, PDF·Excel·mapping 요약, blocker와 retry capability를 조회한다. TD-016에 따라 active inspection은 3초 visibility-aware polling으로 확인하고 hidden·terminal 상태에서는 중단한다.

### 13.7 `POST /api/projects/{projectId}/file-inspections/{inspectionId}/retry`

재시도 가능한 실패 stage를 새 attempt로 실행한다. 입력 file version이 바뀌었으면 `409 STALE_INSPECTION_INPUT`을 반환하고 새 inspection을 만들도록 한다.

### 13.8 `POST /api/projects/{projectId}/mapping-sets/{mappingSetId}/revisions`

사용자 매핑 보정을 새 version으로 저장한다.

요청은 expected MappingSet version, 변경 binding과 client request ID를 포함한다. 서버는 slot·Excel range·type·단위·구조를 다시 검사하고 관련 stage만 재실행한다.

### 13.9 `POST /api/projects/{projectId}/process/files/complete`

검사 결과를 단계 입력으로 확정한다.
`Idempotency-Key` header를 필수로 사용한다.

```json
{
  "inspectionId": "inspect_01...",
  "templateVersion": 3,
  "workbookVersion": 4,
  "mappingSetVersion": 2,
  "expectedProjectVersion": 7
}
```

서버는 최신 passed run과 입력 version을 다시 확인한다. 성공 응답은 새 프로젝트 version, `currentStage="hypothesis"`와 `nextRoute`를 반환한다.

| 상태 코드 | 오류 코드 | 화면 처리 |
|---|---|---|
| `400` | `INSPECTION_NOT_PASSED` | 결과 대화상자 유지, 차단 탭 이동 |
| `401` | `AUTH_REQUIRED` | 상태 보존 후 재로그인 |
| `404` | `PROJECT_NOT_FOUND` | 프로젝트 없음과 타인 소유를 구분하지 않는 공통 화면 |
| `409` | `STALE_PROJECT_VERSION` | 최신 상태 재조회 |
| `409` | `STALE_FILE_VERSION` | 재검증 필요 |
| `409` | `MAPPING_NOT_CONFIRMED` | 매핑 탭 이동 |
| `429` | `RATE_LIMITED` | 잠시 후 재시도 |
| `500` | `STAGE_COMPLETE_FAILED` | 대화상자 유지, 중복 생성 없이 재시도 |

## 14. 저장 모델과 권한

### 14.1 최소 저장 항목

| 모델 | 핵심 내용 |
|---|---|
| `file_upload` | upload ID, role, owner scope, quarantine key, 상태, part |
| `artifact` | 불변 artifact ID, object version, SHA-256, 크기, media type |
| `project_file_version` | project, role, artifact, version, supersedes, 활성 여부 |
| `inspection_run` | 입력 version, workflow ID, 상태, stage, tool version |
| `inspection_stage_run` | attempt, heartbeat, progress, error, output artifact |
| `pdf_template_version` | source PDF, Template IR, render profile, 결과 |
| `style_profile_version` | source PDF와 prompt/model version |
| `workbook_version` | source Excel, structure hash, 작업 사본, 계산 결과 |
| `mapping_set_version` | template·workbook version, binding, 상태 |
| `stage_completion` | 확정한 inspection·template·workbook·mapping version |

### 14.2 권한 규칙

1. 모든 API와 미리보기 URL 발급에서 검증된 세션 사용자와 프로젝트 소유자를 비교한다.
2. object key를 알고 있다는 사실은 권한이 아니다.
3. presigned URL은 한 object key, 역할, 크기, content type과 짧은 만료시간으로 제한한다.
4. 다른 사용자 사이의 전역 byte 중복 제거를 하지 않는다.
5. 파일명, 클라이언트 MIME, 클라이언트 hash, user ID와 `passed` 상태를 신뢰하지 않는다.
6. PDF·Excel parser는 API·web process에서 실행하지 않는다.
7. 원본은 워커에서 read-only로 사용하고 결과는 새 object key에 저장한다.
8. 업로드 파일과 파생 미리보기는 HTML로 실행하지 않고 안전한 content disposition과 type으로 제공한다.

## 15. 중복·교체·버전 무효화

### 15.1 중복 업로드

| 상황 | 처리 |
|---|---|
| 같은 upload 완료 요청 재전송 | idempotency로 한 번만 artifact 등록 |
| 같은 사용자가 같은 byte를 같은 역할에 재업로드 | owner scope 안에서 기존 artifact 재사용 가능, 새 project file version 또는 기존 활성 version 반환 |
| 같은 사용자가 같은 byte를 다른 프로젝트에 연결 | 권한 확인 후 artifact 재사용 가능, 프로젝트 연결은 별도 생성 |
| 다른 사용자가 같은 byte 업로드 | 전역 중복 존재 여부를 노출하지 않고 별도 owner scope로 처리 |
| 같은 역할에 다른 파일 업로드 | 새 file version 생성, 이전 version은 `superseded`로 보존 |

중복 발견 문구는 `이미 업로드한 동일 파일을 사용합니다`처럼 현재 사용자 범위에서만 표시한다.

### 15.2 파일 교체

- 새 파일이 `ready`가 되기 전까지 기존 활성 파일을 유지한다.
- 새 파일 등록 성공 후 해당 역할의 활성 version을 원자적으로 교체한다.
- 기존 inspection은 `obsolete` 또는 `revalidation_required`로 전환한다.
- PDF 교체는 Template IR, 문체 프로필, MappingSet과 모든 하위 보고서 준비 결과를 무효화한다.
- Excel 교체는 workbook 분석, MappingSet, 입력 계획, 계산값, 밸류에이션과 보고서 숫자를 무효화한다.
- 사용자에게 영향을 받는 하위 결과를 교체 확인 전에 요약한다.
- 원본과 과거 결과는 감사·재현을 위해 보존하고 일반 화면에서는 최신 version을 기본 표시한다.

## 16. 오류 처리

### 16.1 오류 분류

| 오류 코드 예 | 분류 | 사용자 처리 |
|---|---|---|
| `INVALID_FILE_TYPE` | 입력 차단 | 올바른 PDF 또는 XLSX로 교체 |
| `FILE_TOO_LARGE` | 입력 차단 | 서버가 반환한 제한과 함께 교체 안내 |
| `CHECKSUM_MISMATCH` | 재시도 가능 | 해당 part 또는 전체 전송 재시도 |
| `MALWARE_DETECTED` | 입력 차단·보안 | 파일 사용 금지, 상세 내부 정보는 제한 |
| `PDF_ENCRYPTED` | 입력 차단 | 암호를 제거한 PDF 요청 |
| `PDF_SCAN_ONLY` | 입력 차단 | 텍스트 선택 가능한 원본 PDF 요청 |
| `PDF_CORRUPT` | 입력 차단 | 정상 원본으로 교체 |
| `PDF_TEMPLATE_ANALYSIS_FAILED` | 입력 또는 지원 차단 | 실패 페이지·객체 안내, 교체 또는 지원 요청 |
| `PDF_VISUAL_VALIDATION_FAILED` | 품질 차단 | 차이 영역 표시, 임의 일반 템플릿 대체 금지 |
| `WORKBOOK_EXTERNAL_LINK` | 입력 차단 | 외부 링크를 내부 값으로 변환한 파일 요청 |
| `WORKBOOK_FORMULA_ERROR` | 입력 차단 | sheet·cell·오류 유형 표시 |
| `WORKBOOK_UNSUPPORTED_FEATURE` | 호환성 차단 | 영향 범위 표시, 파일 교체 |
| `DOCUMENT_COMPANY_MISMATCH` | pair 차단 | 프로젝트·PDF·Excel에서 감지한 기업을 나란히 표시 |
| `REPORT_TYPE_MISMATCH` | pair 차단 | 실적 Review 문서 업로드 안내 |
| `VALUATION_METHOD_MISMATCH` | pair 차단 | PER 구조가 있는 호환 Excel 요청 |
| `REQUIRED_MAPPING_UNRESOLVED` | 사용자 조치 | 매핑 보정 탭 열기 |
| `WORKER_TIMEOUT` | 재시도 가능 | checkpoint부터 재시도 |
| `SERVICE_UNAVAILABLE` | 재시도 가능 | 원본 보존, 잠시 후 재시도 |
| `STALE_FILE_VERSION` | 상태 충돌 | 최신 파일로 재검사 |

### 16.2 표시 원칙

- 카드 오류는 해당 파일 카드 안에 표시한다.
- 두 파일 관계 오류는 결과 요약과 불일치 대화상자에 표시한다.
- PDF·Excel 내부 상세 오류는 결과 대화상자의 해당 탭으로 이동시킨다.
- 오류 메시지는 `검사에 실패했습니다`로 끝내지 않고 원인, 영향, 사용자가 할 다음 행동을 말한다.
- 내부 stack, object key, worker host와 공급자 credential은 노출하지 않는다.
- 여러 오류가 있으면 차단 오류를 먼저, 경고를 다음에 표시한다.
- 네트워크 재연결 후 같은 inspection을 먼저 조회하고 새 작업을 중복 생성하지 않는다.

## 17. 재시도·취소 정책

### 17.1 자동 재시도

- 저장소 I/O, worker process 장애와 일시적 infrastructure 오류만 TD-011 정책에 따라 제한 재시도한다.
- PDF·Excel 분석 활동은 최대 2회 또는 각 결정의 초기값을 따른다.
- Excel process 장애는 최대 1회 자동 재시도한다.
- exponential backoff와 jitter를 사용한다.
- 암호화, 스캔 이미지, 외부 링크, 손상, 미지원 구조와 필수 매핑 미해결은 자동 재시도하지 않는다.

### 17.2 사용자 재시도

- 자동 재시도가 끝난 infrastructure 실패에만 `검사 재시도`를 제공한다.
- 입력 오류는 `파일 교체`, 매핑 오류는 `매핑 보정`을 제공한다.
- 재시도는 완료 artifact와 page checkpoint를 재사용한다.
- 같은 request ID와 input version에 대해 중복 결과·DB 변경을 만들지 않는다.

### 17.3 취소

- 업로드 전송은 사용자가 즉시 취소할 수 있다.
- 검사 취소가 제품에 제공된다면 아직 시작하지 않은 activity를 중단하고 실행 중 자식 process를 안전하게 종료한다.
- 취소·timeout의 partial artifact는 `temporary`이며 결과·다운로드·후속 단계에 노출하지 않는다.
- 파일 교체가 실행 중 검사를 사실상 무효화하면 최신 run만 UI 권위값으로 사용한다.

## 18. 접근성·반응형·모션

### 18.1 접근성

- 드롭 영역은 마우스 드래그 없이 키보드로 파일 선택이 가능하다.
- upload progress는 `role="progressbar"`에 실제 `aria-valuenow`, `aria-valuemin`, `aria-valuemax`를 제공한다.
- 분모가 없는 검사는 `role="status"`와 현재 stage 문구를 사용한다.
- 오류는 입력과 `aria-describedby`로 연결하고 검사 완료·실패는 polite live region으로 알린다.
- 대화상자 탭은 tablist keyboard pattern을 따른다.
- 캐러셀은 좌우 방향키, 버튼, 페이지 직접 선택을 제공한다.
- 성공·차단·선택을 색만으로 구분하지 않는다.
- 모든 액션은 최소 44px interaction target을 제공한다.

### 18.2 반응형

| 폭 | 동작 |
|---|---|
| Desktop `>1024px` | 두 업로드 카드 2열, 전체 workflow sidebar, 대화상자 우상단 비교 액션 |
| Tablet `640~1024px` | 카드 2열을 유지할 수 있으면 유지, 결과 탭 가로 스크롤 허용 |
| Mobile `<640px` | 업로드 카드 1열, full-width 액션, 캐러셀 화살표를 미리보기 아래 배치 |

미리보기 이미지는 비율을 왜곡하지 않고 컨테이너 안에서 스크롤·축소한다. 작은 화면에서 글자를 읽을 수 없게 축소하는 대신 확대와 스크롤을 제공한다.

### 18.3 모션

- hover·focus 120ms, 탭·대화상자 200ms 기준을 사용한다.
- 진행률은 실제 상태 변화만 애니메이션한다.
- bounce나 성공 confetti를 사용하지 않는다.
- `prefers-reduced-motion: reduce`에서 탭·대화상자·캐러셀 전환을 즉시 적용한다.

## 19. 기술 배치

| 기술·영역 | 배치 | 판단 |
|---|---|---|
| Next.js App Router | files route의 서버 진입·권한 경계 | 사용 |
| React Client Component | 파일 선택, 직접 업로드 진행, 대화상자·탭·캐러셀 | 사용 |
| PostgreSQL | 파일 version, 검사 projection, MappingSet, 단계 완료 | 권위 metadata 저장 |
| S3 호환 객체 저장소 | quarantine, 불변 원본, 미리보기, 분석 artifact | 필수 |
| Temporal | `FileIngestWorkflow`, PDF·Excel 분석·매핑 workflow | 필수 |
| `file-scan` worker | 형식·암호화·악성·checksum 검사 | 필수 |
| Python PDF worker | PyMuPDF/MuPDF 분석, pikepdf/qpdf 정밀 처리 준비 | 필수 |
| PDFium + OpenCV worker | 288 DPI 시각 검증 | 필수 |
| HarfBuzz + FreeType | glyph·폰트 분석과 이후 패치 준비 | PDF worker 내부 |
| .NET Excel worker | Aspose.Cells 로드·재계산·구조 검사 | 필수 |
| PydanticAI Style Profile Agent | 추출 텍스트의 문체 프로필 생성 | 제한 사용, 사실·숫자 변경 금지 |
| SpreadJS React | 기본 요약에는 미사용, 매핑 범위 확인이 필요할 때만 동적 read-only viewer | 조건부 |
| Research·Validation Agent | 이 화면의 파일 적합성 판정 | 사용하지 않음 |
| FnGuide·DART·KRX·ECOS 수집 | 파일 화면 | 호출하지 않음 |

업로드 PDF·Excel·폰트 parser를 Next.js web process에서 실행하지 않는다. 큰 byte와 page image는 API JSON이나 Temporal event history에 넣지 않고 artifact ID만 전달한다.

## 20. 현재 프로토타입과 목표 구현의 차이

| 현재 프로토타입 | 목표 구현 | 우선순위 |
|---|---|---|
| route 파일이 공통 `app/page.tsx` 재노출 | files 전용 서버 route와 단계 feature 경계 | 필수 |
| 파일명 문자열만 상태로 저장 | upload·artifact·file version 서버 모델 | 필수 |
| 파일명으로 기업 판정 | 문서 내용과 공식 프로젝트 메타데이터 검사 | 필수 |
| `표준 모델 Excel`만 허용하는 카피 | 실제 업무 Excel을 입력받는 카피와 검사 | 필수 |
| 10%씩 증가하는 가짜 진행률 | 서버 stage·heartbeat·실제 progress | 필수 |
| 브라우저 `CustomEvent`로 통과 전달 | 서버 inspection 상태와 capability | 필수 |
| PDF 검사 3항목만 표시 | PDF·Excel·pair·mapping 전체 검사 | 필수 |
| PDF 결과만 대화상자에 표시 | PDF·Excel·mapping 탭과 보정 흐름 | 필수 |
| 정적 ISC 이미지 5장 | 업로드 파일의 보안 미리보기 artifact | 필수 |
| 감지 영역 수 22개 하드코딩 | 실제 Template IR 집계 | 필수 |
| `template_id`, schema, 12개 시트 하드코딩 | 실제 workbook 분석 결과 | 필수 |
| 검사가 화면을 떠나면 소실 | Temporal 실행과 서버 상태 복원 | 필수 |
| 실패가 기업 불일치 중심 | 전체 입력·호환성·작업 오류 분류 | 필수 |
| 중복·교체 version 없음 | 불변 원본과 supersedes version | 필수 |
| 자동 저장 문구가 실제 저장과 무관 | 서버 save projection과 마지막 저장시각 | 필수 |
| 전역 대형 Client Component | route server boundary와 작은 client island | 구현 품질 |

## 21. 구현 순서

1. files route의 서버 세션·소유권·setup 완료 guard를 구현한다.
2. PostgreSQL 파일 slot·upload·artifact·file version과 검사 projection 모델을 구현한다.
3. S3 호환 quarantine 직접 업로드와 완료·취소·cleanup 흐름을 구현한다.
4. file-scan worker와 업로드 검증 상태를 연결한다.
5. PDF 분석·Template IR·문체 프로필·시각 검증 workflow를 연결한다.
6. Aspose.Cells Excel 구조 분석·직접 입력 셀·재계산 검사를 연결한다.
7. pair compatibility와 MappingSet 생성·검증을 연결한다.
8. 현재 업로드 카드에 실제 파일별 progress·재시도·교체 상태를 연결한다.
9. 현재 결과 대화상자를 PDF·Excel·mapping 결과 탭으로 확장한다.
10. 필요한 경우 매핑 보정 drawer와 동적 read-only SpreadJS viewer를 연결한다.
11. 단계 완료 API와 실제 hypothesis URL 이동을 연결한다.
12. 중복·stale·실패·취소·권한·접근성 자동 테스트를 추가한다.
13. 빈 상태, 실행 중, passed, 대표 blocked 상태만 시각 회귀 기준으로 관리한다.

## 22. 완료 조건

- [ ] 비로그인 사용자가 로그인 후 같은 files URL로 복귀한다.
- [ ] 프로젝트 소유자가 아닌 사용자는 파일명·상태·프로젝트 존재 여부를 볼 수 없다.
- [ ] setup 미완료 프로젝트는 files 작업을 시작할 수 없다.
- [ ] PDF와 실제 Excel을 각각 한 개씩 업로드할 수 있다.
- [ ] 브라우저는 제한된 URL로 객체 저장소에 직접 업로드한다.
- [ ] 서버가 byte 크기, checksum, magic byte, 암호화와 악성 여부를 검증한다.
- [ ] 원본 PDF와 Excel은 덮어쓰지 않는 불변 artifact로 저장된다.
- [ ] 스캔 이미지 전용·암호화·손상 PDF가 즉시 차단된다.
- [ ] 외부 링크·권위 계산 불가·손상 Excel이 차단된다.
- [ ] PDF 템플릿 분석과 완전 복제 가능성 검사가 기준 수치를 적용한다.
- [ ] Excel의 모든 시트·수식·스타일·직접 입력 셀과 구조 hash를 저장한다.
- [ ] 기업·기간·실적 Review·PER 구조의 두 파일 적합성을 검사한다.
- [ ] 모든 필수 PDF slot에 confirmed binding 또는 명시적인 비Excel 규칙이 있다.
- [ ] 필수 미매핑은 다음 단계를 차단하고 화면에서 보정할 수 있다.
- [ ] 검사 진행률은 서버 stage와 실제 작업량을 사용한다.
- [ ] 화면을 닫아도 제출된 검사가 계속되고 재진입 시 복원된다.
- [ ] infrastructure 실패는 checkpoint부터 멱등 재시도할 수 있다.
- [ ] non-retryable 입력 오류에는 재시도 대신 교체·보정 액션이 표시된다.
- [ ] 같은 완료·검사·단계 이동 요청이 재전송돼도 한 번만 반영된다.
- [ ] 동일 owner 범위 중복과 다른 owner 파일 격리가 모두 지켜진다.
- [ ] 파일 교체 시 영향받는 하위 결과가 `재검증 필요`로 전환된다.
- [ ] 결과 대화상자에서 실제 PDF·Excel·mapping 결과를 모두 확인할 수 있다.
- [ ] 최신 passed version만 단계 입력으로 확정된다.
- [ ] 확정 성공 후 실제 `/projects/{projectId}/process/hypothesis`로 이동한다.
- [ ] 키보드만으로 파일 선택, 재시도, 결과 탭, 캐러셀, 매핑 보정과 다음 이동이 가능하다.
- [ ] 기본 결과 화면에서 SpreadJS와 조사 Agent 코드를 불필요하게 로드하지 않는다.
- [ ] 화면에 동작하지 않는 버튼, 가짜 진행률과 하드코딩 분석 결과가 남아 있지 않다.

## 23. 테스트 시나리오

### 23.1 단위 테스트

| 영역 | 시나리오 |
|---|---|
| 입력 | PDF/XLSX accept 안내, 복수 파일 거절, 역할별 선택 |
| 상태 reducer | empty→uploading→verifying→ready와 실패·취소 전이 |
| 진행률 | byte 분모가 있을 때만 백분율 표시, 그 외 indeterminate |
| capability | 두 파일 ready·passed·mapping confirmed 조합별 버튼 활성 |
| 오류 mapping | 서버 오류 code가 올바른 카드·탭·복구 액션으로 연결 |
| mapping draft | slot당 권위 원천 하나, stale version 충돌 |

### 23.2 API·통합 테스트

| 영역 | 시나리오 |
|---|---|
| 권한 | 다른 사용자의 project·upload·artifact·preview·inspection 접근 거부 |
| upload | presigned key·크기·type 제한, 만료 URL 갱신 |
| 무결성 | part 누락, 전체 checksum 불일치, 중복 complete |
| 멱등성 | 같은 upload complete·inspection start·stage complete 재전송 |
| version | 파일 교체 중 이전 run 완료가 최신 projection을 덮지 않음 |
| workflow | worker 종료·Temporal 재시작 후 checkpoint부터 복구 |
| cleanup | 취소·timeout 후 multipart, 임시 파일과 partial artifact 정리 |
| 단계 이동 | latest passed version만 hypothesis 이동 허용 |

### 23.3 PDF·Excel worker 테스트

| 영역 | 시나리오 |
|---|---|
| PDF | 정상 텍스트 PDF, 스캔 이미지, 암호화, 손상, 회전·CropBox 문서 |
| PDF 품질 | `0.25pt`, `0.5pt`, `0.75pt` 좌표 오류와 고정 영역 변경 검출 |
| PDF 자산 | 표·차트·Form XObject·subset font·미확보 font |
| Excel | 외부 링크, 숨김 시트, 이름 정의, 병합, chart, 미지원 함수 |
| Excel 계산 | Aspose.Cells 기준 수식 재계산과 저장 전후 무결성 |
| 입력 셀 | 노란 배경·파란 글씨 동시 조건만 판정 |
| mapping | scalar·table·chart, 중복 key, 길이 불일치, 필수 미매핑 |
| pair | 프로젝트·PDF·Excel 기업, 기간, 리포트 유형, PER 불일치 |

### 23.4 E2E

| 시나리오 | 기대 결과 |
|---|---|
| 정상 PDF·Excel 업로드 | 두 카드 ready, 검사 실행 활성 |
| 업로드 중 네트워크 단절 | 진행 보존, 재연결 후 이어받기·재시도 |
| 같은 파일 중복 선택 | 중복 artifact 생성 없이 사용자 범위 재사용 |
| PDF 기업 불일치 | 비교 대화상자와 PDF 교체 액션 |
| Excel 외부 링크 | Excel 탭에 cell/link 상세, 다음 차단 |
| 필수 매핑 모호 | mapping 탭 자동 포커스, 보정 후 관련 stage만 재검증 |
| 검사 중 페이지 이탈·재진입 | 같은 inspection 진행 상태 복원 |
| passed 뒤 PDF 교체 | 기존 결과 stale, hypothesis 이동 차단 |
| 결과 확인·다음 | 단계 완료 후 실제 hypothesis URL 이동 |
| 빠른 중복 클릭 | inspection과 단계 완료가 각각 한 번만 반영 |

### 23.5 접근성·시각 회귀

| 종류 | 시나리오 |
|---|---|
| 키보드 | 파일 선택, 교체, 검사 실행, 결과 대화상자, 탭, 캐러셀, 다음 |
| 포커스 | 대화상자 진입·가두기·Escape·호출 버튼 복귀 |
| 스크린리더 | 파일별 progress, stage 변경, 오류와 차단 이유 |
| 반응형 | desktop 2열, mobile 1열, 캐러셀 컨트롤 재배치 |
| 모션 감소 | progress 외 장식 전환 제거, 기능 동일 |
| 시각 기준 | 빈 상태, 실행 중, passed 결과, 대표 blocked 결과만 유지 |

### 23.6 보안 테스트

- 위조 `ownerId`, `objectKey`, `passed`, `editable`과 project version을 거부한다.
- 다른 프로젝트 upload ID와 artifact ID를 요청에 넣어도 접근할 수 없다.
- presigned URL로 다른 key, 과도한 크기와 다른 content type을 업로드할 수 없다.
- PDF·Excel parser exploit 표본이 web process나 다른 사용자 작업에 영향을 주지 않는다.
- 파일명 path traversal, HTML·script 문자열과 control character를 안전하게 표시한다.
- 매크로, 외부 링크, DDE와 embedded executable content를 실행하지 않는다.
- 미리보기와 다운로드 URL이 짧게 만료되고 소유권 확인 없이 재발급되지 않는다.

## 24. 필요한 추가 제품·기술 결정

화면 계약은 확정할 수 있지만 다음 값은 기준 문서에 아직 없다.

1. PDF·XLSX 최대 byte, PDF 최대 페이지, workbook 최대 used-cell·sheet 수
2. 악성 파일 검사 엔진과 quarantine·실패 파일 보존기간
3. 전자서명 PDF, PDF portfolio·첨부 파일과 특수 annotation 지원 범위
4. 암호화 Excel과 `.xlsm`·`.xls` 입력의 명시적 지원·거절 정책
5. 자동 매핑이 불가능한 slot의 사용자 범위 선택 UX와 운영자 지원 경계
6. 사용자가 장시간 inspection을 직접 취소할 수 있는지와 취소 후 재개 정책
7. 실제 표본군에서 PDF·Excel별 운영 크기·시간·메모리 한도

inspection 진행 전달은 TD-016의 polling으로 확정됐다. 나머지 항목은 구현 전에 새 기술 결정 또는 운영 설정으로 확정한다. 미확정 값을 React 상수나 사용자 문구로 먼저 고정하지 않는다.
