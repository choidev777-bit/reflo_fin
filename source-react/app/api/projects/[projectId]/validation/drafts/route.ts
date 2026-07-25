import type { NextRequest } from "next/server";
import {
  authenticatedMutation,
  readJson,
  requireUuid,
} from "@/server/http/request";
import { jsonResponse, withApiErrors } from "@/server/http/response";
import { saveValidationDraft } from "@/server/infrastructure/repositories/phase4-repository";

type Context = { params: Promise<{ projectId: string }> };

export async function POST(
  request: NextRequest,
  context: Context,
): Promise<Response> {
  return withApiErrors(async (requestId) => {
    const session = await authenticatedMutation(request);
    const { projectId: rawProjectId } = await context.params;
    const body = await readJson<{
      targetType?: unknown;
      targetId?: unknown;
      action?: unknown;
      reason?: unknown;
    }>(request);
    return jsonResponse(
      await saveValidationDraft({
        projectId: requireUuid(rawProjectId),
        userId: session.userId,
        targetType: body.targetType,
        targetId: body.targetId,
        action: body.action,
        reason: body.reason,
      }),
      {},
      requestId,
    );
  });
}
