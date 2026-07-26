import { contentHash } from "./hash";
import type {
  ReportChartSnapshot,
  ReportCompositeChartSnapshot,
  ReportMaterializationsBySlotId,
  ReportMaterializationProvenance,
  ReportScalarSnapshot,
  ReportTableSnapshot,
} from "./report";

export type ReportMaterializationResourceRef = {
  role: string;
  resourceVersionId: string;
  version: number;
  contentHash: string;
};

export type ReportMaterializationSourceRefs = {
  snapshotId: string;
  sourceFingerprint: string;
  setup: ReportMaterializationResourceRef;
  pdf: ReportMaterializationResourceRef;
  xlsx: ReportMaterializationResourceRef;
  templateIr: ReportMaterializationResourceRef;
  workbookAnalysis: ReportMaterializationResourceRef;
  mappingSet: ReportMaterializationResourceRef;
  validationApproval: ReportMaterializationResourceRef;
  validatedWorkbook: ReportMaterializationResourceRef;
  valuationApproval: ReportMaterializationResourceRef;
  outlineApproval: ReportMaterializationResourceRef;
  styleTemplate: ReportMaterializationResourceRef;
  report: ReportMaterializationResourceRef;
  capturedAt: string;
};

type SerializedProvenance = {
  sourceSnapshotId: string;
  mappingSetVersionId: string;
  workbookArtifactId: string;
  workbookVersion: number;
  workbookHash: string;
  validationApprovalVersionId: string;
  valuationApprovalVersionId: string;
  pageId: string;
  blockId: string;
  slotId: string;
  materializerVersion: string;
};

export type SerializedReportMaterializationItem =
  | {
      kind: "scalar";
      provenance: SerializedProvenance;
      rawValue: string | boolean | null;
      formattedValue: string;
      valueType: ReportScalarSnapshot["valueType"];
      unit: string | null;
      period: string | null;
      authority: ReportScalarSnapshot["authority"];
      sourceDecision: string;
      displayRule: Record<string, unknown>;
      styleTemplateRef: string;
    }
  | {
      kind: "table";
      provenance: SerializedProvenance;
      rawMatrix: Array<Array<string | boolean | null>>;
      formattedMatrix: Array<Array<string | boolean | null>>;
      formulaMatrix: Array<Array<string | boolean | null>>;
      headers: string[];
      rowKeys: string[];
      mergedRanges: string[];
      rowHeightsPt: number[];
      columnWidthsPt: number[];
      subtotalRows: number[];
      unitRows: number[];
      forecastRows: number[];
      styleTemplateRef: string;
    }
  | {
      kind: "chart" | "composite_chart";
      provenance: SerializedProvenance;
      categories: string[];
      series: Array<{
        seriesId: string;
        label: string;
        role:
          | "actual"
          | "forecast"
          | "target"
          | "band_upper"
          | "band_lower"
          | "benchmark";
        axis: "primary" | "secondary";
        chartType: string;
        unit: string | null;
        numberFormat: string;
        estimateType: "actual" | "forecast" | "mixed" | "not_applicable";
        values: Array<string | null>;
      }>;
      primaryAxis: ReportChartSnapshot["primaryAxis"];
      secondaryAxis: ReportChartSnapshot["secondaryAxis"];
      styleTemplateRef: string;
    };

export type ReportMaterializationArtifact = {
  schemaVersion: "1.0";
  artifactType: "report_materialization";
  materializationId: string;
  materializationVersion: number;
  sourceSnapshot: ReportMaterializationSourceRefs;
  status: "current";
  items: SerializedReportMaterializationItem[];
  contentHash: string;
  createdAt: string;
  materializer: {
    name: "reflo-report-materializer";
    version: string;
  };
  warnings: Array<{ code: string; message: string }>;
};

function required(value: string | null | undefined, code: string): string {
  if (!value?.trim()) throw new Error(code);
  return value;
}

function provenance(
  value: ReportMaterializationProvenance,
  materializerVersion: string,
): SerializedProvenance {
  return {
    sourceSnapshotId: required(
      value.sourceSnapshotId,
      "MATERIALIZATION_SOURCE_SNAPSHOT_MISSING",
    ),
    mappingSetVersionId: value.mappingSetResourceVersionId,
    workbookArtifactId: value.workbookArtifactId,
    workbookVersion: value.workbookVersion,
    workbookHash: required(
      value.workbookHash,
      "MATERIALIZATION_WORKBOOK_HASH_MISSING",
    ),
    validationApprovalVersionId: required(
      value.validationApprovalVersionId,
      "MATERIALIZATION_VALIDATION_APPROVAL_MISSING",
    ),
    valuationApprovalVersionId: required(
      value.valuationApprovalVersionId,
      "MATERIALIZATION_VALUATION_APPROVAL_MISSING",
    ),
    pageId: required(value.pageId, "MATERIALIZATION_PAGE_ID_MISSING"),
    blockId: required(value.blockId, "MATERIALIZATION_BLOCK_ID_MISSING"),
    slotId: value.slotId,
    materializerVersion,
  };
}

function scalarRawValue(
  snapshot: ReportScalarSnapshot,
): string | boolean | null {
  if (snapshot.valueType !== "boolean") return snapshot.rawValue;
  if (snapshot.rawValue === "true") return true;
  if (snapshot.rawValue === "false") return false;
  throw new Error("MATERIALIZATION_BOOLEAN_VALUE_INVALID");
}

