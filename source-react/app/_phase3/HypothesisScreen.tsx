"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { apiJson, ClientApiError } from "../_phase1/api";
import { useSession } from "../_phase1/useSession";
import type {
  GenerationState,
  HypothesisQuestion,
  HypothesisWorkspace,
  InvestmentRating,
  QuestionSet,
} from "./types";

const stageLabels: Record<
  string,
  { no: string; title: string; short: string }
> = {
  setup: { no: "01", title: "기업 · 작성 정보 입력", short: "기업과 보고서 기준" },
  files: { no: "02", title: "필수 파일 업로드 · 적합성 검사", short: "PDF와 Excel 검사" },
  hypothesis: { no: "03", title: "투자의견 · 조사 질문", short: "가설과 조사 질문" },
  research_plan: { no: "04", title: "자료 수집 및 계획", short: "자료와 출처 설정" },
  validation: { no: "05", title: "조사 결과 검증", short: "근거와 원문 확인" },
  valuation: { no: "06", title: "Excel · PER 밸류에이션", short: "입력값과 계산" },
  report_outline: { no: "07", title: "보고서 생성 · 내보내기", short: "초안과 최종 파일" },
};
const opinionOptions = [
  ["BUY", "상승 가능성을 중심으로 확인"],
  ["HOLD", "더 확인이 필요한 중립 관점"],
  ["SELL", "하방 위험을 중심으로 확인"],
] as const;

type SaveState = "idle" | "dirty" | "saving" | "saved" | "error" | "conflict";
type ApiQuestionSetResponse = { questionSet: QuestionSet };

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "요청을 처리하지 못했습니다. 다시 시도해주세요.";
}

function isGenerationActive(generation: GenerationState | null): boolean {
  return Boolean(
    generation &&
      ["queued", "running", "cancel_requested"].includes(
        generation.operationStatus,
      ),
  );
}

function questionValidation(questionSet: QuestionSet | null): string | null {
  if (!questionSet) return "질문을 먼저 만들어주세요.";
  if (questionSet.questions.length < 3) {
    return `승인하려면 질문을 ${3 - questionSet.questions.length}개 더 추가해야 합니다.`;
  }
  if (questionSet.questions.length > 7) return "질문은 최대 7개까지 승인할 수 있습니다.";
  if (questionSet.status === "stale") return "현재 입력으로 질문을 다시 만들어주세요.";
  return null;
}

