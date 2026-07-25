import type { NextRequest } from "next/server";
import {
  authenticatedMutation,
  requireUuid,
} from "@/server/http/request";
import { jsonResponse, withApiErrors } from "@/server/http/response";
import { cancelResearchJob } from "@/server/infrastructure/repositories/phase4-repository";
import { kickOutboxDispatcher } from "@/server/infrastructure/temporal/client";

type Context = { params: Promise<{ projectId: string; jobId: string }> };

export async function POST(
  request: NextRequest,
  context: Context,
): Promise<Response> {
  return withApiErrors(async (requestId) => {
    const session = await authenticatedMutation(request);
    const params = await context.params;
    const result = await cancelResearchJob({
      projectId: requireUuid(params.projectId),
      jobId: requireUuid(params.jobId),
      userId: session.userId,
      idempotencyKey: request.headers.get("idempotency-key"),
    });
    kickOutboxDispatcher();
    return jsonResponse(result.body, { status: result.status }, requestId);
  });
}
