import type { NextRequest } from "next/server";
import {
  authenticatedMutation,
  readJson,
  requireUuid,
} from "@/server/http/request";
import { jsonResponse, withApiErrors } from "@/server/http/response";
import { createValidationWorkbookApplication } from "@/server/infrastructure/repositories/workbook-application-repository";

type Context = { params: Promise<{ projectId: string }> };

export async function POST(
  request: NextRequest,
  context: Context,
): Promise<Response> {
  return withApiErrors(async (requestId) => {
    const session = await authenticatedMutation(request);
    const { projectId } = await context.params;
    const body = await readJson<{
      validatedValueSetVersionId?: unknown;
      expectedWorkbookVersion?: unknown;
      expectedProjectVersion?: unknown;
      sourceSnapshotId?: unknown;
      sourceFingerprint?: unknown;
    }>(request);
    const result = await createValidationWorkbookApplication({
      projectId: requireUuid(projectId),
      userId: session.userId,
      idempotencyKey: request.headers.get("idempotency-key"),
      validatedValueSetVersionId: body.validatedValueSetVersionId,
      expectedWorkbookVersion: body.expectedWorkbookVersion,
      expectedProjectVersion: body.expectedProjectVersion,
      sourceSnapshotId: body.sourceSnapshotId,
      sourceFingerprint: body.sourceFingerprint,
    });
    return jsonResponse(result.body, { status: result.status }, requestId);
  });
}
