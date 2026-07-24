import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const developmentPreviewMeta =
  /<meta(?=[^>]*\bname=["']codex-preview["'])(?=[^>]*\bcontent=["']development["'])[^>]*>/i;

test("renders development preview metadata", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  const response = await worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );

  assert.equal(response.status, 200);
  assert.match(
    response.headers.get("content-type") ?? "",
    /^text\/html\b/i,
  );
  assert.match(await response.text(), developmentPreviewMeta);
});

test("keeps research source links and the Excel split view accessible", async () => {
  const [processSource, styles] = await Promise.all([
    readFile(new URL("../app/process.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(processSource, /뉴스·언론/);
  assert.match(processSource, /\{ step: 4, no: "04", group: "리서치 설계", title: "자료 수집 및 계획"/);
  assert.match(processSource, /\{ step: 5, no: "05", group: "분석 · 리포트 준비", title: "조사 결과 검증"/);
  assert.match(processSource, /<ScreenHead step="04" title="자료 조사 계획"/);
  assert.match(processSource, /<ScreenHead step="05" title="수집 결과 검증"/);
  assert.match(processSource, /copy="04에서 수집한 근거를 항목별로 확인하고 원문과 대조합니다\."/);
  assert.match(processSource, /className="rv-validation-commandbar"/);
  assert.doesNotMatch(processSource, /className="rv-collection-context"/);
  assert.match(processSource, /className="rv-command-tabs" role="tablist" aria-label="검증 대상"/);
  assert.match(processSource, /item === "hypothesis" \? "HYPOTHESIS" : "EXCEL"/);
  assert.match(processSource, /className="rv-source-overview-trigger" aria-haspopup="dialog"/);
  assert.match(processSource, /\{collectedItemCount\}건 · \{collectedSourceCount\}개 출처/);
  assert.match(processSource, /onClick=\{\(\) => setSourceDrawerOpen\(true\)\}/);
  assert.doesNotMatch(processSource, /className="rv-source-strip"|setSourceDrawerName/);
  assert.doesNotMatch(processSource, /collectedSources\.map\(\(source\) => <button/);
  assert.match(processSource, /target="_blank" rel="noopener noreferrer"/);
  assert.match(processSource, /className="rv-excel-divider" role="separator"/);
  assert.match(processSource, /excel: "Excel 연결"/);
  assert.match(processSource, /aria-label="원문 데이터와 입력 위치 비교"/);
  assert.match(processSource, /<span>선택 연결<\/span>/);
  assert.match(processSource, /excelCollectedRows\.length\}개 입력값 · 연결 완료/);
  assert.doesNotMatch(processSource, /DART SOURCE|EXCEL PREVIEW|Excel 반영값|입력 준비 완료|현재 연결|선택한 값/);
  assert.match(processSource, /onPointerDown=\{startExcelResize\}/);
  assert.match(processSource, /onKeyDown=\{resizeExcelWithKeyboard\}/);
  assert.match(processSource, /className="rv-excel-divider rv-hypothesis-divider" role="separator"/);
  assert.match(processSource, /aria-valuemin=\{35\} aria-valuemax=\{65\}/);
  assert.match(processSource, /onPointerDown=\{startHypothesisResize\}/);
  assert.match(processSource, /onDoubleClick=\{\(\) => setHypothesisSplit\(45\)\}/);
  assert.match(processSource, /onKeyDown=\{resizeHypothesisWithKeyboard\}/);
  assert.match(processSource, /\{!expanded && <div className="rv-excel-divider rv-hypothesis-divider"/);
  assert.match(processSource, /className="spec-drawer-resizer rv-source-drawer-resizer" role="separator"/);
  assert.match(processSource, /aria-valuenow=\{Math\.round\(sourceDrawerWidth\)\}/);
  assert.match(processSource, /onPointerDown=\{startSourceDrawerResize\}/);
  assert.match(processSource, /onDoubleClick=\{\(\) => setSourceDrawerWidth\(460\)\}/);
  assert.match(processSource, /onKeyDown=\{resizeSourceDrawerWithKeyboard\}/);
  assert.match(processSource, /className="rv-source-overview">\{collectedSources\.map/);
  assert.match(processSource, /className="rv-source-group"/);
  assert.match(processSource, /총 \{collectedItemCount\}건 · \{collectedSourceCount\}개 출처/);
  assert.doesNotMatch(processSource, /REVIEW FLOW|<p>원문 검토<\/p>/);
  assert.match(processSource, /className="rv-review-toolbar"/);
  assert.match(processSource, /className="rv-result-titleline"/);
  assert.match(processSource, /className="rv-result-source-action" aria-hidden="true"><b>원문<\/b>/);
  assert.match(processSource, /aria-label=\{`\$\{item\.title\} 원문 위치 보기`\} title="원문 위치 보기"/);
  assert.match(processSource, /value: "5조 5,350억 원"/);
  assert.match(processSource, /value: "2,950억 원"/);
  assert.match(processSource, /value: "21조 8,970억 원"/);
  assert.doesNotMatch(processSource, /value: "(?:5,535|295|21,897)십억원"/);
  assert.match(processSource, /현재 의견을 반영한 가설 질문/);
  assert.doesNotMatch(processSource, /현재 의견을 반영한 조사질문/);
  assert.match(processSource, /className="rv-result-provenance"/);
  assert.match(processSource, /className="rv-evidence-provenance"/);
  assert.match(processSource, /className=\{`rv-review-outcome /);
  assert.match(processSource, /label: "가설 확인을 위한 자료 수집"/);
  assert.match(processSource, /label: "입력값 삽입을 위한 자료 수집"/);
  assert.doesNotMatch(processSource, /조사 질문을 확인할 자료 수집|가설을 확인할 자료 수집|Excel 입력값 삽입을 위한 자료 수집/);
  assert.match(processSource, /\["all", "conflict", "complete"\]/);
  assert.match(processSource, /aria-label="검증 상태 필터"/);
  assert.match(processSource, /item === "conflict" \? "출처 충돌" : "확인 완료"/);
  assert.match(processSource, /aria-expanded=\{expanded\}/);
  assert.match(processSource, /expanded \? <Minimize2 aria-hidden="true" size=\{18\} strokeWidth=\{1\.8\}\/> : <Maximize2 aria-hidden="true" size=\{18\} strokeWidth=\{1\.8\}\/>/);
  assert.doesNotMatch(processSource, /expanded \? "↙" : "↗"/);
  assert.doesNotMatch(processSource, /const \[search, setSearch\]|placeholder="근거 검색"|aria-label="결과, 문서 또는 출처 검색"/);
  assert.match(processSource, /상태 필터를 바꿔보세요/);
  assert.doesNotMatch(processSource, /필터나 검색어를 바꿔보세요/);
  assert.match(processSource, /DART 전자공시 원문/);
  assert.match(processSource, /금융감독원 전자공시시스템/);
  assert.match(processSource, /const activeExcelSheetCells = excelCollectedRows\.filter/);
  assert.match(processSource, /const activeExcelSheetRange = activeExcelSheetCells\.length > 1/);
  assert.match(processSource, /className="rv-excel-workbook-header"><div><i aria-hidden="true">X<\/i>/);
  assert.match(processSource, /<small>\{activeExcelSheet\} · \{activeExcelSheetRange\}<\/small>/);
  assert.match(processSource, /className="rv-excel-workbook-status"><i aria-hidden="true"\/><strong>Excel 연결 미리보기<\/strong>/);
  assert.doesNotMatch(processSource, /rv-excel-workbook-status[^\n]*excelCollectedRows/);
  assert.match(processSource, /<\/header>\s*<nav className="rv-excel-sheet-tabs" role="tablist"/);
  assert.equal(processSource.match(/className="rv-excel-sheet-tabs"/g)?.length, 1);
  assert.match(processSource, /className="rv-excel-workbook-frame" role="group"/);
  assert.doesNotMatch(processSource, /EXCEL WORKBOOK/);
  assert.doesNotMatch(processSource, /FileSpreadsheet/);
  assert.match(processSource, /className="rv-excel-formula-bar"/);
  assert.match(processSource, /className="rv-excel-sheet-tabs" role="tablist"/);
  assert.match(processSource, /<span className="rv-excel-readonly">읽기 전용<\/span>/);
  assert.match(processSource, /const forecastEpsRatios: Record<ForecastPeriod, number> = \{ fy26e: 10870 \/ 87300, fy27e: 12401 \/ 115100 \}/);
  assert.match(processSource, /Math\.round\(forecastNumber\("netIncome", "fy26e"\) \* forecastEpsRatios\.fy26e\)/);
  assert.match(processSource, /Math\.round\(forecastNumber\("netIncome", "fy27e"\) \* forecastEpsRatios\.fy27e\)/);
  assert.match(processSource, /aria-label=\{`\$\{row\.label\} FY26E 예측값`\}/);
  assert.match(processSource, /aria-label=\{`\$\{row\.label\} FY27E 예측값`\}/);
  assert.match(processSource, /inputMode="numeric"/);
  assert.match(processSource, /<em><i\/>예측값 편집 가능<\/em>/);
  assert.match(processSource, /<span>수식 셀 보호<\/span>/);
  assert.match(processSource, /className="is-result spec-formula-output" aria-live="polite"/);
  assert.match(processSource, /Forward EPS는 지배주주순이익만 반영해 자동 계산됩니다/);
  assert.match(processSource, /targetPriceSource !== "per"/);
  assert.match(processSource, /Math\.round\(forwardEps \* nextPer\)/);
  assert.match(processSource, /targetPriceSource !== "price"/);
  assert.match(processSource, /nextTargetPrice \/ forwardEps/);
  assert.match(processSource, /const sensitivityEps = \[-2, -1, 0, 1, 2\]\.map/);
  assert.doesNotMatch(processSource, /className="rv-queue-head"/);
  assert.doesNotMatch(processSource, /className="rv-compare-panel"/);
  assert.match(styles, /\.rv-excel-workbench \{ height:auto;grid-template-columns:1fr!important; \}/);
  assert.match(styles, /\.rv-workbench \{ height:auto;min-height:0;grid-template-columns:1fr!important; \}/);
  assert.match(styles, /\.rv-hypothesis-divider \{ min-width:28px;border:0;background:#fafbf9; \}/);
  assert.match(styles, /\.rv-validation-commandbar \{[^}]*min-height:64px;[^}]*grid-template-columns:minmax\(0,1fr\) auto;[^}]*padding:0;[^}]*border:1px solid var\(--rv-line\);[^}]*background:#fff;/);
  assert.doesNotMatch(styles, /\.rv-collection-context/);
  assert.match(styles, /\.rv-command-tabs \{[^}]*grid-template-columns:repeat\(2,minmax\(0,1fr\)\);/);
  assert.match(styles, /\.rv-command-tabs>button>i \{[^}]*width:28px;[^}]*height:28px;[^}]*border-radius:50%;/);
  assert.match(styles, /\.rv-command-tabs>button\.active \{[^}]*border-bottom-color:var\(--rv-lime-deep\);[^}]*background:#fff;/);
  assert.match(styles, /\.rv-source-overview-trigger \{[^}]*min-height:44px;/);
  assert.match(styles, /\.rv-source-group \{[^}]*border:1px solid var\(--rv-line\);[^}]*border-radius:10px;/);
  assert.match(styles, /\.rv-review-toolbar \{[^}]*grid-template-columns:auto minmax\(0,1fr\);/);
  assert.match(styles, /\.rv-review-toolbar \{ min-height:60px;[^}]*padding:6px 14px;/);
  assert.match(styles, /\.rv-review-toolbar \.rv-status-filter \{[^}]*overflow-x:auto;/);
  assert.match(styles, /\.rv-review-toolbar \.rv-status-filter button \{ min-height:44px;[^}]*background:transparent;/);
  assert.match(styles, /\.rv-review-toolbar \.rv-status-filter button>span \{[^}]*padding:4px 9px;/);
  assert.match(styles, /\.rv-review-toolbar \.rv-status-filter button\.active>span \{[^}]*background:var\(--rv-lime-soft\);/);
  assert.match(styles, /\.rv-evidence>header \{ min-height:64px;padding:8px 16px; \}/);
  assert.match(styles, /\.rv-result-row \{ min-height:118px;grid-template-columns:minmax\(0,1fr\) auto;/);
  assert.match(styles, /\.rv-result-titleline \{[^}]*display:flex;[^}]*flex-wrap:wrap;/);
  assert.match(styles, /\/\* Step 05 refined workspace: collected results lead into a single source-confirmation path\. \*\//);
  assert.match(styles, /\.rv-validation-commandbar \{ min-height:72px;grid-template-columns:minmax\(0,1fr\) auto;[^}]*border-radius:14px;/);
  assert.match(styles, /\.rv-workbench \{ min-height:570px;height:min\(684px,calc\(100vh - 350px\)\);gap:10px;margin-top:10px;border:0;/);
  assert.match(styles, /\.rv-queue \{ overflow:hidden;border:1px solid var\(--rv-line\);border-radius:14px;background:var\(--rv-soft\); \}/);
  assert.match(styles, /\.rv-evidence \{ overflow:hidden;border:1px solid var\(--rv-line\);border-radius:14px;background:var\(--rv-soft\); \}/);
  assert.match(styles, /\.rv-result-value \{[^}]*font-variant-numeric:tabular-nums;/);
  assert.match(styles, /\.rv-result-row>\.rv-result-source-action \{[^}]*min-height:44px;/);
  assert.match(styles, /\.rv-excel-workbook-header \{[^}]*min-height:68px!important;[^}]*padding:10px 14px!important;/);
  assert.match(styles, /\.rv-excel-workbook-header>div>i \{[^}]*width:34px;[^}]*height:34px;[^}]*background:#1d7e46;[^}]*color:#fff;/);
  assert.match(styles, /\.rv-excel-workbook-status>strong \{ color:#1d7e46;/);
  assert.match(styles, /\.rv-excel-sheet-pane \{ grid-template-rows:auto auto minmax\(0,1fr\) auto; \}/);
  assert.match(styles, /\.rv-excel-readonly \{[^}]*margin-left:auto;[^}]*color:var\(--rv-muted\);/);
  assert.match(styles, /\.rv-excel-workbook-frame \{ width:100%;min-width:360px;/);
  assert.match(styles, /\.spec-forecast-input \{[^}]*min-height:44px;[^}]*border:1px solid #e4e8e1;[^}]*border-radius:8px;/);
  assert.match(styles, /\.spec-forecast-input:focus-within \{[^}]*border-color:#75a900;[^}]*outline:2px solid #efffc5;/);
  assert.match(styles, /\.spec-formula-output \.spec-calculated-cell \{ color:#75a900;/);
  assert.match(styles, /grid-template-columns:28px minmax\(86px,1\.2fr\) minmax\(64px,\.9fr\) minmax\(42px,\.6fr\) minmax\(58px,\.7fr\)/);
  assert.match(styles, /\.rv-source-drawer \{ width:100%!important;min-width:0;max-width:none; \}/);
  assert.match(styles, /\.rv-source-drawer-resizer \{ display:none; \}/);
  assert.match(styles, /\.rf-section-title h2 \{[^}]*font-weight:700;/);
  assert.match(styles, /\.rf-plan-guide \{ padding:10px 20px;/);
  assert.match(styles, /\.spec-project-setup \.spec-project-form \.spec-field label \{ font-size:12px; \}/);
  assert.match(styles, /\.projects-main \{ width: min\(1400px, calc\(100% - 128px\)\); padding: 0 0 96px; \}/);
  assert.match(styles, /\.projects-overview-head p \{\s*margin: 0 0 14px;/);
  assert.match(styles, /\.projects-overview-head h1 \{[^}]*margin: 0 0 10px;[^}]*font-weight: 600;/s);
  assert.match(styles, /\.projects-records \.record-row \{[^}]*border-radius: 0;/);
  assert.match(styles, /#rf-source-title \{ font-weight:600; \}/);
  assert.match(styles, /\.rf-dialog\.rf-source-dialog>header p \{ color:var\(--rf-source-deep\);font-size:11px; \}/);
  assert.match(styles, /\.rf-dialog\.rf-source-dialog>header>button \{ background:#fff; \}/);
  assert.match(styles, /\.rf-source-dialog \.rf-dialog-body>p \{ font-size:12px; \}/);
  assert.match(styles, /\.rf-source-dialog \.rf-dialog-body legend \{ font-size:12px; \}/);
  assert.match(styles, /\.rf-source-dialog \.rf-dialog-body legend span \{[^}]*font-size:11px;/);
  assert.match(styles, /\.rf-source-dialog \.rf-dialog-body \.rf-source-grid \{[^}]*grid-template-columns:repeat\(2,minmax\(0,1fr\)\);[^}]*gap:8px;/);
  assert.match(styles, /@media\(max-width:640px\)[\s\S]*\.rf-source-dialog \.rf-dialog-body \.rf-source-grid \{ grid-template-columns:1fr; \}/);
  assert.doesNotMatch(processSource, /source\.recommended && <em>추천<\/em>/);
  assert.match(styles, /\.rf-source-dialog \.rf-dialog-body \.rf-source-option>input \{[^}]*appearance:none;[^}]*border:1px solid #d1d9ce;[^}]*border-radius:6px;/);
  assert.match(styles, /\.rf-source-dialog \.rf-dialog-body \.rf-source-option>input:checked \{ border-color:var\(--rf-source-deep\);background:var\(--rf-source-deep\); \}/);
  assert.match(styles, /\.rf-source-dialog \.rf-dialog-body \.rf-source-option>input:checked:after \{[^}]*border:solid #fff;/);
  assert.match(styles, /\.rf-file-drop \{[^}]*padding:12px 20px;/);
  assert.match(styles, /\.rf-file-drop>em \{[^}]*padding:0 12px;[^}]*border:1px solid #d1d9ce;[^}]*color:#353833;/);
  assert.match(styles, /\.rf-source-dialog>footer button \{ padding:0 14px;font-size:12px; \}/);
  assert.match(styles, /\.rf-source-dialog>footer button\.primary \{ font-weight:800; \}/);
  assert.match(styles, /\.rf-dialog\.rf-approval-dialog>header>button \{ margin-top:-10px;margin-right:-10px;background:#fff; \}/);
  assert.match(styles, /\.rf-approval-dialog>footer \.rf-approval-start \{ padding:0 14px;font-size:12px; \}/);
  assert.doesNotMatch(processSource, />계획으로 돌아가기<\/button>/);
  assert.doesNotMatch(processSource, />자료 수집 시작 <b>→<\/b><\/button>/);
  assert.match(styles, /\.spec-target-price-editor input \{[^}]*font-weight:700;/s);
  assert.match(processSource, /copy="페이지별 핵심내용을 적고 구성요소 파악으로 더 정확한 초안 생성이 가능합니다\."/);
  assert.match(processSource, /aside=\{<button className="spec-outline-reset"[^>]*>기준 초기화<\/button>\}/);
  assert.doesNotMatch(processSource, /spec-outline-builder">\s*<header>/);
  assert.match(processSource, /useState<number \| null>\(1\)/);
  assert.match(processSource, /const selectedBlock = blocks\.find\(\(block\) => block\.id === selectedId\);/);
  assert.match(processSource, /onClick=\{\(\) => setSelectedId\(selected \? null : block\.id\)\}/);
  assert.match(processSource, /className=\{`spec-outline-editor\$\{block\.sections\.length === 0 && block\.page <= 4 \? " spec-outline-editor--preview-only" : ""\}`\}/);
  assert.match(processSource, /block\.page === 1 && block\.sections\.length > 0/);
  assert.match(processSource, /id: "headline", label: "리포트 제목 :"/);
  assert.match(processSource, /id: "review", label: "본문 1_기업 리뷰 :"/);
  assert.match(processSource, /id: "outlook", label: "본문 2_기업 전망 :"/);
  assert.match(processSource, /id: "target", label: "본문 3_목표주가 :"/);
  assert.equal(processSource.match(/keyPoint: ""/g)?.length, 4);
  assert.match(processSource, /className=\{section\.keyPoint !== undefined \? "spec-outline-key-point-field" : undefined\}/);
  assert.match(processSource, /aria-label=\{`\$\{section\.label\} 핵심 포인트`\}/);
  assert.match(processSource, /placeholder="핵심 포인트를 한줄로 입력하세요\." maxLength=\{80\}/);
  assert.match(processSource, /className="spec-outline-target-field"/);
  assert.doesNotMatch(processSource, /리포트 제목·소제목/);
  assert.match(processSource, /<header><b>문단 제목<\/b><\/header>/);
  assert.doesNotMatch(processSource, /<strong>\{block\.sections\.length\}개<\/strong>/);
  assert.match(processSource, /<section className="spec-outline-preview-list"><header><b>생성될 표 · 차트<\/b><\/header>/);
  assert.match(processSource, /const visualNumber = visuals\.slice\(0, visualIndex \+ 1\)\.filter\(\(candidate\) => candidate\.kind === visual\.kind\)\.length/);
  assert.match(processSource, /<i>\{`\$\{visual\.kind\}\$\{visualNumber\}`\}<\/i>/);
  assert.doesNotMatch(processSource, /페이지 삭제|deleteBlock/);
  assert.doesNotMatch(processSource, /<details className="spec-outline-preview-list"|<summary><b>자동 구성 표 · 차트<\/b>/);
  assert.match(processSource, /aria-controls=\{`outline-page-panel-\$\{block\.id\}`\} aria-expanded=\{selected\}/);
  assert.match(processSource, /className="spec-outline-disclosure" aria-hidden="true"/);
  assert.doesNotMatch(processSource, /getOutlineVisualSummary/);
  assert.doesNotMatch(processSource, /목록 보기|목록 접기/);
  assert.match(processSource, /aria-current=\{selected \? "page" : undefined\}/);
  assert.match(processSource, /aria-label=\{`\$\{evidence\.title\} 원문 근거 열기`\} title="원문 근거 열기"/);
  assert.match(processSource, /className="spec-outline-evidence-open" aria-hidden="true"><ExternalLink size=\{18\} strokeWidth=\{1\.8\}\/>/);
  assert.doesNotMatch(processSource, /<i>\{evidence\.type\} ›<\/i>/);
  assert.match(processSource, /> 페이지 추가<\/button>/);
  assert.doesNotMatch(processSource, /className="spec-outline-detail-meta"|메인 가설과 종합 근거|공통 기준/);
  assert.match(processSource, /<span>메인 가설의 종합 근거<\/span>/);
  assert.doesNotMatch(processSource, /전체 페이지 공통/);
  assert.doesNotMatch(processSource, /<small>\{section\.choices \? "결정" : "제목"\}<\/small>/);
  assert.doesNotMatch(processSource, /1페이지 문단 설정|표·차트 미리보기|데이터 선택 없이 아래 구조로 자동 생성됩니다/);
  const pageTwoVisuals = processSource.match(/2: \[([\s\S]*?)\n    \],\n    3:/)?.[1] ?? "";
  const pageFourVisuals = processSource.match(/4: \[([\s\S]*?)\n    \],\n\};/)?.[1] ?? "";
  assert.equal(pageTwoVisuals.match(/kind: "표"/g)?.length, 2);
  assert.doesNotMatch(pageTwoVisuals, /kind: "차트"/);
  assert.equal(pageFourVisuals.match(/kind: "표"/g)?.length, 1);
  assert.equal(pageFourVisuals.match(/kind: "차트"/g)?.length, 1);
  assert.match(styles, /\.spec-final-decision-screen \.spec-screen-head \{[^}]*align-items:flex-end;[^}]*margin-bottom:18px\s*\}/);
  assert.match(styles, /\.spec-outline-reset \{[^}]*min-height:44px;[^}]*font-size:12px;/);
  assert.match(styles, /\.spec-outline-block-summary small \{[^}]*font-size:11px!important;/);
  assert.match(styles, /\.spec-outline-block-summary b \{[^}]*font-size:15px;/);
  assert.match(styles, /\.spec-outline-list > article\.selected > \.spec-outline-block-summary \{ background:var\(--paper\) \}/);
  assert.match(styles, /\.spec-outline-editor \{[^}]*background:#f7f7f7 \}/);
  assert.match(styles, /\.spec-outline-editor--preview-only \{ padding:0 20px 20px \}/);
  assert.match(styles, /\.spec-outline-copy-config article \{[^}]*min-height:64px;[^}]*grid-template-columns:30px minmax\(130px,\.8fr\) minmax\(0,1\.2fr\);/);
  assert.match(styles, /\.spec-outline-copy-config article \+ article \{ border-top:1px solid var\(--line\) \}/);
  assert.match(styles, /\.spec-outline-copy-config input,\.spec-outline-copy-config select,\.spec-outline-copy-config textarea \{[^}]*font-size:13px;/);
  assert.match(styles, /\.spec-outline-key-point-field \{ display:grid;gap:6px \}/);
  assert.match(styles, /\.spec-outline-key-point-field > input \{ height:34px;font-size:12px \}/);
  assert.match(styles, /\.spec-outline-target-field > input \{ height:40px \}/);
  assert.match(styles, /\.spec-outline-copy-config label:focus-within \{ outline:0 \}/);
  assert.match(styles, /\.spec-outline-copy-config input:focus-visible,\.spec-outline-copy-config select:focus-visible,\.spec-outline-copy-config textarea:focus-visible \{ border-color:var\(--lime-dark\);outline:0 \}/);
  assert.match(styles, /\.spec-outline-preview-list \{ padding-top:14px;border:0 \}/);
  assert.match(styles, /\.spec-outline-preview-list > header \{[^}]*min-height:24px;[^}]*margin-bottom:8px/);
  assert.match(styles, /\.spec-outline-preview-list article \{[^}]*grid-template-columns:42px minmax\(0,1fr\);[^}]*border:0;[^}]*background:var\(--paper\)/);
  assert.doesNotMatch(styles, /\.spec-outline-preview-list > summary/);
  assert.doesNotMatch(styles, /\.spec-outline-block-summary > strong/);
  assert.match(styles, /\.spec-outline-evidence-panel button \{[^}]*min-height:82px;/);
  assert.match(styles, /\.spec-outline-evidence-panel \{ padding:10px 20px \}/);
  assert.match(styles, /\.spec-outline-evidence-panel button small \{[^}]*font-size:13px!important;/);
  assert.match(styles, /\.spec-outline-evidence-panel button em \{[^}]*font-size:10px;/);
  assert.match(styles, /\.spec-outline-evidence-panel button > \.spec-outline-evidence-open \{[^}]*min-width:44px;[^}]*min-height:44px;/);
  assert.match(styles, /\.spec-outline-hypothesis p \{[^}]*font-weight:500;/);
  assert.match(styles, /\.spec-workflow-dialog \{[^}]*background: #fff;/);
  assert.match(styles, /\.spec-workflow-dialog > header button \{[^}]*margin-top: -12px;[^}]*margin-right: -12px;[^}]*border: 0;/);
});
