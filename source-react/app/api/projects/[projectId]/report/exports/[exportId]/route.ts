import type { NextRequest } from "next/server";
import { authenticatedRequest, requireUuid } from "@/server/http/request";
import { jsonResponse, withApiErrors } from "@/server/http/response";
import { getReportExport } from "@/server/infrastructure/repositories/report-repository";

type Context = { params: Promise<{ projectId: string; exportId: string }> };

export async function GET(request: NextRequest, context: Context) {
  return withApiErrors(async (requestId) => {
    const session = await authenticatedRequest(request);
    const { projectId, exportId } = await context.params;
    return jsonResponse(
      await getReportExport(
        requireUuid(projectId),
        session.userId,
        exportId,
      ),
      {},
      requestId,
    );
  });
}
