import type { NextRequest } from "next/server";
import {
  authenticatedRequest,
  requireUuid,
} from "@/server/http/request";
import { jsonResponse, withApiErrors } from "@/server/http/response";
import { getValidationResult } from "@/server/infrastructure/repositories/phase4-repository";

type Context = { params: Promise<{ projectId: string; resultId: string }> };

export async function GET(
  request: NextRequest,
  context: Context,
): Promise<Response> {
  return withApiErrors(async (requestId) => {
    const session = await authenticatedRequest(request);
    const params = await context.params;
    return jsonResponse(
      await getValidationResult({
        projectId: requireUuid(params.projectId),
        resultId: requireUuid(params.resultId),
        userId: session.userId,
      }),
      {},
      requestId,
    );
  });
}
