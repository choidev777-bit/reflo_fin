import assert from "node:assert/strict";
import test from "node:test";
import {
  createValidatedValueSet,
  createWorkbookApplicationPlan,
  finalizeWorkbookApplicationPlan,
  mergeWorkbookApplicationCells,
  resolveWorkbookWriteDecision,
  validateWorkbookApplicationResult,
  workbookApplicationResultDisposition,
  type ValidatedValueSet,
} from "../server/domain/workbook-application";
import {
  canonicalValidationPeriod,
  canonicalValidationScope,
  canonicalValidationValueKind,
  convertValidatedDecimal,
} from "../server/domain/validated-value-normalization";
import { ApiError } from "../server/http/api-error";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

test("terminal·stale Workbook 결과는 publish하지 않는다", () => {
  const current = {
    applicationStatus: "running",
    jobStatus: "running",
    jobAttempt: 1,
    resultAttempt: 1,
    jobValidity: "current",
    valueStatus: "approved",
    valueValidity: "current",
    sourceFingerprint: HASH_A,
    currentSourceFingerprint: HASH_A,
    validationRunId: "validation-run-1",
    currentValidationRunId: "validation-run-1",
    validationVersion: 3,
    currentValidationVersion: 3,
    approvedPlanResourceVersionId: "plan-1",
    currentApprovedPlanResourceVersionId: "plan-1",
  };
  assert.equal(workbookApplicationResultDisposition(current), "publish");
  assert.equal(
    workbookApplicationResultDisposition({
      ...current,
      applicationStatus: "failed",
      jobStatus: "failed",
    }),
    "terminal",
  );
  assert.equal(
    workbookApplicationResultDisposition({
      ...current,
      currentValidationRunId: "validation-run-2",
    }),
    "obsolete",
  );
  assert.equal(
    workbookApplicationResultDisposition({
      ...current,
      currentApprovedPlanResourceVersionId: "plan-2",
    }),
    "obsolete",
  );
});

test("editable placeholder가 실제 cell의 before·formula·구조 정보를 덮어쓰지 않는다", () => {
  const cells = mergeWorkbookApplicationCells(
    [
      {
        sheetId: "sheet-input",
        sheetName: "Valuation",
        address: "b2",
        valueType: "blank",
        rawValue: null,
        formattedText: "",
        formula: null,
        editable: true,
        structureFingerprint: null,
      },
    ],
    [
      {
        sheetId: "sheet-input",
        sheetName: "Valuation",
        address: "B2",
        valueType: "formula",
        rawValue: "1250",
        formattedText: "1,250",
        formula: "SUM(B3:B4)",
        editable: true,
        structureFingerprint: HASH_B,
      },
    ],
  );

  assert.deepEqual(cells, [
    {
      sheetId: "sheet-input",
      sheetName: "Valuation",
      address: "B2",
      valueType: "formula",
      rawValue: "1250",
      formattedText: "1,250",
      formula: "SUM(B3:B4)",
      editable: true,
      structureFingerprint: HASH_B,
    },
  ]);
});

function validatedValueSet(): ValidatedValueSet {
  return createValidatedValueSet({
    validatedValueSetId: "validated-values-1",
    validationVersion: 3,
    sourceSnapshotId: "snapshot-1",
    sourceFingerprint: HASH_A,
    cutoffDate: "2026-05-20",
    targets: [
      {
        targetId: "target-revenue",
        metric: "revenue",
        period: "2026년 1분기",
        unit: "백만원",
        scope: "연결",
        valueKind: "actual",
        required: true,
        included: true,
      },
    ],
    results: [
      {
        resultId: "result-revenue",
        targetId: "target-revenue",
        machineStatus: "passed",
        exceptionStatus: "AVAILABLE",
        valueOriginal: "12.5",
        valueNormalized: "12.5",
        unit: "억원",
        period: "2026Q1",
        scope: "consolidated",
        valueKind: "actual",
        evidenceIds: ["evidence-1"],
        authoritySource: {
          sourceType: "filing",
          sourceId: "source-version-1",
        },
        conflictDecision: {
          status: "no_conflict",
          reason: "검증된 단일 권위 출처",
          discardedEvidenceIds: [],
        },
      },
    ],
    createdAt: "2026-07-26T00:00:00.000Z",
  });
}

