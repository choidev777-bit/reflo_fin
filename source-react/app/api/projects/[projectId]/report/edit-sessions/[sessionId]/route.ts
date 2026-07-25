import type { NextRequest } from "next/server";
import { authenticatedMutation, requireUuid } from "@/server/http/request";
import { withApiErrors } from "@/server/http/response";
import { releaseReportEditSession } from "@/server/infrastructure/repositories/report-repository";

type Context = { params: Promise<{ projectId: string; sessionId: string }> };

export async function DELETE(request: NextRequest, context: Context) {
  return withApiErrors(async () => {
    const session = await authenticatedMutation(request);
    const { projectId, sessionId } = await context.params;
    await releaseReportEditSession({
      projectId: requireUuid(projectId),
      userId: session.userId,
      editSessionId: sessionId,
      leaseToken: request.headers.get("X-Edit-Lease"),
    });
    return new Response(null, { status: 204 });
  });
}
