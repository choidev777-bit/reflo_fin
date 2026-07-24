import {
  CancellationScope,
  isCancellation,
  proxyActivities,
} from "@temporalio/workflow";
import type * as activities from "./activities";
import type {
  FileIngestWorkflowInput,
  FileInspectionWorkflowInput,
} from "./types";

const scanActivities = proxyActivities<typeof activities>({
  taskQueue: "file-scan",
  startToCloseTimeout: "5 minutes",
  heartbeatTimeout: "30 seconds",
  retry: {
    initialInterval: "2 seconds",
    backoffCoefficient: 2,
    maximumInterval: "30 seconds",
    maximumAttempts: 3,
  },
});

const pdfActivities = proxyActivities<typeof activities>({
  taskQueue: "pdf-analysis",
  startToCloseTimeout: "10 minutes",
  heartbeatTimeout: "30 seconds",
  retry: {
    initialInterval: "3 seconds",
    backoffCoefficient: 2,
    maximumInterval: "1 minute",
    maximumAttempts: 3,
  },
});

const excelActivities = proxyActivities<typeof activities>({
  taskQueue: "excel-calc",
  startToCloseTimeout: "15 minutes",
  heartbeatTimeout: "30 seconds",
  retry: {
    initialInterval: "3 seconds",
    backoffCoefficient: 2,
    maximumInterval: "1 minute",
    maximumAttempts: 3,
  },
});

export async function fileIngestWorkflow(
  input: FileIngestWorkflowInput,
): Promise<void> {
  try {
    await scanActivities.scanUpload(input);
  } catch (error) {
    await CancellationScope.nonCancellable(async () => {
      if (isCancellation(error)) {
        await scanActivities.reportCancellation(input.jobId, input.jobAttempt);
      } else {
        await scanActivities.reportFailure(
          input.jobId,
          input.jobAttempt,
          "FILE_SCAN_UNAVAILABLE",
          "파일 보안 검사를 완료하지 못했습니다.",
          true,
        );
      }
    });
    throw error;
  }
}

export async function fileInspectionWorkflow(
  input: FileInspectionWorkflowInput,
): Promise<void> {
  try {
    await scanActivities.recordJobProgress(
      input.jobId,
      input.jobAttempt,
      1,
      "analysis_started",
      10,
      "PDF와 Excel 분석을 시작했습니다.",
    );
    const [pdf, workbook] = await Promise.all([
      pdfActivities.analyzePdf(input),
      excelActivities.analyzeExcel(input),
    ]);
    await scanActivities.recordJobProgress(
      input.jobId,
      input.jobAttempt,
      4,
      "mapping",
      85,
      "PDF와 Excel 연결을 확인하고 있습니다.",
    );
    await scanActivities.finalizeInspection(input, pdf, workbook);
  } catch (error) {
    await CancellationScope.nonCancellable(async () => {
      if (isCancellation(error)) {
        await scanActivities.reportCancellation(input.jobId, input.jobAttempt);
      } else {
        await scanActivities.reportFailure(
          input.jobId,
          input.jobAttempt,
          "FILE_INSPECTION_FAILED",
          "파일 분석 작업을 완료하지 못했습니다.",
          true,
        );
      }
    });
    throw error;
  }
}
