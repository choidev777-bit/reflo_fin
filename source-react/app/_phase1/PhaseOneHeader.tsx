"use client";

import { useRouter } from "next/navigation";
import { apiJson, googleLoginUrl } from "./api";
import { Brand } from "./Brand";
import type { SessionState } from "./types";

export function PhaseOneHeader({
  active,
  session,
}: {
  active: "home" | "projects";
  session: SessionState;
}) {
  const router = useRouter();

  const logout = async () => {
    if (session.status !== "authenticated") return;
    await apiJson<void>("/api/auth/logout", {
      method: "POST",
      headers: { "X-CSRF-Token": session.csrfToken },
    });
    router.push("/");
    router.refresh();
  };

  return (
    <header className="app-header">
      <button className="logo-button" onClick={() => router.push("/")} aria-label="홈으로 이동">
        <Brand compact />
      </button>
      <nav className="top-nav" aria-label="주요 화면">
        <button className={active === "home" ? "active" : ""} onClick={() => router.push("/")}>
          Home
        </button>
        <button
          className={active === "projects" ? "active" : ""}
          onClick={() => {
            if (session.status === "authenticated") router.push("/projects");
            else window.location.href = googleLoginUrl("/projects", "projects");
          }}
        >
          Project
        </button>
      </nav>
      <div className="header-actions phase1-header-actions">
        {session.status === "authenticated" ? (
          <>
            <span className="phase1-user-name">{session.user.displayName}</span>
            <button className="avatar" aria-label="로그아웃" onClick={() => void logout()}>
              {session.user.displayName.slice(0, 2).toUpperCase()}
            </button>
          </>
        ) : session.status === "loading" ? (
          <span className="phase1-session-loading" aria-label="로그인 상태 확인 중" />
        ) : (
          <button
            className="phase1-login-button"
            onClick={() => {
              window.location.href = googleLoginUrl(window.location.pathname);
            }}
          >
            Google로 로그인
          </button>
        )}
      </div>
    </header>
  );
}
