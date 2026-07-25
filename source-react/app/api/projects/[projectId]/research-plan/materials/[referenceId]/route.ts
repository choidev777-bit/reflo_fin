import type { NextRequest } from "next/server";
import { authenticatedMutation, readJson, requireUuid } from "@/server/http/request";
import { jsonResponse, withApiErrors } from "@/server/http/response";
import { removeResearchMaterial } from "@/server/infrastructure/repositories/phase4-repository";

type Context = {
  params: Promise<{ projectId: string; referenceId: string }>;
};

export async function DELETE(
  request: NextRequest,
  context: Context,
): Promise<Response> {
  return withApiErrors(async (requestId) => {
    const session = await authenticatedMutation(request);
    const { projectId: rawProjectId, referenceId: rawReferenceId } =
      await context.params;
    const body = await readJson<{ expectedVersion?: unknown }>(request);
    return jsonResponse(
      await removeResearchMaterial({
        projectId: requireUuid(rawProjectId),
        referenceId: requireUuid(rawReferenceId),
        userId: session.userId,
        expectedVersion: body.expectedVersion,
      }),
      {},
      requestId,
    );
  });
}
