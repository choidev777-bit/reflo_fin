import assert from "node:assert/strict";
import test from "node:test";
import {
  DEMO_FORECAST_CELLS,
  DEMO_TARGET_PER,
  demoForecastSeedChanges,
} from "../server/domain/demo-valuation-forecast";
import { canonicalTargetPer } from "../server/domain/valuation";

/**
 * 시연 모드 STEP 06이 바로 넘어가는지 확인한다.
 *
 * Excel roll-forward가 모델을 한 해 밀면 마지막 전망 열이 빈 채로 STEP 06에
 * 도착하고, 승인 게이트(`REQUIRED_INPUT_MISSING`)가 그 85칸을 모두 요구한다.
 * 촬영 중에 손으로 채울 수 없으므로 시연 모드에서 미리 채우는데, 그 시드가
 * 조용히 0건이 되면 STEP 06에서 촬영이 멈춘다. 여기서 막는다.
 */

type Cell = { address: string; rawValue: string | null };

function readModel(input: {
  sheets: Array<{ sheetId: string; name: string; cells: Cell[] }>;
  editable: Array<{ sheetId: string; address: string }>;
}) {
  return { sheets: input.sheets, editableCells: input.editable };
}

/** 시연 워크북을 흉내낸다: 전망 열이 비어 있고 편집 가능한 상태. */
function demoWorkbook(overrides: Map<string, string> = new Map()) {
  const bySheetName = new Map<string, Cell[]>();
  for (const cell of DEMO_FORECAST_CELLS) {
    const cells = bySheetName.get(cell.sheetName) ?? [];
    cells.push({
      address: cell.address,
      rawValue: overrides.get(`${cell.sheetName}:${cell.address}`) ?? null,
    });
    bySheetName.set(cell.sheetName, cells);
  }
  const sheets = [...bySheetName.entries()].map(([name, cells], index) => ({
    sheetId: `sheet_${index + 1}`,
    name,
    cells,
  }));
  return readModel({
    sheets,
    editable: sheets.flatMap((sheet) =>
      sheet.cells.map((cell) => ({
        sheetId: sheet.sheetId,
        address: cell.address,
      })),
    ),
  });
}

test("시연 전망값이 빈 전망 열을 모두 채운다", () => {
  const changes = demoForecastSeedChanges(demoWorkbook());
  assert.equal(changes.length, DEMO_FORECAST_CELLS.length);
  assert.ok(changes.every((change) => change.valueType === "number"));
  // 값이 숫자로 파싱되지 않으면 Excel 워커가 422로 거절한다.
  assert.ok(changes.every((change) => Number.isFinite(Number(change.value))));
});

test("이미 채워진 칸은 덮어쓰지 않는다", () => {
  const first = DEMO_FORECAST_CELLS[0]!;
  const changes = demoForecastSeedChanges(
    demoWorkbook(new Map([[`${first.sheetName}:${first.address}`, "999"]])),
  );
  assert.equal(changes.length, DEMO_FORECAST_CELLS.length - 1);
  assert.ok(
    !changes.some((change) => change.address === first.address),
    "사용자가 화면에서 입력한 값을 시연 시드가 되돌리면 안 된다",
  );
});

test("두 번째 실행은 아무것도 바꾸지 않는다", () => {
  const filled = new Map(
    DEMO_FORECAST_CELLS.map((cell) => [
      `${cell.sheetName}:${cell.address}`,
      cell.value,
    ]),
  );
  assert.deepEqual(demoForecastSeedChanges(demoWorkbook(filled)), []);
});

test("편집할 수 없는 칸은 건너뛴다", () => {
  const workbook = demoWorkbook();
  const changes = demoForecastSeedChanges({
    ...workbook,
    editableCells: workbook.editableCells.slice(1),
  });
  assert.equal(changes.length, DEMO_FORECAST_CELLS.length - 1);
});

test("다른 기업 모델에는 아무것도 쓰지 않는다", () => {
  // 시트 이름이 하나도 안 맞으면(다른 리서치사·다른 종목) 0건이어야 한다.
  // sheetId로 찾으면 엉뚱한 시트에 값을 써 넣게 된다.
  const changes = demoForecastSeedChanges(
    readModel({
      sheets: [
        {
          sheetId: "sheet_1",
          name: "ISC_실적추정",
          cells: [{ address: "L12", rawValue: null }],
        },
      ],
      editable: [{ sheetId: "sheet_1", address: "L12" }],
    }),
  );
  assert.deepEqual(changes, []);
});

test("시연 Target PER이 유효 범위와 형식을 지킨다", () => {
  // 형식이나 범위를 벗어나면 `updateValuationDraft`가 400으로 거절해 시드가
  // 통째로 실패하고, STEP 06에서 `VALUATION_DRAFT_REQUIRED`가 남는다.
  assert.equal(canonicalTargetPer(DEMO_TARGET_PER), DEMO_TARGET_PER);
});

test("시연 Target PER이 현재주가 위의 목표주가를 만든다", () => {
  // 목표주가가 현재주가보다 낮으면 상승여력이 음수가 되어 STEP 03 강세
  // 투자의견·STEP 07 보고서와 정면으로 어긋난다. Excel의 Peer 평균(27.82배)을
  // 그대로 쓰면 실제로 그렇게 된다.
  const forwardEps = 3033;
  const currentPrice = 109_400;
  const targetPrice =
    Math.round((Number(DEMO_TARGET_PER) * forwardEps) / 1000) * 1000;
  assert.ok(
    targetPrice > currentPrice,
    `목표주가 ${targetPrice}원이 현재주가 ${currentPrice}원보다 낮다`,
  );
});

test("시연 값에 중복 셀이 없다", () => {
  // 한 요청에 같은 셀이 두 번 들어가면 API가 DUPLICATE_CELL_ADDRESS로 거절한다.
  const keys = DEMO_FORECAST_CELLS.map(
    (cell) => `${cell.sheetName}:${cell.address}`,
  );
  assert.equal(new Set(keys).size, keys.length);
});
