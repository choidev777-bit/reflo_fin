"use client";

import { useEffect, useRef, useState } from "react";
import { apiJson, ClientApiError } from "./api";

export function CreateProjectDialog({
  csrfToken,
  onClose,
  onCreated,
}: {
  csrfToken: string;
  onClose: () => void;
  onCreated: (route: string) => void;
}) {
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const idempotencyKey = useRef(crypto.randomUUID());
  const closeButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const projectName = name.replace(/\s+/g, " ").trim();
    if (!projectName) return;
    setSubmitting(true);
    setError("");
    try {
      const response = await apiJson<{
        project: { currentRoute: string };
      }>("/api/projects", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": csrfToken,
          "Idempotency-Key": idempotencyKey.current,
        },
        body: JSON.stringify({ name: projectName }),
      });
      onCreated(response.project.currentRoute);
    } catch (requestError) {
      setError(
        requestError instanceof ClientApiError
          ? requestError.message
          : "프로젝트를 만들지 못했습니다. 다시 시도해주세요.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="create-project-backdrop"
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section
        className="create-project-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-project-title"
      >
        <header>
          <div>
            <span>NEW RESEARCH</span>
            <h2 id="create-project-title">새 리서치 추가하기</h2>
            <p>리서치를 구분할 수 있는 프로젝트 이름을 입력해주세요.</p>
          </div>
          <button ref={closeButton} type="button" onClick={onClose} aria-label="팝업 닫기">
            ×
          </button>
        </header>
        <form onSubmit={submit}>
          <label htmlFor="new-project-name">프로젝트 이름</label>
          <input
            id="new-project-name"
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="예: 삼성전기 2026년 2분기 리서치"
            maxLength={60}
            aria-describedby={error ? "new-project-error" : undefined}
          />
          {error ? (
            <p id="new-project-error" className="phase1-field-error" role="alert">
              {error}
            </p>
          ) : (
            <small>{name.trim().length}/60자</small>
          )}
          <footer>
            <button type="button" onClick={onClose}>
              취소
            </button>
            <button type="submit" className="create" disabled={!name.trim() || submitting}>
              {submitting ? "생성 중" : "생성하기"} <span>→</span>
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
