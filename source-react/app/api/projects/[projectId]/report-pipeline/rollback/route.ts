import type { NextRequest } from "next/server";
import {
  authenticatedMutation,
  requireUuid,
} from "@/server/http/request";
import { jsonResponse, withApiErrors } from "@/server/http/response";
import { rollbackReportPipeline } from "@/server/infrastructure/repositories/report-pipeline-migration-repository";

type Context = { params: Promise<{ projectId: string }> };

export async function POST(request: NextRequest, context: Context) {
  return withApiErrors(async (requestId) => {
    const session = await authenticatedMutation(request);
    const { projectId } = await context.params;
    return jsonResponse(
      await rollbackReportPipeline({
        projectId: requireUuid(projectId),
        userId: session.userId,
      }),
      undefined,
      requestId,
    );
  });
}
