import assert from "node:assert/strict";
import test from "node:test";
import {
  financialStatementKind,
  targetPerModeAddress,
} from "../server/infrastructure/repositories/valuation-repository";

test("recognizes legacy and current financial statement sheet names", () => {
  assert.equal(financialStatementKind("12_p4_손익계산서"), "1");
  assert.equal(financialStatementKind("15_p4_현금흐름표"), "4");
  assert.equal(financialStatementKind("15_p5_손익계산서"), "1");
  assert.equal(financialStatementKind("18_p5_현금흐름표"), "4");
  assert.equal(financialStatementKind("14_도표10_소켓_비소켓"), null);
});

test("finds the Target PER mode cell from absolute and relative IF formulas", () => {
  assert.equal(
    targetPerModeAddress(
      'IF($B$6="특정 피어 조정",$B$9*(1+$B$10),$B$13)',
    ),
    "B6",
  );
  assert.equal(targetPerModeAddress('IF(C7="직접 입력",C8,C9)'), "C7");
  assert.equal(targetPerModeAddress("ROUND(B7*B14,-4)"), null);
});
