export type FileRole = "previous_report_pdf" | "analysis_workbook";

export type FileVersionSummary = {
  fileVersionId: string;
  role: FileRole;
  fileName: string;
  mediaType: string;
  sizeBytes: number;
  status: "scanning" | "accepted" | "rejected" | "superseded";
  version: number;
};

export type InspectionIssue = {
  code: string;
  severity: "info" | "warning" | "blocking";
  message: string;
};

export type InspectionProjection = {
  inspectionId: string;
  jobId: string;
  operationStatus:
    | "queued"
    | "running"
    | "succeeded"
    | "failed"
    | "cancel_requested"
    | "cancelled";
  validity: "current" | "obsolete";
  phase: string | null;
  progressMode: "determinate" | "indeterminate";
  progressPercent: number;
  heartbeatAt: string | null;
  retryable: boolean;
  attempt: number;
  outcome: "passed" | "blocked" | "failed" | null;
  issues: InspectionIssue[];
  mappingSet: {
    versionId: string;
    version: number;
    status: "pending" | "confirmed" | "blocked";
    summary: {
      bindingCount: number;
      requiredSlotCount: number;
      confirmedBindingCount: number;
      unmappedRequiredCount: number;
    };
    entries: Array<{
      entryId: string;
      slotId: string;
      metric: string;
      kind: "scalar" | "table" | "chart";
      valueType: string;
      required: boolean;
      status: "suggested" | "confirmed" | "unmapped" | "invalid";
      confidence: number | null;
      source: unknown;
      plan: {
        resolution: "external_pending" | "later_stage";
        sourceLabel: string;
        destinationLabel: string;
        ownerStage: string;
        exclusiveSource: boolean;
      } | null;
      pdfBlock: {
        pageNumber: number;
        pageLabel: string | null;
        pageBox: [number, number, number, number] | null;
        blockId: string;
        role: string;
        bbox: [number, number, number, number] | null;
        classification: string | null;
        geometryFingerprint: string | null;
        analysisConfidence: number | null;
        reasonCodes: string[];
        styleTemplateRef: string | null;
      } | null;
      selectedCandidateId: string | null;
      candidates: Array<{
        candidateId: string;
        sourceType: "cell" | "range" | "chart" | "market_data";
        sheetId: string;
        sheetName: string;
        address: string;
        label: string | null;
        score: number;
        reasonCodes: string[];
        source: unknown;
        chartDefinition: Record<string, unknown> | null;
        bindingDefinition: Record<string, unknown> | null;
        preview: {
          kind: "cell" | "range" | "chart" | "market_data";
          structureFingerprint?: string | null;
          styleFingerprint?: string | null;
          displayValue?: string | null;
          numberFormat?: string | null;
          formula?: string | null;
          rowCount?: number | null;
          columnCount?: number | null;
          headerValues?: string[];
          periodLabels?: string[];
          rowKeys?: string[];
          mergedRanges?: string[];
          presentationTruncated?: boolean;
          chartTypes?: string[];
          series?: Array<{
            label: string | null;
            axis: string | null;
            chartType: string | null;
            categoryRange: string | null;
            valueRange: string | null;
          }>;
          provider?: string | null;
          tradingDate?: string | null;
          closePrice?: number | null;
          currency?: string | null;
        };
        selected: boolean;
      }>;
    }>;
  } | null;
  analysis: {
    pdf: {
      pageCount: number;
      blockCount: number;
      slotCount: number;
      objectCount: number;
      fontCount: number;
      imageCount: number;
      tableCount: number;
      chartCount: number;
      warningCount: number;
      pages: Array<{
        pageId: string;
        pageNumber: number;
        pageLabel: string | null;
        pageBox: [number, number, number, number] | null;
        headerFields: {
          reportDate: {
            text: string;
            bbox: [number, number, number, number] | null;
            objectIds: string[];
          } | null;
          reportTitle: {
            text: string;
            bbox: [number, number, number, number] | null;
            objectIds: string[];
          } | null;
        };
        narrativeSections: Array<{
          order: number;
          headingText: string;
          headingBbox: [number, number, number, number] | null;
          bodyBbox: [number, number, number, number] | null;
          bodyRegions: Array<[number, number, number, number]>;
          headingObjectIds: string[];
          bodyObjectIds: string[];
          sourceText: string;
        }>;
        slots: Array<{
          slotId: string;
          blockId: string;
          metric: string;
          valueType: string;
          required: boolean;
          role: string;
          classification: string | null;
          bbox: [number, number, number, number] | null;
          confidence: number | null;
        }>;
      }>;
    };
    workbook: {
      sheetCount: number;
      hiddenSheetCount: number;
      usedCellCount: number;
      formulaCount: number;
      editableCellCount: number;
      mergedRangeCount: number;
      chartCount: number;
      tableCount: number;
      externalLinkCount: number;
      namedRangeCount: number;
      calculationStatus: string;
      calculationErrorCount: number;
      warningCount: number;
      sheets: Array<{
        sheetId: string;
        name: string;
        index: number;
        visibility: string;
        usedRange: string;
        formulaCount: number;
        editableCellCount: number;
        mergedRangeCount: number;
        chartCount: number;
        tableCount: number;
        protected: boolean;
      }>;
    };
  } | null;
  resultVersions: {
    template: number;
    workbook: number;
    mappingSet: number;
  } | null;
  error: { code: string; message: string; retryable: boolean } | null;
};

export type FilesBootstrap = {
  projectId: string;
  projectVersion: number;
  project: {
    name: string;
    company: {
      name: string;
      ticker: string;
      targetPeriod: { year: number; quarter: number };
      cutoffDate: string;
    } | null;
  };
  slots: Array<{
    role: FileRole;
    required: true;
    status: "empty" | "uploading" | "scanning" | "ready" | "rejected";
    currentFile: FileVersionSummary | null;
    maxSizeBytes: number;
    acceptedMediaType: string;
  }>;
  inspection: InspectionProjection | null;
  workflow: {
    stageStates: Array<{ stageKey: string; status: string; route: string }>;
    allowedRoutes: string[];
  };
};
