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
import { ValidationWorkbook } from "./ValidationWorkbook";
import type {
  ExcelTarget,
  EvidenceViewer,
  ResultDetail,
  ValidationResult,
  ValidationWorkbookManifest,
  ValidationWorkspace,
  WorkbookApplicationAccepted,
  WorkbookApplicationProjection,
  WorkbookWriteProposalManifest,
} from "./types";

function displayCell(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  return String(value);
}

type DartOriginalStatement = {
  scopeCode?: string;
  statementCode?: string;
  title?: string;
  viewerUrl?: string;
  html?: string;
  responseHash?: string;
};

function decodeHtmlText(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code: string) =>
      String.fromCodePoint(Number(code)),
    )
    .replace(/\s+/g, " ")
    .trim();
}

function normalizedAccountName(value: string): string {
  return decodeHtmlText(value).replace(/\s+/g, "");
}

function normalizedFinancialValue(value: string): string {
  const text = decodeHtmlText(value).trim();
  const parenthesized = /^\(.*\)$/.test(text);
  const normalized = text.replace(/[^\d.+-]/g, "").replace(/^\+/, "");
  return parenthesized && normalized && !normalized.startsWith("-")
    ? `-${normalized}`
    : normalized;
}

function sanitizeDartOriginalHtml(value: string): string {
  return value
    .replace(
      /<(script|iframe|frame|object|embed|form|base|meta|link)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,
      "",
    )
    .replace(/<(script|iframe|frame|object|embed|form|base|meta|link)\b[^>]*\/?>/gi, "")
    .replace(
      /\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi,
      "",
    )
    .replace(
      /\s(?:href|src|action|formaction)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi,
      "",
    )
    .replace(/javascript\s*:/gi, "");
}

function buildDartOriginalDocument(input: {
  html: string;
  accountName: string;
  rawValue: string;
  selectedField: string;
}): { document: string; located: boolean } {
  let safeHtml = sanitizeDartOriginalHtml(input.html);
  const rowPattern = /<tr\b[^>]*>[\s\S]*?<\/tr\s*>/gi;
  const rows = [...safeHtml.matchAll(rowPattern)];
  const accountName = normalizedAccountName(input.accountName);
  const rawValue = normalizedFinancialValue(input.rawValue);
  let selectedRow = "";
  let decoratedRow = "";
  for (const match of rows) {
    const row = match[0];
    const cells = [
      ...row.matchAll(/<(td|th)\b[^>]*>[\s\S]*?<\/\1\s*>/gi),
    ];
    const accountMatches = cells.some((cell) => {
      const name = normalizedAccountName(cell[0]);
      return Boolean(
        accountName && (name === accountName || name.includes(accountName)),
      );
    });
    if (!accountMatches) continue;
    const valueCells = cells.filter(
      (cell) =>
        rawValue &&
        normalizedFinancialValue(cell[0]) === rawValue,
    );
    if (valueCells.length === 0) continue;
    const selectedCell =
      input.selectedField.includes("_add_amount")
        ? valueCells.at(-1)![0]
        : valueCells[0]![0];
    const highlightedCell = selectedCell.replace(
      /^<(td|th)\b/i,
      '<$1 data-reflo-selected-cell="true"',
    );
    selectedRow = row;
    decoratedRow = row
      .replace(
        /^<tr\b/i,
        '<tr id="reflo-selected-row" data-reflo-selected-row="true"',
      )
      .replace(selectedCell, highlightedCell);
    break;
  }
  if (selectedRow) safeHtml = safeHtml.replace(selectedRow, decoratedRow);
  const body =
    safeHtml.match(/<body\b[^>]*>([\s\S]*?)<\/body\s*>/i)?.[1] ?? safeHtml;
  const document = `<!doctype html>
<html lang="ko">
  <head>
    <meta charset="utf-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">
    <style>
      html { color: #111; background: #fff; font-family: Arial, "Malgun Gothic", sans-serif; }
      body { margin: 0; padding: 22px 18px 48px; min-width: 760px; }
      table { margin: 0 auto 18px; border-collapse: collapse; color: #111; background: #fff; }
      th, td { border: 1px solid #777 !important; padding: 5px 7px !important; font-size: 12px; line-height: 1.35; }
      [data-reflo-selected-row="true"] > td,
      [data-reflo-selected-row="true"] > th { background: #f4ffd8 !important; }
      [data-reflo-selected-row="true"] > :first-child { box-shadow: inset 4px 0 0 #78a800; font-weight: 700; }
      [data-reflo-selected-cell="true"] { position: relative; background: #e6ff9f !important; box-shadow: inset 0 0 0 3px #78a800 !important; font-weight: 800 !important; }
    </style>
  </head>
  <body>${body}</body>
</html>`;
  return { document, located: Boolean(selectedRow) };
}

function DartOriginalStatementPanel({ viewer }: { viewer: EvidenceViewer }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const originals = Array.isArray(viewer.content.originalStatements)
    ? (viewer.content.originalStatements as DartOriginalStatement[])
    : [];
  const requestedStatement =
    displayCell(viewer.locator.statementCode) === "IS"
      ? "CIS"
      : displayCell(viewer.locator.statementCode);
  const original = originals.find(
    (item) =>
      displayCell(item.scopeCode) === displayCell(viewer.locator.fsDiv) &&
      displayCell(item.statementCode) === requestedStatement,
  );
  const selectedField = displayCell(viewer.locator.selectedField);
  const rawValue = displayCell(viewer.locator.rawValue);
  const rendered = useMemo(
    () =>
      original?.html
        ? buildDartOriginalDocument({
            html: original.html,
            accountName: displayCell(viewer.locator.accountName),
            rawValue,
            selectedField,
          })
        : null,
    [
      original,
      rawValue,
      selectedField,
      viewer.locator.accountName,
    ],
  );
  const moveToEvidence = useCallback(() => {
    const row =
      iframeRef.current?.contentDocument?.getElementById(
        "reflo-selected-row",
      );
    row?.scrollIntoView({ block: "center", inline: "center" });
  }, []);
  if (viewer.kind !== "dart_financial_statement") return null;
  return (
    <section className="phase4-dart-table">
      <header>
        <div>
          <small>DART ORIGINAL FILING</small>
          <strong>
            {original?.title ??
              `${displayCell(viewer.locator.statementName)} 원문 표`}
          </strong>
        </div>
        <span>수집 시점 공시 원본</span>
      </header>
      {rendered ? (
        <iframe
          ref={iframeRef}
          sandbox="allow-same-origin"
          srcDoc={rendered.document}
          title="DART 재무제표 원문 표"
          onLoad={moveToEvidence}
        />
      ) : (
        <p>
          이 수집본에는 DART 공시 원문 표가 보관되어 있지 않습니다. 자료 수집을
          다시 실행해주세요.
        </p>
      )}
      {rendered && !rendered.located && (
        <p>
          공시 원문 표는 열었지만 선택한 계정 행과 값 셀을 정확히 찾지
          못했습니다. 이 값은 원문 확인 전까지 확정할 수 없습니다.
        </p>
      )}
    </section>
  );
}

