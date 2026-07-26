import type { NextRequest } from "next/server";
import {
  authenticatedMutation,
  readJson,
  requireUuid,
} from "@/server/http/request";
import { jsonResponse, withApiErrors } from "@/server/http/response";
import { decideWorkbookWriteProposal } from "@/server/infrastructure/repositories/workbook-application-repository";

type Context = {
  params: Promise<{ projectId: string; proposalId: string }>;
};

export async function POST(
  request: NextRequest,
  context: Context,
): Promise<Response> {
  return withApiErrors(async (requestId) => {
    const session = await authenticatedMutation(request);
    const { projectId, proposalId } = await context.params;
    const body = await readJson<{
      validatedValueSetVersionId?: unknown;
      expectedWorkbookVersion?: unknown;
      expectedProjectVersion?: unknown;
      sourceSnapshotId?: unknown;
      sourceFingerprint?: unknown;
      action?: unknown;
      proposedAfterValue?: unknown;
      reason?: unknown;
    }>(request);
    const result = await decideWorkbookWriteProposal({
      projectId: requireUuid(projectId),
      userId: session.userId,
      proposalId,
      idempotencyKey: request.headers.get("idempotency-key"),
      validatedValueSetVersionId:
        body.validatedValueSetVersionId,
      expectedWorkbookVersion: body.expectedWorkbookVersion,
      expectedProjectVersion: body.expectedProjectVersion,
      sourceSnapshotId: body.sourceSnapshotId,
      sourceFingerprint: body.sourceFingerprint,
      action: body.action,
      proposedAfterValue: body.proposedAfterValue,
      reason: body.reason,
    });
    return jsonResponse(result.body, { status: result.status }, requestId);
  });
}
