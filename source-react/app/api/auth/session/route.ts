import type { NextRequest } from "next/server";
import { readSession, SESSION_COOKIE } from "@/server/application/session-service";
import { jsonResponse, withApiErrors } from "@/server/http/response";

export async function GET(request: NextRequest): Promise<Response> {
  return withApiErrors(async (requestId) => {
    const session = await readSession(request.cookies.get(SESSION_COOKIE)?.value);
    if (!session) {
      return jsonResponse(
        { authenticated: false, user: null, csrfToken: null },
        {},
        requestId,
      );
    }

    return jsonResponse(
      {
        authenticated: true,
        user: {
          userId: session.userId,
          displayName: session.displayName,
          email: session.email,
          avatarUrl: session.avatarUrl,
        },
        csrfToken: session.csrfToken,
      },
      {},
      requestId,
    );
  });
}
