import type { NextRequest } from "next/server";
import {
  authenticatedMutation,
  readJson,
  requireUuid,
} from "@/server/http/request";
import { jsonResponse, withApiErrors } from "@/server/http/response";
import { approveResearchPlanAndStart } from "@/server/infrastructure/repositories/phase4-repository";
import { kickOutboxDispatcher } from "@/server/infrastructure/temporal/client";

type Context = { params: Promise<{ projectId: string }> };

export async function POST(
  request: NextRequest,
  context: Context,
): Promise<Response> {
  return withApiErrors(async (requestId) => {
    const session = await authenticatedMutation(request);
    const { projectId: rawProjectId } = await context.params;
    const body = await readJson<{
      planId?: unknown;
      expectedVersion?: unknown;
    }>(request);
    const result = await approveResearchPlanAndStart({
      projectId: requireUuid(rawProjectId),
      userId: session.userId,
      idempotencyKey: request.headers.get("idempotency-key"),
      planId: body.planId,
      expectedVersion: body.expectedVersion,
    });
    kickOutboxDispatcher();
    return jsonResponse(result.body, { status: result.status }, requestId);
  });
}
