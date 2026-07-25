import type { NextRequest } from "next/server";
import { authenticatedMutation, requireUuid } from "@/server/http/request";
import { jsonResponse, withApiErrors } from "@/server/http/response";
import { restoreReportVersion } from "@/server/infrastructure/repositories/report-repository";

type Context = { params: Promise<{ projectId: string; versionId: string }> };

export async function POST(request: NextRequest, context: Context) {
  return withApiErrors(async (requestId) => {
    const session = await authenticatedMutation(request);
    const { projectId, versionId } = await context.params;
    const result = await restoreReportVersion({
      projectId: requireUuid(projectId),
      userId: session.userId,
      versionId,
      idempotencyKey: request.headers.get("Idempotency-Key"),
    });
    return jsonResponse(result.body, { status: result.status }, requestId);
  });
}
