import type { NextRequest } from "next/server";
import {
  authenticatedMutation,
  readJson,
  requireUuid,
} from "@/server/http/request";
import { jsonResponse, withApiErrors } from "@/server/http/response";
import { approveReportOutline } from "@/server/infrastructure/repositories/report-repository";
import { kickOutboxDispatcher } from "@/server/infrastructure/temporal/client";

type Context = { params: Promise<{ projectId: string }> };

export async function POST(request: NextRequest, context: Context) {
  return withApiErrors(async (requestId) => {
    const session = await authenticatedMutation(request);
    const { projectId } = await context.params;
    const body = await readJson<{
      expectedOutlineVersion: unknown;
      expectedInputVersions: unknown;
    }>(request);
    const result = await approveReportOutline({
      projectId: requireUuid(projectId),
      userId: session.userId,
      idempotencyKey: request.headers.get("Idempotency-Key"),
      ...body,
    });
    kickOutboxDispatcher();
    return jsonResponse(result.body, { status: result.status }, requestId);
  });
}
