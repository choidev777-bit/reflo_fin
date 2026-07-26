import Decimal from "decimal.js";
import { contentHash } from "./hash";
import { ApiError } from "../http/api-error";
import {
  canonicalValidatedDecimal,
  canonicalValidationPeriod,
  canonicalValidationScope,
  convertValidatedDecimal,
} from "./validated-value-normalization";

export type ValidationTarget = {
  targetId: string;
  sheetId?: string;
  sheetName?: string;
  address?: string;
  metric: string;
  period: string;
  unit: string;
  scope: string;
  valueKind: string;
  required: boolean;
  included: boolean;
};

export type ValidationValueResult = {
  resultId: string;
  targetId: string;
  machineStatus: "passed" | "failed" | "needs_review" | "stale";
  exceptionStatus: string;
  valueOriginal: string | null;
  valueNormalized: string | null;
  unit: string | null;
  period: string | null;
  scope: string | null;
  valueKind: string | null;
  evidenceIds: string[];
  authoritySource: {
    sourceType:
      | "filing"
      | "company"
      | "market_data"
      | "workbook"
      | "user_decision";
    sourceId: string;
    locator?: Record<string, unknown>;
  };
  conflictDecision: {
    status:
      | "no_conflict"
      | "selected_authority"
      | "manual_resolution"
      | "unresolved";
    reason: string;
    discardedEvidenceIds: string[];
  };
  qualifiedDecision?: {
    decisionId: string;
    status: "accepted";
    reason: string;
  };
};

export type ValidatedTypedValue = {
  valueType:
    | "decimal"
    | "money"
    | "percent"
    | "integer"
    | "date"
    | "string"
    | "boolean"
    | "null";
  value: string | boolean | null;
  unit?: string;
};

export type ValidatedValue = {
  targetId: string;
  semanticKey: {
    metric: string;
    period: string;
    unit: string;
    scope: string;
  };
  originalValue: ValidatedTypedValue;
  normalizedValue: ValidatedTypedValue;
  selectedEvidenceIds: string[];
  authoritySource: ValidationValueResult["authoritySource"];
  cutoffDate: string;
  conversionRule: {
    rule:
      | "identity"
      | "unit_scale"
      | "currency_conversion"
      | "ratio_conversion"
      | "manual";
    scale: string;
    offset: string;
    roundingMode:
      | "none"
      | "half_up"
      | "half_even"
      | "floor"
      | "ceiling"
      | "truncate";
    note?: string;
  };
  conflictResolutionDecision: {
    status: "no_conflict" | "selected_authority" | "manual_resolution";
    reason: string;
    discardedEvidenceIds: string[];
  };
  validationVersion: number;
};

export type ValidatedValueSet = {
  schemaVersion: "1.0";
  validatedValueSetId: string;
  validationVersion: number;
  sourceSnapshotId: string;
  sourceFingerprint: string;
  status: "approved" | "obsolete";
  values: ValidatedValue[];
  contentHash: string;
  createdAt: string;
  tool: { name: "reflo-validation"; version: "workbook-application-v1" };
};

export type WorkbookInputBinding = {
  targetId: string;
  purpose: "workbook_input" | "report_output";
  sheetId: string;
  sheetName: string;
  address: string;
  expectedStructureFingerprint: string | null;
};

export type WorkbookApplicationCell = {
  sheetId: string;
  sheetName: string;
  address: string;
  valueType: string;
  rawValue: string | null;
  formattedText: string;
  formula: string | null;
  editable: boolean;
  structureFingerprint: string | null;
};

export function mergeWorkbookApplicationCells(
  editablePlaceholders: WorkbookApplicationCell[],
  analyzedCells: WorkbookApplicationCell[],
): WorkbookApplicationCell[] {
  return [
    ...new Map(
      [...editablePlaceholders, ...analyzedCells].map((cell) => [
        `${cell.sheetId}:${cell.address.toUpperCase()}`,
        { ...cell, address: cell.address.toUpperCase() },
      ]),
    ).values(),
  ];
}

