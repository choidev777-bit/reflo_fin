import type { NextRequest } from "next/server";
import { authenticatedRequest, requireUuid } from "@/server/http/request";
import { jsonResponse, withApiErrors } from "@/server/http/response";
import { getReportProvenance } from "@/server/infrastructure/repositories/report-repository";

type Context = { params: Promise<{ projectId: string; blockId: string }> };

export async function GET(request: NextRequest, context: Context) {
  return withApiErrors(async (requestId) => {
    const session = await authenticatedRequest(request);
    const { projectId, blockId } = await context.params;
    return jsonResponse(
      await getReportProvenance(
        requireUuid(projectId),
        session.userId,
        blockId,
      ),
      {},
      requestId,
    );
  });
}
