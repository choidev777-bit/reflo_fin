import { timingSafeEqual } from "node:crypto";
import { ApiError } from "./api-error";

function workerToken(): string {
  return process.env.REFLO_WORKER_TOKEN?.trim() || "reflo-local-worker-token-change-me";
}

export function requireWorkerIdentity(request: Request): void {
  const authorization = request.headers.get("authorization") ?? "";
  const value = authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : "";
  const expected = workerToken();
  const actualBytes = Buffer.from(value);
  const expectedBytes = Buffer.from(expected);
  if (
    actualBytes.byteLength !== expectedBytes.byteLength ||
    !timingSafeEqual(actualBytes, expectedBytes)
  ) {
    throw new ApiError(401, "WORKER_AUTH_REQUIRED", "Worker 인증이 필요합니다.");
  }
}