test("DART 범위 코드(CFS/OFS)를 라벨(연결/별도)과 동일하게 정규화한다", () => {
  // Excel 축 검증값은 scope에 코드(CFS)를, target은 라벨(연결)을 저장한다. 두 표현이
  // 같은 범위로 취급돼야 workbook 준비 시 VALIDATED_VALUE_DIMENSION_MISMATCH가 안 난다.
  assert.equal(canonicalValidationScope("CFS"), canonicalValidationScope("연결"));
  assert.equal(canonicalValidationScope("OFS"), canonicalValidationScope("별도"));
  assert.equal(canonicalValidationScope("cfs"), "연결");
  assert.equal(canonicalValidationScope("ofs"), "별도");
});

test("period/scope/valueKind 표현 차이를 흡수해 불필요한 DIMENSION_MISMATCH를 막는다", () => {
  // 분기-선행 단축연도, 전망 접미사, 연간/사업연도 folding
  assert.equal(canonicalValidationPeriod("2Q26"), "2026년 2분기");
  assert.equal(canonicalValidationPeriod("1Q26F"), "2026년 1분기");
  assert.equal(canonicalValidationPeriod("2027F"), "2027년");
  assert.equal(
    canonicalValidationPeriod("2025년 연간"),
    canonicalValidationPeriod("2025 사업연도"),
  );
  assert.equal(canonicalValidationPeriod("FY2025"), "2025년");
  // PDF 원문 제목 scope와 DART 코드/라벨을 같은 범위로 판정
  assert.equal(canonicalValidationScope("연결재무상태표"), "연결");
  assert.equal(canonicalValidationScope("CFS"), canonicalValidationScope("연결"));
  // 잠정 실적은 확정 실적 target을 충족, null은 실적, 전망 계열은 forecast
  assert.equal(canonicalValidationValueKind("preliminary_actual"), "actual");
  assert.equal(canonicalValidationValueKind(null), "actual");
  assert.equal(canonicalValidationValueKind("E"), "forecast");
  assert.equal(canonicalValidationValueKind("전망"), "forecast");
  // 단위 코드/별칭: 퍼센트, 배수, 남은 통화 코드
  assert.equal(convertValidatedDecimal("5", "퍼센트", "%").value, "5");
  assert.equal(convertValidatedDecimal("10", "배수", "배").rule, "identity");
  assert.equal(
    convertValidatedDecimal("1", "KRW_TRILLION", "조원").rule,
    "identity",
  );
});

test("targetUnit 코드형(KRW_BILLION 등)을 원화 스케일 단위로 인식·변환한다", () => {
  // Excel 축 검증값 unit은 코드형(KRW_BILLION)으로 오는데 정규화 맵엔 라벨과 krw만
  // 있어 "지원하지 않는 단위"로 실패했다. 코드형 별칭을 인식해 변환할 수 있어야 한다.
  assert.equal(
    convertValidatedDecimal("346.31416369", "KRW_BILLION", "KRW_MILLION").value,
    "346314.16369",
  );
  assert.equal(
    convertValidatedDecimal("1", "KRW_100M", "억원").rule,
    "identity",
  );
});

test("Evidence를 target 단위·기간·범위로 정규화한 불변 ValidatedValueSet으로 만든다", () => {
  const valueSet = validatedValueSet();

  assert.equal(valueSet.status, "approved");
  assert.equal(valueSet.values.length, 1);
  assert.deepEqual(valueSet.values[0], {
    targetId: "target-revenue",
    semanticKey: {
      metric: "revenue",
      period: "2026년 1분기",
      unit: "백만원",
      scope: "연결",
    },
    originalValue: {
      valueType: "decimal",
      value: "12.5",
      unit: "억원",
    },
    normalizedValue: {
      valueType: "decimal",
      value: "1250",
      unit: "백만원",
    },
    selectedEvidenceIds: ["evidence-1"],
    authoritySource: {
      sourceType: "filing",
      sourceId: "source-version-1",
    },
    cutoffDate: "2026-05-20",
    conversionRule: {
      rule: "unit_scale",
      scale: "100",
      offset: "0",
      roundingMode: "none",
    },
    conflictResolutionDecision: {
      status: "no_conflict",
      reason: "검증된 단일 권위 출처",
      discardedEvidenceIds: [],
    },
    validationVersion: 3,
  });
  assert.match(valueSet.contentHash, /^[a-f0-9]{64}$/);
});

