import type { NextRequest } from "next/server";
import {
  authenticatedMutation,
  readJson,
  requireUuid,
} from "@/server/http/request";
import { jsonResponse, withApiErrors } from "@/server/http/response";
import { acceptQualifiedQuestion } from "@/server/infrastructure/repositories/phase4-repository";

type Context = { params: Promise<{ projectId: string; questionId: string }> };

export async function POST(
  request: NextRequest,
  context: Context,
): Promise<Response> {
  return withApiErrors(async (requestId) => {
    const session = await authenticatedMutation(request);
    const params = await context.params;
    const body = await readJson<{
      expectedValidationVersion?: unknown;
      reason?: unknown;
    }>(request);
    const result = await acceptQualifiedQuestion({
      projectId: requireUuid(params.projectId),
      questionId: requireUuid(params.questionId),
      userId: session.userId,
      idempotencyKey: request.headers.get("idempotency-key"),
      expectedValidationVersion: body.expectedValidationVersion,
      reason: body.reason,
    });
    return jsonResponse(result.body, { status: result.status }, requestId);
  });
}
