import type { NextRequest } from "next/server";
import {
  authenticatedMutation,
  authenticatedRequest,
  readJson,
  requireUuid,
} from "@/server/http/request";
import { jsonResponse, withApiErrors } from "@/server/http/response";
import {
  getResearchPlanWorkspace,
  saveResearchPlan,
} from "@/server/infrastructure/repositories/phase4-repository";
import { kickOutboxDispatcher } from "@/server/infrastructure/temporal/client";

type Context = { params: Promise<{ projectId: string }> };

export async function GET(
  request: NextRequest,
  context: Context,
): Promise<Response> {
  return withApiErrors(async (requestId) => {
    const session = await authenticatedRequest(request);
    const { projectId: rawProjectId } = await context.params;
    const projectId = requireUuid(rawProjectId);
    kickOutboxDispatcher();
    return jsonResponse(
      await getResearchPlanWorkspace(projectId, session.userId),
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
    const body = await readJson<{
      expectedVersion?: unknown;
      changes?: unknown;
    }>(request);
    return jsonResponse(
      await saveResearchPlan({
        projectId: requireUuid(rawProjectId),
        userId: session.userId,
        expectedVersion: body.expectedVersion,
        changes: body.changes,
      }),
      {},
      requestId,
    );
  });
}
