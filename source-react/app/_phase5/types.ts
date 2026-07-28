import type { StageState } from "../_phase4/types";

export type OutputCell = {
  sheetId: string;
  sheetName: string;
  address: string;
  rawValue: string | null;
  formattedText: string;
};

export type WorkbookCell = {
  sheetId?: string;
  sheetName?: string;
  address: string;
  row: number;
  column: number;
  valueType: string;
  rawValue: string | null;
  formattedText: string;
  formula: string | null;
  numberFormat: string;
  label: string;
  editable: boolean;
  readOnlyReason: string | null;
  fill: string;
  fontColor: string;
  bold: boolean;
  italic?: boolean;
  fontSize?: number;
  horizontalAlignment?: string;
  verticalAlignment?: string;
  wrapText?: boolean;
  borderTop?: string;
  borderRight?: string;
  borderBottom?: string;
  borderLeft?: string;
};

export type ValuationImpactType =
  | "forward_eps_driver"
  | "target_per_driver"
  | "target_price_driver"
  | "report_table_driver"
  | "source_metadata"
  | "inactive_branch"
  | "unmapped";

export type EditableWorkbookCell = {
  sheetId: string;
  sheetName: string;
  address: string;
  valueType: string;
  label: string;
  numberFormat: string;
  required: boolean;
  impactTypes: ValuationImpactType[];
  activeInCurrentMode: boolean | null;
  downstreamOutputs: Array<
    "forward_eps" | "target_per" | "target_price"
  >;
};

export type WorkbookReadModel = {
  workbookVersion: number;
  editableCellSetVersion: number;
  schemaVersion: string;
  workbookHash: string;
  reportPeriodPlan?: {
    schemaVersion: "1.0";
    targetYear: number;
    targetQuarter: number;
    cutoffDate: string;
    latestActualYear: number;
    source: "project_target" | "dart_verified";
    periods: Array<{
      year: number;
      label: string;
      role: "actual" | "forecast";
    }>;
  };
  inputManifest?: Array<{
    sheetName: string;
    address: string;
    metric: string;
    period: string;
    unit: string;
    required: boolean;
    writeAuthority: "user" | "system";
  }>;
  rollForward?: {
    changed: boolean;
    changes: Array<{
      sheetName: string;
      address: string;
      changeType: string;
      beforeValue: string | null;
      afterValue: string | null;
    }>;
  };
  sheets: Array<{
    sheetId: string;
    name: string;
    index: number;
    visibility: "visible" | "hidden" | "very_hidden";
    usedRange: string;
    freezeRows: number;
    freezeColumns: number;
    columnWidths?: Array<{
      column: number;
      widthPixels: number;
      hidden: boolean;
    }>;
    rowHeights?: Array<{
      row: number;
      heightPixels: number;
      hidden: boolean;
    }>;
    mergedRanges?: Array<{
      firstRow: number;
      firstColumn: number;
      lastRow: number;
      lastColumn: number;
    }>;
    cells: WorkbookCell[];
  }>;
  editableCells: EditableWorkbookCell[];
  outputs: {
    forwardEps: OutputCell | null;
    targetPer: OutputCell | null;
    targetPrice: OutputCell | null;
  };
  dependencyAnalysis: {
    status: "complete" | "partial";
    warnings: string[];
    edges: Array<{
      outputMetric: "forward_eps" | "target_per" | "target_price";
      fromSheetId: string;
      fromAddress: string;
      toSheetId: string;
      toAddress: string;
    }>;
  };
};

export type ValuationOutputDelta = {
  before: string | null;
  after: string | null;
  beforeFormatted: string | null;
  afterFormatted: string | null;
  changed: boolean;
};

export type CellPatchResult = {
  workbookVersion: number;
  calculationRunId: string;
  appliedChanges: Array<{
    sheetId: string;
    sheetName: string;
    address: string;
    valueType: string;
    rawValue: string | null;
    formattedText: string;
  }>;
  affectedCells: WorkbookCell[];
  outputDiff: {
    forwardEps: ValuationOutputDelta;
    targetPer: ValuationOutputDelta;
    targetPrice: ValuationOutputDelta;
  };
  affectedReportBindings: string[];
  invalidatedResults: string[];
  savedAt: string | null;
};

export type ValuationWorkspace = {
  project: {
    projectId: string;
    name: string;
    companyName: string;
    ticker: string;
    targetPeriod: { year: number; quarter: number };
    cutoffDate: string;
  };
  workbook: {
    artifactId: string;
    originalWorkbookHash: string;
    workbookVersion: number;
    editableCellSetVersion: number;
    displayName: string;
    readModelUrl: string;
    visibleSheets: Array<{
      sheetId: string;
      name: string;
      index: number;
      visibility: "visible";
      usedRange: string;
    }>;
    savedAt: string;
  };
  permissions: {
    editableCellSetVersion: number;
    editableCells: WorkbookReadModel["editableCells"];
    /**
     * 워커가 편집 가능한 셀의 `required`를 무조건 true로 넣으므로 전체 편집셀과
     * 같다. 완료 게이트 판정에는 쓰지 말 것 — `missingRequiredCells`를 쓴다.
     */
    requiredEditableCells: WorkbookReadModel["editableCells"];
    /** 비어 있어서 `REQUIRED_INPUT_MISSING`을 만들고 있는 칸. */
    missingRequiredCells: Array<{
      sheetId: string;
      sheetName: string;
      address: string;
      label: string;
    }>;
  };
  calculation: {
    calculationRunId: string | null;
    status: string;
    forwardEps: OutputCell | null;
    targetPerCell: OutputCell | null;
    targetPrice: OutputCell | null;
    calculatedAt: string;
  };
  references: Array<{
    label: string;
    rawValue: string | null;
    formattedText: string;
    source: string;
  }>;
  currentPrice: {
    snapshotId: string;
    rawValue: string;
    formattedText: string;
    tradingDate: string;
    currency: string;
    provider: string;
  };
  valuationDraft: {
    draftVersion: number;
    workbookVersion: number;
    inputMode: "target_per" | "target_price";
    targetPer: string;
    requestedTargetPrice: string | null;
    targetPrice: string;
    formattedTargetPrice: string;
    forwardEps: string;
    currentPrice: string;
    upside: string;
    formattedUpside: string;
    status: string;
    updatedAt: string;
  } | null;
  approval: {
    approvalVersion: number;
    workbookVersion: number;
    draftVersion: number;
    targetPer: string;
    targetPrice: string;
    forwardEps: string;
    currentPrice: string;
    upside: string;
    status: string;
    approvedAt: string;
  } | null;
  completion: {
    canApprove: boolean;
    canComplete: boolean;
    blockers: string[];
  };
  workflow: { stageStates: StageState[] };
  navigation: { previousRoute: string; nextRoute: string };
};

export type Sensitivity = {
  ruleVersion: string;
  epsAxis: Array<{
    offset: string;
    rawValue: string;
    formattedText: string;
  }>;
  perAxis: Array<{
    offset: string;
    rawValue: string;
    formattedText: string;
  }>;
  cells: Array<{
    row: number;
    column: number;
    rawValue: string;
    formattedText: string;
    current: boolean;
  }>;
};
