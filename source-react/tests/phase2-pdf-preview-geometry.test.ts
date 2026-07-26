import assert from "node:assert/strict";
import test from "node:test";
import { pdfPreviewBlockStyle } from "../app/_phase2/pdf-preview-geometry";

test("places top-origin PDF blocks at their original vertical position", () => {
  const style = pdfPreviewBlockStyle(
    [58.704, 114.26, 143.9614, 132.26],
    [0, 0, 595.32, 841.92],
  );

  assert.ok(style);
  assert.equal(style.top, `${(114.26 / 841.92) * 100}%`);
  assert.notEqual(style.top, `${((841.92 - 132.26) / 841.92) * 100}%`);
});

test("accounts for a non-zero crop-box origin", () => {
  const style = pdfPreviewBlockStyle(
    [30, 50, 130, 150],
    [10, 20, 210, 420],
  );

  assert.deepEqual(style, {
    left: "10%",
    top: "7.5%",
    width: "50%",
    height: "25%",
  });
});