function serializedDisplayRule(
  snapshot: ReportScalarSnapshot,
): Record<string, unknown> {
  const display = snapshot.displayRule;
  return {
    ...(display.unit ?? snapshot.unit
      ? { unit: display.unit ?? snapshot.unit }
      : {}),
    ...(typeof display.scale === "string" &&
    /^-?(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(display.scale)
      ? { scale: display.scale }
      : {}),
    ...(typeof display.roundingIncrement === "string" &&
    /^-?(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(display.roundingIncrement)
      ? { roundingIncrement: display.roundingIncrement }
      : {}),
    ...(display.roundingMode
      ? { roundingMode: display.roundingMode }
      : {}),
    ...(display.formatCode
      ? { pattern: display.formatCode }
      : Number.isInteger(display.decimalPlaces) &&
          Number(display.decimalPlaces) >= 0
        ? {
            pattern:
              Number(display.decimalPlaces) === 0
                ? "0"
                : `0.${"0".repeat(Number(display.decimalPlaces))}`,
          }
        : {}),
    ...(display.prefix ? { prefix: display.prefix } : {}),
    ...(display.suffix ? { suffix: display.suffix } : {}),
    ...(display.negativeStyle
      ? { negativeStyle: display.negativeStyle }
      : {}),
    ...(display.blankDisplay
      ? { blankDisplay: display.blankDisplay }
      : {}),
  };
}

function serializeScalar(
  snapshot: ReportScalarSnapshot,
  materializerVersion: string,
): SerializedReportMaterializationItem {
  return {
    kind: "scalar",
    provenance: provenance(snapshot.provenance, materializerVersion),
    rawValue: scalarRawValue(snapshot),
    formattedValue: snapshot.formattedValue,
    valueType: snapshot.valueType,
    unit: snapshot.unit,
    period: snapshot.period,
    authority: snapshot.authority,
    sourceDecision: snapshot.sourceDecision,
    displayRule: serializedDisplayRule(snapshot),
    styleTemplateRef: required(
      snapshot.styleTemplateRef,
      "MATERIALIZATION_STYLE_REFERENCE_MISSING",
    ),
  };
}

function serializeTable(
  snapshot: ReportTableSnapshot,
  materializerVersion: string,
): SerializedReportMaterializationItem {
  return {
    kind: "table",
    provenance: provenance(snapshot.provenance, materializerVersion),
    rawMatrix: snapshot.rawMatrix,
    formattedMatrix: snapshot.formattedMatrix,
    formulaMatrix: snapshot.formulaMatrix,
    headers: snapshot.headers.map((cell) => cell.formattedText),
    rowKeys: snapshot.rows.map((row) => row.rowKey ?? ""),
    mergedRanges: snapshot.mergedRanges,
    rowHeightsPt: snapshot.rowHeightsPt,
    columnWidthsPt: snapshot.columnWidthsPt,
    subtotalRows: snapshot.subtotalRows,
    unitRows: snapshot.unitRows,
    forecastRows: snapshot.forecastRows,
    styleTemplateRef: required(
      snapshot.styleTemplateRef,
      "MATERIALIZATION_STYLE_REFERENCE_MISSING",
    ),
  };
}

function serializeChart(
  snapshot: ReportChartSnapshot | ReportCompositeChartSnapshot,
  materializerVersion: string,
): SerializedReportMaterializationItem {
  return {
    kind: snapshot.kind,
    provenance: provenance(snapshot.provenance, materializerVersion),
    categories: snapshot.categories.map(
      (cell) => cell.rawValue ?? cell.formattedText,
    ),
    series: snapshot.series.map((series) => ({
      seriesId: series.seriesId,
      label: series.label,
      role: series.role,
      axis: series.axis,
      chartType: series.chartType,
      unit: series.unit,
      numberFormat: series.numberFormat,
      estimateType: series.estimateType,
      values: series.values.map((cell) => cell.rawValue),
    })),
    primaryAxis: snapshot.primaryAxis,
    secondaryAxis: snapshot.secondaryAxis,
    styleTemplateRef: required(
      snapshot.styleTemplateRef,
      "MATERIALIZATION_STYLE_REFERENCE_MISSING",
    ),
  };
}

export function serializeReportMaterializationArtifact(input: {
  materializationId: string;
  materializationVersion: number;
  sourceSnapshot: ReportMaterializationSourceRefs;
  materializationsBySlotId: ReportMaterializationsBySlotId;
  materializerVersion: string;
  createdAt: string;
}): ReportMaterializationArtifact {
  const items = Object.entries(input.materializationsBySlotId)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, snapshot]) => {
      if (snapshot.status !== "ready") {
        throw new Error(
          `REPORT_MATERIALIZATION_BLOCKED:${snapshot.provenance.slotId}:` +
            `${snapshot.blockerCode ?? "MATERIALIZATION_BLOCKED"}`,
        );
      }
      if (snapshot.kind === "scalar") {
        return serializeScalar(snapshot, input.materializerVersion);
      }
      if (snapshot.kind === "table") {
        return serializeTable(snapshot, input.materializerVersion);
      }
      return serializeChart(snapshot, input.materializerVersion);
    });
  if (items.length === 0) {
    throw new Error("REPORT_MATERIALIZATION_EMPTY");
  }
  const withoutHash = {
    schemaVersion: "1.0" as const,
    artifactType: "report_materialization" as const,
    materializationId: input.materializationId,
    materializationVersion: input.materializationVersion,
    sourceSnapshot: input.sourceSnapshot,
    status: "current" as const,
    items,
    createdAt: input.createdAt,
    materializer: {
      name: "reflo-report-materializer" as const,
      version: input.materializerVersion,
    },
    warnings: [],
  };
  return {
    ...withoutHash,
    contentHash: contentHash(withoutHash),
  };
}
