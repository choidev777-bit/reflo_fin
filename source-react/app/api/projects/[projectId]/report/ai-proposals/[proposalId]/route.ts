import type { NextRequest } from "next/server";
import { authenticatedRequest, requireUuid } from "@/server/http/request";
import { jsonResponse, withApiErrors } from "@/server/http/response";
import { getReportAiProposal } from "@/server/infrastructure/repositories/report-repository";

type Context = { params: Promise<{ projectId: string; proposalId: string }> };

export async function GET(request: NextRequest, context: Context) {
  return withApiErrors(async (requestId) => {
    const session = await authenticatedRequest(request);
    const { projectId, proposalId } = await context.params;
    return jsonResponse(
      await getReportAiProposal(
        requireUuid(projectId),
        session.userId,
        proposalId,
      ),
      {},
      requestId,
    );
  });
}
