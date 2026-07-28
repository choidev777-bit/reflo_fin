/**
 * 기존 mapping set 백필: EPS·PER·목표주가 밸류에이션 출력 mapping entry 보완.
 *
 * template IR이 EPS·PER scalar slot을 만들지 못한 프로젝트는 mapping entry가
 * 없어 STEP 05(Excel 반영)와 STEP 06(밸류에이션)이 409로 막힌다. 신규 분석은
 * `missingValuationOutputSlots`로 해결되지만, 이미 저장된 mapping set에는
 * entry가 없으므로 같은 로직을 재실행해 누락분만 추가한다.
 *
 * 실행: npx tsx scripts/backfill-valuation-output-mappings.ts [--apply]
 * (--apply 없이 실행하면 변경 없이 대상만 출력한다.)
 */
import { withTransaction } from "../server/infrastructure/database/transaction";
import { uuidv7 } from "../server/domain/ids";
import {
  missingValuationOutputSlots,
  REQUIRED_VALUATION_OUTPUT_METRICS,
} from "../server/domain/valuation-output-slots";
import { buildMappingSet } from "../workers/control/mapping";

const apply = process.argv.includes("--apply");

type TargetRow = {
  mapping_set_version_id: string;
  existing_slot_ids: string[];
  existing_metrics: string[];
};

type PayloadRow = {
  template_ir_json: unknown;
  analysis_json: unknown;
  mapping_json: Record<string, unknown> | null;
};

function recordArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> =>
          typeof item === "object" && item !== null,
      )
    : [];
}

function templateSlots(templateIr: unknown): Array<Record<string, unknown>> {
  const root = templateIr as { pages?: unknown } | null;
  return recordArray(root?.pages).flatMap((page) => recordArray(page.slots));
}

