import { NextResponse, type NextRequest } from "next/server";
import { finishGoogleLogin } from "@/server/application/auth-service";
import {
  issueSession,
  OAUTH_ATTEMPT_COOKIE,
  SESSION_COOKIE,
} from "@/server/application/session-service";

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const redirectUri = new URL("/api/auth/google/callback", request.nextUrl.origin).href;
    const result = await finishGoogleLogin({
      callbackUrl: request.nextUrl,
      redirectUri,
      cookieValue: request.cookies.get(OAUTH_ATTEMPT_COOKIE)?.value,
    });
    const session = await issueSession(result.profile);
    const destination = new URL(result.returnTo, request.nextUrl.origin);
    if (result.intent === "create-project") {
      destination.searchParams.set("createProject", "1");
    }
    const response = NextResponse.redirect(destination);
    response.cookies.delete(OAUTH_ATTEMPT_COOKIE);
    response.cookies.set(SESSION_COOKIE, session.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      expires: session.expiresAt,
    });
    return response;
  } catch {
    const response = NextResponse.redirect(
      new URL("/?authError=OAUTH_CALLBACK_FAILED", request.nextUrl.origin),
    );
    response.cookies.delete(OAUTH_ATTEMPT_COOKIE);
    return response;
  }
}
