import type { NextRequest } from "next/server";
import {
  authenticatedMutation,
  readJson,
  requireUuid,
} from "@/server/http/request";
import { jsonResponse, withApiErrors } from "@/server/http/response";
import { patchReportVersion } from "@/server/infrastructure/repositories/report-repository";

type Context = { params: Promise<{ projectId: string; versionId: string }> };

export async function PATCH(request: NextRequest, context: Context) {
  return withApiErrors(async (requestId) => {
    const session = await authenticatedMutation(request);
    const { projectId, versionId } = await context.params;
    const body = await readJson<{
      expectedVersion: unknown;
      editSessionId: unknown;
      clientMutationId: unknown;
      operations: unknown;
    }>(request);
    return jsonResponse(
      await patchReportVersion({
        ...body,
        projectId: requireUuid(projectId),
        userId: session.userId,
        reportVersionId: versionId,
        leaseToken: request.headers.get("X-Edit-Lease"),
      }),
      {},
      requestId,
    );
  });
}
