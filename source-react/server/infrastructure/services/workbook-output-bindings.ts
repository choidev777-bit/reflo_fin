import type { TransactionClient } from "../database/transaction";

export type RequiredWorkbookOutputBinding = {
  targetId: string;
  metric: "forward_eps" | "target_per" | "target_price";
  sheetId: string;
  sheetName: string;
  address: string;
  expectedFormulaHash: string | null;
  expectedStructureFingerprint: string | null;
};

export function isValuationOutputCandidate(input: {
  metric: "eps" | "per" | "target_price";
  sheetName: string;
  label: string | null;
}): boolean {
  if (input.metric !== "per") return true;
  return (
    /^M2_/i.test(input.sheetName) &&
    /(?:적정|target|적용).*(?:p\s*\/?\s*e|per)/i.test(input.label ?? "")
  );
}

export async function loadRequiredWorkbookOutputBindings(
  client: TransactionClient,
  mappingSetResourceVersionId: string,
): Promise<RequiredWorkbookOutputBinding[]> {
  const result = await client.query<{
    mapping_entry_id: string;
    semantic_metric: "eps" | "per" | "target_price";
    sheet_id: string | null;
    sheet_name: string | null;
    address: string | null;
    label: string | null;
    expected_formula_hash: string | null;
    expected_structure_fingerprint: string | null;
  }>(
    `SELECT entry.mapping_entry_id, entry.semantic_metric, candidate.sheet_id,
       candidate.sheet_name, candidate.address, candidate.label,
       entry.source_json->>'formulaHash' AS expected_formula_hash,
       entry.source_json->>'structureFingerprint'
         AS expected_structure_fingerprint
     FROM mapping_entry entry
     JOIN mapping_candidate candidate
       ON candidate.mapping_candidate_id = entry.selected_candidate_id
     WHERE entry.mapping_set_version_id = $1
       AND entry.mapping_status = 'confirmed'
       AND entry.binding_kind = 'scalar'
       AND candidate.source_type = 'cell'
       AND entry.semantic_metric IN ('eps', 'per', 'target_price')`,
    [mappingSetResourceVersionId],
  );
  const metricNames = {
    eps: "forward_eps",
    per: "target_per",
    target_price: "target_price",
  } as const;
  const bindings = result.rows.flatMap((row) => {
    if (
      !row.sheet_id ||
      !row.sheet_name ||
      !row.address ||
      !isValuationOutputCandidate({
        metric: row.semantic_metric,
        sheetName: row.sheet_name,
        label: row.label,
      }) ||
      !/^[A-Z]{1,3}[1-9]\d{0,6}$/.test(row.address)
    ) {
      return [];
    }
    return [
      {
        targetId: row.mapping_entry_id,
        metric: metricNames[row.semantic_metric],
        sheetId: row.sheet_id,
        sheetName: row.sheet_name,
        address: row.address,
        expectedFormulaHash: row.expected_formula_hash,
        expectedStructureFingerprint:
          row.expected_structure_fingerprint,
      },
    ];
  });
  if (
    bindings.length !== 3 ||
    new Set(bindings.map((binding) => binding.metric)).size !== 3
  ) {
    return [];
  }
  return bindings;
}
