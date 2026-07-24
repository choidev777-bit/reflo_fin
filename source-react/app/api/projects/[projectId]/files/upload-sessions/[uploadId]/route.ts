import type { NextRequest } from "next/server";
import {
  authenticatedMutation,
  requireUuid,
} from "@/server/http/request";
import { withApiErrors } from "@/server/http/response";
import { cancelFileUpload } from "@/server/infrastructure/repositories/file-repository";

type Context = {
  params: Promise<{ projectId: string; uploadId: string }>;
};

export async function DELETE(
  request: NextRequest,
  context: Context,
): Promise<Response> {
  return withApiErrors(async () => {
    const session = await authenticatedMutation(request);
    const params = await context.params;
    await cancelFileUpload({
      projectId: requireUuid(params.projectId),
      uploadId: requireUuid(params.uploadId),
      userId: session.userId,
      idempotencyKey: request.headers.get("idempotency-key"),
    });
    return new Response(null, { status: 204 });
  });
}