export type WorkbookPatchCommand = {
  targetId: string;
  semanticKey?: {
    metric: string;
    period: string;
    unit: string;
    scope: string;
  };
  sheetId: string;
  sheetName: string;
  address: string;
  valueType: "number" | "string" | "boolean" | "blank";
  beforeValue: string | null;
  afterValue: string | null;
  evidenceIds: string[];
  expectedStructureFingerprint: string | null;
  generatedBridge: boolean;
};

export type WorkbookWriteDecisionAction =
  | "approve"
  | "reject"
  | "modify";

export type ResolvedWorkbookWriteDecision = {
  action: WorkbookWriteDecisionAction;
  effectiveCommand: WorkbookPatchCommand | null;
};

export type WorkbookApplicationBlocker = {
  targetId: string;
  reasonCode:
    | "WORKBOOK_INPUT_BINDING_MISSING"
    | "CELL_NOT_APPROVED"
    | "CELL_NOT_FOUND"
    | "FORMULA_CELL_WRITE_FORBIDDEN"
    | "CELL_NOT_EDITABLE"
    | "CELL_STRUCTURE_CHANGED";
  sheetId: string | null;
  address: string | null;
};

export type WorkbookApplicationPlan = {
  schemaVersion: "1.0";
  applicationId: string;
  sourceSnapshotId: string;
  sourceFingerprint: string;
  sourceWorkbookResourceVersionId: string;
  sourceWorkbookArtifactId: string;
  inputWorkbookVersion: number;
  structureHash: string;
  validatedValueSetId: string;
  validatedValueSetContentHash: string;
  commands: WorkbookPatchCommand[];
  blocked: WorkbookApplicationBlocker[];
  planHash: string;
};

export type WorkbookApplicationWorkerResult = {
  workbookBase64: string;
  workbookHash: string;
  engineName: string;
  engineVersion: string;
  changedCells: Array<{
    sheetId: string;
    address: string;
    beforeValue: string | null;
    afterValue: string | null;
  }>;
  structureHashBefore: string;
  structureHashAfter: string;
  formulaHashBefore: string;
  formulaHashAfter: string;
  protectedPartHashesBefore: Record<string, string>;
  protectedPartHashesAfter: Record<string, string>;
  calculationErrors: Array<Record<string, unknown>>;
  unsupportedFunctions: string[];
  outputs: {
    forwardEps: string | null;
    targetPer: string | null;
    targetPrice: string | null;
  };
};

export function workbookApplicationResultDisposition(input: {
  applicationStatus: string;
  jobStatus: string;
  jobAttempt: number;
  resultAttempt: number;
  jobValidity: string;
  valueStatus: string;
  valueValidity: string;
  sourceFingerprint: string;
  currentSourceFingerprint: string | null;
  validationRunId: string;
  currentValidationRunId: string | null;
  validationVersion: number;
  currentValidationVersion: number | null;
  approvedPlanResourceVersionId: string;
  currentApprovedPlanResourceVersionId: string | null;
}): "duplicate" | "terminal" | "obsolete" | "publish" {
  if (input.applicationStatus === "succeeded") return "duplicate";
  if (
    !["queued", "running"].includes(input.applicationStatus) ||
    !["queued", "running"].includes(input.jobStatus)
  ) {
    return "terminal";
  }
  if (
    input.jobAttempt !== input.resultAttempt ||
    input.jobValidity !== "current" ||
    input.valueStatus !== "approved" ||
    input.valueValidity !== "current" ||
    input.currentSourceFingerprint !== input.sourceFingerprint ||
    input.currentValidationRunId !== input.validationRunId ||
    input.currentValidationVersion !== input.validationVersion ||
    input.currentApprovedPlanResourceVersionId !==
      input.approvedPlanResourceVersionId
  ) {
    return "obsolete";
  }
  return "publish";
}

function fail(
  status: number,
  code: string,
  message: string,
  path = "workbookApplication",
): never {
  throw new ApiError(status, code, message, {
    details: [{ path, code, message }],
  });
}

