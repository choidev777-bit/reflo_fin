import { createHash } from "node:crypto";
import type { NextRequest } from "next/server";
import { authenticatedRequest, requireUuid } from "@/server/http/request";
import { jsonResponse, withApiErrors } from "@/server/http/response";
import { getReportMaterialization } from "@/server/infrastructure/repositories/report-repository";

type Context = {
  params: Promise<{ projectId: string; taskId: string }>;
};

export async function GET(
  request: NextRequest,
  context: Context,
): Promise<Response> {
  return withApiErrors(async (requestId) => {
    const session = await authenticatedRequest(request);
    const { projectId, taskId } = await context.params;
    const body = await getReportMaterialization({
      projectId: requireUuid(projectId),
      userId: session.userId,
      materializationRunId: requireUuid(taskId),
    });
    const etag = `"${createHash("sha256")
      .update(JSON.stringify(body))
      .digest("hex")}"`;
    if (request.headers.get("if-none-match") === etag) {
      return new Response(null, {
        status: 304,
        headers: { ETag: etag, "X-Request-Id": requestId },
      });
    }
    return jsonResponse(body, { headers: { ETag: etag } }, requestId);
  });
}
