import type { NextRequest } from "next/server";
import {
  authenticatedMutation,
  readJson,
  requireUuid,
} from "@/server/http/request";
import { jsonResponse, withApiErrors } from "@/server/http/response";
import { decideValidationResult } from "@/server/infrastructure/repositories/phase4-repository";
import { kickOutboxDispatcher } from "@/server/infrastructure/temporal/client";

type Context = { params: Promise<{ projectId: string; resultId: string }> };

export async function POST(
  request: NextRequest,
  context: Context,
): Promise<Response> {
  return withApiErrors(async (requestId) => {
    const session = await authenticatedMutation(request);
    const params = await context.params;
    const body = await readJson<{
      expectedValidationVersion?: unknown;
      action?: unknown;
      reason?: unknown;
    }>(request);
    const result = await decideValidationResult({
      projectId: requireUuid(params.projectId),
      resultId: requireUuid(params.resultId),
      userId: session.userId,
      idempotencyKey: request.headers.get("idempotency-key"),
      expectedValidationVersion: body.expectedValidationVersion,
      action: body.action,
      reason: body.reason,
    });
    kickOutboxDispatcher();
    return jsonResponse(result.body, { status: result.status }, requestId);
  });
}