function targetResult(
  target: ValidationTarget,
  results: ValidationValueResult[],
): ValidationValueResult | null {
  const matches = results.filter((result) => result.targetId === target.targetId);
  if (matches.length > 1) {
    return fail(
      409,
      "VALIDATED_VALUE_AMBIGUOUS",
      `${target.targetId}에 둘 이상의 검증 결과가 남아 있습니다.`,
      target.targetId,
    );
  }
  const result = matches[0] ?? null;
  if (!result && target.required && target.included) {
    return fail(
      409,
      "VALIDATED_VALUE_MISSING",
      `${target.targetId}의 승인된 검증 값이 없습니다.`,
      target.targetId,
    );
  }
  return result;
}

export function createValidatedValueSet(input: {
  validatedValueSetId: string;
  validationVersion: number;
  sourceSnapshotId: string;
  sourceFingerprint: string;
  cutoffDate: string;
  targets: ValidationTarget[];
  results: ValidationValueResult[];
  createdAt?: string;
}): ValidatedValueSet {
  if (
    !Number.isInteger(input.validationVersion) ||
    input.validationVersion < 1 ||
    !/^[a-f0-9]{64}$/.test(input.sourceFingerprint) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(input.cutoffDate)
  ) {
    return fail(
      400,
      "VALIDATED_VALUE_SET_INVALID",
      "검증 값 집합의 버전 또는 source snapshot이 올바르지 않습니다.",
    );
  }

  const values = input.targets
    .filter((target) => target.included)
    .flatMap((target): ValidatedValue[] => {
      const result = targetResult(target, input.results);
      if (!result) return [];
      if (
        result.exceptionStatus === "REJECTED" ||
        result.exceptionStatus === "REINVESTIGATION_REQUESTED" ||
        result.exceptionStatus === "REINVESTIGATING" ||
        result.exceptionStatus === "SUPERSEDED" ||
        result.machineStatus === "failed" ||
        result.machineStatus === "stale"
      ) {
        return fail(
          409,
          "VALIDATED_VALUE_NOT_APPROVED",
          `${target.targetId}의 검증 결과를 승인 값으로 사용할 수 없습니다.`,
          target.targetId,
        );
      }
      if (
        result.machineStatus === "needs_review" &&
        result.qualifiedDecision?.status !== "accepted"
      ) {
        return fail(
          409,
          "QUALIFIED_VALUE_DECISION_REQUIRED",
          `${target.targetId}의 조건부 검증 한계를 먼저 확인해주세요.`,
          target.targetId,
        );
      }
      if (result.conflictDecision.status === "unresolved") {
        return fail(
          409,
          "VALIDATED_VALUE_CONFLICT_UNRESOLVED",
          `${target.targetId}의 권위 출처 충돌이 해결되지 않았습니다.`,
          target.targetId,
        );
      }
      if (
        !result.valueOriginal ||
        !result.valueNormalized ||
        !result.unit ||
        !result.period ||
        !result.scope ||
        result.evidenceIds.length === 0
      ) {
        return fail(
          422,
          "VALIDATED_VALUE_INCOMPLETE",
          `${target.targetId}의 값 또는 provenance가 불완전합니다.`,
          target.targetId,
        );
      }
      if (
        canonicalValidationPeriod(result.period) !==
          canonicalValidationPeriod(target.period) ||
        canonicalValidationScope(result.scope) !==
          canonicalValidationScope(target.scope) ||
        result.valueKind !== target.valueKind
      ) {
        return fail(
          422,
          "VALIDATED_VALUE_DIMENSION_MISMATCH",
          `${target.targetId}의 기간·범위·값 종류가 Excel target과 다릅니다.`,
          target.targetId,
        );
      }
      const converted = convertValidatedDecimal(
        result.valueNormalized,
        result.unit,
        target.unit,
      );
      const original = canonicalValidatedDecimal(result.valueOriginal);
      return [
        {
          targetId: target.targetId,
          semanticKey: {
            metric: target.metric,
            period: canonicalValidationPeriod(target.period),
            unit: converted.targetUnit,
            scope: canonicalValidationScope(target.scope),
          },
          originalValue: {
            valueType: "decimal",
            value: original,
            unit: converted.sourceUnit,
          },
          normalizedValue: {
            valueType: "decimal",
            value: converted.value,
            unit: converted.targetUnit,
          },
          selectedEvidenceIds: [...new Set(result.evidenceIds)].sort(),
          authoritySource: result.authoritySource,
          cutoffDate: input.cutoffDate,
          conversionRule: {
            rule: converted.rule,
            scale: converted.scale,
            offset: "0",
            roundingMode: "none",
          },
          conflictResolutionDecision: {
            status: result.conflictDecision.status,
            reason: result.conflictDecision.reason,
            discardedEvidenceIds: [
              ...new Set(result.conflictDecision.discardedEvidenceIds),
            ].sort(),
          },
          validationVersion: input.validationVersion,
        },
      ];
    })
    .sort((left, right) => left.targetId.localeCompare(right.targetId));

  if (values.length === 0) {
    return fail(
      409,
      "VALIDATED_VALUE_SET_EMPTY",
      "Workbook에 적용할 승인 값이 없습니다.",
    );
  }
  const createdAt = input.createdAt ?? new Date().toISOString();
  const withoutHash = {
    schemaVersion: "1.0" as const,
    validatedValueSetId: input.validatedValueSetId,
    validationVersion: input.validationVersion,
    sourceSnapshotId: input.sourceSnapshotId,
    sourceFingerprint: input.sourceFingerprint,
    status: "approved" as const,
    values,
    createdAt,
    tool: {
      name: "reflo-validation" as const,
      version: "workbook-application-v1" as const,
    },
  };
  return { ...withoutHash, contentHash: contentHash(withoutHash) };
}

