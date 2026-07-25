import type { NextRequest } from "next/server";
import {
  authenticatedRequest,
  requireUuid,
} from "@/server/http/request";
import { jsonResponse, withApiErrors } from "@/server/http/response";
import { getResearchJob } from "@/server/infrastructure/repositories/phase4-repository";
import { kickOutboxDispatcher } from "@/server/infrastructure/temporal/client";

type Context = { params: Promise<{ projectId: string; jobId: string }> };

export async function GET(
  request: NextRequest,
  context: Context,
): Promise<Response> {
  return withApiErrors(async (requestId) => {
    const session = await authenticatedRequest(request);
    const params = await context.params;
    kickOutboxDispatcher();
    return jsonResponse(
      await getResearchJob({
        projectId: requireUuid(params.projectId),
        jobId: requireUuid(params.jobId),
        userId: session.userId,
      }),
      {},
      requestId,
    );
  });
}
