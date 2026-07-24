# REFLO 화면 구현 명세: `/projects/:projectId/report` 보고서

**문서 상태:** 보고서 편집·검증·내보내기 명세 작성 완료\
**작성일:** 2026-07-24\
**대상:** 현업 배포용 MVP\
**상위 문서:** [`REFLO_SCREEN_IMPLEMENTATION_SPEC_v1.md`](../REFLO_SCREEN_IMPLEMENTATION_SPEC_v1.md)\
**기준 문서:** [`REFLO_URL_SERVICE_BEHAVIOR_v1.md`](../REFLO_URL_SERVICE_BEHAVIOR_v1.md), [`REFLO_TECHNICAL_DECISIONS_v1.md`](../REFLO_TECHNICAL_DECISIONS_v1.md)

## 10. `/projects/:projectId/report` — 보고서 편집·검증·내보내기

### 10.1 명세 상태

| 항목 | 값 |
|---|---|
| URL | `/projects/:projectId/report` |
| 접근 권한 | Google 로그인한 프로젝트 소유자만 |
| 주요 목적 | 이전 분기 PDF 레이아웃을 완전히 복제한 초안을 검토·수정하고, 검증·최종 승인 후 PDF와 Excel을 내보냄 |
| 진입 단계 | `/projects/:projectId/process/report-outline`에서 페이지 구성 승인 및 초안 생성 시작 |
| 이전 화면 | `/projects/:projectId/process/report-outline` |
| 현재 구현 route | `source-react/app/projects/[projectId]/report/page.tsx` |
| 현재 실제 UI | `source-react/app/page.tsx`의 `ReportPage`와 하위 컴포넌트 |
| 관련 기술 결정 | TD-001, TD-002, TD-004, TD-005, TD-006, TD-007, TD-008, TD-011, TD-012 |
| 구현 상태 | 5페이지 디자인·편집 프로토타입만 존재, 실제 저장·버전·검증·작업·다운로드 미구현 |

### 10.2 기준 우선순위와 범위

이 화면의 제품 동작은 다음 순서로 판단한다.

1. 서비스 동작 명세의 MVP 불변조건과 15장 보고서 계약
2. 기술 결정 문서의 PDF·Excel·작업·Evidence 계약
3. `DESIGN.md`와 `.omd/preferences.md`의 화면 규칙
4. 현재 React 화면의 시각 구조와 상호작용

현재 React의 하드코딩 문구, 수치, 상태, 샘플 다운로드와 DOM 직접 수정 동작은 제품 계약이 아니다. 반면 다음 시각·상호작용은 기준 문서와 충돌하지 않는 한 보존한다.

- 상단 전역 헤더와 보고서 도구막대
- 왼쪽 페이지 목차
- 중앙의 분리된 A4 문서 시트
- 보기·편집 모드가 같은 문서 레이아웃을 공유하는 구조
- 선택 영역의 AI 수정 액션
- 표·차트 전용 편집 모달
- 우측 근거 패널과 원문 전체 보기
- 내보내기 패널의 위치와 카드형 파일 상태

MVP의 최종 산출물은 PDF와 값이 채워진 Excel이다. 현재 화면의 Word·DOCX 내보내기는 제거한다.

### 10.3 화면 목적과 책임

이 화면은 다음 책임을 가진다.

1. 승인된 Template IR, MappingSet, Excel 계산 결과, Evidence와 페이지 구성 버전을 고정해 만든 보고서 초안을 표시한다.
2. 원본 PDF의 페이지 수·크기·좌표·스타일 안에서 허용된 텍스트·표·차트만 편집한다.
3. 편집 내용을 자동 저장하고, 실행 취소·다시 실행·버전 기록을 제공한다.
4. 문장·숫자·표·차트가 연결된 원문과 Excel 계산 경로를 확인하게 한다.
5. 내보내기 전에 구조·수치·근거·레이아웃·렌더링 검증을 수행한다.
6. 사용자의 최종 승인을 불변 버전으로 저장한다.
7. 승인 버전으로 PDF와 Excel 내보내기 작업을 비동기로 실행하고 다운로드를 제공한다.

이 화면은 다음 책임을 갖지 않는다.

- 기업·분기·기준일 변경
- 원본 PDF·Excel 교체
- 검증되지 않은 실제값 채택
- 미래 추정치·Target PER·목표주가의 권위값 직접 수정
- 프로젝트 공동 편집 또는 역할별 승인
- 원본 PDF의 페이지 추가·삭제·규격 변경

### 10.4 진입 조건과 직접 URL 접근

#### 정상 진입 조건

다음을 모두 만족해야 편집 가능한 초안을 연다.

- 검증된 Google 로그인 세션이 있다.
- 세션 사용자가 `projectId`의 소유자다.
- 프로젝트 설정과 필수 파일 적합성 검사가 완료됐다.
- 필수 Evidence 검증과 출처 충돌 해결이 완료됐다.
- Excel 권위 계산 결과와 Target PER이 확정됐다.
- 페이지 구성 승인 버전이 존재한다.
- 초안 생성에 필요한 Template IR·MappingSet·문체·Evidence·Excel 버전이 유효하다.
- 초안 생성 작업이 완료돼 작업 보고서 버전이 존재한다.

#### 직접 URL 접근 결과

| 서버 상태 | 화면 동작 |
|---|---|
| 비로그인 | Google 로그인으로 이동하고 성공 후 동일 URL로 복귀 |
| 다른 사용자 프로젝트 또는 존재하지 않는 프로젝트 | 프로젝트 존재 여부를 노출하지 않는 공통 `찾을 수 없음` 화면 |
| 선행 단계 미완료 | 차단 이유와 `페이지 내용 설정으로 이동` 액션 표시 |
| 초안 생성 `queued`·`running` | 생성 진행 화면과 단계·최근 갱신 시각 표시 |
| 초안 생성 `failed` | 실패 단계·재시도 가능 여부·`다시 생성` 표시 |
| 작업 초안 존재 | 최신 작업 버전 표시 |
| 최종 승인 버전만 존재 | 읽기 전용 최종본 표시, 필요 시 `새 버전 편집` 제공 |
| 하위 결과 `재검증 필요` | 기존 문서를 읽기 전용으로 보여주되 편집·승인·내보내기 차단 |

`projectId`와 보고서 버전은 서버가 검증한다. 클라이언트 route parameter만으로 조회·수정·다운로드 권한을 허용하지 않는다.

### 10.5 초안 생성과 화면 진입 흐름

```text
페이지 내용 설정 승인
  → 생성 방식과 입력 버전 고정
  → ReportWorkflow 시작
  → Excel 권위값 재확인
  → Evidence·컨센서스 snapshot 고정
  → RenderPlan 생성
  → 편집 가능한 보고서 모델 생성
  → PDF 초안 렌더링
  → 구조·기본 시각 검사
  → 작업 보고서 버전 게시
  → /projects/{projectId}/report 이동
```

초안 생성에 고정하는 버전:

- `templateVersionId`
- `styleProfileVersionId`
- `mappingSetVersionId`
- `workbookVersionId`와 `calculationRunId`
- `evidenceSetVersionId`
- `consensusSnapshotIds`
- `hypothesisVersionId`와 잠정 투자의견 버전
- `reportOutlineVersionId`
- `reportGenerationMode`
- parser·font·renderer·Agent·prompt 버전

현재 화면의 `AI 초안과 함께 생성`과 `빈 텍스트 영역으로 생성` 선택은 선행 화면의 생성 입력이다. 두 방식을 지원하더라도 같은 버전 고정·레이아웃·검증 계약을 적용한다. 빈 텍스트 방식의 MVP 제공 여부는 10.44의 미확정 사항으로 남긴다.

### 10.6 이탈·복귀 조건

| 이탈 동작 | 계약 |
|---|---|
| `Process` 또는 `← Process` | `/projects/:projectId/process/report-outline`로 이동 |
| 전역 `Project`·프로젝트로 돌아가기 | `/projects`로 이동 |
| 브라우저 뒤로가기 | 실제 App Router history를 따라 이동 |
| 탭 닫기·새로고침 | 저장되지 않은 변경이 있을 때만 브라우저 이탈 경고 |
| 생성·검증·내보내기 중 이동 | 서버 작업은 계속되며 프로젝트 목록과 재진입 화면에 상태 표시 |

route 이동 전 클라이언트는 대기 중인 자동 저장을 한 번 즉시 전송한다.

- 저장 성공: 바로 이동한다.
- 요청 중: 짧은 flush 상태를 표시한 뒤 성공 시 이동한다.
- 오프라인·저장 실패: `저장되지 않은 변경이 있습니다` 확인창을 표시한다.
- 사용자가 이탈을 취소하면 편집 내용을 유지한다.
- 강제로 이탈해도 저장되지 않은 내용을 서버 저장으로 표시하면 안 된다.

### 10.7 현재 화면 확인 결과

