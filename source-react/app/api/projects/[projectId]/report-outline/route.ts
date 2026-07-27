import type { NextRequest } from "next/server";
import {
  authenticatedMutation,
  authenticatedRequest,
  readJson,
  requireUuid,
} from "@/server/http/request";
import { jsonResponse, withApiErrors } from "@/server/http/response";
import {
  getReportOutlineWorkspace,
  patchReportOutline,
} from "@/server/infrastructure/repositories/report-repository";

type Context = { params: Promise<{ projectId: string }> };

export async function GET(request: NextRequest, context: Context) {
  return withApiErrors(async (requestId) => {
    const session = await authenticatedRequest(request);
    const { projectId } = await context.params;
    return jsonResponse(
      await getReportOutlineWorkspace(requireUuid(projectId), session.userId),
      {},
      requestId,
    );
  });
}

export async function PATCH(request: NextRequest, context: Context) {
  return withApiErrors(async (requestId) => {
    const session = await authenticatedMutation(request);
    const { projectId } = await context.params;
    const body = await readJson<{
      expectedVersion: unknown;
      requestId: unknown;
      changes: unknown;
    }>(request);
    return jsonResponse(
      await patchReportOutline({
        ...body,
        projectId: requireUuid(projectId),
        userId: session.userId,
      }),
      {},
      requestId,
    );
  });
}
