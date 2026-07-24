import type { NextRequest } from "next/server";
import {
  authenticatedMutation,
  readJson,
  requireUuid,
} from "@/server/http/request";
import { jsonResponse, withApiErrors } from "@/server/http/response";
import { completeFilesStage } from "@/server/infrastructure/repositories/file-repository";

type Context = { params: Promise<{ projectId: string }> };

export async function POST(request: NextRequest, context: Context): Promise<Response> {
  return withApiErrors(async (requestId) => {
    const session = await authenticatedMutation(request);
    const { projectId: rawProjectId } = await context.params;
    const body = await readJson<{
      inspectionId?: unknown;
      templateVersion?: unknown;
      workbookVersion?: unknown;
      mappingSetVersion?: unknown;
      expectedProjectVersion?: unknown;
    }>(request);
    const result = await completeFilesStage({
      projectId: requireUuid(rawProjectId),
      userId: session.userId,
      idempotencyKey: request.headers.get("idempotency-key"),
      inspectionId: body.inspectionId,
      templateVersion: body.templateVersion,
      workbookVersion: body.workbookVersion,
      mappingSetVersion: body.mappingSetVersion,
      expectedProjectVersion: body.expectedProjectVersion,
    });
    return jsonResponse(result.body, { status: result.status }, requestId);
  });
}
