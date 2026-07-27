import type { NextRequest } from "next/server";
import {
  authenticatedMutation,
  readJson,
  requireUuid,
} from "@/server/http/request";
import { jsonResponse, withApiErrors } from "@/server/http/response";
import { updateValuationDraft } from "@/server/infrastructure/repositories/valuation-repository";

type Context = { params: Promise<{ projectId: string }> };

export async function PUT(request: NextRequest, context: Context) {
  return withApiErrors(async (requestId) => {
    const session = await authenticatedMutation(request);
    const { projectId } = await context.params;
    const body = await readJson<{
      workbookVersion: unknown;
      draftVersion: unknown;
      requestId: unknown;
      inputMode: unknown;
      targetPer?: unknown;
      targetPrice?: unknown;
    }>(request);
    return jsonResponse(
      await updateValuationDraft({
        ...body,
        projectId: requireUuid(projectId),
        userId: session.userId,
      }),
      {},
      requestId,
    );
  });
}
