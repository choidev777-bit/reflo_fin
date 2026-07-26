import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  materializeReportBindings,
  type ReportMappingBinding,
  type ReportMaterializationContext,
} from "../server/domain/report";

const phase4RepositorySource = readFileSync(
  new URL(
    "../server/infrastructure/repositories/phase4-repository.ts",
    import.meta.url,
  ),
  "utf8",
);
const reportRepositorySource = readFileSync(
  new URL(
    "../server/infrastructure/repositories/report-repository.ts",
    import.meta.url,
  ),
  "utf8",
);

function sourceSection(
  source: string,
  startMarker: string,
  endMarker: string,
): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(start, -1, `${startMarker} 구현을 찾을 수 없습니다.`);
  assert.notEqual(end, -1, `${startMarker} 구현의 끝을 찾을 수 없습니다.`);
  return source.slice(start, end);
}

test("Phase 3: 검증값을 새 Workbook artifact에 실제 반영한다", () => {
  const implementation = sourceSection(
    phase4RepositorySource,
    "export async function getValidationWorkbook",
    "async function updateWorkspaceGate",
  );

  assert.doesNotMatch(
    implementation,
    /readOnly:\s*true/,
    "현재 검증 Workbook은 원본 분석을 읽기 전용으로 다시 노출합니다.",
  );
  assert.doesNotMatch(
    implementation,
    /writeStatus:\s*"pending"/,
    "검증 Evidence binding이 Workbook에 쓰이지 않고 pending으로 남습니다.",
  );
  assert.match(
    implementation,
    /validatedWorkbookArtifactId/,
    "적용된 값을 담은 새 Workbook artifact 계보가 필요합니다.",
  );
});

test("Phase 4: scalar를 원래 PDF slot용 snapshot으로 materialize한다", () => {
  const binding: ReportMappingBinding = {
    slotId: "slot-forward-eps",
    metric: "forward_eps",
    kind: "scalar",
    status: "confirmed",
    sourceLabel: "Valuation!B2",
    sourceAddress: "B2",
    sourceType: "cell",
    sourceSheetId: "sheet-valuation",
    sourceSheetName: "Valuation",
    definition: null,
  };
  const context: ReportMaterializationContext = {
    mappingSetResourceVersionId: "mapping-version-1",
    workbookArtifactId: "workbook-artifact-1",
    workbookVersion: 2,
    readModel: {
      schemaVersion: "1.2",
      workbookHash: "workbook-hash-1",
      sheets: [
        {
          sheetId: "sheet-valuation",
          name: "Valuation",
          cells: [
            {
              address: "B2",
              row: 2,
              column: 2,
              valueType: "number",
              rawValue: "1250",
              formattedText: "1,250",
              formula: "=B1/C1",
              numberFormat: "#,##0",
            },
          ],
        },
      ],
    },
  };

  const snapshot = materializeReportBindings([binding], context)[
    binding.slotId
  ] as unknown as
    | {
        kind: "scalar";
        status: "ready";
        rawValue: string;
        formattedValue: string;
      }
    | undefined;

  assert.ok(snapshot, "scalar binding이 materialization 결과에서 누락됩니다.");
  assert.equal(snapshot.kind, "scalar");
  assert.equal(snapshot.status, "ready");
  assert.equal(snapshot.rawValue, "1250");
  assert.equal(snapshot.formattedValue, "1,250");
});

test.todo("Phase 6 gap: export PDF artifact는 source PDF artifact와 다르다", () => {
  const implementation = sourceSection(
    reportRepositorySource,
    "export async function createReportExport",
    "export async function getReportExport",
  );

  assert.match(
    implementation,
    /renderedPdfArtifactId/,
    "export 전에 RenderPlan으로 새 PDF artifact를 생성해야 합니다.",
  );
  assert.doesNotMatch(
    implementation,
    /context\.sourcePdfArtifactId,\s*uuidv7\(\),\s*context\.workbookArtifactId/,
    "현재 export가 source PDF artifact를 ready 결과로 직접 재사용합니다.",
  );
});
