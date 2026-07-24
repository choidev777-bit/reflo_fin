import type { NextRequest } from "next/server";
import { requireWorkerIdentity } from "@/server/http/internal-auth";
import { jsonResponse, withApiErrors } from "@/server/http/response";
import { listReconciliationCandidates } from "@/server/infrastructure/repositories/file-repository";
import { ApiError } from "@/server/http/api-error";

export async function GET(request: NextRequest): Promise<Response> {
  return withApiErrors(async (requestId) => {
    requireWorkerIdentity(request);
    const olderThan = new Date(request.nextUrl.searchParams.get("olderThan") ?? "");
    if (Number.isNaN(olderThan.getTime())) {
      throw new ApiError(
        400,
        "RECONCILIATION_QUERY_INVALID",
        "기준 시각이 올바르지 않습니다.",
      );
    }
    return jsonResponse(
      await listReconciliationCandidates(olderThan),
      {},
      requestId,
    );
  });
}
