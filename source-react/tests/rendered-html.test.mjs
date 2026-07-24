import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("keeps the REFLO document metadata", async () => {
  const layout = await readFile(new URL("../app/layout.tsx", import.meta.url), "utf8");

  assert.match(layout, /title: "REFLO — Research, in one flow"/);
  assert.match(
    layout,
    /description: "근거 수집부터 보고서 작성까지 연결하는 금융 리서치 워크스페이스"/,
  );
});

test("keeps the seven-step research UI and interactive workbenches", async () => {
  const [processSource, styles] = await Promise.all([
    readFile(new URL("../app/process.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  for (const [step, title] of [
    ["01", "프로젝트 설정"],
    ["02", "파일 업로드 · 검사"],
    ["03", "투자 의견 · 조사 질문"],
    ["04", "자료 수집 및 계획"],
    ["05", "조사 결과 검증"],
    ["06", "PER 밸류에이션"],
    ["07", "페이지 내용 설정"],
  ]) {
    assert.match(processSource, new RegExp(`no: "${step}"[^\\n]+title: "${title}"`));
  }

  assert.match(processSource, /role="tablist" aria-label="검증 대상"/);
  assert.match(processSource, /role="dialog" aria-modal="true"/);
  assert.match(processSource, /target="_blank" rel="noopener noreferrer"/);
  assert.match(processSource, /role="separator"/);
  assert.match(processSource, /onPointerDown=\{startExcelResize\}/);
  assert.match(processSource, /onPointerDown=\{startHypothesisResize\}/);
  assert.match(processSource, /onPointerDown=\{startSourceDrawerResize\}/);
  assert.match(processSource, /className="rv-excel-sheet-tabs" role="tablist"/);
  assert.match(processSource, /<span className="rv-excel-readonly">읽기 전용<\/span>/);

  for (const selector of [
    ".rv-validation-commandbar",
    ".rv-excel-workbench",
    ".rv-source-drawer",
    ".spec-project-setup",
  ]) {
    assert.match(styles, new RegExp(selector.replace(".", "\\.")));
  }
});
