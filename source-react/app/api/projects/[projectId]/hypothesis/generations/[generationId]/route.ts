import type { NextRequest } from "next/server";
import { authenticatedRequest, requireUuid } from "@/server/http/request";
import { jsonResponse, withApiErrors } from "@/server/http/response";
import { getHypothesisGeneration } from "@/server/infrastructure/repositories/hypothesis-repository";
import { kickOutboxDispatcher } from "@/server/infrastructure/temporal/client";

type Context = {
  params: Promise<{ projectId: string; generationId: string }>;
};

export async function GET(request: NextRequest, context: Context): Promise<Response> {
  return withApiErrors(async (requestId) => {
    const session = await authenticatedRequest(request);
    const params = await context.params;
    const projectId = requireUuid(params.projectId);
    const generationId = requireUuid(params.generationId);
    kickOutboxDispatcher();
    return jsonResponse(
      await getHypothesisGeneration({
        projectId,
        generationId,
        userId: session.userId,
      }),
      {},
      requestId,
    );
  });
}
