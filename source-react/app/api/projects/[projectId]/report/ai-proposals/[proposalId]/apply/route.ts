import type { NextRequest } from "next/server";
import {
  authenticatedMutation,
  readJson,
  requireUuid,
} from "@/server/http/request";
import { jsonResponse, withApiErrors } from "@/server/http/response";
import { applyReportAiProposal } from "@/server/infrastructure/repositories/report-repository";

type Context = { params: Promise<{ projectId: string; proposalId: string }> };

export async function POST(request: NextRequest, context: Context) {
  return withApiErrors(async (requestId) => {
    const session = await authenticatedMutation(request);
    const { projectId, proposalId } = await context.params;
    const body = await readJson<{
      expectedVersion: unknown;
      editSessionId: unknown;
      clientMutationId: unknown;
    }>(request);
    return jsonResponse(
      await applyReportAiProposal({
        ...body,
        projectId: requireUuid(projectId),
        userId: session.userId,
        proposalId,
        leaseToken: request.headers.get("X-Edit-Lease"),
      }),
      {},
      requestId,
    );
  });
}
