import type { NextRequest } from "next/server";
import { authenticatedRequest, requireUuid } from "@/server/http/request";
import { jsonResponse, withApiErrors } from "@/server/http/response";
import { getReportValidation } from "@/server/infrastructure/repositories/report-repository";

type Context = { params: Promise<{ projectId: string; runId: string }> };

export async function GET(request: NextRequest, context: Context) {
  return withApiErrors(async (requestId) => {
    const session = await authenticatedRequest(request);
    const { projectId, runId } = await context.params;
    return jsonResponse(
      await getReportValidation(
        requireUuid(projectId),
        session.userId,
        runId,
      ),
      {},
      requestId,
    );
  });
}