function patchValue(value: ValidatedTypedValue): {
  valueType: WorkbookPatchCommand["valueType"];
  value: string | null;
} {
  if (value.valueType === "null") return { valueType: "blank", value: null };
  if (value.valueType === "boolean") {
    return {
      valueType: "boolean",
      value: value.value === true ? "true" : "false",
    };
  }
  if (
    value.valueType === "decimal" ||
    value.valueType === "money" ||
    value.valueType === "percent" ||
    value.valueType === "integer"
  ) {
    return { valueType: "number", value: String(value.value) };
  }
  return { valueType: "string", value: String(value.value ?? "") };
}

function bridgeCommand(
  value: ValidatedValue,
  row: number,
): WorkbookPatchCommand {
  const patch = patchValue(value.normalizedValue);
  return {
    targetId: value.targetId,
    semanticKey: value.semanticKey,
    sheetId: "_REFLO_BRIDGE",
    sheetName: "_REFLO_BRIDGE",
    address: `B${row}`,
    valueType: patch.valueType,
    beforeValue: null,
    afterValue: patch.value,
    evidenceIds: value.selectedEvidenceIds,
    expectedStructureFingerprint: null,
    generatedBridge: true,
  };
}

function equivalentPatchValue(
  command: WorkbookPatchCommand,
  proposedAfterValue: string | null | undefined,
): boolean {
  if (proposedAfterValue === undefined) return false;
  if (command.valueType === "blank") {
    return command.afterValue === null && proposedAfterValue === null;
  }
  if (command.afterValue === null || proposedAfterValue === null) {
    return false;
  }
  if (command.valueType === "number") {
    try {
      return new Decimal(command.afterValue).equals(
        new Decimal(proposedAfterValue),
      );
    } catch {
      return false;
    }
  }
  return command.afterValue === proposedAfterValue;
}