| 현재 동작 | 확인 결과 |
|---|---|
| App Router route | report route가 전용 화면을 구현하지 않고 루트 `app/page.tsx`를 재내보냄 |
| URL 판정 | Client Component가 `window.location.pathname`을 해석하고 `history.pushState`로 이동 |
| 문서 | 리노공업 표본의 5개 페이지를 A4 시트 형태로 표시 |
| 보기·편집 | 같은 `LinoReportEditor` 레이아웃에서 `inert`와 `contentEditable`만 전환 |
| 편집 저장 | DOM과 React 로컬 상태만 변경하며 새로고침 시 소실 |
| 자동 저장 표시 | 실제 저장 없이 항상 `자동 저장됨` 표시 |
| 실행 취소·다시 실행·배율 | 버튼만 있고 동작 없음 |
| 페이지 목차 `+` | 버튼만 있고 동작 없음 |
| AI 문장 수정 | 문자열 치환 후 DOM을 직접 수정하고 즉시 적용, diff·서버 검증 없음 |
| 표 편집 | 브라우저에서 CSV를 단순 분리하고 표 셀 DOM을 직접 변경 |
| 차트 편집 | 하드코딩된 네 유형을 로컬 상태로 교체 |
| 근거 패널 | 출처·문장·위치가 모두 하드코딩 |
| 오류 검사 | `FinalCheck` UI는 존재하지만 여는 동작이 연결되지 않음 |
| 내보내기 | 검증·승인 없이 정적 샘플 DOCX·PDF·XLSX 링크를 즉시 다운로드 |
| 권한·동시성 | 인증·소유권·version·edit session 검사 없음 |

### 10.8 기존 디자인 재사용·수정·제거 판정

| 현재 영역·컴포넌트 | 판정 | 목표 구현 |
|---|---|---|
| `AppHeader`의 Process·Report 내비게이션 | 수정 재사용 | 실제 App Router 링크, 세션 사용자와 프로젝트 메타데이터 연결 |
| 헤더 `자동 저장됨` | 수정 재사용 | 실제 `saving`·`saved`·`failed`·`offline`·`conflict` 상태 표시 |
| 도움말 `?` | 제거 | 실제 도움말 기능이 확정되기 전 빈 버튼을 두지 않음 |
| 가짜 `JE` 아바타 | 수정 재사용 | Google 프로필 또는 이니셜과 사용자 메뉴 |
| `ReportPage` 전체 배치 | 재사용 | 로컬 상태를 서버 보고서 데이터와 작업 상태로 교체 |
| `report-toolbar` | 재사용 | 각 버튼에 실제 기능·비활성·오류·접근성 계약 연결 |
| `report-outline` | 수정 재사용 | 서버 page 목록과 현재 page 상태 연결, 페이지 추가 `+` 제거 |
| `LinoReportEditor` 5페이지 표본 | 구조 재사용 | Template IR의 실제 page count·block·slot으로 생성 |
| 보기·편집 모드의 동일 레이아웃 | 그대로 재사용 | mode는 편집 권한과 포커스 affordance만 바꿈 |
| 보기·편집 안내 카드 | 제거 | 문서 위의 추가 편집 헤더를 두지 않고 도구막대 상태로 충분히 설명 |
| 분리된 A4 시트와 시트 간 간격 | 그대로 재사용 | 원본 페이지 규격과 비율 유지 |
| 표지 레이아웃 | 그대로 재사용 | 현재 표본의 최신 보정값 `#ebf5ff`, 요약 패널 `#f5f5f5` 적용 |
| `LinoEditableTable` | 수정 재사용 | 권위값·허용 셀·표 구조 규칙으로 편집 범위 제한 |
| `TargetPriceTrendChart` | 수정 재사용 | 차트를 변경 이력 표보다 먼저 배치하고 실제 series 연결 |
| `SourcePanel`·원문 전체 보기 | 수정 재사용 | TD-012 locator·source version·권한 데이터 연결 |
| `ChartStudio` | 수정 재사용 | 표현 방식과 검증된 series만 편집, 비동기 제안·미리보기·적용 |
| `TableStudio` | 수정 재사용 | 업로드 격리 검사·구조화 미리보기·권위 매핑 검증 후 적용 |
| 선택 영역·문단 `AI 수정` | 수정 재사용 | 안정적인 block range, 비동기 proposal, diff 확인 후 적용 |
| `FinalCheck` | 목적 변경 재사용 | 실제 검증 작업의 결과·위치 이동·경고 확인 패널 |
| `ExportPanel` | 수정 재사용 | PDF·XLSX 작업별 비동기 상태·재시도·다운로드 표시 |
| Word 보고서 카드 | 제거 | DOCX는 MVP 범위 밖 |
| `initialSections`와 `false &&` 레거시 문서 | 제거 | 현재 렌더링되지 않는 중복 하드코딩 구현 |
| 정적 `/public/downloads/*` 직접 링크 | 제거 | 권한 검사된 최종 artifact 다운로드 API 사용 |

현재 CSS에 쌓인 report 레이아웃 보정값은 화면 분리 때 필요한 규칙만 전용 stylesheet 또는 CSS module로 이동한다. 시각 결과를 바꾸기 위한 재디자인은 하지 않는다.

### 10.9 디자인·레이아웃 계약

#### 데스크톱

- 전역 헤더 아래에 보고서 도구막대를 고정한다.
- 왼쪽 목차는 기본 `220px` 안팎의 기존 폭을 유지한다.
- 중앙 작업 영역은 중성 배경 위에 원본 비율의 페이지를 세로로 나열한다.
- 각 페이지는 서로 붙이지 않고 독립된 시트로 표시한다.
- 근거 패널은 우측 overlay drawer로 열어 문서의 출력 폭을 바꾸지 않는다.
- 근거 패널은 drag·키보드로 폭을 조절하고 두 번 클릭해 기본 폭으로 복원한다.

#### 페이지 규격

- 페이지 수, MediaBox, CropBox, rotation과 비율은 Template IR의 값이 권위다.
- 현재 표본은 5페이지를 모두 표시하지만 모든 프로젝트를 5페이지로 하드코딩하지 않는다.
- 페이지를 화면 너비에 맞춰 축소할 수 있으나 내부 요소를 반응형 웹 문서처럼 재배치하지 않는다.
- 문서 좌표는 PDF `pt` 기준을 유지하고 화면 좌표 변환 matrix를 별도로 사용한다.
- 원본에서 분리된 페이지는 연결된 무한 canvas로 만들지 않는다.

#### 태블릿·모바일

- 왼쪽 목차는 숨기는 대신 `페이지 목록` drawer로 제공한다.
- 원본 PDF 레이아웃과 요소 좌표를 유지한 채 `페이지 맞춤` 또는 가로·세로 스크롤로 본다.
- 현재 CSS처럼 표지를 단일 열로 재배치하거나 재무표를 다른 grid로 바꾸지 않는다.
- 도구막대의 낮은 우선순위 항목은 `더 보기` 메뉴로 접되 편집·근거·내보내기는 접근 가능해야 한다.
- 근거·AI·내보내기 패널은 모바일에서 화면 전체 너비의 sheet 또는 dialog가 된다.
- 모든 버튼은 44px hit area를 제공한다.

#### pending 디자인 보정 적용

- 보기와 편집 모드는 같은 문서 레이아웃을 사용한다.
- 문서 위에 별도의 편집 문맥 카드를 추가하지 않는다.
- 선택된 편집 영역 오른쪽 위에 영역 한정 AI 액션을 표시한다.
- 표 선택 시 prompt와 CSV·Excel·이미지 첨부를 받는 표 전용 AI 편집기를 연다.
- 목표주가 차트 선택 시 prompt, CSV·Excel·이미지 첨부와 네 가지 차트 표현 선택을 제공한다.
- 목표주가 추이 차트는 해당 제목 바로 아래, 변경 이력 표보다 먼저 표시한다.
- 테스트 fixture의 애널리스트 연락처는 가상 이름과 `example.com` 주소만 사용한다. 운영 데이터는 검증된 조직·작성자 프로필 또는 원본 고정 자산에서 가져온다.

### 10.10 목표 컴포넌트 구성

| 컴포넌트 | 책임 | 주요 입력 | 주요 출력·이벤트 |
|---|---|---|---|
| `ReportRoute` | 세션·소유권·선행 조건 확인과 초기 데이터 제공 | `projectId` | 정상 화면, 생성 상태, 차단·오류 화면 |
| `ReportWorkspace` | report 화면 배치와 패널 상태 조정 | report bootstrap | mode·page·panel·job 조정 |
| `ReportHeader` | 전역 내비게이션·프로젝트·사용자 표시 | project, session | Process·Project 이동, 사용자 메뉴 |
| `ReportToolbar` | 저장 상태, undo·redo, zoom, version, preview, evidence, edit, export | permission, editor state | 각 command |
| `PageOutline` | 실제 페이지 목록과 현재 위치 표시 | pages, activePageId | page 이동, 모바일 drawer |
| `ReportCanvas` | 분리된 실제 page sheet 렌더링 | Template IR view model, zoom | page·block 선택 |
| `ReportPageSheet` | 원본 page 좌표와 block 배치 | page model | block focus |
| `EditableBlock` | 허용된 text·list·table·chart 편집 | block, permission | typed edit operation |
| `BlockAiAction` | 선택 block 또는 range의 AI proposal 시작 | blockId, range, prompt | proposal job |
| `AiRewritePanel` | 원문·제안 diff와 적용·취소 | proposal | apply·discard |
| `TableStudio` | 표 prompt·첨부·구조·허용값 검토 | table slot, bindings | table proposal apply |
| `ChartStudio` | chart 표현·series·첨부 검토 | chart slot, bindings | chart proposal apply |
| `EvidenceDrawer` | source·locator·계산 경로 표시 | blockId, slotId | 원문 열기 |
| `SourceViewer` | PDF 좌표 highlight 또는 공식 URL 이동 | source version, locator | page 이동·외부 새 탭 |
| `VersionHistoryPanel` | 작업·승인·내보내기 버전 기록 | reportId | version 열기·복원 |
| `PreviewPanel` | 서버가 렌더링한 PDF 미리보기 | preview artifact | page 탐색·새로고침 |
| `ValidationPanel` | 검사 진행·오류·경고·바로 수정 | validation run | issue 이동·경고 확인 |
| `FinalApprovalDialog` | 최종 숫자·의견·근거·레이아웃 확인 | exact report version | immutable approval |
| `ExportPanel` | PDF·XLSX job과 다운로드 상태 | export jobs | retry·cancel·download |

