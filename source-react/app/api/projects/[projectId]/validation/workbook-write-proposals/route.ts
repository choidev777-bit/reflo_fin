import type { NextRequest } from "next/server";
import {
  authenticatedMutation,
  authenticatedRequest,
  requireUuid,
} from "@/server/http/request";
import { jsonResponse, withApiErrors } from "@/server/http/response";
import {
  getWorkbookWriteProposals,
  prepareWorkbookWriteProposals,
} from "@/server/infrastructure/repositories/workbook-application-repository";

type Context = { params: Promise<{ projectId: string }> };

export async function GET(
  request: NextRequest,
  context: Context,
): Promise<Response> {
  return withApiErrors(async (requestId) => {
    const session = await authenticatedRequest(request);
    const { projectId } = await context.params;
    return jsonResponse(
      await getWorkbookWriteProposals({
        projectId: requireUuid(projectId),
        userId: session.userId,
      }),
      {},
      requestId,
    );
  });
}

export async function POST(
  request: NextRequest,
  context: Context,
): Promise<Response> {
  return withApiErrors(async (requestId) => {
    const session = await authenticatedMutation(request);
    const { projectId } = await context.params;
    return jsonResponse(
      await prepareWorkbookWriteProposals({
        projectId: requireUuid(projectId),
        userId: session.userId,
      }),
      { status: 201 },
      requestId,
    );
  });
}
