"use client";

import dynamic from "next/dynamic";
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
import { ProcessShell } from "../_phase4/ProcessShell";
import type {
  CellPatchResult,
  Sensitivity,
  ValuationWorkspace,
  WorkbookReadModel,
} from "./types";

const WorkbookGrid = dynamic(() => import("./ValuationWorkbook"), {
  ssr: false,
  loading: () => (
    <div className="phase5-grid-skeleton" aria-label="Excel 불러오는 중" />
  ),
});

type Tab = "excel" | "decision";
type Change = {
  sheetId: string;
  address: string;
  valueType: "number" | "string" | "boolean" | "blank";
  value: string | null;
};

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "요청을 처리하지 못했습니다. 다시 시도해주세요.";
}

function grouped(value: string): string {
  const [integer, decimal] = value.split(".");
  const sign = integer.startsWith("-") ? "-" : "";
  const digits = sign ? integer.slice(1) : integer;
  const formatted = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign}${formatted}${decimal ? `.${decimal}` : ""}`;
}

function targetPerValidation(value: string): string {
  if (!/^\d+(?:\.\d)?$/.test(value)) {
    return "0.1~100.0 사이 값을 소수 첫째 자리까지 입력해주세요.";
  }
  const number = Number(value);
  return number >= 0.1 && number <= 100
    ? ""
    : "Target PER은 0.1~100.0배 범위입니다.";
}

function targetPriceValidation(value: string): string {
  const canonical = value.replaceAll(",", "");
  return /^[1-9]\d*$/.test(canonical) &&
    Number(canonical) <= 1_000_000_000
    ? ""
    : "목표주가는 1원~10억원 사이 정수로 입력해주세요.";
}

const blockerLabels: Record<string, string> = {
  VALUATION_PREREQUISITE_CHANGED: "선행 검증 결과가 변경되었습니다.",
  CALCULATION_NOT_CURRENT: "최신 Excel 계산이 필요합니다.",
  VALUATION_OUTPUT_INVALID: "EPS·PER·목표주가 계산값을 확인해주세요.",
  REQUIRED_INPUT_MISSING: "필수 추정 셀을 입력해주세요.",
  VALUATION_DRAFT_REQUIRED: "Target PER 또는 목표주가를 반영해주세요.",
  DRAFT_REVALIDATION_REQUIRED: "변경된 Excel 값으로 결정을 다시 반영해주세요.",
  DRAFT_OUTPUT_MISMATCH: "결정값과 최신 Excel 계산값이 다릅니다.",
  VALUATION_NOT_APPROVED: "최신 입력값 승인이 필요합니다.",
};

const impactLabels: Record<string, string> = {
  forward_eps_driver: "EPS 영향",
  target_per_driver: "PER 영향",
  target_price_driver: "목표주가 영향",
  report_table_driver: "보고서 전용",
  source_metadata: "출처·메모",
  inactive_branch: "현재 계산 미사용",
  unmapped: "계산 연결 미확인",
};

export function ValuationScreen({ projectId }: { projectId: string }) {
  const router = useRouter();
  const { session } = useSession();
  const [workspace, setWorkspace] = useState<ValuationWorkspace | null>(null);
  const [model, setModel] = useState<WorkbookReadModel | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("excel");
  const [selected, setSelected] = useState<{
    sheetId: string;
    address: string;
    sheetName: string;
  } | null>(null);
  const [status, setStatus] = useState<
    "idle" | "loading" | "calculating" | "saving"
  >("loading");
  const [pageError, setPageError] = useState("");
  const [cellError, setCellError] = useState("");
  const [sensitivityError, setSensitivityError] = useState("");
  const [sensitivityLoading, setSensitivityLoading] = useState(false);
  const [targetPer, setTargetPer] = useState("");
  const [targetPrice, setTargetPrice] = useState("");
  const [targetPerError, setTargetPerError] = useState("");
  const [targetPriceError, setTargetPriceError] = useState("");
  const [targetPerIsDirty, setTargetPerIsDirty] = useState(false);
  const [targetPriceIsDirty, setTargetPriceIsDirty] = useState(false);
  const [pendingCellCount, setPendingCellCount] = useState(0);
  const [lastCellResult, setLastCellResult] =
    useState<CellPatchResult | null>(null);
  const [sensitivity, setSensitivity] = useState<Sensitivity | null>(null);
  const sensitivityDialog = useRef<HTMLDialogElement | null>(null);
  const sensitivityTrigger = useRef<HTMLButtonElement | null>(null);
  const workspaceRef = useRef<ValuationWorkspace | null>(null);
  const loadSequence = useRef(0);
  const loadController = useRef<AbortController | null>(null);
  const targetPerDirty = useRef(false);
  const targetPriceDirty = useRef(false);
  const cellQueue = useRef<Promise<boolean>>(Promise.resolve(true));
  const mutating = useRef(false);
  const mutationKeys = useRef(
    new Map<string, { signature: string; key: string }>(),
  );
  const tabRefs = useRef<Record<Tab, HTMLButtonElement | null>>({
    excel: null,
    decision: null,
  });

  const routeError = useCallback(
    (error: unknown): boolean => {
      if (error instanceof ClientApiError) {
        const resumeRoute = error.body.error.meta.resumeRoute;
        if (typeof resumeRoute === "string") {
          router.replace(resumeRoute);
          return true;
        }
      }
      return false;
    },
    [router],
  );

  const mutationKey = useCallback(
    (operation: string, payload: unknown) => {
      const signature = JSON.stringify(payload);
      const current = mutationKeys.current.get(operation);
      if (current?.signature === signature) return current.key;
      const key = crypto.randomUUID();
      mutationKeys.current.set(operation, { signature, key });
      return key;
    },
    [],
  );

  const load = useCallback(async (preserveInputs = false) => {
    const sequence = ++loadSequence.current;
    loadController.current?.abort();
    const controller = new AbortController();
    loadController.current = controller;
    try {
      const next = await apiJson<ValuationWorkspace>(
        `/api/projects/${projectId}/valuation`,
        { signal: controller.signal },
      );
      const workbook = await apiJson<WorkbookReadModel>(
        next.workbook.readModelUrl,
        { signal: controller.signal },
      );
      if (sequence !== loadSequence.current) return false;
      workspaceRef.current = next;
      setWorkspace(next);
      setModel(workbook);
      if (!preserveInputs || !targetPerDirty.current) {
        setTargetPer(next.valuationDraft?.targetPer ?? "");
        targetPerDirty.current = false;
        setTargetPerIsDirty(false);
      }
      if (!preserveInputs || !targetPriceDirty.current) {
        setTargetPrice(
          next.valuationDraft?.requestedTargetPrice ??
            next.valuationDraft?.targetPrice ??
            "",
        );
        targetPriceDirty.current = false;
        setTargetPriceIsDirty(false);
      }
      setPageError("");
      setStatus("idle");
      return true;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return false;
      }
      if (!routeError(error)) setPageError(errorMessage(error));
      setStatus("idle");
      return false;
    }
  }, [projectId, routeError]);

  useEffect(() => {
    if (session.status !== "authenticated") return;
    const timer = window.setTimeout(() => void load(), 0);
    return () => {
      window.clearTimeout(timer);
      loadController.current?.abort();
    };
  }, [load, session.status]);

  const performCellCommit = useCallback(async (changes: Change[]) => {
    const current = workspaceRef.current;
    if (!current || !session.csrfToken) return false;
    setStatus("calculating");
    setCellError("");
    const payload = {
      workbookVersion: current.workbook.workbookVersion,
      editableCellSetVersion:
        current.workbook.editableCellSetVersion,
      changes,
    };
    const requestId = mutationKey("valuation.cells.patch", payload);
    try {
      const result = await apiJson<CellPatchResult>(
        `/api/projects/${projectId}/valuation/workbook/cells`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            "X-CSRF-Token": session.csrfToken,
          },
          body: JSON.stringify({
            ...payload,
            requestId,
            changes,
          }),
        },
      );
      mutationKeys.current.delete("valuation.cells.patch");
      const loaded = await load(true);
      if (loaded) setLastCellResult(result);
      return loaded;
    } catch (error) {
      if (!routeError(error)) setCellError(errorMessage(error));
      return false;
    } finally {
      setStatus("idle");
    }
  }, [
    load,
    mutationKey,
    projectId,
    routeError,
    session.csrfToken,
  ]);

  const commitCells = useCallback((changes: Change[]) => {
    setPendingCellCount((count) => count + 1);
    const task = cellQueue.current.then(() => performCellCommit(changes));
    cellQueue.current = task.catch(() => false);
    void task.finally(() =>
      setPendingCellCount((count) => Math.max(0, count - 1)),
    );
    return task;
  }, [performCellCommit]);

  const saveDraft = async (inputMode: "target_per" | "target_price") => {
    const current = workspaceRef.current;
    if (!current || !session.csrfToken || status !== "idle") return;
    if (mutating.current) return;
    const fieldError =
      inputMode === "target_per"
        ? targetPerValidation(targetPer)
        : targetPriceValidation(targetPrice);
    if (inputMode === "target_per") setTargetPerError(fieldError);
    else setTargetPriceError(fieldError);
    if (fieldError) return;
    mutating.current = true;
    setStatus("saving");
    setPageError("");
    setCellError("");
    setLastCellResult(null);
    const payload = {
      workbookVersion: current.workbook.workbookVersion,
      draftVersion: current.valuationDraft?.draftVersion ?? null,
      inputMode,
      ...(inputMode === "target_per"
        ? { targetPer }
        : { targetPrice: targetPrice.replaceAll(",", "") }),
    };
    const requestId = mutationKey("valuation.draft.update", payload);
    try {
      await apiJson(`/api/projects/${projectId}/valuation/draft`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": session.csrfToken,
        },
        body: JSON.stringify({
          ...payload,
          requestId,
        }),
      });
      mutationKeys.current.delete("valuation.draft.update");
      targetPerDirty.current = false;
      targetPriceDirty.current = false;
      setTargetPerIsDirty(false);
      setTargetPriceIsDirty(false);
      await load();
      setActiveTab("decision");
    } catch (error) {
      if (!routeError(error)) setPageError(errorMessage(error));
    } finally {
      setStatus("idle");
      mutating.current = false;
    }
  };

  const approve = async () => {
    const current = workspaceRef.current;
    if (
      !current?.valuationDraft ||
      !current.calculation.calculationRunId ||
      !session.csrfToken ||
      status !== "idle"
    ) {
      return;
    }
    if (mutating.current) return;
    mutating.current = true;
    setStatus("saving");
    setPageError("");
    setCellError("");
    setLastCellResult(null);
    const payload = {
      workbookVersion: current.workbook.workbookVersion,
      draftVersion: current.valuationDraft.draftVersion,
      calculationRunId: current.calculation.calculationRunId,
      currentPriceSnapshotId: current.currentPrice.snapshotId,
    };
    const key = mutationKey("valuation.approve", payload);
    try {
      await apiJson(`/api/projects/${projectId}/valuation/approve`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": session.csrfToken,
          "Idempotency-Key": key,
        },
        body: JSON.stringify({
          ...payload,
          requestId: key,
        }),
      });
      mutationKeys.current.delete("valuation.approve");
      await load();
    } catch (error) {
      if (!routeError(error)) setPageError(errorMessage(error));
    } finally {
      setStatus("idle");
      mutating.current = false;
    }
  };

  const openSensitivity = async () => {
    const current = workspaceRef.current;
    if (!current?.valuationDraft || !session.csrfToken) return;
    setSensitivityLoading(true);
    setSensitivityError("");
    try {
      const next = await apiJson<Sensitivity>(
        `/api/projects/${projectId}/valuation/sensitivity`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-CSRF-Token": session.csrfToken,
          },
          body: JSON.stringify({
            workbookVersion: current.workbook.workbookVersion,
            draftVersion: current.valuationDraft.draftVersion,
          }),
        },
      );
      setSensitivity(next);
      sensitivityDialog.current?.showModal();
    } catch (error) {
      if (!routeError(error)) setSensitivityError(errorMessage(error));
    } finally {
      setSensitivityLoading(false);
    }
  };

  const complete = async () => {
    const current = workspaceRef.current;
    if (!current?.approval || !session.csrfToken || status !== "idle") return;
    if (mutating.current) return;
    mutating.current = true;
    setStatus("saving");
    setPageError("");
    setCellError("");
    setLastCellResult(null);
    const payload = {
      valuationApprovalVersion: current.approval.approvalVersion,
    };
    const key = mutationKey("valuation.complete", payload);
    try {
      const result = await apiJson<{ nextRoute: string }>(
        `/api/projects/${projectId}/valuation/complete`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-CSRF-Token": session.csrfToken,
            "Idempotency-Key": key,
          },
          body: JSON.stringify({
            ...payload,
            requestId: key,
          }),
        },
      );
      mutationKeys.current.delete("valuation.complete");
      router.push(result.nextRoute);
    } catch (error) {
      if (!routeError(error)) setPageError(errorMessage(error));
    } finally {
      setStatus("idle");
      mutating.current = false;
    }
  };

  const hasPendingWork =
    status !== "idle" ||
    pendingCellCount > 0 ||
    targetPerIsDirty ||
    targetPriceIsDirty;

  const allowNavigation = useCallback(() => {
    if (!hasPendingWork) return true;
    return window.confirm(
      "저장되지 않은 입력이나 진행 중인 계산이 있습니다. 이동할까요?",
    );
  }, [hasPendingWork]);

  useEffect(() => {
    if (!hasPendingWork) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [hasPendingWork]);

  const selectedCell = useMemo(() => {
    if (!selected || !model) return null;
    return model.sheets
      .find((sheet) => sheet.sheetId === selected.sheetId)
      ?.cells.find((cell) => cell.address === selected.address) ?? null;
  }, [model, selected]);
  const selectedEditable = useMemo(() => {
    if (!selected || !model) return null;
    return (
      model.editableCells.find(
        (cell) =>
          cell.sheetId === selected.sheetId &&
          cell.address === selected.address,
      ) ?? null
    );
  }, [model, selected]);

  const onTabKey = (event: React.KeyboardEvent, current: Tab) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const next: Tab = current === "excel" ? "decision" : "excel";
    setActiveTab(next);
    tabRefs.current[next]?.focus();
  };

  if (!workspace || !model) {
    const sessionFailed = session.status === "error";
    return (
      <div className="phase5-page-loading">
        <div className="phase5-loading-card" />
        {(pageError || sessionFailed) && (
          <div role="alert">
            <p>
              {pageError ||
                "세션을 확인하지 못했습니다. 페이지를 새로고침해주세요."}
            </p>
            <button
              type="button"
              onClick={() => {
                if (sessionFailed) window.location.reload();
                else void load();
              }}
            >
              다시 불러오기
            </button>
          </div>
        )}
      </div>
    );
  }

  const busy = status !== "idle" || pendingCellCount > 0;
  const draft = workspace.valuationDraft;
  const currentDraft =
    draft &&
    draft.workbookVersion === workspace.workbook.workbookVersion &&
    draft.status !== "revalidation_required"
      ? draft
      : null;
  const summaryTargetPrice =
    currentDraft?.formattedTargetPrice ??
    workspace.calculation.targetPrice?.formattedText ??
    "—";

  return (
    <ProcessShell
      projectName={workspace.project.name}
      activeStage="valuation"
      stages={workspace.workflow.stageStates}
      onBeforeNavigate={allowNavigation}
      footer={
        <footer className="phase5-bottom-bar">
          <div>
            <span className="phase5-save-status" aria-live="polite">
              {status === "calculating"
                ? `Excel 계산 중${pendingCellCount > 1 ? ` · 대기 ${pendingCellCount - 1}` : ""}`
                : status === "saving"
                  ? "저장 중"
                  : cellError || pageError
                    ? "저장 실패 · 입력값을 확인해주세요."
                    : `저장됨 · workbook v${workspace.workbook.workbookVersion}`}
            </span>
            <button
              type="button"
              onClick={() => {
                if (allowNavigation()) {
                  router.push(workspace.navigation.previousRoute);
                }
              }}
              disabled={busy}
            >
              이전
            </button>
            <button
              type="button"
              className="phase5-next"
              disabled={!workspace.completion.canComplete || busy}
              onClick={() => void complete()}
            >
              다음
            </button>
          </div>
        </footer>
      }
    >
      <div className="phase5-screen">
        <header className="phase5-screen-head">
          <div>
            <p>STEP 06</p>
            <h1>PER 밸류에이션</h1>
            <span>
              Excel 추정치를 반영하고 Target PER과 목표주가를 확정합니다.
            </span>
          </div>
          <a
            href={`/api/projects/${projectId}/valuation/workbook.xlsx${
              workspace.approval?.status === "approved"
                ? `?approvalVersion=${workspace.approval.approvalVersion}`
                : ""
            }`}
            download
          >
            최신 XLSX 다운로드
          </a>
        </header>

        {pageError && (
          <section className="phase5-error" role="alert">
            <p>{pageError}</p>
            <button type="button" onClick={() => void load()}>
              최신 버전 불러오기
            </button>
          </section>
        )}

        <div className="phase5-layout">
          <section className="phase5-work-card">
            <nav
              className="phase5-stage-tabs"
              role="tablist"
              aria-label="PER 밸류에이션 설정 단계"
            >
              <button
                ref={(node) => {
                  tabRefs.current.excel = node;
                }}
                id="phase5-excel-tab"
                role="tab"
                aria-selected={activeTab === "excel"}
                aria-controls="phase5-excel-panel"
                tabIndex={activeTab === "excel" ? 0 : -1}
                onKeyDown={(event) => onTabKey(event, "excel")}
                onClick={() => setActiveTab("excel")}
              >
                <i>01</i>
                <span><small>EXCEL CALCULATION</small><b>Forward EPS 계산</b></span>
              </button>
              <button
                ref={(node) => {
                  tabRefs.current.decision = node;
                }}
                id="phase5-decision-tab"
                role="tab"
                aria-selected={activeTab === "decision"}
                aria-controls="phase5-decision-panel"
                tabIndex={activeTab === "decision" ? 0 : -1}
                onKeyDown={(event) => onTabKey(event, "decision")}
                onClick={() => setActiveTab("decision")}
              >
                <i>02</i>
                <span><small>USER DECISION</small><b>Target PER 설정</b></span>
              </button>
            </nav>

            {activeTab === "excel" ? (
              <div
                id="phase5-excel-panel"
                role="tabpanel"
                aria-labelledby="phase5-excel-tab"
                className="phase5-tab-panel"
              >
                <header className="phase5-workbook-chrome">
                  <div>
                    <span>WORKBOOK</span>
                    <strong>{workspace.workbook.displayName}</strong>
                  </div>
                  <small>
                    업로드 원본 기반 · 작업 사본 v
                    {workspace.workbook.workbookVersion} · ClosedXML 0.105.0
                  </small>
                </header>
                {lastCellResult && (
                  <section
                    className="phase5-calculation-impact"
                    aria-live="polite"
                  >
                    <header>
                      <div>
                        <span>재계산 완료</span>
                        <b>workbook v{lastCellResult.workbookVersion}</b>
                      </div>
                      <small>
                        수식 {lastCellResult.affectedCells.length}개 변경
                      </small>
                    </header>
                    <div>
                      {(
                        [
                          ["Forward EPS", lastCellResult.outputDiff.forwardEps],
                          ["Target PER", lastCellResult.outputDiff.targetPer],
                          ["목표주가", lastCellResult.outputDiff.targetPrice],
                        ] as const
                      ).map(([label, delta]) => (
                        <article
                          key={label}
                          className={delta.changed ? "is-changed" : ""}
                        >
                          <small>{label}</small>
                          <b>
                            {delta.beforeFormatted ?? "—"}
                            <i aria-hidden="true">→</i>
                            {delta.afterFormatted ?? "—"}
                          </b>
                        </article>
                      ))}
                    </div>
                    <p>
                      workbook 변경으로 기존 결정·승인과 보고서 검증을
                      최신 계산 기준으로 다시 확인해야 합니다.
                    </p>
                  </section>
                )}
                {cellError && (
                  <div className="phase5-cell-error" role="alert">
                    {cellError}
                  </div>
                )}
                <WorkbookGrid
                  model={model}
                  disabled={status === "saving"}
                  selected={selected}
                  onSelected={(cell, sheetId, sheetName) =>
                    setSelected({
                      sheetId,
                      address: cell.address,
                      sheetName,
                    })
                  }
                  onCommit={commitCells}
                  onLocalError={setCellError}
                />
                <section className="phase5-cell-inspector" aria-live="polite">
                  {selected && selectedCell ? (
                    <>
                      <div>
                        <small>선택 셀</small>
                        <b>{selected.sheetName}!{selectedCell.address}</b>
                      </div>
                      <div>
                        <small>역할</small>
                        <b>{selectedCell.editable ? "사용자 추정치 · 편집 가능" : selectedCell.readOnlyReason}</b>
                      </div>
                      <div>
                        <small>영향 범위</small>
                        <b>
                          {selectedEditable
                            ? `${selectedEditable.impactTypes
                                .map(
                                  (impact) =>
                                    impactLabels[impact] ?? impact,
                                )
                                .join(" · ")}${
                                selectedEditable.activeInCurrentMode === null &&
                                !selectedEditable.impactTypes.includes(
                                  "unmapped",
                                )
                                  ? " · 조건 분기 가능"
                                  : ""
                              }`
                            : "읽기 전용"}
                        </b>
                      </div>
                      <div>
                        <small>값 · 형식</small>
                        <b>{selectedCell.formattedText || "빈 셀"}</b>
                      </div>
                      <div>
                        <small>수식</small>
                        <b>{selectedCell.formula || "없음"}</b>
                      </div>
                    </>
                  ) : (
                    <p>셀을 선택하면 주소, 역할, 값과 수식을 확인할 수 있습니다.</p>
                  )}
                </section>
              </div>
            ) : (
              <div
                id="phase5-decision-panel"
                role="tabpanel"
                aria-labelledby="phase5-decision-tab"
                className="phase5-tab-panel phase5-decision-panel"
              >
                <section className="phase5-reference">
                  <header>
                    <span>EXCEL REFERENCE</span>
                    <h2>Target PER 근거</h2>
                  </header>
                  {workspace.references.length > 0 ? (
                    workspace.references.map((reference) => (
                      <article key={reference.source}>
                        <span>{reference.label}</span>
                        <b>{reference.formattedText}</b>
                        <small>{reference.source}</small>
                      </article>
                    ))
                  ) : (
                    <p>Excel에서 확인된 Target PER 기준값이 없습니다.</p>
                  )}
                </section>
                <div className="phase5-decision-inputs">
                  <section className="phase5-decision-field">
                    <label htmlFor="phase5-target-per">
                      사용자 최종 승인 Target PER
                    </label>
                    <div>
                      <input
                        id="phase5-target-per"
                        value={targetPer}
                        inputMode="decimal"
                        aria-label="사용자 최종 승인 Target PER"
                        aria-invalid={Boolean(targetPerError)}
                        aria-describedby="phase5-target-per-help"
                        disabled={busy}
                        onChange={(event) => {
                          targetPerDirty.current = true;
                          setTargetPerIsDirty(true);
                          setTargetPer(event.target.value);
                          setTargetPerError("");
                        }}
                      />
                      <b>배</b>
                    </div>
                    <small
                      id="phase5-target-per-help"
                      className={targetPerError ? "is-error" : ""}
                    >
                      {targetPerError || "0.1~100.0 · 소수 첫째 자리"}
                    </small>
                    <button
                      type="button"
                      disabled={busy || !targetPer}
                      onClick={() => void saveDraft("target_per")}
                    >
                      Target PER 반영
                    </button>
                  </section>
                  <section className="phase5-decision-field">
                    <label htmlFor="phase5-target-price">
                      사용자 목표주가
                    </label>
                    <div>
                      <input
                        id="phase5-target-price"
                        value={grouped(targetPrice.replaceAll(",", ""))}
                        inputMode="numeric"
                        aria-label="사용자 목표주가"
                        aria-invalid={Boolean(targetPriceError)}
                        aria-describedby="phase5-target-price-help"
                        disabled={busy}
                        onChange={(event) => {
                          targetPriceDirty.current = true;
                          setTargetPriceIsDirty(true);
                          setTargetPrice(
                            event.target.value.replaceAll(",", ""),
                          );
                          setTargetPriceError("");
                        }}
                      />
                      <b>원</b>
                    </div>
                    <small
                      id="phase5-target-price-help"
                      className={targetPriceError ? "is-error" : ""}
                    >
                      {targetPriceError ||
                        "입력값에서 PER을 역산해 Excel에서 재계산합니다."}
                    </small>
                    <button
                      type="button"
                      disabled={busy || !targetPrice}
                      onClick={() => void saveDraft("target_price")}
                    >
                      목표주가 반영
                    </button>
                  </section>
                </div>
                {currentDraft?.requestedTargetPrice &&
                  currentDraft.requestedTargetPrice !==
                    currentDraft.targetPrice && (
                    <p className="phase5-rounding-note">
                      입력 목표주가{" "}
                      {grouped(currentDraft.requestedTargetPrice)}원 · Excel
                      권위 결과 {currentDraft.formattedTargetPrice}
                    </p>
                  )}
                {workspace.completion.blockers.length > 0 && (
                  <ul className="phase5-blockers" aria-label="완료 전 확인">
                    {[...new Set(workspace.completion.blockers)].map(
                      (blocker) => (
                        <li key={blocker}>
                          {blockerLabels[blocker] ?? blocker}
                        </li>
                      ),
                    )}
                  </ul>
                )}
                <button
                  type="button"
                  className="phase5-approve"
                  disabled={!workspace.completion.canApprove || busy}
                  onClick={() => void approve()}
                >
                  {workspace.approval?.status === "approved"
                    ? "입력값 승인 완료"
                    : "입력값 승인"}
                </button>
              </div>
            )}
          </section>

          <aside className="phase5-summary">
            <p>PER VALUATION</p>
            <span>목표주가</span>
            <strong>{summaryTargetPrice}</strong>
            <div className="phase5-upside">
              <span>현재주가 대비 상승여력</span>
              <b>{currentDraft?.formattedUpside ?? "재계산 필요"}</b>
            </div>
            <section>
              <article>
                <small>Forward EPS</small>
                <b>{workspace.calculation.forwardEps?.formattedText ?? "—"}</b>
                <em>{workspace.calculation.forwardEps ? `${workspace.calculation.forwardEps.sheetName}!${workspace.calculation.forwardEps.address}` : "Excel 계산 필요"}</em>
              </article>
              <i>×</i>
              <article>
                <small>Target PER</small>
                <b>{currentDraft ? `${currentDraft.targetPer}배` : "—"}</b>
                <em>사용자 입력값</em>
              </article>
              <i>=</i>
              <article>
                <small>목표주가</small>
                <b>{summaryTargetPrice}</b>
                <em>ClosedXML 권위 결과</em>
              </article>
            </section>
            <dl>
              <div>
                <dt>현재주가</dt>
                <dd>{workspace.currentPrice.formattedText}</dd>
              </div>
              <div>
                <dt>기준일</dt>
                <dd>{workspace.currentPrice.tradingDate} · KRX</dd>
              </div>
              <div>
                <dt>승인 상태</dt>
                <dd>{workspace.approval?.status === "approved" ? `승인 v${workspace.approval.approvalVersion}` : "승인 전"}</dd>
              </div>
            </dl>
            <button
              ref={sensitivityTrigger}
              type="button"
              disabled={!currentDraft || sensitivityLoading}
              onClick={() => void openSensitivity()}
            >
              {sensitivityLoading ? "민감도 계산 중" : "민감도 표 보기"}
            </button>
            {sensitivityError && (
              <p className="phase5-sensitivity-error" role="alert">
                {sensitivityError}
              </p>
            )}
          </aside>
        </div>
      </div>

      <dialog
        ref={sensitivityDialog}
        className="phase5-sensitivity-dialog"
        aria-labelledby="phase5-sensitivity-title"
        onClose={() => sensitivityTrigger.current?.focus()}
        onClick={(event) => {
          if (event.target === event.currentTarget) event.currentTarget.close();
        }}
      >
        <header>
          <div>
            <small>EPS × PER</small>
            <h2 id="phase5-sensitivity-title">목표주가 민감도</h2>
          </div>
          <button
            type="button"
            aria-label="민감도 표 닫기"
            onClick={() => sensitivityDialog.current?.close()}
          >
            ×
          </button>
        </header>
        {sensitivity && (
          <>
            <div className="phase5-sensitivity-scroll" tabIndex={0}>
              <table>
                <thead>
                  <tr>
                    <th>EPS \ PER</th>
                    {sensitivity.perAxis.map((axis) => (
                      <th key={axis.rawValue}>{axis.formattedText}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sensitivity.epsAxis.map((eps, row) => (
                    <tr key={eps.rawValue}>
                      <th>{eps.formattedText}</th>
                      {sensitivity.perAxis.map((per, column) => {
                        const cell = sensitivity.cells.find(
                          (item) =>
                            item.row === row && item.column === column,
                        );
                        return (
                          <td
                            key={per.rawValue}
                            className={cell?.current ? "is-current" : ""}
                            aria-label={
                              cell?.current
                                ? `${cell.formattedText}, 현재 입력값`
                                : cell?.formattedText
                            }
                          >
                            {cell?.formattedText}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <small>규칙 {sensitivity.ruleVersion}</small>
          </>
        )}
      </dialog>
    </ProcessShell>
  );
}
