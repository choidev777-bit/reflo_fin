import type { NextRequest } from "next/server";
import {
  authenticatedMutation,
  readJson,
  requireUuid,
} from "@/server/http/request";
import { jsonResponse, withApiErrors } from "@/server/http/response";
import { reorderHypothesisQuestions } from "@/server/infrastructure/repositories/hypothesis-repository";

type Context = {
  params: Promise<{ projectId: string; questionSetId: string }>;
};

export async function PUT(
  request: NextRequest,
  context: Context,
): Promise<Response> {
  return withApiErrors(async (requestId) => {
    const session = await authenticatedMutation(request);
    const params = await context.params;
    const body = await readJson<{
      expectedQuestionSetVersion?: unknown;
      questionIds?: unknown;
      requestId?: unknown;
    }>(request);
    return jsonResponse(
      await reorderHypothesisQuestions({
        projectId: requireUuid(params.projectId),
        questionSetId: requireUuid(params.questionSetId),
        userId: session.userId,
        expectedQuestionSetVersion: body.expectedQuestionSetVersion,
        questionIds: body.questionIds,
        requestId: body.requestId,
      }),
      {},
      requestId,
    );
  });
}
