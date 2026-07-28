import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { regionTokenHash } from "../server/infrastructure/repositories/report-repository";

test("render region token hash follows PDF block, line, and word order", () => {
  const tokenHash = regionTokenHash(
    {
      pageId: "page-1",
      pageNumber: 1,
      boxes: { mediaBox: [0, 0, 595.32, 841.92] },
      objects: [
        {
          objectId: "legend",
          type: "text_run",
          bbox: [40, 120, 80, 132],
          sourceLocator: {
            containerPath: ["page", 0, "text", 2, 0, 0],
          },
          textRun: { text: "수정 주가" },
        },
        {
          objectId: "axis",
          type: "text_run",
          bbox: [40, 180, 80, 192],
          sourceLocator: {
            containerPath: ["page", 0, "text", 1, 0, 0],
          },
          textRun: { text: "0 100" },
        },
        {
          objectId: "title",
          type: "text_run",
          bbox: [40, 220, 160, 232],
          sourceLocator: {
            containerPath: ["page", 0, "text", 0, 0, 0],
          },
          textRun: { text: "도표 2." },
        },
      ],
    },
    [30, 100, 180, 250],
  );

  assert.equal(
    tokenHash,
    createHash("sha256")
      .update("도표\n2.\n0\n100\n수정\n주가")
      .digest("hex"),
  );
});
