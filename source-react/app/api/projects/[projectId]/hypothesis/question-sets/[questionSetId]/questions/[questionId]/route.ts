import type { NextRequest } from "next/server";
import {
  authenticatedMutation,
  readJson,
  requireUuid,
} from "@/server/http/request";
import { jsonResponse, withApiErrors } from "@/server/http/response";
import {
  deleteHypothesisQuestion,
  updateHypothesisQuestion,
} from "@/server/infrastructure/repositories/hypothesis-repository";

type Context = {
  params: Promise<{
    projectId: string;
    questionSetId: string;
    questionId: string;
  }>;
};

async function requestContext(request: NextRequest, context: Context) {
  const session = await authenticatedMutation(request);
  const params = await context.params;
  return {
    userId: session.userId,
    projectId: requireUuid(params.projectId),
    questionSetId: requireUuid(params.questionSetId),
    questionId: requireUuid(params.questionId),
  };
}

export async function PATCH(
  request: NextRequest,
  context: Context,
): Promise<Response> {
  return withApiErrors(async (requestId) => {
    const identifiers = await requestContext(request, context);
    const body = await readJson<{
      expectedQuestionSetVersion?: unknown;
      text?: unknown;
      requestId?: unknown;
    }>(request);
    return jsonResponse(
      await updateHypothesisQuestion({
        ...identifiers,
        expectedQuestionSetVersion: body.expectedQuestionSetVersion,
        text: body.text,
        requestId: body.requestId,
      }),
      {},
      requestId,
    );
  });
}

export async function DELETE(
  request: NextRequest,
  context: Context,
): Promise<Response> {
  return withApiErrors(async (requestId) => {
    const identifiers = await requestContext(request, context);
    const body = await readJson<{
      expectedQuestionSetVersion?: unknown;
      requestId?: unknown;
    }>(request);
    return jsonResponse(
      await deleteHypothesisQuestion({
        ...identifiers,
        expectedQuestionSetVersion: body.expectedQuestionSetVersion,
        requestId: body.requestId,
      }),
      {},
      requestId,
    );
  });
}
