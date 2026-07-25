"use client";

import {
  Check,
  ChevronDown,
  Database,
  FileText,
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
  EvidenceSummary,
  OutlineNarrative,
  ReportOutlineWorkspace,
} from "./types";
import styles from "./phase6.module.css";

type SaveState = "idle" | "dirty" | "saving" | "saved" | "error" | "conflict";
type Change = {
  pageId: string;
  field: keyof OutlineNarrative;
  value: string;
};

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "요청을 처리하지 못했습니다. 다시 시도해주세요.";
}

function stanceLabel(stance: string): string {
  if (stance === "supporting") return "지지";
  if (stance === "contradicting") return "반박";
  if (stance === "neutral") return "중립";
  return stance;
}

export function ReportOutlineScreen({ projectId }: { projectId: string }) {
  const router = useRouter();
  const { session } = useSession();
  const [workspace, setWorkspace] = useState<ReportOutlineWorkspace | null>(null);
  const [expandedPageId, setExpandedPageId] = useState<string | null>(null);
  const [selectedEvidence, setSelectedEvidence] =
    useState<EvidenceSummary | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [pageError, setPageError] = useState("");
  const [approvalOpen, setApprovalOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState("");
  const workspaceRef = useRef<ReportOutlineWorkspace | null>(null);
  const pendingRef = useRef(new Map<string, Change>());
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
          const key = `${change.pageId}:${change.field}`;
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
    field: keyof OutlineNarrative,
    value: string,
  ) => {
    const key = `${pageId}:${field}`;
    pendingRef.current.set(key, { pageId, field, value });
    setWorkspace((current) => {
      if (!current) return current;
      const next = {
        ...current,
        outline: {
          ...current.outline,
          pages: current.outline.pages.map((page) =>
            page.pageId === pageId && page.narrative
              ? {
                  ...page,
                  reviewStatus: "needs-review" as const,
                  narrative: { ...page.narrative, [field]: value },
                }
              : page,
          ),
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
        페이지 구성 승인
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
              원본 PDF 페이지 구조를 유지하며 제목, 본문 방향, 판단과
              근거 연결을 확인합니다.
            </p>
          </div>
          <div className={styles.headerMeta}>
            <span>
              원본 페이지 <strong>{workspace.outline.pages.length}</strong>
            </span>
            <span>
              Outline version <strong>v{workspace.outline.version}</strong>
            </span>
            <button
              type="button"
              className={styles.neutralButton}
              disabled={Boolean(pendingAction)}
              onClick={() => setResetOpen(true)}
            >
              <RotateCcw size={14} aria-hidden="true" /> 기준 초기화
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

        <div className={styles.outlineGrid}>
          <section className={styles.pageList} aria-label="원본 PDF 페이지 구성">
            {workspace.outline.pages.map((page) => {
              const open = expandedPageId === page.pageId;
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
                      <strong>
                        {page.narrative?.reportTitle ?? page.role}
                      </strong>
                      <small>
                        {page.editable
                          ? "작성 방향 편집 · 연결 확인"
                          : "원본 구조 유지 · 연결 확인"}
                      </small>
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
                      <div className={styles.pageSummary}>
                        <span>
                          역할 <strong>{page.role}</strong>
                        </span>
                        <span>
                          규격{" "}
                          <strong>
                            {Math.round(page.widthPt)} × {Math.round(page.heightPt)}pt
                          </strong>
                        </span>
                        <span>
                          구조{" "}
                          <strong>{page.editable ? "변경 block 있음" : "고정 페이지"}</strong>
                        </span>
                      </div>

                      {page.narrative && (
                        <div className={styles.fieldList}>
                          <div className={styles.fieldRow}>
                            <label htmlFor={`${page.pageId}-title`}>
                              리포트 제목 :
                            </label>
                            <input
                              id={`${page.pageId}-title`}
                              value={page.narrative.reportTitle}
                              maxLength={80}
                              onChange={(event) =>
                                updateField(
                                  page.pageId,
                                  "reportTitle",
                                  event.target.value,
                                )
                              }
                            />
                          </div>
                          <div className={styles.fieldRow}>
                            <label htmlFor={`${page.pageId}-review`}>
                              본문 1_기업 리뷰 :
                            </label>
                            <input
                              id={`${page.pageId}-review`}
                              value={page.narrative.companyReview}
                              maxLength={120}
                              onChange={(event) =>
                                updateField(
                                  page.pageId,
                                  "companyReview",
                                  event.target.value,
                                )
                              }
                            />
                          </div>
                          <div className={styles.fieldRow}>
                            <label htmlFor={`${page.pageId}-outlook`}>
                              본문 2_기업 전망 :
                            </label>
                            <input
                              id={`${page.pageId}-outlook`}
                              value={page.narrative.companyOutlook}
                              maxLength={120}
                              onChange={(event) =>
                                updateField(
                                  page.pageId,
                                  "companyOutlook",
                                  event.target.value,
                                )
                              }
                            />
                          </div>
                          <div className={styles.fieldRow}>
                            <span>본문 3_목표주가 :</span>
                            <div className={styles.targetFields}>
                              <select
                                aria-label="목표주가 방향"
                                value={page.narrative.targetDirection}
                                onChange={(event) =>
                                  updateField(
                                    page.pageId,
                                    "targetDirection",
                                    event.target.value,
                                  )
                                }
                              >
                                <option>유지</option>
                                <option>상향</option>
                                <option>하향</option>
                              </select>
                              <input
                                aria-label="목표주가 핵심 근거"
                                value={page.narrative.targetReason}
                                maxLength={120}
                                onChange={(event) =>
                                  updateField(
                                    page.pageId,
                                    "targetReason",
                                    event.target.value,
                                  )
                                }
                              />
                            </div>
                          </div>
                        </div>
                      )}

                      <div className={styles.sectionHead}>
                        <h3>표 · 차트 · 수치 연결</h3>
                        <span>confirmed MappingSet</span>
                      </div>
                      <div className={styles.visualList}>
                        {page.visualSlots.length > 0 ? (
                          page.visualSlots.map((slot) => (
                            <div className={styles.visualCard} key={slot.slotId}>
                              <span>{slot.label}</span>
                              <strong>{slot.metric}</strong>
                              <small>
                                {slot.bindingStatus === "confirmed"
                                  ? "Excel 연결 완료 · 읽기 전용"
                                  : "연결 재검증 필요"}
                              </small>
                            </div>
                          ))
                        ) : (
                          <div className={styles.visualCard}>
                            <span>고정 구조</span>
                            <strong>변경 가능한 slot 없음</strong>
                            <small>원본 디자인과 문구를 그대로 유지합니다.</small>
                          </div>
                        )}
                      </div>

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

          <aside className={styles.evidencePanel}>
            <div className={styles.evidenceHero}>
              <span>MAIN HYPOTHESIS</span>
              <h2>{workspace.mainHypothesis.rating}</h2>
              <p>{workspace.mainHypothesis.thesis}</p>
            </div>
            <div className={styles.valuationStrip}>
              <span>
                Target PER
                <strong>{workspace.mainHypothesis.targetPer}배</strong>
              </span>
              <span>
                목표주가
                <strong>
                  {Number(workspace.mainHypothesis.targetPrice).toLocaleString(
                    "ko-KR",
                  )}
                  원
                </strong>
              </span>
              <span>
                근거
                <strong>{workspace.evidenceSummary.length}개</strong>
              </span>
            </div>
            <div className={styles.evidenceRows}>
              {workspace.evidenceSummary.map((evidence) => (
                <button
                  type="button"
                  className={styles.evidenceRow}
                  key={evidence.evidenceId}
                  aria-label={`${evidence.title} 원문 근거 열기`}
                  onClick={() => setSelectedEvidence(evidence)}
                >
                  <span className={styles.sourceIcon}>
                    <Database size={14} aria-hidden="true" />
                  </span>
                  <span className={styles.evidenceText}>
                    <span>{stanceLabel(evidence.stance)}</span>
                    <strong>{evidence.title}</strong>
                    <small>
                      {evidence.oneLineValue}
                      <br />
                      {evidence.publisher} · {evidence.sourceTitle}
                    </small>
                  </span>
                </button>
              ))}
            </div>
          </aside>
        </div>
      </div>

      {selectedEvidence && (
        <div
          className={styles.drawerBackdrop}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setSelectedEvidence(null);
          }}
        >
          <aside
            className={styles.drawer}
            role="dialog"
            aria-modal="true"
            aria-labelledby="outline-evidence-title"
          >
            <header className={styles.drawerHeader}>
              <div>
                <p className={styles.eyebrow}>EVIDENCE</p>
                <h2 id="outline-evidence-title">{selectedEvidence.title}</h2>
              </div>
              <button
                type="button"
                className={styles.iconButton}
                aria-label="근거 패널 닫기"
                onClick={() => setSelectedEvidence(null)}
              >
                <X aria-hidden="true" />
              </button>
            </header>
            <dl className={styles.drawerMeta}>
              <div>
                <dt>방향</dt>
                <dd>{stanceLabel(selectedEvidence.stance)}</dd>
              </div>
              <div>
                <dt>발행기관</dt>
                <dd>{selectedEvidence.publisher}</dd>
              </div>
              <div>
                <dt>문서</dt>
                <dd>{selectedEvidence.sourceTitle}</dd>
              </div>
              <div>
                <dt>원문 위치</dt>
                <dd>{JSON.stringify(selectedEvidence.locator)}</dd>
              </div>
            </dl>
            <div className={styles.quoteBox}>
              <FileText size={16} aria-hidden="true" />
              <p>{selectedEvidence.quoteExact}</p>
            </div>
            {selectedEvidence.canonicalUrl && (
              <a
                className={styles.neutralButton}
                href={selectedEvidence.canonicalUrl}
                target="_blank"
                rel="noreferrer"
              >
                공식 원문 열기
              </a>
            )}
          </aside>
        </div>
      )}

      {resetOpen && (
        <div className={styles.dialogBackdrop}>
          <section
            className={styles.dialog}
            role="dialog"
            aria-modal="true"
            aria-labelledby="reset-outline-title"
          >
            <header className={styles.dialogHeader}>
              <h2 id="reset-outline-title">추천 기준으로 초기화할까요?</h2>
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
              현재 입력을 검증된 근거와 승인 밸류에이션 기준으로 다시
              생성합니다. 기존 version은 보존됩니다.
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
                기준 초기화
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
                <span>표 · 차트 · 수치</span>
                <strong>
                  {workspace.outline.pages.reduce(
                    (sum, page) => sum + page.visualSlots.length,
                    0,
                  )}
                </strong>
              </div>
              <div>
                <span>Evidence</span>
                <strong>{workspace.evidenceSummary.length}</strong>
              </div>
              <div>
                <span>Outline version</span>
                <strong>v{workspace.outline.version}</strong>
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
