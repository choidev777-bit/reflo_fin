import type { NextRequest } from "next/server";
import {
  authenticatedMutation,
  readJson,
  requireUuid,
} from "@/server/http/request";
import { jsonResponse, withApiErrors } from "@/server/http/response";
import { approveHypothesisQuestionSet } from "@/server/infrastructure/repositories/hypothesis-repository";

type Context = {
  params: Promise<{ projectId: string; questionSetId: string }>;
};

export async function POST(
  request: NextRequest,
  context: Context,
): Promise<Response> {
  return withApiErrors(async (requestId) => {
    const session = await authenticatedMutation(request);
    const params = await context.params;
    const body = await readJson<{
      expectedQuestionSetVersion?: unknown;
      inputRevision?: unknown;
      requestId?: unknown;
    }>(request);
    const result = await approveHypothesisQuestionSet({
      projectId: requireUuid(params.projectId),
      questionSetId: requireUuid(params.questionSetId),
      userId: session.userId,
      idempotencyKey: request.headers.get("idempotency-key"),
      expectedQuestionSetVersion: body.expectedQuestionSetVersion,
      inputRevision: body.inputRevision,
      requestId: body.requestId,
    });
    return jsonResponse(result.body, { status: result.status }, requestId);
  });
}
