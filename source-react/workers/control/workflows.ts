import {
  ApplicationFailure,
  CancellationScope,
  isCancellation,
  patched,
  proxyActivities,
} from "@temporalio/workflow";
import type * as activities from "./activities";
import type {
  FileIngestWorkflowInput,
  FileInspectionWorkflowInput,
  HypothesisGenerationWorkflowInput,
  ReportDeliveryWorkflowInput,
  ReportMaterializationWorkflowInput,
  ResearchValidationWorkflowInput,
  WorkbookApplicationWorkflowInput,
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
  startToCloseTimeout: "7 minutes",
  heartbeatTimeout: "30 seconds",
  retry: {
    initialInterval: "3 seconds",
    backoffCoefficient: 2,
    maximumInterval: "30 seconds",
    maximumAttempts: 2,
  },
});

// extractResearchCandidates는 source group마다 LLM을 순차 호출한다. 단일 호출이
// 아니라 N회 루프이므로 llmActivities의 단건 예산으로는 중간에 잘린다.
const researchExtractionActivities = proxyActivities<typeof activities>({
  taskQueue: "llm",
  startToCloseTimeout: "45 minutes",
  heartbeatTimeout: "2 minutes",
  retry: {
    initialInterval: "3 seconds",
    backoffCoefficient: 2,
    maximumInterval: "30 seconds",
    maximumAttempts: 2,
  },
});

const newsSearchActivities = proxyActivities<typeof activities>({
  taskQueue: "llm",
  startToCloseTimeout: "7 minutes",
  // 뉴스 검색 3건이 동시에 돌면 30초 heartbeat는 빠듯해 heartbeat timeout으로
  // 불필요한 재시도가 걸린다(실측: 뉴스 단계 5분 47초 중 2회 재시도).
  heartbeatTimeout: "2 minutes",
  retry: {
    initialInterval: "3 seconds",
    backoffCoefficient: 2,
    maximumInterval: "30 seconds",
    maximumAttempts: 2,
  },
});

const researchNetworkActivities = proxyActivities<typeof activities>({
  taskQueue: "research-network",
  startToCloseTimeout: "10 minutes",
  heartbeatTimeout: "1 minute",
  retry: {
    initialInterval: "3 seconds",
    backoffCoefficient: 2,
    maximumInterval: "1 minute",
    maximumAttempts: 3,
  },
});

// validateHypothesisPipeline도 source group마다 /validation/evidence를 순차 호출한
// 뒤 question-answers를 한 번 더 부른다. 단건 예산으로 잡으면 안 된다.
const evidenceValidationActivities = proxyActivities<typeof activities>({
  taskQueue: "evidence-validation",
  startToCloseTimeout: "45 minutes",
  heartbeatTimeout: "2 minutes",
  retry: {
    initialInterval: "3 seconds",
    backoffCoefficient: 2,
    maximumInterval: "30 seconds",
    maximumAttempts: 2,
  },
});

const workbookApplicationActivities = proxyActivities<typeof activities>({
  taskQueue: "excel-calc",
  startToCloseTimeout: "10 minutes",
  heartbeatTimeout: "1 minute",
  retry: {
    initialInterval: "3 seconds",
    backoffCoefficient: 2,
    maximumInterval: "1 minute",
    maximumAttempts: 3,
  },
});

const reportMaterializationActivities = proxyActivities<typeof activities>({
  taskQueue: "report-materialization",
  startToCloseTimeout: "10 minutes",
  heartbeatTimeout: "1 minute",
  retry: {
    initialInterval: "3 seconds",
    backoffCoefficient: 2,
    maximumInterval: "1 minute",
    maximumAttempts: 2,
  },
});

const reportDeliveryActivities = proxyActivities<typeof activities>({
  taskQueue: "report-delivery",
  startToCloseTimeout: "10 minutes",
  heartbeatTimeout: "1 minute",
  retry: {
    initialInterval: "3 seconds",
    backoffCoefficient: 2,
    maximumInterval: "1 minute",
    maximumAttempts: 3,
  },
});