function PdfEvidencePanel({ viewer }: { viewer: EvidenceViewer }) {
  if (viewer.kind !== "pdf") return null;
  const pages = Array.isArray(viewer.content.pages)
    ? viewer.content.pages
    : [];
  const locatorPage = Number(viewer.locator.pageNumber);
  const matchedPage =
    pages.find((page) => page.pageNumber === locatorPage) ??
    pages.find((page) => page.text.includes(viewer.quoteExact)) ??
    pages[0];
  const pageNumber = matchedPage?.pageNumber ?? 1;
  const quoteIndex = matchedPage?.text.indexOf(viewer.quoteExact) ?? -1;
  const before =
    quoteIndex >= 0
      ? matchedPage!.text.slice(Math.max(0, quoteIndex - 180), quoteIndex)
      : "";
  const after =
    quoteIndex >= 0
      ? matchedPage!.text.slice(
          quoteIndex + viewer.quoteExact.length,
          quoteIndex + viewer.quoteExact.length + 180,
        )
      : "";
  const documentUrl = viewer.documentUrl
    ? `${viewer.documentUrl}#page=${pageNumber}&zoom=page-width`
    : null;
  return (
    <section className="phase4-pdf-viewer">
      <header>
        <div>
          <small>PDF ORIGINAL</small>
          <strong>{pageNumber}페이지</strong>
        </div>
        <span>원문 위치와 인용문을 함께 표시</span>
      </header>
      {documentUrl ? (
        <iframe
          src={documentUrl}
          title={`${viewer.title} ${pageNumber}페이지 원문`}
        />
      ) : (
        <p>보관된 PDF 원문을 열 수 없습니다.</p>
      )}
      <div className="phase4-pdf-excerpt">
        <small>EXACT QUOTE</small>
        <p>
          {before}
          <mark>{viewer.quoteExact}</mark>
          {after}
        </p>
      </div>
    </section>
  );
}

function locateEvidenceQuote(
  body: string,
  quote: string,
  locatorOffset: unknown,
): { start: number; end: number } | null {
  const offset = Number(locatorOffset);
  if (
    Number.isInteger(offset) &&
    offset >= 0 &&
    body.slice(offset, offset + quote.length) === quote
  ) {
    return { start: offset, end: offset + quote.length };
  }
  const exact = body.indexOf(quote);
  if (exact >= 0) return { start: exact, end: exact + quote.length };
  const collapse = (value: string) => {
    let text = "";
    const positions: number[] = [];
    let inWhitespace = false;
    for (let index = 0; index < value.length; index += 1) {
      const character = value[index] === "\u00a0" ? " " : value[index]!;
      if (/\s/.test(character)) {
        if (!inWhitespace && text.length > 0) {
          text += " ";
          positions.push(index);
        }
        inWhitespace = true;
      } else {
        text += character;
        positions.push(index);
        inWhitespace = false;
      }
    }
    const leadingWhitespace = text.length - text.trimStart().length;
    const trimmedText = text.trim();
    return {
      text: trimmedText,
      positions: positions.slice(
        leadingWhitespace,
        leadingWhitespace + trimmedText.length,
      ),
    };
  };
  const normalizedBody = collapse(body);
  const normalizedQuote = collapse(quote).text;
  const normalizedIndex = normalizedBody.text.indexOf(normalizedQuote);
  if (normalizedIndex < 0 || normalizedQuote.length === 0) return null;
  const start = normalizedBody.positions[normalizedIndex];
  const finalPosition =
    normalizedBody.positions[normalizedIndex + normalizedQuote.length - 1];
  return start === undefined || finalPosition === undefined
    ? null
    : { start, end: finalPosition + 1 };
}

function WebEvidencePanel({ viewer }: { viewer: EvidenceViewer }) {
  const bodyRef = useRef<HTMLElement>(null);
  const markRef = useRef<HTMLElement>(null);
  const body =
    typeof viewer.content.body === "string" ? viewer.content.body : "";
  const quoteLocation = useMemo(
    () =>
      locateEvidenceQuote(
        body,
        viewer.quoteExact,
        viewer.locator.characterOffset,
      ),
    [body, viewer.locator.characterOffset, viewer.quoteExact],
  );
  useEffect(() => {
    if (viewer.kind !== "web" || !quoteLocation) return;
    const container = bodyRef.current;
    const mark = markRef.current;
    if (!container || !mark) return;
    container.scrollTop = Math.max(
      0,
      mark.offsetTop - container.clientHeight / 2 + mark.clientHeight / 2,
    );
  }, [quoteLocation, viewer.evidenceId, viewer.kind]);
  if (viewer.kind !== "web") return null;
  return (
    <section className="phase4-web-snapshot">
      <header>
        <div>
          <small>CAPTURED ORIGINAL</small>
          <strong>{viewer.title}</strong>
        </div>
        <span>{new Date(viewer.collectedAt).toLocaleString("ko-KR")}</span>
      </header>
      {quoteLocation ? (
        <article ref={bodyRef} aria-label="수집 시점 뉴스 기사 본문">
          <div className="phase4-web-byline">
            <strong>{viewer.publisher}</strong>
            <span>
              {viewer.publishedAt
                ? new Date(viewer.publishedAt).toLocaleString("ko-KR")
                : "발행 시각 미상"}
            </span>
          </div>
        <p>
            {body.slice(0, quoteLocation.start)}
            <mark ref={markRef}>
              {body.slice(quoteLocation.start, quoteLocation.end)}
            </mark>
            {body.slice(quoteLocation.end)}
        </p>
        </article>
      ) : (
        <article ref={bodyRef} aria-label="수집 시점 뉴스 기사 본문">
          <p>{body}</p>
          <small className="phase4-source-location-error">
            저장된 원문에서 정확한 인용 위치를 다시 찾지 못했습니다. 이 근거는
            최종 확정 전에 재검증해야 합니다.
          </small>
        </article>
      )}
    </section>
  );
}

