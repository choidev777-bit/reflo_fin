import type { NextRequest } from "next/server";
import { authenticatedRequest, requireUuid } from "@/server/http/request";
import { jsonResponse, withApiErrors } from "@/server/http/response";
import { getReportPage } from "@/server/infrastructure/repositories/report-repository";

type Context = { params: Promise<{ projectId: string; pageId: string }> };

export async function GET(request: NextRequest, context: Context) {
  return withApiErrors(async (requestId) => {
    const session = await authenticatedRequest(request);
    const { projectId, pageId } = await context.params;
    return jsonResponse(
      await getReportPage(requireUuid(projectId), session.userId, pageId),
      {},
      requestId,
    );
  });
}
