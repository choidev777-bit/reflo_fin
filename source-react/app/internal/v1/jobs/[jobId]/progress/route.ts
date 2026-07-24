import type { NextRequest } from "next/server";
import { requireWorkerIdentity } from "@/server/http/internal-auth";
import { readJson, requireUuid } from "@/server/http/request";
import { jsonResponse, withApiErrors } from "@/server/http/response";
import {
  recordWorkerProgress,
  type WorkerProgressCommand,
} from "@/server/infrastructure/repositories/file-repository";

type Context = { params: Promise<{ jobId: string }> };

export async function POST(request: NextRequest, context: Context): Promise<Response> {
  return withApiErrors(async (requestId) => {
    requireWorkerIdentity(request);
    const { jobId: rawJobId } = await context.params;
    const command = await readJson<WorkerProgressCommand>(request);
    await recordWorkerProgress(requireUuid(rawJobId), command);
    return jsonResponse({ accepted: true }, { status: 202 }, requestId);
  });
}
