"use client";

import { ChevronDown, LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
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
  const userMenuRef = useRef<HTMLDivElement>(null);
  const userMenuButtonRef = useRef<HTMLButtonElement>(null);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [logoutPending, setLogoutPending] = useState(false);
  const [logoutError, setLogoutError] = useState(false);

  useEffect(() => {
    if (!userMenuOpen) return;

    const closeOnOutsidePress = (event: PointerEvent) => {
      if (!userMenuRef.current?.contains(event.target as Node)) {
        setUserMenuOpen(false);
        setLogoutError(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setUserMenuOpen(false);
      setLogoutError(false);
      userMenuButtonRef.current?.focus();
    };

    document.addEventListener("pointerdown", closeOnOutsidePress);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePress);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [userMenuOpen]);

  const logout = async () => {
    if (session.status !== "authenticated" || logoutPending) return;
    setLogoutPending(true);
    setLogoutError(false);
    try {
      await apiJson<void>("/api/auth/logout", {
        method: "POST",
        headers: { "X-CSRF-Token": session.csrfToken },
      });
      setUserMenuOpen(false);
      window.location.assign("/");
    } catch {
      setLogoutError(true);
      setLogoutPending(false);
    }
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
          <div className="phase1-user-menu" ref={userMenuRef}>
            <button
              ref={userMenuButtonRef}
              className="phase1-user-menu-trigger"
              type="button"
              aria-label={`${session.user.displayName} 사용자 메뉴`}
              aria-haspopup="menu"
              aria-expanded={userMenuOpen}
              aria-controls="phase1-user-menu-panel"
              onClick={() => {
                setUserMenuOpen((open) => !open);
                setLogoutError(false);
              }}
            >
              <span className="phase1-user-name">{session.user.displayName}</span>
              <span className="avatar" aria-hidden="true">
                {session.user.displayName.slice(0, 2).toUpperCase()}
              </span>
              <ChevronDown className="phase1-user-menu-chevron" size={14} aria-hidden="true" />
            </button>
            {userMenuOpen && (
              <div
                id="phase1-user-menu-panel"
                className="phase1-user-menu-panel"
                role="menu"
                aria-label="사용자 메뉴"
              >
                <div className="phase1-user-menu-identity">
                  <strong>{session.user.displayName}</strong>
                  <span>{session.user.email}</span>
                </div>
                <button
                  type="button"
                  role="menuitem"
                  className="phase1-logout-button"
                  disabled={logoutPending}
                  onClick={() => void logout()}
                >
                  <LogOut size={16} aria-hidden="true" />
                  <span>{logoutPending ? "로그아웃 중…" : "로그아웃"}</span>
                </button>
                {logoutError && (
                  <p className="phase1-logout-error" role="alert">
                    로그아웃하지 못했습니다. 다시 시도해 주세요.
                  </p>
                )}
              </div>
            )}
          </div>
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
