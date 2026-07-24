import type { NextRequest } from "next/server";
import {
  authenticatedMutation,
  requireUuid,
} from "@/server/http/request";
import { jsonResponse, withApiErrors } from "@/server/http/response";
import { requestInspectionCancellation } from "@/server/infrastructure/repositories/file-repository";
import { kickOutboxDispatcher } from "@/server/infrastructure/temporal/client";

type Context = {
  params: Promise<{ projectId: string; inspectionId: string }>;
};

export async function POST(request: NextRequest, context: Context): Promise<Response> {
  return withApiErrors(async (requestId) => {
    const session = await authenticatedMutation(request);
    const params = await context.params;
    const body = await requestInspectionCancellation({
      projectId: requireUuid(params.projectId),
      inspectionId: requireUuid(params.inspectionId),
      userId: session.userId,
      idempotencyKey: request.headers.get("idempotency-key"),
    });
    kickOutboxDispatcher();
    return jsonResponse(body, { status: 202 }, requestId);
  });
}