export function resolveWorkbookWriteDecision(
  command: WorkbookPatchCommand,
  input: {
    action: WorkbookWriteDecisionAction;
    proposedAfterValue: string | null | undefined;
  },
): ResolvedWorkbookWriteDecision {
  if (input.action === "approve") {
    return { action: "approve", effectiveCommand: command };
  }
  if (input.action === "reject") {
    return { action: "reject", effectiveCommand: null };
  }
  if (!equivalentPatchValue(command, input.proposedAfterValue)) {
    return fail(
      422,
      "WORKBOOK_VALUE_CHANGE_REQUIRES_REVALIDATION",
      "검증 값 자체를 바꾸려면 Evidence 검증 단계에서 새 버전을 만들어주세요.",
    );
  }
  return { action: "modify", effectiveCommand: command };
}

export function createWorkbookApplicationPlan(input: {
  applicationId: string;
  sourceSnapshotId: string;
  sourceFingerprint: string;
  sourceWorkbookResourceVersionId: string;
  sourceWorkbookArtifactId: string;
  inputWorkbookVersion: number;
  structureHash: string;
  validatedValueSet: ValidatedValueSet;
  bindings: WorkbookInputBinding[];
  cells: WorkbookApplicationCell[];
  bridgeFallback?: boolean;
}): WorkbookApplicationPlan {
  if (
    input.validatedValueSet.status !== "approved" ||
    input.validatedValueSet.sourceSnapshotId !== input.sourceSnapshotId ||
    input.validatedValueSet.sourceFingerprint !== input.sourceFingerprint
  ) {
    return fail(
      409,
      "SOURCE_FINGERPRINT_MISMATCH",
      "검증 값과 Workbook source snapshot이 다릅니다.",
    );
  }
  const cellByKey = new Map(
    input.cells.map((cell) => [
      `${cell.sheetId}:${cell.address.toUpperCase()}`,
      cell,
    ]),
  );
  const commands: WorkbookPatchCommand[] = [];
  const blocked: WorkbookApplicationBlocker[] = [];
  let bridgeRow = 2;

  for (const value of input.validatedValueSet.values) {
    const binding = input.bindings.find(
      (candidate) => candidate.targetId === value.targetId,
    );
    if (!binding) {
      if (input.bridgeFallback) {
        commands.push(bridgeCommand(value, bridgeRow));
        bridgeRow += 1;
      } else {
        blocked.push({
          targetId: value.targetId,
          reasonCode: "WORKBOOK_INPUT_BINDING_MISSING",
          sheetId: null,
          address: null,
        });
      }
      continue;
    }
    if (binding.purpose !== "workbook_input") {
      blocked.push({
        targetId: value.targetId,
        reasonCode: "CELL_NOT_APPROVED",
        sheetId: binding.sheetId,
        address: binding.address,
      });
      continue;
    }
    const cell = cellByKey.get(
      `${binding.sheetId}:${binding.address.toUpperCase()}`,
    );
    if (!cell) {
      if (input.bridgeFallback) {
        commands.push(bridgeCommand(value, bridgeRow));
        bridgeRow += 1;
      } else {
        blocked.push({
          targetId: value.targetId,
          reasonCode: "CELL_NOT_FOUND",
          sheetId: binding.sheetId,
          address: binding.address,
        });
      }
      continue;
    }
    const blocker =
      cell.formula || cell.valueType === "formula"
        ? "FORMULA_CELL_WRITE_FORBIDDEN"
        : !cell.editable
          ? "CELL_NOT_EDITABLE"
          : binding.expectedStructureFingerprint &&
              cell.structureFingerprint !== binding.expectedStructureFingerprint
            ? "CELL_STRUCTURE_CHANGED"
            : null;
    if (blocker) {
      blocked.push({
        targetId: value.targetId,
        reasonCode: blocker,
        sheetId: binding.sheetId,
        address: binding.address,
      });
      continue;
    }
    const patch = patchValue(value.normalizedValue);
    commands.push({
      targetId: value.targetId,
      sheetId: binding.sheetId,
      sheetName: binding.sheetName,
      address: binding.address.toUpperCase(),
      valueType: patch.valueType,
      beforeValue: cell.rawValue,
      afterValue: patch.value,
      evidenceIds: value.selectedEvidenceIds,
      expectedStructureFingerprint:
        binding.expectedStructureFingerprint ?? cell.structureFingerprint,
      generatedBridge: false,
    });
  }

  commands.sort((left, right) =>
    `${left.sheetId}:${left.address}:${left.targetId}`.localeCompare(
      `${right.sheetId}:${right.address}:${right.targetId}`,
    ),
  );
  blocked.sort((left, right) => left.targetId.localeCompare(right.targetId));
  const withoutHash = {
    schemaVersion: "1.0" as const,
    applicationId: input.applicationId,
    sourceSnapshotId: input.sourceSnapshotId,
    sourceFingerprint: input.sourceFingerprint,
    sourceWorkbookResourceVersionId: input.sourceWorkbookResourceVersionId,
    sourceWorkbookArtifactId: input.sourceWorkbookArtifactId,
    inputWorkbookVersion: input.inputWorkbookVersion,
    structureHash: input.structureHash,
    validatedValueSetId: input.validatedValueSet.validatedValueSetId,
    validatedValueSetContentHash: input.validatedValueSet.contentHash,
    commands,
    blocked,
  };
  return { ...withoutHash, planHash: contentHash(withoutHash) };
}

