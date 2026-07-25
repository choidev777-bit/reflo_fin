import type { NextRequest } from "next/server";
import {
  authenticatedMutation,
  readJson,
  requireUuid,
} from "@/server/http/request";
import { jsonResponse, withApiErrors } from "@/server/http/response";
import { retryReportExport } from "@/server/infrastructure/repositories/report-repository";

type Context = { params: Promise<{ projectId: string; exportId: string }> };

export async function POST(request: NextRequest, context: Context) {
  return withApiErrors(async (requestId) => {
    const session = await authenticatedMutation(request);
    const { projectId, exportId } = await context.params;
    const body = await readJson<{ artifactTypes: unknown }>(request);
    return jsonResponse(
      await retryReportExport({
        projectId: requireUuid(projectId),
        userId: session.userId,
        exportId,
        artifactTypes: body.artifactTypes,
      }),
      { status: 202 },
      requestId,
    );
  });
}
