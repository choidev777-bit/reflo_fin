import type { NextRequest } from "next/server";
import {
  authenticatedMutation,
  readJson,
  requireUuid,
} from "@/server/http/request";
import { jsonResponse, withApiErrors } from "@/server/http/response";
import { approveValuation } from "@/server/infrastructure/repositories/valuation-repository";

type Context = { params: Promise<{ projectId: string }> };

export async function POST(request: NextRequest, context: Context) {
  return withApiErrors(async (requestId) => {
    const session = await authenticatedMutation(request);
    const { projectId } = await context.params;
    const body = await readJson<{
      requestId: unknown;
      workbookVersion: unknown;
      draftVersion: unknown;
      calculationRunId: unknown;
      currentPriceSnapshotId: unknown;
    }>(request);
    const result = await approveValuation({
      projectId: requireUuid(projectId),
      userId: session.userId,
      idempotencyKey: request.headers.get("Idempotency-Key"),
      ...body,
    });
    return jsonResponse(result.body, { status: result.status }, requestId);
  });
}