function recordHashesEqual(
  left: Record<string, string>,
  right: Record<string, string>,
): boolean {
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key, index) => key === rightKeys[index] && left[key] === right[key],
    )
  );
}

export function validateWorkbookApplicationResult(
  plan: WorkbookApplicationPlan,
  result: WorkbookApplicationWorkerResult,
): {
  outputWorkbookHash: string;
  appliedCellCount: number;
  outputs: WorkbookApplicationWorkerResult["outputs"];
  engine: { name: string; version: string };
} {
  if (plan.blocked.length > 0) {
    return fail(
      409,
      "WORKBOOK_APPLICATION_BLOCKED",
      "차단된 cell이 남아 있어 Workbook 결과를 게시할 수 없습니다.",
    );
  }
  if (
    result.structureHashBefore !== result.structureHashAfter ||
    result.formulaHashBefore !== result.formulaHashAfter ||
    !recordHashesEqual(
      result.protectedPartHashesBefore,
      result.protectedPartHashesAfter,
    )
  ) {
    return fail(
      422,
      "WORKBOOK_STRUCTURE_CHANGED",
      "Workbook 수식·시트·차트·VML 구조가 변경되었습니다.",
    );
  }
  if (result.unsupportedFunctions.length > 0) {
    return fail(
      422,
      "UNSUPPORTED_FORMULA_FUNCTION",
      `지원하지 않는 Excel 함수가 있습니다: ${result.unsupportedFunctions.join(", ")}`,
    );
  }
  if (result.calculationErrors.length > 0) {
    return fail(
      422,
      "FORMULA_CALCULATION_FAILED",
      "Workbook 재계산 오류가 있습니다.",
    );
  }
  const commandByKey = new Map(
    plan.commands.map((command) => [
      `${command.sheetId}:${command.address}`,
      command,
    ]),
  );
  if (
    result.changedCells.length !== plan.commands.length ||
    result.changedCells.some((changed) => {
      const command = commandByKey.get(
        `${changed.sheetId}:${changed.address.toUpperCase()}`,
      );
      return (
        !command ||
        changed.beforeValue !== command.beforeValue ||
        changed.afterValue !== command.afterValue
      );
    })
  ) {
    return fail(
      422,
      "WORKBOOK_SEMANTIC_DIFF_OUTSIDE_ALLOWLIST",
      "승인 cell 외 Workbook 값 변경이 감지되었습니다.",
    );
  }
  if (
    !result.outputs.forwardEps ||
    !result.outputs.targetPer ||
    !result.outputs.targetPrice
  ) {
    return fail(
      422,
      "WORKBOOK_REQUIRED_OUTPUT_MISSING",
      "재계산된 EPS·PER·목표주가를 모두 확인할 수 없습니다.",
    );
  }
  return {
    outputWorkbookHash: result.workbookHash,
    appliedCellCount: result.changedCells.length,
    outputs: result.outputs,
    engine: { name: result.engineName, version: result.engineVersion },
  };
}