test("기간·범위 불일치와 미해결 conflict는 승인 값 집합을 만들지 않는다", () => {
  const base = {
    validatedValueSetId: "validated-values-1",
    validationVersion: 3,
    sourceSnapshotId: "snapshot-1",
    sourceFingerprint: HASH_A,
    cutoffDate: "2026-05-20",
    targets: [
      {
        targetId: "target-revenue",
        metric: "revenue",
        period: "2026년 1분기",
        unit: "백만원",
        scope: "연결",
        valueKind: "actual" as const,
        required: true,
        included: true,
      },
    ],
    createdAt: "2026-07-26T00:00:00.000Z",
  };
  const result = {
    resultId: "result-revenue",
    targetId: "target-revenue",
    machineStatus: "passed" as const,
    exceptionStatus: "AVAILABLE",
    valueOriginal: "12.5",
    valueNormalized: "12.5",
    unit: "억원",
    period: "2025Q4",
    scope: "별도",
    valueKind: "actual",
    evidenceIds: ["evidence-1"],
    authoritySource: {
      sourceType: "filing" as const,
      sourceId: "source-version-1",
    },
    conflictDecision: {
      status: "no_conflict" as const,
      reason: "검증된 단일 권위 출처",
      discardedEvidenceIds: [],
    },
  };

  assert.throws(
    () => createValidatedValueSet({ ...base, results: [result] }),
    (error) =>
      error instanceof ApiError &&
      error.code === "VALIDATED_VALUE_DIMENSION_MISMATCH",
  );
  assert.throws(
    () =>
      createValidatedValueSet({
        ...base,
        results: [
          {
            ...result,
            period: "2026년 1분기",
            scope: "연결",
            conflictDecision: {
              status: "unresolved" as const,
              reason: "권위 출처 미선택",
              discardedEvidenceIds: [],
            },
          },
        ],
      }),
    (error) =>
      error instanceof ApiError &&
      error.code === "VALIDATED_VALUE_CONFLICT_UNRESOLVED",
  );
});

test("needs_review 값은 append-only qualified decision이 있어야 승인된다", () => {
  const approved = validatedValueSet();
  const common = {
    validatedValueSetId: "validated-values-qualified",
    validationVersion: 4,
    sourceSnapshotId: "snapshot-1",
    sourceFingerprint: HASH_A,
    cutoffDate: "2026-05-20",
    targets: [
      {
        targetId: "target-revenue",
        metric: "revenue",
        period: "2026년 1분기",
        unit: "백만원",
        scope: "연결",
        valueKind: "actual" as const,
        required: true,
        included: true,
      },
    ],
    results: [
      {
        resultId: "result-revenue",
        targetId: "target-revenue",
        machineStatus: "needs_review" as const,
        exceptionStatus: "AVAILABLE",
        valueOriginal: "1250",
        valueNormalized: "1250",
        unit: "백만원",
        period: "2026년 1분기",
        scope: "연결",
        valueKind: "actual",
        evidenceIds: ["evidence-1"],
        authoritySource: {
          sourceType: "user_decision" as const,
          sourceId: "decision-1",
        },
        conflictDecision: {
          status: "manual_resolution" as const,
          reason: "제한사항을 확인하고 사용",
          discardedEvidenceIds: [],
        },
      },
    ],
    createdAt: "2026-07-26T00:00:00.000Z",
  };

  assert.throws(
    () => createValidatedValueSet(common),
    (error) =>
      error instanceof ApiError &&
      error.code === "QUALIFIED_VALUE_DECISION_REQUIRED",
  );
  const accepted = createValidatedValueSet({
    ...common,
    results: [
      {
        ...common.results[0],
        qualifiedDecision: {
          decisionId: "decision-1",
          status: "accepted" as const,
          reason: "제한사항을 확인하고 사용",
        },
      },
    ],
  });
  assert.notEqual(accepted.contentHash, approved.contentHash);
});