### 10.11 보고서 도구막대 UI 계약

| ID | 요소 | 노출·활성 조건 | 동작 | 실패·비활성 처리 |
|---|---|---|---|---|
| REPORT-BTN-01 | `← Process` | 항상 | report-outline URL 이동 | 저장 실패 시 이탈 확인 |
| REPORT-STATUS-01 | 보고서명·버전·마지막 저장 | 항상 | 버전·저장 메타데이터 표시 | 하드코딩 상대시간 금지 |
| REPORT-BTN-02 | 실행 취소 | 편집 가능하고 undo stack 존재 | 역연산을 새 편집 operation으로 적용·저장 | 저장 충돌 시 실행 취소 중단 |
| REPORT-BTN-03 | 다시 실행 | redo stack 존재 | 되돌린 operation 재적용 | 새 편집 후 redo stack 비움 |
| REPORT-BTN-04 | 축소 | 최소 배율 초과 | 한 단계 축소 | 최소에서 비활성 |
| REPORT-STATUS-02 | 배율 | 항상 | 현재 배율 표시, 선택 시 배율 메뉴 | 비율은 출력 크기를 변경하지 않음 |
| REPORT-BTN-05 | 확대 | 최대 배율 미만 | 한 단계 확대 | 최대에서 비활성 |
| REPORT-BTN-06 | `근거 보기` | block·page가 존재 | 현재 선택 block 또는 page 근거 drawer 열기 | 근거 없음 상태 설명 |
| REPORT-BTN-07 | `버전 기록` | 보고서 존재 | version panel 열기 | 조회 실패 시 재시도 |
| REPORT-BTN-08 | `출력 미리보기` | 저장 완료된 작업 버전 | preview 생성·열기 | 저장 중·충돌이면 비활성 |
| REPORT-BTN-09 | `편집 모드`·`편집 중` | working version이고 edit lease 보유 가능 | mode·lease 전환 | final·stale·권한 없음은 읽기 전용 |
| REPORT-BTN-10 | `내보내기` | 보고서 존재 | 저장 flush 후 검증·승인·내보내기 흐름 시작 | 선행 차단 이유 표시 |

별도 `오류 점검` 실행 버튼은 도구막대에 추가하지 않는다. 최신 검증 상태는 보고서명 옆 `검증 필요`·`검증 중`·`통과`·`오류 N건` 상태로 표시하고 선택하면 결과 패널을 연다. 실제 최종 검증은 `내보내기` 흐름에서 자동 시작한다.

배율 기본값은 `페이지 맞춤`이다. 현재의 `100%`는 실제 PDF point와 CSS pixel의 관계를 정의한 경우에만 사용하고, 단순 문자열로 두지 않는다.

### 10.12 페이지 목차·이동 계약

- 페이지 목록은 `pageId`, 표시 번호, 원본 page label과 Template IR 역할명으로 만든다.
- 현재 표본의 `Company Update`, `Earnings Review` 같은 제목을 모든 프로젝트에 하드코딩하지 않는다.
- 목차 선택 시 해당 page sheet의 시작점으로 이동하고 focus 가능한 page heading에 포커스를 준다.
- 스크롤 시 가장 많이 보이는 page를 active로 갱신한다.
- URL fragment는 안정적인 page ID를 사용해 복귀 위치를 보존할 수 있다.
- 목차의 페이지 추가 `+`는 제거한다. 페이지 수는 원본과 동일해야 한다.
- 페이지 추가·삭제·순서 변경·규격 변경은 report 화면에서 허용하지 않는다.
- 모바일에서는 목차를 drawer로 열며 선택 후 drawer를 닫는다.

### 10.13 보기·편집 모드와 편집 권한

#### 보기 모드

- 모든 page를 실제 출력 레이아웃으로 표시한다.
- 텍스트 선택·복사와 근거 확인은 허용한다.
- 편집 focus outline과 AI action은 표시하지 않는다.
- 고정·동적 영역의 시각 배치는 편집 모드와 동일하다.

#### 편집 모드

- 서버가 발급한 edit session과 최신 working version이 있어야 한다.
- Template IR에서 `dynamic`이며 사용자 편집이 허용된 block만 편집 가능하다.
- 선택 영역은 focus border와 색상 외에 명시적 AI action으로 구분한다.
- `fixed`·`protected` block은 focus되지 않으며 읽기 전용 이유를 확인할 수 있다.
- 편집 mode를 켜는 동작 자체가 validation을 무효화하지 않는다. 실제 내용 변경이 성공 저장된 때만 무효화한다.

#### 편집 가능 대상

- 제목·소제목
- 본문·목록·투자 포인트·리스크 문장
- 사용자 문장 block의 허용 범위
- 표의 비권위 label·주석과 명시적으로 허용된 사용자 셀
- 차트의 허용 표현 방식

#### 직접 편집 금지 대상

- Excel 또는 검증 Evidence에 연결된 숫자 권위값
- 수식·합계·증감률·EPS·PER·목표주가 결과
- 고정 로고·배경·페이지 규격·페이지 번호 규칙
- 법정 고지·승인된 고정 문구
- Template IR의 block 좌표·clip·z-order
- 출처 ID·locator·provenance edge

Excel 연결 숫자를 선택하면 `이 값은 Excel 계산 결과입니다`와 함께 연결 셀·계산 경로와 `/process/valuation` 이동을 제공한다. report에서 문자열로 덮어쓰지 않는다.

### 10.14 텍스트 입력 UI 계약

| 항목 | 계약 |
|---|---|
| 저장 단위 | `blockId`와 안정적인 구조 range를 가진 typed operation |
| 권위 데이터 | 서버의 report block revision |
| 입력 표현 | 제목, 문단, 목록 같은 허용 schema |
| 금지 | 임의 HTML, script, inline style, block 좌표 변경 |
| 길이 | Template IR의 허용 영역과 문체·줄 수 규칙으로 검증 |
| 붙여넣기 | plain text와 허용된 줄바꿈·목록만 유지 |
| 한글 IME | composition 중 autosave·AI range 확정을 실행하지 않음 |
| 오류 | block 아래가 아니라 선택 영역 가까이에 구체적 원인 표시 |

원시 `contentEditable` DOM을 서버 저장값으로 직렬화하지 않는다. 구현 시 구조화 editor 또는 typed operation adapter가 필요하다. 편집기 라이브러리는 아직 미확정이다.

문장이 영역을 넘으면 다음 순서를 적용한다.

1. 사용자가 입력한 문장을 저장 전 overflow 후보로 표시한다.
2. `영역에 맞게 줄이기` AI 제안을 선택적으로 제공한다.
3. 제안은 숫자·의미·근거를 유지하고 diff로 확인한다.
4. 적용 후에도 맞지 않으면 차단 오류로 유지한다.
5. 글자 크기를 자동 축소하거나 새 페이지를 만들지 않는다.

### 10.15 AI 문장 수정 계약

#### 시작

- 사용자가 editable block 또는 그 안의 text range를 선택한다.
- 영역 오른쪽 위 `AI 수정` 또는 selection prompt를 연다.
- prompt, `blockId`, 안정적인 시작·끝 offset, 현재 block revision을 서버로 보낸다.
- 브라우저 DOM `Range`와 선택 문자열만으로 수정 위치를 확정하지 않는다.

#### 제안 상태

`idle → queued → running → ready | failed | canceled | stale`

- `ready`에서 원문과 제안문 diff를 표시한다.
- 숫자·단위·Evidence·투자의견·사용자 가정 유지 검사를 함께 표시한다.
- 사용자가 `적용`을 누르기 전 보고서 본문을 변경하지 않는다.
- 동일 block이 그 사이 변경되면 proposal은 `stale`로 전환하고 다시 요청한다.

#### 적용 규칙

- 수정 범위는 선택 block 또는 range 안으로 제한한다.
- 연결된 numeric slot과 Evidence ID를 유지한다.
- 원문에 없는 사실과 새 출처를 추가하지 않는다.
- 사용자가 확정한 투자의견·가정·Target PER을 바꾸지 않는다.
- 적용은 일반 편집 operation으로 저장되고 undo할 수 있다.
- 적용 성공 시 기존 full validation을 무효화한다.
- PydanticAI의 구조화 output과 model·prompt version을 기록한다.

### 10.16 표 편집·첨부 계약

표를 선택하면 현재 `TableStudio`의 위치와 시각 구조를 유지한 표 전용 editor를 연다.

#### 입력 요소

| 요소 | 계약 |
|---|---|
| `AI 수정 요청` textarea | 표 구조·강조·표현에 대한 요청, 권위값 임의 변경 금지 |
| 파일 첨부 | CSV, TSV, XLSX, XLS, 지원 이미지 |
| 표 유형 | Template IR과 slot topology가 허용하는 선택지만 |
| 셀 미리보기 | 적용 전 구조·값·단위·출처·권위 상태 확인 |
| `적용` | 검증을 통과한 proposal만 활성 |

