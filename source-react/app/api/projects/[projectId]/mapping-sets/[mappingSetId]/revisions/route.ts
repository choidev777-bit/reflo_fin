import type { NextRequest } from "next/server";
import {
  authenticatedMutation,
  readJson,
  requireUuid,
} from "@/server/http/request";
import { jsonResponse, withApiErrors } from "@/server/http/response";
import { createMappingRevision } from "@/server/infrastructure/repositories/file-repository";

type Context = {
  params: Promise<{ projectId: string; mappingSetId: string }>;
};

export async function POST(
  request: NextRequest,
  context: Context,
): Promise<Response> {
  return withApiErrors(async (requestId) => {
    const session = await authenticatedMutation(request);
    const params = await context.params;
    const body = await readJson<{
      expectedVersion?: unknown;
      selections?: unknown;
    }>(request);
    const result = await createMappingRevision({
      projectId: requireUuid(params.projectId),
      mappingSetVersionId: requireUuid(params.mappingSetId),
      userId: session.userId,
      idempotencyKey: request.headers.get("idempotency-key"),
      expectedVersion: body.expectedVersion,
      selections: body.selections,
    });
    return jsonResponse(result.body, { status: result.status }, requestId);
  });
}
