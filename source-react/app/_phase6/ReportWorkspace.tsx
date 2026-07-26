"use client";

import {
  ArrowLeft,
  Check,
  Download,
  FileCheck2,
  FileSpreadsheet,
  FileText,
  History,
  Lock,
  Minus,
  Pencil,
  Plus,
  Redo2,
  Search,
  Sparkles,
  Undo2,
  X,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiJson, ClientApiError } from "../_phase1/api";
import { useSession } from "../_phase1/useSession";
import { ReportChartEditor } from "./ReportChartEditor";
import { ReportPdfEditor } from "./ReportPdfEditor";
import { PdfPreview } from "./PdfPreview";
import styles from "./phase6.module.css";
import type {
  EditSession,
  ExportJob,
  ProvenanceDetail,
  ReportBlock,
  ReportChartType,
  ReportWorkspaceData,
  ValidationJob,
} from "./types";

type Panel =
  | "versions"
  | "preview"
  | "validation"
  | "export"
  | "ai"
  | "provenance"
  | "chart";
type Proposal = {
  proposalId: string;
  blockId: string;
  originalText: string;
  proposedText: string;
  checks: {
    numbersPreserved: boolean;
    evidencePreserved: boolean;
    judgementPreserved: boolean;
  };
};
type VersionList = {
  versions: Array<{
    versionId: string;
    version: number;
    status: string;
    savedAt: string;
    pageCount: number;
    active: boolean;
  }>;
};
type HistoryEntry = { blockId: string; before: string; after: string };

function mutationHeaders(csrfToken: string, leaseToken?: string) {
  return {
    "Content-Type": "application/json",
    "X-CSRF-Token": csrfToken,
    ...(leaseToken ? { "X-Edit-Lease": leaseToken } : {}),
  };
}

function errorMessage(error: unknown) {
  return error instanceof ClientApiError
    ? error.body.error.message
    : "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.";
}

function materializationBlockerMessage(code: string) {
  const messages: Record<string, string> = {
    BINDING_NOT_CONFIRMED:
      "이 블록의 Excel 연결이 아직 확정되지 않았습니다.",
    APPROVED_WORKBOOK_READ_MODEL_MISSING:
      "승인된 Excel 버전의 읽기 데이터가 없어 초안에 반영할 수 없습니다.",
    TABLE_RANGE_BINDING_REQUIRED:
      "표의 시트와 셀 범위를 다시 연결해야 합니다.",
    TABLE_SOURCE_RANGE_UNAVAILABLE:
      "연결된 표 범위를 승인된 Excel 버전에서 찾지 못했습니다.",
    TABLE_SOURCE_RANGE_EMPTY:
      "연결된 표 범위에 표시할 데이터가 없습니다.",
    TABLE_TOPOLOGY_MISMATCH:
      "표의 행·열 구조가 연결을 확정했을 때와 달라졌습니다.",
    TABLE_BINDING_METADATA_INVALID:
      "표의 헤더 또는 행 이름 열 연결을 다시 확인해야 합니다.",
    TABLE_HEADER_ROW_EMPTY:
      "연결된 표의 헤더 행을 읽지 못했습니다.",
    CHART_SERIES_BINDING_REQUIRED:
      "그래프의 category와 각 series 범위를 연결해야 합니다.",
    CHART_CATEGORY_RANGE_INVALID:
      "그래프의 category 범위를 승인된 Excel 버전에서 읽지 못했습니다.",
    CHART_SERIES_RANGE_INVALID:
      "그래프 series의 길이 또는 숫자 형식이 category와 맞지 않습니다.",
  };
  return messages[code] ?? `초안 데이터 반영을 완료하지 못했습니다. (${code})`;
}

function findBlock(workspace: ReportWorkspaceData, blockId: string) {
  return workspace.pages
    .flatMap((page) => page.blocks)
    .find((block) => block.blockId === blockId);
}

