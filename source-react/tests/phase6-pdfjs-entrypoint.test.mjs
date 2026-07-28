import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const PHASE6_DIR = "app/_phase6";
const LOADER = "pdfjs.ts";

/**
 * 타입 위치의 `pdfjs-dist` 언급은 번들에 남지 않으므로 실행 산출물을 고르지
 * 않는다. 실제로 모듈을 여는 자리만 남기고 지운다.
 */
function stripTypeOnlyReferences(source) {
  return source
    .replace(/import\s+type\s+\{[^}]*\}\s+from\s+"pdfjs-dist[^"]*";/g, "")
    .replace(/typeof\s+import\("pdfjs-dist[^"]*"\)/g, "")
    .replace(/import\("pdfjs-dist[^"]*"\)\./g, "");
}

test("Phase 06 loads pdf.js through one legacy entry point", async () => {
  const loader = await readFile(path.join(PHASE6_DIR, LOADER), "utf8");

  // pdfjs-dist 6.x의 기본 build/ 산출물은 2025년 이후 엔진 전용 API를 polyfill
  // 없이 쓴다. Safari 18에서 worker가 즉시 죽어 초안과 미리보기가 렌더되지 않는다.
  assert.match(loader, /import\("pdfjs-dist\/legacy\/build\/pdf\.mjs"\)/);
  assert.match(loader, /"pdfjs-dist\/legacy\/build\/pdf\.worker\.min\.mjs"/);
  assert.doesNotMatch(loader, /"pdfjs-dist\/build\//);

  const entries = await readdir(PHASE6_DIR, { withFileTypes: true });
  const sources = entries.filter(
    (entry) =>
      entry.isFile() &&
      entry.name !== LOADER &&
      /\.tsx?$/.test(entry.name),
  );

  for (const entry of sources) {
    const source = await readFile(path.join(PHASE6_DIR, entry.name), "utf8");

    // 두 산출물을 섞으면 TextLayer가 다른 pdf.js 인스턴스에 묶여 텍스트가
    // 그려지지 않는다. 모듈과 worker를 여는 자리는 로더 하나로 유지한다.
    assert.doesNotMatch(
      source,
      /GlobalWorkerOptions\.workerSrc/,
      `${entry.name} sets workerSrc outside ${LOADER}`,
    );
    assert.doesNotMatch(
      stripTypeOnlyReferences(source),
      /(?:from|import\()\s*"pdfjs-dist/,
      `${entry.name} loads pdfjs-dist without ${LOADER}`,
    );
  }
});
