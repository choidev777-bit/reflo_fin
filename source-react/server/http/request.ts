import type { NextRequest } from "next/server";
import {
  assertCsrf,
  requireSession,
  SESSION_COOKIE,
  type AuthenticatedSession,
} from "../application/session-service";
import { ApiError } from "./api-error";

export async function authenticatedRequest(
  request: NextRequest,
): Promise<AuthenticatedSession> {
  return requireSession(request.cookies.get(SESSION_COOKIE)?.value);
}

export async function authenticatedMutation(
  request: NextRequest,
): Promise<AuthenticatedSession> {
  const session = await authenticatedRequest(request);
  assertCsrf(request, session);
  return session;
}

export async function readJson<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new ApiError(400, "INVALID_JSON", "요청 형식이 올바르지 않습니다.");
  }
}

export function requireUuid(value: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new ApiError(404, "PROJECT_NOT_FOUND", "프로젝트를 찾을 수 없습니다.");
  }
  return value;
}
