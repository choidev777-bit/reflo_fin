"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { apiJson, ClientApiError } from "../_phase1/api";
import { useSession } from "../_phase1/useSession";
import { ProcessShell } from "./ProcessShell";
import type {
  PlanQuestion,
  ResearchJob,
  ResearchPlanWorkspace,
  ResearchSourceReference,
  SourceType,
} from "./types";

type Purpose = "hypothesis" | "excel";
type SaveState = "idle" | "saving" | "saved" | "error" | "conflict";

function message(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "요청을 처리하지 못했습니다. 다시 시도해주세요.";
}

function methodLabel(
  value: string | undefined,
  sourceType?: SourceType,
): string {
  if (
    sourceType === "COMPANY_IR" ||
    sourceType === "NEWS" ||
    sourceType === "USER_MATERIAL"
  ) {
    return "사용자 제공 원문 + AI 해석";
  }
  if (value === "code") return "코드 수집";
  if (value === "code_then_agent") return "코드 수집 후 AI 해석";
  return "AI 해석";
}

function jobPhaseLabel(phase: string | null): string {
  const labels: Record<string, string> = {
    preparing: "승인 계획과 입력 version 고정",
    collecting_code_sources: "공식 API와 공개 원문 수집",
    collecting_documents: "문서 자료 확보",
    extracting_candidates: "조사 후보 구조화",
    validating_evidence: "원문 독립 검증",
    publishing_projection: "검증 대기열 게시",
  };
  return phase ? labels[phase] ?? phase : "작업 준비";
}

