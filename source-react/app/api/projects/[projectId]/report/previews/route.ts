import type { NextRequest } from "next/server";
import {
  authenticatedMutation,
  readJson,
  requireUuid,
} from "@/server/http/request";
import { jsonResponse, withApiErrors } from "@/server/http/response";
import { createReportPreview } from "@/server/infrastructure/repositories/report-repository";

type Context = { params: Promise<{ projectId: string }> };

export async function POST(request: NextRequest, context: Context) {
  return withApiErrors(async (requestId) => {
    const session = await authenticatedMutation(request);
    const { projectId } = await context.params;
    const body = await readJson<{ reportVersionId: unknown }>(request);
    return jsonResponse(
      await createReportPreview({
        projectId: requireUuid(projectId),
        userId: session.userId,
        reportVersionId: body.reportVersionId,
      }),
      { status: 202 },
      requestId,
    );
  });
}