test("workbook_input allowlist만 patch하고 before/after와 Evidence provenance를 고정한다", () => {
  const valueSet = validatedValueSet();
  const plan = createWorkbookApplicationPlan({
    applicationId: "application-1",
    sourceSnapshotId: "snapshot-1",
    sourceFingerprint: HASH_A,
    sourceWorkbookResourceVersionId: "workbook-resource-version-1",
    sourceWorkbookArtifactId: "artifact-1",
    inputWorkbookVersion: 1,
    structureHash: HASH_B,
    validatedValueSet: valueSet,
    bindings: [
      {
        targetId: "target-revenue",
        purpose: "workbook_input",
        sheetId: "sheet-input",
        sheetName: "Input",
        address: "B2",
        expectedStructureFingerprint: "cell-structure-1",
      },
    ],
    cells: [
      {
        sheetId: "sheet-input",
        sheetName: "Input",
        address: "B2",
        valueType: "number",
        rawValue: "1000",
        formattedText: "1,000",
        formula: null,
        editable: true,
        structureFingerprint: "cell-structure-1",
      },
      {
        sheetId: "sheet-input",
        sheetName: "Input",
        address: "C2",
        valueType: "number",
        rawValue: "999",
        formattedText: "999",
        formula: null,
        editable: true,
        structureFingerprint: "cell-structure-2",
      },
    ],
  });

  assert.equal(plan.commands.length, 1);
  assert.deepEqual(plan.commands[0], {
    targetId: "target-revenue",
    sheetId: "sheet-input",
    sheetName: "Input",
    address: "B2",
    valueType: "number",
    beforeValue: "1000",
    afterValue: "1250",
    evidenceIds: ["evidence-1"],
    expectedStructureFingerprint: "cell-structure-1",
    generatedBridge: false,
  });
  assert.equal(plan.blocked.length, 0);
  assert.match(plan.planHash, /^[a-f0-9]{64}$/);
});

test("formula cell과 report_output binding은 직접 쓰지 않고 명시적으로 차단한다", () => {
  const valueSet = validatedValueSet();
  const plan = createWorkbookApplicationPlan({
    applicationId: "application-1",
    sourceSnapshotId: "snapshot-1",
    sourceFingerprint: HASH_A,
    sourceWorkbookResourceVersionId: "workbook-resource-version-1",
    sourceWorkbookArtifactId: "artifact-1",
    inputWorkbookVersion: 1,
    structureHash: HASH_B,
    validatedValueSet: valueSet,
    bindings: [
      {
        targetId: "target-revenue",
        purpose: "report_output",
        sheetId: "sheet-output",
        sheetName: "Output",
        address: "D8",
        expectedStructureFingerprint: "formula-structure-1",
      },
    ],
    cells: [
      {
        sheetId: "sheet-output",
        sheetName: "Output",
        address: "D8",
        valueType: "formula",
        rawValue: "1000",
        formattedText: "1,000",
        formula: "=SUM(B8:C8)",
        editable: false,
        structureFingerprint: "formula-structure-1",
      },
    ],
  });

  assert.equal(plan.commands.length, 0);
  assert.deepEqual(plan.blocked, [
    {
      targetId: "target-revenue",
      reasonCode: "CELL_NOT_APPROVED",
      sheetId: "sheet-output",
      address: "D8",
    },
  ]);
});