export function ResearchPlanScreen({ projectId }: { projectId: string }) {
  const router = useRouter();
  const { session } = useSession();
  const [workspace, setWorkspace] = useState<ResearchPlanWorkspace | null>(
    null,
  );
  const [purpose, setPurpose] = useState<Purpose>("hypothesis");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [pageError, setPageError] = useState("");
  const [sourceTarget, setSourceTarget] = useState<
    "bulk" | { questionId: string } | null
  >(null);
  const [sourceDraft, setSourceDraft] = useState<SourceType[]>([]);
  const [materialType, setMaterialType] = useState<
    ResearchSourceReference["sourceType"]
  >("COMPANY_IR");
  const [materialMethod, setMaterialMethod] = useState<"user_upload" | "user_url">(
    "user_upload",
  );
  const [materialTitle, setMaterialTitle] = useState("");
  const [materialPublishedAt, setMaterialPublishedAt] = useState("");
  const [materialUrl, setMaterialUrl] = useState("");
  const [materialFile, setMaterialFile] = useState<File | null>(null);
  const [materialSaving, setMaterialSaving] = useState(false);
  const materialFileInputRef = useRef<HTMLInputElement | null>(null);
  const [approvalOpen, setApprovalOpen] = useState(false);
  const [starting, setStarting] = useState(false);
  const [job, setJob] = useState<ResearchJob | null>(null);
  const sourceDialogRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    try {
      const next = await apiJson<ResearchPlanWorkspace>(
        `/api/projects/${projectId}/research-plan`,
      );
      setWorkspace(next);
      setJob(next.activeJob);
      setPageError("");
      setSaveState("saved");
    } catch (error) {
      setPageError(message(error));
    }
  }, [projectId]);

  useEffect(() => {
    if (session.status !== "authenticated") return;
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load, session.status]);

  useEffect(() => {
    if (!sourceTarget) return;
    const timer = window.setTimeout(
      () =>
        sourceDialogRef.current
          ?.querySelector<HTMLButtonElement>("button, input")
          ?.focus(),
      0,
    );
    return () => window.clearTimeout(timer);
  }, [sourceTarget]);

  useEffect(() => {
    if (
      !job ||
      !["queued", "running", "cancel_requested"].includes(job.operationStatus)
    ) {
      return;
    }
    let stopped = false;
    const poll = async () => {
      if (document.hidden || stopped) return;
      try {
        const next = await apiJson<ResearchJob>(
          `/api/projects/${projectId}/research-jobs/${job.jobId}`,
        );
        if (!stopped) {
          setJob(next);
          if (next.operationStatus === "succeeded") void load();
        }
      } catch (error) {
        if (!stopped) setPageError(message(error));
      }
    };
    const interval = window.setInterval(() => void poll(), 3_000);
    const onVisibility = () => !document.hidden && void poll();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stopped = true;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [job, load, projectId]);

  const saveChanges = useCallback(
    async (changes: unknown[]) => {
      if (!workspace || !session.csrfToken) return;
      setSaveState("saving");
      try {
        const saved = await apiJson<{
          version: number;
          questions: ResearchPlanWorkspace["plan"]["questions"];
          excelTargets: ResearchPlanWorkspace["plan"]["excelTargets"];
          userUrls: string[];
          validationSummary: ResearchPlanWorkspace["plan"]["validationSummary"];
          lastSavedAt: string;
        }>(`/api/projects/${projectId}/research-plan`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            "X-CSRF-Token": session.csrfToken,
          },
          body: JSON.stringify({
            expectedVersion: workspace.plan.version,
            changes,
          }),
        });
        setWorkspace((current) =>
          current
            ? {
                ...current,
                plan: {
                  ...current.plan,
                  ...saved,
                  status: "draft",
                },
              }
            : current,
        );
        setSaveState("saved");
        setPageError("");
      } catch (error) {
        setSaveState(
          error instanceof ClientApiError && error.status === 409
            ? "conflict"
            : "error",
        );
        setPageError(message(error));
        throw error;
      }
    },
    [projectId, session.csrfToken, workspace],
  );

  const openSources = (
    target: "bulk" | { questionId: string },
    question?: PlanQuestion,
  ) => {
    setSourceTarget(target);
    if (target === "bulk") {
      const included =
        workspace?.plan.questions.filter((item) => item.included) ?? [];
      const common = workspace?.sourceOptions
        .map((option) => option.sourceType)
        .filter((source) =>
          included.every((item) => item.sourceBindingIds.includes(source)),
        );
      setSourceDraft(common ?? []);
    } else {
      setSourceDraft(question?.sourceBindingIds ?? []);
    }
  };

  const saveSources = async () => {
    if (!workspace || !sourceTarget || sourceDraft.length === 0) return;
    const questionIds =
      sourceTarget === "bulk"
        ? workspace.plan.questions
            .filter((question) => question.included)
            .map((question) => question.questionId)
        : [sourceTarget.questionId];
    try {
      await saveChanges(
        questionIds.map((questionId) => ({
          op: "set_question_sources",
          questionId,
          sourceBindingIds: sourceDraft,
        })),
      );
      setSourceTarget(null);
    } catch {
      // The dialog stays open with the current selection for a retry.
    }
  };

  const saveMaterial = async () => {
    if (!workspace || !session.csrfToken) return;
    if (!materialTitle.trim()) {
      setPageError("자료명을 입력해주세요.");
      return;
    }
    if (
      (materialType === "COMPANY_IR" || materialType === "NEWS") &&
      !materialPublishedAt
    ) {
      setPageError("자료 발행일을 입력해주세요.");
      return;
    }
    if (materialMethod === "user_upload" && !materialFile) {
      setPageError("등록할 PDF를 선택해주세요.");
      return;
    }
    if (materialMethod === "user_url" && !materialUrl.trim()) {
      setPageError("공식 원문 URL을 입력해주세요.");
      return;
    }
    setMaterialSaving(true);
    try {
      const response =
        materialMethod === "user_upload"
          ? await (() => {
              const form = new FormData();
              form.set("expectedVersion", String(workspace.plan.version));
              form.set("sourceType", materialType);
              form.set("title", materialTitle.trim());
              form.set("publishedAt", materialPublishedAt);
              if (materialFile) form.set("file", materialFile);
              return apiJson<{
                version: number;
                sourceReferences: ResearchSourceReference[];
                validationSummary: ResearchPlanWorkspace["plan"]["validationSummary"];
                lastSavedAt: string;
              }>(`/api/projects/${projectId}/research-plan/materials`, {
                method: "POST",
                headers: { "X-CSRF-Token": session.csrfToken },
                body: form,
              });
            })()
          : await apiJson<{
              version: number;
              sourceReferences: ResearchSourceReference[];
              validationSummary: ResearchPlanWorkspace["plan"]["validationSummary"];
              lastSavedAt: string;
            }>(`/api/projects/${projectId}/research-plan/materials`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "X-CSRF-Token": session.csrfToken,
              },
              body: JSON.stringify({
                expectedVersion: workspace.plan.version,
                sourceType: materialType,
                title: materialTitle.trim(),
                publishedAt: materialPublishedAt || null,
                url: materialUrl.trim(),
              }),
            });
      setWorkspace((current) =>
        current
          ? {
              ...current,
              plan: { ...current.plan, ...response, status: "draft" },
            }
          : current,
      );
      setMaterialTitle("");
      setMaterialPublishedAt("");
      setMaterialUrl("");
      setMaterialFile(null);
      if (materialFileInputRef.current) {
        materialFileInputRef.current.value = "";
      }
      setJob(null);
      setSaveState("saved");
      setPageError("");
    } catch (error) {
      setPageError(message(error));
      setSaveState(
        error instanceof ClientApiError && error.status === 409
          ? "conflict"
          : "error",
      );
    } finally {
      setMaterialSaving(false);
    }
  };

  const removeMaterial = async (referenceId: string) => {
    if (!workspace || !session.csrfToken) return;
    try {
      const response = await apiJson<{
        version: number;
        sourceReferences: ResearchSourceReference[];
        validationSummary: ResearchPlanWorkspace["plan"]["validationSummary"];
        lastSavedAt: string;
      }>(
        `/api/projects/${projectId}/research-plan/materials/${referenceId}`,
        {
          method: "DELETE",
          headers: {
            "Content-Type": "application/json",
            "X-CSRF-Token": session.csrfToken,
          },
          body: JSON.stringify({ expectedVersion: workspace.plan.version }),
        },
      );
      setWorkspace((current) =>
        current
          ? {
              ...current,
              plan: { ...current.plan, ...response, status: "draft" },
            }
          : current,
      );
      setJob(null);
      setSaveState("saved");
      setPageError("");
    } catch (error) {
      setPageError(message(error));
    }
  };

  const startResearch = async () => {
    if (!workspace || !session.csrfToken) return;
    setStarting(true);
    try {
      const response = await apiJson<{
        job: ResearchJob;
      }>(`/api/projects/${projectId}/research-plan/approve-and-start`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": session.csrfToken,
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({
          planId: workspace.plan.planId,
          expectedVersion: workspace.plan.version,
        }),
      });
      setJob(response.job);
      setApprovalOpen(false);
      setWorkspace((current) =>
        current
          ? {
              ...current,
              plan: { ...current.plan, status: "approved" },
            }
          : current,
      );
      setPageError("");
    } catch (error) {
      setPageError(message(error));
    } finally {
      setStarting(false);
    }
  };

  const cancelJob = async () => {
    if (!job || !session.csrfToken) return;
    try {
      const next = await apiJson<{ operationStatus: "cancel_requested" }>(
        `/api/projects/${projectId}/research-jobs/${job.jobId}/cancel`,
        {
          method: "POST",
          headers: {
            "X-CSRF-Token": session.csrfToken,
            "Idempotency-Key": crypto.randomUUID(),
          },
        },
      );
      setJob((current) =>
        current ? { ...current, operationStatus: next.operationStatus } : current,
      );
    } catch (error) {
      setPageError(message(error));
    }
  };

  const retryJob = async () => {
    if (!job || !session.csrfToken) return;
    try {
      const next = await apiJson<{
        jobId: string;
        researchRunId: string;
        operationStatus: "queued";
      }>(`/api/projects/${projectId}/research-jobs/${job.jobId}/retry`, {
        method: "POST",
        headers: {
          "X-CSRF-Token": session.csrfToken,
          "Idempotency-Key": crypto.randomUUID(),
        },
      });
      setJob({
        ...job,
        ...next,
        phase: "preparing",
        progressPercent: 0,
        retryable: false,
        error: null,
        updatedAt: new Date().toISOString(),
      });
    } catch (error) {
      setPageError(message(error));
    }
  };

  const includedCount =
    workspace?.plan.questions.filter((question) => question.included).length ??
    0;
  const planReady = Boolean(
    workspace?.plan.validationSummary.valid && saveState === "saved",
  );
  const activeJob = Boolean(
    job &&
      ["queued", "running", "cancel_requested"].includes(job.operationStatus),
  );
  const sourceLabels = useMemo(
    () =>
      new Map(
        workspace?.sourceOptions.map((option) => [
          option.sourceType,
          option.label,
        ]) ?? [],
      ),
    [workspace],
  );

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

  return (
    <ProcessShell
      projectName={workspace.project.name}
      activeStage="research_plan"
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
              {saveState === "saving"
                ? "저장 중"
                : saveState === "saved"
                  ? "자동 저장됨"
                  : saveState === "conflict"
                    ? "최신본 확인 필요"
                    : saveState === "error"
                      ? "저장 실패"
                      : "변경 내용 있음"}
            </span>
            <button
              type="button"
              disabled={saveState === "saving" || saveState === "saved"}
              onClick={() => void saveMaterial()}
            >
              임시 저장
            </button>
          </div>
          <button
            type="button"
            className="primary"
            disabled={!planReady && !job}
            onClick={() => {
              if (job) router.push(workspace.navigation.validationRoute);
              else setApprovalOpen(true);
            }}
          >
            {job
              ? job.operationStatus === "succeeded"
                ? "조사 결과 검증"
                : "수집 상태 보기"
              : "다음"}
            <span aria-hidden="true">›</span>
          </button>
        </footer>
      }
    >
      <div className="spec-screen phase4-screen phase4-plan-screen">
        <div className="spec-screen-head">
          <div>
            <p>STEP 04</p>
            <h1>자료 수집 및 계획</h1>
            <span>
              승인된 가설 질문과 Excel 실제값 입력 대상을 확인하고, 수집할
              출처와 방법을 확정합니다.
            </span>
          </div>
        </div>
        {pageError && (
          <section className="phase4-alert error" role="alert">
            <span>{pageError}</span>
            {saveState === "conflict" && (
              <button type="button" onClick={() => void load()}>
                최신 계획 불러오기
              </button>
            )}
          </section>
        )}
        {workspace.plan.status === "revalidation_required" && (
          <section className="phase4-alert" role="status">
            상위 입력이 변경되어 최신 질문과 workbook으로 계획을 다시
            확인해야 합니다.
          </section>
        )}
        {job && (
          <section className={`phase4-job ${job.operationStatus}`} aria-live="polite">
            <div>
              <span>
                {job.operationStatus === "succeeded"
                  ? "검증 대기열 준비 완료"
                  : job.operationStatus === "failed"
                    ? "자료 수집 실패"
                    : job.operationStatus === "cancelled"
                      ? "자료 수집 취소됨"
                      : "자료 수집·독립 검증 진행 중"}
              </span>
              <strong>{jobPhaseLabel(job.phase)}</strong>
              <small>
                화면을 떠나도 작업은 계속됩니다. 최근 갱신{" "}
                {new Date(job.updatedAt).toLocaleTimeString("ko-KR")}
              </small>
            </div>
            <div
              className="phase4-progress"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={job.progressPercent}
              aria-label="자료 수집 진행률"
            >
              <i style={{ width: `${job.progressPercent}%` }} />
            </div>
            <b>{job.progressPercent}%</b>
            {activeJob && job.operationStatus !== "cancel_requested" && (
              <button type="button" onClick={() => void cancelJob()}>
                자료 수집 취소
              </button>
            )}
            {job.operationStatus === "failed" && job.retryable && (
              <button type="button" onClick={() => void retryJob()}>
                실패 단계 재시도
              </button>
            )}
          </section>
        )}
        <div className="phase4-purpose-tabs" role="tablist" aria-label="자료 수집 목적">
          {(["hypothesis", "excel"] as Purpose[]).map((item, index, items) => (
            <button
              type="button"
              role="tab"
              aria-selected={purpose === item}
              aria-controls={`phase4-${item}-panel`}
              tabIndex={purpose === item ? 0 : -1}
              className={purpose === item ? "active" : ""}
              onClick={() => setPurpose(item)}
              onKeyDown={(event) => {
                const direction =
                  event.key === "ArrowRight"
                    ? 1
                    : event.key === "ArrowLeft"
                      ? -1
                      : 0;
                if (!direction) return;
                event.preventDefault();
                const next = items[(index + direction + items.length) % items.length];
                setPurpose(next);
                event.currentTarget.parentElement
                  ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
                  [items.indexOf(next)]?.focus();
              }}
              key={item}
            >
              <i>{item === "hypothesis" ? "01" : "02"}</i>
              <span>
                <small>{item === "hypothesis" ? "HYPOTHESIS" : "EXCEL"}</small>
                <strong>
                  {item === "hypothesis"
                    ? "가설 확인을 위한 자료 수집"
                    : "입력값 삽입을 위한 자료 수집"}
                </strong>
              </span>
            </button>
          ))}
        </div>
        {purpose === "hypothesis" ? (
          <section
            id="phase4-hypothesis-panel"
            role="tabpanel"
            className="phase4-plan-panel"
          >
            <div className="phase4-plan-guide">
              <p>
                자료를 수집할 질문과 출처를 확인하세요. 위 설정은 일괄
                적용하고 필요한 질문만 개별 조정할 수 있습니다.
              </p>
            </div>
            <div className="phase4-source-summary">
              <div>
                <span>포함 질문</span>
                <strong>{includedCount}개</strong>
              </div>
              <button
                type="button"
                disabled={activeJob || includedCount === 0}
                onClick={() => openSources("bulk")}
              >
                출처 일괄 설정
              </button>
            </div>
            <div className="phase4-question-list">
              {workspace.plan.questions.map((question, index) => (
                <article
                  className={`phase4-question-card ${
                    question.included ? "" : "excluded"
                  }`}
                  key={question.questionId}
                  data-question-id={question.questionId}
                >
                  <header>
                    <label>
                      <input
                        type="checkbox"
                        checked={question.included}
                        disabled={activeJob}
                        onChange={(event) =>
                          void saveChanges([
                            {
                              op: "set_question_included",
                              questionId: question.questionId,
                              included: event.target.checked,
                            },
                          ]).catch(() => undefined)
                        }
                      />
                      <i aria-hidden="true">{question.included ? "✓" : ""}</i>
                      <span>
                        <strong>
                          {String(index + 1).padStart(2, "0")}. {question.text}
                        </strong>
                        <small>
                          {question.included
                            ? "이 질문으로 자료 수집"
                            : "자료 수집 안 함"}
                        </small>
                      </span>
                    </label>
                  </header>
                  <dl>
                    <div>
                      <dt>확인할 근거</dt>
                      <dd>
                        {question.collectionTargets.map((target) => (
                          <span key={target.label}>{target.label}</span>
                        ))}
                      </dd>
                    </div>
                    <div>
                      <dt>기간 · 비교</dt>
                      <dd>
                        {question.period} · {question.comparison}
                      </dd>
                    </div>
                    <div>
                      <dt>출처 · 수집 방식</dt>
                      <dd>
                        {question.sourceBindingIds.map((source) => (
                          <span key={source}>
                            {sourceLabels.get(source)} ·{" "}
                            {methodLabel(
                              question.collectionMethods[source],
                              source,
                            )}
                          </span>
                        ))}
                      </dd>
                    </div>
                  </dl>
                  {question.validationErrors.length > 0 && (
                    <p className="phase4-card-error" role="alert">
                      {question.validationErrors.join(" ")}
                    </p>
                  )}
                  <footer>
                    <button
                      type="button"
                      disabled={!question.included || activeJob}
                      onClick={() =>
                        openSources(
                          { questionId: question.questionId },
                          question,
                        )
                      }
                    >
                      출처 조정
                    </button>
                  </footer>
                </article>
              ))}
            </div>
            <section className="phase4-materials">
              <header>
                <div>
                  <h2>사용자 제공 원문</h2>
                  <p>
                    기업 IR은 공식 PDF를 올리거나 공식 IR URL을 연결해야
                    합니다. 등록한 유형과 출처 권위는 Evidence에 그대로
                    기록됩니다.
                  </p>
                </div>
                <span>
                  {
                    workspace.plan.sourceReferences.filter(
                      (reference) =>
                        reference.ingestionMethod === "user_upload",
                    ).length
                  }{" "}
                  / {workspace.policy.fileLimit} PDF ·{" "}
                  {
                    workspace.plan.sourceReferences.filter(
                      (reference) => reference.ingestionMethod === "user_url",
                    ).length
                  }{" "}
                  / {workspace.policy.urlLimit} URL
                </span>
              </header>
              <div className="phase4-material-form">
                <label>
                  자료 유형
                  <select
                    value={materialType}
                    disabled={activeJob || materialSaving}
                    onChange={(event) => {
                      const next = event.target
                        .value as ResearchSourceReference["sourceType"];
                      setMaterialType(next);
                      if (next === "NEWS") setMaterialMethod("user_url");
                      setSaveState("idle");
                    }}
                  >
                    <option value="COMPANY_IR">기업 IR</option>
                    <option value="NEWS">뉴스 원문</option>
                    <option value="USER_MATERIAL">사용자 자료</option>
                  </select>
                </label>
                <label>
                  자료명
                  <input
                    value={materialTitle}
                    disabled={activeJob || materialSaving}
                    maxLength={200}
                    onChange={(event) => {
                      setMaterialTitle(event.target.value);
                      setSaveState("idle");
                    }}
                    placeholder="2026년 2분기 실적발표 자료"
                  />
                </label>
                <label>
                  발행일
                  <input
                    type="date"
                    value={materialPublishedAt}
                    max={workspace.project.cutoffDate}
                    required={materialType !== "USER_MATERIAL"}
                    disabled={activeJob || materialSaving}
                    onChange={(event) => {
                      setMaterialPublishedAt(event.target.value);
                      setSaveState("idle");
                    }}
                  />
                </label>
                <fieldset>
                  <legend>연결 방식</legend>
                  <label>
                    <input
                      type="radio"
                      name="material-method"
                      value="user_upload"
                      checked={materialMethod === "user_upload"}
                      disabled={
                        activeJob || materialSaving || materialType === "NEWS"
                      }
                      onChange={() => {
                        setMaterialMethod("user_upload");
                        setSaveState("idle");
                      }}
                    />
                    PDF 업로드
                  </label>
                  <label>
                    <input
                      type="radio"
                      name="material-method"
                      value="user_url"
                      checked={materialMethod === "user_url"}
                      disabled={activeJob || materialSaving}
                      onChange={() => {
                        setMaterialMethod("user_url");
                        setSaveState("idle");
                      }}
                    />
                    공식 URL
                  </label>
                </fieldset>
                {materialMethod === "user_upload" ? (
                  <label>
                    PDF 파일
                    <input
                      ref={materialFileInputRef}
                      type="file"
                      accept="application/pdf,.pdf"
                      disabled={activeJob || materialSaving}
                      onChange={(event) => {
                        setMaterialFile(event.target.files?.[0] ?? null);
                        setSaveState("idle");
                      }}
                    />
                  </label>
                ) : (
                  <label>
                    공식 원문 URL
                    <input
                      type="url"
                      value={materialUrl}
                      disabled={activeJob || materialSaving}
                      onChange={(event) => {
                        setMaterialUrl(event.target.value);
                        setSaveState("idle");
                      }}
                      placeholder="https://company.example.com/ir/document.pdf"
                    />
                  </label>
                )}
              </div>
              <button
                type="button"
                disabled={activeJob || materialSaving}
                onClick={() => void saveMaterial()}
              >
                {materialSaving ? "보안 검사 중" : "자료 연결"}
              </button>
              {workspace.plan.sourceReferences.length > 0 && (
                <ul className="phase4-material-list">
                  {workspace.plan.sourceReferences.map((reference) => (
                    <li key={reference.referenceId}>
                      <div>
                        <strong>
                          {reference.sourceType === "COMPANY_IR"
                            ? "사용자 제공 기업 IR"
                            : reference.sourceType === "NEWS"
                              ? "사용자 제공 뉴스 원문"
                              : "사용자 제공 자료"}
                        </strong>
                        <span>{reference.title}</span>
                        <small>
                          {reference.ingestionMethod === "user_upload"
                            ? reference.originalFilename
                            : reference.canonicalUrl}
                          {reference.publishedAt
                            ? ` · ${new Date(reference.publishedAt).toLocaleDateString("ko-KR")}`
                            : ""}
                        </small>
                      </div>
                      <button
                        type="button"
                        disabled={activeJob || materialSaving}
                        onClick={() => void removeMaterial(reference.referenceId)}
                      >
                        제거
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </section>
        ) : (
          <section
            id="phase4-excel-panel"
            role="tabpanel"
            className="phase4-plan-panel"
          >
            <div className="phase4-plan-guide">
              <p>
                실제값 입력 대상의 기간·단위·연결/별도 기준과 출처를
                확인하세요. 미래 추정치는 자동 수집하지 않습니다.
              </p>
            </div>
            <div className="phase4-excel-list">
              {workspace.plan.excelTargets.length === 0 ? (
                <div className="phase4-empty">
                  공식 자료로 채울 Excel 실제값 대상이 없습니다.
                </div>
              ) : (
                workspace.plan.excelTargets.map((target) => (
                  <article key={target.targetId}>
                    <header>
                      <span>
                        {target.sheetName}!{target.address}
                      </span>
                      <strong>{target.metric}</strong>
                      <em>{target.required ? "필수 수집" : "선택 수집"}</em>
                    </header>
                    <dl>
                      <div>
                        <dt>기간</dt>
                        <dd>{target.period}</dd>
                      </div>
                      <div>
                        <dt>단위 · 기준</dt>
                        <dd>
                          {target.unit} · {target.scope}
                        </dd>
                      </div>
                      <div>
                        <dt>출처 정책</dt>
                        <dd>
                          {target.sourcePolicy
                            .map(
                              (policy) =>
                                `${sourceLabels.get(policy.sourceType)} · ${
                                  policy.role === "authority"
                                    ? "권위"
                                    : policy.role === "verification"
                                      ? "검증"
                                      : "비교"
                                }`,
                            )
                            .join(", ")}
                        </dd>
                      </div>
                    </dl>
                    {!target.required && (
                      <label>
                        <input
                          type="checkbox"
                          checked={target.included}
                          disabled={activeJob}
                          onChange={(event) =>
                            void saveChanges([
                              {
                                op: "set_excel_target_included",
                                targetId: target.targetId,
                                included: event.target.checked,
                              },
                            ]).catch(() => undefined)
                          }
                        />
                        이 실제값 수집
                      </label>
                    )}
                  </article>
                ))
              )}
            </div>
          </section>
        )}
        {!workspace.plan.validationSummary.valid && (
          <section className="phase4-blockers" role="alert">
            <strong>계획 차단 항목</strong>
            <ul>
              {workspace.plan.validationSummary.issues.map((issue, index) => (
                <li key={`${issue.code}-${issue.targetId}-${index}`}>
                  {issue.message}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
      {sourceTarget && (
        <div
          className="phase4-dialog-backdrop"
          onMouseDown={(event) =>
            event.target === event.currentTarget && setSourceTarget(null)
          }
        >
          <div
            className="phase4-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="phase4-source-title"
            ref={sourceDialogRef}
            onKeyDown={(event) => {
              if (event.key === "Escape") setSourceTarget(null);
            }}
          >
            <header>
              <div>
                <small>SOURCE SETTING</small>
                <h2 id="phase4-source-title">
                  {sourceTarget === "bulk" ? "출처 일괄 설정" : "질문 출처 조정"}
                </h2>
              </div>
              <button
                type="button"
                aria-label="출처 설정 닫기"
                onClick={() => setSourceTarget(null)}
              >
                ×
              </button>
            </header>
            <div className="phase4-source-options">
              {workspace.sourceOptions.map((option) => (
                <label key={option.sourceType}>
                  <input
                    type="checkbox"
                    checked={sourceDraft.includes(option.sourceType)}
                    onChange={(event) =>
                      setSourceDraft((current) =>
                        event.target.checked
                          ? [...current, option.sourceType]
                          : current.filter((item) => item !== option.sourceType),
                      )
                    }
                  />
                  <i>{sourceDraft.includes(option.sourceType) ? "✓" : ""}</i>
                  <span>
                    <strong>{option.label}</strong>
                    <small>{option.description}</small>
                  </span>
                </label>
              ))}
            </div>
            <footer>
              <button type="button" onClick={() => setSourceTarget(null)}>
                취소
              </button>
              <button
                type="button"
                className="primary"
                disabled={sourceDraft.length === 0 || saveState === "saving"}
                onClick={() => void saveSources()}
              >
                설정 저장
              </button>
            </footer>
          </div>
        </div>
      )}
      {approvalOpen && (
        <div className="phase4-dialog-backdrop">
          <div
            className="phase4-dialog phase4-approval-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="phase4-approval-title"
          >
            <header>
              <div>
                <small>계획 승인</small>
                <h2 id="phase4-approval-title">자료 조사 준비 완료</h2>
              </div>
              <button
                type="button"
                aria-label="계획 승인 닫기"
                disabled={starting}
                onClick={() => setApprovalOpen(false)}
              >
                ×
              </button>
            </header>
            <p>
              현재 질문·Excel 대상·출처와 입력 version을 불변 snapshot으로
              승인하고 자료 수집을 시작합니다.
            </p>
            <dl>
              <div>
                <dt>가설 질문</dt>
                <dd>{includedCount}개</dd>
              </div>
              <div>
                <dt>Excel 실제값</dt>
                <dd>
                  {
                    workspace.plan.excelTargets.filter((target) => target.included)
                      .length
                  }
                  개
                </dd>
              </div>
              <div>
                <dt>계획 version</dt>
                <dd>v{workspace.plan.version}</dd>
              </div>
            </dl>
            <footer>
              <button
                type="button"
                className="primary"
                disabled={starting}
                onClick={() => void startResearch()}
              >
                {starting ? "수집 작업 시작 중" : "자료 수집 시작"}
              </button>
            </footer>
          </div>
        </div>
      )}
    </ProcessShell>
  );
}
