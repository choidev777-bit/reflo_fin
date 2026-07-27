import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalTargetPer,
  canonicalTargetPrice,
  inverseTargetPer,
  sensitivityGrid,
  upside,
} from "../server/domain/valuation";
import {
  missingRequiredCells,
  reportRequiredCell,
  targetPerFormulaCells,
} from "../server/infrastructure/repositories/valuation-repository";

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

test("Target PER 수식에서 방식 선택 셀과 직접 입력 셀을 절대 참조로 읽는다", () => {
  // 실제 REFLO 모델 수식. 절대 참조($)를 못 읽으면 STEP 06의 `Target PER 반영`이
  // MAPPING_REVALIDATION_REQUIRED 409로 실패하며 화면이 STEP 02로 되돌아간다.
  assert.deepEqual(
    targetPerFormulaCells(
      'IF($C$30="Peer 평균 P/E",$C$41,IF($C$30="보고서 원문 P/E",$C$32,$C$31))',
    ),
    { modeAddress: "C30", inputAddress: "C31" },
  );
});

test("Target PER 수식은 상대 참조와 소문자도 허용한다", () => {
  assert.deepEqual(
    targetPerFormulaCells('IF(c30="Peer",c41,c31)'),
    { modeAddress: "C30", inputAddress: "C31" },
  );
});

test("Target PER 수식의 문자열 리터럴을 셀 참조로 오인하지 않는다", () => {
  assert.deepEqual(
    targetPerFormulaCells('IF($C$30="Q1 기준",$C$41,$C$31)'),
    { modeAddress: "C30", inputAddress: "C31" },
  );
});

test("Target PER 수식이 없으면 주소를 반환하지 않는다", () => {
  assert.deepEqual(targetPerFormulaCells(null), {
    modeAddress: null,
    inputAddress: null,
  });
});

/** `missingRequiredCells` 테스트용 최소 read model. */
function readModelFixture(
  sheetName: string,
  cells: Array<{
    address: string;
    row: number;
    column: number;
    text?: string;
    formula?: string;
    editable?: boolean;
  }>,
) {
  return {
    schemaVersion: "1",
    workbookHash: "0".repeat(64),
    sheets: [
      {
        sheetId: "sheet_1",
        name: sheetName,
        index: 0,
        visibility: "visible" as const,
        usedRange: "A1:Z90",
        freezeRows: 0,
        freezeColumns: 0,
        cells: cells.map((cell) => ({
          address: cell.address,
          row: cell.row,
          column: cell.column,
          valueType: cell.formula ? "number" : "string",
          rawValue: cell.text ?? null,
          formattedText: cell.text ?? "",
          formula: cell.formula ?? null,
          numberFormat: "",
          label: "",
          editable: cell.editable ?? false,
          readOnlyReason: null,
          fill: "",
          fontColor: "",
          bold: false,
        })),
      },
    ],
    editableCells: cells
      .filter((cell) => cell.editable)
      .map((cell) => ({
        sheetId: "sheet_1",
        sheetName,
        address: cell.address,
        valueType: "decimal",
        label: cell.address,
        numberFormat: "",
        required: true,
      })),
    outputs: { forwardEps: null, targetPer: null, targetPrice: null },
  };
}

test("집계 범위에만 쓰이는 빈 선택 입력칸은 승인을 막지 않는다", () => {
  // M2 Peer 슬롯: `=SUM($C$35:$C$40)/COUNT($C$35:$C$40)`은 빈 칸을 건너뛴다.
  const readModel = readModelFixture("M2_목표주가_타겟멀티플", [
    { address: "B39", row: 39, column: 2, text: "해성디에스" },
    { address: "C39", row: 39, column: 3, text: "15" },
    { address: "B40", row: 40, column: 2, text: "코리아써키트" },
    { address: "C40", row: 40, column: 3, editable: true },
    { address: "B41", row: 41, column: 2, text: "Peer 평균 P/E" },
    {
      address: "C41",
      row: 41,
      column: 3,
      text: "26.58",
      formula: "SUM($C$35:$C$40)/COUNT($C$35:$C$40)",
    },
  ]);

  assert.deepEqual(missingRequiredCells(readModel), []);
});

test("직접 더하는 수식이 참조하면 기간이 없어도 필수 입력이다", () => {
  const readModel = readModelFixture("M2_목표주가_타겟멀티플", [
    { address: "B40", row: 40, column: 2, text: "코리아써키트" },
    { address: "C40", row: 40, column: 3, editable: true },
    {
      address: "C41",
      row: 41,
      column: 3,
      text: "0",
      formula: "$C$39+$C$40",
    },
  ]);

  assert.deepEqual(
    missingRequiredCells(readModel).map((cell) => cell.address),
    ["C40"],
  );
});

test("전망 연도 열의 빈 칸은 그대로 필수 입력이다", () => {
  const readModel = readModelFixture("14_p4_투자지표", [
    { address: "A5", row: 5, column: 1, text: "구분" },
    { address: "E5", row: 5, column: 5, text: "2027F" },
    { address: "F5", row: 5, column: 6, text: "2028F" },
    { address: "G5", row: 5, column: 7, text: "비고" },
    { address: "A6", row: 6, column: 1, text: "EPS" },
    { address: "E6", row: 6, column: 5, text: "3699" },
    { address: "F6", row: 6, column: 6, editable: true },
  ]);

  assert.deepEqual(
    missingRequiredCells(readModel).map((cell) => cell.address),
    ["F6"],
  );
});

test("기간 헤더 행의 빈 칸은 필수 입력이 아니다", () => {
  // 하위 표 헤더(`구분 | 2024 | … | 2028F | 비고`)는 값 자리가 아니다.
  const readModel = readModelFixture("14_p4_투자지표", [
    { address: "A13", row: 13, column: 1, text: "구분" },
    { address: "B13", row: 13, column: 2, text: "2024" },
    { address: "E13", row: 13, column: 5, text: "2027F" },
    { address: "F13", row: 13, column: 6, editable: true },
    { address: "G13", row: 13, column: 7, text: "2028" },
  ]);

  assert.deepEqual(missingRequiredCells(readModel), []);
});

test("기간이 없는 선택 입력칸은 지울 수 있다", () => {
  // 워커가 넘기는 raw `required`만 보면 모든 blank 변경이 422로 막힌다.
  const readModel = readModelFixture("M2_목표주가_타겟멀티플", [
    { address: "B40", row: 40, column: 2, text: "코리아써키트" },
    { address: "C40", row: 40, column: 3, text: "18.5", editable: true },
    {
      address: "C41",
      row: 41,
      column: 3,
      text: "26.58",
      formula: "SUM($C$35:$C$40)/COUNT($C$35:$C$40)",
    },
  ]);

  assert.equal(
    reportRequiredCell(readModel, readModel.editableCells[0]!),
    false,
  );
});

test("전망 연도 칸은 지울 수 없다", () => {
  const readModel = readModelFixture("14_p4_투자지표", [
    { address: "A5", row: 5, column: 1, text: "구분" },
    { address: "F5", row: 5, column: 6, text: "2028F" },
    { address: "A6", row: 6, column: 1, text: "EPS" },
    { address: "E6", row: 6, column: 5, text: "3699" },
    { address: "F6", row: 6, column: 6, text: "3993", editable: true },
  ]);

  assert.equal(
    reportRequiredCell(readModel, readModel.editableCells[0]!),
    true,
  );
});
