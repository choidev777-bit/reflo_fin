import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { readSession, SESSION_COOKIE } from "@/server/application/session-service";
import { getProjectAccess } from "@/server/infrastructure/repositories/project-repository";
import { ApiError } from "@/server/http/api-error";

export async function requireProjectPageAccess(
  projectId: string,
  requestedRoute: string,
): Promise<void> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(projectId)) {
    notFound();
  }

  const cookieStore = await cookies();
  const session = await readSession(cookieStore.get(SESSION_COOKIE)?.value);
  if (!session) {
    redirect(
      `/api/auth/google/start?returnTo=${encodeURIComponent(requestedRoute)}`,
    );
  }

  try {
    const access = await getProjectAccess({ projectId, userId: session.userId });
    if (!access.allowedRoutes.includes(requestedRoute)) {
      redirect(access.canonicalRoute);
    }
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }
}
