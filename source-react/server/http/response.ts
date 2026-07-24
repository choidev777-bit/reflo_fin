import { randomUUID } from "node:crypto";
import { ApiError } from "./api-error";

export function jsonResponse(
  body: unknown,
  init: ResponseInit = {},
  requestId: string = randomUUID(),
): Response {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  headers.set("X-Request-Id", requestId);
  return new Response(JSON.stringify(body), { ...init, headers });
}

export function errorResponse(error: unknown, requestId: string = randomUUID()): Response {
  if (error instanceof ApiError) {
    return jsonResponse(
      {
        error: {
          code: error.code,
          message: error.message,
          requestId,
          retryable: error.options.retryable ?? false,
          details: error.options.details ?? [],
          meta: error.options.meta ?? {},
        },
      },
      { status: error.status },
      requestId,
    );
  }

  return jsonResponse(
    {
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: "요청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요.",
        requestId,
        retryable: true,
        details: [],
        meta: {},
      },
    },
    { status: 500 },
    requestId,
  );
}

export async function withApiErrors(
  handler: (requestId: string) => Promise<Response>,
): Promise<Response> {
  const requestId = randomUUID();
  try {
    return await handler(requestId);
  } catch (error) {
    if (process.env.NODE_ENV !== "production" && !(error instanceof ApiError)) {
      console.error("REFLO request failed:", error instanceof Error ? error.message : "Unknown error");
    }
    return errorResponse(error, requestId);
  }
}
