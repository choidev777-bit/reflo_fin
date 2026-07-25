import type { NextRequest } from "next/server";
import {
  authenticatedMutation,
  readJson,
  requireUuid,
} from "@/server/http/request";
import { jsonResponse, withApiErrors } from "@/server/http/response";
import { completeValidation } from "@/server/infrastructure/repositories/phase4-repository";

type Context = { params: Promise<{ projectId: string }> };

export async function POST(
  request: NextRequest,
  context: Context,
): Promise<Response> {
  return withApiErrors(async (requestId) => {
    const session = await authenticatedMutation(request);
    const { projectId: rawProjectId } = await context.params;
    const body = await readJson<{ expectedValidationVersion?: unknown }>(
      request,
    );
    const result = await completeValidation({
      projectId: requireUuid(rawProjectId),
      userId: session.userId,
      idempotencyKey: request.headers.get("idempotency-key"),
      expectedValidationVersion: body.expectedValidationVersion,
    });
    return jsonResponse(result.body, { status: result.status }, requestId);
  });
}