test("안전한 input cell이 없을 때 승인 Evidence 기반 _REFLO_BRIDGE 명령을 만든다", () => {
  const plan = createWorkbookApplicationPlan({
    applicationId: "application-bridge",
    sourceSnapshotId: "snapshot-1",
    sourceFingerprint: HASH_A,
    sourceWorkbookResourceVersionId: "workbook-resource-version-1",
    sourceWorkbookArtifactId: "artifact-1",
    inputWorkbookVersion: 1,
    structureHash: HASH_B,
    validatedValueSet: validatedValueSet(),
    bindings: [],
    cells: [],
    bridgeFallback: true,
  });

  assert.equal(plan.blocked.length, 0);
  assert.deepEqual(plan.commands, [
    {
      targetId: "target-revenue",
      semanticKey: {
        metric: "revenue",
        period: "2026년 1분기",
        unit: "백만원",
        scope: "연결",
      },
      sheetId: "_REFLO_BRIDGE",
      sheetName: "_REFLO_BRIDGE",
      address: "B2",
      valueType: "number",
      beforeValue: null,
      afterValue: "1250",
      evidenceIds: ["evidence-1"],
      expectedStructureFingerprint: null,
      generatedBridge: true,
    },
  ]);
});

test("Workbook write 승인·거절·수정은 Evidence command를 벗어나지 않는 append-only 결정으로 정규화한다", () => {
  const command = createWorkbookApplicationPlan({
    applicationId: "application-review",
    sourceSnapshotId: "snapshot-1",
    sourceFingerprint: HASH_A,
    sourceWorkbookResourceVersionId: "workbook-resource-version-1",
    sourceWorkbookArtifactId: "artifact-1",
    inputWorkbookVersion: 1,
    structureHash: HASH_B,
    validatedValueSet: validatedValueSet(),
    bindings: [],
    cells: [],
    bridgeFallback: true,
  }).commands[0];

  assert.deepEqual(
    resolveWorkbookWriteDecision(command, {
      action: "approve",
      proposedAfterValue: undefined,
    }),
    { action: "approve", effectiveCommand: command },
  );
  assert.deepEqual(
    resolveWorkbookWriteDecision(command, {
      action: "reject",
      proposedAfterValue: undefined,
    }),
    { action: "reject", effectiveCommand: null },
  );
  assert.deepEqual(
    resolveWorkbookWriteDecision(command, {
      action: "modify",
      proposedAfterValue: "1250.0",
    }),
    { action: "modify", effectiveCommand: command },
  );
  assert.throws(
    () =>
      resolveWorkbookWriteDecision(command, {
        action: "modify",
        proposedAfterValue: "1300",
      }),
    (error) =>
      error instanceof ApiError &&
      error.code === "WORKBOOK_VALUE_CHANGE_REQUIRES_REVALIDATION",
  );
});

test("사용자 결정으로 만든 최종 plan만 worker에 전달한다", () => {
  const plan = createWorkbookApplicationPlan({
    applicationId: "application-finalized",
    sourceSnapshotId: "snapshot-1",
    sourceFingerprint: HASH_A,
    sourceWorkbookResourceVersionId: "workbook-resource-version-1",
    sourceWorkbookArtifactId: "artifact-1",
    inputWorkbookVersion: 1,
    structureHash: HASH_B,
    validatedValueSet: validatedValueSet(),
    bindings: [],
    cells: [],
    bridgeFallback: true,
  });
  const approved = finalizeWorkbookApplicationPlan({
    plan,
    decisions: [
      {
        targetId: "target-revenue",
        required: true,
        action: "modify",
        proposedAfterValue: "1250.0",
      },
    ],
  });

  assert.equal(approved.plan.commands.length, 1);
  assert.equal(approved.plan.commands[0]?.afterValue, "1250");
  assert.notEqual(approved.plan.planHash, "");
  assert.equal(approved.resolutions[0]?.originalCommand, plan.commands[0]);
});

