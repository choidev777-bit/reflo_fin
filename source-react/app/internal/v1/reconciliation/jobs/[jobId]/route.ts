import type { NextRequest } from "next/server";
import { requireWorkerIdentity } from "@/server/http/internal-auth";
import { readJson, requireUuid } from "@/server/http/request";
import { jsonResponse, withApiErrors } from "@/server/http/response";
import { ApiError } from "@/server/http/api-error";
import { reconcileJobProjection } from "@/server/infrastructure/repositories/file-repository";

type Context = { params: Promise<{ jobId: string }> };

type ReconciliationCommand = {
  observedState?: unknown;
  repairAction?: unknown;
};

export async function POST(
  request: NextRequest,
  context: Context,
): Promise<Response> {
  return withApiErrors(async (requestId) => {
    requireWorkerIdentity(request);
    const { jobId: rawJobId } = await context.params;
    const command = await readJson<ReconciliationCommand>(request);
    if (
      typeof command.observedState !== "string" ||
      !["none", "mark_failed", "mark_cancelled"].includes(
        String(command.repairAction),
      )
    ) {
      throw new ApiError(
        400,
        "RECONCILIATION_COMMAND_INVALID",
        "관측 상태와 복구 명령이 올바르지 않습니다.",
      );
    }
    await reconcileJobProjection({
      jobId: requireUuid(rawJobId),
      observedState: command.observedState,
      repairAction: command.repairAction as
        | "none"
        | "mark_failed"
        | "mark_cancelled",
    });
    return jsonResponse({ accepted: true }, { status: 202 }, requestId);
  });
}
