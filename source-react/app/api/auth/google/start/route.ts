import { NextResponse, type NextRequest } from "next/server";
import {
  beginGoogleLogin,
  validateReturnTo,
} from "@/server/application/auth-service";
import { OAUTH_ATTEMPT_COOKIE } from "@/server/application/session-service";
import { withApiErrors } from "@/server/http/response";

export async function GET(request: NextRequest): Promise<Response> {
  return withApiErrors(async () => {
    const returnTo = validateReturnTo(request.nextUrl.searchParams.get("returnTo"));
    const intentValue = request.nextUrl.searchParams.get("intent");
    const intent =
      intentValue === "projects" || intentValue === "create-project"
        ? intentValue
        : null;
    const redirectUri = new URL("/api/auth/google/callback", request.nextUrl.origin).href;
    const attempt = await beginGoogleLogin({ redirectUri, returnTo, intent });
    const response = NextResponse.redirect(attempt.authorizationUrl);
    response.cookies.set(OAUTH_ATTEMPT_COOKIE, attempt.cookieValue, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/api/auth/google/callback",
      maxAge: 10 * 60,
    });
    return response;
  });
}