function researchFailure(error: unknown): {
  code: string;
  message: string;
  retryable: boolean;
} {
  let current: unknown = error;
  for (let depth = 0; depth < 6 && current; depth += 1) {
    const message =
      current instanceof Error
        ? current.message
        : typeof current === "object" &&
            current !== null &&
            "message" in current &&
            typeof current.message === "string"
          ? current.message
          : "";
    const match = message.match(
      /(RESEARCH_AGENT_INPUT_LIMIT|VALIDATION_AGENT_INPUT_LIMIT|RESEARCH_NO_SOURCES|RESEARCH_CANDIDATES_EMPTY|RESEARCH_EVIDENCE_EMPTY|REQUIRED_SOURCE_UNAVAILABLE|QUESTION_SOURCE_UNAVAILABLE|EXCEL_SOURCE_UNAVAILABLE|NEWS_[A-Z0-9_]+|DART_[A-Z0-9_]+|KRX_[A-Z0-9_]+|ECOS_[A-Z0-9_]+|SOURCE_[A-Z0-9_]+)/,
    );
    if (match) {
      const code = match[1];
      const messages: Record<string, string> = {
        RESEARCH_NO_SOURCES:
          "수집된 원문이 없습니다. 출처 자료와 API 설정을 확인해주세요.",
        RESEARCH_CANDIDATES_EMPTY:
          "원문에서 조사 후보를 만들지 못했습니다. 자료 내용을 확인해주세요.",
        RESEARCH_EVIDENCE_EMPTY:
          "검증 가능한 Evidence가 생성되지 않았습니다. 자료를 보완해주세요.",
        RESEARCH_AGENT_INPUT_LIMIT:
          "수집 원문이 AI 처리 한도를 초과했습니다. 자료 범위를 줄이거나 출처를 나누어주세요.",
        VALIDATION_AGENT_INPUT_LIMIT:
          "검증할 원문과 후보가 AI 처리 한도를 초과했습니다. 자료 범위를 줄이거나 출처를 나누어주세요.",
        REQUIRED_SOURCE_UNAVAILABLE:
          "선택한 필수 자료를 수집하지 못했습니다. URL 또는 파일을 확인해주세요.",
        QUESTION_SOURCE_UNAVAILABLE:
          "질문에 사용할 원문을 수집하지 못했습니다. 출처를 보완해주세요.",
        EXCEL_SOURCE_UNAVAILABLE:
          "필수 Excel 실제값의 권위 출처를 수집하지 못했습니다.",
        KRX_API_UNAUTHORIZED:
          "KRX Open API 인증에 실패했습니다. 서비스 권한과 인증키를 확인해주세요.",
        DART_API_KEY_MISSING: "OpenDART 인증키가 설정되지 않았습니다.",
        ECOS_API_KEY_MISSING: "한국은행 ECOS 인증키가 설정되지 않았습니다.",
        SOURCE_COMPANY_MISMATCH:
          "자료 원문에서 프로젝트 기업을 확인하지 못했습니다. 올바른 기업 자료를 등록해주세요.",
        SOURCE_PERIOD_MISMATCH:
          "기업 IR 원문에서 조사 대상 분기를 확인하지 못했습니다. 대상 기간 자료를 등록해주세요.",
        SOURCE_CUTOFF_VIOLATION:
          "보고서 기준일 이후에 발행된 자료는 사용할 수 없습니다.",
        SOURCE_PUBLISHED_AT_MISSING:
          "공식 원문의 발행일을 확인할 수 없습니다. 발행일이 명확한 자료를 등록해주세요.",
        NEWS_QUERY_PLAN_INVALID:
          "뉴스 검색 계획이 승인된 기간 또는 한도를 벗어났습니다.",
        NEWS_SEARCH_PROVIDER_UNAVAILABLE:
          "뉴스 검색 서비스에 연결하지 못했습니다. 잠시 후 다시 시도해주세요.",
        NEWS_SEARCH_RATE_LIMITED:
          "뉴스 검색 요청이 많아 잠시 지연되고 있습니다. 잠시 후 다시 시도해주세요.",
        NEWS_NO_ELIGIBLE_ARTICLES:
          "설정된 기간에 검증 가능한 뉴스 원문을 찾지 못했습니다. 질문이나 출처를 조정해주세요.",
        NEWS_ARTICLE_DATE_MISSING:
          "발행일을 확인할 수 없는 기사는 근거로 사용할 수 없습니다.",
        NEWS_ARTICLE_OUTSIDE_WINDOW:
          "설정된 뉴스 검색 기간 밖의 기사는 사용할 수 없습니다.",
        NEWS_ARTICLE_NOT_NEWS:
          "실제 뉴스 기사 원문이 아닌 검색 결과를 제외했습니다.",
        NEWS_ARTICLE_UNREADABLE:
          "기사 본문과 인용 위치를 확인할 수 없습니다.",
        NEWS_CUTOFF_VIOLATION:
          "프로젝트 기준일 이후에 이용 가능해진 기사는 사용할 수 없습니다.",
        NEWS_ARTICLE_MODIFIED_AFTER_CUTOFF:
          "기준일 이후 수정된 기사 본문은 당시 근거로 확정할 수 없습니다.",
      };
      return {
        code,
        message:
          messages[code] ??
          "선택한 공식 출처를 수집하지 못했습니다. API 설정과 원문을 확인해주세요.",
        retryable: ![
          "NEWS_QUERY_PLAN_INVALID",
          "NEWS_NO_ELIGIBLE_ARTICLES",
          "RESEARCH_AGENT_INPUT_LIMIT",
          "VALIDATION_AGENT_INPUT_LIMIT",
        ].includes(code),
      };
    }
    current =
      typeof current === "object" && current !== null && "cause" in current
        ? current.cause
        : null;
  }
  return {
    code: "RESEARCH_VALIDATION_FAILED",
    message:
      "자료 수집과 원문 검증을 완료하지 못했습니다. 잠시 후 다시 시도해주세요.",
    retryable: true,
  };
}

