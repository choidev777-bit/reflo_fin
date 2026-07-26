import type { NextRequest } from "next/server";
import {
  authenticatedMutation,
  readJson,
  requireUuid,
} from "@/server/http/request";
import { ApiError } from "@/server/http/api-error";
import { jsonResponse, withApiErrors } from "@/server/http/response";
import { createReportPipelineMigration } from "@/server/infrastructure/repositories/report-pipeline-migration-repository";
import { kickOutboxDispatcher } from "@/server/infrastructure/temporal/client";

type Context = { params: Promise<{ projectId: string }> };

export async function POST(request: NextRequest, context: Context) {
  return withApiErrors(async (requestId) => {
    const session = await authenticatedMutation(request);
    const { projectId } = await context.params;
    const body = await readJson<{ mode?: unknown }>(request);
    if (body.mode !== "dry_run" && body.mode !== "apply") {
      throw new ApiError(
        400,
        "INVALID_MIGRATION_MODE",
        "mode는 dry_run 또는 apply여야 합니다.",
      );
    }
    const result = await createReportPipelineMigration({
      projectId: requireUuid(projectId),
      userId: session.userId,
      mode: body.mode,
      idempotencyKey: request.headers.get("idempotency-key"),
    });
    if (body.mode === "apply") kickOutboxDispatcher();
    return jsonResponse(
      result,
      { status: body.mode === "apply" ? 202 : 200 },
      requestId,
    );
  });
}
