import type { NextRequest } from "next/server";
import { authenticatedMutation, readJson, requireUuid } from "@/server/http/request";
import { jsonResponse, withApiErrors } from "@/server/http/response";
import { addResearchMaterial } from "@/server/infrastructure/repositories/phase4-repository";

type Context = { params: Promise<{ projectId: string }> };

export async function POST(
  request: NextRequest,
  context: Context,
): Promise<Response> {
  return withApiErrors(async (requestId) => {
    const session = await authenticatedMutation(request);
    const { projectId: rawProjectId } = await context.params;
    const projectId = requireUuid(rawProjectId);
    const contentType = request.headers.get("content-type") ?? "";
    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      const file = form.get("file");
      return jsonResponse(
        await addResearchMaterial({
          projectId,
          userId: session.userId,
          expectedVersion: form.get("expectedVersion"),
          sourceType: form.get("sourceType"),
          title: form.get("title"),
          publishedAt: form.get("publishedAt"),
          file:
            file instanceof File
              ? {
                  name: file.name,
                  mediaType: file.type,
                  bytes: Buffer.from(await file.arrayBuffer()),
                }
              : undefined,
        }),
        { status: 201 },
        requestId,
      );
    }
    const body = await readJson<{
      expectedVersion?: unknown;
      sourceType?: unknown;
      title?: unknown;
      publishedAt?: unknown;
      url?: unknown;
    }>(request);
    return jsonResponse(
      await addResearchMaterial({
        projectId,
        userId: session.userId,
        expectedVersion: body.expectedVersion,
        sourceType: body.sourceType,
        title: body.title,
        publishedAt: body.publishedAt,
        url: body.url,
      }),
      { status: 201 },
      requestId,
    );
  });
}
