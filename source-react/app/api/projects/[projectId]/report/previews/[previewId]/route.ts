import type { NextRequest } from "next/server";
import { authenticatedRequest, requireUuid } from "@/server/http/request";
import { jsonResponse, withApiErrors } from "@/server/http/response";
import { getReportPreview } from "@/server/infrastructure/repositories/report-repository";

type Context = { params: Promise<{ projectId: string; previewId: string }> };

export async function GET(request: NextRequest, context: Context) {
  return withApiErrors(async (requestId) => {
    const session = await authenticatedRequest(request);
    const { projectId, previewId } = await context.params;
    return jsonResponse(
      await getReportPreview(
        requireUuid(projectId),
        session.userId,
        previewId,
      ),
      {},
      requestId,
    );
  });
}