#### 첨부 처리

1. 서버가 제한된 upload session과 S3 호환 저장소의 quarantine key를 발급한다.
2. 파일 형식·크기·악성·암호화 여부를 격리 워커에서 검사한다.
3. CSV·Excel은 typed cell과 구조를 파싱하고, 이미지는 OCR·표 구조 후보를 만들 수 있다.
4. 기존 MappingSet 권위값과 비교한다.
5. 새 숫자가 검증 Evidence 또는 Excel 권위 원천과 연결되지 않으면 `참고 자료`로만 표시하고 적용을 차단한다.
6. 허용된 표 label·열 표시·정렬·강조만 즉시 proposal로 만들 수 있다.
7. 권위 데이터 변경이 필요하면 해당 process 단계로 보낸다.

현재 브라우저의 단순 `split(delimiter)` CSV 파싱과 이미지·Excel 파일명을 근거로 하드코딩 표를 만드는 방식은 사용하지 않는다.

#### 표 값 규칙

- Excel 계산값은 TD-004 Aspose.Cells 결과만 사용한다.
- 표 행·열은 TD-005 Keyed Table binding과 topology를 따른다.
- 필수 row·column key를 삭제하거나 중복되게 만들 수 없다.
- 실제값·추정값·컨센서스의 기간·단위·연결 기준을 유지한다.
- 붙여넣기·첨부 적용은 전체 operation이 유효할 때만 원자적으로 성공한다.

### 10.17 차트 편집·첨부 계약

- chart의 기본 series는 TD-005 Chart-series binding이 제공한다.
- 차트 유형 변경은 데이터 권위값이 아니라 표현 방식만 변경한다.
- 축, 범례, 실제·추정 구간, 단위와 데이터 label은 Template IR 계약을 벗어날 수 없다.
- 네 가지 후보는 해당 chart slot이 표현할 수 있는 유형만 반환한다.
- 파일 첨부는 10.16과 같은 격리·검증 흐름을 사용한다.
- 새 series가 필요하면 검증된 source와 mapping을 먼저 생성해야 한다.
- 적용 전 chart preview와 변경되는 축·series·legend를 표시한다.
- 적용 후 overflow·clip·style validation을 즉시 예약한다.
- 목표주가 추이 차트는 변경 이력 표보다 먼저 렌더링한다.

### 10.18 근거·원문·계산 경로 계약

#### 문장·숫자·표·차트 선택

선택 항목의 provenance를 서버에서 조회해 다음을 표시한다.

- 보고서 block·slot
- Evidence version과 검증 상태
- source type, 발행기관, 문서명, 발행일
- 정확한 원문 인용과 앞뒤 문맥
- PDF page·bbox, HTML exact quote·prefix·suffix 또는 API JSON Pointer
- Excel workbook version, sheet·cell·formula와 dependency path
- 보고서에 사용된 위치와 동일 Evidence를 쓰는 다른 block

#### 원문 열기

| 출처 | 동작 |
|---|---|
| DART·IR·사용자 PDF | 저장된 `source_version`의 정확한 page로 이동하고 bbox highlight |
| 뉴스 | 실제 공식 URL을 새 탭으로 열고 가능한 경우 Text Fragment 추가 |
| 구조화 API | 정규화 값과 원본 response 위치를 내부 상세 화면에 표시 |
| Excel 입력값 | workbook version·sheet·cell과 연결 Evidence 표시 |
| Excel 계산값 | 입력 cell부터 결과 cell까지 계산 경로 표시 |

최신 URL의 다른 PDF나 현재 웹페이지에 과거 locator를 적용하지 않는다. 원문 전체 표시 권한이 없는 뉴스·유료 자료는 공식 URL, 최소 인용, hash와 검증 위치만 표시한다.

### 10.19 자동 저장 상태와 동작

#### 상태

| 상태 | 도구막대 표시 | 편집 가능 여부 |
|---|---|---|
| `saved` | `자동 저장됨 · 시각` | 가능 |
| `dirty` | `저장 대기` | 가능 |
| `saving` | `저장 중` | 가능, 같은 block 요청은 순서 보장 |
| `failed` | `저장 실패 · 다시 시도` | 메모리 편집 가능, 이탈 경고 |
| `offline` | `오프라인 · 저장 안 됨` | 메모리 편집 가능, 서버 성공으로 표시 금지 |
| `conflict` | `다른 탭 변경 감지` | 읽기 전용 전환 |
| `locked` | `최종본 · 읽기 전용` | 불가 |

#### 저장 시점

- 마지막 입력 후 짧은 debounce로 batch 저장한다.
- block blur, AI proposal 적용, 표·차트 적용, mode 종료, route 이탈 전 즉시 flush한다.
- 정확한 debounce 값은 UX 계측 후 정하되 1초를 넘는 동안 저장 상태가 숨겨지지 않게 한다.
- 빠른 입력은 같은 block의 ordered operation으로 묶을 수 있다.
- 저장 중 새 입력은 이전 응답을 기다리지 않고 queue하되 오래된 응답을 최신 상태 위에 적용하지 않는다.

#### 저장 요청

모든 요청은 다음을 포함한다.

- `reportVersionId`
- 예상 `version`
- `editSessionId`
- `clientMutationId`
- typed operations

같은 `clientMutationId` 재전송은 한 번만 반영한다. 성공 응답은 새 version, 저장된 block revision, 무효화된 validation·preview·export 상태를 반환한다.

민감한 보고서 본문을 `localStorage`에 권위 사본으로 저장하지 않는다. 오프라인 초안의 브라우저 영구 저장 여부는 별도 보안 결정을 하기 전까지 지원하지 않는다.

### 10.20 실행 취소·다시 실행

- undo·redo는 저장되지 않은 DOM snapshot이 아니라 typed edit operation을 기준으로 한다.
- undo도 과거 DB row를 되돌리는 UPDATE가 아니라 inverse operation을 새 revision으로 저장한다.
- AI·표·차트 적용은 각각 하나의 undo 단위다.
- 다른 block의 자동 저장 성공 여부와 command 순서를 보존한다.
- 새 편집이 발생하면 redo stack을 비운다.
- 페이지 reload 후 서버 version history는 남지만 세밀한 local redo stack 복원은 필수가 아니다.
- 최종 승인 버전에서 undo·redo를 허용하지 않는다.

### 10.21 보고서 버전 계약

| 버전 종류 | 수정 가능 | 설명 |
|---|---:|---|
| `working` | 예 | 현재 편집 중인 작업 버전 |
| `validation_snapshot` | 아니요 | 특정 validation run이 검사한 정확한 입력 snapshot |
| `approved` | 아니요 | 사용자가 최종 승인한 불변 버전 |
| `restored_working` | 예 | 과거 버전을 기반으로 새로 만든 작업 버전 |
| `superseded` | 아니요 | 새 작업·승인 버전으로 대체된 과거 버전 |

버전 기록은 생성 시각, 생성 주체, 기반 버전, 변경 요약, 검증 상태, 승인·내보내기 상태를 보여준다.

- 과거 버전을 열면 읽기 전용으로 표시한다.
- `이 버전에서 새 초안 만들기`는 과거 row를 수정하지 않고 새 working version을 만든다.
- 승인 버전을 수정하려면 `새 버전 편집`을 명시적으로 실행한다.
- 새 버전은 기존 승인·다운로드 artifact를 바꾸지 않는다.
- 새 Evidence·Excel·템플릿 버전이 생겨도 과거 승인 보고서는 당시 버전을 계속 참조한다.

### 10.22 동일 사용자 여러 탭과 동시 수정

MVP는 공동 프로젝트·동시 공동 편집을 지원하지 않는다. 같은 사용자의 여러 탭 충돌을 막기 위해 한 working version에 하나의 active edit session만 허용한다.

```text
탭 A가 편집 시작
  → edit session·lease 발급
탭 B가 같은 버전 진입
  → 보기 모드
  → "다른 탭에서 편집 중"
  → 필요 시 "편집권 가져오기"
편집권 이동
  → 탭 A lease 무효화
  → 탭 A의 이후 저장은 409
  → 탭 A를 읽기 전용으로 전환
```

- lease는 heartbeat로 유지한다.
- 비정상 종료 시 일정 시간 후 회수한다.
- 정확한 TTL과 heartbeat 주기는 미확정이다.
- stale version을 서버가 자동 병합하거나 마지막 요청으로 덮어쓰지 않는다.
- 충돌 시 현재 탭의 저장되지 않은 text를 복사할 수 있게 제공한 뒤 최신 버전을 다시 불러온다.
- 서버 version과 edit session 검사는 모든 수정·AI 적용·검증·승인 요청에서 반복한다.

### 10.23 출력 미리보기

편집 canvas는 편집 편의를 위한 구조화 view이며 최종 PDF artifact 자체가 아니다. `출력 미리보기`는 서버 PDF 워커가 현재 저장 버전으로 만든 실제 렌더링 결과를 표시한다.

#### 상태

`not_created | stale | queued | rendering | verifying | ready | failed`

- 변경 저장 성공 시 기존 preview를 `stale`로 만든다.
- preview 생성은 편집을 막지 않는 비동기 작업이다.
- 같은 report version·RenderPlan·renderer profile의 결과가 있으면 재사용한다.
- `ready`에서 실제 PDF page, 페이지 수, 폰트 경고와 overflow 후보를 확인한다.
- preview는 최종 승인 artifact가 아니며 watermark 또는 `미리보기` 상태를 명시한다.
- 최종 검증을 통과하지 않은 preview를 최종 PDF로 다운로드할 수 없다.

