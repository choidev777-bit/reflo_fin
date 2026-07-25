import type { NextRequest } from "next/server";
import { requireWorkerIdentity } from "@/server/http/internal-auth";
import { readJson, requireUuid } from "@/server/http/request";
import { jsonResponse, withApiErrors } from "@/server/http/response";
import {
  commitFileScanResult,
  commitInspectionResult,
  type InspectionResultPayload,
} from "@/server/infrastructure/repositories/file-repository";
import { ApiError } from "@/server/http/api-error";
import {
  commitHypothesisGenerationResult,
  type HypothesisWorkerResult,
} from "@/server/infrastructure/repositories/hypothesis-repository";

type Context = { params: Promise<{ jobId: string }> };

export async function POST(request: NextRequest, context: Context): Promise<Response> {
  return withApiErrors(async (requestId) => {
    requireWorkerIdentity(request);
    const { jobId: rawJobId } = await context.params;
    const jobId = requireUuid(rawJobId);
    const body = await readJson<{
      resultType?: unknown;
      payload?: unknown;
    }>(request);
    if (body.resultType === "file_scan") {
      await commitFileScanResult(
        jobId,
        body.payload as Parameters<typeof commitFileScanResult>[1],
      );
    } else if (body.resultType === "file_inspection") {
      await commitInspectionResult(jobId, body.payload as InspectionResultPayload);
    } else if (body.resultType === "hypothesis_questions") {
      await commitHypothesisGenerationResult(
        jobId,
        body.payload as HypothesisWorkerResult,
      );
    } else {
      throw new ApiError(
        400,
        "RESULT_SCHEMA_INVALID",
        "지원하지 않는 worker 결과입니다.",
      );
    }
    return jsonResponse({ accepted: true }, { status: 202 }, requestId);
  });
}
