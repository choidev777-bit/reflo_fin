import { createHash } from "node:crypto";
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

export function valuationFormulaHash(formula: string | null): string | null {
  return formula
    ? createHash("sha256").update(formula).digest("hex")
    : null;
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
    const fallback = await client.query<{
      candidate_id: string;
      sheet_id: string;
      sheet_name: string;
      address: string;
      label: string | null;
      formula_hash: string | null;
      formula: string | null;
      structure_fingerprint: string | null;
    }>(
      `SELECT candidate->>'candidateId' AS candidate_id,
         candidate->>'sheetId' AS sheet_id,
         candidate->>'sheetName' AS sheet_name,
         upper(candidate->>'address') AS address,
         candidate->>'label' AS label,
         candidate->>'formulaHash' AS formula_hash,
         candidate->>'formula' AS formula,
         candidate->>'structureFingerprint' AS structure_fingerprint
       FROM mapping_set_version mapping
       JOIN workbook_version workbook
         ON workbook.resource_version_id = mapping.workbook_version_id
       CROSS JOIN LATERAL jsonb_array_elements(
         coalesce(workbook.analysis_json->'candidateCells', '[]'::jsonb)
       ) candidate
       WHERE mapping.resource_version_id = $1
         AND (
           (candidate->>'sheetName' = 'Target PER'
             AND upper(candidate->>'address') IN ('B7', 'B14', 'B15'))
           OR
           (candidate->>'sheetName' LIKE 'M2\\_%' ESCAPE '\\'
             AND upper(candidate->>'address') IN ('C7', 'C10', 'C21'))
         )`,
      [mappingSetResourceVersionId],
    );
    const definitions = [
      {
        metric: "forward_eps" as const,
        labels: /(?:forward|fwd)?\s*eps/i,
        addresses: ["Target PER:B7", "M2:C10"],
      },
      {
        metric: "target_per" as const,
        labels: /(?:target|적정|적용|도출).*(?:p\s*\/?\s*e|per)/i,
        addresses: ["Target PER:B14", "M2:C7"],
      },
      {
        metric: "target_price" as const,
        labels: /(?:목표|적정)\s*주가|target\s*price/i,
        addresses: ["Target PER:B15", "M2:C21"],
      },
    ];
    const resolved = definitions.flatMap((definition) => {
      const candidate = fallback.rows
        .filter((row) => definition.labels.test(row.label ?? ""))
        .sort((left, right) => {
          const rank = (row: typeof left) => {
            const sheetKey = row.sheet_name.startsWith("M2_")
              ? `M2:${row.address}`
              : `${row.sheet_name}:${row.address}`;
            const index = definition.addresses.indexOf(sheetKey);
            return index < 0 ? Number.MAX_SAFE_INTEGER : index;
          };
          return rank(left) - rank(right);
        })[0];
      if (
        !candidate?.candidate_id ||
        !candidate.sheet_id ||
        !candidate.sheet_name ||
        !/^[A-Z]{1,3}[1-9]\d{0,6}$/.test(candidate.address)
      ) {
        return [];
      }
      return [{
        targetId: candidate.candidate_id,
        metric: definition.metric,
        sheetId: candidate.sheet_id,
        sheetName: candidate.sheet_name,
        address: candidate.address,
        expectedFormulaHash:
          candidate.formula_hash ??
          valuationFormulaHash(candidate.formula),
        expectedStructureFingerprint: candidate.structure_fingerprint,
      }];
    });
    if (
      resolved.length === 3 &&
      new Set(resolved.map((binding) => binding.metric)).size === 3
    ) {
      return resolved;
    }
    return [];
  }
  return bindings;
}
