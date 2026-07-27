import type { NextRequest } from "next/server";
import {
  authenticatedMutation,
  readJson,
  requireUuid,
} from "@/server/http/request";
import { jsonResponse, withApiErrors } from "@/server/http/response";
import { createValidationWorkbookApplication } from "@/server/infrastructure/repositories/workbook-application-repository";
import { kickOutboxDispatcher } from "@/server/infrastructure/temporal/client";

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
    // 이 라우트는 start_workflow outbox 이벤트를 남긴다. dispatcher를 깨우지
    // 않으면 workbook application이 queued 상태로 남아 STEP 05 완료 폴링이
    // 끝나지 않는다.
    kickOutboxDispatcher();
    return jsonResponse(result.body, { status: result.status }, requestId);
  });
}
