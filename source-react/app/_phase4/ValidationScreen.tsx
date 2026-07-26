"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { apiJson, ClientApiError } from "../_phase1/api";
import { useSession } from "../_phase1/useSession";
import { ProcessShell } from "./ProcessShell";
import { ValidationWorkbook } from "./ValidationWorkbook";
import type {
  ExcelTarget,
  QuestionAnswer,
  ResultDetail,
  ValidationWorkbookManifest,
  ValidationWorkspace,
  WorkbookApplicationAccepted,
  WorkbookApplicationProjection,
} from "./types";

function evidenceSourceUrl(
  evidence: ResultDetail["evidence"][number],
): string | null {
  if (!evidence.canonicalUrl) return null;
  if (evidence.sourceType !== "NEWS") return evidence.canonicalUrl;
  const fragment =
    typeof evidence.locator.textFragment === "string"
      ? evidence.locator.textFragment
      : evidence.quoteExact;
  try {
    const url = new URL(evidence.canonicalUrl);
    url.hash = `:~:text=${encodeURIComponent(fragment.slice(0, 300))}`;
    return url.toString();
  } catch {
    return evidence.canonicalUrl;
  }
}

type Category = "hypothesis" | "excel";
type Filter = "all" | "conflict" | "complete" | "rejected";
type DecisionAction = "REJECT" | "RESTORE" | "REINVESTIGATE";

function message(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "요청을 처리하지 못했습니다. 다시 시도해주세요.";
}

function stanceLabel(value: string): string {
  if (value === "supporting") return "지지";
  if (value === "contradicting") return "반박";
  return "중립";
}

function sufficiencyLabel(value: QuestionAnswer["sufficiency"]): string {
  if (value === "sufficient") return "충분";
  if (value === "qualified") return "조건부";
  if (value === "reinvestigating") return "재조사 중";
  return "불충분";
}

function workbookWriteStatusLabel(status: string | undefined): string {
  if (status === "applied") return "반영 완료";
  if (status === "applying") return "재계산 중";
  if (status === "blocked") return "반영 차단";
  if (status === "proposed") return "반영 예정";
  return "검증 대기";
}

async function pollWorkbookApplication(
  statusUrl: string,
  onProgress: (projection: WorkbookApplicationProjection) => void,
): Promise<WorkbookApplicationProjection> {
  for (let attempt = 0; attempt < 660; attempt += 1) {
    const projection =
      await apiJson<WorkbookApplicationProjection>(statusUrl);
    onProgress(projection);
    if (
      projection.operationStatus === "succeeded" &&
      projection.validity === "current" &&
      projection.outputWorkbook
    ) {
      return projection;
    }
    if (
      projection.validity === "obsolete" ||
      projection.operationStatus === "failed" ||
      projection.operationStatus === "cancelled"
    ) {
      throw new Error(
        projection.error?.message ??
          "Workbook 반영에 실패했습니다. 원본 Workbook은 변경되지 않았습니다.",
      );
    }
    await new Promise((resolve) => window.setTimeout(resolve, 1_000));
  }
  throw new Error(
    "Workbook 반영이 제한 시간 안에 끝나지 않았습니다. 작업 상태를 다시 확인해주세요.",
  );
}

