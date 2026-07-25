import type { NextRequest } from "next/server";
import { authenticatedRequest, requireUuid } from "@/server/http/request";
import { withApiErrors } from "@/server/http/response";
import { getValuationWorkbookBytes } from "@/server/infrastructure/repositories/valuation-repository";

type Context = { params: Promise<{ projectId: string }> };

export async function GET(request: NextRequest, context: Context) {
  return withApiErrors(async () => {
    const session = await authenticatedRequest(request);
    const { projectId } = await context.params;
    const result = await getValuationWorkbookBytes(
      requireUuid(projectId),
      session.userId,
      request.nextUrl.searchParams.get("approvalVersion"),
    );
    const filename = result.filename.replace(/[\\/:*?"<>|]/g, "_");
    const body = result.bytes.buffer.slice(
      result.bytes.byteOffset,
      result.bytes.byteOffset + result.bytes.byteLength,
    ) as ArrayBuffer;
    return new Response(body, {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
        "X-Workbook-Version": String(result.workbookVersion),
        ...(result.approvalVersion
          ? {
              "X-Valuation-Approval-Version": String(
                result.approvalVersion,
              ),
            }
          : {}),
        "Cache-Control": "private, no-store",
      },
    });
  });
}
