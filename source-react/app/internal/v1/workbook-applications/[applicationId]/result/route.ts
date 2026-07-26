import type { NextRequest } from "next/server";
import { requireWorkerIdentity } from "@/server/http/internal-auth";
import { readJson, requireUuid } from "@/server/http/request";
import { jsonResponse, withApiErrors } from "@/server/http/response";
import {
  commitWorkbookApplicationResult,
  type WorkbookApplicationWorkerPayload,
} from "@/server/infrastructure/repositories/workbook-application-repository";
import { ApiError } from "@/server/http/api-error";

type Context = { params: Promise<{ applicationId: string }> };

export async function POST(
  request: NextRequest,
  context: Context,
): Promise<Response> {
  return withApiErrors(async (requestId) => {
    requireWorkerIdentity(request);
    const { applicationId } = await context.params;
    const body = await readJson<{
      attempt?: unknown;
      payload?: WorkbookApplicationWorkerPayload;
    }>(request);
    const attempt = Number(body.attempt);
    if (
      !Number.isInteger(attempt) ||
      attempt < 1 ||
      !body.payload?.artifact ||
      !body.payload.result
    ) {
      throw new ApiError(
        400,
        "RESULT_SCHEMA_INVALID",
        "Workbook worker 결과 형식이 올바르지 않습니다.",
      );
    }
    const outcome = await commitWorkbookApplicationResult(
      requireUuid(applicationId),
      body.payload,
      attempt,
    );
    return jsonResponse(outcome, undefined, requestId);
  });
}