function StructuredEvidencePanel({ viewer }: { viewer: EvidenceViewer }) {
  if (viewer.kind !== "structured_api") return null;
  const selectedField = displayCell(viewer.locator.selectedField);
  const selectedRecordName =
    typeof viewer.locator.selectedRecord === "string"
      ? viewer.locator.selectedRecord
      : "latest";
  const selectedRecord = viewer.content[selectedRecordName];
  const latest =
    selectedRecord &&
    typeof selectedRecord === "object" &&
    !Array.isArray(selectedRecord)
      ? (selectedRecord as Record<string, unknown>)
      : viewer.content.latest &&
          typeof viewer.content.latest === "object" &&
          !Array.isArray(viewer.content.latest)
        ? (viewer.content.latest as Record<string, unknown>)
        : viewer.content;
  const selectedValue =
    selectedField !== "—" ? latest[selectedField] : viewer.quoteExact;
  return (
    <section className="phase4-structured-source">
      <header>
        <div>
          <small>OFFICIAL API SNAPSHOT</small>
          <strong>{displayCell(viewer.locator.endpoint)}</strong>
        </div>
        <span>{displayCell(viewer.locator.jsonPointer)}</span>
      </header>
      <dl>
        <div>
          <dt>선택 필드</dt>
          <dd>{selectedField}</dd>
        </div>
        <div className="selected">
          <dt>선택 값</dt>
          <dd>{displayCell(selectedValue)}</dd>
        </div>
      </dl>
      <pre>{JSON.stringify(latest, null, 2).slice(0, 12_000)}</pre>
    </section>
  );
}

function NumericCalculationPanel({
  locator,
}: {
  locator: Record<string, unknown>;
}) {
  const calculation =
    locator.numericCalculation &&
    typeof locator.numericCalculation === "object" &&
    !Array.isArray(locator.numericCalculation)
      ? (locator.numericCalculation as Record<string, unknown>)
      : null;
  if (!calculation) return null;
  return (
    <section className="phase4-structured-source">
      <header>
        <div>
          <small>CODE CALCULATION</small>
          <strong>{displayCell(calculation.formula)}</strong>
        </div>
        <span>허용 오차 ±{displayCell(calculation.tolerancePercentagePoints)}%p</span>
      </header>
      <dl>
        <div>
          <dt>현재값</dt>
          <dd>{displayCell(calculation.currentValue)}</dd>
        </div>
        <div>
          <dt>비교값</dt>
          <dd>{displayCell(calculation.comparisonValue)}</dd>
        </div>
        <div className="selected">
          <dt>코드 계산 증감률</dt>
          <dd>{displayCell(calculation.computedRate)}%</dd>
        </div>
        <div>
          <dt>원문 기재 증감률</dt>
          <dd>
            {calculation.reportedRateOriginal === null
              ? "직접 기재 없음"
              : `${displayCell(calculation.reportedRateOriginal)}%`}
          </dd>
        </div>
      </dl>
    </section>
  );
}

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

function sourceTypeLabel(value: string): string {
  const labels: Record<string, string> = {
    DART: "DART 공시",
    COMPANY_IR: "기업 IR",
    USER_MATERIAL: "사용자 자료",
    NEWS: "뉴스",
    KRX: "KRX 시세",
    ECOS: "한국은행 ECOS",
    FNGUIDE: "FnGuide",
  };
  return labels[value] ?? "공식 자료";
}

function claimTypeLabel(value: ValidationResult["claimType"]): string {
  if (value === "company_statement") return "회사 발표";
  if (value === "calculation") return "계산 결과";
  return "사실 확인";
}

function workbookWriteStatusLabel(status: string | undefined): string {
  if (status === "applied") return "반영 완료";
  if (status === "applying") return "재계산 중";
  if (status === "blocked") return "반영 차단";
  if (status === "proposed") return "반영 예정";
  return "검증 대기";
}