미리보기 viewer 라이브러리는 미확정이다. 어떤 viewer를 선택해도 저장된 PDF artifact와 TD-006 좌표 변환·TD-012 locator를 지원해야 한다.

### 10.24 검증 흐름

```text
내보내기 선택
  → 대기 중 자동 저장 flush
  → exact working version snapshot 고정
  → 이미 같은 version의 유효한 full validation이 있으면 재사용
  → 없으면 ReportValidationWorkflow 시작
  → 구조·숫자·근거·레이아웃·PDF 렌더링 검사
  → blocking error 있으면 ValidationPanel
  → warning만 있으면 사용자 확인
  → 모두 통과하면 FinalApprovalDialog
```

#### 검증 상태

`not_run | stale | queued | running | passed | passed_with_warnings | failed | canceled`

검증 중에는 단계, 처리 page 수, 최근 heartbeat와 재시도 상태를 표시한다. 실제 처리량이 없으면 임의 퍼센트를 만들지 않고 단계형 progress를 사용한다.

#### 검사 범위

| 범주 | 주요 검사 | 실패 등급 |
|---|---|---|
| 잔존값 | 이전 분기 기업명·연도·분기·날짜·목표주가·문구 | 차단 |
| 숫자 일관성 | 본문·표·차트·Excel slot의 같은 값 비교 | 차단 |
| 계산 | 합계·증감률·EPS·PER·목표주가 재계산 | 차단 |
| 근거 | 핵심 주장 Evidence·source version·locator 존재 | 차단 |
| 기준일 | `cutoff_at` 이후 source 사용 여부 | 차단 |
| 링크·위치 | 원문 URL·PDF bbox·계산 path 재현 | 차단 |
| 영역 | text·table·chart overflow·clip·z-order | 차단 |
| 스타일 | 폰트·크기·색상·정렬·행간·좌표 | 차단 또는 TD-002 경고 |
| 고정 영역 | fixed·protected object 변경 | 차단 |
| PDF 구조 | qpdf 구조 검사, 검색·선택 가능 text | 차단 |
| 시각 비교 | PDFium 288 DPI와 OpenCV mask별 검사 | 차단 |
| 폰트 | 원본 폰트 부재·대체 영향 | 검토 경고, overflow 발생 시 차단 |

#### ValidationPanel

- 실제 issue를 page·block·slot과 연결해 표시한다.
- `해당 위치에서 수정`은 panel을 닫고 page·block으로 이동한다.
- 숫자 권위 문제는 report text edit를 열지 않고 valuation 또는 validation 단계 이동을 제안한다.
- 해결 후 이전 validation run을 수정하지 않고 새 run을 만든다.
- hardcoded manual checkbox 세 개로 서버 검증을 대체하지 않는다.
- warning 확인 기록에는 사용자, 시각, warning code와 report version을 저장한다.

### 10.25 최종 승인

검증이 `passed` 또는 사용자가 허용 경고를 확인한 `passed_with_warnings`인 exact report version만 승인할 수 있다.

사용자는 다음을 확인한다.

- 숫자와 단위
- 최종 투자의견과 목표주가
- 핵심 지지·반박 근거
- 출처·고지 문구
- 페이지 수·배치·레이아웃

`최종본 확정` 요청 시 서버는 다음을 다시 검사한다.

- 요청 session 사용자와 project 소유자 일치
- report version과 validation run version 일치
- validation이 stale하지 않음
- blocking issue 0건
- edit session에 저장되지 않은 변경 없음
- 같은 version의 중복 승인 요청이 한 번만 적용됨

성공하면 report와 validation snapshot을 불변 `approved` version으로 저장한다. 이후 수정은 새 working version을 만든다. 최종 승인 시간을 클라이언트 시각으로 받지 않는다.

### 10.26 PDF·Excel 내보내기 흐름

#### 산출물

1. 원본 PDF 디자인과 레이아웃을 완전히 복제한 최종 PDF
2. 검증된 실제값과 사용자 추정치가 채워진 Excel 작업 사본

Word·DOCX, PNG page 묶음과 client-side workbook export는 MVP에서 제공하지 않는다.

#### 작업 시작

최종 승인 직후 또는 기존 승인 버전의 `내보내기`에서 export job을 생성한다.

- 요청은 `approvedReportVersionId`, `validationRunId`, `artifactTypes: ["pdf", "xlsx"]`와 idempotency key를 포함한다.
- 서버는 승인 버전과 고정 입력 version을 다시 확인한다.
- Temporal workflow가 PDF와 Excel artifact를 생성·검사·게시한다.
- 화면을 닫아도 job은 계속된다.
- 프로젝트 목록에 `내보내기 중`, `일부 실패`, `내보내기 완료` 상태를 투영한다.

#### 작업·파일 상태

전체 job:

`queued | running | partially_succeeded | succeeded | failed | canceled`

각 artifact:

`pending | generating | verifying | publishing | ready | failed | canceled`

PDF 단계 예:

`RenderPlan 확인 → PDF 패치 → qpdf 검사 → PDFium 288 DPI 검증 → 게시`

Excel 단계 예:

`작업 사본 열기 → 재계산 → 수식·무결성 검사 → XLSX 저장 → 재개방 검사 → 게시`

#### ExportPanel 표시

| 상태 | 카드 UI | 허용 액션 |
|---|---|---|
| `pending`·`queued` | 대기 단계와 요청 시각 | 취소 |
| `generating`·`verifying` | 현재 단계·최근 갱신 | 취소 |
| `ready` | 파일명·크기·생성시각·version | 다운로드 |
| `failed` retryable | 실패 이유와 마지막 시도 | 실패 파일 재시도 |
| `failed` non-retryable | 수정해야 할 입력·단계 링크 | 해당 단계로 이동 |
| `canceled` | 취소 시각 | 새 작업 시작 |
| `partially_succeeded` | 성공 파일은 다운로드, 실패 파일은 재시도 | 파일별 동작 |

실패한 한 파일 때문에 성공한 다른 파일의 다운로드를 숨기지 않는다. 재시도는 성공 artifact를 다시 만들지 않고 같은 승인 입력으로 실패한 artifact만 실행할 수 있다.

#### 재시도

- infrastructure·worker·I/O·timeout 오류만 정책 범위에서 자동 재시도한다.
- 구조·수식·외부 링크·overflow·검증 실패는 자동 반복하지 않는다.
- 사용자 재시도는 새 attempt를 만들고 이전 실패 기록을 보존한다.
- 같은 입력·도구 version의 정상 artifact가 이미 있으면 재사용한다.
- 최종 PDF 생성·검증의 초기 제한시간은 TD-011의 20분을 따른다.

#### 취소

- queued activity와 시작하지 않은 artifact를 취소한다.
- 실행 중 자식 process에 정상 종료 후 grace period를 적용한다.
- partial artifact를 다운로드 가능 상태로 게시하지 않는다.
- 이미 `ready`인 artifact는 취소로 삭제하지 않는다.

### 10.27 다운로드 계약

- download는 서버가 project 소유권과 artifact 상태를 확인한 뒤 짧은 수명의 URL을 발급한다.
- S3 object key를 client에 권한 정보로 노출하거나 영구 URL로 사용하지 않는다.
- URL 만료 시 같은 artifact ID로 새 download URL을 요청할 수 있다.
- 다운로드 응답은 안전하게 정규화한 파일명과 `Content-Disposition: attachment`를 사용한다.
- 파일명에는 기업·대상 기간·산출물 종류·보고서 version을 식별할 수 있는 값을 포함한다.
- 사용자가 반복 클릭해도 export job을 새로 만들지 않고 같은 ready artifact를 내려받는다.
- 다운로드 감사 기록에 사용자, artifact, 시각과 report version을 남긴다.
- 승인 version이 과거 version이어도 해당 artifact를 재현·다운로드할 수 있다.

### 10.28 화면 데이터 모델

#### `ReportBootstrap`

```json
{
  "project": {
    "projectId": "prj_01...",
    "name": "리노공업 1Q26 실적리뷰",
    "companyName": "리노공업",
    "ticker": "058470",
    "targetPeriod": "1Q26",
    "cutoffAt": "2026-05-15T14:59:59Z"
  },
  "report": {
    "reportId": "rpt_01...",
    "status": "working",
    "activeVersionId": "rptv_01...",
    "version": 18,
    "pageCount": 5,
    "validationStatus": "stale",
    "previewStatus": "stale",
    "lastSavedAt": "2026-07-24T12:40:00Z"
  },
  "permissions": {
    "canView": true,
    "canEdit": true,
    "canApprove": true,
    "canExport": false
  },
  "pages": [],
  "activeJobs": []
}
```

실제 응답은 대형 Template IR 전체를 첫 HTML에 넣지 않는다. page view model과 필요한 block·resource를 page 단위로 가져올 수 있다.

#### page·block 최소 정보

| entity | 필수 정보 |
|---|---|
| page | `pageId`, number, label, widthPt, heightPt, rotation, title, blockIds |
| block | `blockId`, role, bbox, permission, contentSchema, revision, slotIds |
| slot | `slotId`, valueType, displayValue, bindingType, provenance summary, required |
| resource | font·image·xobject ID, load URL 또는 render asset, version hash |
| warning | code, page·block·slot, severity, recovery |

### 10.29 클라이언트 상태

