import {
  CancellationScope,
  isCancellation,
  proxyActivities,
} from "@temporalio/workflow";
import type * as activities from "./activities";
import type {
  FileIngestWorkflowInput,
  FileInspectionWorkflowInput,
  HypothesisGenerationWorkflowInput,
  ResearchValidationWorkflowInput,
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

const inspectionActivities = proxyActivities<typeof activities>({
  taskQueue: "file-scan",
  startToCloseTimeout: "20 minutes",
  heartbeatTimeout: "5 minutes",
  retry: {
    initialInterval: "3 seconds",
    backoffCoefficient: 2,
    maximumInterval: "1 minute",
    maximumAttempts: 3,
  },
});

const llmActivities = proxyActivities<typeof activities>({
  taskQueue: "llm",
  startToCloseTimeout: "3 minutes",
  heartbeatTimeout: "30 seconds",
  retry: {
    initialInterval: "3 seconds",
    backoffCoefficient: 2,
    maximumInterval: "30 seconds",
    maximumAttempts: 2,
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
    await inspectionActivities.inspectAndFinalize(input);
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

export async function hypothesisGenerationWorkflow(
  input: HypothesisGenerationWorkflowInput,
): Promise<void> {
  try {
    await llmActivities.generateHypothesisQuestions(input);
  } catch (error) {
    await CancellationScope.nonCancellable(async () => {
      if (isCancellation(error)) {
        await scanActivities.reportCancellation(input.jobId, input.jobAttempt);
      } else {
        await scanActivities.reportFailure(
          input.jobId,
          input.jobAttempt,
          "AGENT_UNAVAILABLE",
          "조사 질문을 만들지 못했습니다. 잠시 후 다시 시도해주세요.",
          true,
        );
      }
    });
    throw error;
  }
}

export async function researchValidationWorkflow(
  input: ResearchValidationWorkflowInput,
): Promise<void> {
  try {
    await llmActivities.runResearchValidation(input);
  } catch (error) {
    await CancellationScope.nonCancellable(async () => {
      if (isCancellation(error)) {
        await scanActivities.reportCancellation(input.jobId, input.jobAttempt);
      } else {
        await scanActivities.reportFailure(
          input.jobId,
          input.jobAttempt,
          "RESEARCH_VALIDATION_FAILED",
          "자료 수집과 독립 검증을 완료하지 못했습니다.",
          true,
        );
      }
    });
    throw error;
  }
}