async function main(): Promise<void> {
  // 1단계: 큰 JSON을 읽지 않고 보완 대상만 추린다.
  const rows = await withTransaction(async (client) => {
    const result = await client.query<TargetRow>(
      `SELECT m.resource_version_id AS mapping_set_version_id,
         COALESCE(
           array_agg(e.slot_id) FILTER (WHERE e.slot_id IS NOT NULL),
           '{}'
         ) AS existing_slot_ids,
         COALESCE(
           array_agg(e.semantic_metric)
             FILTER (WHERE e.semantic_metric IS NOT NULL
                       AND e.binding_kind = 'scalar'),
           '{}'
         ) AS existing_metrics
       FROM mapping_set_version m
       LEFT JOIN mapping_entry e
         ON e.mapping_set_version_id = m.resource_version_id
       GROUP BY m.resource_version_id`,
    );
    return result.rows;
  });

  let repaired = 0;
  for (const target of rows) {
    const present = new Set(target.existing_metrics);
    const missingMetrics = REQUIRED_VALUATION_OUTPUT_METRICS.filter(
      (metric) => !present.has(metric),
    );
    if (missingMetrics.length === 0) continue;

    // 2단계: 대상 mapping set에 한해서만 template IR·workbook 분석을 읽는다.
    const row = await withTransaction(async (client) => {
      const result = await client.query<PayloadRow>(
        `SELECT t.template_ir_json, w.analysis_json, m.mapping_json
         FROM mapping_set_version m
         JOIN template_ir_version t
           ON t.resource_version_id = m.template_ir_version_id
         JOIN workbook_version w
           ON w.resource_version_id = m.workbook_version_id
         WHERE m.resource_version_id = $1`,
        [target.mapping_set_version_id],
      );
      return result.rows[0] ?? null;
    });
    if (!row) continue;

    const slots = templateSlots(row.template_ir_json);
    const synthetic = missingValuationOutputSlots(
      slots as Array<{ valueType?: string; semanticKey?: { metric?: string } }>,
    ).filter((slot) => !target.existing_slot_ids.includes(slot.slotId));
    if (synthetic.length === 0) {
      console.log(
        `SKIP ${target.mapping_set_version_id} — 누락 metric ` +
          `${missingMetrics.join(",")} 이나 합성 대상 없음(이미 slot 존재)`,
      );
      continue;
    }

    let built;
    try {
      built = buildMappingSet(
        row.template_ir_json as never,
        row.analysis_json as never,
      );
    } catch (error) {
      console.log(
        `SKIP ${target.mapping_set_version_id} — mapping 재계산 실패: ${
          (error as Error).message
        }`,
      );
      continue;
    }

    const syntheticSlotIds = new Set(synthetic.map((slot) => slot.slotId));
    const bindings = built.mappingSet.bindings.filter((binding) =>
      syntheticSlotIds.has(binding.slotId),
    );
    const candidates = built.mappingSet.candidates.filter((candidate) =>
      syntheticSlotIds.has(candidate.slotId),
    );

    console.log(
      `${apply ? "REPAIR" : "PLAN"} ${target.mapping_set_version_id} — ` +
        `slots=${synthetic.map((slot) => slot.slotId).join(",")} ` +
        `bindings=${bindings.length} candidates=${candidates.length}`,
    );
    if (!apply) continue;

    await withTransaction(async (client) => {
      for (const slot of synthetic) {
        const entryId = uuidv7();
        const binding = bindings.find((item) => item.slotId === slot.slotId);
        const slotCandidates = candidates.filter(
          (item) => item.slotId === slot.slotId,
        );
        await client.query(
          `INSERT INTO mapping_entry (
             mapping_entry_id, mapping_set_version_id, slot_id,
             semantic_metric, binding_kind, value_type, required,
             mapping_status, confidence, source_json, display_json
           ) VALUES ($1, $2, $3, $4, 'scalar', $5, true, $6, $7, $8::jsonb,
             '{}'::jsonb)`,
          [
            entryId,
            target.mapping_set_version_id,
            slot.slotId,
            slot.semanticKey.metric,
            slot.valueType,
            binding ? "confirmed" : "unmapped",
            slotCandidates[0]?.score ?? null,
            binding && "source" in binding
              ? JSON.stringify(binding.source)
              : null,
          ],
        );
        let selectedCandidateId: string | null = null;
        for (const [index, candidate] of slotCandidates.entries()) {
          const candidateId = uuidv7();
          if (candidate.selected) selectedCandidateId = candidateId;
          await client.query(
            `INSERT INTO mapping_candidate (
               mapping_candidate_id, mapping_entry_id, source_type, sheet_id,
               sheet_name, address, label, score, reason_codes, source_json,
               candidate_order
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::text[], $10::jsonb,
               $11)`,
            [
              candidateId,
              entryId,
              candidate.kind,
              candidate.source.sheetId,
              candidate.source.sheet,
              candidate.source.address ?? candidate.source.range ?? "",
              candidate.label ?? null,
              candidate.score,
              candidate.reasonCodes,
              JSON.stringify({ source: candidate.source }),
              index + 1,
            ],
          );
        }
        if (selectedCandidateId) {
          await client.query(
            `UPDATE mapping_entry SET selected_candidate_id = $2
             WHERE mapping_entry_id = $1`,
            [entryId, selectedCandidateId],
          );
        }
      }
      const mappingJson = row.mapping_json ?? {};
      const existingBindings = Array.isArray(mappingJson.bindings)
        ? mappingJson.bindings
        : [];
      const existingCandidates = Array.isArray(mappingJson.candidates)
        ? mappingJson.candidates
        : [];
      await client.query(
        `UPDATE mapping_set_version
         SET mapping_json = $2::jsonb,
             binding_count = binding_count + $3,
             required_slot_count = required_slot_count + $4,
             confirmed_binding_count = confirmed_binding_count + $3
         WHERE resource_version_id = $1`,
        [
          target.mapping_set_version_id,
          JSON.stringify({
            ...mappingJson,
            bindings: [...existingBindings, ...bindings],
            candidates: [...existingCandidates, ...candidates],
          }),
          bindings.length,
          synthetic.length,
        ],
      );
    });
    repaired += 1;
  }
  console.log(
    apply
      ? `완료: mapping set ${repaired}건 보완`
      : `검사한 mapping set ${rows.length}건. 실제 반영은 --apply`,
  );
  process.exit(0);
}

void main();
