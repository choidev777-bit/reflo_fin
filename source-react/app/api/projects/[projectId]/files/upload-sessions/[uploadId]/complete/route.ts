import type { NextRequest } from "next/server";
import {
  authenticatedMutation,
  readJson,
  requireUuid,
} from "@/server/http/request";
import { jsonResponse, withApiErrors } from "@/server/http/response";
import { completeFileUpload } from "@/server/infrastructure/repositories/file-repository";
import { kickOutboxDispatcher } from "@/server/infrastructure/temporal/client";

type Context = {
  params: Promise<{ projectId: string; uploadId: string }>;
};

export async function POST(
  request: NextRequest,
  context: Context,
): Promise<Response> {
  return withApiErrors(async (requestId) => {
    const session = await authenticatedMutation(request);
    const params = await context.params;
    const body = await readJson<{ checksumSha256?: unknown }>(request);
    const result = await completeFileUpload({
      projectId: requireUuid(params.projectId),
      uploadId: requireUuid(params.uploadId),
      userId: session.userId,
      idempotencyKey: request.headers.get("idempotency-key"),
      checksumSha256: body.checksumSha256,
    });
    kickOutboxDispatcher();
    return jsonResponse(result.body, { status: result.status }, requestId);
  });
}