test("선택 제안 거절은 명령에서 제외하고 필수 제안 거절은 차단한다", () => {
  const plan = createWorkbookApplicationPlan({
    applicationId: "application-rejected",
    sourceSnapshotId: "snapshot-1",
    sourceFingerprint: HASH_A,
    sourceWorkbookResourceVersionId: "workbook-resource-version-1",
    sourceWorkbookArtifactId: "artifact-1",
    inputWorkbookVersion: 1,
    structureHash: HASH_B,
    validatedValueSet: validatedValueSet(),
    bindings: [],
    cells: [],
    bridgeFallback: true,
  });
  const optional = finalizeWorkbookApplicationPlan({
    plan,
    decisions: [
      {
        targetId: "target-revenue",
        required: false,
        action: "reject",
      },
    ],
  });

  assert.deepEqual(optional.plan.commands, []);
  assert.throws(
    () =>
      finalizeWorkbookApplicationPlan({
        plan,
        decisions: [
          {
            targetId: "target-revenue",
            required: true,
            action: "reject",
          },
        ],
      }),
    (error) =>
      error instanceof ApiError &&
      error.code === "WORKBOOK_WRITE_PROPOSAL_REJECTED",
  );
});

test("worker 결과는 allowlist diff, 구조·수식·drawing/VML 보존과 EPS·PER·목표주가를 검증한다", () => {
  const plan = createWorkbookApplicationPlan({
    applicationId: "application-1",
    sourceSnapshotId: "snapshot-1",
    sourceFingerprint: HASH_A,
    sourceWorkbookResourceVersionId: "workbook-resource-version-1",
    sourceWorkbookArtifactId: "artifact-1",
    inputWorkbookVersion: 1,
    structureHash: HASH_B,
    validatedValueSet: validatedValueSet(),
    bindings: [
      {
        targetId: "target-revenue",
        purpose: "workbook_input",
        sheetId: "sheet-input",
        sheetName: "Input",
        address: "B2",
        expectedStructureFingerprint: "cell-structure-1",
      },
    ],
    cells: [
      {
        sheetId: "sheet-input",
        sheetName: "Input",
        address: "B2",
        valueType: "number",
        rawValue: "1000",
        formattedText: "1,000",
        formula: null,
        editable: true,
        structureFingerprint: "cell-structure-1",
      },
    ],
  });

  const verified = validateWorkbookApplicationResult(plan, {
    workbookBase64: "AA==",
    workbookHash: HASH_A,
    engineName: "LibreOffice",
    engineVersion: "26.2",
    changedCells: [
      {
        sheetId: "sheet-input",
        address: "B2",
        beforeValue: "1000",
        afterValue: "1250",
      },
    ],
    structureHashBefore: HASH_B,
    structureHashAfter: HASH_B,
    formulaHashBefore: HASH_A,
    formulaHashAfter: HASH_A,
    protectedPartHashesBefore: {
      "xl/drawings/drawing1.xml": HASH_A,
      "xl/drawings/vmlDrawing1.vml": HASH_B,
    },
    protectedPartHashesAfter: {
      "xl/drawings/drawing1.xml": HASH_A,
      "xl/drawings/vmlDrawing1.vml": HASH_B,
    },
    calculationErrors: [],
    unsupportedFunctions: [],
    outputs: {
      forwardEps: "12401",
      targetPer: "14.2",
      targetPrice: "176094",
    },
  });
  assert.equal(verified.outputWorkbookHash, HASH_A);
  assert.equal(verified.appliedCellCount, 1);

  assert.throws(
    () =>
      validateWorkbookApplicationResult(plan, {
        workbookBase64: "AA==",
        workbookHash: HASH_A,
        engineName: "LibreOffice",
        engineVersion: "26.2",
        changedCells: [
          {
            sheetId: "sheet-input",
            address: "C2",
            beforeValue: "1",
            afterValue: "2",
          },
        ],
        structureHashBefore: HASH_B,
        structureHashAfter: HASH_B,
        formulaHashBefore: HASH_A,
        formulaHashAfter: HASH_A,
        protectedPartHashesBefore: {},
        protectedPartHashesAfter: {},
        calculationErrors: [],
        unsupportedFunctions: [],
        outputs: {
          forwardEps: "12401",
          targetPer: "14.2",
          targetPrice: "176094",
        },
      }),
    (error) =>
      error instanceof ApiError &&
      error.code === "WORKBOOK_SEMANTIC_DIFF_OUTSIDE_ALLOWLIST",
  );
});
