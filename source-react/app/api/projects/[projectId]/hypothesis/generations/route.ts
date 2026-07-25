import type { NextRequest } from "next/server";
import {
  authenticatedMutation,
  readJson,
  requireUuid,
} from "@/server/http/request";
import { jsonResponse, withApiErrors } from "@/server/http/response";
import { createHypothesisGeneration } from "@/server/infrastructure/repositories/hypothesis-repository";
import { kickOutboxDispatcher } from "@/server/infrastructure/temporal/client";

type Context = { params: Promise<{ projectId: string }> };

export async function POST(
  request: NextRequest,
  context: Context,
): Promise<Response> {
  return withApiErrors(async (requestId) => {
    const session = await authenticatedMutation(request);
    const { projectId: rawProjectId } = await context.params;
    const projectId = requireUuid(rawProjectId);
    const body = await readJson<{
      expectedDraftVersion?: unknown;
      inputRevision?: unknown;
      requestId?: unknown;
    }>(request);
    const result = await createHypothesisGeneration({
      projectId,
      userId: session.userId,
      idempotencyKey: request.headers.get("idempotency-key"),
      expectedDraftVersion: body.expectedDraftVersion,
      inputRevision: body.inputRevision,
      requestId: body.requestId,
    });
    kickOutboxDispatcher();
    return jsonResponse(
      result.body,
      {
        status: result.status,
        headers: {
          Location:
            (result.body as { statusUrl?: string }).statusUrl ??
            `/api/projects/${projectId}/hypothesis/generations`,
        },
      },
      requestId,
    );
  });
}
