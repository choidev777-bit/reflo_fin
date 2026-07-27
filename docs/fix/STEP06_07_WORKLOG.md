# STEP 06–07 작업 기록 (병합 대비 워크로그)

> 목적: 팀원이 STEP 01–05를, 내가 STEP 06–07을 각각 수정한 뒤 병합할 때
> 충돌을 예측·해소하기 위한 **작업 단위 기록**. 변경할 때마다 이 문서의
> "변경 로그"와 "발견 이슈"에 한 줄씩 남긴다.

## 0. 소유 경계

| 구분 | 담당 | 범위 |
|---|---|---|
| 팀원 | STEP 01–05 | setup · 파일 분석 · 가설 · 자료수집계획 · 검증 (`_phase1`~`_phase4`) |
| 나 | **STEP 06–07** | **PER 밸류에이션(`_phase5`) · 보고서(`_phase6`)** |

STEP 번호 근거: [`docs/REFLO_UI_IMPLEMENTATION_DECISIONS_v1.md`](../REFLO_UI_IMPLEMENTATION_DECISIONS_v1.md) L18–20 (사용자에게 `01–07` 연속 단계).
- STEP 06 = PER 밸류에이션 → [`ValuationScreen.tsx:541`](../../source-react/app/_phase5/ValuationScreen.tsx#L541)
- STEP 07 = 보고서(페이지 내용 설정 + 편집·검증·내보내기) → [`ReportOutlineScreen.tsx:591`](../../source-react/app/_phase6/ReportOutlineScreen.tsx#L591)

## 1. 기준선 (baseline)

- 기준 커밋: `ef6b711` (origin/main "feat: strengthen research validation pipelines"), 로컬 `workspace-dev`를 여기에 정렬함.
- 백업 브랜치(리셋 전 로컬 작업 보관): `backup/pre-main-sync-20260727-195746`
- 테스트: **208 pass / 0 fail / 11 skip** (`npm test`)
- 타입체크: **통과** (`npm run typecheck`) — 단, 아래 캐시 지뢰 1건 선제 제거함.
- DB: origin/main 마이그레이션과 완전 일치(26/26).

## 2. 내가 담당하는 주요 파일 (STEP 06–07)

### STEP 06 밸류에이션
- UI: `source-react/app/_phase5/{ValuationScreen,ValuationWorkbook}.tsx`, `types.ts`
- 도메인: `source-react/server/domain/valuation.ts`
- API: `source-react/app/api/projects/[projectId]/valuation/**`

### STEP 07 보고서
- UI: `source-react/app/_phase6/*`
- 도메인: `source-react/server/domain/report*.ts` (report, report-lineage, report-materialization, report-period-plan, report-pipeline-migration, report-renderer), `report-source-lineage`, `validated-value-normalization`
- 저장소: `source-react/server/infrastructure/repositories/report-repository.ts`
- API: `source-react/app/api/projects/[projectId]/{report,report-outline,report-materializations,report-pipeline}/**`
- 워커: `source-react/workers/control/activities.ts`(report-materialization·report-delivery 큐), `workers/pdf/app.py`

## 3. ⚠️ 충돌 위험 공유/경계 파일 (편집 시 각별히 기록)

| 파일 | 위험 | 메모 |
|---|---|---|
| `source-react/app/globals.css` | **높음** | 전 화면 단일 스타일시트. 팀원도 STEP 01–05 CSS를 여기 추가함. **내 CSS는 명확한 STEP 06/07 주석 블록으로 구분**해 추가하고, 기존 셀렉터는 가급적 수정 대신 확장. |
| `source-react/app/_phase4/ProcessShell.tsx` | 중 | `_phase6`가 import(사이드바/셸). 팀원 소유. 여기 수정이 필요하면 팀원과 조율(내 쪽에서 직접 수정 지양). |
| `infra/migrations/*` | **높음** | timestamp 접두사 충돌 실제 발생함(`202607270021`이 팀원 step05와 내 report_version에서 겹침). **새 마이그레이션은 팀원 것보다 뒤 timestamp로, 접두사 유일성 확인 후 생성**. |
| `contracts/schemas/**`, `source-react/server/domain/generated/**` | 중 | 워커 결과/계약 스키마. 양쪽이 건드리면 충돌. 변경 시 반드시 기록. |
| `source-react/server/infrastructure/repositories/phase4-repository.ts` | 중 | 팀원 영역이나 report materialization 배선이 phase4 경계에 닿는지 리뷰 중 확인 필요. |
| `source-react/app/api/projects/[projectId]/**/route.ts` | 낮음 | 라우트는 STEP별로 분리되어 있어 파일 충돌은 낮음(경로가 다름). |
| `docs/screens/*`, 최상위 명세 문서 | 낮음 | 파일 분리. |

## 4. 변경 로그

| # | 날짜 | 영역 | 파일 | 변경 | 이유 | 충돌위험 |
|---|---|---|---|---|---|---|
| 1 | 2026-07-27 | 빌드캐시 | `source-react/.next/types/validator.ts` (생성물, 삭제) | reset 후 남은 stale 생성 타입 제거 | 존재하지 않는 evidence 라우트 참조로 `typecheck`/`build` 실패 → 지뢰 제거. 소스 변경 아님(생성물). | 없음 |
| 2 | 2026-07-27 | STEP06 백엔드 | `server/infrastructure/repositories/valuation-repository.ts` (approve, complete) | 멱등성 `requestHash`에서 trace-only `requestId` 제거 (V-BE-1) | 명세 §8.19: Idempotency-Key 헤더가 권위, requestId는 추적용. 헤더 재사용+새 requestId 재시도가 409 대신 replay되도록. | 낮음(내 파일) |
| 3 | 2026-07-27 | STEP06 도메인 | `server/domain/valuation.ts` (inverseTargetPer) | 역산 PER 범위밖일 때 목표주가 문구/코드(INVALID_TARGET_PRICE)로 오류 (V-BE-4) | target_price 입력인데 PER 문구 오류가 나던 문제. | 낮음 |
| 4 | 2026-07-27 | STEP06 프런트 | `app/_phase5/ValuationWorkbook.tsx` (편집셀 key) | key에서 `workbookVersion` 제거, `sheetId:address:rawValue`만 사용 (V-FE-1) | 커밋마다 전 편집셀 remount로 다른 셀 진행중 입력·포커스 소실 방지. rawValue 변경 시에만 remount 유지. | 낮음 |
| 5 | 2026-07-27 | STEP06 프런트 | `app/_phase5/ValuationScreen.tsx` (saveDraft/approve/complete) | 각 뮤테이션 시작에 `setCellError("")`, `setLastCellResult(null)` 추가 (V-FE-3, V-FE-5) | 이전 셀 오류/재계산 패널이 이후 성공에도 잔존해 "저장 실패"·stale 버전 오표시되던 문제. | 낮음 |
| 6 | 2026-07-27 | STEP06 프런트 | `app/_phase5/ValuationScreen.tsx` | 뮤테이션 재진입 `mutating` ref 가드 추가 (V-FE-7) | stale `status` 클로저로 더블클릭 시 중복 PUT 방지. | 낮음 |
| 7 | 2026-07-27 | STEP06 프런트 | `app/_phase5/ValuationScreen.tsx` (skeleton) | 세션 오류 시 오류·새로고침 버튼 노출 (V-FE-6) | 세션 fetch 실패 후 무한 skeleton 방지. | 낮음 |
| 8 | 2026-07-27 | STEP06 백엔드 | `valuation-repository.ts` (callExcel) | 워커 4xx는 그대로 전달, 비-4xx만 503 (V-BE-5) | 워커 400/409를 503으로 뭉개던 문제. | 낮음 |
| 9 | 2026-07-27 | STEP06 프런트 | `app/_phase5/ValuationWorkbook.tsx` | 편집셀 input에 `data-row/column` + 경계에서 화살표 셀이동 (V-FE-2) | 화살표로 편집셀 진입·이탈 가능(텍스트 편집 보존). | 낮음 |

## 5. 발견 이슈

정밀 리뷰(도메인+저장소+라우트+UI, 명세 §8 대조)로 도출. 각 항목은 실제 코드로 검증함.

### STEP 06 밸류에이션

| ID | 영역 | 심각도 | 설명 | 상태 |
|---|---|---|---|---|
| V-BE-1 | approve/complete 멱등성 | MED | `requestHash`에 trace-only `requestId` 포함 → 헤더 권위 멱등성 위반(재시도 409). 현재 프런트는 requestId=key라 가려져 있으나 계약 위반. | ✅ 수정(변경로그 #2) |
| V-FE-1 | ValuationWorkbook 편집셀 key | MED | key에 `workbookVersion` 포함 → 커밋마다 전 셀 remount, 다른 셀 진행중 입력·포커스 소실. | ✅ 수정(#4) |
| V-FE-3 | ValuationScreen cellError | LOW-MED | `cellError`가 이후 성공(draft/approve/complete)에 안 지워져 "저장 실패" 오표시. | ✅ 수정(#5) |
| V-FE-5 | ValuationScreen lastCellResult | LOW | 재계산 패널이 안 지워져 stale 버전·무효화 경고 잔존. | ✅ 수정(#5) |
| V-BE-4 | valuation.ts inverseTargetPer | LOW | 유효 목표주가가 범위밖 PER 산출 시 PER 문구 오류 반환. | ✅ 수정(#3) |
| V-BE-2 | valuation-repository calculateAndSave | MED | Excel 워커 HTTP(≤120s) 호출이 DB 트랜잭션+row lock 안에서 실행 → 동시편집 시 커넥션 풀 고갈 위험(`ensureWorkbook`은 워커콜을 트랜잭션 밖에서 함). | ⏳ 다음 배치(구조 변경, 신중 검증 필요) |
| V-BE-3 | valuation-repository inputFingerprint | MED-LOW | `priceSnapshotId`가 fingerprint에 포함돼, 스냅샷 변경 시 workbook을 source에서 재빌드하며 forecast 입력 유실. MVP는 스냅샷 불변(TD-021)이라 사실상 도달불가한 잠재 결함. | ⏳ 문서화/잠재 |
| V-FE-2 | ValuationWorkbook 키보드 네비 | MED | 화살표 이동이 편집셀 진입·이탈 불가(`data-row/column`이 read-only 버튼에만). Tab은 동작하므로 조작 자체는 가능. | ⏳ 다음 배치(a11y) |
| V-FE-4 | ValuationScreen 목표주가 입력 | LOW | 매 키 입력마다 천단위 재그룹핑 → 중간 자리 수정 시 커서가 끝으로 점프. | ⏳ 다음 배치 |
| V-FE-6 | ValuationScreen 세션 오류 | LOW | 서버 guard 통과 후 클라 세션 fetch가 오류나면 무한 skeleton(재시도 없음). | ⏳ 다음 배치 |
| V-BE-5 | valuation-repository callExcel | LOW | 워커의 비-422 오류를 503으로 뭉갬(서버 사전검증으로 실제 발생 드묾). | ⏳ 다음 배치 |
| V-FE-7 | ValuationScreen saveDraft | LOW | 재진입 가드가 stale `status` 클로저 → 빠른 더블클릭 시 중복 PUT 가능(백엔드 draft 멱등 여부에 의존). | ⏳ 다음 배치 |
| V-BE-6 | GET workspace 응답형태 | LOW/info | `valuationDraft.approvedVersion` 누락(별도 `approval` 객체 제공, 프런트는 그걸 사용). 계약형태 편차이나 무해. | 문서화(스킵 예정) |

**2차 배치 결과(2026-07-27):** V-FE-2·V-FE-6·V-FE-7·V-BE-5 = **수정 완료**(변경로그 #6–9, 테스트 208 pass·타입 clean 재확인). 아래는 미수정 처리:
- **V-FE-4** (목표주가 커서 점프, LOW): 보류. group-on-blur 또는 커서 위치 보존 필요(UX 트레이드오프). 저우선.
- **V-BE-2** (Excel 워커 호출이 DB 트랜잭션+row lock 내부 실행, MED): **미수정(문서화)**. 트랜잭션 경계 재구성은 원자성 리스크 커서 신중 필요. 권장: `ensureWorkbook`처럼 워커 호출을 트랜잭션 밖에서 수행 후 트랜잭션 내에선 expected-version 재검증+기록만. 로컬 단일사용자 MVP 영향 낮음(동시 편집 부하 시 커넥션 풀 고갈 위험).
- **V-BE-3** (priceSnapshotId fingerprint로 source 재빌드 시 forecast 유실, MED-LOW): 문서화. TD-021상 스냅샷 불변이라 도달 어려움. 권장: source-rebuild 판정용과 approval-무효화용 fingerprint 분리.
- **V-BE-6** (GET workspace가 `valuationDraft.approvedVersion` 누락, LOW/info): 스킵(프런트는 별도 `approval` 객체 사용, 무해).

미구현(명세 gap, MVP 범위 밖 가능성): `429 RATE_LIMITED` 미구현, 역산 PER 2자리 미리보기 표시 없음, 민감도 오류를 modal 내부 대신 요약 영역 표시, current price 없음을 in-page 상태 대신 선행조건 409로 처리.

### STEP 07 보고서

리뷰 에이전트 4개(도메인·저장소·프런트·워커+라우트). **프런트 완료**, 나머지 3개 진행 중. `ReportOutlineScreen`은 방어적으로 잘 작성됨. 결함 대부분은 `ReportWorkspace.tsx`(비방어적).

| ID | 파일:라인 | 심각도 | 설명 | 상태 |
|---|---|---|---|---|
| R-FE-1 | ReportWorkspace.tsx:192-213 | **HIGH** | 하트비트가 일시 실패 1회에 `setEditSession(null)`로 편집 종료+서버 lease 미해제 → 재편집 409, 자기 소유 stale lease라 takeover 배너도 안 뜸 → **편집 잠금**. | 🔍 검증→수정 중 |
| R-FE-2 | ReportWorkspace.tsx:329,335,386 | MED | lease 소실 시 `persistText` 큐가 early-return하며 `saveState`를 "saving"에 고정 → 내보내기 영구 비활성. | 대기 |
| R-FE-3 | ReportWorkspace.tsx:161-181 | MED | `loadWorkspace` sequence/abort 가드 없음 → 겹친 reload가 옛 snapshot으로 덮어씀(phase5 load엔 가드 있음). | 대기 |
| R-FE-4 | PdfPreview.tsx:19-52 | MED | 렌더 task cancel 안 함 → 빠른 zoom 시 pdf.js "same canvas" 에러로 미리보기 고착(ReportPdfEditor는 올바르게 cancel). | 대기 |
| R-FE-5 | ReportWorkspace.tsx:462-501 | MED | `openPreview`가 시작 시 previewUrl/warnings 리셋 안 함+버튼 in-flight 가드 없음 → stale 미리보기·중복 폴링. | 대기 |
| R-FE-6 | ReportWorkspace.tsx:386,653 | MED | persistText/applyAiProposal 성공 시 `error` 배너 미해제 → 성공 위에 옛 오류 잔존. | 대기 |
| R-FE-7 | ReportWorkspace.tsx:747-763 | MED | approved 보고서에서 jobs.validation 미하이드레이션 시 불변 승인본을 재검증·재승인. | 대기 |
| R-FE-8 | ReportWorkspace.tsx:408-422 | LOW | undo/redo가 closure에서 stack `.at(-1)` 읽어 더블클릭 시 history 손상. | 대기 |
| R-FE-9 | ReportPdfEditor.tsx:136 / PdfPreview.tsx:45 | LOW | 렌더 일시 실패 시 canvas 대신 error div → 복구 불가. | 대기 |
| R-FE-10 | ReportWorkspace.tsx:905-994 | LOW | save로 preview stale 시 `showOriginal` 미리셋 → 새 preview가 원본으로 표시. | 대기 |
| R-FE-11 | ReportWorkspace.tsx:621-709 | LOW | AI proposal이 `workspaceRef` 대신 render `workspace`에서 버전 읽음 → 자동저장 직후 spurious version conflict. | 대기 |
| R-FE-12 | ReportWorkspace.tsx:225-234 | LOW | pending 재진입 가드가 state closure(더블클릭 시 편집세션 중복 POST 409). | 대기 |
| R-FE-13 | ReportWorkspace.tsx:362-380 | LOW | persistText가 `result.pages` 통째 적용 → 동시 편집 중인 타 블록의 미전송 편집 일시 되돌림(최종 일관). | 대기 |

미구현(명세 gap): `ReportTextEditor.tsx`(tiptap)가 dead code(실제 편집은 textarea), main-canvas zoom/fit 없음, export 부분실패 재시도/취소 없음, ValidationPanel 이슈 내비 없음, passed_with_warnings ack 없음.

**워커+라우트 리뷰(완료):**

| ID | 파일:라인 | 심각도 | 설명 | 상태 |
|---|---|---|---|---|
| R-WK-1 | report-repository.ts:5290-5304 ↔ workers/pdf/app.py:2631-2643 | **HIGH** | `regionTokenHash`(TS: span텍스트+bbox순) vs `source_region_token_hashes`(PY: 단어분할+PDF block/line/word순) 정규화 불일치 → 모든 데이터바인딩 커맨드에서 TOKEN_HASH_MISMATCH 422 → **벡터 렌더/미리보기/내보내기 전체 실패**(텍스트 전용만 동작). 올바른 구현+테스트가 백업 994281d(사용자 WIP)에 존재, 리셋으로 유실. 현재 `regionTokenHash`는 export도 안 됨(재작성 흔적). | 🔍 검증→수정 중 |
| R-RT-1 | report/** child ID 라우트 다수 | LOW | exportId/proposalId 등 비-UUID path param 미검증 → PG 22P02 → 400/404 대신 500. | 문서화 |

워커/라우트에서 auth(31개 라우트)·SVG 위생·렌더 응답 계약·export 멱등성/상태머신·Temporal determinism은 **정상** 확인됨.

**저장소 리뷰(완료):**

| ID | 파일:라인 | 심각도 | 설명 | 상태 |
|---|---|---|---|---|
| R-RE-1 | (= R-WK-1) | HIGH | 토큰 해시 불일치 — 저장소 에이전트도 WIP 테스트 대조로 독립 확인. | ✅ 수정(#11) |
| R-RE-2 | report-repository.ts:1761,2142,2180 | MED | `suggestReportOutline`(LLM ≤120s)가 DB 트랜잭션+row/advisory lock 안에서 실행(regenerate/ensureOutline). materialization 경로는 올바르게 밖에서 호출. | 대기(권장: 트랜잭션 밖으로) |
| R-RE-3 | report-repository.ts:4777,4915 | LOW-MED | `patchReportVersion` 멱등 replay가 compacted(비하이드레이트) pages 반환 → 재시도 시 materializedData 없는 블록. | 대기 |
| R-RE-4 | report-repository.ts:352-378 | LOW | `resolvedTemplatePages` PDF `/inspect`(≤120s)가 소스 해시 drift 시 트랜잭션 내 실행(잠재). | 대기 |
| R-RE-5 | report-repository.ts:4934,6342,6573,6717 | LOW | `projectContext`가 lock/replay보다 먼저 → 선행조건 회귀 시 재시도가 replay 대신 409. | 대기 |
| R-RE-6 | report-repository.ts:4619-4652 | LOW | `takeoverReportEditSession`가 잘못된 sessionId 시 유효 lease까지 만료(동일사용자 멀티탭 lease 탈취). | 대기 |

저장소에서 V-BE-1(멱등성)류 미존재·ownership 404·snapshot/lineage·SQL injection 없음 **정상** 확인.

**도메인 리뷰(완료):** HIGH 없음(견고). 전부 LOW/관찰:

| ID | 파일:라인 | 심각도 | 설명 | 상태 |
|---|---|---|---|---|
| R-DM-1 | report-lineage.ts:94 / report-materialization.ts:295 / report-pipeline-migration.ts:38 | MED-LOW | fingerprint/hash 입력 배열을 로케일 미지정 `localeCompare`로 정렬 → collation 차이 시 해시 불일치(ASCII 키라 실trigger 낮음). 권장: code-point 비교. | 대기 |
| R-DM-2 | report.ts:4111 | LOW | 파일명 `{YYYYMMDD}`를 UTC(`toISOString`)에서 추출 → KST 00~09시 승인은 전날. 파일명만. | 대기 |
| R-DM-3 | report.ts:1375 | LOW | table `columnWidthsPt` fallback `64`(px)를 pt 필드에(폭 없는 열 ~33% 넓음). | 대기 |
| R-DM-4 | report.ts:1098-1122 | LOW | `canonicalScalarMetric` 축약(forward_eps→eps)로 변형 공존 시 오바인딩 가능(현 배선상 미발생, 잠재). | 대기 |
| R-DM-5 | report.ts:3316 | LOW | authoritative EPS/금액을 `Number().toLocaleString` 표시(>3자리 반올림/NaN). fixed·비편집, 진짜 값은 snapshot 보존. | 대기 |

## 5.05 STEP 05 → 06 진입 차단 (2026-07-28, 수정 완료)

사용자 재현: STEP 05에서 `다음`이 진행되지 않고 빨간 배너
`EPS·PER·목표주가 mapping을 모두 확인해주세요.` 표시.

| ID | 위치 | 심각도 | 설명 | 상태 |
|---|---|---|---|---|
| X-1 | `workers/control/mapping.ts` ↔ `workers/pdf/app.py:1876` | **BLOCKER** | 밸류에이션 출력 slot(`eps`·`per`)이 template IR에 생성되지 않아 mapping entry 자체가 없음 → `loadRequiredWorkbookOutputBindings`가 `[]` 반환 → `prepareValidatedWorkbook` 409. **로컬 mapping set 103건 전부 해당**(프로젝트 고유 문제 아님). | ✅ 수정 |
| X-2 | `app/api/projects/[projectId]/validation/workbook-applications/route.ts` | MED | `start_workflow` outbox 이벤트만 남기고 `kickOutboxDispatcher()` 미호출 → workbook application이 최소 60초(control worker reconciliation 주기) 동안 `queued` 정체. UI 폴링 상한이 660초라 영구 실패는 아니고 체감 지연. 동일 패턴 라우트 19개 중 이 라우트만 누락(전수 조사함). | ✅ 수정 |

### X-1 원인

`mapping_entry`는 **PDF template IR의 slot과 1:1**로 생성된다
([`file-repository.ts:4198`](../../source-react/server/infrastructure/repositories/file-repository.ts#L4198)).
그런데 PDF 분석기는 표(data region) 안에 있는 span을 scalar 후보에서 제외한다
([`workers/pdf/app.py:1880`](../../workers/pdf/app.py#L1880)). 국내 리서치 보고서는
`EPS`·`PER`을 Key Data·투자지표 **표 안에** 인쇄하므로 두 slot이 영구 미생성.
`목표주가(12M)`·`현재주가(1.29)`는 표 밖이라 slot이 생겼고, 그래서 셋 중 하나만 매핑됨.

DB로 확인: 대상 template IR slot 18개 중 `eps`·`per` 없음, `target_price`만 존재.

### X-1 수정

[`server/domain/valuation-output-slots.ts`](../../source-react/server/domain/valuation-output-slots.ts) 신설.
template IR에 없는 밸류에이션 출력 metric을 **workbook 전용 합성 슬롯**으로 보완한다.
template IR 자체는 건드리지 않는다(PDF 렌더링·블록 구조 불변).

- `workers/control/mapping.ts` — `buildMappingSet`이 합성 슬롯까지 후보·binding 산정.
  기존 `LEGACY_ISC_WORKBOOK_PROFILE.cellHints`가 `eps→M2!C10`, `per→M2!C7`을 이미
  갖고 있어 `DOCUMENTED_MODEL_CONTRACT` 0.99로 자동 확정된다.
- `file-repository.ts` — 같은 합성 슬롯을 mapping entry로도 저장.
- **`required: false`**로 둔 이유: `true`면 EPS/PER 셀을 못 찾는 workbook에서 STEP 02
  적합성 검사가 막혀 **기존 잠금을 더 이른 잠금으로 옮기는 셈**이 된다. 대신 entry가
  생기므로 사용자가 STEP 02 매핑 화면에서 셀을 직접 지정할 수 있고, 미해결 시
  `VALUATION_OUTPUT_MAPPING_UNRESOLVED` 경고로 드러난다.

### 기존 데이터 백필

[`scripts/backfill-valuation-output-mappings.ts`](../../source-react/scripts/backfill-valuation-output-mappings.ts).
mapping entry는 분석 시점에 만들어지므로 신규 코드만으로는 기존 프로젝트가 계속 막힌다.
`--apply` 없이 실행하면 dry-run. 로컬에서 **80건 보완 완료**.

### 라이브 검증 (실제 DB·워커, 대덕전자 `019fa44d`)

1. 재현: `prepareWorkbookWriteProposals` → `409 WORKBOOK_REQUIRED_OUTPUT_MISSING` ✅
2. 수정 후: 제안 18건 생성 → 전건 승인 → workbook application **succeeded (18 cell 반영, 0 blocked)**
3. `completeValidation` → `200`, `nextRoute: /process/valuation`
4. STEP 06 workspace 정상 로드, Excel 재계산 성공:
   - Forward EPS `3,033` (M2!C10) · Target PER `26.58x` (M2!C7) · 목표주가 `81,000` (M2!C21)
   - 현재주가 `109,500` (KRX 2026-07-24)
5. stage 상태: setup·files·hypothesis·research_plan·validation = **completed**,
   valuation = in_progress, report_outline = 선행 대기.

### 남은 STEP 06 사용자 입력 (버그 아님)

`REQUIRED_INPUT_MISSING`은 실제로 **비어 있는 필수 입력 93셀** 때문이며 설계된 흐름이다
(`mapping-data-readiness`: "전망값은 Excel 입력 단계에서 확정"). 시트별 미입력:
대차대조표 30 · 투자지표 27 · 현금흐름표 20 · 손익계산서 11 · M1 모델 4 · M2 1.
애널리스트가 전망값을 입력해야 승인·완료가 열린다.

### STEP 07 영향 없음 확인

`templateMaterializationBindings`는 **template slot만 순회**하고, eps/per/target_price/
current_price scalar은 `valuation_approval`·`market_price_snapshot` binding을 우선한다.
합성 슬롯에 대응하는 template slot이 없으므로 보고서 렌더링에 새 블록이 생기지 않는다.

### X-3 `다음` 버튼이 명세와 다르게 개별 승인을 요구 (2026-07-28, 수정 완료)

X-1 수정 후 오류 문구는 사라졌으나 `다음`이 여전히 비활성.
원인은 mapping이 아니라 **footer gate 조건**이었다.

`ValidationScreen.tsx`의 `writeReviewComplete`가 **모든 Excel write proposal이
개별 결정(approve/modify)되어야** `다음`을 활성화했다. 실제로는 필수 제안 18건이
전부 `proposed`("반영 예정") 상태 → 영구 비활성.

명세 위반:

- [`07-validation.md:483`](../screens/07-validation.md) — "`다음` 클릭이 현재 validation version **전체 승인 행위**다."
- [`07-validation.md:484`](../screens/07-validation.md) — "**사용자는 정상 결과를 일일이 승인할 필요가 없다.**"
- [`07-validation.md:560`](../screens/07-validation.md) VAL-NEXT-01 — gate 조건은 `stageGate.canProceed`뿐

게다가 승인 UI(`원안 승인`·`수정값 승인`·`거절`)는 원문 패널 안, DART 표와 `dl`
아래에 중첩 렌더링되어 18건을 각각 행 선택 → 스크롤 → 클릭해야 했다.

**수정** ([`ValidationScreen.tsx`](../../source-react/app/_phase4/ValidationScreen.tsx)):

- `writeReviewComplete` → `writeReviewReady`. 차단 사유는 `blockers`와
  **사용자가 명시적으로 거절한 필수 제안**만으로 한정.
- `complete()`가 미결정(`proposed`) 제안을 일괄 승인한 뒤 application을 생성.
  사용자가 이미 수정·거절한 제안은 건드리지 않는다.
- 감사 기록 사유를 `검증 버전 승인 시 일괄 반영 · 원문 대조 검증 통과`로 남겨
  개별 검토와 구분되도록 했다(개별 결정 기능 자체는 유지).

**라이브 검증** (신규 프로젝트 `019fa4c7`, 사용자가 18:12에 새로 생성):
제안 18건 일괄 승인 → application **succeeded (18 cell, 0 blocked)** →
`completeValidation` 200 → STEP 06 재계산 성공(EPS 3,033 · PER 26.58x · 목표주가 81,000).
stage: validation=completed, valuation=in_progress.

### X-4 승인 완료 후 `다음` 재클릭이 500 (2026-07-28, 수정 완료)

증상: 새로고침 후 STEP 05에서 `다음`을 눌러도 5단계에 머무름. 사이드바에서는
6단계가 열려 있어 그쪽으로는 진입 가능.

원인: `completeValidation`이 이미 승인된 검증 버전에 대해 `validation_approval`을
**무조건 INSERT** → `validation_approval_project_id_validation_version_key`
unique 위반(PG 23505) → 500. 사이드바가 열린 건 stage가 실제로 완료됐기 때문이라
정상.

상단의 `idempotentReplay`는 **같은 `Idempotency-Key`일 때만** 동작하는데
UI는 클릭마다 `crypto.randomUUID()`로 새 키를 만든다
([`ValidationScreen.tsx`](../../source-react/app/_phase4/ValidationScreen.tsx))
→ 재클릭은 replay로 잡히지 않는다.

**수정** ([`phase4-repository.ts:completeValidation`](../../source-react/server/infrastructure/repositories/phase4-repository.ts)):
workspace/version 확인 직후 해당 버전의 기존 `validation_approval`을 조회해
있으면 그 승인 결과를 200으로 그대로 반환(+ 현재 키로 idempotency 기록).
명세 §7.4 "이미 validation 승인 완료 → 승인 버전 읽기 전용 표시, 후속 단계 이동 가능"과 일치.

승인 뒤 결과가 바뀌면 새 validation version이 생기므로(명세 L487)
`validation_version` 불일치 → 기존 `STALE_VALIDATION_VERSION` 409 경로가 그대로 동작한다.

**동일 결함 전수 조사 (project 범위 unique 제약 보유 승인 테이블):**

| 테이블 | 재실행 안전성 |
|---|---|
| `validation_approval` | ❌ → ✅ 수정 |
| `valuation_approval` | ✅ `approval_version = previous + 1` + 기존 승인 supersede |
| `report_outline_approval` | ✅ INSERT 전 `outline_resource_version_id`로 기존 승인 조회 |
| `stage_completion` | ✅ `completion_no = previous + 1` |

STEP 05만 가드가 빠져 있었다.

**라이브 검증**: 승인 완료 상태(`019fa4c7`)에서 `다음` 클릭 경로 재실행 →
`complete 200` + `nextRoute: /process/valuation` 정상 반환.

### X-5 STEP 06 `Target PER 반영`·`목표주가 반영`이 STEP 02로 튕김 (2026-07-28, 수정 완료)

증상: STEP 06에서 두 버튼 중 아무거나 누르면 화면이 STEP 02
`PDF - Excel 연결 확인` modal로 이동.

원인: `updateValuationDraft`가 `MAPPING_REVALIDATION_REQUIRED` 409를 던지고
meta에 `resumeRoute: /process/files`가 실려 있어
[`ValuationScreen.tsx:138`](../../source-react/app/_phase5/ValuationScreen.tsx#L138)의
`routeError()`가 `router.replace`로 이동시킨다. **매핑이 실제로 깨진 게 아니라
Target PER 입력 셀 탐색이 실패**한 것이다.

Target PER 출력 셀(M2!C7) 수식:

```
IF($C$30="Peer 평균 P/E",$C$41,IF($C$30="보고서 원문 P/E",$C$32,$C$31))
```

| 대상 | 실제 셀 | 기존 코드가 찾던 것 | 결과 |
|---|---|---|---|
| 밸류에이션 방식 선택 | `C30` (string) | 정규식 `IF\(\s*([A-Z]{1,3}[1-9]\d{0,6})\s*=` — **절대 참조 `$C$30`을 못 읽음** | `null` |
| 직접 입력 P/E | `C31` (decimal, 편집 가능) | `previousRowAddress("C7")` = `C6` = `적용 EPS 스위치`(string) | 불일치 |

둘 다 실패 → `if (!targetCell || !modeCell)` → 409. 두 버튼 모두 이 코드 경로를
공유하므로 증상이 동일했다.

**수정** ([`valuation-repository.ts`](../../source-react/server/infrastructure/repositories/valuation-repository.ts)):
`targetPerFormulaCells()` 신설. 출력 셀 수식에서

- 방식 선택 셀 = 첫 IF 조건의 참조(절대 참조 `$` 허용, 대소문자 무관)
- 직접 입력 셀 = 중첩 IF의 **마지막 else 분기** 참조

를 뽑는다. 문자열 리터럴은 먼저 제거해 `"Q1 기준"` 같은 값을 셀 참조로 오인하지
않게 했다. 수식에서 못 찾으면 기존 `previousRowAddress` 휴리스틱으로 폴백해
구형 레이아웃 호환을 유지한다.

**검증**: 수정 후 같은 호출이 409를 넘어 Excel 재계산까지 도달.
현재는 `422 FORMULA_CALCULATION_FAILED`(`#DIV/0!` — 빈 필수 추정 셀 때문)로 끝나며,
이 오류에는 `resumeRoute`가 없어 **화면 이동 없이 오류만 표시**된다(정상).
회귀 테스트 4건 추가(`tests/phase5-domain.test.ts`).

## 5.1 환경 인시던트 (코드 변경 아님)

- **워커 이미지 skew (2026-07-27):** origin/main 리셋 후 소스는 `hypothesis-v4`/`gpt-5.4-mini`인데 실행 중 Docker 워커는 리셋 이전(17:31 빌드) 이미지라 `hypothesis-v2`/`gpt-5.6-terra`를 기대 → "AI 질문 만들기"가 `LLM worker 422`로 실패. 원인은 리셋 후 워커 미재빌드. **`npm run db:up`(--build)로 6개 워커 재빌드**하여 해소(LLM health `promptVersion: hypothesis-v4` 확인, 데이터 볼륨 보존). 교훈: **소스 브랜치 변경 후에는 반드시 워커 재빌드.** (워크로그 3장 충돌표에도 반영 대상)

## 5.2 교차 경계 발견 — 팀원(STEP 01-05) 전달용

내 영역이 아니라 수정하지 않음. 정확한 위치만 전달:

- **phase3 back-nav 무반응 (`_phase3/HypothesisScreen.tsx`) — 사용자 재현 확인(2026-07-27):** 투자의견 설명 필드가 **비어 있으면** `이전`·사이드바·`프로젝트로` 이동이 막히고, **내용이 있으면 정상 이동**. 원인: 셋 모두 `navigateAfterSave()`(L442)를 거치는데 `saveState`가 dirty/error면 `flushSave()` 실패 시 **조용히 `return`**(이동 차단·오류 미표시). 필수 필드가 비면 저장이 통과 못 해 nav가 막히는 것으로 추정. **되돌아가기(스텝 이탈)는 필수값과 무관하게 허용돼야 함** → phase3 UX 버그. 팀원 확인 필요(내 영역 아님, 미수정). 우선순위 낮음(사용자 지시).

## 6. 병합 시 체크리스트

- [ ] 병합 전 `git fetch` 후 팀원 브랜치와 이 워크로그의 "충돌 위험 파일" 대조.
- [ ] `globals.css`는 STEP 06/07 주석 블록만 취하고 나머지는 팀원 것 유지.
- [ ] 마이그레이션 timestamp 접두사 유일성 재확인.
- [ ] 병합 후 `npm run typecheck && npm test` 재실행.

## 5.1 STEP 06 → 07 실사용 관통 점검 (2026-07-28)

대덕전자 `019fa4c7`에서 STEP 06 전망값 입력부터 STEP 07 PDF 내보내기까지
실제 API·워커·DB로 끝까지 실행하며 막히는 지점을 전부 고쳤다. 마지막 검증은
전 구간을 **한 번에 재실행**해 통과했다(아래 §5.4).

### X-6 Excel roll-forward 결함 5건 (workers/excel, 수정 완료)

| ID | 증상 | 원인 | 수정 |
|---|---|---|---|
| E-1 | `14_p4_투자지표` F13·F20이 빈 필수 입력으로 잡힘 | 표 안에 다시 나오는 기간 헤더 행(`구분 \| 2023 \| … \| 2027F`)을 데이터로 보고 왼쪽으로 밀어 마지막 칸의 연도 라벨을 지움 | `IsPeriodHeaderRow`로 감지해 `ApplyPeriodHeaders` 적용 |
| E-2 | 섹션 제목 행(`주가지표(배)`)의 빈 칸이 입력칸으로 칠해짐 | 기간 열이 통째로 빈 행도 데이터 행으로 처리 | `IsBlankPeriodRow` 가드 + `MarkForecastInput` |
| E-3 | `M1!B36·C36`, `투자지표!B34·C34` 값이 한 해 어긋남 | `CarryValue`가 **이동 후** 재계산된 수식 값을 옮김(행 36이 이미 이동한 행 35를 참조) | `WorkbookSnapshot`으로 이동 전 값 고정 |
| E-4 | `M1` 연간 헤더가 `2024 \| 2026 \| 2027 \| 2028 \| 2028`로 깨짐 | `RollAnnualTables`가 민 5개 연도 표를 `RollModelForecastInputs`가 다시 3개 연도로 밀어 헤더 2중 적용 | `annualHeaderRanges` 겹침 검사로 재이동 차단 |
| E-5 | 손익계산서 2026 영업이익이 2025 값(49.1)으로 표시 | `M1`의 `② 영업이익`·`③ 세전이익` 블록이 빈 행 뒤에 있어 `FindTableBottom`에서 잘림 | `LastRowWithForecastInput`으로 입력칸이 있는 마지막 행까지 이동 |

추가로 **STEP 06 전체를 막던 결함 2건**:

- **E-6 `#DIV/0!`로 모든 재계산 실패**: `RollModelForecastInputs`가 연간 열이
  원래 비어 있던 행(`QoQ`)에도 분기 전용 수식을 옮겨 심어 `=J16/M44-1` 같은
  참조를 만들었다. 값이 있던 열만 수식화하도록 제한.
  → 이전 워크로그가 "빈 필수 셀 때문"으로 적었던 `422 FORMULA_CALCULATION_FAILED`의
  실제 원인이다.
- **E-7 숫자 칸에 숫자를 못 넣음**: `EditableValueType`이 "비어 있고 서식이
  General"인 셀을 `string`으로 판정해 EPS·BPS 등 6개 칸이 `CELL_VALUE_TYPE_MISMATCH`
  422를 냈다. 같은 행·열의 숫자 이웃을 보고 `decimal`로 판정하도록 수정.

회귀 테스트 4건 추가(`Reflo.ExcelWorker.Tests`, 총 14건 통과).
**워커 이미지 재빌드 필요**(`node scripts/compose-local.mjs up -d --build excel-worker`).

### X-7 M2!C40(선택 Peer 슬롯)이 승인을 막음 (수정 완료)

`Peer 평균 P/E = SUM($C$35:$C$40)/COUNT($C$35:$C$40)`이라 비워도 정상 계산되는
선택 항목인데 `REQUIRED_INPUT_MISSING`으로 STEP 06 승인이 막혔다.
워커는 편집 가능 셀의 `required`를 무조건 `true`로 넣으므로 판정은 TS 쪽에 있다.

[`valuation-repository.ts`](../../source-react/server/infrastructure/repositories/valuation-repository.ts)
- `columnPeriodLabel` — 같은 열 위쪽의 기간 헤더를 찾는다.
- `hasBlankIntolerantDependent` — 그 셀을 참조하는 수식이 전부 집계 범위
  (`SUM`·`COUNT`·`AVERAGE` 등) 안이면 비워도 되는 셀로 본다.
- `reportRequiredCell` = 기간 열 값이거나, 빈 값을 못 견디는 수식이 참조하는 셀.
  `missingRequiredCells`와 `blank` 변경 허용 판정이 이 함수를 공유한다.
  → 덤으로 **어떤 셀도 지울 수 없던 문제**(모든 `blank` 변경이 422)도 해소.
- `isDataRow` — 연도 라벨이 3개 이상인 행은 헤더로 본다(끝에 `비고` 열이 붙어도).

### X-8 STEP 07을 막던 결함 6건 (수정 완료)

| ID | 증상 | 원인 | 수정 |
|---|---|---|---|
| R-1 | 페이지 확인이 영구 불가 | `reviewReportOutlinePage`가 **모든** slot의 연결을 요구. 명세 §9.3·§15.2는 **필수** slot만이고, 이 화면에서 Excel 주소를 고칠 수도 없다 | 필수 slot 미연결·`invalid`만 차단, 지연 매핑 metric 제외 |
| R-2 | 승인이 `REPORT_MATERIALIZATION_BLOCKED` | `requiredMaterializationSlotIds`가 지연 매핑 슬롯(P/E·P/B Band)까지 필수로 요구 | 표·차트 지연 매핑은 제외(수치는 유지) |
| R-3 | 초안 생성이 `REPORT_DOCUMENT_INVALID` | 미연결 지연 매핑 블록이 `REPORT_DATA_BINDING_NOT_CONFIRMED`를 발생 | 해당 블록을 문서에서 뺀다 → **원본 PDF의 차트가 그대로 유지된다** |
| R-4 | 본문 편집 저장이 항상 500 | `report_version_materialization_project_check` trigger가 파생 version이 물려받은 `materialization_run_id`를 거부 | 마이그레이션 `202607280027`: 같은 보고서의 다른 version을 가리키는 경우 허용 |
| R-5 | 검증·미리보기·내보내기 job 생성이 500 | `insertReportDeliveryJob`이 존재하지 않는 `workflow_job_input.artifact_id` 열에 INSERT | 열 목록 정정 + versionId 없는 component 제외 |
| R-6 | 내보내기가 항상 실패 | `report_export_artifact.source_artifact_id`(uuid)에 `CASE … THEN $2 END`를 넣어 PG가 text로 추론(42804) | `$2::uuid` 캐스팅 |

지연 매핑 정책은 [`server/domain/mapping-policy.ts`](../../source-react/server/domain/mapping-policy.ts)에
이미 정의돼 있었고 STEP 02 gate는 이를 지켰다. STEP 07 세 곳이 이를 몰랐던 것이
근본 원인이라, 세 곳 모두 같은 정책을 쓰게 했다.
`OutlineVisualSlot.semanticMetric`을 추가해 표시용 라벨과 정책 판단용 키를 분리했다.

### X-9 전수 감사에서 확인된 결함 중 추가 수정분

| ID | 위치 | 내용 |
|---|---|---|
| A-1 | API 라우트 12곳 | `...body`를 서버가 정한 `userId`·`projectId` **뒤에** 펼쳐 클라이언트가 신원을 덮어쓸 수 있었다(권한 우회). 본문을 먼저 펼치도록 정정 + 회귀 테스트 `tests/api-route-identity.test.mjs` |
| A-2 | `file-repository.ts` `completeFilesStage` | 가설 단계를 조건 없이 `in_progress`로 내림 → STEP 02로 되돌아와 `결과 확정 · 다음`을 다시 누르면 완료된 가설이 풀리고 STEP 04가 `PREREQUISITE_INCOMPLETE`로 막히는 되돌이. 다른 단계와 같은 `stage_status IN ('blocked','not_started')` 가드 적용 |
| A-3 | `project-repository.ts` `getProjectAccess` | `current_stage`가 blocked면 `canonicalRoute`가 허용 목록 밖이라 페이지 가드가 같은 URL로 무한 redirect. 진입 가능한 마지막 단계로 되돌린다 |
| A-4 | `report-repository.ts` `ensureOutline` | 재검증 필요 시 GET까지 409라 재생성에 필요한 `expectedInputVersions`를 얻을 수 없는 막다른 길. 읽기 경로는 상태만 표시하고 outline을 돌려준다 |
| A-5 | `hypothesis-repository.ts` `approveHypothesisQuestionSet` | 같은 버전 재승인이 unique 위반(23505) 500. STEP 05 `validation_approval`과 같은 선조회 가드 |
| A-6 | `report-repository.ts` `createReportExport` | 실패·취소로 끝난 내보내기를 그대로 돌려줘 다시 큐에 넣지 못함. 새 attempt로 재실행 |
| A-7 | `ReportWorkspace.tsx` | 안내된 내보내기 흐름이 미리보기를 만들지 않아 항상 `RENDERED_PDF_REQUIRED`. 내보내기 직전에 승인 버전 PDF를 렌더링(겸 미리보기 stale 표시도 해소) |
| A-8 | `research-validation.ts` `deriveNewsSearchPolicy` | 기준일이 대상 분기보다 240일 넘게 뒤면 기본 뉴스 기간이 자기 상한을 넘어 저장 시 거부. 기준일 기준으로 상한만큼만 거슬러 올라가게 clamp |

### 5.4 관통 검증 결과 (실제 DB·워커, 2026-07-28)

1. STEP 06: 2028F 필수 입력 **85셀** 일괄 반영 → 재계산 성공
   (Forward EPS `3,033` · Target PER `26.58x` · 목표주가 `81,000`, `M2!C40`은 빈 채로 통과)
2. draft(Target PER 26.6) → approve → complete → `nextRoute: /process/report-outline`,
   **새 Idempotency-Key로 재클릭해도 200**
3. STEP 07: outline 재생성 → 5페이지 전부 확인 → 승인 →
   초안 생성 **succeeded (14 block, 0 blocker)**
4. 본문 편집 저장(version 2) → 검증 `passed` (이슈 0) → 승인 → 미리보기 `ready`
5. 내보내기 **succeeded**: PDF 52.6MB · XLSX 273KB
6. 산출 PDF 확인: 편집 문장 반영, 2페이지 P/E·P/B Band 원본 유지,
   4페이지 추정재무제표가 `2024 | 2025 | 2026F | 2027F | 2028F`로
   2026 영업이익 `180.0`(수정 전에는 2025 값 49.1이 실렸다)
7. 코드 최종본으로 3~5를 **한 번 더 처음부터 재실행**해 첫 시도에 성공 확인

`npm test` 237건(226 pass / 11 skip / 0 fail), `npm run typecheck`·`npm run lint` clean,
`dotnet test` 14건 통과.

### 남은 감사 지적(미수정, 팀원 판단 필요)

전수 감사에서 확인됐지만 이번 범위 밖으로 남긴 항목:

- `LEGACY_ISC_WORKBOOK_PROFILE.cellHints`가 M2 시트 레이아웃을 하드코딩해
  다른 워크북에서 잘못된 셀을 0.99 신뢰도로 자동 확정할 수 있음
- `buildPlan`이 수식 셀을 가진 검증 대상의 binding을 버려 STEP 05 반영에서 누락
- `/inspect`가 `WORKBOOK_RECALCULATION_PARTIAL` 경고를 STEP 02 적합성에 반영하지 않음
- `workbookApplicationWorkflow`가 Temporal `cause` 체인 대신 `error.message`만 보고
  실패 코드를 판정
- `takeoverReportEditSession`이 잘못된 sessionId로도 유효한 lease를 만료시킴
- STEP 04 `출처 일괄 설정`이 개별 설정을 확인 없이 덮어씀
- `PdfPreview`의 렌더 task 취소 누락(빠른 zoom 시 미리보기 고착)
