"use client";

import { useCallback, useEffect, useState } from "react";
import { apiJson } from "./api";
import type { SessionState, SessionUser } from "./types";

type SessionResponse = {
  authenticated: boolean;
  user: SessionUser | null;
  csrfToken: string | null;
};

export function useSession() {
  const [session, setSession] = useState<SessionState>({
    status: "loading",
    user: null,
    csrfToken: null,
  });

  const refresh = useCallback(async () => {
    try {
      const response = await apiJson<SessionResponse>("/api/auth/session");
      if (response.authenticated && response.user && response.csrfToken) {
        setSession({
          status: "authenticated",
          user: response.user,
          csrfToken: response.csrfToken,
        });
      } else {
        setSession({ status: "anonymous", user: null, csrfToken: null });
      }
    } catch {
      setSession({ status: "error", user: null, csrfToken: null });
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  return { session, refresh };
}
