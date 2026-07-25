import type { NextRequest } from "next/server";
import {
  authenticatedMutation,
  authenticatedRequest,
  readJson,
  requireUuid,
} from "@/server/http/request";
import { jsonResponse, withApiErrors } from "@/server/http/response";
import {
  getHypothesisWorkspace,
  saveHypothesis,
} from "@/server/infrastructure/repositories/hypothesis-repository";
import { kickOutboxDispatcher } from "@/server/infrastructure/temporal/client";

type Context = { params: Promise<{ projectId: string }> };

export async function GET(request: NextRequest, context: Context): Promise<Response> {
  return withApiErrors(async (requestId) => {
    const session = await authenticatedRequest(request);
    const { projectId: rawProjectId } = await context.params;
    const projectId = requireUuid(rawProjectId);
    kickOutboxDispatcher();
    return jsonResponse(
      await getHypothesisWorkspace(projectId, session.userId),
      {},
      requestId,
    );
  });
}

export async function PATCH(
  request: NextRequest,
  context: Context,
): Promise<Response> {
  return withApiErrors(async (requestId) => {
    const session = await authenticatedMutation(request);
    const { projectId: rawProjectId } = await context.params;
    const projectId = requireUuid(rawProjectId);
    const body = await readJson<{
      expectedDraftVersion?: unknown;
      provisionalRating?: unknown;
      thesis?: unknown;
      requestId?: unknown;
    }>(request);
    return jsonResponse(
      await saveHypothesis({
        projectId,
        userId: session.userId,
        expectedDraftVersion: body.expectedDraftVersion,
        provisionalRating: body.provisionalRating,
        thesis: body.thesis,
        requestId: body.requestId,
      }),
      {},
      requestId,
    );
  });
}