export function HypothesisScreen({ projectId }: { projectId: string }) {
  const router = useRouter();
  const { session } = useSession();
  const [workspace, setWorkspace] = useState<HypothesisWorkspace | null>(null);
  const [rating, setRating] = useState<InvestmentRating | null>(null);
  const [thesis, setThesis] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [pageError, setPageError] = useState("");
  const [questionError, setQuestionError] = useState("");
  const [generationError, setGenerationError] = useState("");
  const [editingQuestionId, setEditingQuestionId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const [newQuestion, setNewQuestion] = useState("");
  const [approvalBusy, setApprovalBusy] = useState(false);
  const [questionBusy, setQuestionBusy] = useState(false);
  const [undoQuestion, setUndoQuestion] = useState<HypothesisQuestion | null>(null);
  const saveSequence = useRef(0);
  const debounceTimer = useRef<number | null>(null);
  const ratingRef = useRef<InvestmentRating | null>(null);
  const thesisRef = useRef("");
  const workspaceRef = useRef<HypothesisWorkspace | null>(null);

  const applyWorkspace = useCallback((next: HypothesisWorkspace) => {
    workspaceRef.current = next;
    ratingRef.current = next.draft.provisionalRating;
    thesisRef.current = next.draft.thesis;
    setWorkspace(next);
    setRating(next.draft.provisionalRating);
    setThesis(next.draft.thesis);
    setSaveState("saved");
  }, []);

  const load = useCallback(async () => {
    try {
      const next = await apiJson<HypothesisWorkspace>(
        `/api/projects/${projectId}/hypothesis`,
      );
      applyWorkspace(next);
      setPageError("");
    } catch (error) {
      setPageError(errorMessage(error));
    }
  }, [applyWorkspace, projectId]);

  useEffect(() => {
    if (session.status !== "authenticated") return;
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load, session.status]);

  const saveDraft = useCallback(
    async (
      nextRating: InvestmentRating | null,
      nextThesis: string,
    ): Promise<HypothesisWorkspace["draft"] | null> => {
      const current = workspaceRef.current;
      if (!current || !session.csrfToken) return null;
      const trimmed = nextThesis.trim();
      if (!nextRating || !trimmed || trimmed.length > 500) {
        setSaveState("dirty");
        return null;
      }
      if (
        nextRating === current.draft.provisionalRating &&
        trimmed === current.draft.thesis
      ) {
        setSaveState("saved");
        return current.draft;
      }
      const sequence = ++saveSequence.current;
      setSaveState("saving");
      try {
        const saved = await apiJson<
          HypothesisWorkspace["draft"] & {
            questionSetBecameStale: boolean;
            downstreamInvalidations: string[];
          }
        >(`/api/projects/${projectId}/hypothesis`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            "X-CSRF-Token": session.csrfToken,
          },
          body: JSON.stringify({
            expectedDraftVersion: current.draft.draftVersion,
            provisionalRating: nextRating,
            thesis: trimmed,
            requestId: crypto.randomUUID(),
          }),
        });
        if (sequence !== saveSequence.current) return null;
        setWorkspace((value) => {
          if (!value) return value;
          const questionSet =
            saved.questionSetBecameStale && value.questionSet
              ? { ...value.questionSet, status: "stale" as const }
              : value.questionSet;
          const next = {
            ...value,
            draft: {
              ...value.draft,
              ...saved,
            },
            questionSet,
            navigation: { ...value.navigation, canContinue: false },
          };
          workspaceRef.current = next;
          return next;
        });
        ratingRef.current = saved.provisionalRating;
        thesisRef.current = saved.thesis;
        setSaveState("saved");
        setPageError("");
        return saved;
      } catch (error) {
        if (sequence !== saveSequence.current) return null;
        if (error instanceof ClientApiError && error.status === 409) {
          setSaveState("conflict");
        } else {
          setSaveState("error");
        }
        setPageError(errorMessage(error));
        return null;
      }
    },
    [projectId, session.csrfToken],
  );

  useEffect(() => {
    if (!workspace || thesis === workspace.draft.thesis) return;
    if (debounceTimer.current) window.clearTimeout(debounceTimer.current);
    debounceTimer.current = window.setTimeout(() => {
      void saveDraft(ratingRef.current, thesisRef.current);
    }, 600);
    return () => {
      if (debounceTimer.current) window.clearTimeout(debounceTimer.current);
    };
  }, [saveDraft, thesis, workspace]);

  const selectRating = (value: InvestmentRating) => {
    setRating(value);
    ratingRef.current = value;
    setSaveState("dirty");
    if (debounceTimer.current) window.clearTimeout(debounceTimer.current);
    void saveDraft(value, thesisRef.current);
  };

  const flushSave = useCallback(async () => {
    if (debounceTimer.current) window.clearTimeout(debounceTimer.current);
    return saveDraft(ratingRef.current, thesisRef.current);
  }, [saveDraft]);

  const startGeneration = async () => {
    if (!session.csrfToken || isGenerationActive(workspace?.generation ?? null)) return;
    const saved = await flushSave();
    const current = workspaceRef.current;
    if (!saved || !current) {
      setGenerationError("투자의견과 투자 가설을 저장한 뒤 질문을 만들어주세요.");
      return;
    }
    try {
      setGenerationError("");
      const generation = await apiJson<{
        generationId: string;
        operationStatus: "queued";
        validity: "current";
        statusUrl: string;
      }>(`/api/projects/${projectId}/hypothesis/generations`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": session.csrfToken,
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({
          expectedDraftVersion: saved.draftVersion,
          inputRevision: saved.inputRevision,
          requestId: crypto.randomUUID(),
        }),
      });
      setWorkspace((value) => {
        if (!value) return value;
        const next = {
          ...value,
          generation: {
            ...generation,
            phase: "queued",
            progressPercent: 0,
            retryable: false,
            error: null,
            requestedAt: new Date().toISOString(),
            finishedAt: null,
          } satisfies GenerationState,
        };
        workspaceRef.current = next;
        return next;
      });
    } catch (error) {
      setGenerationError(errorMessage(error));
    }
  };

  useEffect(() => {
    const generation = workspace?.generation;
    if (!generation || !isGenerationActive(generation)) return;
    let cancelled = false;
    const poll = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const next = await apiJson<
          GenerationState & { questionSet: QuestionSet | null }
        >(
          `/api/projects/${projectId}/hypothesis/generations/${generation.generationId}`,
        );
        if (cancelled) return;
        const current = workspaceRef.current;
        if (!current) return;
        const questionSet =
          next.questionSet &&
          (!current.questionSet ||
            next.questionSet.version >= current.questionSet.version)
            ? next.questionSet
            : current.questionSet;
        const updated = {
          ...current,
          generation: next,
          questionSet,
          navigation: { ...current.navigation, canContinue: false },
        };
        workspaceRef.current = updated;
        setWorkspace(updated);
        if (next.operationStatus === "failed") {
          setGenerationError(
            next.error?.message || "질문을 만들지 못했습니다. 다시 시도해주세요.",
          );
        }
      } catch (error) {
        if (!cancelled) setGenerationError(errorMessage(error));
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 3_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [projectId, workspace?.generation]);

  const replaceQuestionSet = (questionSet: QuestionSet) => {
    const current = workspaceRef.current;
    if (
      !current ||
      (current.questionSet && current.questionSet.version > questionSet.version)
    ) {
      return;
    }
    const next = {
      ...current,
      questionSet,
      navigation: { ...current.navigation, canContinue: false },
    };
    workspaceRef.current = next;
    setWorkspace(next);
  };

  const questionRequest = async (
    path: string,
    method: "POST" | "PATCH" | "DELETE" | "PUT",
    payload: Record<string, unknown>,
  ): Promise<QuestionSet | null> => {
    if (!session.csrfToken) return null;
    setQuestionBusy(true);
    setQuestionError("");
    try {
      const response = await apiJson<ApiQuestionSetResponse>(path, {
        method,
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": session.csrfToken,
        },
        body: JSON.stringify({ ...payload, requestId: crypto.randomUUID() }),
      });
      replaceQuestionSet(response.questionSet);
      return response.questionSet;
    } catch (error) {
      setQuestionError(errorMessage(error));
      return null;
    } finally {
      setQuestionBusy(false);
    }
  };

  const saveQuestion = async () => {
    const questionSet = workspace?.questionSet;
    if (!questionSet || !editingQuestionId) return;
    const updated = await questionRequest(
      `/api/projects/${projectId}/hypothesis/question-sets/${questionSet.questionSetId}/questions/${editingQuestionId}`,
      "PATCH",
      {
        expectedQuestionSetVersion: questionSet.version,
        text: editingValue,
      },
    );
    if (updated) {
      setEditingQuestionId(null);
      setEditingValue("");
    }
  };

  const addQuestion = async (text = newQuestion) => {
    const questionSet = workspace?.questionSet;
    if (!questionSet || !text.trim()) return;
    const updated = await questionRequest(
      `/api/projects/${projectId}/hypothesis/question-sets/${questionSet.questionSetId}/questions`,
      "POST",
      {
        expectedQuestionSetVersion: questionSet.version,
        text,
      },
    );
    if (updated) setNewQuestion("");
  };

  const deleteQuestion = async (question: HypothesisQuestion) => {
    const questionSet = workspace?.questionSet;
    if (!questionSet) return;
    const updated = await questionRequest(
      `/api/projects/${projectId}/hypothesis/question-sets/${questionSet.questionSetId}/questions/${question.questionId}`,
      "DELETE",
      { expectedQuestionSetVersion: questionSet.version },
    );
    if (updated) setUndoQuestion(question);
  };

  const approve = async () => {
    const questionSet = workspace?.questionSet;
    if (!questionSet || !session.csrfToken) return;
    setApprovalBusy(true);
    setQuestionError("");
    try {
      const response = await apiJson<{
        questionSet: QuestionSet;
        approvalId: string;
        nextRoute: string;
      }>(
        `/api/projects/${projectId}/hypothesis/question-sets/${questionSet.questionSetId}/approval`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-CSRF-Token": session.csrfToken,
            "Idempotency-Key": crypto.randomUUID(),
          },
          body: JSON.stringify({
            expectedQuestionSetVersion: questionSet.version,
            inputRevision: workspace.draft.inputRevision,
            requestId: crypto.randomUUID(),
          }),
        },
      );
      setWorkspace((value) => {
        if (!value) return value;
        const next = {
          ...value,
          questionSet: response.questionSet,
          navigation: {
            ...value.navigation,
            nextRoute: response.nextRoute,
            canContinue: true,
          },
        };
        workspaceRef.current = next;
        return next;
      });
    } catch (error) {
      setQuestionError(errorMessage(error));
    } finally {
      setApprovalBusy(false);
    }
  };

  const navigateAfterSave = async (route: string) => {
    if (saveState === "dirty" || saveState === "error") {
      const saved = await flushSave();
      if (!saved) return;
    }
    router.push(route);
  };

  if (!workspace) {
    return (
      <div className="phase3-loading" aria-label="투자 의견 불러오는 중">
        <div className="phase3-loading-head" />
        <div className="phase3-loading-card" />
        <div className="phase3-loading-card" />
        <div className="phase3-loading-card large" />
        {pageError && (
          <div className="phase1-inline-error" role="alert">
            {pageError}
            <button type="button" onClick={() => void load()}>
              다시 시도
            </button>
          </div>
        )}
      </div>
    );
  }

  const generationActive = isGenerationActive(workspace.generation);
  const approvalBlock = questionValidation(workspace.questionSet);
  const workflowProgress = Math.round(
    (workspace.workflow.stageStates.filter((stage) => stage.status === "completed")
      .length /
      7) *
      100,
  );
  const canGenerate =
    Boolean(rating && thesis.trim()) &&
    saveState === "saved" &&
    !generationActive;

  return (
    <div className="planned-process-page phase3-hypothesis-page">
      <header className="spec-app-header">
        <button
          className="spec-back-project"
          onClick={() => void navigateAfterSave("/projects")}
        >
          <span>‹</span> 프로젝트로 돌아가기
        </button>
        <nav>
          <button className="active">Process</button>
          <button disabled aria-disabled="true">
            Report
          </button>
        </nav>
        <div className="spec-project-context">
          <span>
            <b>보고서 기준일</b>
            <small>{workspace.project.cutoffDate}</small>
          </span>
        </div>
      </header>
      <div className="spec-workspace">
        <aside className="spec-sidebar">
          <div className="spec-sidebar-project">
            <span>RESEARCH PROJECT</span>
            <strong>{workspace.project.name}</strong>
            <small>
              {workspace.project.ticker} · {workspace.project.targetPeriod.year}년{" "}
              {workspace.project.targetPeriod.quarter}분기
            </small>
            <div>
              <i>
                <b style={{ width: `${workflowProgress}%` }} />
              </i>
              <span>{workflowProgress}%</span>
            </div>
          </div>
          <nav>
            <section>
              <h3>7단계 작업 흐름</h3>
              {workspace.workflow.stageStates.map((stage) => {
                const label = stageLabels[stage.stageKey];
                const accessible = workspace.workflow.allowedRoutes.includes(stage.route);
                const activeStage = stage.stageKey === "hypothesis";
                return (
                  <button
                    key={stage.stageKey}
                    className={`${activeStage ? "active" : ""} ${
                      stage.status === "completed" ? "done" : ""
                    }`}
                    disabled={!accessible || activeStage}
                    onClick={() =>
                      accessible && void navigateAfterSave(stage.route)
                    }
                  >
                    <i>{stage.status === "completed" ? "✓" : label.no}</i>
                    <span>
                      <b>{label.title}</b>
                      <small>
                        {stage.status === "revalidation_required"
                          ? "재검증 필요"
                          : !accessible
                            ? "선행 단계 필요"
                            : label.short}
                      </small>
                    </span>
                    {activeStage && <em />}
                  </button>
                );
              })}
            </section>
          </nav>
        </aside>
        <main className="spec-main">
          <div className="spec-screen rf-research-screen phase3-hypothesis-screen">
            <div className="spec-screen-head">
              <div>
                <p>STEP 03</p>
                <h1>투자의견 · 조사 질문</h1>
                <span>
                  지금 생각하는 투자 가설을 적으면 AI가 조사할 질문으로 나눕니다.
                </span>
              </div>
            </div>
            {pageError && (
              <section className="phase1-inline-error" role="alert">
                {pageError}
                {saveState === "conflict" ? (
                  <button type="button" onClick={() => void load()}>
                    최신 내용 불러오기
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => void flushSave()}
                  >
                    다시 저장
                  </button>
                )}
              </section>
            )}
            <div className="rf-stack">
              <section className="rf-panel rf-section-panel">
                <div className="rf-section-title">
                  <div>
                    <i>01</i>
                    <span>
                      <h2>잠정 투자의견</h2>
                      <p>조사 방향을 정하는 필수 입력이며 최종 투자의견이 아닙니다.</p>
                    </span>
                  </div>
                  <span className="rf-badge required">필수</span>
                </div>
                <div
                  className="rf-opinion-grid"
                  role="radiogroup"
                  aria-label="잠정 투자의견"
                >
                  {opinionOptions.map(([value, copy], index) => (
                    <button
                      key={value}
                      type="button"
                      role="radio"
                      aria-checked={rating === value}
                      className={rating === value ? "selected" : ""}
                      onClick={() => selectRating(value)}
                      onKeyDown={(event) => {
                        const direction =
                          event.key === "ArrowRight" || event.key === "ArrowDown"
                            ? 1
                            : event.key === "ArrowLeft" || event.key === "ArrowUp"
                              ? -1
                              : 0;
                        if (!direction) return;
                        event.preventDefault();
                        const nextIndex =
                          (index + direction + opinionOptions.length) %
                          opinionOptions.length;
                        selectRating(opinionOptions[nextIndex][0]);
                        event.currentTarget.parentElement
                          ?.querySelectorAll<HTMLButtonElement>('[role="radio"]')
                          [nextIndex]?.focus();
                      }}
                    >
                      <i aria-hidden="true">{rating === value ? "✓" : ""}</i>
                      <span>
                        <b>{value}</b>
                        <small>{copy}</small>
                      </span>
                    </button>
                  ))}
                </div>
              </section>
              <section className="rf-panel rf-section-panel">
                <div className="rf-section-title">
                  <div>
                    <i>02</i>
                    <span>
                      <h2>투자 의견에 대한 설명</h2>
                      <p>관찰한 변화와 기대 또는 우려를 구체적으로 적어주세요.</p>
                    </span>
                  </div>
                  <span className="rf-badge required">필수</span>
                </div>
                <div className="rf-thought-box">
                  <textarea
                    maxLength={500}
                    aria-label="투자 의견에 대한 설명"
                    value={thesis}
                    onChange={(event) => {
                      setThesis(event.target.value);
                      thesisRef.current = event.target.value;
                      setSaveState("dirty");
                    }}
                    onBlur={() => void flushSave()}
                    placeholder="예: 제품 가격 상승과 판매량 회복으로 하반기 수익성이 개선될 것이다."
                  />
                  <div className="rf-field-meta">
                    <span>
                      <b>{thesis.length}</b> / 500
                    </span>
                  </div>
                  {generationError && (
                    <div className="phase3-card-error" role="alert">
                      <span>{generationError}</span>
                      {workspace.generation?.retryable && (
                        <button type="button" onClick={() => void startGeneration()}>
                          다시 만들기
                        </button>
                      )}
                    </div>
                  )}
                  <div className="rf-button-row">
                    <button
                      className="rf-button primary rf-generate-button"
                      type="button"
                      disabled={!canGenerate}
                      onClick={() => void startGeneration()}
                    >
                      {generationActive
                        ? "질문 만드는 중"
                        : workspace.questionSet
                          ? "AI 질문 다시 만들기"
                          : "AI 질문 만들기"}
                    </button>
                  </div>
                </div>
              </section>
              {generationActive && (
                <section
                  className="rf-panel phase3-generation-panel"
                  aria-live="polite"
                >
                  <div>
                    <i className="phase1-spinner" />
                    <span>
                      <strong>조사 질문을 만들고 있습니다.</strong>
                      <small>화면을 떠나도 서버 작업은 계속됩니다.</small>
                    </span>
                  </div>
                  <progress
                    max={100}
                    value={workspace.generation?.progressPercent ?? 0}
                  />
                </section>
              )}
              {workspace.questionSet && (
                <section
                  className="rf-panel rf-question-panel"
                  data-question-set-version={workspace.questionSet.version}
                >
                  <header>
                    <div className="rf-section-title">
                      <div>
                        <i>03</i>
                        <span>
                          <h2>현재 의견을 반영한 가설 질문</h2>
                          <p>질문을 검토한 뒤 전체를 승인하세요.</p>
                        </span>
                      </div>
                      <span
                        className={`rf-badge ${
                          workspace.questionSet.status === "approved"
                            ? "required"
                            : "review" +
                              (workspace.questionSet.status === "stale"
                                ? " stale"
                                : "")
                        }`}
                      >
                        {workspace.questionSet.status === "approved"
                          ? "승인 완료"
                          : workspace.questionSet.status === "stale"
                            ? "다시 생성 필요"
                            : "검토 필요"}
                      </span>
                    </div>
                  </header>
                  <div className="rf-question-list">
                    {workspace.questionSet.questions.map((question, index) => (
                      <div
                        className="rf-question-row phase3-question-row"
                        key={question.questionId}
                      >
                        <i>{String(index + 1).padStart(2, "0")}</i>
                        {editingQuestionId === question.questionId ? (
                          <>
                            <input
                              autoFocus
                              maxLength={300}
                              value={editingValue}
                              onChange={(event) => setEditingValue(event.target.value)}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") void saveQuestion();
                                if (event.key === "Escape") {
                                  setEditingQuestionId(null);
                                  setEditingValue("");
                                }
                              }}
                              aria-label={`${String(index + 1).padStart(2, "0")}번 질문 수정`}
                            />
                            <span className="rf-row-actions">
                              <button
                                type="button"
                                disabled={questionBusy || !editingValue.trim()}
                                onClick={() => void saveQuestion()}
                              >
                                저장
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingQuestionId(null);
                                  setEditingValue("");
                                }}
                              >
                                취소
                              </button>
                            </span>
                          </>
                        ) : (
                          <>
                            <span className="phase3-question-copy">
                              {question.text}
                            </span>
                            <span className="rf-row-actions phase3-row-actions">
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingQuestionId(question.questionId);
                                  setEditingValue(question.text);
                                }}
                              >
                                수정
                              </button>
                              <button
                                type="button"
                                aria-label={`${String(index + 1).padStart(2, "0")}번 질문 삭제`}
                                disabled={questionBusy}
                                onClick={() => void deleteQuestion(question)}
                              >
                                삭제
                              </button>
                            </span>
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                  <footer>
                    {questionError && (
                      <div className="phase3-card-error" role="alert">
                        {questionError}
                      </div>
                    )}
                    {undoQuestion && (
                      <div className="phase3-undo" role="status">
                        질문을 목록에서 제외했습니다.
                        <button
                          type="button"
                          onClick={() => {
                            const question = undoQuestion;
                            setUndoQuestion(null);
                            void addQuestion(question.text);
                          }}
                        >
                          실행 취소
                        </button>
                      </div>
                    )}
                    <div className="rf-add-question">
                      <input
                        maxLength={300}
                        value={newQuestion}
                        onChange={(event) => setNewQuestion(event.target.value)}
                        onKeyDown={(event) =>
                          event.key === "Enter" && void addQuestion()
                        }
                        placeholder={`${workspace.project.companyName}, 기간, 비교 기준과 지표를 포함한 질문`}
                        aria-label="새 조사 질문"
                        disabled={workspace.questionSet.questions.length >= 7}
                      />
                      <button
                        className="rf-button"
                        type="button"
                        disabled={
                          !newQuestion.trim() ||
                          workspace.questionSet.questions.length >= 7 ||
                          questionBusy
                        }
                        onClick={() => void addQuestion()}
                      >
                        + 질문 추가
                      </button>
                    </div>
                    <div className="phase3-approval">
                      <span id="phase3-approval-help">
                        {workspace.questionSet.status === "approved"
                          ? `v${workspace.questionSet.version} · ${new Date(
                              workspace.questionSet.approvedAt!,
                            ).toLocaleString("ko-KR")} 승인`
                          : approvalBlock ||
                            "승인하면 현재 입력과 질문 버전이 다음 단계에 고정됩니다."}
                      </span>
                      <button
                        className="rf-button phase3-approve-button"
                        type="button"
                        disabled={
                          Boolean(approvalBlock) ||
                          approvalBusy ||
                          workspace.questionSet.status === "approved"
                        }
                        aria-describedby="phase3-approval-help"
                        onClick={() => void approve()}
                      >
                        {approvalBusy
                          ? "승인 중"
                          : workspace.questionSet.status === "approved"
                            ? "승인 완료"
                            : "질문 전체 승인"}
                      </button>
                    </div>
                  </footer>
                </section>
              )}
            </div>
          </div>
        </main>
      </div>
      <footer className="phase3-action-bar">
        <button
          type="button"
          className="phase3-previous"
          onClick={() => void navigateAfterSave(workspace.navigation.previousRoute)}
        >
          이전
        </button>
        <div aria-live="polite">
          <span>
            {saveState === "saving"
              ? "저장 중"
              : saveState === "saved"
                ? "자동 저장됨"
                : saveState === "conflict"
                  ? "최신본 확인 필요"
                  : saveState === "error"
                    ? "저장되지 않음"
                    : "변경 내용 있음"}
          </span>
          <button
            type="button"
            disabled={saveState === "saving" || saveState === "saved"}
            onClick={() => void flushSave()}
          >
            임시 저장
          </button>
        </div>
        <button
          type="button"
          className="phase3-next"
          disabled={!workspace.navigation.canContinue}
          aria-describedby="phase3-next-help"
          onClick={() => router.push(workspace.navigation.nextRoute)}
        >
          다음 <span aria-hidden="true">›</span>
        </button>
        <span id="phase3-next-help" className="phase3-visually-hidden">
          {workspace.navigation.canContinue
            ? "자료 수집 및 계획 단계로 이동"
            : "현재 질문 전체 승인 후 이동할 수 있습니다."}
        </span>
      </footer>
    </div>
  );
}
