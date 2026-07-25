import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalTargetPer,
  canonicalTargetPrice,
  inverseTargetPer,
  sensitivityGrid,
  upside,
} from "../server/domain/valuation";

test("Target PER accepts only 0.1 through 100.0 with one decimal", () => {
  assert.equal(canonicalTargetPer("0.1"), "0.1");
  assert.equal(canonicalTargetPer("100"), "100.0");
  assert.throws(() => canonicalTargetPer("0"));
  assert.throws(() => canonicalTargetPer("100.1"));
  assert.throws(() => canonicalTargetPer("14.25"));
});

test("target price is an integer from 1 through one billion won", () => {
  assert.equal(canonicalTargetPrice("1"), "1");
  assert.equal(canonicalTargetPrice("1000000000"), "1000000000");
  assert.throws(() => canonicalTargetPrice("0"));
  assert.throws(() => canonicalTargetPrice("1.5"));
  assert.throws(() => canonicalTargetPrice("1000000001"));
});

test("inverse PER and upside use decimal arithmetic", () => {
  assert.equal(inverseTargetPer("176094", "12401"), "14.2");
  assert.equal(
    upside("176094", "165000"),
    "0.067236363636363636363636363636363636364",
  );
});

test("sensitivity uses the fixed 5 by 5 rule and marks current input", () => {
  const result = sensitivityGrid({
    forwardEps: "12401",
    targetPer: "14.2",
  });
  assert.equal(result.epsAxis.length, 5);
  assert.equal(result.perAxis.length, 5);
  assert.equal(result.cells.length, 25);
  assert.equal(result.cells.filter((cell) => cell.current).length, 1);
  assert.equal(result.ruleVersion, "valuation-sensitivity-v1");
});

test("sensitivity clamps and removes duplicate PER axes", () => {
  const result = sensitivityGrid({
    forwardEps: "100",
    targetPer: "0.1",
  });
  assert.deepEqual(
    result.perAxis.map((axis) => axis.rawValue),
    ["0.1", "1.1", "2.1"],
  );
  assert.equal(result.cells.length, 15);
  assert.equal(result.cells.filter((cell) => cell.current).length, 1);
  assert.equal(
    result.perAxis.find((axis) => axis.rawValue === "0.1")?.offset,
    "0",
  );
});