export function ValidationScreen({ projectId }: { projectId: string }) {
  const router = useRouter();
  const { session } = useSession();
  const [workspace, setWorkspace] = useState<ValidationWorkspace | null>(null);
  const [category, setCategory] = useState<Category>("hypothesis");
  const [filter, setFilter] = useState<Filter>("all");
  const [selectedQuestionId, setSelectedQuestionId] = useState<string | null>(
    null,
  );
  const [selectedResultId, setSelectedResultId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ResultDetail | null>(null);
  const [workbook, setWorkbook] = useState<ValidationWorkbookManifest | null>(
    null,
  );
  const [selectedTarget, setSelectedTarget] = useState<ExcelTarget | null>(null);
  const [pageError, setPageError] = useState("");
  const [decisionAction, setDecisionAction] =
    useState<DecisionAction | null>(null);
  const [decisionReason, setDecisionReason] = useState("");
  const [mutationBusy, setMutationBusy] = useState(false);
  const [qualifiedQuestionId, setQualifiedQuestionId] = useState<string | null>(
    null,
  );
  const [qualifiedReason, setQualifiedReason] = useState("");
  const [expandedViewer, setExpandedViewer] = useState(false);
  const [split, setSplit] = useState(52);
  const splitRef = useRef<HTMLDivElement | null>(null);

  const applyWorkspace = useCallback((next: ValidationWorkspace) => {
    setWorkspace(next);
    setSelectedQuestionId((current) => current ?? next.questions[0]?.questionId ?? null);
    setSelectedResultId((current) => {
      if (current && next.results.some((result) => result.resultId === current)) {
        return current;
      }
      return (
        next.results.find(
          (result) =>
            result.category === "hypothesis" &&
            result.questionId === (next.questions[0]?.questionId ?? null),
        )?.resultId ?? null
      );
    });
  }, []);

  const load = useCallback(async () => {
    try {
      const next = await apiJson<ValidationWorkspace>(
        `/api/projects/${projectId}/validation`,
      );
      applyWorkspace(next);
      setPageError("");
    } catch (error) {
      setPageError(message(error));
    }
  }, [applyWorkspace, projectId]);

  useEffect(() => {
    if (session.status !== "authenticated") return;
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load, session.status]);

  useEffect(() => {
    if (!workspace) return;
    const active = ["COLLECTING", "VALIDATING"].includes(workspace.workspace.status);
    const activeJob = workspace.workspace.jobs.some((job) =>
      ["queued", "running", "cancel_requested"].includes(job.operationStatus),
    );
    if (!active && !activeJob) return;
    const interval = window.setInterval(() => {
      if (!document.hidden) void load();
    }, 3_000);
    const onVisibility = () => !document.hidden && void load();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [load, workspace]);

  useEffect(() => {
    if (!selectedResultId || session.status !== "authenticated") {
      return;
    }
    let stopped = false;
    void apiJson<ResultDetail>(
      `/api/projects/${projectId}/validation/results/${selectedResultId}`,
    )
      .then((next) => !stopped && setDetail(next))
      .catch((error) => !stopped && setPageError(message(error)));
    return () => {
      stopped = true;
    };
  }, [projectId, selectedResultId, session.status]);

  useEffect(() => {
    if (
      category !== "excel" ||
      workbook ||
      session.status !== "authenticated" ||
      !session.csrfToken
    ) {
      return;
    }
    const prepare =
      workspace?.workspace.status === "REVIEW_READY" ||
      workspace?.workspace.status === "APPROVED"
        ? apiJson(
            `/api/projects/${projectId}/validation/workbook-write-proposals`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "X-CSRF-Token": session.csrfToken,
              },
            },
          )
        : Promise.resolve();
    void prepare
      .then(() =>
        apiJson<ValidationWorkbookManifest>(
          `/api/projects/${projectId}/validation/workbook`,
        ),
      )
      .then((next) => {
        const firstTarget = next.validationTargets[0] ?? null;
        setWorkbook(next);
        setSelectedTarget(firstTarget);
        if (firstTarget) {
          const result = workspace?.results.find(
            (item) => item.targetId === firstTarget.targetId,
          );
          setSelectedResultId(result?.resultId ?? null);
        }
      })
      .catch((error) => setPageError(message(error)));
  }, [
    category,
    projectId,
    session.csrfToken,
    session.status,
    workbook,
    workspace,
  ]);

  const selectedResult =
    workspace?.results.find((result) => result.resultId === selectedResultId) ??
    null;
  const selectedWorkbookBinding =
    workbook?.evidenceBindings.find(
      (binding) => binding.targetId === selectedTarget?.targetId,
    ) ?? null;

  const filterCount = (target: Filter) => {
    if (!workspace) return 0;
    const results = workspace.results.filter(
      (result) =>
        result.category === "hypothesis" &&
        result.questionId === selectedQuestionId,
    );
    if (target === "all") return results.length;
    if (target === "conflict") {
      return results.filter((result) =>
        result.exceptionStatus.includes("CONFLICT"),
      ).length;
    }
    if (target === "complete") {
      return results.filter(
        (result) =>
          result.machineStatus === "passed" &&
          result.exceptionStatus === "AVAILABLE",
      ).length;
    }
    return results.filter((result) => result.exceptionStatus === "REJECTED")
      .length;
  };

  const submitDecision = async () => {
    if (
      !workspace ||
      !selectedResult ||
      !decisionAction ||
      !session.csrfToken
    ) {
      return;
    }
    setMutationBusy(true);
    try {
      await apiJson(
        `/api/projects/${projectId}/validation/results/${selectedResult.resultId}/decisions`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-CSRF-Token": session.csrfToken,
            "Idempotency-Key": crypto.randomUUID(),
          },
          body: JSON.stringify({
            expectedValidationVersion: workspace.workspace.validationVersion,
            action: decisionAction,
            reason: decisionReason,
          }),
        },
      );
      setDecisionAction(null);
      setDecisionReason("");
      await load();
    } catch (error) {
      if (error instanceof ClientApiError && error.status === 409) await load();
      setPageError(message(error));
    } finally {
      setMutationBusy(false);
    }
  };

  const saveDecisionDraft = async () => {
    if (
      !selectedResult ||
      !decisionAction ||
      !session.csrfToken ||
      !workspace
    ) {
      return;
    }
    setMutationBusy(true);
    try {
      await apiJson(`/api/projects/${projectId}/validation/drafts`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": session.csrfToken,
        },
        body: JSON.stringify({
          targetType: "result",
          targetId: selectedResult.resultId,
          action: decisionAction,
          reason: decisionReason,
        }),
      });
      setPageError("");
    } catch (error) {
      setPageError(message(error));
    } finally {
      setMutationBusy(false);
    }
  };

  const acceptQualified = async () => {
    if (!workspace || !qualifiedQuestionId || !session.csrfToken) return;
    setMutationBusy(true);
    try {
      await apiJson(
        `/api/projects/${projectId}/validation/questions/${qualifiedQuestionId}/qualified-decision`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-CSRF-Token": session.csrfToken,
            "Idempotency-Key": crypto.randomUUID(),
          },
          body: JSON.stringify({
            expectedValidationVersion: workspace.workspace.validationVersion,
            reason: qualifiedReason,
          }),
        },
      );
      setQualifiedQuestionId(null);
      setQualifiedReason("");
      await load();
    } catch (error) {
      setPageError(message(error));
    } finally {
      setMutationBusy(false);
    }
  };

  const complete = async () => {
    if (!workspace || !session.csrfToken) return;
    setMutationBusy(true);
    try {
      await apiJson(
        `/api/projects/${projectId}/validation/workbook-write-proposals`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-CSRF-Token": session.csrfToken,
          },
        },
      );
      let currentWorkbook = await apiJson<ValidationWorkbookManifest>(
        `/api/projects/${projectId}/validation/workbook`,
      );
      setWorkbook(currentWorkbook);
      if (
        !currentWorkbook.validatedValueSetVersionId ||
        !currentWorkbook.sourceSnapshotId ||
        !currentWorkbook.sourceFingerprint ||
        !currentWorkbook.expectedProjectVersion
      ) {
        throw new Error(
          "승인 Evidence와 Workbook 반영 계획을 먼저 준비해주세요.",
        );
      }
      if (
        currentWorkbook.workbookApplication?.status !== "succeeded" ||
        !currentWorkbook.validatedWorkbookArtifactId
      ) {
        const activeApplication =
          currentWorkbook.workbookApplication?.status === "queued" ||
          currentWorkbook.workbookApplication?.status === "running"
            ? {
                taskId: currentWorkbook.workbookApplication.taskId,
                statusUrl:
                  `/api/projects/${projectId}/validation/` +
                  `workbook-applications/${currentWorkbook.workbookApplication.taskId}`,
              }
            : await apiJson<WorkbookApplicationAccepted>(
                `/api/projects/${projectId}/validation/workbook-applications`,
                {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    "X-CSRF-Token": session.csrfToken,
                    "Idempotency-Key": crypto.randomUUID(),
                  },
                  body: JSON.stringify({
                    validatedValueSetVersionId:
                      currentWorkbook.validatedValueSetVersionId,
                    expectedWorkbookVersion:
                      currentWorkbook.workbookVersion,
                    expectedProjectVersion:
                      currentWorkbook.expectedProjectVersion,
                    sourceSnapshotId:
                      currentWorkbook.sourceSnapshotId,
                    sourceFingerprint:
                      currentWorkbook.sourceFingerprint,
                  }),
                },
              );
        await pollWorkbookApplication(
          activeApplication.statusUrl,
          (projection) => {
            setWorkbook((current) =>
              current
                ? {
                    ...current,
                    workbookApplication: {
                      taskId: projection.taskId,
                      status:
                        projection.operationStatus === "succeeded"
                          ? "succeeded"
                          : projection.operationStatus === "failed" ||
                              projection.operationStatus === "cancelled"
                            ? "failed"
                            : "running",
                    },
                    validatedWorkbookArtifactId:
                      projection.outputWorkbook?.artifactId ?? null,
                  }
                : current,
            );
          },
        );
        currentWorkbook = await apiJson<ValidationWorkbookManifest>(
          `/api/projects/${projectId}/validation/workbook`,
        );
        setWorkbook(currentWorkbook);
      }
      if (!currentWorkbook.validatedWorkbookArtifactId) {
        throw new Error(
          "재계산된 검증 Workbook artifact를 확인하지 못했습니다.",
        );
      }
      const response = await apiJson<{ nextRoute: string }>(
        `/api/projects/${projectId}/validation/complete`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-CSRF-Token": session.csrfToken,
            "Idempotency-Key": crypto.randomUUID(),
          },
          body: JSON.stringify({
            expectedValidationVersion: workspace.workspace.validationVersion,
          }),
        },
      );
      router.push(response.nextRoute);
    } catch (error) {
      setPageError(message(error));
      await load();
    } finally {
      setMutationBusy(false);
    }
  };

  const beginResize = (event: React.PointerEvent) => {
    if (!splitRef.current) return;
    event.preventDefault();
    const bounds = splitRef.current.getBoundingClientRect();
    const onMove = (move: PointerEvent) => {
      setSplit(
        Math.min(
          70,
          Math.max(30, ((move.clientX - bounds.left) / bounds.width) * 100),
        ),
      );
    };
    const stop = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", stop);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", stop);
  };

  if (!workspace) {
    return (
      <main className="phase4-loading">
        <div className="phase4-skeleton" />
        {pageError && (
          <div role="alert">
            {pageError}
            <button type="button" onClick={() => void load()}>
              다시 불러오기
            </button>
          </div>
        )}
      </main>
    );
  }

  const processing = ["COLLECTING", "VALIDATING"].includes(
    workspace.workspace.status,
  );

  return (
    <ProcessShell
      projectName={workspace.project.name}
      activeStage="validation"
      stages={workspace.workflow.stageStates}
      footer={
        <footer className="phase4-footer">
          <button
            type="button"
            className="secondary"
            onClick={() => router.push(workspace.navigation.previousRoute)}
          >
            이전
          </button>
          <div aria-live="polite">
            <span>
              {mutationBusy
                ? "저장 중"
                : decisionAction
                  ? "제출하지 않은 결정 있음"
                  : "서버와 동기화됨"}
            </span>
            <button
              type="button"
              disabled={!decisionAction || mutationBusy}
              onClick={() => void saveDecisionDraft()}
            >
              임시 저장
            </button>
          </div>
          <button
            type="button"
            className="primary"
            disabled={
              !workspace.workspace.stageGate.canProceed || mutationBusy
            }
            aria-describedby="phase4-validation-next-help"
            onClick={() => void complete()}
          >
            다음 <span aria-hidden="true">›</span>
          </button>
          <span id="phase4-validation-next-help" className="phase4-sr-only">
            {workspace.workspace.stageGate.canProceed
              ? "현재 검증 version을 승인하고 밸류에이션으로 이동"
              : "모든 검증 차단 항목을 해결한 뒤 이동할 수 있습니다."}
          </span>
        </footer>
      }
    >
      <div
        className={`spec-screen phase4-screen phase4-validation-screen ${
          expandedViewer ? "viewer-expanded" : ""
        }`}
      >
        <div className="spec-screen-head">
          <div>
            <p>STEP 05</p>
            <h1>조사 결과 검증</h1>
            <span>
              수집 결과를 원문과 대조하고 검증된 값·주장만 다음 단계에
              확정합니다.
            </span>
          </div>
        </div>
        {pageError && (
          <section className="phase4-alert error" role="alert">
            <span>{pageError}</span>
            <button type="button" onClick={() => void load()}>
              최신 결과 불러오기
            </button>
          </section>
        )}
        {processing && (
          <section className="phase4-validation-progress" aria-live="polite">
            <i className="phase1-spinner" />
            <span>
              <strong>자료 수집과 독립 검증이 진행 중입니다.</strong>
              <small>완료된 결과만 게시되며 화면을 떠나도 작업은 계속됩니다.</small>
            </span>
            <b>
              {workspace.workspace.jobs[0]?.progressPercent ?? 0}%
            </b>
          </section>
        )}
        <div
          className="phase4-validation-tabs"
          role="tablist"
          aria-label="검증 대상"
        >
          {(["hypothesis", "excel"] as Category[]).map(
            (item, index, items) => (
              <button
                type="button"
                role="tab"
                aria-selected={category === item}
                aria-controls={`phase4-validation-${item}`}
                tabIndex={category === item ? 0 : -1}
                className={category === item ? "active" : ""}
                key={item}
                onClick={() => setCategory(item)}
                onKeyDown={(event) => {
                  const direction =
                    event.key === "ArrowRight"
                      ? 1
                      : event.key === "ArrowLeft"
                        ? -1
                        : 0;
                  if (!direction) return;
                  event.preventDefault();
                  const next =
                    items[(index + direction + items.length) % items.length];
                  setCategory(next);
                  event.currentTarget.parentElement
                    ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
                    [items.indexOf(next)]?.focus();
                }}
              >
                <i>{item === "hypothesis" ? "01" : "02"}</i>
                <span>
                  <small>{item === "hypothesis" ? "HYPOTHESIS" : "EXCEL"}</small>
                  <strong>
                    {item === "hypothesis"
                      ? "가설 질문의 근거 자료"
                      : "Excel 입력값 및 근거 자료 확인"}
                  </strong>
                </span>
              </button>
            ),
          )}
        </div>
        {category === "hypothesis" ? (
          <div
            className="phase4-validation-workbench"
            id="phase4-validation-hypothesis"
            role="tabpanel"
            ref={splitRef}
            style={
              expandedViewer
                ? { gridTemplateColumns: "1fr" }
                : {
                    gridTemplateColumns: `${split}fr 28px ${100 - split}fr`,
                  }
            }
          >
            {!expandedViewer && (
              <section className="phase4-validation-list">
                <header className="phase4-filter-bar">
                  <strong>검증된 근거</strong>
                  <div role="group" aria-label="검증 상태 필터">
                    {(["all", "conflict", "complete", "rejected"] as Filter[]).map(
                      (item) => (
                        <button
                          type="button"
                          aria-pressed={filter === item}
                          className={filter === item ? `active ${item}` : item}
                          key={item}
                          onClick={() => setFilter(item)}
                        >
                          {item === "all"
                            ? "전체"
                            : item === "conflict"
                              ? "출처 충돌"
                              : item === "complete"
                                ? "확인 완료"
                                : "반려"}{" "}
                          <b>{filterCount(item)}</b>
                        </button>
                      ),
                    )}
                  </div>
                </header>
                <div className="phase4-question-groups">
                  {workspace.questions.map((question, questionIndex) => {
                    const answer = workspace.questionAnswers.find(
                      (item) => item.questionId === question.questionId,
                    );
                    const active = selectedQuestionId === question.questionId;
                    const results = workspace.results.filter(
                      (result) =>
                        result.category === "hypothesis" &&
                        result.questionId === question.questionId &&
                        (filter === "all" ||
                          (filter === "conflict" &&
                            result.exceptionStatus.includes("CONFLICT")) ||
                          (filter === "complete" &&
                            result.machineStatus === "passed" &&
                            result.exceptionStatus === "AVAILABLE") ||
                          (filter === "rejected" &&
                            result.exceptionStatus === "REJECTED")),
                    );
                    return (
                      <section
                        className={`phase4-question-group ${
                          active ? "active" : ""
                        }`}
                        key={question.questionId}
                      >
                        <button
                          type="button"
                          className="phase4-question-head"
                          aria-expanded={active}
                          onClick={() => {
                            setSelectedQuestionId(question.questionId);
                            setSelectedResultId(results[0]?.resultId ?? null);
                          }}
                        >
                          <i>{String(questionIndex + 1).padStart(2, "0")}</i>
                          <span>
                            <strong>{question.text}</strong>
                            <small>
                              {answer?.answer ?? "검증된 근거가 부족합니다."}
                            </small>
                          </span>
                          <em
                            className={
                              answer?.sufficiency ?? "insufficient"
                            }
                          >
                            {answer
                              ? sufficiencyLabel(answer.sufficiency)
                              : "검증 중"}
                          </em>
                        </button>
                        {active && (
                          <div className="phase4-evidence-list">
                            {results.map((result) => (
                              <button
                                type="button"
                                aria-pressed={selectedResultId === result.resultId}
                                className={
                                  selectedResultId === result.resultId
                                    ? "selected"
                                    : ""
                                }
                                key={result.resultId}
                                onClick={() => setSelectedResultId(result.resultId)}
                              >
                                <span>
                                  <small>
                                    {stanceLabel(result.stance)} ·{" "}
                                    {result.exceptionStatus === "REJECTED"
                                      ? "반려"
                                      : result.machineStatus === "passed"
                                        ? "확인 완료"
                                        : "검증 실패"}
                                  </small>
                                  <strong>{result.title}</strong>
                                </span>
                                <b>{result.oneLineValue}</b>
                              </button>
                            ))}
                            {results.length === 0 && (
                              <p>해당 상태 결과가 없습니다.</p>
                            )}
                            {answer?.sufficiency === "qualified" &&
                              !answer.qualifiedAccepted && (
                              <button
                                type="button"
                                className="phase4-qualified-button"
                                onClick={() =>
                                  setQualifiedQuestionId(question.questionId)
                                }
                              >
                                조건부 근거 확인
                              </button>
                            )}
                          </div>
                        )}
                      </section>
                    );
                  })}
                </div>
              </section>
            )}
            {!expandedViewer && (
              <div
                className="phase4-splitter"
                role="separator"
                aria-label="근거 목록과 원문 너비 조절"
                aria-valuenow={Math.round(split)}
                aria-valuemin={30}
                aria-valuemax={70}
                tabIndex={0}
                onPointerDown={beginResize}
                onDoubleClick={() => setSplit(52)}
                onKeyDown={(event) => {
                  if (event.key === "Home") setSplit(30);
                  else if (event.key === "End") setSplit(70);
                  else if (event.key === "ArrowLeft")
                    setSplit((value) => Math.max(30, value - 2));
                  else if (event.key === "ArrowRight")
                    setSplit((value) => Math.min(70, value + 2));
                  else return;
                  event.preventDefault();
                }}
              >
                <i />
              </div>
            )}
            <aside className="phase4-evidence-viewer">
              <header>
                <div>
                  <small>ORIGINAL SOURCE</small>
                  <h2>{detail?.result.title ?? "원문 근거"}</h2>
                </div>
                <button
                  type="button"
                  aria-label={expandedViewer ? "원문 축소" : "원문 확대"}
                  aria-expanded={expandedViewer}
                  onClick={() => setExpandedViewer((value) => !value)}
                >
                  {expandedViewer ? "축소" : "확대"}
                </button>
              </header>
              {detail?.evidence[0] ? (
                <article>
                  <div className="phase4-provenance">
                    <span>{detail.evidence[0].sourceType}</span>
                    <strong>{detail.evidence[0].title}</strong>
                    <small>
                      {detail.evidence[0].publisher} ·{" "}
                      {detail.evidence[0].publishedAt
                        ? new Date(
                            detail.evidence[0].publishedAt,
                          ).toLocaleDateString("ko-KR")
                        : "발행일 확인"}
                    </small>
                  </div>
                  <blockquote>
                    <mark>{detail.evidence[0].quoteExact}</mark>
                  </blockquote>
                  <dl>
                    {detail.evidence[0].checks.map((check) => (
                      <div key={check.code}>
                        <dt>{check.code}</dt>
                        <dd>
                          {check.status === "passed" ? "통과" : "실패"} ·{" "}
                          {check.message}
                        </dd>
                      </div>
                    ))}
                  </dl>
                  {evidenceSourceUrl(detail.evidence[0]) && (
                    <a
                      href={evidenceSourceUrl(detail.evidence[0])!}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      실제 원문에서 열기
                    </a>
                  )}
                  {selectedResult && (
                    <div className="phase4-decision-actions">
                      {selectedResult.exceptionStatus === "REJECTED" ? (
                        <button
                          type="button"
                          onClick={() => setDecisionAction("RESTORE")}
                        >
                          반려 철회
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setDecisionAction("REJECT")}
                        >
                          이 결과 반려
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setDecisionAction("REINVESTIGATE")}
                      >
                        재조사 요청
                      </button>
                    </div>
                  )}
                </article>
              ) : (
                <div className="phase4-empty">
                  근거를 선택하면 원문과 검증 결과를 표시합니다.
                </div>
              )}
            </aside>
          </div>
        ) : (
          <div
            className="phase4-validation-workbench phase4-excel-workbench"
            id="phase4-validation-excel"
            role="tabpanel"
          >
            <section>
              {workbook ? (
                <ValidationWorkbook
                  manifest={workbook}
                  selectedTargetId={selectedTarget?.targetId ?? null}
                  onSelectTarget={(target) => {
                    setSelectedTarget(target);
                    const result = workspace.results.find(
                      (item) => item.targetId === target.targetId,
                    );
                    setSelectedResultId(result?.resultId ?? null);
                  }}
                />
              ) : (
                <div className="phase4-empty">workbook을 불러오고 있습니다.</div>
              )}
            </section>
            <div
              className="phase4-splitter"
              role="separator"
              aria-label="Excel과 원문 너비 조절"
              tabIndex={0}
            >
              <i />
            </div>
            <aside className="phase4-excel-source">
              <header>
                <small>VERIFIED SOURCE</small>
                <h2>{selectedTarget?.metric ?? "선택 셀 원문"}</h2>
                <span>
                  {selectedTarget
                    ? `${selectedTarget.sheetName}!${selectedTarget.address}`
                    : "셀을 선택하세요"}
                </span>
              </header>
              {detail?.evidence[0] &&
              selectedResult?.category === "excel" ? (
                <article>
                  <strong>{detail.evidence[0].title}</strong>
                  <blockquote>{detail.evidence[0].quoteExact}</blockquote>
                  <dl>
                    <div>
                      <dt>원본 값</dt>
                      <dd>{detail.evidence[0].valueOriginal ?? "—"}</dd>
                    </div>
                    <div>
                      <dt>정규화 값</dt>
                      <dd>{detail.evidence[0].valueNormalized ?? "—"}</dd>
                    </div>
                    <div>
                      <dt>기간 · 기준</dt>
                      <dd>
                        {detail.evidence[0].period} ·{" "}
                        {detail.evidence[0].scope}
                      </dd>
                    </div>
                    <div>
                      <dt>Workbook Before</dt>
                      <dd>{selectedWorkbookBinding?.beforeValue ?? "빈 셀"}</dd>
                    </div>
                    <div>
                      <dt>Workbook After</dt>
                      <dd>{selectedWorkbookBinding?.afterValue ?? "—"}</dd>
                    </div>
                    <div>
                      <dt>적용 상태</dt>
                      <dd>
                        {workbookWriteStatusLabel(
                          selectedWorkbookBinding?.writeStatus,
                        )}
                      </dd>
                    </div>
                  </dl>
                </article>
              ) : (
                <div className="phase4-empty">
                  검증 대상 셀을 선택하면 권위 원문을 표시합니다.
                </div>
              )}
            </aside>
          </div>
        )}
        {workspace.workspace.stageGate.blockers.length > 0 && (
          <section className="phase4-blockers" role="alert">
            <strong>
              다음 단계 차단 항목{" "}
              {workspace.workspace.stageGate.blockers.length}건
            </strong>
            <ul>
              {workspace.workspace.stageGate.blockers.map((blocker, index) => (
                <li key={`${blocker.code}-${blocker.targetId}-${index}`}>
                  {blocker.message}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
      {decisionAction && selectedResult && (
        <div className="phase4-dialog-backdrop">
          <div
            className="phase4-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="phase4-decision-title"
          >
            <header>
              <div>
                <small>사용자 결정</small>
                <h2 id="phase4-decision-title">
                  {decisionAction === "REJECT"
                    ? "검증 결과 반려"
                    : decisionAction === "RESTORE"
                      ? "반려 철회"
                      : "재조사 요청"}
                </h2>
              </div>
              <button
                type="button"
                aria-label="결정 입력 닫기"
                onClick={() => setDecisionAction(null)}
              >
                ×
              </button>
            </header>
            <p>{selectedResult.title}에 대한 이유를 5자 이상 입력해주세요.</p>
            <textarea
              autoFocus
              maxLength={500}
              value={decisionReason}
              aria-label="결정 이유"
              onChange={(event) => setDecisionReason(event.target.value)}
            />
            <small>{decisionReason.trim().length} / 500</small>
            <footer>
              <button type="button" onClick={() => setDecisionAction(null)}>
                취소
              </button>
              <button
                type="button"
                className="primary"
                disabled={decisionReason.trim().length < 5 || mutationBusy}
                onClick={() => void submitDecision()}
              >
                {decisionAction === "REINVESTIGATE"
                  ? "재조사 시작"
                  : "결정 저장"}
              </button>
            </footer>
          </div>
        </div>
      )}
      {qualifiedQuestionId && (
        <div className="phase4-dialog-backdrop">
          <div
            className="phase4-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="phase4-qualified-title"
          >
            <header>
              <div>
                <small>조건부 근거</small>
                <h2 id="phase4-qualified-title">근거 한계 확인</h2>
              </div>
              <button
                type="button"
                aria-label="조건부 근거 확인 닫기"
                onClick={() => setQualifiedQuestionId(null)}
              >
                ×
              </button>
            </header>
            <p>
              핵심 지표는 확인했지만 단일 원천 또는 비핵심 보조 지표의
              한계가 있습니다. 이유를 기록한 뒤 조건부로 진행할 수 있습니다.
            </p>
            <textarea
              autoFocus
              maxLength={500}
              value={qualifiedReason}
              aria-label="조건부 진행 이유"
              onChange={(event) => setQualifiedReason(event.target.value)}
            />
            <footer>
              <button
                type="button"
                onClick={() => setQualifiedQuestionId(null)}
              >
                취소
              </button>
              <button
                type="button"
                className="primary"
                disabled={qualifiedReason.trim().length < 5 || mutationBusy}
                onClick={() => void acceptQualified()}
              >
                조건부로 진행
              </button>
            </footer>
          </div>
        </div>
      )}
    </ProcessShell>
  );
}
