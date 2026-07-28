/**
 * 이미 만들어진 프로젝트의 빈 전망 연도 열을 시연 값으로 채운다.
 *
 * 새 프로젝트는 `getValuationWorkspace`가 시연 모드에서 자동으로 채우므로
 * 이 스크립트가 필요 없다. 시연 모드를 켜기 **전에** 만들어 둔 프로젝트나,
 * 자동 시드가 일부만 적용된 상태를 확인·복구할 때만 쓴다.
 *
 * 실행:
 *   npx tsx scripts/demo-fill-forecast-column.ts <projectId>            # 계획만
 *   npx tsx scripts/demo-fill-forecast-column.ts <projectId> --apply    # 반영
 */
import { demoForecastSeedChanges } from "../server/domain/demo-valuation-forecast";
import { uuidv7 } from "../server/domain/ids";
import { withTransaction } from "../server/infrastructure/database/transaction";
import {
  getValuationWorkspace,
  missingRequiredCells,
  patchValuationCells,
} from "../server/infrastructure/repositories/valuation-repository";

const projectId = process.argv[2];
const apply = process.argv.includes("--apply");

if (!projectId || !/^[0-9a-f-]{36}$/i.test(projectId)) {
  console.error(
    "projectId가 필요합니다: npx tsx scripts/demo-fill-forecast-column.ts <projectId> [--apply]",
  );
  process.exit(1);
}

async function main(): Promise<void> {
  const found = await withTransaction(async (client) => {
    const result = await client.query<{
      owner_user_id: string;
      read_model_json: Parameters<typeof demoForecastSeedChanges>[0] & {
        editableCells: unknown[];
      };
      workbook_version: string;
      editable_cell_set_version: string;
    }>(
      `SELECT p.owner_user_id, v.read_model_json, v.workbook_version,
         v.editable_cell_set_version
       FROM project p
       LEFT JOIN valuation_workbook v ON v.project_id = p.project_id
       WHERE p.project_id = $1`,
      [projectId],
    );
    return result.rows[0] ?? null;
  });
  if (!found) {
    console.error(`프로젝트를 찾지 못했습니다: ${projectId}`);
    process.exit(1);
  }
  if (!found.read_model_json) {
    console.error(
      "valuation workbook이 아직 없습니다. STEP 06을 한 번 연 뒤 다시 실행해주세요.",
    );
    process.exit(1);
  }

  const readModel = found.read_model_json;
  const changes = demoForecastSeedChanges(readModel);
  const missing = missingRequiredCells(readModel as never);
  const covered = new Set(
    changes.map((change) => `${change.sheetId}:${change.address}`),
  );
  const uncovered = missing
    .map((cell) => `${cell.sheetId}:${cell.address}`)
    .filter((key) => !covered.has(key));

  console.log(`필수 미입력: ${missing.length}칸`);
  console.log(`반영 대상:   ${changes.length}칸`);
  if (uncovered.length > 0) {
    console.log(
      `⚠ 시연 값이 못 덮는 필수 칸 ${uncovered.length}개: ${uncovered.join(", ")}`,
    );
    console.log(
      "  다른 기업·분기 모델이면 demo-valuation-forecast.ts를 새로 만들어야 합니다.",
    );
  }
  if (changes.length === 0) {
    console.log("반영할 변경이 없습니다.");
    process.exit(0);
  }
  if (!apply) {
    console.log("실제 반영은 --apply");
    process.exit(0);
  }

  const result = (await patchValuationCells({
    projectId,
    userId: found.owner_user_id,
    workbookVersion: Number(found.workbook_version),
    editableCellSetVersion: Number(found.editable_cell_set_version),
    requestId: uuidv7(),
    changes,
  })) as {
    workbookVersion: number;
    outputDiff: Record<string, { afterFormatted: string | null }>;
  };

  console.log(`완료: workbook v${result.workbookVersion}`);
  console.log(
    `  Forward EPS ${result.outputDiff.forwardEps?.afterFormatted ?? "—"} · ` +
      `Target PER ${result.outputDiff.targetPer?.afterFormatted ?? "—"} · ` +
      `목표주가 ${result.outputDiff.targetPrice?.afterFormatted ?? "—"}`,
  );

  const after = await getValuationWorkspace(projectId!, found.owner_user_id);
  console.log(`남은 blocker: ${after.completion.blockers.join(", ") || "없음"}`);
  process.exit(0);
}

void main();
