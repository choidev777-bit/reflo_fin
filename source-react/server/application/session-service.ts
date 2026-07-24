import { timingSafeEqual } from "node:crypto";
import {
  createSessionRecord,
  findActiveSession,
  revokeSession,
  type IdentityProfile,
  type SessionRecord,
} from "../infrastructure/repositories/auth-repository";
import { randomToken, sha256 } from "../domain/hash";
import { ApiError } from "../http/api-error";

export const SESSION_COOKIE = "reflo_session";
export const OAUTH_ATTEMPT_COOKIE = "reflo_oauth_attempt";

export type AuthenticatedSession = SessionRecord & {
  csrfToken: string;
};

export function deriveCsrfToken(sessionToken: string): string {
  return sha256(`${sessionToken}:reflo-csrf-v1`);
}

export async function issueSession(profile: IdentityProfile): Promise<{
  token: string;
  expiresAt: Date;
}> {
  const token = randomToken(32);
  const csrfToken = deriveCsrfToken(token);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await createSessionRecord({
    profile,
    tokenHash: sha256(token),
    csrfSecretHash: sha256(csrfToken),
    expiresAt,
  });
  return { token, expiresAt };
}

export async function readSession(token: string | undefined): Promise<AuthenticatedSession | null> {
  if (!token) return null;
  const record = await findActiveSession(sha256(token));
  if (!record) return null;

  const csrfToken = deriveCsrfToken(token);
  if (!safeEqual(sha256(csrfToken), record.csrfSecretHash)) return null;
  return { ...record, csrfToken };
}

export async function requireSession(token: string | undefined): Promise<AuthenticatedSession> {
  const session = await readSession(token);
  if (!session) {
    throw new ApiError(401, "AUTH_REQUIRED", "로그인이 필요합니다.");
  }
  return session;
}

export async function endSession(token: string | undefined): Promise<void> {
  if (!token) return;
  await revokeSession(sha256(token));
}

export function assertCsrf(request: Request, session: AuthenticatedSession): void {
  const requestUrl = new URL(request.url);
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  const csrfToken = request.headers.get("x-csrf-token") ?? "";

  const originValid = !origin || origin === requestUrl.origin;
  const fetchSiteValid = !fetchSite || fetchSite === "same-origin" || fetchSite === "none";
  const tokenValid = safeEqual(csrfToken, session.csrfToken);

  if (!originValid || !fetchSiteValid || !tokenValid) {
    throw new ApiError(403, "CSRF_FAILED", "요청을 확인할 수 없습니다. 화면을 새로고침해주세요.");
  }
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}
