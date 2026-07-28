import assert from "node:assert/strict";
import test from "node:test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * 요청 본문을 서버가 정한 신원 뒤에 펼치면 클라이언트가 `userId`·`projectId`를
 * 덮어쓸 수 있다. `...body`는 항상 먼저 와야 한다.
 */
async function routeFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await routeFiles(path)));
    else if (entry.name === "route.ts") files.push(path);
  }
  return files;
}

const SERVER_DERIVED = /^\s*(?:userId|projectId|idempotencyKey|leaseToken):/;

test("API 라우트는 요청 본문으로 서버가 정한 신원을 덮어쓰지 않는다", async () => {
  const files = await routeFiles("app/api");
  const offenders = [];
  for (const file of files) {
    const lines = (await readFile(file, "utf8")).split("\n");
    lines.forEach((line, index) => {
      if (line.trim() !== "...body,") return;
      for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
        const previous = lines[cursor];
        if (previous.trimEnd().endsWith("({")) break;
        if (SERVER_DERIVED.test(previous)) {
          offenders.push(`${file}:${index + 1}`);
          break;
        }
      }
    });
  }
  assert.deepEqual(offenders, []);
});