function isPublishedResult(result: ValidationResult): boolean {
  return (
    result.machineStatus === "passed" &&
    result.evidenceIds.length > 0 &&
    ["AVAILABLE", "CONFLICT_RESOLVED"].includes(result.exceptionStatus)
  );
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
  const [writeProposals, setWriteProposals] =
    useState<WorkbookWriteProposalManifest | null>(null);
  const [selectedTarget, setSelectedTarget] = useState<ExcelTarget | null>(null);
  const [activeEvidenceId, setActiveEvidenceId] = useState<string | null>(null);
  const [evidenceViewer, setEvidenceViewer] = useState<EvidenceViewer | null>(
    null,
  );
  const [sourcePanelOpen, setSourcePanelOpen] = useState(false);
  const [proposalDrafts, setProposalDrafts] = useState<
    Record<string, { afterValue: string; reason: string }>
  >({});
  const [pageError, setPageError] = useState("");
  const [sourceError, setSourceError] = useState("");
  const [decisionAction, setDecisionAction] =
    useState<DecisionAction | null>(null);
  const [decisionReason, setDecisionReason] = useState("");
  const [mutationBusy, setMutationBusy] = useState(false);
  const [conflictReason, setConflictReason] = useState("");
  const [expandedViewer, setExpandedViewer] = useState(false);
  const [split, setSplit] = useState(52);
  const splitRef = useRef<HTMLDivElement | null>(null);
  const workbookLoadingRef = useRef(false);
  const proposalPreparationRef = useRef(false);
  const workbookValidationRunRef = useRef<string | null>(null);
  const workspaceRef = useRef<ValidationWorkspace | null>(null);

  const applyWorkspace = useCallback((next: ValidationWorkspace) => {
    workspaceRef.current = next;
    setWorkspace(next);
    const publishedHypothesisResults = next.results.filter(
      (result) =>
        result.category === "hypothesis" &&
        isPublishedResult(result),
    );
    setSelectedQuestionId((current) =>
      current &&
      publishedHypothesisResults.some(
        (result) => result.questionId === current,
      )
        ? current
        : publishedHypothesisResults[0]?.questionId ?? null,
    );
    setSelectedResultId((current) => {
      if (
        current &&
        publishedHypothesisResults.some(
          (result) => result.resultId === current,
        )
      ) {
        return current;
      }
      return publishedHypothesisResults[0]?.resultId ?? null;
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
      .then((next) => {
        if (stopped) return;
        setDetail(next);
        setSourceError("");
      })
      .catch((error) => !stopped && setSourceError(message(error)));
    return () => {
      stopped = true;
    };
  }, [projectId, selectedResultId, session.status]);

  const selectedDetail =
    detail?.result.resultId === selectedResultId
      ? {
          ...detail,
          evidence: detail.evidence
            .filter((evidence) => evidence.machineStatus === "passed")
            .sort((left, right) => {
              const leftRank = left.sourceType === "DART" ? 0 : 1;
              const rightRank = right.sourceType === "DART" ? 0 : 1;
              return leftRank - rightRank;
            }),
        }
      : null;
  const effectiveEvidenceId =
    selectedDetail?.evidence.some(
      (evidence) => evidence.evidenceId === activeEvidenceId,
    )
      ? activeEvidenceId
      : selectedDetail?.evidence[0]?.evidenceId ?? null;

  useEffect(() => {
    if (!effectiveEvidenceId || session.status !== "authenticated") return;
    let stopped = false;
    void apiJson<EvidenceViewer>(
      `/api/projects/${projectId}/evidence/${effectiveEvidenceId}/viewer`,
    )
      .then((next) => {
        if (stopped) return;
        setEvidenceViewer(next);
        setSourceError("");
      })
      .catch((error) => !stopped && setSourceError(message(error)));
    return () => {
      stopped = true;
    };
  }, [effectiveEvidenceId, projectId, session.status]);

  useEffect(() => {
    if (!sourcePanelOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSourcePanelOpen(false);
        setExpandedViewer(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [sourcePanelOpen]);

  useEffect(() => {
    const validationRunId = workspace?.workspace.validationRunId ?? null;
    if (workbookValidationRunRef.current === validationRunId) return;
    workbookValidationRunRef.current = validationRunId;
    workbookLoadingRef.current = false;
    proposalPreparationRef.current = false;
    setWorkbook(null);
    setWriteProposals(null);
    setSelectedTarget(null);
  }, [workspace?.workspace.validationRunId]);

  useEffect(() => {
    if (
      category !== "excel" ||
      session.status !== "authenticated" ||
      !workspace?.workspace.validationRunId ||
      workbook ||
      workbookLoadingRef.current
    ) {
      return;
    }
    let stopped = false;
    workbookLoadingRef.current = true;
    void apiJson<ValidationWorkbookManifest>(
      `/api/projects/${projectId}/validation/workbook`,
    )
      .then((nextWorkbook) => {
        if (stopped) return;
        const firstTarget =
          nextWorkbook.validationTargets.find((target) =>
            workspaceRef.current?.results.some(
              (result) =>
                result.targetId === target.targetId &&
                result.category === "excel" &&
                isPublishedResult(result),
            ),
          ) ?? null;
        setWorkbook(nextWorkbook);
        setSelectedTarget(firstTarget);
        if (firstTarget) {
          const result = workspaceRef.current?.results.find(
            (item) =>
              item.targetId === firstTarget.targetId &&
              item.category === "excel" &&
              isPublishedResult(item),
          );
          setSelectedResultId(result?.resultId ?? null);
          setActiveEvidenceId(null);
          setSourceError("");
          setSourcePanelOpen(Boolean(result));
        }
      })
      .catch((error) => !stopped && setPageError(message(error)))
      .finally(() => {
        workbookLoadingRef.current = false;
      });
    return () => {
      stopped = true;
    };
  }, [
    category,
    projectId,
    session.status,
    workbook,
    workspace?.workspace.validationRunId,
  ]);

  useEffect(() => {
    if (
      category !== "excel" ||
      session.status !== "authenticated" ||
      !session.csrfToken ||
      !workbook ||
      writeProposals ||
      !workspace?.workspace.stageGate.canProceed ||
      proposalPreparationRef.current
    ) {
      return;
    }
    let stopped = false;
    proposalPreparationRef.current = true;
    void apiJson(
      `/api/projects/${projectId}/validation/workbook-write-proposals`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": session.csrfToken,
        },
      },
    )
      .then(() =>
        Promise.all([
          apiJson<ValidationWorkbookManifest>(
            `/api/projects/${projectId}/validation/workbook`,
          ),
          apiJson<WorkbookWriteProposalManifest>(
            `/api/projects/${projectId}/validation/workbook-write-proposals`,
          ),
        ]),
      )
      .then(([nextWorkbook, nextProposals]) => {
        if (stopped) return;
        const firstTarget =
          nextWorkbook.validationTargets.find((target) =>
            workspaceRef.current?.results.some(
              (result) =>
                result.targetId === target.targetId &&
                result.category === "excel" &&
                isPublishedResult(result),
            ),
          ) ?? null;
        setWorkbook(nextWorkbook);
        setWriteProposals(nextProposals);
        setSelectedTarget((current) =>
          current
            ? nextWorkbook.validationTargets.find(
                (target) => target.targetId === current.targetId,
              ) ?? firstTarget
            : firstTarget,
        );
      })
      .catch((error) => !stopped && setPageError(message(error)))
      .finally(() => {
        proposalPreparationRef.current = false;
      });
    return () => {
      stopped = true;
    };
  }, [
    category,
    projectId,
    session.csrfToken,
    session.status,
    workbook,
    writeProposals,
    workspace?.workspace.stageGate.canProceed,
  ]);

  const publishedResults =
    workspace?.results.filter(isPublishedResult) ?? [];
  const publishedQuestionIds = new Set(
    publishedResults
      .filter((result) => result.category === "hypothesis")
      .map((result) => result.questionId)
      .filter((questionId): questionId is string => Boolean(questionId)),
  );
  const publishedQuestions =
    workspace?.questions.filter((question) =>
      publishedQuestionIds.has(question.questionId),
    ) ?? [];
  const verifiedExcelTargetIds = new Set(
    publishedResults
      .filter((result) => result.category === "excel" && result.targetId)
      .map((result) => result.targetId!),
  );
  const verifiedWorkbook = workbook
    ? {
        ...workbook,
        validationTargets: workbook.validationTargets.filter((target) =>
          verifiedExcelTargetIds.has(target.targetId),
        ),
        evidenceBindings: workbook.evidenceBindings.filter((binding) =>
          verifiedExcelTargetIds.has(binding.targetId),
        ),
      }
    : null;
  const selectedResult =
    publishedResults.find((result) => result.resultId === selectedResultId) ??
    null;
  const selectedWorkbookBinding =
    workbook?.evidenceBindings.find(
      (binding) => binding.targetId === selectedTarget?.targetId,
    ) ?? null;
  const activeEvidence =
    selectedDetail?.evidence.find(
      (evidence) => evidence.evidenceId === effectiveEvidenceId,
    ) ??
    selectedDetail?.evidence[0] ??
    null;
  const selectedProposal =
    writeProposals?.proposals.find(
      (proposal) => proposal.targetId === selectedTarget?.targetId,
    ) ?? null;
  const selectedConflict =
    workspace?.conflicts.find(
      (conflict) =>
        conflict.resultId === selectedResultId &&
        conflict.status === "unresolved",
    ) ?? null;
  // 명세 §7.15: `다음` 클릭이 validation version 전체 승인 행위이고
  // "사용자는 정상 결과를 일일이 승인할 필요가 없다". 따라서 미결정(`proposed`)
  // 제안은 `다음`에서 일괄 승인하고, 여기서는 사용자가 **명시적으로 거절한**
  // 필수 제안만 차단 사유로 본다.
  const rejectedRequiredProposals =
    writeProposals?.proposals.filter(
      (proposal) => proposal.required && proposal.status === "reject",
    ) ?? [];
  const writeReviewReady =
    writeProposals !== null &&
    writeProposals.blockers.length === 0 &&
    rejectedRequiredProposals.length === 0;
  const undecidedProposals =
    writeProposals?.proposals.filter(
      (proposal) => proposal.status === "proposed",
    ) ?? [];

  const proposalDraft = selectedProposal
    ? proposalDrafts[selectedProposal.proposalId]
    : undefined;
  const proposalAfterValue =
    proposalDraft?.afterValue ??
    selectedProposal?.decision?.proposedAfterValue ??
    selectedProposal?.afterValue ??
    "";
  const proposalReason =
    proposalDraft?.reason ?? selectedProposal?.decision?.reason ?? "";

  const filterCount = (target: Filter) => {
    if (!workspace) return 0;
    const results = publishedResults.filter(
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
          ["AVAILABLE", "CONFLICT_RESOLVED"].includes(
            result.exceptionStatus,
          ),
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

  const resolveConflict = async () => {
    if (
      !workspace ||
      !selectedConflict ||
      !activeEvidence ||
      !session.csrfToken ||
      conflictReason.trim().length < 5
    ) {
      return;
    }
    setMutationBusy(true);
    try {
      await apiJson(
        `/api/projects/${projectId}/validation/conflicts/` +
          `${selectedConflict.conflictId}/decision`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-CSRF-Token": session.csrfToken,
            "Idempotency-Key": crypto.randomUUID(),
          },
          body: JSON.stringify({
            expectedValidationVersion: workspace.workspace.validationVersion,
            selectedEvidenceId: activeEvidence.evidenceId,
            reason: conflictReason.trim(),
          }),
        },
      );
      setConflictReason("");
      await load();
      setDetail(
        await apiJson<ResultDetail>(
          `/api/projects/${projectId}/validation/results/${selectedConflict.resultId}`,
        ),
      );
    } catch (error) {
      setPageError(message(error));
    } finally {
      setMutationBusy(false);
    }
  };

  const decideWorkbookProposal = async (
    action: "approve" | "modify" | "reject",
  ) => {
    if (!selectedProposal || !writeProposals || !session.csrfToken) return;
    const reason =
      proposalReason.trim().length >= 5
        ? proposalReason.trim()
        : action === "approve"
          ? "공식 원문과 입력값 확인 후 승인"
          : "";
    if (reason.length < 5) {
      setPageError("수정·거절 사유를 5자 이상 입력해주세요.");
      return;
    }
    setMutationBusy(true);
    try {
      await apiJson(
        `/api/projects/${projectId}/validation/workbook-write-proposals/` +
          `${selectedProposal.proposalId}/decision`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-CSRF-Token": session.csrfToken,
            "Idempotency-Key": crypto.randomUUID(),
          },
          body: JSON.stringify({
            validatedValueSetVersionId:
              writeProposals.validatedValueSetVersionId,
            expectedWorkbookVersion:
              writeProposals.expectedWorkbookVersion,
            expectedProjectVersion:
              writeProposals.expectedProjectVersion,
            sourceSnapshotId: writeProposals.sourceSnapshotId,
            sourceFingerprint: writeProposals.sourceFingerprint,
            action,
            proposedAfterValue:
              action === "modify" ? proposalAfterValue : undefined,
            reason,
          }),
        },
      );
      const next = await apiJson<WorkbookWriteProposalManifest>(
        `/api/projects/${projectId}/validation/workbook-write-proposals`,
      );
      setWriteProposals(next);
      setPageError("");
    } catch (error) {
      setPageError(message(error));
    } finally {
      setMutationBusy(false);
    }
  };

  const complete = async () => {
    if (!workspace || !session.csrfToken || !writeReviewReady) return;
    setMutationBusy(true);
    try {
      const preparedProposals = await apiJson<WorkbookWriteProposalManifest>(
        `/api/projects/${projectId}/validation/workbook-write-proposals`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-CSRF-Token": session.csrfToken,
          },
        },
      );
      // 명세 §7.15: 정상 결과는 개별 승인 대상이 아니다. 사용자가 따로
      // 결정하지 않은 제안은 이 시점에 일괄 승인해 감사 기록으로 남긴다.
      // 사용자가 이미 수정·거절한 제안은 그대로 둔다.
      for (const proposal of preparedProposals.proposals) {
        if (proposal.status !== "proposed") continue;
        await apiJson(
          `/api/projects/${projectId}/validation/workbook-write-proposals/` +
            `${proposal.proposalId}/decision`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-CSRF-Token": session.csrfToken,
              "Idempotency-Key": crypto.randomUUID(),
            },
            body: JSON.stringify({
              validatedValueSetVersionId:
                preparedProposals.validatedValueSetVersionId,
              expectedWorkbookVersion:
                preparedProposals.expectedWorkbookVersion,
              expectedProjectVersion:
                preparedProposals.expectedProjectVersion,
              sourceSnapshotId: preparedProposals.sourceSnapshotId,
              sourceFingerprint: preparedProposals.sourceFingerprint,
              action: "approve",
              reason: "검증 버전 승인 시 일괄 반영 · 원문 대조 검증 통과",
            }),
          },
        );
      }
      setWriteProposals(
        await apiJson<WorkbookWriteProposalManifest>(
          `/api/projects/${projectId}/validation/workbook-write-proposals`,
        ),
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

  const activateCategory = (nextCategory: Category) => {
    setCategory(nextCategory);
    setExpandedViewer(false);
    setSourceError("");
    if (nextCategory !== "excel" || !selectedTarget) {
      setSourcePanelOpen(false);
      return;
    }
    const result = workspace?.results.find(
      (item) =>
        item.category === "excel" &&
        item.targetId === selectedTarget.targetId &&
        isPublishedResult(item),
    );
    setSelectedResultId(result?.resultId ?? null);
    setActiveEvidenceId(null);
    setSourcePanelOpen(Boolean(result));
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
              !workspace.workspace.stageGate.canProceed ||
              !writeReviewReady ||
              mutationBusy
            }
            aria-describedby="phase4-validation-next-help"
            onClick={() => void complete()}
          >
            다음 <span aria-hidden="true">›</span>
          </button>
          <span id="phase4-validation-next-help" className="phase4-sr-only">
            {!workspace.workspace.stageGate.canProceed
              ? "모든 검증 차단 항목을 해결한 뒤 이동할 수 있습니다."
              : !writeReviewReady
                ? "거절한 필수 Excel 제안을 승인 또는 수정으로 다시 결정해주세요."
                : undecidedProposals.length > 0
                  ? `미결정 Excel 제안 ${undecidedProposals.length}건을 함께 승인하고 복사본에 반영·재검증한 뒤 밸류에이션으로 이동`
                  : "승인된 제안만 복사본에 반영·재검증한 뒤 밸류에이션으로 이동"}
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
                onClick={() => activateCategory(item)}
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
                  activateCategory(next);
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
                  {publishedQuestions.map((question) => {
                    const questionIndex = workspace.questions.findIndex(
                      (item) => item.questionId === question.questionId,
                    );
                    const answer = workspace.questionAnswers.find(
                      (item) => item.questionId === question.questionId,
                    );
                    const active = selectedQuestionId === question.questionId;
                    const results = publishedResults.filter(
                      (result) =>
                        result.category === "hypothesis" &&
                        result.questionId === question.questionId &&
                        (filter === "all" ||
                          (filter === "conflict" &&
                            result.exceptionStatus.includes("CONFLICT")) ||
                          (filter === "complete" &&
                            result.machineStatus === "passed" &&
                            ["AVAILABLE", "CONFLICT_RESOLVED"].includes(
                              result.exceptionStatus,
                            )) ||
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
                              {answer
                                ? `분석 판단 · 보고서 반영 주장 ${answer.includedClaimCount}건 · 제외 ${answer.excludedClaimCount}건`
                                : "검증된 주장을 정리하고 있습니다."}
                            </small>
                          </span>
                          <em className={answer ? "sufficient" : "reinvestigating"}>
                            {answer ? "반영 검토" : "검증 중"}
                          </em>
                        </button>
                        {active && (
                          <div className="phase4-evidence-list">
                            {results.map((result) => (
                              <button
                                type="button"
                                aria-pressed={selectedResultId === result.resultId}
                                aria-expanded={
                                  sourcePanelOpen &&
                                  selectedResultId === result.resultId
                                }
                                aria-controls="phase4-hypothesis-source-panel"
                                className={
                                  selectedResultId === result.resultId
                                    ? "selected"
                                    : ""
                                }
                                key={result.resultId}
                                onClick={() => {
                                  setSelectedResultId(result.resultId);
                                  setActiveEvidenceId(null);
                                  setSourceError("");
                                  setSourcePanelOpen(true);
                                }}
                              >
                                <span>
                                  <small>
                                    {claimTypeLabel(result.claimType)} ·{" "}
                                    {stanceLabel(result.stance)} · 원문 확인 완료
                                  </small>
                                  <strong>{result.title}</strong>
                                </span>
                                <b>{result.oneLineValue}</b>
                              </button>
                            ))}
                            {results.length === 0 && (
                              <p>해당 상태 결과가 없습니다.</p>
                            )}
                          </div>
                        )}
                      </section>
                    );
                  })}
                  {publishedQuestions.length === 0 && (
                    <p className="phase4-empty-state">
                      수집 후 독립 검증을 통과한 가설 근거가 없습니다.
                    </p>
                  )}
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
            {sourcePanelOpen && (
              <button
                type="button"
                className="phase4-source-backdrop"
                aria-label="원문 패널 닫기"
                onClick={() => setSourcePanelOpen(false)}
              />
            )}
            <aside
              id="phase4-hypothesis-source-panel"
              className={`phase4-evidence-viewer ${
                sourcePanelOpen ? "open" : ""
              }`}
            >
              <header>
                <div>
                  <small>ORIGINAL SOURCE</small>
                  <h2>{selectedDetail?.result.title ?? "원문 근거"}</h2>
                </div>
                <div className="phase4-source-actions">
                  <button
                    type="button"
                    aria-label={expandedViewer ? "원문 축소" : "원문 확대"}
                    aria-expanded={expandedViewer}
                    onClick={() => setExpandedViewer((value) => !value)}
                  >
                    {expandedViewer ? "축소" : "확대"}
                  </button>
                  <button
                    type="button"
                    className="phase4-source-close"
                    aria-label="원문 패널 닫기"
                    onClick={() => {
                      setSourcePanelOpen(false);
                      setExpandedViewer(false);
                    }}
                  >
                    닫기
                  </button>
                </div>
              </header>
              {sourcePanelOpen && activeEvidence ? (
                <article>
                  {selectedDetail && selectedDetail.evidence.length > 1 && (
                    <nav
                      className="phase4-evidence-tabs"
                      aria-label="이 결과의 전체 근거"
                    >
                      {selectedDetail.evidence.map((evidence, index) => (
                        <button
                          type="button"
                          className={
                            activeEvidence.evidenceId === evidence.evidenceId
                              ? "active"
                              : ""
                          }
                          aria-pressed={
                            activeEvidence.evidenceId === evidence.evidenceId
                          }
                          key={evidence.evidenceId}
                          onClick={() => {
                            setActiveEvidenceId(evidence.evidenceId);
                            setSourceError("");
                          }}
                        >
                          근거 {index + 1} ·{" "}
                          {sourceTypeLabel(evidence.sourceType)}
                        </button>
                      ))}
                    </nav>
                  )}
                  <div className="phase4-provenance">
                    <span>{sourceTypeLabel(activeEvidence.sourceType)}</span>
                    <strong>{activeEvidence.title}</strong>
                    <small>
                      {activeEvidence.publisher} ·{" "}
                      {activeEvidence.publishedAt
                        ? new Date(
                            activeEvidence.publishedAt,
                          ).toLocaleDateString("ko-KR")
                        : "발행일 확인"}
                    </small>
                  </div>
                  <blockquote>
                    <mark>{activeEvidence.quoteExact}</mark>
                  </blockquote>
                  {evidenceViewer?.evidenceId === activeEvidence.evidenceId && (
                    <>
                      <DartOriginalStatementPanel viewer={evidenceViewer} />
                      <PdfEvidencePanel viewer={evidenceViewer} />
                      <WebEvidencePanel viewer={evidenceViewer} />
                      <StructuredEvidencePanel viewer={evidenceViewer} />
                    </>
                  )}
                  {sourceError &&
                    evidenceViewer?.evidenceId !== activeEvidence.evidenceId && (
                      <p className="phase4-source-location-error">
                        선택한 원문을 불러오지 못했습니다: {sourceError}
                      </p>
                    )}
                  <NumericCalculationPanel locator={activeEvidence.locator} />
                  <section className="phase4-source-verification">
                    <strong>인용 검증 완료</strong>
                    <p>
                      이 원문은 ‘{selectedResult?.title}’ 근거로 연결되었습니다.
                    </p>
                  </section>
                  {evidenceSourceUrl(activeEvidence) && (
                    <a
                      href={evidenceSourceUrl(activeEvidence)!}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      실제 원문에서 열기
                    </a>
                  )}
                  {selectedConflict &&
                    selectedConflict.candidateEvidenceIds.includes(
                      activeEvidence.evidenceId,
                    ) && (
                      <section className="phase4-conflict-decision">
                        <strong>출처 값 충돌</strong>
                        <p>
                          비교할 근거 탭을 확인한 뒤 현재 원문을 권위 출처로
                          채택할 수 있습니다.
                        </p>
                        <textarea
                          value={conflictReason}
                          maxLength={500}
                          placeholder="선택 이유를 5자 이상 입력"
                          aria-label="충돌 출처 선택 이유"
                          onChange={(event) =>
                            setConflictReason(event.target.value)
                          }
                        />
                        <button
                          type="button"
                          disabled={
                            mutationBusy || conflictReason.trim().length < 5
                          }
                          onClick={() => void resolveConflict()}
                        >
                          이 원문을 권위 출처로 채택
                        </button>
                      </section>
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
            ref={splitRef}
            style={{
              gridTemplateColumns: `${split}fr 28px ${100 - split}fr`,
            }}
          >
            <section>
              {verifiedWorkbook ? (
                <ValidationWorkbook
                  manifest={verifiedWorkbook}
                  selectedTargetId={selectedTarget?.targetId ?? null}
                  onSelectTarget={(target) => {
                    setSelectedTarget(target);
                    const result = publishedResults.find(
                      (item) => item.targetId === target.targetId,
                    );
                    setSelectedResultId(result?.resultId ?? null);
                    setActiveEvidenceId(null);
                    setSourceError("");
                    setSourcePanelOpen(Boolean(result));
                  }}
                />
              ) : (
                <div className="phase4-empty">
                  {!workspace.workspace.validationRunId
                    ? "자료 수집과 검증 실행이 생성되면 Workbook을 표시합니다."
                    : pageError
                      ? "검증 Workbook을 불러오지 못했습니다. 위 오류를 확인해주세요."
                      : "Workbook을 불러오고 있습니다."}
                </div>
              )}
            </section>
            <div
              className="phase4-splitter"
              role="separator"
              aria-label="Excel과 원문 너비 조절"
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
            {sourcePanelOpen && (
              <button
                type="button"
                className="phase4-source-backdrop"
                aria-label="원문 패널 닫기"
                onClick={() => setSourcePanelOpen(false)}
              />
            )}
            <aside
              id="phase4-excel-source-panel"
              className={`phase4-excel-source ${
                sourcePanelOpen ? "open" : ""
              }`}
            >
              <header>
                <div>
                  <small>VERIFIED SOURCE</small>
                  <h2>{selectedTarget?.metric ?? "선택 셀 원문"}</h2>
                  <span>
                    {selectedTarget
                      ? `${selectedTarget.sheetName}!${selectedTarget.address}`
                      : "셀을 선택하세요"}
                  </span>
                </div>
                <button
                  type="button"
                  className="phase4-source-close"
                  aria-label="원문 패널 닫기"
                  onClick={() => setSourcePanelOpen(false)}
                >
                  닫기
                </button>
              </header>
              {sourcePanelOpen &&
              activeEvidence &&
              selectedResult?.category === "excel" ? (
                <article>
                  {selectedDetail && selectedDetail.evidence.length > 1 && (
                    <nav
                      className="phase4-evidence-tabs"
                      aria-label="계산에 사용된 전체 공식 근거"
                    >
                      {selectedDetail.evidence.map((evidence, index) => (
                        <button
                          type="button"
                          className={
                            activeEvidence.evidenceId === evidence.evidenceId
                              ? "active"
                              : ""
                          }
                          aria-pressed={
                            activeEvidence.evidenceId === evidence.evidenceId
                          }
                          key={evidence.evidenceId}
                          onClick={() => {
                            setActiveEvidenceId(evidence.evidenceId);
                            setSourceError("");
                          }}
                        >
                          공식 근거 {index + 1}
                        </button>
                      ))}
                    </nav>
                  )}
                  <strong>{activeEvidence.title}</strong>
                  <blockquote>{activeEvidence.quoteExact}</blockquote>
                  {evidenceViewer?.evidenceId === activeEvidence.evidenceId && (
                    <>
                      <DartOriginalStatementPanel viewer={evidenceViewer} />
                      <PdfEvidencePanel viewer={evidenceViewer} />
                      <WebEvidencePanel viewer={evidenceViewer} />
                      <StructuredEvidencePanel viewer={evidenceViewer} />
                    </>
                  )}
                  {sourceError &&
                    evidenceViewer?.evidenceId !== activeEvidence.evidenceId && (
                      <p className="phase4-source-location-error">
                        선택한 원문을 불러오지 못했습니다: {sourceError}
                      </p>
                    )}
                  <dl>
                    <div>
                      <dt>보고서 · 접수번호</dt>
                      <dd>
                        {displayCell(activeEvidence.locator.reportCode)} ·{" "}
                        {displayCell(activeEvidence.locator.receiptNumber)}
                      </dd>
                    </div>
                    <div>
                      <dt>재무제표 · 계정</dt>
                      <dd>
                        {displayCell(activeEvidence.locator.statementName)} ·{" "}
                        {displayCell(activeEvidence.locator.accountName)} (
                        {displayCell(activeEvidence.locator.accountId)})
                      </dd>
                    </div>
                    <div>
                      <dt>원본 값</dt>
                      <dd>{activeEvidence.valueOriginal ?? "—"}</dd>
                    </div>
                    <div>
                      <dt>정규화 값</dt>
                      <dd>{activeEvidence.valueNormalized ?? "—"}</dd>
                    </div>
                    <div>
                      <dt>기간 · 기준</dt>
                      <dd>
                        {activeEvidence.period} · {activeEvidence.scope}
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
                    <div>
                      <dt>계산식</dt>
                      <dd>{displayCell(activeEvidence.locator.formula)}</dd>
                    </div>
                  </dl>
                  {evidenceSourceUrl(activeEvidence) && (
                    <a
                      href={evidenceSourceUrl(activeEvidence)!}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      실제 DART 원문 열기
                    </a>
                  )}
                  {selectedProposal && (
                    <section className="phase4-write-decision">
                      <header>
                        <div>
                          <small>WORKBOOK WRITE PROPOSAL</small>
                          <strong>
                            {selectedProposal.sheetName}!
                            {selectedProposal.address}
                          </strong>
                        </div>
                        <span className={selectedProposal.status}>
                          {selectedProposal.status === "proposed"
                            ? "결정 필요"
                            : selectedProposal.status === "approve"
                              ? "승인"
                              : selectedProposal.status === "modify"
                                ? "수정 승인"
                                : "거절"}
                        </span>
                      </header>
                      <label>
                        <span>반영 값</span>
                        <input
                          value={proposalAfterValue}
                          onChange={(event) =>
                            setProposalDrafts((current) => ({
                              ...current,
                              [selectedProposal.proposalId]: {
                                afterValue: event.target.value,
                                reason: proposalReason,
                              },
                            }))
                          }
                          aria-label="Workbook 반영 값"
                        />
                      </label>
                      <label>
                        <span>결정 사유</span>
                        <textarea
                          value={proposalReason}
                          maxLength={1000}
                          onChange={(event) =>
                            setProposalDrafts((current) => ({
                              ...current,
                              [selectedProposal.proposalId]: {
                                afterValue: proposalAfterValue,
                                reason: event.target.value,
                              },
                            }))
                          }
                          placeholder="수정·거절 시 5자 이상 입력"
                          aria-label="Workbook 반영 결정 사유"
                        />
                      </label>
                      <div>
                        <button
                          type="button"
                          disabled={mutationBusy}
                          onClick={() =>
                            void decideWorkbookProposal("approve")
                          }
                        >
                          원안 승인
                        </button>
                        <button
                          type="button"
                          disabled={
                            mutationBusy ||
                            proposalReason.trim().length < 5 ||
                            (selectedProposal.valueType !== "blank" &&
                              proposalAfterValue.length === 0)
                          }
                          onClick={() =>
                            void decideWorkbookProposal("modify")
                          }
                        >
                          수정값 승인
                        </button>
                        <button
                          type="button"
                          className="danger"
                          disabled={
                            mutationBusy || proposalReason.trim().length < 5
                          }
                          onClick={() =>
                            void decideWorkbookProposal("reject")
                          }
                        >
                          거절
                        </button>
                      </div>
                    </section>
                  )}
                </article>
              ) : (
                <div className="phase4-empty">
                  검증 대상 셀을 선택하면 권위 원문을 표시합니다.
                </div>
              )}
            </aside>
          </div>
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
    </ProcessShell>
  );
}