async function discoverNews(
  input: ResearchValidationWorkflowInput,
): Promise<Awaited<ReturnType<typeof activities.planNewsSearch>>> {
  if (!patched("phase4-news-search-per-question-v1")) {
    return llmActivities.planNewsSearch(input);
  }
  const shouldSearch = await newsSearchActivities.prepareNewsSearch(input);
  if (!shouldSearch) return [];
  const questionIds = input.questions
    .filter(
      (question) =>
        question.included && question.sourceBindingIds.includes("NEWS"),
    )
    .map((question) => question.questionId);
  const results = await Promise.all(
    questionIds.map((questionId) =>
      newsSearchActivities.planNewsSearchQuestion(input, questionId),
    ),
  );
  return results.flat();
}

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

function hasApplicationFailureType(error: unknown, type: string): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 6 && current; depth += 1) {
    if (current instanceof ApplicationFailure && current.type === type) {
      return true;
    }
    current =
      typeof current === "object" && current !== null && "cause" in current
        ? current.cause
        : null;
  }
  return false;
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
        const outputInvalid = hasApplicationFailureType(
          error,
          "AGENT_OUTPUT_INVALID",
        );
        await scanActivities.reportFailure(
          input.jobId,
          input.jobAttempt,
          outputInvalid ? "AGENT_OUTPUT_INVALID" : "AGENT_UNAVAILABLE",
          outputInvalid
            ? "AI 질문 응답 형식이 올바르지 않습니다."
            : "조사 질문을 만들지 못했습니다. 잠시 후 다시 시도해주세요.",
          !outputInvalid,
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
    if (patched("phase4-separated-hypothesis-excel-v1")) {
      const newsDiscoveryResults = await discoverNews(input);
      // 공식 원문(DART/KRX/ECOS)은 한 번만 수집해 두 축이 공유한다.
      //
      // 이전에는 가설 축과 Excel 축이 같은 공시를 각각 수집했다. 같은 공시라도
      // 축마다 필요한 계정 행이 달라 스냅샷 두 개가 생겼고, 게시할 때
      // (1) 같은 sourceKey에 다른 내용이면 SOURCE_SNAPSHOT_CONFLICT,
      // (2) key를 내용별로 나누면 서버의 Excel 규칙 재계산이 워커와 다른
      //     스냅샷을 골라 RESEARCH_RESULT_INVALID가 났다.
      // 수집을 하나로 합치면 워커와 서버의 재계산 입력이 같아져 둘 다 사라지고,
      // 중복 DART 호출도 없어진다.
      const bundle = await researchNetworkActivities.collectResearchBundle(
        input,
        newsDiscoveryResults,
      );
      const researchCandidates =
        bundle.sources.length > 0
          ? await researchExtractionActivities.extractResearchCandidates(
              input,
              bundle,
            )
          : [];
      const [hypothesisResult, excelResult] = await Promise.all([
        evidenceValidationActivities.validateHypothesisPipeline(
          input,
          bundle,
          researchCandidates,
        ),
        evidenceValidationActivities.validateOfficialExcelPipeline(
          input,
          bundle,
        ),
      ]);
      await evidenceValidationActivities.publishSeparatedResearchValidation(
        input,
        hypothesisResult,
        excelResult,
        newsDiscoveryResults,
      );
    } else if (patched("phase4-autonomous-news-v1")) {
      const newsDiscoveryResults = await discoverNews(input);
      const bundle = await researchNetworkActivities.collectResearchBundle(
        input,
        newsDiscoveryResults,
      );
      const researchCandidates =
        await researchExtractionActivities.extractResearchCandidates(
          input,
          bundle,
        );
      await evidenceValidationActivities.validateAndPublishResearch(
        input,
        bundle,
        researchCandidates,
        newsDiscoveryResults,
      );
    } else {
      await llmActivities.runResearchValidation(input);
    }
  } catch (error) {
    await CancellationScope.nonCancellable(async () => {
      if (isCancellation(error)) {
        await scanActivities.reportCancellation(input.jobId, input.jobAttempt);
      } else {
        const failure = researchFailure(error);
        await scanActivities.reportFailure(
          input.jobId,
          input.jobAttempt,
          failure.code,
          failure.message,
          failure.retryable,
        );
      }
    });
    throw error;
  }
}

