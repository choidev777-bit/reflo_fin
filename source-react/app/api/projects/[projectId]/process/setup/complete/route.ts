import type { NextRequest } from "next/server";
import {
  authenticatedMutation,
  readJson,
  requireUuid,
} from "@/server/http/request";
import {
  completeSetup,
  type SetupInput,
} from "@/server/infrastructure/repositories/project-repository";
import { jsonResponse, withApiErrors } from "@/server/http/response";
import { ApiError } from "@/server/http/api-error";

type Context = { params: Promise<{ projectId: string }> };

export async function POST(request: NextRequest, context: Context): Promise<Response> {
  return withApiErrors(async (requestId) => {
    const session = await authenticatedMutation(request);
    const { projectId: rawProjectId } = await context.params;
    const projectId = requireUuid(rawProjectId);
    const body = await readJson<{
      projectVersion?: unknown;
      setup?: SetupInput;
      confirmDownstreamInvalidation?: unknown;
    }>(request);
    if (!Number.isInteger(body.projectVersion) || !body.setup) {
      throw new ApiError(400, "INVALID_SETUP_FIELD", "프로젝트 설정 요청이 올바르지 않습니다.");
    }
    const result = await completeSetup({
      projectId,
      userId: session.userId,
      projectVersion: body.projectVersion as number,
      setup: body.setup,
      confirmDownstreamInvalidation: body.confirmDownstreamInvalidation === true,
      idempotencyKey: request.headers.get("idempotency-key"),
    });
    return jsonResponse(result.body, { status: result.status }, requestId);
  });
}
