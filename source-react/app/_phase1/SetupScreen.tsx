"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { apiJson, ClientApiError, googleLoginUrl } from "./api";
import type {
  CompanySearchItem,
  SetupBootstrap,
  ValuationMethod,
} from "./types";
import { useSession } from "./useSession";

type FormState = {
  company: CompanySearchItem | null;
  companyQuery: string;
  year: string;
  quarter: string;
  cutoffDate: string;
  valuationMethod: ValuationMethod;
};

type SaveResponse = {
  projectVersion: number;
  setupVersion: number;
  savedAt: string;
  setupStatus: string;
  complete: boolean;
  invalidatedStages: string[];
};

const stageLabels: Record<string, { no: string; title: string; short: string }> = {
  setup: { no: "01", title: "프로젝트 설정", short: "기업·분기·기준일" },
  files: { no: "02", title: "파일 업로드·검사", short: "PDF·Excel 적합성" },
  hypothesis: { no: "03", title: "투자 의견·조사 질문", short: "가설과 검증 질문" },
  research_plan: { no: "04", title: "자료 수집 및 계획", short: "조사 항목과 출처" },
  validation: { no: "05", title: "조사 결과 검증", short: "원문과 수치 확인" },
  valuation: { no: "06", title: "PER 밸류에이션", short: "목표 PER와 주가" },
  report_outline: { no: "07", title: "페이지 내용 설정", short: "보고서 구성 확정" },
};

function formPayload(form: FormState) {
  return {
    companyId: form.company?.companyId ?? null,
    targetPeriod:
      form.year && form.quarter
        ? { year: Number(form.year), quarter: Number(form.quarter) }
        : null,
    cutoffDate: form.cutoffDate || null,
    valuationMethod: form.valuationMethod,
  };
}

function formHash(form: FormState): string {
  return JSON.stringify(formPayload(form));
}

