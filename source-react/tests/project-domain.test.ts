import assert from "node:assert/strict";
import test from "node:test";
import {
  isValuationMethod,
  VALUATION_METHODS,
} from "../server/domain/project";

test("accepts only supported setup valuation methods", () => {
  assert.deepEqual(VALUATION_METHODS, ["PER", "PBR", "EV_EBITDA", "DCF"]);
  for (const method of VALUATION_METHODS) {
    assert.equal(isValuationMethod(method), true);
  }
  assert.equal(isValuationMethod("DDM"), false);
  assert.equal(isValuationMethod(null), false);
});