| 상태 | 타입 | 권위 |
|---|---|---|
| `mode` | `view | edit` | UI + server edit permission |
| `activePageId` | string | UI |
| `activeBlockId` | string 또는 null | UI |
| `zoomMode` | `fit-page | fit-width | custom` | UI |
| `zoom` | number | UI |
| `saveState` | 10.19 상태 | server response |
| `reportVersion` | number | server |
| `editSession` | session·lease | server |
| `dirtyOperations` | typed operation queue | UI memory |
| `undoStack`, `redoStack` | operation stack | UI memory |
| `openPanel` | evidence·version·preview·validation·export·AI | UI |
| `activeProposalJob` | job summary 또는 null | server projection |
| `activeValidationRun` | run summary 또는 null | server |
| `activeExportJob` | job summary 또는 null | server |

report content 전체를 하나의 React state 문자열이나 DOM snapshot으로 복제하지 않는다. React는 화면 조정 상태를 관리하고, page·block editor model은 전용 report state 계층이 소유한다.

### 10.30 API 계약

API 경로는 애플리케이션 계약이다. 실제 backend framework는 별도 선택할 수 있다.

#### bootstrap·page

| Method | 경로 | 목적 |
|---|---|---|
| `GET` | `/api/projects/:projectId/report` | 권한·선행 조건·active report·job bootstrap |
| `GET` | `/api/projects/:projectId/report/pages/:pageId` | page view model과 block 조회 |
| `GET` | `/api/projects/:projectId/report/versions` | version history 조회 |
| `POST` | `/api/projects/:projectId/report/versions/:versionId/restore` | 과거 version 기반 새 working version 생성 |

#### edit session·저장

| Method | 경로 | 목적 |
|---|---|---|
| `POST` | `/api/projects/:projectId/report/edit-sessions` | active edit lease 발급 |
| `POST` | `/api/projects/:projectId/report/edit-sessions/:sessionId/heartbeat` | lease 유지 |
| `POST` | `/api/projects/:projectId/report/edit-sessions/:sessionId/takeover` | 명시적 편집권 이동 |
| `PATCH` | `/api/projects/:projectId/report/versions/:versionId` | typed operation batch 저장 |
| `DELETE` | `/api/projects/:projectId/report/edit-sessions/:sessionId` | edit session 종료 |

저장 요청 예:

```json
{
  "expectedVersion": 18,
  "editSessionId": "redit_01...",
  "clientMutationId": "uuid",
  "operations": [
    {
      "type": "replace_text",
      "blockId": "p1.story.review",
      "baseBlockRevision": 7,
      "range": { "start": 42, "end": 67 },
      "text": "1분기 실적은 시장 예상에 부합했다."
    }
  ]
}
```

#### AI·표·차트·첨부

| Method | 경로 | 목적 |
|---|---|---|
| `POST` | `/api/projects/:projectId/report/ai-proposals` | text·table·chart proposal job 생성 |
| `GET` | `/api/projects/:projectId/report/ai-proposals/:proposalId` | 상태·diff·검사 결과 조회 |
| `POST` | `/api/projects/:projectId/report/ai-proposals/:proposalId/apply` | 최신 version에 proposal 적용 |
| `POST` | `/api/projects/:projectId/report/imports` | 첨부 upload session과 검사 job 생성 |
| `GET` | `/api/projects/:projectId/report/imports/:importId` | 첨부 처리 상태·미리보기 조회 |

#### 근거·미리보기·검증·승인

| Method | 경로 | 목적 |
|---|---|---|
| `GET` | `/api/projects/:projectId/report/blocks/:blockId/provenance` | Evidence·source·계산 path 조회 |
| `POST` | `/api/projects/:projectId/report/previews` | 특정 version preview job 생성 |
| `GET` | `/api/projects/:projectId/report/previews/:previewId` | preview 상태·artifact 조회 |
| `POST` | `/api/projects/:projectId/report/validations` | full validation run 생성 |
| `GET` | `/api/projects/:projectId/report/validations/:runId` | 단계·issue·artifact 조회 |
| `POST` | `/api/projects/:projectId/report/validations/:runId/acknowledgements` | 허용 warning 사용자 확인 |
| `POST` | `/api/projects/:projectId/report/versions/:versionId/approve` | exact validated version 최종 승인 |

#### export·download

| Method | 경로 | 목적 |
|---|---|---|
| `POST` | `/api/projects/:projectId/report/exports` | PDF·XLSX export job 생성 |
| `GET` | `/api/projects/:projectId/report/exports/:exportId` | 전체·파일별 상태 조회 |
| `POST` | `/api/projects/:projectId/report/exports/:exportId/retry` | 실패 artifact 재시도 |
| `POST` | `/api/projects/:projectId/report/exports/:exportId/cancel` | 미완료 작업 취소 |
| `POST` | `/api/projects/:projectId/artifacts/:artifactId/download` | 권한 확인 후 download URL 발급 |

긴 작업의 최소 구현은 status API polling이다. SSE·WebSocket 등 push transport는 확정 전 선택 사항이며 PostgreSQL 작업 projection이 사용자 표시의 권위 상태다.

### 10.31 공통 API 오류 계약

| HTTP | 오류 코드 | 화면 처리 |
|---:|---|---|
| `400` | `INVALID_REPORT_OPERATION` | 해당 block·입력 근처에 구체적 검증 오류 |
| `401` | `AUTH_REQUIRED` | 현재 URL·의도 보존 후 로그인 |
| `403`·`404` | `PROJECT_NOT_FOUND` | 존재 여부를 숨기는 공통 없음 화면 |
| `409` | `REPORT_VERSION_CONFLICT` | 저장 중단, 최신 version·다른 탭 안내 |
| `409` | `EDIT_SESSION_CONFLICT` | 보기 모드와 편집권 가져오기 제공 |
| `409` | `VALIDATION_STALE` | 최신 version 재검증 |
| `409` | `APPROVAL_VERSION_MISMATCH` | 승인 중단, 변경사항 다시 불러오기 |
| `409` | `EXPORT_ALREADY_EXISTS` | 기존 export job·artifact 열기 |
| `410` | `DOWNLOAD_URL_EXPIRED` | 같은 artifact의 새 URL 발급 |
| `422` | `REPORT_PREREQUISITE_INVALID` | 무효화한 선행 단계와 이동 액션 |
| `422` | `BLOCK_OVERFLOW` | page·block 위치와 축약·직접 수정 안내 |
| `422` | `UNVERIFIED_VALUE` | 첨부값 적용 차단, 검증 단계 이동 |
| `429` | `RATE_LIMITED` | 재시도 가능 시각·자동 재시도 여부 |
| `500` | `REPORT_SAVE_FAILED` | dirty 상태 유지, 같은 mutation ID 재시도 |
| `500` | `REPORT_JOB_FAILED` | 작업 단계·retryable·attempt 표시 |
| `503` | `WORKER_UNAVAILABLE` | 기존 데이터 유지, 지연 재시도 |

서버의 stack trace, 객체 저장소 key, 내부 queue 이름과 원문 접근 credential을 사용자 오류에 포함하지 않는다.

### 10.32 저장 모델과 불변성

PostgreSQL 최소 entity:

| entity | 역할 |
|---|---|
| `report` | project의 논리 보고서와 active working·approved version |
| `report_version` | 입력 version 묶음과 상태를 가진 append-only version |
| `report_page_revision` | page별 revision과 Template IR page 연결 |
| `report_block_revision` | block content·schema·작성 주체·기반 revision |
| `report_edit_operation` | 저장·undo·redo를 재현하는 typed operation |
| `report_edit_session` | 동일 사용자 다중 탭 lease |
| `report_ai_proposal` | prompt·model·output·검사·apply 상태 |
| `report_preview` | preview job·artifact·입력 hash |
| `report_validation_run` | exact version의 검사 결과와 도구 version |
| `report_validation_issue` | page·block·slot별 오류·경고 |
| `report_approval` | 사용자·시각·report·validation version 고정 |
| `report_export` | 승인 version의 export job |
| `report_export_artifact` | PDF·XLSX 파일별 상태와 artifact 연결 |

객체 저장소:

- 원본 PDF·Excel
- report preview PDF
- validation render·diff·mask artifact
- 최종 PDF
- 최종 XLSX
- 허용된 AI 원시 응답·첨부 파생물

원본·승인·최종 artifact는 덮어쓰지 않는다. 새 편집·검증·승인·내보내기는 새 논리 version 또는 attempt를 만든다.

### 10.33 권한·보안 규칙

1. 모든 report·version·job·artifact 요청에서 검증된 Google session과 project owner를 확인한다.
2. client가 전달한 owner ID, `canEdit`, 승인 상태, validation 통과와 artifact key를 신뢰하지 않는다.
3. report block content와 prompt·첨부 파일을 HTML로 실행하지 않는다.
4. paste·AI output·CSV·Excel·OCR text를 허용 schema로 sanitize한다.
5. 업로드 PDF·Excel·이미지·폰트 parser를 web/API process에서 실행하지 않는다.
6. 파일 워커는 TD-011의 non-root·read-only·network 제한을 적용한다.
7. AI 입력에 포함된 문서 문장은 데이터로 취급하고 그 안의 역할 변경·명령을 따르지 않는다.
8. 뉴스·유료 원문은 TD-012 표시·보존 권한을 적용한다.
9. 승인과 export는 CSRF 방어와 idempotency를 적용한다.
10. download URL은 짧게 만료되며 다른 사용자에게 전달돼도 소유권 검사를 우회하지 못해야 한다.
11. test·demo fixture는 실제 애널리스트 개인정보를 사용하지 않는다.

