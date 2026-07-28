import type { NextRequest } from "next/server";
import { authenticatedRequest, requireUuid } from "@/server/http/request";
import { withApiErrors } from "@/server/http/response";
import { getEvidenceSourceArtifact } from "@/server/infrastructure/repositories/phase4-repository";

type Context = {
  params: Promise<{ projectId: string; evidenceId: string }>;
};

export async function GET(
  request: NextRequest,
  context: Context,
): Promise<Response> {
  return withApiErrors(async () => {
    const session = await authenticatedRequest(request);
    const { projectId: rawProjectId, evidenceId: rawEvidenceId } =
      await context.params;
    const result = await getEvidenceSourceArtifact({
      projectId: requireUuid(rawProjectId),
      userId: session.userId,
      evidenceId: requireUuid(rawEvidenceId),
    });
    const range = request.headers.get("range");
    let start = 0;
    let end = result.bytes.byteLength - 1;
    let status = 200;
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (match) {
        if (!match[1] && match[2]) {
          const suffixLength = Number(match[2]);
          start = Math.max(0, result.bytes.byteLength - suffixLength);
          end = result.bytes.byteLength - 1;
        } else {
          start = match[1] ? Number(match[1]) : 0;
          end = match[2]
            ? Math.min(Number(match[2]), result.bytes.byteLength - 1)
            : result.bytes.byteLength - 1;
        }
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
    const safeFilename = result.filename.replace(/[\\/:*?"<>|]/g, "_");
    return new Response(body, {
      status,
      headers: {
        "Content-Type": result.mediaType,
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(safeFilename)}`,
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
