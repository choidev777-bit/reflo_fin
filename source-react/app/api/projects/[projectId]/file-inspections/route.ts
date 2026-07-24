import type { NextRequest } from "next/server";
import {
  authenticatedMutation,
  readJson,
  requireUuid,
} from "@/server/http/request";
import { jsonResponse, withApiErrors } from "@/server/http/response";
import { createFileInspection } from "@/server/infrastructure/repositories/file-repository";
import { kickOutboxDispatcher } from "@/server/infrastructure/temporal/client";

type Context = { params: Promise<{ projectId: string }> };

export async function POST(request: NextRequest, context: Context): Promise<Response> {
  return withApiErrors(async (requestId) => {
    const session = await authenticatedMutation(request);
    const { projectId: rawProjectId } = await context.params;
    const projectId = requireUuid(rawProjectId);
    const body = await readJson<{
      pdfFileVersionId?: unknown;
      workbookFileVersionId?: unknown;
    }>(request);
    const result = await createFileInspection({
      projectId,
      userId: session.userId,
      idempotencyKey: request.headers.get("idempotency-key"),
      pdfFileVersionId: body.pdfFileVersionId,
      workbookFileVersionId: body.workbookFileVersionId,
    });
    kickOutboxDispatcher();
    return jsonResponse(result.body, { status: result.status }, requestId);
  });
}
