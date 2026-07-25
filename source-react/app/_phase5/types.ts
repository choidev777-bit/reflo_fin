import type { StageState } from "../_phase4/types";

export type OutputCell = {
  sheetId: string;
  sheetName: string;
  address: string;
  rawValue: string | null;
  formattedText: string;
};

export type WorkbookCell = {
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

export type WorkbookReadModel = {
  workbookVersion: number;
  editableCellSetVersion: number;
  schemaVersion: string;
  workbookHash: string;
  sheets: Array<{
    sheetId: string;
    name: string;
    index: number;
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
  editableCells: Array<{
    sheetId: string;
    sheetName: string;
    address: string;
    valueType: string;
    label: string;
    numberFormat: string;
    required: boolean;
  }>;
  outputs: {
    forwardEps: OutputCell | null;
    targetPer: OutputCell | null;
    targetPrice: OutputCell | null;
  };
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
      usedRange: string;
    }>;
    savedAt: string;
  };
  permissions: {
    editableCellSetVersion: number;
    editableCells: WorkbookReadModel["editableCells"];
    requiredEditableCells: WorkbookReadModel["editableCells"];
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
