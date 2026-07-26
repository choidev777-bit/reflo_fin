import type { NextRequest } from "next/server";
import { requireWorkerIdentity } from "@/server/http/internal-auth";
import { readJson, requireUuid } from "@/server/http/request";
import { jsonResponse, withApiErrors } from "@/server/http/response";
import {
  commitFileScanResult,
  commitInspectionResult,
  type InspectionResultPayload,
} from "@/server/infrastructure/repositories/file-repository";
import { ApiError } from "@/server/http/api-error";
import {
  commitHypothesisGenerationResult,
  type HypothesisWorkerResult,
} from "@/server/infrastructure/repositories/hypothesis-repository";
import {
  commitResearchValidationResult,
  type PhaseFourWorkerPayload,
} from "@/server/infrastructure/repositories/phase4-repository";
import {
  parseWorkerResultEnvelope,
  type WorkerResultCommitMetadata,
} from "@/server/domain/worker-result-contract";
import { contentHash } from "@/server/domain/hash";
import { LineageInvariantError } from "@/server/infrastructure/services/source-snapshot-service";

type Context = { params: Promise<{ jobId: string }> };

export async function POST(request: NextRequest, context: Context): Promise<Response> {
  return withApiErrors(async (requestId) => {
    requireWorkerIdentity(request);
    const { jobId: rawJobId } = await context.params;
    const jobId = requireUuid(rawJobId);
    let body;
    try {
      body = parseWorkerResultEnvelope(await readJson<unknown>(request));
    } catch {
      throw new ApiError(
        400,
        "RESULT_SCHEMA_INVALID",
        "worker 결과 envelope 형식이 올바르지 않습니다.",
      );
    }
    const payloadHash = contentHash(body.payload);
    if (body.results.length !== 1 || body.results[0].hash !== payloadHash) {
      throw new ApiError(
        409,
        "WORKER_RESULT_HASH_MISMATCH",
        "작업 결과 hash가 payload와 일치하지 않습니다.",
      );
    }
    const metadata: WorkerResultCommitMetadata = {
      attempt: body.attempt,
      sequence: body.sequence,
      inputVersionIds: body.inputVersionIds,
      resultHash: payloadHash,
    };
    let outcome;
    try {
      if (body.resultType === "file_scan") {
        outcome = await commitFileScanResult(
          jobId,
          body.payload as Parameters<typeof commitFileScanResult>[1],
          metadata,
        );
      } else if (body.resultType === "file_inspection") {
        outcome = await commitInspectionResult(
          jobId,
          body.payload as InspectionResultPayload,
          metadata,
        );
      } else if (body.resultType === "hypothesis_questions") {
        outcome = await commitHypothesisGenerationResult(
          jobId,
          body.payload as HypothesisWorkerResult,
          metadata,
        );
      } else if (body.resultType === "research_validation") {
        outcome = await commitResearchValidationResult(
          jobId,
          body.payload as PhaseFourWorkerPayload,
          metadata,
        );
      } else {
        throw new ApiError(
          409,
          "RESULT_HANDLER_UNAVAILABLE",
          "이 작업 유형의 결과 처리기가 아직 연결되지 않았습니다.",
        );
      }
    } catch (error) {
      if (error instanceof LineageInvariantError) {
        throw new ApiError(
          409,
          error.code,
          "작업 입력 계보와 결과 버전을 확인해주세요.",
        );
      }
      throw error;
    }
    return jsonResponse(
      {
        jobId,
        attempt: body.attempt,
        applied: outcome.applied,
      },
      undefined,
      requestId,
    );
  });
}
