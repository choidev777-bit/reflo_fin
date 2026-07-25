import type { NextRequest } from "next/server";
import {
  authenticatedRequest,
  requireUuid,
} from "@/server/http/request";
import { jsonResponse, withApiErrors } from "@/server/http/response";
import { getValidationWorkspace } from "@/server/infrastructure/repositories/phase4-repository";
import { kickOutboxDispatcher } from "@/server/infrastructure/temporal/client";

type Context = { params: Promise<{ projectId: string }> };

export async function GET(
  request: NextRequest,
  context: Context,
): Promise<Response> {
  return withApiErrors(async (requestId) => {
    const session = await authenticatedRequest(request);
    const { projectId: rawProjectId } = await context.params;
    kickOutboxDispatcher();
    return jsonResponse(
      await getValidationWorkspace(requireUuid(rawProjectId), session.userId),
      {},
      requestId,
    );
  });
}
