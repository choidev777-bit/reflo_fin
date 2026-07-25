import type { NextRequest } from "next/server";
import { authenticatedMutation, requireUuid } from "@/server/http/request";
import { jsonResponse, withApiErrors } from "@/server/http/response";
import { heartbeatReportEditSession } from "@/server/infrastructure/repositories/report-repository";

type Context = { params: Promise<{ projectId: string; sessionId: string }> };

export async function POST(request: NextRequest, context: Context) {
  return withApiErrors(async (requestId) => {
    const session = await authenticatedMutation(request);
    const { projectId, sessionId } = await context.params;
    return jsonResponse(
      await heartbeatReportEditSession({
        projectId: requireUuid(projectId),
        userId: session.userId,
        editSessionId: sessionId,
        leaseToken: request.headers.get("X-Edit-Lease"),
      }),
      {},
      requestId,
    );
  });
}
