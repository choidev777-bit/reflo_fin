import type { NextRequest } from "next/server";
import { authenticatedRequest, requireUuid } from "@/server/http/request";
import { jsonResponse, withApiErrors } from "@/server/http/response";
import { getReportPipelineMigration } from "@/server/infrastructure/repositories/report-pipeline-migration-repository";

type Context = {
  params: Promise<{ projectId: string; migrationRunId: string }>;
};

export async function GET(request: NextRequest, context: Context) {
  return withApiErrors(async (requestId) => {
    const session = await authenticatedRequest(request);
    const { projectId, migrationRunId } = await context.params;
    return jsonResponse(
      await getReportPipelineMigration({
        projectId: requireUuid(projectId),
        userId: session.userId,
        migrationRunId: requireUuid(migrationRunId),
      }),
      undefined,
      requestId,
    );
  });
}
