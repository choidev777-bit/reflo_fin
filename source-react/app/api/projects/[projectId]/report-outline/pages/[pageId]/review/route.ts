import type { NextRequest } from "next/server";
import {
  authenticatedMutation,
  readJson,
  requireUuid,
} from "@/server/http/request";
import { jsonResponse, withApiErrors } from "@/server/http/response";
import { reviewReportOutlinePage } from "@/server/infrastructure/repositories/report-repository";

type Context = { params: Promise<{ projectId: string; pageId: string }> };

export async function POST(request: NextRequest, context: Context) {
  return withApiErrors(async (requestId) => {
    const session = await authenticatedMutation(request);
    const { projectId, pageId } = await context.params;
    const body = await readJson<{ expectedOutlineVersion: unknown }>(request);
    return jsonResponse(
      await reviewReportOutlinePage({
        projectId: requireUuid(projectId),
        userId: session.userId,
        pageId,
        expectedOutlineVersion: body.expectedOutlineVersion,
      }),
      {},
      requestId,
    );
  });
}
