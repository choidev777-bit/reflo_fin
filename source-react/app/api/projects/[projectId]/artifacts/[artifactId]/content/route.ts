import type { NextRequest } from "next/server";
import { authenticatedRequest, requireUuid } from "@/server/http/request";
import { withApiErrors } from "@/server/http/response";
import { getReportArtifactBytes } from "@/server/infrastructure/repositories/report-repository";

type Context = { params: Promise<{ projectId: string; artifactId: string }> };

export async function GET(request: NextRequest, context: Context) {
  return withApiErrors(async () => {
    const session = await authenticatedRequest(request);
    const { projectId, artifactId } = await context.params;
    const result = await getReportArtifactBytes({
      projectId: requireUuid(projectId),
      userId: session.userId,
      artifactId,
    });
    const range = request.headers.get("range");
    let start = 0;
    let end = result.bytes.byteLength - 1;
    let status = 200;
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (match) {
        start = match[1] ? Number(match[1]) : 0;
        end = match[2]
          ? Math.min(Number(match[2]), result.bytes.byteLength - 1)
          : result.bytes.byteLength - 1;
        if (
          !Number.isInteger(start) ||
          !Number.isInteger(end) ||
          start < 0 ||
          end < start ||
          start >= result.bytes.byteLength
        ) {
          return new Response(null, {
            status: 416,
            headers: {
              "Content-Range": `bytes */${result.bytes.byteLength}`,
            },
          });
        }
        status = 206;
      }
    }
    const bytes = result.bytes.subarray(start, end + 1);
    const body = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
    return new Response(body, {
      status,
      headers: {
        "Content-Type": result.mediaType,
        "Content-Length": String(bytes.byteLength),
        "Accept-Ranges": "bytes",
        ...(status === 206
          ? {
              "Content-Range": `bytes ${start}-${end}/${result.bytes.byteLength}`,
            }
          : {}),
        "Cache-Control": "private, no-store",
      },
    });
  });
}
