import type { NextRequest } from "next/server";
import { authenticatedRequest, requireUuid } from "@/server/http/request";
import { withApiErrors } from "@/server/http/response";
import { getReportArtifactBytes } from "@/server/infrastructure/repositories/report-repository";

type Context = { params: Promise<{ projectId: string; artifactId: string }> };

async function download(request: NextRequest, context: Context) {
  return withApiErrors(async () => {
    const session = await authenticatedRequest(request);
    const { projectId, artifactId } = await context.params;
    const result = await getReportArtifactBytes({
      projectId: requireUuid(projectId),
      userId: session.userId,
      artifactId,
      exportId: request.nextUrl.searchParams.get("exportId"),
      type: request.nextUrl.searchParams.get("type"),
    });
    const body = result.bytes.buffer.slice(
      result.bytes.byteOffset,
      result.bytes.byteOffset + result.bytes.byteLength,
    ) as ArrayBuffer;
    const safeFilename = result.filename.replace(/[\\/:*?"<>|]/g, "_");
    return new Response(body, {
      headers: {
        "Content-Type": result.mediaType,
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(safeFilename)}`,
        "Content-Length": String(result.bytes.byteLength),
        "Cache-Control": "private, no-store",
      },
    });
  });
}

export const GET = download;
export const POST = download;