### 10.34 상위 데이터 변경과 재검증

| 변경 | 무효화 대상 | 화면 이동 |
|---|---|---|
| Evidence 정정·충돌 선택 변경 | 관련 문장·표·검증·승인·export | validation |
| Excel 실제값·추정치 변경 | 계산값·표·차트·목표주가·검증 | valuation |
| Target PER·목표주가 변경 | valuation block·검증·승인 | valuation |
| 투자의견·가설 변경 | outline·본문·검증·승인 | hypothesis 또는 report-outline |
| PDF 템플릿·폰트 변경 | page render·preview·validation | files 또는 report |
| MappingSet 구조 변경 | 연결 slot·표·차트·검증 | files 또는 report-outline |
| report text·표현 변경 | preview·full validation·승인 | report 내부 |

기존 승인 버전을 삭제하거나 자동 수정하지 않는다. active working version만 `revalidation_required`로 만들고 사용자가 영향 범위를 확인한 뒤 새 version을 생성한다.

### 10.35 화면에 들어가는 기술과 들어가면 안 되는 기술

| 기술·영역 | 배치 | 판단 |
|---|---|---|
| Next.js App Router | 전용 report route, 서버 권한·bootstrap 경계 | 사용 |
| React Client Component | editor·toolbar·panel·job 상태 | 사용 |
| PostgreSQL | report version·operation·job projection·approval | 사용 |
| S3 호환 저장소 | preview·diff·final PDF·XLSX·첨부 artifact | 사용 |
| Temporal | generation·validation·export workflow | 사용 |
| Python PDF 워커 | PyMuPDF 분석, pikepdf/qpdf 패치, PDFium render | 사용 |
| OpenCV 검증 워커 | TD-008 mask별 시각 검사 | 사용 |
| .NET Excel 워커 | Aspose.Cells 재계산·XLSX 저장·검사 | 사용 |
| PydanticAI | report draft와 AI proposal의 구조화 실행 | 사용 |
| TD-012 Evidence API | 근거·locator·provenance | 사용 |
| SpreadJS | report 기본 bundle | 로드하지 않음 |
| browser client export | PDF·XLSX 최종 생성 | 사용 금지 |
| localStorage | 권위 보고서 본문·승인 상태 | 사용 금지 |
| static public downloads | 사용자 최종 산출물 | 사용 금지 |
| HTML 전체 page 재생성 | 원본 PDF 출력 renderer | 사용 금지 |

SpreadJS는 Excel sheet를 직접 편집하는 valuation 화면의 UI다. report에서 Excel 계산 path를 보여주기 위해 SpreadJS 전체를 로드하지 않는다.

### 10.36 현재 프로토타입과 목표 구현의 차이

| 현재 프로토타입 | 목표 구현 | 우선순위 |
|---|---|---|
| report route가 루트 page 재내보냄 | 소유권·초기 data를 처리하는 전용 App Router route | 필수 |
| pathname 수동 해석·`pushState` | App Router params·Link·router | 필수 |
| 리노공업 5페이지 하드코딩 | Template IR의 실제 page·block·slot | 필수 |
| 항상 저장 완료 표시 | 실제 autosave 상태 | 필수 |
| DOM `contentEditable` 직접 변경 | typed editor operation과 server revision | 필수 |
| undo·redo·zoom 동작 없음 | 실제 command와 page scale | 필수 |
| page 추가 `+` 동작 없음 | 제거, 원본 page count 고정 | 필수 |
| 편집 안내 카드가 page 위에 표시 | 제거, toolbar mode 상태 사용 | 디자인 필수 |
| AI 수정 즉시 문자열 치환 | async proposal·diff·검사·적용 | 필수 |
| CSV client 단순 파싱 | 격리 upload·typed parse·검증 | 필수 |
| 근거 하드코딩 | TD-012 source version·locator·path | 필수 |
| `FinalCheck` 진입 불가 | export 흐름의 실제 ValidationPanel | 필수 |
| 검증 없이 export panel | 저장·검증·승인 후 export | 필수 |
| DOCX·PDF·XLSX 샘플 | 승인 version의 PDF·XLSX artifact | 필수 |
| 정적 `/public/downloads` | 권한 검사 download URL | 필수 |
| 인증·동시성 없음 | owner 권한·edit lease·optimistic version | 필수 |
| 모바일에서 PDF 내부 layout 재배치 | 원본 layout 유지·fit·scroll | 필수 |
| 중복 dead report code | 전용 feature로 분리하며 제거 | 구현 품질 |

### 10.37 필요한 추가 요소·누락 기능

#### 추가한다

- 실제 저장 상태와 저장 실패 재시도
- 검증 상태 indicator와 결과 panel
- version history·과거 version 열기·새 작업 version 만들기
- 같은 사용자 다중 탭 edit session 충돌 안내
- 실제 출력 PDF 미리보기
- 초안 생성·검증·내보내기 작업 상태
- export 파일별 실패·재시도·취소·다운로드
- 승인 version의 읽기 전용 상태와 `새 버전 편집`
- 모바일 page 목록 drawer

#### 기존 요소에 연결한다

- undo·redo
- zoom·페이지 맞춤
- 근거 보기
- 편집 mode
- AI 문장·표·차트 수정
- ValidationPanel 위치 이동
- ExportPanel

#### 제거한다

- 동작 없는 도움말
- 페이지 추가 `+`
- 문서 위 보기·편집 안내 카드
- Word·DOCX 내보내기
- 정적 샘플 download
- 렌더링되지 않는 중복 report document

#### 이번 MVP에 추가하지 않는다

- 공동 편집 cursor·댓글·멘션
- 역할별 승인 workflow
- PDF page 추가·삭제·drag reorder
- 자유로운 font·색상·좌표·크기 편집
- formula·Excel 값의 report 내 직접 수정
- DOCX export
- client-side PDF·XLSX export

### 10.38 구현 배치

목표 frontend 경계:

```text
app/projects/[projectId]/report/page.tsx
  → server session·project·report bootstrap

features/report/
  → ReportWorkspace
  → toolbar·outline·canvas·block editor
  → evidence·AI·version·preview·validation·export panels
  → typed operation·autosave·job status adapters
```

- report 전용 route는 `app/page.tsx`를 재내보내지 않는다.
- 홈·프로젝트·process와 report의 대형 조건부 렌더링을 분리한다.
- server bootstrap과 interactive editor boundary를 분리한다.
- PDF·Excel·Agent 구현을 React component 안에 넣지 않는다.
- Temporal status는 backend projection API를 통해 조회한다.
- page resource는 필요 page 기준으로 지연 로드한다.
- Evidence 원문 viewer와 AI·표·차트 modal은 필요할 때만 로드한다.
- report bundle에 SpreadJS와 전체 PDF·OpenCV·Aspose runtime을 포함하지 않는다.

### 10.39 로딩·빈 상태·오류·예외 처리

| 상황 | 사용자 화면 | 복구 |
|---|---|---|
| bootstrap 로딩 | 헤더·목차·page sheet 크기의 skeleton | 완료 대기 |
| 초안 생성 중 | 생성 단계·page 진행·최근 heartbeat | 화면 이탈 가능 |
| 초안 생성 실패 | 단계·retryable·오류 설명 | 재시도 또는 선행 단계 |
| report page 일부 로드 실패 | 해당 sheet에 오류와 재시도 | 다른 page 유지 |
| 원본 font 없음 | 영향 page·block과 대체 font 경고 | font 등록 후 새 render |
| autosave 실패 | 상단 `저장 실패`, dirty 유지 | 같은 mutation 재시도 |
| offline | `저장 안 됨`, 이탈 경고 | 연결 복구 후 저장 |
| edit session 충돌 | 보기 모드·다른 탭 정보 | 편집권 가져오기 |
| version 충돌 | autosave 중단 | 최신 version reload |
| AI proposal 실패 | 선택 block 유지 | 같은 범위 재시도 |
| 첨부 검사 실패 | 파일별 구체적 원인 | 파일 교체 |
| 근거 locator 실패 | 저장된 인용·metadata 유지 | 원문 재확인 요청 |
| preview 실패 | 편집본 유지 | render 재시도 |
| validation failed | issue list·바로 수정 | 수정 후 새 run |
| export partial failure | 성공 파일 유지 | 실패 파일만 재시도 |
| download URL 만료 | artifact 유지 | URL 재발급 |
| 승인 후 새 상위 데이터 | 과거 승인본 유지·새 버전 stale | 새 working version |

장식·미리보기·원문 panel 실패가 보고서 저장 내용을 지우거나 다른 version으로 바꾸면 안 된다.

### 10.40 반응형·접근성 계약

#### 접근성

- page 목차는 `nav`와 명확한 label을 사용한다.
- active page는 색상 외에 `aria-current="page"`로 표시한다.
- edit toggle은 `aria-pressed` 또는 동등한 state를 제공한다.
- 저장·작업 상태는 과도하게 반복하지 않는 `role="status"` 영역에 표시한다.
- 오류는 page·block과 연결되고 focus 이동이 가능해야 한다.
- modal은 title, focus trap, Escape, focus 복귀를 제공한다.
- resize handle은 `role="separator"`, 방향, 키보드 화살표 조절을 제공한다.
- AI proposal diff는 삭제·추가 내용을 색상만으로 구분하지 않는다.
- chart는 title·description과 핵심 데이터 표 대체를 제공한다.
- 원본 PDF highlight는 텍스트 설명과 locator를 함께 제공한다.
- 키보드만으로 page 이동, 편집, AI 요청, 검증 issue 이동, 승인, 다운로드가 가능해야 한다.
- `prefers-reduced-motion`에서 panel·scroll 전환은 즉시 처리할 수 있다.

