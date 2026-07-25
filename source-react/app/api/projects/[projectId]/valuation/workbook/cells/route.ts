import type { NextRequest } from "next/server";
import {
  authenticatedMutation,
  readJson,
  requireUuid,
} from "@/server/http/request";
import { jsonResponse, withApiErrors } from "@/server/http/response";
import { patchValuationCells } from "@/server/infrastructure/repositories/valuation-repository";

type Context = { params: Promise<{ projectId: string }> };

export async function PATCH(request: NextRequest, context: Context) {
  return withApiErrors(async (requestId) => {
    const session = await authenticatedMutation(request);
    const { projectId } = await context.params;
    const body = await readJson<{
      workbookVersion: unknown;
      editableCellSetVersion: unknown;
      requestId: unknown;
      changes: unknown;
    }>(request);
    return jsonResponse(
      await patchValuationCells({
        projectId: requireUuid(projectId),
        userId: session.userId,
        ...body,
      }),
      {},
      requestId,
    );
  });
}
