import { NextResponse, type NextRequest } from "next/server";
import {
  assertCsrf,
  endSession,
  requireSession,
  SESSION_COOKIE,
} from "@/server/application/session-service";
import { withApiErrors } from "@/server/http/response";

export async function POST(request: NextRequest): Promise<Response> {
  return withApiErrors(async (requestId) => {
    const token = request.cookies.get(SESSION_COOKIE)?.value;
    const session = await requireSession(token);
    assertCsrf(request, session);
    await endSession(token);
    const response = new NextResponse(null, {
      status: 204,
      headers: { "X-Request-Id": requestId },
    });
    response.cookies.delete(SESSION_COOKIE);
    return response;
  });
}