#### 모바일

- page 내부를 웹 반응형으로 재배치하지 않는다.
- pinch·browser zoom과 별개인 page fit controls를 제공한다.
- 작은 화면에서도 현재 page number, 편집 상태와 저장 상태를 확인할 수 있다.
- full-width sheet가 열려도 뒤의 editor focus를 차단한다.

### 10.41 구현 순서

1. report 전용 route와 server session·owner·prerequisite bootstrap을 분리한다.
2. report·version·page·block·operation·edit session 저장 모델을 구현한다.
3. 현재 5페이지 UI를 Template IR 기반 page·block view model adapter로 교체한다.
4. structured text editor와 typed operation·autosave·undo·version conflict를 연결한다.
5. 근거 drawer를 TD-012 provenance API와 연결한다.
6. PydanticAI text proposal의 diff·apply 흐름을 연결한다.
7. 표·차트 editor를 upload·검증·mapping proposal과 연결한다.
8. PDF preview workflow와 viewer를 연결한다.
9. ReportValidationWorkflow와 실제 ValidationPanel을 연결한다.
10. 최종 승인과 불변 version을 구현한다.
11. PDF·XLSX export job, 파일별 retry·cancel·download를 구현한다.
12. desktop·tablet·mobile·keyboard·다중 탭·worker 장애 시나리오를 검증한다.

### 10.42 완료 조건

- [ ] 비로그인 사용자는 로그인 후 같은 report URL로 복귀한다.
- [ ] 다른 사용자 프로젝트의 report·version·job·artifact를 조회·수정·다운로드할 수 없다.
- [ ] 선행 단계 미완료·재검증 필요·초안 생성 중·실패 상태가 구분된다.
- [ ] report route가 `app/page.tsx` 재내보내기와 pathname 수동 판정에 의존하지 않는다.
- [ ] 현재 표본의 5페이지가 모두 원본 PDF 레이아웃으로 표시된다.
- [ ] 다른 page count의 프로젝트도 Template IR의 실제 page 수를 유지한다.
- [ ] 보기와 편집 모드는 같은 page layout을 사용한다.
- [ ] 모바일에서도 page 내부 요소를 재배치하지 않는다.
- [ ] 페이지 추가·삭제·규격 변경을 할 수 없다.
- [ ] fixed·protected block은 편집할 수 없다.
- [ ] Excel 연결 숫자를 report 문자열로 직접 바꿀 수 없다.
- [ ] 허용 text 편집이 typed operation으로 저장되고 새로고침 후 복원된다.
- [ ] 저장 중·완료·실패·offline·conflict 상태가 실제 서버 상태와 일치한다.
- [ ] 같은 mutation 재전송이 중복 적용되지 않는다.
- [ ] 동일 사용자 두 탭에서 active editor 충돌이 발생하지 않는다.
- [ ] undo·redo가 저장된 revision과 일관되게 동작한다.
- [ ] AI 문장 수정은 diff 확인 전 본문을 바꾸지 않는다.
- [ ] AI 수정은 숫자·근거·투자의견·가정을 변경하지 않는다.
- [ ] 표·차트 첨부가 격리 검사와 권위 원천 검증을 거친다.
- [ ] 선택 block의 PDF·HTML·API·Excel provenance를 재현할 수 있다.
- [ ] 출력 미리보기는 서버 PDF artifact를 사용한다.
- [ ] report 변경 시 기존 preview·validation·approval 가능 상태가 무효화된다.
- [ ] 최종 검증이 서비스 동작 명세의 모든 검사 범주를 수행한다.
- [ ] fixed·protected·dynamic mask 검증이 TD-008 기준을 따른다.
- [ ] 원본 font 부재는 TD-002 경고로 처리하고 overflow는 차단한다.
- [ ] blocking issue가 있으면 승인·export가 불가능하다.
- [ ] 최종 승인은 exact report·validation version을 불변으로 저장한다.
- [ ] 승인 후 편집은 과거 승인본을 바꾸지 않고 새 working version을 만든다.
- [ ] 내보내기는 PDF와 XLSX만 제공한다.
- [ ] export가 화면 이탈·재접속·worker 재시작 후에도 상태를 복구한다.
- [ ] partial success에서 성공 파일을 다운로드하고 실패 파일만 재시도할 수 있다.
- [ ] 만료 download URL을 artifact 재생성 없이 갱신할 수 있다.
- [ ] 정적 `/public/downloads`와 client export를 사용하지 않는다.
- [ ] report 화면에 SpreadJS·PDF native runtime·Aspose runtime을 bundle하지 않는다.
- [ ] 키보드·screen reader·모션 감소 환경에서 핵심 흐름을 완료할 수 있다.

### 10.43 자동 테스트 시나리오

| 종류 | 시나리오 |
|---|---|
| route | 실제 `projectId` report 직접 진입과 server bootstrap |
| 인증 | 비로그인 후 returnTo 복귀 |
| 보안 | 다른 사용자 project·version·artifact 접근 거부 |
| 선행 조건 | report-outline 미승인·Evidence stale·Excel stale 차단 |
| 생성 | queued→running→ready와 화면 이탈 후 복귀 |
| 생성 장애 | worker 종료·retryable·non-retryable 분류 |
| page | 1·4·5·다른 page count의 실제 page 목록·크기 |
| layout | 보기·편집 mode의 page 좌표·크기 동일 |
| responsive | desktop·tablet·mobile에서 원본 page layout 비재배치 |
| editor | 허용 block 편집·fixed block 편집 차단 |
| editor | 한글 IME·paste sanitize·목록·줄바꿈 |
| autosave | debounce·blur·route 이탈 flush |
| autosave | network 실패 후 같은 mutation ID 재전송 |
| concurrency | stale version 저장 409와 최신 data 보호 |
| concurrency | 두 탭 edit lease·takeover·기존 탭 read-only |
| undo | text·AI·table·chart operation undo·redo |
| AI | proposal queued→ready→diff→apply |
| AI 보안 | prompt injection 문서와 숫자·Evidence 변경 시도 거부 |
| AI stale | proposal 생성 후 block 변경 시 apply 거부 |
| 표 첨부 | CSV quoted field·TSV·XLSX·이미지·악성 파일 |
| 표 권위 | 검증되지 않은 숫자 적용 차단 |
| 차트 | series 길이·단위·실제/추정 범례·네 유형 preview |
| 근거 | PDF page·bbox highlight, 뉴스 Text Fragment fallback |
| 계산 | Excel 입력→formula→report slot provenance 경로 |
| preview | stale→rendering→ready와 같은 hash cache 재사용 |
| validation | 이전 분기 잔존 문자열 검출 |
| validation | 본문·표·차트 숫자 불일치와 EPS·PER 재계산 |
| validation | cutoff 이후 source·locator 누락 검출 |
| validation | `0.25pt`, `0.5pt`, `0.75pt` 좌표 오류 주입 |
| validation | fixed·protected pixel 변경과 dynamic overflow 검출 |
| font | 원본 font 부재 warning과 overflow blocking 분리 |
| approval | stale validation·version mismatch 승인 거부 |
| version | 승인본 불변성과 과거 version 기반 새 working version |
| export | PDF·XLSX 성공과 DOCX 부재 |
| export | PDF 성공·XLSX 실패의 partial success |
| export | 실패 파일만 재시도·중복 요청 idempotency |
| export | cancel·timeout·worker restart·Temporal 복구 |
| download | 만료 URL 재발급·다른 사용자 URL 사용 거부 |
| 접근성 | page nav, modal focus, separator keyboard, issue focus 이동 |
| 회귀 | 기존 report desktop 시각 구조와 5개 page 기준선 |

### 10.44 아직 필요한 제품·기술 결정

두 기준 문서가 아직 확정하지 않은 항목:

1. Google 인증·세션 구현 라이브러리와 만료 정책
2. 구조화 report text editor 라이브러리와 저장 schema
3. edit session lease TTL·heartbeat·편집권 takeover 상세 정책
4. job 상태 갱신의 polling·SSE·WebSocket 선택
5. PDF preview viewer·thumbnail 생성 방식
6. AI proposal에 사용할 model, timeout, 비용 한도와 사용자별 rate limit
7. 빈 텍스트 영역 생성 mode의 MVP 포함 여부
8. report table·chart 첨부 파일별 최대 크기와 이미지 OCR 지원 범위
9. 원본 PDF page가 매우 많을 때 page resource virtualization 기준
10. report version·preview·diff·실패 export artifact의 보존기간
11. 승인 warning 중 사용자가 확인만으로 통과할 수 있는 code 목록
12. 파일명 규칙의 한글·영문 표준과 조직별 표기

TD-001, TD-004, TD-007, TD-008, TD-011과 TD-012의 조건부 확정 항목은 해당 문서의 확정 전환 검증을 완료해야 production 품질 기준으로 사용할 수 있다. 이 불확정 사항이 남아 있어도 이 문서의 소유권, 버전 불변성, PDF·XLSX 산출물, 서버 권위 계산, validation 차단과 기존 레이아웃 보존 원칙은 변경하지 않는다.
