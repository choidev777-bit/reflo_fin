import type { NextRequest } from "next/server";
import {
  authenticatedRequest,
  requireUuid,
} from "@/server/http/request";
import { jsonResponse, withApiErrors } from "@/server/http/response";
import { getEvidenceViewer } from "@/server/infrastructure/repositories/phase4-repository";

type Context = { params: Promise<{ projectId: string; evidenceId: string }> };

export async function GET(
  request: NextRequest,
  context: Context,
): Promise<Response> {
  return withApiErrors(async (requestId) => {
    const session = await authenticatedRequest(request);
    const params = await context.params;
    return jsonResponse(
      await getEvidenceViewer({
        projectId: requireUuid(params.projectId),
        evidenceId: requireUuid(params.evidenceId),
        userId: session.userId,
      }),
      {},
      requestId,
    );
  });
}
