import type { NextRequest } from "next/server";
import { authenticatedMutation, requireUuid } from "@/server/http/request";
import { jsonResponse, withApiErrors } from "@/server/http/response";
import { cancelReportExport } from "@/server/infrastructure/repositories/report-repository";

type Context = { params: Promise<{ projectId: string; exportId: string }> };

export async function POST(request: NextRequest, context: Context) {
  return withApiErrors(async (requestId) => {
    const session = await authenticatedMutation(request);
    const { projectId, exportId } = await context.params;
    return jsonResponse(
      await cancelReportExport({
        projectId: requireUuid(projectId),
        userId: session.userId,
        exportId,
      }),
      { status: 202 },
      requestId,
    );
  });
}
