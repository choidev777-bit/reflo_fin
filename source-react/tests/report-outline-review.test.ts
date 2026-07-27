import assert from "node:assert/strict";
import test from "node:test";
import { hasUnconfirmedRequiredVisualSlots } from "../server/domain/report";

test("optional unmapped visual slots do not block page review", () => {
  assert.equal(
    hasUnconfirmedRequiredVisualSlots([
      { required: false, bindingStatus: "unmapped" },
      { required: true, bindingStatus: "confirmed" },
    ]),
    false,
  );
});

test("required unconfirmed visual slots block page review", () => {
  assert.equal(
    hasUnconfirmedRequiredVisualSlots([
      { required: true, bindingStatus: "unmapped" },
    ]),
    true,
  );
});
