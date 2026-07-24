import type { NextRequest } from "next/server";
import {
  authenticatedMutation,
  readJson,
  requireUuid,
} from "@/server/http/request";
import { jsonResponse, withApiErrors } from "@/server/http/response";
import { createFileUploadSession } from "@/server/infrastructure/repositories/file-repository";

type Context = { params: Promise<{ projectId: string }> };

export async function POST(request: NextRequest, context: Context): Promise<Response> {
  return withApiErrors(async (requestId) => {
    const session = await authenticatedMutation(request);
    const { projectId: rawProjectId } = await context.params;
    const projectId = requireUuid(rawProjectId);
    const body = await readJson<{
      role?: unknown;
      filename?: unknown;
      byteSize?: unknown;
      mediaType?: unknown;
      checksumSha256?: unknown;
    }>(request);
    const result = await createFileUploadSession({
      projectId,
      userId: session.userId,
      idempotencyKey: request.headers.get("idempotency-key"),
      request: body,
    });
    return jsonResponse(result.body, { status: result.status }, requestId);
  });
}
