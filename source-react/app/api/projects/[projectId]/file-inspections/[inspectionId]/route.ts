import { createHash } from "node:crypto";
import type { NextRequest } from "next/server";
import { authenticatedRequest, requireUuid } from "@/server/http/request";
import { jsonResponse, withApiErrors } from "@/server/http/response";
import { getFileInspection } from "@/server/infrastructure/repositories/file-repository";
import { kickOutboxDispatcher } from "@/server/infrastructure/temporal/client";

type Context = {
  params: Promise<{ projectId: string; inspectionId: string }>;
};

export async function GET(request: NextRequest, context: Context): Promise<Response> {
  return withApiErrors(async (requestId) => {
    const session = await authenticatedRequest(request);
    const params = await context.params;
    const body = await getFileInspection({
      projectId: requireUuid(params.projectId),
      inspectionId: requireUuid(params.inspectionId),
      userId: session.userId,
    });
    const etag = `"${createHash("sha256")
      .update(JSON.stringify(body))
      .digest("base64url")}"`;
    if (request.headers.get("if-none-match") === etag) {
      return new Response(null, {
        status: 304,
        headers: { ETag: etag, "X-Request-Id": requestId },
      });
    }
    kickOutboxDispatcher();
    return jsonResponse(body, { headers: { ETag: etag } }, requestId);
  });
}
