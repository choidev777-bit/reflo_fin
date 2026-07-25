"use client";

import {
  Check,
  ChevronDown,
  RotateCcw,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { apiJson, ClientApiError } from "../_phase1/api";
import { useSession } from "../_phase1/useSession";
import { ProcessShell } from "../_phase4/ProcessShell";
import type {
  OutlineChange,
  ReportOutlineWorkspace,
} from "./types";
import styles from "./phase6.module.css";

type SaveState = "idle" | "dirty" | "saving" | "saved" | "error" | "conflict";
function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "요청을 처리하지 못했습니다. 다시 시도해주세요.";
}

export function ReportOutlineScreen({ projectId }: { projectId: string }) {
  const router = useRouter();
  const { session } = useSession();
  const [workspace, setWorkspace] = useState<ReportOutlineWorkspace | null>(null);
  const [expandedPageId, setExpandedPageId] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [pageError, setPageError] = useState("");
  const [approvalOpen, setApprovalOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState("");
  const workspaceRef = useRef<ReportOutlineWorkspace | null>(null);
  const pendingRef = useRef(new Map<string, OutlineChange>());
  const savePromiseRef = useRef<Promise<boolean> | null>(null);
  const approvalKeyRef = useRef("");
  const resetKeyRef = useRef("");
  const approvalButtonRef = useRef<HTMLButtonElement | null>(null);

  const routeError = useCallback(
    (error: unknown): boolean => {
      if (error instanceof ClientApiError) {
        const resumeRoute = error.body.error.meta.resumeRoute;
        if (
          typeof resumeRoute === "string" &&
          resumeRoute !== `/projects/${projectId}/process/report-outline`
        ) {
          router.replace(resumeRoute);
          return true;
        }
        if (error.body.error.code === "OUTLINE_VERSION_CONFLICT") {
          setSaveState("conflict");
        }
      }
      return false;
    },
    [projectId, router],
  );

  const load = useCallback(async () => {
    try {
      const next = await apiJson<ReportOutlineWorkspace>(
        `/api/projects/${projectId}/report-outline`,
      );
      workspaceRef.current = next;
      setWorkspace(next);
      setExpandedPageId((current) => current ?? next.outline.pages[0]?.pageId ?? null);
      setPageError("");
      setSaveState("saved");
    } catch (error) {
      if (!routeError(error)) setPageError(errorMessage(error));
    }
  }, [projectId, routeError]);

  useEffect(() => {
    if (session.status !== "authenticated") return;
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load, session.status]);

  const flushPending = useCallback(async (): Promise<boolean> => {
    if (savePromiseRef.current) return savePromiseRef.current;
    const current = workspaceRef.current;
    if (!current || !session.csrfToken) return false;
    const changes = [...pendingRef.current.values()];
    if (changes.length === 0) return true;
    pendingRef.current.clear();
    setSaveState("saving");
    const requestId = crypto.randomUUID();
    const task = (async () => {
      try {
        const result = await apiJson<{
          outlineVersion: number;
          savedAt: string;
          invalidatedPageIds: string[];
        }>(`/api/projects/${projectId}/report-outline`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            "X-CSRF-Token": session.csrfToken,
          },
          body: JSON.stringify({
            expectedVersion: current.outline.version,
            requestId,
            changes,
          }),
        });
        setWorkspace((value) => {
          if (!value) return value;
          const next = {
            ...value,
            outline: {
              ...value.outline,
              version: result.outlineVersion,
              savedAt: result.savedAt,
              pages: value.outline.pages.map((page) =>
                result.invalidatedPageIds.includes(page.pageId)
                  ? { ...page, reviewStatus: "needs-review" as const }
                  : page,
              ),
            },
          };
          workspaceRef.current = next;
          return next;
        });
        setSaveState(pendingRef.current.size > 0 ? "dirty" : "saved");
        setPageError("");
        return true;
      } catch (error) {
        for (const change of changes) {
          const key = `${change.pageId}:${change.blockId}:${change.field}`;
          if (!pendingRef.current.has(key)) pendingRef.current.set(key, change);
        }
        if (!routeError(error)) {
          setPageError(errorMessage(error));
          setSaveState("error");
        }
        return false;
      } finally {
        savePromiseRef.current = null;
      }
    })();
    savePromiseRef.current = task;
    return task;
  }, [projectId, routeError, session.csrfToken]);

  useEffect(() => {
    if (saveState !== "dirty") return;
    const timer = window.setTimeout(() => void flushPending(), 500);
    return () => window.clearTimeout(timer);
  }, [flushPending, saveState]);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (
        pendingRef.current.size > 0 ||
        saveState === "saving" ||
        saveState === "error"
      ) {
        event.preventDefault();
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [saveState]);

  const updateField = (
    pageId: string,
    blockId: string,
    field: OutlineChange["field"],
    value: string,
  ) => {
    const key = `${pageId}:${blockId}:${field}`;
    pendingRef.current.set(key, { pageId, blockId, field, value });
    setWorkspace((current) => {
      if (!current) return current;
      const next = {
        ...current,
        outline: {
          ...current.outline,
          pages: current.outline.pages.map((page) => {
            if (page.pageId !== pageId) return page;
            return {
              ...page,
              reviewStatus: "needs-review" as const,
              recommendedTitle:
                page.recommendedTitle?.blockId === blockId && field === "value"
                  ? { ...page.recommendedTitle, value }
                  : page.recommendedTitle,
              narrativeBlocks: page.narrativeBlocks.map((block) =>
                block.blockId === blockId &&
                (field === "subtitle" || field === "summary")
                  ? { ...block, [field]: value }
                  : block,
              ),
            };
          }),
        },
      };
      workspaceRef.current = next;
      return next;
    });
    setSaveState("dirty");
  };

  const reviewPage = async (pageId: string) => {
    const saved = await flushPending();
    const current = workspaceRef.current;
    if (!saved || !current || !session.csrfToken) return;
    setPendingAction(`review:${pageId}`);
    try {
      await apiJson(
        `/api/projects/${projectId}/report-outline/pages/${encodeURIComponent(pageId)}/review`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-CSRF-Token": session.csrfToken,
          },
          body: JSON.stringify({
            expectedOutlineVersion: current.outline.version,
          }),
        },
      );
      setWorkspace((value) => {
        if (!value) return value;
        const next = {
          ...value,
          outline: {
            ...value.outline,
            pages: value.outline.pages.map((page) =>
              page.pageId === pageId
                ? { ...page, reviewStatus: "reviewed" as const }
                : page,
            ),
          },
        };
        workspaceRef.current = next;
        return next;
      });
      setPageError("");
    } catch (error) {
      if (!routeError(error)) setPageError(errorMessage(error));
    } finally {
      setPendingAction("");
    }
  };

  const resetOutline = async () => {
    const saved = await flushPending();
    const current = workspaceRef.current;
    if (!saved || !current || !session.csrfToken) return;
    setPendingAction("reset");
    if (!resetKeyRef.current) resetKeyRef.current = crypto.randomUUID();
    try {
      const result = await apiJson<{
        outlineVersion: number;
        savedAt: string;
        generationSource: "ai" | "fallback";
        pages: ReportOutlineWorkspace["outline"]["pages"];
      }>(`/api/projects/${projectId}/report-outline/generations`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": session.csrfToken,
          "Idempotency-Key": resetKeyRef.current,
        },
        body: JSON.stringify({
          expectedOutlineVersion: current.outline.version,
          expectedInputVersions: current.inputVersions,
          mode: "reset",
        }),
      });
      setWorkspace((value) => {
        if (!value) return value;
        const next = {
          ...value,
          outline: {
            ...value.outline,
            version: result.outlineVersion,
            savedAt: result.savedAt,
            status: "editing" as const,
            generationSource: result.generationSource,
            pages: result.pages,
          },
        };
        workspaceRef.current = next;
        return next;
      });
      setExpandedPageId(result.pages[0]?.pageId ?? null);
      setResetOpen(false);
      resetKeyRef.current = "";
      setSaveState("saved");
    } catch (error) {
      if (!routeError(error)) setPageError(errorMessage(error));
    } finally {
      setPendingAction("");
    }
  };

  const approve = async () => {
    const saved = await flushPending();
    const current = workspaceRef.current;
    if (!saved || !current || !session.csrfToken) return;
    setPendingAction("approve");
    if (!approvalKeyRef.current) approvalKeyRef.current = crypto.randomUUID();
    try {
      const result = await apiJson<{
        draftTask: { reportRoute: string; operationStatus: string };
      }>(`/api/projects/${projectId}/report-outline/approve`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": session.csrfToken,
          "Idempotency-Key": approvalKeyRef.current,
        },
        body: JSON.stringify({
          expectedOutlineVersion: current.outline.version,
          expectedInputVersions: current.inputVersions,
        }),
      });
      setApprovalOpen(false);
      router.push(result.draftTask.reportRoute);
      router.refresh();
    } catch (error) {
      if (error instanceof ClientApiError) {
        const first = error.body.error.details[0];
        if (first?.path.startsWith("pages.")) {
          setExpandedPageId(first.path.slice("pages.".length));
        }
      }
      if (!routeError(error)) setPageError(errorMessage(error));
      setApprovalOpen(false);
    } finally {
      setPendingAction("");
    }
  };

  const reviewedCount =
    workspace?.outline.pages.filter((page) => page.reviewStatus === "reviewed")
      .length ?? 0;
  const narrativeCount =
    workspace?.outline.pages.reduce(
      (sum, page) => sum + page.narrativeBlocks.length,
      0,
    ) ?? 0;
  const visualCount =
    workspace?.outline.pages.reduce(
      (sum, page) => sum + page.visualSlots.length,
      0,
    ) ?? 0;
  const allReviewed =
    Boolean(workspace) &&
    reviewedCount === workspace!.outline.pages.length &&
    saveState !== "dirty" &&
    saveState !== "saving" &&
    saveState !== "error" &&
    saveState !== "conflict";
  const saveCopy = useMemo(() => {
    if (saveState === "dirty") return "저장 대기";
    if (saveState === "saving") return "변경사항 저장 중";
    if (saveState === "error") return "저장하지 못했습니다";
    if (saveState === "conflict") return "다른 탭의 최신 변경이 있습니다";
    if (workspace?.outline.savedAt) {
      return `자동 저장됨 · ${new Date(workspace.outline.savedAt).toLocaleTimeString(
        "ko-KR",
        { hour: "2-digit", minute: "2-digit" },
      )}`;
    }
    return "";
  }, [saveState, workspace]);

  if (!workspace) {
    return (
      <div className={styles.loading}>
        {pageError || "페이지 구성을 불러오는 중입니다."}
      </div>
    );
  }

  const footer = (
    <footer className={styles.footerBar}>
      <div className={styles.footerInfo}>
        <strong>
          페이지 확인 {reviewedCount}/{workspace.outline.pages.length}
        </strong>
        <span className={styles.saveStatus} role="status">
          {saveCopy}
        </span>
      </div>
      {saveState === "error" && (
        <button
          type="button"
          className={styles.neutralButton}
          onClick={() => void flushPending()}
        >
          다시 저장
        </button>
      )}
      <button
        ref={approvalButtonRef}
        type="button"
        className={styles.limeButton}
        disabled={!allReviewed || Boolean(pendingAction)}
        onClick={() => setApprovalOpen(true)}
      >
        이 구성으로 초안 생성
      </button>
    </footer>
  );

  return (
    <ProcessShell
      projectName={workspace.project.name}
      activeStage="report_outline"
      stages={workspace.workflow.stageStates}
      footer={footer}
      onBeforeNavigate={() => pendingRef.current.size === 0 && saveState !== "saving"}
    >
      <div className={styles.screen}>
        <header className={styles.screenHeader}>
          <div>
            <p className={styles.eyebrow}>STEP 07</p>
            <h1>페이지 내용 설정</h1>
            <p>
              원본 PDF 구조를 유지하며 페이지별 제목과 작성 방향을
              확인하세요.
            </p>
          </div>
          <div className={styles.headerActions}>
            <button
              type="button"
              className={styles.neutralButton}
              disabled={Boolean(pendingAction)}
              onClick={() => setResetOpen(true)}
            >
              <RotateCcw size={14} aria-hidden="true" /> 제안 다시 만들기
            </button>
          </div>
        </header>

        {pageError && (
          <div className={styles.errorBox} role="alert">
            {pageError}
          </div>
        )}

        {workspace.draftTask?.operationStatus === "succeeded" && (
          <div className={styles.noticeBox}>
            승인된 구성으로 보고서 초안이 준비됐습니다.{" "}
            <button
              type="button"
              className={styles.neutralButton}
              onClick={() => router.push(workspace.navigation.reportRoute)}
            >
              보고서 열기
            </button>
          </div>
        )}

        <div className={styles.summaryBar}>
          <span>
            <strong>{workspace.outline.pages.length}</strong>페이지
          </span>
          <span>
            본문 <strong>{narrativeCount}</strong>개
          </span>
          <span>
            표·차트·수치 <strong>{visualCount}</strong>개
          </span>
          <span>
            확인 <strong>{reviewedCount}/{workspace.outline.pages.length}</strong>
          </span>
        </div>

        <section className={styles.pageList} aria-label="원본 PDF 페이지 구성">
          {workspace.outline.pages.map((page) => {
            const open = expandedPageId === page.pageId;
            const bodyCopy =
              page.narrativeBlocks.length > 0
                ? `본문 ${page.narrativeBlocks.length}`
                : "본문 없음";
            const visualCopy =
              page.visualSlots.length > 0
                ? `표·차트·수치 ${page.visualSlots.length}`
                : "시각 요소 없음";
            return (
              <article className={styles.pageItem} key={page.pageId}>
                <button
                  type="button"
                  className={styles.pageToggle}
                  aria-expanded={open}
                  aria-controls={`outline-panel-${page.pageId}`}
                  id={`outline-trigger-${page.pageId}`}
                  onClick={() =>
                    setExpandedPageId((current) =>
                      current === page.pageId ? null : page.pageId,
                    )
                  }
                >
                  <span className={styles.pageNo}>{page.pageLabel}</span>
                  <span className={styles.pageTitle}>
                    <strong>{page.recommendedTitle?.value ?? page.role}</strong>
                    <small>{bodyCopy} · {visualCopy}</small>
                  </span>
                  <span
                    className={`${styles.reviewState} ${
                      page.reviewStatus === "reviewed" ? styles.reviewed : ""
                    }`}
                  >
                    {page.reviewStatus === "reviewed" ? "✓ 확인 완료" : "확인 필요"}
                  </span>
                  <ChevronDown
                    className={styles.chevron}
                    size={16}
                    aria-hidden="true"
                  />
                </button>

                {open && (
                  <div
                    className={styles.pagePanel}
                    id={`outline-panel-${page.pageId}`}
                    role="region"
                    aria-labelledby={`outline-trigger-${page.pageId}`}
                  >
                    {page.recommendedTitle && (
                      <section className={styles.titleEditor}>
                        <label htmlFor={`${page.pageId}-title`}>
                          {workspace.outline.generationSource === "ai"
                            ? "AI 추천 제목"
                            : "추천 제목"}
                        </label>
                        <input
                          id={`${page.pageId}-title`}
                          value={page.recommendedTitle.value}
                          maxLength={page.recommendedTitle.maxLength}
                          onChange={(event) =>
                            updateField(
                              page.pageId,
                              page.recommendedTitle!.blockId,
                              "value",
                              event.target.value,
                            )
                          }
                        />
                        {page.recommendedTitle.sourceText && (
                          <small>
                            원본 제목 · {page.recommendedTitle.sourceText}
                          </small>
                        )}
                      </section>
                    )}

                    {page.narrativeBlocks.length > 0 ? (
                      <div className={styles.narrativeList}>
                        {page.narrativeBlocks.map((block) => (
                          <section
                            className={styles.narrativeBlock}
                            key={block.blockId}
                          >
                            <header>
                              <strong>본문 {block.order}</strong>
                              <span>연결 근거 {block.evidenceIds.length}개</span>
                            </header>
                            <div className={styles.compactField}>
                              <label htmlFor={`${block.blockId}-subtitle`}>
                                소제목
                              </label>
                              <input
                                id={`${block.blockId}-subtitle`}
                                value={block.subtitle}
                                maxLength={80}
                                placeholder="소제목을 입력하세요"
                                onChange={(event) =>
                                  updateField(
                                    page.pageId,
                                    block.blockId,
                                    "subtitle",
                                    event.target.value,
                                  )
                                }
                              />
                            </div>
                            <div className={styles.compactField}>
                              <label htmlFor={`${block.blockId}-summary`}>
                                한 줄 요약
                              </label>
                              <input
                                id={`${block.blockId}-summary`}
                                value={block.summary}
                                maxLength={block.maxLength}
                                placeholder="이 본문에 들어갈 내용을 한 문장으로 적어주세요"
                                onChange={(event) =>
                                  updateField(
                                    page.pageId,
                                    block.blockId,
                                    "summary",
                                    event.target.value,
                                  )
                                }
                              />
                            </div>
                          </section>
                        ))}
                      </div>
                    ) : (
                      <div className={styles.fixedMessage}>
                        <strong>수정 가능한 본문 없음</strong>
                        <span>이 페이지의 본문과 디자인은 원본을 유지합니다.</span>
                      </div>
                    )}

                    {page.visualSlots.length > 0 && (
                      <>
                        <div className={styles.sectionHead}>
                          <h3>표 · 차트 · 수치</h3>
                          <span>{page.visualSlots.length}개 · 읽기 전용</span>
                        </div>
                        <div className={styles.visualList}>
                          {page.visualSlots.map((slot) => (
                            <div className={styles.visualRow} key={slot.slotId}>
                              <span>{slot.label}</span>
                              <strong>{slot.metric}</strong>
                              <small>
                                {slot.bindingStatus === "confirmed"
                                  ? slot.sourceLabel ??
                                    slot.sourceAddress ??
                                    "데이터 연결 완료"
                                  : "연결 확인 필요"}
                              </small>
                            </div>
                          ))}
                        </div>
                      </>
                    )}

                    <div className={styles.pageActions}>
                      <button
                        type="button"
                        className={styles.darkButton}
                        disabled={
                          pendingAction === `review:${page.pageId}` ||
                          saveState === "conflict"
                        }
                        onClick={() => void reviewPage(page.pageId)}
                      >
                        <Check size={15} aria-hidden="true" />
                        {page.reviewStatus === "reviewed"
                          ? "확인 완료"
                          : "이 페이지 확인"}
                      </button>
                    </div>
                  </div>
                )}
              </article>
            );
          })}
        </section>
      </div>

      {resetOpen && (
        <div className={styles.dialogBackdrop}>
          <section
            className={styles.dialog}
            role="dialog"
            aria-modal="true"
            aria-labelledby="reset-outline-title"
          >
            <header className={styles.dialogHeader}>
              <h2 id="reset-outline-title">제안을 다시 만들까요?</h2>
              <button
                type="button"
                className={styles.iconButton}
                aria-label="초기화 취소"
                onClick={() => setResetOpen(false)}
              >
                <X aria-hidden="true" />
              </button>
            </header>
            <p>
              원본 PDF 구조와 검증된 근거를 기준으로 페이지 제목, 소제목,
              한 줄 요약을 다시 제안합니다.
            </p>
            <div className={styles.dialogActions}>
              <button
                type="button"
                className={styles.neutralButton}
                onClick={() => setResetOpen(false)}
              >
                취소
              </button>
              <button
                type="button"
                className={styles.limeButton}
                disabled={pendingAction === "reset"}
                onClick={() => void resetOutline()}
              >
                제안 다시 만들기
              </button>
            </div>
          </section>
        </div>
      )}

      {approvalOpen && (
        <div className={styles.dialogBackdrop}>
          <section
            className={styles.dialog}
            role="dialog"
            aria-modal="true"
            aria-labelledby="approve-outline-title"
          >
            <header className={styles.dialogHeader}>
              <h2 id="approve-outline-title">페이지 구성을 승인할까요?</h2>
              <button
                type="button"
                className={styles.iconButton}
                aria-label="승인 취소"
                onClick={() => setApprovalOpen(false)}
              >
                <X aria-hidden="true" />
              </button>
            </header>
            <p>
              이 version으로 보고서 초안을 생성합니다. 페이지 수와
              레이아웃은 원본 PDF를 유지합니다.
            </p>
            <div className={styles.dialogSummary}>
              <div>
                <span>페이지</span>
                <strong>{workspace.outline.pages.length}</strong>
              </div>
              <div>
                <span>본문</span>
                <strong>{narrativeCount}</strong>
              </div>
              <div>
                <span>표 · 차트 · 수치</span>
                <strong>{visualCount}</strong>
              </div>
              <div>
                <span>연결 근거</span>
                <strong>{workspace.evidenceSummary.length}</strong>
              </div>
            </div>
            <div className={styles.dialogActions}>
              <button
                type="button"
                className={styles.neutralButton}
                onClick={() => {
                  setApprovalOpen(false);
                  approvalButtonRef.current?.focus();
                }}
              >
                취소
              </button>
              <button
                type="button"
                className={styles.limeButton}
                disabled={pendingAction === "approve"}
                onClick={() => void approve()}
              >
                승인하고 초안 생성
              </button>
            </div>
          </section>
        </div>
      )}
    </ProcessShell>
  );
}
