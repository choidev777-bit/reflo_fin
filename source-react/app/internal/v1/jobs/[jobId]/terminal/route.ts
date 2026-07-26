import type { NextRequest } from "next/server";
import { requireWorkerIdentity } from "@/server/http/internal-auth";
import { readJson, requireUuid } from "@/server/http/request";
import { jsonResponse, withApiErrors } from "@/server/http/response";
import { failWorkerJob } from "@/server/infrastructure/repositories/file-repository";
import { ApiError } from "@/server/http/api-error";

type Context = { params: Promise<{ jobId: string }> };

export async function POST(request: NextRequest, context: Context): Promise<Response> {
  return withApiErrors(async (requestId) => {
    requireWorkerIdentity(request);
    const { jobId: rawJobId } = await context.params;
    const body = await readJson<{
      attempt?: unknown;
      terminalStatus?: unknown;
      errorCode?: unknown;
      message?: unknown;
      retryable?: unknown;
    }>(request);
    if (
      !Number.isInteger(body.attempt) ||
      Number(body.attempt) < 1 ||
      body.terminalStatus !== "failed" ||
      typeof body.errorCode !== "string" ||
      typeof body.message !== "string"
    ) {
      throw new ApiError(
        400,
        "TERMINAL_STATE_CONFLICT",
        "종료 상태 형식이 올바르지 않습니다.",
      );
    }
    await failWorkerJob(requireUuid(rawJobId), {
      attempt: Number(body.attempt),
      errorCode: body.errorCode,
      message: body.message,
      retryable: body.retryable === true,
    });
    return jsonResponse({ accepted: true }, { status: 202 }, requestId);
  });
}
