import { NextResponse, type NextRequest } from "next/server";
import { testIdentity, validateReturnTo } from "@/server/application/auth-service";
import { issueSession, SESSION_COOKIE } from "@/server/application/session-service";
import { ApiError } from "@/server/http/api-error";
import { withApiErrors } from "@/server/http/response";

export async function GET(request: NextRequest): Promise<Response> {
  return withApiErrors(async () => {
    if (
      process.env.NODE_ENV === "production" ||
      process.env.REFLO_TEST_AUTH_ENABLED !== "1"
    ) {
      throw new ApiError(404, "NOT_FOUND", "요청한 경로를 찾을 수 없습니다.");
    }
    const label = request.nextUrl.searchParams.get("user") ?? "owner";
    const returnTo = validateReturnTo(request.nextUrl.searchParams.get("returnTo"));
    const session = await issueSession(testIdentity(label));
    const response = NextResponse.redirect(new URL(returnTo, request.nextUrl.origin));
    response.cookies.set(SESSION_COOKIE, session.token, {
      httpOnly: true,
      secure: false,
      sameSite: "lax",
      path: "/",
      expires: session.expiresAt,
    });
    return response;
  });
}
