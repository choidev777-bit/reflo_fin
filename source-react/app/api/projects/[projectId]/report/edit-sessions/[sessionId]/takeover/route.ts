import type { NextRequest } from "next/server";
import { authenticatedMutation, requireUuid } from "@/server/http/request";
import { jsonResponse, withApiErrors } from "@/server/http/response";
import { takeoverReportEditSession } from "@/server/infrastructure/repositories/report-repository";

type Context = { params: Promise<{ projectId: string; sessionId: string }> };

export async function POST(request: NextRequest, context: Context) {
  return withApiErrors(async (requestId) => {
    const session = await authenticatedMutation(request);
    const { projectId, sessionId } = await context.params;
    return jsonResponse(
      await takeoverReportEditSession({
        projectId: requireUuid(projectId),
        userId: session.userId,
        editSessionId: sessionId,
      }),
      {},
      requestId,
    );
  });
}
