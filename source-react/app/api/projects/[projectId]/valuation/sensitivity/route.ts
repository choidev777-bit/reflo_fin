import type { NextRequest } from "next/server";
import {
  authenticatedMutation,
  readJson,
  requireUuid,
} from "@/server/http/request";
import { jsonResponse, withApiErrors } from "@/server/http/response";
import { getSensitivity } from "@/server/infrastructure/repositories/valuation-repository";

type Context = { params: Promise<{ projectId: string }> };

export async function POST(request: NextRequest, context: Context) {
  return withApiErrors(async (requestId) => {
    const session = await authenticatedMutation(request);
    const { projectId } = await context.params;
    const body = await readJson<{
      workbookVersion: unknown;
      draftVersion: unknown;
    }>(request);
    return jsonResponse(
      await getSensitivity({
        projectId: requireUuid(projectId),
        userId: session.userId,
        ...body,
      }),
      {},
      requestId,
    );
  });
}
