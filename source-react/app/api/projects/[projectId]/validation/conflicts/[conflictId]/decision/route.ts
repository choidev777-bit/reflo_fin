import type { NextRequest } from "next/server";
import {
  authenticatedMutation,
  readJson,
  requireUuid,
} from "@/server/http/request";
import { jsonResponse, withApiErrors } from "@/server/http/response";
import { decideValidationConflict } from "@/server/infrastructure/repositories/phase4-repository";

type Context = { params: Promise<{ projectId: string; conflictId: string }> };

export async function POST(
  request: NextRequest,
  context: Context,
): Promise<Response> {
  return withApiErrors(async (requestId) => {
    const session = await authenticatedMutation(request);
    const params = await context.params;
    const body = await readJson<{
      expectedValidationVersion?: unknown;
      selectedEvidenceId?: unknown;
      reason?: unknown;
    }>(request);
    const result = await decideValidationConflict({
      projectId: requireUuid(params.projectId),
      conflictId: requireUuid(params.conflictId),
      userId: session.userId,
      idempotencyKey: request.headers.get("idempotency-key"),
      expectedValidationVersion: body.expectedValidationVersion,
      selectedEvidenceId: body.selectedEvidenceId,
      reason: body.reason,
    });
    return jsonResponse(result.body, { status: result.status }, requestId);
  });
}
