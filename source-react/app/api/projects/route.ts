import type { NextRequest } from "next/server";
import {
  authenticatedMutation,
  authenticatedRequest,
  readJson,
} from "@/server/http/request";
import {
  createProject,
  listProjects,
} from "@/server/infrastructure/repositories/project-repository";
import { jsonResponse, withApiErrors } from "@/server/http/response";
import { ApiError } from "@/server/http/api-error";

export async function GET(request: NextRequest): Promise<Response> {
  return withApiErrors(async (requestId) => {
    const session = await authenticatedRequest(request);
    const query = request.nextUrl.searchParams.get("q") ?? "";
    const sortValue = request.nextUrl.searchParams.get("sort") ?? "updated_desc";
    if (!["updated_desc", "updated_asc", "company_asc"].includes(sortValue)) {
      throw new ApiError(400, "INVALID_PROJECT_QUERY", "정렬 기준이 올바르지 않습니다.");
    }
    const limit = Number(request.nextUrl.searchParams.get("limit") ?? "20");
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new ApiError(400, "INVALID_PROJECT_QUERY", "조회 개수가 올바르지 않습니다.");
    }
    const body = await listProjects({
      userId: session.userId,
      query,
      sort: sortValue as "updated_desc" | "updated_asc" | "company_asc",
      limit,
    });
    return jsonResponse(body, {}, requestId);
  });
}

export async function POST(request: NextRequest): Promise<Response> {
  return withApiErrors(async (requestId) => {
    const session = await authenticatedMutation(request);
    const body = await readJson<{ name?: unknown }>(request);
    if (typeof body.name !== "string") {
      throw new ApiError(400, "INVALID_PROJECT_NAME", "프로젝트 이름을 입력해주세요.");
    }
    const result = await createProject({
      userId: session.userId,
      name: body.name,
      idempotencyKey: request.headers.get("idempotency-key"),
    });
    return jsonResponse(result.body, { status: result.status }, requestId);
  });
}
