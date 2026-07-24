import type { NextRequest } from "next/server";
import { authenticatedRequest } from "@/server/http/request";
import { searchCompanies } from "@/server/infrastructure/repositories/project-repository";
import { jsonResponse, withApiErrors } from "@/server/http/response";
import { ApiError } from "@/server/http/api-error";

export async function GET(request: NextRequest): Promise<Response> {
  return withApiErrors(async (requestId) => {
    await authenticatedRequest(request);
    const query = request.nextUrl.searchParams.get("q") ?? "";
    const limitValue = Number(request.nextUrl.searchParams.get("limit") ?? "10");
    if (!Number.isInteger(limitValue) || limitValue < 1 || limitValue > 20) {
      throw new ApiError(400, "INVALID_COMPANY_QUERY", "검색 개수가 올바르지 않습니다.");
    }
    return jsonResponse(
      await searchCompanies({ query, limit: limitValue }),
      {},
      requestId,
    );
  });
}