export function ReportWorkspace({ projectId }: { projectId: string }) {
  const { session } = useSession();
  const [workspace, setWorkspace] = useState<ReportWorkspaceData | null>(null);
  const workspaceRef = useRef<ReportWorkspaceData | null>(null);
  const [editSession, setEditSession] = useState<EditSession | null>(null);
  const editSessionRef = useRef<EditSession | null>(null);
  const [activePageId, setActivePageId] = useState("");
  const [activeBlockId, setActiveBlockId] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [versions, setVersions] = useState<VersionList["versions"]>([]);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewWarnings, setPreviewWarnings] = useState<
    Array<{ code: string; message: string }>
  >([]);
  const [previewScale, setPreviewScale] = useState(0.9);
  const [validation, setValidation] = useState<ValidationJob | null>(null);
  const [exportJob, setExportJob] = useState<ExportJob | null>(null);
  const [provenance, setProvenance] = useState<ProvenanceDetail | null>(null);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [blockDraft, setBlockDraft] = useState("");
  const [aiPrompt, setAiPrompt] = useState("");
  const [approvalOpen, setApprovalOpen] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">("saved");
  const [error, setError] = useState<string | null>(null);
  const [undoStack, setUndoStack] = useState<HistoryEntry[]>([]);
  const [redoStack, setRedoStack] = useState<HistoryEntry[]>([]);
  const saveQueue = useRef<Promise<void>>(Promise.resolve());

  const updateWorkspace = useCallback(
    (updater: (current: ReportWorkspaceData) => ReportWorkspaceData) => {
      setWorkspace((current) => {
        if (!current) return current;
        const next = updater(current);
        workspaceRef.current = next;
        return next;
      });
    },
    [],
  );

  const loadWorkspace = useCallback(async () => {
    if (session.status !== "authenticated") return;
    setError(null);
    try {
      const data = await apiJson<ReportWorkspaceData>(
        `/api/projects/${projectId}/report`,
      );
      workspaceRef.current = data;
      setWorkspace(data);
      setActivePageId((current) => current || data.pages[0]?.pageId || "");
      setValidation(data.jobs.validation);
      if (data.jobs.export) {
        const currentExport = await apiJson<ExportJob>(
          `/api/projects/${projectId}/report/exports/${data.jobs.export.exportId}`,
        );
        setExportJob(currentExport);
      }
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }, [projectId, session.status]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadWorkspace(), 0);
    return () => window.clearTimeout(timer);
  }, [loadWorkspace]);

  useEffect(() => {
    editSessionRef.current = editSession;
  }, [editSession]);

  useEffect(() => {
    if (!editSession || session.status !== "authenticated") return;
    const timer = window.setInterval(() => {
      void apiJson<{ expiresAt: string }>(
        `/api/projects/${projectId}/report/edit-sessions/${editSession.editSessionId}/heartbeat`,
        {
          method: "POST",
          headers: mutationHeaders(session.csrfToken, editSession.leaseToken),
        },
      )
        .then((result) => {
          setEditSession((current) =>
            current ? { ...current, expiresAt: result.expiresAt } : current,
          );
        })
        .catch((caught) => {
          setEditSession(null);
          setError(errorMessage(caught));
        });
    }, editSession.heartbeatSeconds * 1000);
    return () => window.clearInterval(timer);
  }, [editSession, projectId, session]);

  useEffect(() => {
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (approvalOpen) setApprovalOpen(false);
      else setPanel(null);
    };
    document.addEventListener("keydown", onEscape);
    return () => document.removeEventListener("keydown", onEscape);
  }, [approvalOpen]);

  const enterEditMode = async () => {
    if (
      !workspace ||
      session.status !== "authenticated" ||
      pending ||
      workspace.report.status !== "working"
    ) {
      return;
    }
    setPending("edit");
    setError(null);
    try {
      const result = await apiJson<EditSession>(
        `/api/projects/${projectId}/report/edit-sessions`,
        {
          method: "POST",
          headers: mutationHeaders(session.csrfToken),
          body: JSON.stringify({
            reportVersionId: workspace.report.activeVersionId,
          }),
        },
      );
      setEditSession(result);
    } catch (caught) {
      setError(errorMessage(caught));
      await loadWorkspace();
    } finally {
      setPending(null);
    }
  };

  const leaveEditMode = async () => {
    if (!editSession || session.status !== "authenticated") return;
    const current = editSession;
    setEditSession(null);
    setPending("release");
    try {
      await apiJson<void>(
        `/api/projects/${projectId}/report/edit-sessions/${current.editSessionId}`,
        {
          method: "DELETE",
          headers: mutationHeaders(session.csrfToken, current.leaseToken),
        },
      );
      await loadWorkspace();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setPending(null);
    }
  };

  const takeover = async () => {
    if (
      !workspace?.editSession ||
      session.status !== "authenticated" ||
      pending
    ) {
      return;
    }
    setPending("takeover");
    try {
      const result = await apiJson<EditSession>(
        `/api/projects/${projectId}/report/edit-sessions/${workspace.editSession.editSessionId}/takeover`,
        {
          method: "POST",
          headers: mutationHeaders(session.csrfToken),
        },
      );
      setEditSession(result);
      await loadWorkspace();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setPending(null);
    }
  };

  const persistText = useCallback(
    (
      blockId: string,
      text: string,
      options: { history?: HistoryEntry; clearRedo?: boolean } = {},
    ) => {
      if (session.status !== "authenticated") return;
      const csrfToken = session.csrfToken;
      const lease = editSessionRef.current;
      const initial = workspaceRef.current;
      const existing = initial ? findBlock(initial, blockId) : null;
      if (!lease || !initial || !existing || existing.text === text) return;

      updateWorkspace((current) => ({
        ...current,
        pages: current.pages.map((page) => ({
          ...page,
          blocks: page.blocks.map((block) =>
            block.blockId === blockId ? { ...block, text } : block,
          ),
        })),
      }));
      if (options.history) {
        setUndoStack((stack) => [...stack.slice(-49), options.history!]);
      }
      if (options.clearRedo) setRedoStack([]);
      setSaveState("saving");

      saveQueue.current = saveQueue.current.then(async () => {
        const current = workspaceRef.current;
        const currentLease = editSessionRef.current;
        const block = current ? findBlock(current, blockId) : null;
        if (!current || !currentLease || !block) return;
        try {
          const result = await apiJson<{
            reportVersionId: string;
            version: number;
            savedAt: string;
            pages: ReportWorkspaceData["pages"];
          }>(
            `/api/projects/${projectId}/report/versions/${current.report.activeVersionId}`,
            {
              method: "PATCH",
              headers: mutationHeaders(csrfToken, currentLease.leaseToken),
              body: JSON.stringify({
                expectedVersion: current.report.version,
                editSessionId: currentLease.editSessionId,
                clientMutationId: crypto.randomUUID(),
                operations: [
                  {
                    type: "replace_block_text",
                    blockId,
                    baseBlockRevision: block.revision,
                    text,
                  },
                ],
              }),
            },
          );
          updateWorkspace((latest) => ({
            ...latest,
            report: {
              ...latest.report,
              activeVersionId: result.reportVersionId,
              version: result.version,
              lastSavedAt: result.savedAt,
              validationStatus: "not_run",
              previewStatus: "stale",
            },
            pages: result.pages,
            jobs: {
              ...latest.jobs,
              preview: null,
              validation: null,
              approval: null,
              export: null,
            },
          }));
          setEditSession((currentSession) =>
            currentSession
              ? { ...currentSession, reportVersionId: result.reportVersionId }
              : currentSession,
          );
          setSaveState("saved");
          setValidation(null);
          setExportJob(null);
        } catch (caught) {
          setSaveState("error");
          setError(errorMessage(caught));
          await loadWorkspace();
        }
      });
    },
    [loadWorkspace, projectId, session, updateWorkspace],
  );

  const commitBlock = (block: ReportBlock, next: string) => {
    const clean = next.trim();
    if (!clean || clean === block.text.trim()) return;
    persistText(block.blockId, clean, {
      history: { blockId: block.blockId, before: block.text, after: clean },
      clearRedo: true,
    });
  };

  const undo = () => {
    const entry = undoStack.at(-1);
    if (!entry || !editSession) return;
    setUndoStack((stack) => stack.slice(0, -1));
    setRedoStack((stack) => [...stack, entry]);
    persistText(entry.blockId, entry.before);
  };

  const redo = () => {
    const entry = redoStack.at(-1);
    if (!entry || !editSession) return;
    setRedoStack((stack) => stack.slice(0, -1));
    setUndoStack((stack) => [...stack, entry]);
    persistText(entry.blockId, entry.after);
  };

  const openVersions = async () => {
    setPanel("versions");
    try {
      const result = await apiJson<VersionList>(
        `/api/projects/${projectId}/report/versions`,
      );
      setVersions(result.versions);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  };

  const restoreVersion = async (versionId: string) => {
    if (session.status !== "authenticated" || pending) return;
    if (editSession) await leaveEditMode();
    setPending("restore");
    try {
      await apiJson(
        `/api/projects/${projectId}/report/versions/${versionId}/restore`,
        {
          method: "POST",
          headers: {
            ...mutationHeaders(session.csrfToken),
            "Idempotency-Key": crypto.randomUUID(),
          },
        },
      );
      setPanel(null);
      setUndoStack([]);
      setRedoStack([]);
      await loadWorkspace();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setPending(null);
    }
  };

  const openPreview = async () => {
    if (!workspace || session.status !== "authenticated") return;
    setPanel("preview");
    setPending("preview");
    try {
      const result = await apiJson<{
        contentUrl: string;
        warnings?: Array<{ code: string; message: string }>;
      }>(
        `/api/projects/${projectId}/report/previews`,
        {
          method: "POST",
          headers: mutationHeaders(session.csrfToken),
          body: JSON.stringify({
            reportVersionId: workspace.report.activeVersionId,
          }),
        },
      );
      setPreviewUrl(result.contentUrl);
      setPreviewWarnings(result.warnings ?? []);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setPending(null);
    }
  };

  const openProvenance = async (blockId: string) => {
    setActiveBlockId(blockId);
    setPanel("provenance");
    setProvenance(null);
    try {
      setProvenance(
        await apiJson<ProvenanceDetail>(
          `/api/projects/${projectId}/report/blocks/${blockId}/provenance`,
        ),
      );
    } catch (caught) {
      setError(errorMessage(caught));
    }
  };

  const openAi = (blockId: string) => {
    setActiveBlockId(blockId);
    setBlockDraft(
      workspaceRef.current
        ? findBlock(workspaceRef.current, blockId)?.text ?? ""
        : "",
    );
    setAiPrompt("");
    setProposal(null);
    setPanel("ai");
  };

  const openChart = (blockId: string) => {
    setActiveBlockId(blockId);
    setPanel("chart");
  };

  const applyChartType = async (chartType: ReportChartType) => {
    const current = workspaceRef.current;
    const lease = editSessionRef.current;
    const block =
      current && activeBlockId ? findBlock(current, activeBlockId) : null;
    if (
      !current ||
      !lease ||
      !block ||
      block.dataBinding?.kind !== "chart" ||
      block.dataBinding.status !== "confirmed" ||
      block.materializedData?.kind !== "chart" ||
      block.materializedData.status !== "ready" ||
      !block.materializedData.supportedChartTypes.includes(chartType) ||
      session.status !== "authenticated" ||
      pending
    ) {
      return;
    }

    setPending("chart-apply");
    setSaveState("saving");
    setError(null);
    try {
      const result = await apiJson<{
        reportVersionId: string;
        version: number;
        savedAt: string;
        pages: ReportWorkspaceData["pages"];
      }>(
        `/api/projects/${projectId}/report/versions/${current.report.activeVersionId}`,
        {
          method: "PATCH",
          headers: mutationHeaders(session.csrfToken, lease.leaseToken),
          body: JSON.stringify({
            expectedVersion: current.report.version,
            editSessionId: lease.editSessionId,
            clientMutationId: crypto.randomUUID(),
            operations: [
              {
                type: "replace_chart_type",
                blockId: block.blockId,
                baseBlockRevision: block.revision,
                chartType,
              },
            ],
          }),
        },
      );
      updateWorkspace((latest) => ({
        ...latest,
        report: {
          ...latest.report,
          activeVersionId: result.reportVersionId,
          version: result.version,
          lastSavedAt: result.savedAt,
          validationStatus: "not_run",
          previewStatus: "stale",
        },
        pages: result.pages,
        jobs: {
          ...latest.jobs,
          preview: null,
          validation: null,
          approval: null,
          export: null,
        },
      }));
      setEditSession((currentSession) =>
        currentSession
          ? { ...currentSession, reportVersionId: result.reportVersionId }
          : currentSession,
      );
      setValidation(null);
      setExportJob(null);
      setPanel(null);
      setSaveState("saved");
    } catch (caught) {
      setSaveState("error");
      setError(errorMessage(caught));
      await loadWorkspace();
    } finally {
      setPending(null);
    }
  };

  const requestAiProposal = async () => {
    if (
      !workspace ||
      !activeBlockId ||
      !aiPrompt.trim() ||
      session.status !== "authenticated"
    ) {
      return;
    }
    setPending("ai");
    try {
      setProposal(
        await apiJson<Proposal>(
          `/api/projects/${projectId}/report/ai-proposals`,
          {
            method: "POST",
            headers: mutationHeaders(session.csrfToken),
            body: JSON.stringify({
              reportVersionId: workspace.report.activeVersionId,
              blockId: activeBlockId,
              prompt: aiPrompt,
            }),
          },
        ),
      );
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setPending(null);
    }
  };

  const applyAiProposal = async () => {
    if (
      !workspace ||
      !proposal ||
      !editSession ||
      session.status !== "authenticated"
    ) {
      return;
    }
    const original = findBlock(workspace, proposal.blockId)?.text ?? "";
    setPending("ai-apply");
    try {
      const result = await apiJson<{
        reportVersionId: string;
        version: number;
        savedAt: string;
        pages: ReportWorkspaceData["pages"];
      }>(
        `/api/projects/${projectId}/report/ai-proposals/${proposal.proposalId}/apply`,
        {
          method: "POST",
          headers: mutationHeaders(session.csrfToken, editSession.leaseToken),
          body: JSON.stringify({
            expectedVersion: workspace.report.version,
            editSessionId: editSession.editSessionId,
            clientMutationId: crypto.randomUUID(),
          }),
        },
      );
      updateWorkspace((current) => ({
        ...current,
        report: {
          ...current.report,
          activeVersionId: result.reportVersionId,
          version: result.version,
          lastSavedAt: result.savedAt,
          validationStatus: "not_run",
          previewStatus: "stale",
        },
        pages: result.pages,
      }));
      setEditSession((current) =>
        current ? { ...current, reportVersionId: result.reportVersionId } : current,
      );
      setUndoStack((stack) => [
        ...stack.slice(-49),
        { blockId: proposal.blockId, before: original, after: proposal.proposedText },
      ]);
      setRedoStack([]);
      setPanel(null);
      setSaveState("saved");
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setPending(null);
    }
  };

  const createExport = async (validationRunId: string) => {
    const current = workspaceRef.current;
    if (!current || session.status !== "authenticated") return;
    const result = await apiJson<ExportJob>(
      `/api/projects/${projectId}/report/exports`,
      {
        method: "POST",
        headers: {
          ...mutationHeaders(session.csrfToken),
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({
          approvedReportVersionId: current.report.activeVersionId,
          validationRunId,
          artifactTypes: ["pdf", "xlsx"],
        }),
      },
    );
    setExportJob(result);
    setPanel("export");
  };

  const validateForExport = async () => {
    if (!workspace || session.status !== "authenticated" || pending) return;
    if (
      workspace.report.status === "approved" &&
      workspace.jobs.approval &&
      workspace.jobs.validation
    ) {
      setPending("export");
      try {
        await createExport(workspace.jobs.validation.validationRunId);
      } catch (caught) {
        setError(errorMessage(caught));
      } finally {
        setPending(null);
      }
      return;
    }
    setPending("validation");
    setPanel("validation");
    try {
      const result = await apiJson<ValidationJob>(
        `/api/projects/${projectId}/report/validations`,
        {
          method: "POST",
          headers: mutationHeaders(session.csrfToken),
          body: JSON.stringify({
            reportVersionId: workspace.report.activeVersionId,
          }),
        },
      );
      setValidation(result);
      if (result.status === "passed" || result.status === "passed_with_warnings") {
        setApprovalOpen(true);
      }
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setPending(null);
    }
  };

  const approveAndExport = async () => {
    const current = workspaceRef.current;
    if (!current || !validation || session.status !== "authenticated") return;
    setApprovalOpen(false);
    setPending("approval");
    try {
      await apiJson(
        `/api/projects/${projectId}/report/versions/${current.report.activeVersionId}/approve`,
        {
          method: "POST",
          headers: {
            ...mutationHeaders(session.csrfToken),
            "Idempotency-Key": crypto.randomUUID(),
          },
          body: JSON.stringify({
            validationRunId: validation.validationRunId,
          }),
        },
      );
      setEditSession(null);
      await loadWorkspace();
      await createExport(validation.validationRunId);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setPending(null);
    }
  };

  if (session.status === "loading" || (!workspace && !error)) {
    return <div className={styles.loading}>보고서 작업공간을 준비하는 중…</div>;
  }
  if (!workspace) {
    return (
      <main className={styles.screen}>
        <div className={styles.errorBox} role="alert">{error}</div>
        <button className={styles.neutralButton} onClick={() => void loadWorkspace()}>
          다시 불러오기
        </button>
      </main>
    );
  }

  const lockedByOther =
    Boolean(workspace.editSession) &&
    !workspace.editSession?.ownedByCurrentUser &&
    !editSession;
  const editable = Boolean(editSession) && workspace.report.status === "working";
  const activePage =
    workspace.pages.find((page) => page.pageId === activePageId) ??
    workspace.pages[0];
  const selectedBlock = activeBlockId
    ? findBlock(workspace, activeBlockId)
    : null;
  const saveLabel =
    saveState === "saving"
      ? "저장 중…"
      : saveState === "error"
        ? "저장 실패"
        : `저장됨 ${new Date(workspace.report.lastSavedAt).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}`;

  return (
    <main className={styles.reportRoot}>
      <header className={styles.reportToolbar}>
        <Link
          className={styles.toolbarButton}
          href={workspace.navigation.processRoute}
          aria-label="페이지 내용 설정으로 돌아가기"
        >
          <ArrowLeft size={15} />
          프로세스
        </Link>
        <div className={styles.reportIdentity}>
          <strong>{workspace.project.name}</strong>
          <span>보고서 v{workspace.report.version} · {saveLabel}</span>
        </div>
        <div className={styles.toolbarGroup} aria-label="편집 도구">
          <button
            className={styles.toolbarButton}
            disabled={!editable || undoStack.length === 0}
            onClick={undo}
            aria-label="실행 취소"
          >
            <Undo2 size={15} />
          </button>
          <button
            className={styles.toolbarButton}
            disabled={!editable || redoStack.length === 0}
            onClick={redo}
            aria-label="다시 실행"
          >
            <Redo2 size={15} />
          </button>
          <button
            className={styles.toolbarButton}
            onClick={() => void openPreview()}
          >
            <Search size={15} />
            PDF 미리보기
          </button>
          <button
            className={styles.toolbarButton}
            onClick={() => void openVersions()}
          >
            <History size={15} />
            버전
          </button>
        </div>
        {workspace.report.status === "working" ? (
          <button
            className={styles.toolbarButton}
            aria-pressed={editable}
            disabled={Boolean(pending) || lockedByOther}
            onClick={() => void (editable ? leaveEditMode() : enterEditMode())}
          >
            {editable ? <Check size={15} /> : <Pencil size={15} />}
            {editable ? "편집 완료" : "편집"}
          </button>
        ) : (
          <span className={styles.toolbarButton}>
            <Lock size={15} />
            승인된 버전
          </span>
        )}
        <button
          className={`${styles.toolbarButton} ${styles.toolbarPrimary}`}
          disabled={Boolean(pending) || saveState === "saving"}
          onClick={() => void validateForExport()}
        >
          <Download size={15} />
          내보내기
        </button>
      </header>

      {error && (
        <div className={styles.errorBox} role="alert">
          {error}
          <button className={styles.iconButton} onClick={() => setError(null)} aria-label="오류 닫기">
            <X size={16} />
          </button>
        </div>
      )}
      {lockedByOther && (
        <div className={styles.noticeBox}>
          다른 창에서 편집 중입니다. 편집권 만료 후 가져올 수 있습니다.{" "}
          <button className={styles.neutralButton} onClick={() => void takeover()}>
            편집권 가져오기
          </button>
        </div>
      )}

      <div className={styles.reportLayout}>
        <nav className={styles.reportNav} aria-label="보고서 페이지">
          <p>REPORT PAGES</p>
          {workspace.pages.map((page) => (
            <button
              key={page.pageId}
              className={styles.pageNavButton}
              aria-current={activePage?.pageId === page.pageId ? "page" : undefined}
              onClick={() => {
                setActivePageId(page.pageId);
                document.getElementById(`report-${page.pageId}`)?.scrollIntoView({
                  behavior: "smooth",
                  block: "start",
                });
              }}
            >
              <span className={styles.pageThumb}>{page.pageNumber}</span>
              <strong>{page.pageLabel}</strong>
            </button>
          ))}
        </nav>

        <section className={styles.reportCanvas} aria-label="보고서 초안 편집">
          <div className={styles.pdfEditorGuide} data-editable={editable}>
            <span className={styles.pdfEditorGuideDot} />
            {editable
              ? "텍스트는 문장 편집, 그래프는 형태 변경, 표는 연결 출처 확인 패널을 엽니다."
              : "보고서 초안의 텍스트를 선택·복사할 수 있습니다. 편집을 누르면 변경 가능한 텍스트와 데이터 블록이 표시됩니다."}
          </div>
          <ReportPdfEditor
            url={workspace.sourcePdf.contentUrl}
            pages={workspace.pages}
            editable={editable}
            activeBlockId={activeBlockId}
            onSelectBlock={openAi}
            onInspectBlock={(blockId) => void openProvenance(blockId)}
            onEditChart={openChart}
          />
        </section>
      </div>

      {panel && (
        <div className={styles.sidePanelBackdrop} onMouseDown={() => setPanel(null)}>
          <aside
            className={styles.sidePanel}
            role="dialog"
            aria-modal="true"
            aria-label="보고서 작업 패널"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className={styles.drawerHeader}>
              <div>
                <p className={styles.eyebrow}>REPORT WORKSPACE</p>
                <h2>
                  {panel === "versions" && "버전 기록"}
                  {panel === "preview" && "PDF 미리보기"}
                  {panel === "validation" && "최종 검증"}
                  {panel === "export" && "내보내기"}
                  {panel === "ai" && "AI 문장 다듬기"}
                  {panel === "chart" && "그래프 형태 변경"}
                  {panel === "provenance" &&
                    (selectedBlock?.dataBinding ? "데이터 연결" : "근거 추적")}
                </h2>
              </div>
              <button className={styles.iconButton} onClick={() => setPanel(null)} aria-label="패널 닫기">
                <X size={18} />
              </button>
            </div>

            {panel === "versions" && (
              <div className={styles.panelSection}>
                {versions.map((item) => (
                  <div className={styles.exportCard} key={item.versionId}>
                    <span className={styles.fileIcon}>v{item.version}</span>
                    <div>
                      <strong>{item.active ? "현재 버전" : `보고서 버전 ${item.version}`}</strong>
                      <small>{item.status} · {new Date(item.savedAt).toLocaleString("ko-KR")}</small>
                    </div>
                    <button
                      className={styles.neutralButton}
                      disabled={item.active || Boolean(pending)}
                      onClick={() => void restoreVersion(item.versionId)}
                    >
                      복원
                    </button>
                  </div>
                ))}
                {workspace.report.status === "approved" && (
                  <button
                    className={styles.limeButton}
                    disabled={Boolean(pending)}
                    onClick={() => void restoreVersion(workspace.report.activeVersionId)}
                  >
                    승인 버전에서 새 편집본 만들기
                  </button>
                )}
              </div>
            )}

            {panel === "preview" && (
              <>
                <div className={styles.panelSection}>
                  <button
                    className={styles.iconButton}
                    onClick={() => setPreviewScale((scale) => Math.max(0.5, scale - 0.1))}
                    aria-label="축소"
                  >
                    <Minus size={16} />
                  </button>
                  <span>{Math.round(previewScale * 100)}%</span>
                  <button
                    className={styles.iconButton}
                    onClick={() => setPreviewScale((scale) => Math.min(1.5, scale + 0.1))}
                    aria-label="확대"
                  >
                    <Plus size={16} />
                  </button>
                </div>
                {previewWarnings.map((warning) => (
                  <div
                    className={styles.previewWarning}
                    key={`${warning.code}-${warning.message}`}
                  >
                    <strong>{warning.code}</strong>
                    <span>{warning.message}</span>
                  </div>
                ))}
                {previewUrl ? (
                  <PdfPreview url={previewUrl} scale={previewScale} />
                ) : (
                  <div className={styles.loading}>미리보기 생성 중…</div>
                )}
              </>
            )}

            {panel === "validation" && (
              <div className={styles.panelSection}>
                {!validation ? (
                  <p>수치·근거·페이지 구성을 검증하고 있습니다.</p>
                ) : (
                  <>
                    <p>
                      상태: <strong>{validation.status}</strong>
                    </p>
                    {validation.issues.length === 0 ? (
                      <div className={styles.noticeBox}>
                        <FileCheck2 size={16} /> 모든 검증을 통과했습니다.
                      </div>
                    ) : (
                      validation.issues.map((issue) => (
                        <div
                          className={styles.validationIssue}
                          data-severity={issue.severity}
                          key={`${issue.code}-${issue.blockId ?? issue.pageId ?? ""}`}
                        >
                          <strong>{issue.code}</strong>
                          <p>{issue.message}</p>
                        </div>
                      ))
                    )}
                  </>
                )}
              </div>
            )}

            {panel === "export" && (
              <div className={styles.panelSection}>
                <p>동일한 승인 버전에서 PDF와 XLSX를 생성했습니다.</p>
                {exportJob?.artifacts.map((artifact) => (
                  <div className={styles.exportCard} key={artifact.type}>
                    <span className={styles.fileIcon}>
                      {artifact.type === "pdf" ? <FileText size={18} /> : <FileSpreadsheet size={18} />}
                    </span>
                    <div>
                      <strong>{artifact.filename}</strong>
                      <small>{artifact.status} · {artifact.byteSize?.toLocaleString() ?? 0} bytes</small>
                    </div>
                    {artifact.downloadPath && (
                      <a className={styles.neutralButton} href={artifact.downloadPath}>
                        다운로드
                      </a>
                    )}
                  </div>
                ))}
              </div>
            )}

            {panel === "ai" && (
              <div className={styles.panelSection}>
                <p className={styles.panelLabel}>선택 블록 본문</p>
                <textarea
                  className={styles.blockDraft}
                  value={blockDraft}
                  maxLength={2000}
                  disabled={!editSession || Boolean(pending)}
                  onChange={(event) => setBlockDraft(event.target.value)}
                />
                <div className={styles.dialogActions}>
                  {selectedBlock &&
                    (selectedBlock.evidenceIds.length > 0 ||
                      selectedBlock.numericAuthority) && (
                      <button
                        className={styles.neutralButton}
                        onClick={() =>
                          void openProvenance(selectedBlock.blockId)
                        }
                      >
                        연결 근거 보기
                      </button>
                    )}
                  <button
                    className={styles.neutralButton}
                    disabled={
                      !editSession ||
                      !blockDraft.trim() ||
                      blockDraft.trim() ===
                        (activeBlockId
                          ? findBlock(workspace, activeBlockId)?.text.trim()
                          : "") ||
                      Boolean(pending)
                    }
                    onClick={() => {
                      const block = activeBlockId
                        ? findBlock(workspace, activeBlockId)
                        : null;
                      if (block) commitBlock(block, blockDraft);
                    }}
                  >
                    직접 수정 저장
                  </button>
                </div>
                <div className={styles.aiPromptSection}>
                  <p className={styles.panelLabel}>AI 수정 요청</p>
                  <p>선택 문단만 다듬습니다. 검증된 수치·근거·판단 방향은 유지합니다.</p>
                <textarea
                  className={styles.prompt}
                  value={aiPrompt}
                  maxLength={500}
                  placeholder="예: 더 간결하고 전문적인 리서치 문체로 다듬어 주세요."
                  onChange={(event) => setAiPrompt(event.target.value)}
                />
                <div className={styles.dialogActions}>
                  <button
                    className={styles.darkButton}
                    disabled={!aiPrompt.trim() || Boolean(pending)}
                    onClick={() => void requestAiProposal()}
                  >
                    <Sparkles size={14} /> 수정안 생성
                  </button>
                </div>
                </div>
                {proposal && (
                  <>
                    <div className={styles.aiDiff}>
                      <article>
                        <span>원문</span>
                        <p>{proposal.originalText}</p>
                      </article>
                      <article>
                        <span>수정안</span>
                        <p>{proposal.proposedText}</p>
                      </article>
                    </div>
                    <div className={styles.dialogActions}>
                      <button
                        className={styles.limeButton}
                        disabled={!editSession || Boolean(pending)}
                        onClick={() => void applyAiProposal()}
                      >
                        수정안 적용
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}

            {panel === "chart" &&
              selectedBlock?.dataBinding?.kind === "chart" && (
                <ReportChartEditor
                  key={selectedBlock.blockId}
                  block={selectedBlock}
                  pending={Boolean(pending)}
                  onApply={(chartType) => void applyChartType(chartType)}
                  onInspectConnection={() =>
                    void openProvenance(selectedBlock.blockId)
                  }
                />
              )}

            {panel === "provenance" && (
              <div className={styles.panelSection}>
                {!provenance ? (
                  <p>근거를 불러오는 중…</p>
                ) : (
                  <>
                    <h3>{provenance.block.label}</h3>
                    {provenance.binding && (
                      <div
                        className={styles.dataBindingCard}
                        data-status={provenance.binding.status}
                      >
                        <div>
                          <span>연결 상태</span>
                          <strong>
                            {provenance.binding.status === "confirmed"
                              ? "연결 완료"
                              : provenance.binding.status === "suggested"
                                ? "연결 제안"
                                : provenance.binding.status === "invalid"
                                  ? "연결 오류"
                                  : "연결 필요"}
                          </strong>
                        </div>
                        <div>
                          <span>데이터 항목</span>
                          <strong>{provenance.binding.metric}</strong>
                        </div>
                        <div>
                          <span>출처</span>
                          <strong>
                            {provenance.binding.sourceLabel ??
                              provenance.binding.sourceAddress ??
                              "이전 단계에서 출처를 지정해야 합니다."}
                          </strong>
                        </div>
                        {provenance.binding.sourceType && (
                          <small>{provenance.binding.sourceType}</small>
                        )}
                      </div>
                    )}
                    {provenance.materialization &&
                      provenance.materialization.kind !== "fixed_visual" && (
                        <div
                          className={styles.materializationCard}
                          data-status={provenance.materialization.status}
                        >
                          <div className={styles.materializationSummary}>
                            <div>
                              <span>초안 데이터</span>
                              <strong>
                                {provenance.materialization.status === "ready"
                                  ? "초안 반영 완료"
                                  : "초안 반영 불가"}
                              </strong>
                            </div>
                            <div>
                              <span>Workbook</span>
                              <strong>
                                v
                                {
                                  provenance.materialization.provenance
                                    .workbookVersion
                                }
                              </strong>
                            </div>
                          </div>
                          {provenance.materialization.blockerCode && (
                            <p className={styles.materializationBlocker}>
                              {materializationBlockerMessage(
                                provenance.materialization.blockerCode,
                              )}
                            </p>
                          )}
                          <dl className={styles.materializationSources}>
                            {provenance.materialization.provenance.sources.map(
                              (source, index) => (
                                <div
                                  key={`${source.role}-${source.seriesId ?? index}`}
                                >
                                  <dt>
                                    {source.role === "category"
                                      ? "카테고리"
                                      : source.role === "series"
                                        ? source.label || "계열"
                                        : "표 범위"}
                                  </dt>
                                  <dd>
                                    {source.sheetName} · {source.address}
                                  </dd>
                                </div>
                              ),
                            )}
                          </dl>
                          <small>
                            MappingSet{" "}
                            {
                              provenance.materialization.provenance
                                .mappingSetResourceVersionId
                            }
                          </small>
                        </div>
                      )}
                    {provenance.calculation && (
                      <div className={styles.noticeBox}>
                        <strong>검증된 계산 경로</strong>
                        <p>{provenance.calculation.path}</p>
                        <p>
                          Forward EPS {provenance.calculation.forwardEps} · Target PER{" "}
                          {provenance.calculation.targetPer} · 목표주가{" "}
                          {provenance.calculation.targetPrice}
                        </p>
                      </div>
                    )}
                    {provenance.evidence.map((evidence) => (
                      <article className={styles.validationIssue} key={evidence.evidenceId}>
                        <strong>{evidence.title}</strong>
                        <p>{evidence.quoteExact}</p>
                        {evidence.canonicalUrl && (
                          <a href={evidence.canonicalUrl} target="_blank" rel="noreferrer">
                            공식 출처 열기
                          </a>
                        )}
                      </article>
                    ))}
                    {!provenance.calculation && provenance.evidence.length === 0 && (
                      <p>연결된 근거가 없습니다.</p>
                    )}
                  </>
                )}
              </div>
            )}
          </aside>
        </div>
      )}

      {approvalOpen && validation && (
        <div className={styles.dialogBackdrop}>
          <section className={styles.dialog} role="alertdialog" aria-modal="true">
            <div className={styles.dialogHeader}>
              <div>
                <p className={styles.eyebrow}>FINAL APPROVAL</p>
                <h2>이 버전을 최종 승인할까요?</h2>
              </div>
              <button className={styles.iconButton} onClick={() => setApprovalOpen(false)} aria-label="승인 창 닫기">
                <X size={18} />
              </button>
            </div>
            <p>
              보고서 v{workspace.report.version}을 잠급니다. 이후 수정은 새 버전에서 진행하며,
              PDF와 XLSX는 이 승인본을 기준으로 생성됩니다.
            </p>
            <div className={styles.dialogSummary}>
              <div><span>검증 상태</span><strong>{validation.status}</strong></div>
              <div><span>페이지</span><strong>{workspace.report.pageCount}</strong></div>
              <div><span>차단 오류</span><strong>0</strong></div>
            </div>
            <div className={styles.dialogActions}>
              <button className={styles.neutralButton} onClick={() => setApprovalOpen(false)}>
                취소
              </button>
              <button className={styles.limeButton} onClick={() => void approveAndExport()}>
                승인하고 내보내기
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