export function SetupScreen({ projectId }: { projectId: string }) {
  const { session } = useSession();
  const router = useRouter();
  const [bootstrap, setBootstrap] = useState<SetupBootstrap | null>(null);
  const [form, setForm] = useState<FormState>({
    company: null,
    companyQuery: "",
    year: "",
    quarter: "",
    cutoffDate: "",
    valuationMethod: "PER",
  });
  const [candidates, setCandidates] = useState<CompanySearchItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [activeCandidate, setActiveCandidate] = useState(0);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const [lastSavedHash, setLastSavedHash] = useState("");
  const [pageError, setPageError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [conflict, setConflict] = useState(false);
  const [invalidation, setInvalidation] = useState<{
    form: FormState;
    affectedStages: string[];
    action: "save" | "complete";
  } | null>(null);
  const [completing, setCompleting] = useState(false);
  const projectVersionRef = useRef(0);
  const lastSavedHashRef = useRef("");
  const saveChainRef = useRef<Promise<void>>(Promise.resolve());
  const latestFormRef = useRef(form);
  const completeKeyRef = useRef(crypto.randomUUID());

  useEffect(() => {
    latestFormRef.current = form;
  }, [form]);

  const load = useCallback(async () => {
    if (session.status !== "authenticated") return;
    setPageError("");
    try {
      const response = await apiJson<SetupBootstrap>(
        `/api/projects/${projectId}/process/setup`,
      );
      setBootstrap(response);
      projectVersionRef.current = response.project.version;
      const nextForm: FormState = {
        company: response.setup.company,
        companyQuery: response.setup.company?.name ?? "",
        year: response.setup.targetPeriod?.year.toString() ?? "",
        quarter: response.setup.targetPeriod?.quarter.toString() ?? "",
        cutoffDate: response.setup.cutoffDate ?? "",
        valuationMethod: response.setup.valuationMethod,
      };
      setForm(nextForm);
      lastSavedHashRef.current = formHash(nextForm);
      setLastSavedHash(formHash(nextForm));
      setSaveState("saved");
    } catch (error) {
      if (error instanceof ClientApiError && error.status === 401) {
        window.location.href = googleLoginUrl(
          `/projects/${projectId}/process/setup`,
        );
        return;
      }
      if (error instanceof ClientApiError && error.status === 404) {
        setPageError("프로젝트를 찾을 수 없습니다. 본인이 소유한 프로젝트인지 확인해주세요.");
        return;
      }
      setPageError(error instanceof Error ? error.message : "설정을 불러오지 못했습니다.");
    }
  }, [projectId, session.status]);

  useEffect(() => {
    if (session.status === "anonymous") {
      window.location.href = googleLoginUrl(
        `/projects/${projectId}/process/setup`,
      );
      return;
    }
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load, projectId, session.status]);

  useEffect(() => {
    if (session.status !== "authenticated" || !bootstrap) return;
    const query = form.companyQuery.trim();
    if (form.company || query.length < 1) {
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setSearching(true);
      try {
        const response = await apiJson<{ items: CompanySearchItem[] }>(
          `/api/companies/search?q=${encodeURIComponent(query)}&limit=10`,
          { signal: controller.signal },
        );
        setCandidates(response.items);
        setActiveCandidate(0);
      } catch (error) {
        if ((error as Error).name !== "AbortError") {
          setFieldErrors((current) => ({
            ...current,
            companyId: "기업 검색에 실패했습니다. 다시 입력해주세요.",
          }));
        }
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [bootstrap, form.company, form.companyQuery, session.status]);

  const enqueueSave = useCallback(
    (snapshot: FormState, confirmDownstreamInvalidation = false) => {
      if (session.status !== "authenticated" || !bootstrap) {
        return Promise.resolve();
      }
      const snapshotHash = formHash(snapshot);
      saveChainRef.current = saveChainRef.current.then(async () => {
        if (
          snapshotHash === lastSavedHashRef.current &&
          !confirmDownstreamInvalidation
        ) {
          return;
        }
        setSaveState("saving");
        setConflict(false);
        setFieldErrors({});
        try {
          const response = await apiJson<SaveResponse>(
            `/api/projects/${projectId}/process/setup`,
            {
              method: "PATCH",
              headers: {
                "Content-Type": "application/json",
                "X-CSRF-Token": session.csrfToken,
              },
              body: JSON.stringify({
                projectVersion: projectVersionRef.current,
                setup: formPayload(snapshot),
                confirmDownstreamInvalidation,
              }),
            },
          );
          projectVersionRef.current = response.projectVersion;
          lastSavedHashRef.current = snapshotHash;
          setLastSavedHash(snapshotHash);
          setSaveState("saved");
          setBootstrap((current) =>
            current
              ? {
                  ...current,
                  project: { ...current.project, version: response.projectVersion },
                  setup: { ...current.setup, version: response.setupVersion },
                }
              : current,
          );
        } catch (error) {
          if (error instanceof ClientApiError) {
            if (error.body.error.code === "STALE_PROJECT_VERSION") {
              setConflict(true);
              setSaveState("failed");
              return;
            }
            if (
              error.body.error.code ===
              "DOWNSTREAM_INVALIDATION_CONFIRMATION_REQUIRED"
            ) {
              setInvalidation({
                form: snapshot,
                affectedStages:
                  (error.body.error.meta.affectedStages as string[]) ?? [],
                action: "save",
              });
              setSaveState("failed");
              return;
            }
            const nextErrors: Record<string, string> = {};
            for (const detail of error.body.error.details) {
              nextErrors[detail.path.replace("setup.", "")] = detail.message;
            }
            setFieldErrors(nextErrors);
          }
          setSaveState("failed");
        }
      });
      return saveChainRef.current;
    },
    [bootstrap, projectId, session],
  );

  useEffect(() => {
    if (!bootstrap || formHash(form) === lastSavedHashRef.current) return;
    const timer = window.setTimeout(() => {
      void enqueueSave(form);
    }, 600);
    return () => window.clearTimeout(timer);
  }, [bootstrap, enqueueSave, form]);

  const selectCompany = (company: CompanySearchItem) => {
    if (!company.mvpEligible) return;
    setForm((current) => ({
      ...current,
      company,
      companyQuery: company.name,
    }));
    setCandidates([]);
    setFieldErrors((current) => ({ ...current, companyId: "" }));
  };

  const complete = useCallback(
    async (confirmDownstreamInvalidation = false) => {
      if (session.status !== "authenticated" || !bootstrap) return;
      const current = latestFormRef.current;
      const errors: Record<string, string> = {};
      if (!current.company) errors.companyId = "기업을 선택해주세요.";
      if (!current.year || !current.quarter) errors.targetPeriod = "연도와 분기를 선택해주세요.";
      if (!current.cutoffDate) errors.cutoffDate = "보고서 기준일을 선택해주세요.";
      if (!current.valuationMethod) {
        errors.valuationMethod = "밸류에이션 모델을 선택해주세요.";
      }
      if (Object.keys(errors).length > 0) {
        setFieldErrors(errors);
        document.querySelector<HTMLElement>("[aria-invalid='true']")?.focus();
        return;
      }

      setCompleting(true);
      try {
        await enqueueSave(current, confirmDownstreamInvalidation);
        if (formHash(current) !== lastSavedHashRef.current) return;
        const response = await apiJson<{ currentRoute: string }>(
          `/api/projects/${projectId}/process/setup/complete`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-CSRF-Token": session.csrfToken,
              "Idempotency-Key": completeKeyRef.current,
            },
            body: JSON.stringify({
              projectVersion: projectVersionRef.current,
              setup: formPayload(current),
              confirmDownstreamInvalidation,
            }),
          },
        );
        router.push(response.currentRoute);
      } catch (error) {
        if (error instanceof ClientApiError) {
          if (error.body.error.code === "STALE_PROJECT_VERSION") {
            setConflict(true);
          } else if (
            error.body.error.code ===
            "DOWNSTREAM_INVALIDATION_CONFIRMATION_REQUIRED"
          ) {
            setInvalidation({
              form: current,
              affectedStages:
                (error.body.error.meta.affectedStages as string[]) ?? [],
              action: "complete",
            });
          } else {
            const nextErrors: Record<string, string> = {};
            for (const detail of error.body.error.details) {
              nextErrors[detail.path.replace("setup.", "")] = detail.message;
            }
            setFieldErrors(nextErrors);
            setPageError(error.message);
          }
        } else {
          setPageError("설정을 완료하지 못했습니다. 입력값은 유지됩니다.");
        }
      } finally {
        setCompleting(false);
      }
    },
    [bootstrap, enqueueSave, projectId, router, session],
  );

  const canComplete = Boolean(
    form.company &&
      form.year &&
      form.quarter &&
      form.cutoffDate &&
      form.valuationMethod,
  );
  const displayedSaveState =
    formHash(form) !== lastSavedHash && saveState === "saved"
      ? "idle"
      : saveState;
  const workflowProgress = bootstrap
    ? Math.round(
        (bootstrap.workflow.stageStates.filter((stage) => stage.status === "completed").length /
          7) *
          100,
      )
    : 0;

  if (pageError && !bootstrap) {
    return (
      <div className="phase1-page-error">
        <strong>프로젝트 설정을 열 수 없습니다.</strong>
        <p>{pageError}</p>
        <div>
          <button onClick={() => router.push("/projects")}>프로젝트 목록</button>
          <button onClick={() => void load()}>다시 시도</button>
        </div>
      </div>
    );
  }

  if (!bootstrap) {
    return (
      <div className="phase1-page-loading" aria-label="프로젝트 설정 불러오는 중">
        <i className="phase1-spinner" />
        <strong>프로젝트 설정을 불러오고 있습니다.</strong>
      </div>
    );
  }

  return (
    <div className="planned-process-page phase1-setup-page">
      <header className="spec-app-header">
        <button className="spec-back-project" onClick={() => router.push("/projects")}>
          <span>‹</span> 프로젝트로 돌아가기
        </button>
        <nav>
          <button className="active">Process</button>
          <button disabled aria-disabled="true">
            Report
          </button>
        </nav>
        <div className="spec-project-context">
          {form.cutoffDate && (
            <span>
              <b>보고서 기준일</b>
              <small>{form.cutoffDate}</small>
            </span>
          )}
        </div>
      </header>
      <div className="spec-workspace">
        <aside className="spec-sidebar">
          <div className="spec-sidebar-project">
            <span>RESEARCH PROJECT</span>
            <strong>{bootstrap.project.name}</strong>
            <small>
              {form.company
                ? `${form.company.ticker} · ${form.year && form.quarter ? `${form.year}년 ${form.quarter}분기` : "기간 미선택"}`
                : "기업을 선택해주세요"}
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
              {bootstrap.workflow.stageStates.map((stage) => {
                const label = stageLabels[stage.stageKey];
                const active = stage.stageKey === "setup";
                const accessible = bootstrap.workflow.allowedRoutes.includes(stage.route);
                return (
                  <button
                    key={stage.stageKey}
                    className={`${active ? "active" : ""} ${stage.status === "completed" ? "done" : ""}`}
                    disabled={!accessible || active}
                    aria-disabled={!accessible || active}
                    onClick={() => accessible && router.push(stage.route)}
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
                    {active && <em />}
                  </button>
                );
              })}
            </section>
          </nav>
        </aside>
        <main className="spec-main">
          <div className="spec-screen spec-project-setup phase1-project-setup">
            <div className="spec-screen-head">
              <div>
                <span>STEP 01</span>
                <h1>기업 · 작성 정보 입력</h1>
                <p>분석할 기업과 기간을 정하고, 리서치에 사용할 기준을 저장합니다.</p>
              </div>
            </div>
            {conflict && (
              <section className="phase1-conflict-banner" role="alert">
                <div>
                  <strong>다른 탭에서 설정이 변경되었습니다.</strong>
                  <p>최신 설정을 불러온 뒤 현재 변경을 다시 적용해주세요. 자동 덮어쓰기는 하지 않습니다.</p>
                </div>
                <button onClick={() => void load()}>최신 설정 불러오기</button>
              </section>
            )}
            {pageError && (
              <section className="phase1-inline-error" role="alert">
                {pageError}
              </section>
            )}
            <section className="spec-panel spec-project-form">
              <div className="spec-field full phase1-company-field">
                <label htmlFor="company-search">
                  기업명 <b>*</b>
                </label>
                <div className={`spec-company-search ${form.company ? "selected" : ""}`}>
                  <span>⌕</span>
                  <input
                    id="company-search"
                    value={form.companyQuery}
                    onChange={(event) =>
                      {
                        setCandidates([]);
                        setForm((current) => ({
                          ...current,
                          company: null,
                          companyQuery: event.target.value,
                        }));
                      }
                    }
                    onKeyDown={(event) => {
                      if (event.key === "ArrowDown") {
                        event.preventDefault();
                        setActiveCandidate((current) =>
                          Math.min(candidates.length - 1, current + 1),
                        );
                      } else if (event.key === "ArrowUp") {
                        event.preventDefault();
                        setActiveCandidate((current) => Math.max(0, current - 1));
                      } else if (event.key === "Enter" && candidates[activeCandidate]) {
                        event.preventDefault();
                        selectCompany(candidates[activeCandidate]);
                      } else if (event.key === "Escape") {
                        setCandidates([]);
                      }
                    }}
                    placeholder="기업명 또는 종목코드를 입력하세요"
                    autoFocus
                    maxLength={40}
                    role="combobox"
                    aria-autocomplete="list"
                    aria-controls="company-results"
                    aria-expanded={candidates.length > 0}
                    aria-haspopup="listbox"
                    aria-invalid={Boolean(fieldErrors.companyId)}
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setForm((current) => ({
                        ...current,
                        company: null,
                        companyQuery: current.companyQuery.trim(),
                      }))
                    }
                  >
                    {searching ? "검색 중" : "검색"}
                  </button>
                </div>
                {fieldErrors.companyId && (
                  <p className="phase1-field-error" role="alert">
                    {fieldErrors.companyId}
                  </p>
                )}
                {!form.company && form.companyQuery.trim() && (
                  <div
                    id="company-results"
                    className="spec-company-results"
                    role="listbox"
                    aria-label="기업 검색 결과"
                  >
                    <small>
                      {searching
                        ? "기업 검색 중"
                        : candidates.length
                          ? `${candidates.length}개 기업`
                          : "검색 결과가 없습니다"}
                    </small>
                    {candidates.map((item, index) => (
                      <button
                        key={item.companyId}
                        type="button"
                        role="option"
                        aria-selected={index === activeCandidate}
                        className={index === activeCandidate ? "is-active" : ""}
                        disabled={!item.mvpEligible}
                        onMouseEnter={() => setActiveCandidate(index)}
                        onClick={() => selectCompany(item)}
                      >
                        <i>{item.name.slice(0, 1)}</i>
                        <span>
                          <strong>{item.name}</strong>
                          <small>
                            {item.ticker} · {item.exchange} · {item.industry}
                          </small>
                          {!item.mvpEligible && <em>{item.ineligibilityReason}</em>}
                        </span>
                        <b>{item.mvpEligible ? "선택" : "미지원"}</b>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {form.company ? (
                <>
                  <div className="spec-company-meta-grid phase1-company-meta">
                    <div className="spec-field">
                      <label>종목코드</label>
                      <div className="phase1-readonly-value">{form.company.ticker}</div>
                    </div>
                    <div className="spec-field">
                      <label>거래소</label>
                      <div className="phase1-readonly-value">{form.company.exchange}</div>
                    </div>
                  </div>
                  <div className="spec-form-grid">
                    <div className="spec-field">
                      <label htmlFor="target-year">
                        분석 대상 연도 <b>*</b>
                      </label>
                      <select
                        id="target-year"
                        value={form.year}
                        onChange={(event) =>
                          setForm((current) => ({ ...current, year: event.target.value }))
                        }
                        aria-invalid={Boolean(fieldErrors.targetPeriod)}
                      >
                        <option value="">연도 선택</option>
                        {bootstrap.supportedTargetYears.map((year) => (
                          <option key={year} value={year}>
                            {year}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="spec-field">
                      <label htmlFor="target-quarter">
                        분기 <b>*</b>
                      </label>
                      <select
                        id="target-quarter"
                        value={form.quarter}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            quarter: event.target.value,
                          }))
                        }
                        aria-invalid={Boolean(fieldErrors.targetPeriod)}
                      >
                        <option value="">분기 선택</option>
                        {[1, 2, 3, 4].map((quarter) => (
                          <option key={quarter} value={quarter}>
                            {quarter}분기
                          </option>
                        ))}
                      </select>
                      {fieldErrors.targetPeriod && (
                        <p className="phase1-field-error" role="alert">
                          {fieldErrors.targetPeriod}
                        </p>
                      )}
                    </div>
                    <div className="spec-field">
                      <label htmlFor="cutoff-date">
                        보고서 기준일 <b>*</b>
                      </label>
                      <input
                        id="cutoff-date"
                        type="date"
                        value={form.cutoffDate}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            cutoffDate: event.target.value,
                          }))
                        }
                        aria-invalid={Boolean(fieldErrors.cutoffDate)}
                      />
                      {fieldErrors.cutoffDate && (
                        <p className="phase1-field-error" role="alert">
                          {fieldErrors.cutoffDate}
                        </p>
                      )}
                    </div>
                  </div>
                  <section className="phase1-fixed-scope" aria-label="분석 범위">
                    <div>
                      <span>리포트 유형</span>
                      <strong>실적 Review</strong>
                    </div>
                    <div>
                      <span>기업 분야</span>
                      <strong>{form.company.industry}</strong>
                    </div>
                    <div className="phase1-valuation-field">
                      <label htmlFor="valuation-method">
                        밸류에이션 모델 <b>*</b>
                      </label>
                      <select
                        id="valuation-method"
                        value={form.valuationMethod}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            valuationMethod: event.target.value as ValuationMethod,
                          }))
                        }
                        aria-invalid={Boolean(fieldErrors.valuationMethod)}
                      >
                        <option value="PER">PER</option>
                        <option value="PBR">PBR</option>
                        <option value="EV_EBITDA">EV/EBITDA</option>
                        <option value="DCF">DCF</option>
                      </select>
                      {fieldErrors.valuationMethod && (
                        <p className="phase1-field-error" role="alert">
                          {fieldErrors.valuationMethod}
                        </p>
                      )}
                    </div>
                  </section>
                  <p className="spec-info-note">
                    기업 분야는 선택 기업의 KRX 업종을 따르며, 밸류에이션 모델은 이후 계산 기준으로 사용됩니다.
                  </p>
                </>
              ) : (
                <div className="spec-empty-state">
                  <i>01</i>
                  <div>
                    <strong>기업 선택이 먼저 필요합니다.</strong>
                    <p>기업명 또는 종목코드 일부를 입력한 뒤 지원 기업을 선택하세요.</p>
                  </div>
                </div>
              )}
            </section>
          </div>
        </main>
      </div>
      <footer className="spec-bottom-bar phase1-setup-footer">
        <div>
          <span className={`spec-saved phase1-save-state ${displayedSaveState}`}>
            <i />
            {displayedSaveState === "saving"
              ? "저장 중"
              : displayedSaveState === "failed"
                ? "저장 실패"
                : displayedSaveState === "saved"
                  ? "자동 저장됨"
                  : "변경 대기"}
          </span>
          {displayedSaveState === "failed" && !conflict && (
            <button onClick={() => void enqueueSave(latestFormRef.current)}>다시 저장</button>
          )}
          <button
            className="spec-next"
            disabled={!canComplete || completing || displayedSaveState === "saving"}
            onClick={() => void complete()}
          >
            {completing ? "완료 처리 중" : "설정 완료"} <b aria-hidden="true">›</b>
          </button>
        </div>
      </footer>
      {invalidation && (
        <div
          className="phase1-modal-backdrop"
          onMouseDown={(event) => event.target === event.currentTarget && setInvalidation(null)}
        >
          <section
            className="phase1-invalidation-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="invalidation-title"
          >
            <header>
              <span>REVALIDATION REQUIRED</span>
              <h2 id="invalidation-title">이후 단계의 재검증이 필요합니다.</h2>
              <p>기존 파일과 결과는 삭제하지 않고 재검증 필요 상태로 전환합니다.</p>
            </header>
            <ul>
              {invalidation.affectedStages.map((stage) => (
                <li key={stage}>{stageLabels[stage]?.title ?? stage}</li>
              ))}
            </ul>
            <footer>
              <button onClick={() => setInvalidation(null)}>취소</button>
              <button
                className="confirm"
                onClick={() => {
                  const pending = invalidation;
                  setInvalidation(null);
                  if (pending.action === "save") {
                    void enqueueSave(pending.form, true);
                  } else {
                    void complete(true);
                  }
                }}
              >
                변경 계속
              </button>
            </footer>
          </section>
        </div>
      )}
    </div>
  );
}
