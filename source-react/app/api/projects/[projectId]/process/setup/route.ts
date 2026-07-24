import type { NextRequest } from "next/server";
import {
  authenticatedMutation,
  authenticatedRequest,
  readJson,
  requireUuid,
} from "@/server/http/request";
import {
  getSetup,
  saveSetup,
  type SetupInput,
} from "@/server/infrastructure/repositories/project-repository";
import { jsonResponse, withApiErrors } from "@/server/http/response";
import { ApiError } from "@/server/http/api-error";

type Context = { params: Promise<{ projectId: string }> };

export async function GET(request: NextRequest, context: Context): Promise<Response> {
  return withApiErrors(async (requestId) => {
    const session = await authenticatedRequest(request);
    const { projectId: rawProjectId } = await context.params;
    const projectId = requireUuid(rawProjectId);
    return jsonResponse(await getSetup(projectId, session.userId), {}, requestId);
  });
}

export async function PATCH(request: NextRequest, context: Context): Promise<Response> {
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
    const result = await saveSetup({
      projectId,
      userId: session.userId,
      projectVersion: body.projectVersion as number,
      setup: body.setup,
      confirmDownstreamInvalidation: body.confirmDownstreamInvalidation === true,
    });
    return jsonResponse(result, {}, requestId);
  });
}