export async function workbookApplicationWorkflow(
  input: WorkbookApplicationWorkflowInput,
): Promise<void> {
  try {
    await workbookApplicationActivities.applyAndPublishWorkbook(input);
  } catch (error) {
    await CancellationScope.nonCancellable(async () => {
      if (isCancellation(error)) {
        await scanActivities.reportCancellation(input.jobId, input.jobAttempt);
        await scanActivities.reportWorkbookApplicationFailure(
          input.applicationId,
          input.jobAttempt,
          "WORKBOOK_APPLICATION_CANCELLED",
          "Workbook 반영 작업이 취소되었습니다.",
        );
      } else {
        const message =
          error instanceof Error ? error.message : "WORKBOOK_APPLICATION_FAILED";
        const code =
          message.match(/([A-Z][A-Z0-9_]{4,})/)?.[1] ??
          "WORKBOOK_APPLICATION_FAILED";
        await scanActivities.reportFailure(
          input.jobId,
          input.jobAttempt,
          code,
          "승인 값을 Workbook에 반영하지 못했습니다.",
          true,
        );
        await scanActivities.reportWorkbookApplicationFailure(
          input.applicationId,
          input.jobAttempt,
          code,
          message.slice(0, 500),
        );
      }
    });
    throw error;
  }
}

export async function reportMaterializationWorkflow(
  input: ReportMaterializationWorkflowInput,
): Promise<void> {
  try {
    await reportMaterializationActivities.materializeAndPublishReport(input);
  } catch (error) {
    await CancellationScope.nonCancellable(async () => {
      const message =
        error instanceof Error
          ? error.message
          : "REPORT_MATERIALIZATION_FAILED";
      const cancelled = isCancellation(error);
      const code = cancelled
        ? "REPORT_MATERIALIZATION_CANCELLED"
        : (message.match(/([A-Z][A-Z0-9_]{4,})/)?.[1] ??
          "REPORT_MATERIALIZATION_FAILED");
      if (cancelled) {
        await scanActivities.reportCancellation(
          input.jobId,
          input.jobAttempt,
        );
      } else {
        await scanActivities.reportFailure(
          input.jobId,
          input.jobAttempt,
          code,
          "보고서 초안을 생성하지 못했습니다.",
          true,
        );
      }
      await reportMaterializationActivities.reportReportMaterializationFailure(
        input,
        code,
        message.slice(0, 1000),
      );
    });
    throw error;
  }
}

export async function reportDeliveryWorkflow(
  input: ReportDeliveryWorkflowInput,
): Promise<void> {
  try {
    await reportDeliveryActivities.runReportDelivery(input);
  } catch (error) {
    await CancellationScope.nonCancellable(async () => {
      const message =
        error instanceof Error ? error.message : "REPORT_DELIVERY_FAILED";
      const cancelled = isCancellation(error);
      const code = cancelled
        ? "REPORT_DELIVERY_CANCELLED"
        : (message.match(/([A-Z][A-Z0-9_]{4,})/)?.[1] ??
          "REPORT_DELIVERY_FAILED");
      if (cancelled) {
        await scanActivities.reportCancellation(
          input.jobId,
          input.jobAttempt,
        );
      } else {
        await scanActivities.reportFailure(
          input.jobId,
          input.jobAttempt,
          code,
          "보고서 결과물을 생성하지 못했습니다.",
          true,
        );
      }
      await reportDeliveryActivities.reportReportDeliveryFailure(
        input,
        code,
        message.slice(0, 1000),
        cancelled,
      );
    });
    throw error;
  }
}
