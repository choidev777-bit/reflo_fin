import * as oidc from "openid-client";
import {
  consumeLoginAttempt,
  createLoginAttempt,
  type IdentityProfile,
} from "../infrastructure/repositories/auth-repository";
import { randomToken, sha256 } from "../domain/hash";
import { uuidv7 } from "../domain/ids";
import { ApiError } from "../http/api-error";

type AttemptCookie = {
  attemptId: string;
  state: string;
  verifier: string;
  nonce: string;
};

let googleConfiguration: Promise<oidc.Configuration> | undefined;

function credentials(): { clientId: string; clientSecret: string } {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw new ApiError(
      503,
      "OAUTH_CONFIGURATION_MISSING",
      "Google 로그인을 사용할 수 없습니다.",
      { retryable: false },
    );
  }
  return { clientId, clientSecret };
}

async function configuration(): Promise<oidc.Configuration> {
  if (!googleConfiguration) {
    const { clientId, clientSecret } = credentials();
    googleConfiguration = oidc.discovery(
      new URL("https://accounts.google.com"),
      clientId,
      clientSecret,
    );
  }
  return googleConfiguration;
}

export function validateReturnTo(value: string | null): string {
  const returnTo = value?.trim() || "/";
  if (
    !returnTo.startsWith("/") ||
    returnTo.startsWith("//") ||
    returnTo.includes("\\") ||
    returnTo.includes("\u0000")
  ) {
    throw new ApiError(400, "INVALID_RETURN_TO", "돌아갈 화면이 올바르지 않습니다.");
  }

  const parsed = new URL(returnTo, "https://reflo.local");
  const allowed =
    parsed.origin === "https://reflo.local" &&
    (parsed.pathname === "/" ||
      parsed.pathname === "/projects" ||
      /^\/projects\/[0-9a-f-]{36}(?:\/process\/(?:setup|files|hypothesis|research-plan|validation|valuation|report-outline)|\/report)?$/.test(
        parsed.pathname,
      ));
  if (!allowed) {
    throw new ApiError(400, "INVALID_RETURN_TO", "돌아갈 화면이 올바르지 않습니다.");
  }
  return `${parsed.pathname}${parsed.search}`;
}

export async function beginGoogleLogin(input: {
  redirectUri: string;
  returnTo: string;
  intent: string | null;
}): Promise<{ authorizationUrl: URL; cookieValue: string }> {
  const config = await configuration();
  const verifier = oidc.randomPKCECodeVerifier();
  const challenge = await oidc.calculatePKCECodeChallenge(verifier);
  const state = oidc.randomState();
  const nonce = oidc.randomNonce();
  const attemptId = uuidv7();

  await createLoginAttempt({
    attemptId,
    stateHash: sha256(state),
    verifierHash: sha256(verifier),
    nonceHash: sha256(nonce),
    returnTo: input.returnTo,
    intent: input.intent,
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
  });

  const authorizationUrl = oidc.buildAuthorizationUrl(config, {
    redirect_uri: input.redirectUri,
    scope: "openid email profile",
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
    nonce,
    prompt: "select_account",
  });

  const cookie: AttemptCookie = { attemptId, state, verifier, nonce };
  return {
    authorizationUrl,
    cookieValue: Buffer.from(JSON.stringify(cookie)).toString("base64url"),
  };
}

export async function finishGoogleLogin(input: {
  callbackUrl: URL;
  redirectUri: string;
  cookieValue: string | undefined;
}): Promise<{ profile: IdentityProfile; returnTo: string; intent: string | null }> {
  if (!input.cookieValue) {
    throw new ApiError(400, "OAUTH_STATE_INVALID", "로그인 요청이 만료되었습니다.");
  }

  let attempt: AttemptCookie;
  try {
    attempt = JSON.parse(
      Buffer.from(input.cookieValue, "base64url").toString("utf8"),
    ) as AttemptCookie;
  } catch {
    throw new ApiError(400, "OAUTH_STATE_INVALID", "로그인 요청이 올바르지 않습니다.");
  }

  const stored = await consumeLoginAttempt(attempt.attemptId, {
    stateHash: sha256(attempt.state),
    verifierHash: sha256(attempt.verifier),
    nonceHash: sha256(attempt.nonce),
  }).catch(() => {
    throw new ApiError(400, "OAUTH_STATE_INVALID", "로그인 요청이 만료되었거나 이미 사용되었습니다.");
  });

  const config = await configuration();
  const tokens = await oidc.authorizationCodeGrant(config, input.callbackUrl, {
    pkceCodeVerifier: attempt.verifier,
    expectedState: attempt.state,
    expectedNonce: attempt.nonce,
    idTokenExpected: true,
  });
  const claims = tokens.claims();
  if (
    !claims?.iss ||
    !claims.sub ||
    typeof claims.email !== "string" ||
    claims.email_verified === false
  ) {
    throw new ApiError(400, "OAUTH_CALLBACK_FAILED", "Google 계정 정보를 확인할 수 없습니다.");
  }

  return {
    profile: {
      issuer: claims.iss,
      subject: claims.sub,
      email: claims.email,
      displayName:
        typeof claims.name === "string" && claims.name.trim()
          ? claims.name
          : claims.email,
      avatarUrl: typeof claims.picture === "string" ? claims.picture : null,
    },
    returnTo: stored.returnTo,
    intent: stored.intent,
  };
}

export function testIdentity(label: string): IdentityProfile {
  const safeLabel = label.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 32) || randomToken(6);
  return {
    issuer: "https://reflo.local/test",
    subject: safeLabel,
    email: `${safeLabel}@test.reflo.local`,
    displayName: safeLabel === "owner" ? "테스트 애널리스트" : `테스트 ${safeLabel}`,
    avatarUrl: null,
  };
}
