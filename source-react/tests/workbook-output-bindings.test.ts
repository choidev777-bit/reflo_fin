import assert from "node:assert/strict";
import test from "node:test";
import { isValuationOutputCandidate } from "../server/infrastructure/services/workbook-output-bindings";

test("rejects a market PER cell as the target PER output", () => {
  assert.equal(
    isValuationOutputCandidate({
      metric: "per",
      sheetName: "04_p1_FinancialData",
      label: "PER · 2026F",
    }),
    false,
  );
});

test("accepts the M2 selected target P/E calculation", () => {
  assert.equal(
    isValuationOutputCandidate({
      metric: "per",
      sheetName: "M2_목표주가_타겟멀티플",
      label: "적정 P/E (선택 방식)",
    }),
    true,
  );
});

test("does not constrain the existing EPS and target price outputs", () => {
  assert.equal(
    isValuationOutputCandidate({
      metric: "eps",
      sheetName: "M2_목표주가_타겟멀티플",
      label: "적용 EPS",
    }),
    true,
  );
  assert.equal(
    isValuationOutputCandidate({
      metric: "target_price",
      sheetName: "M2_목표주가_타겟멀티플",
      label: "목표주가",
    }),
    true,
  );
});
