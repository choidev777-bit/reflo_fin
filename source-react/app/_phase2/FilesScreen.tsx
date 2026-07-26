"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { apiJson, ClientApiError, googleLoginUrl } from "../_phase1/api";
import { useSession } from "../_phase1/useSession";
import {
  analysisConfidenceCopy,
  analysisReasonCopy,
} from "./analysis-copy";
import type {
  FileRole,
  FilesBootstrap,
  InspectionProjection,
} from "./types";

const stageLabels: Record<string, { no: string; title: string; short: string }> = {
  setup: { no: "01", title: "프로젝트 설정", short: "기업·분기·기준일" },
  files: { no: "02", title: "파일 업로드·검사", short: "PDF·Excel 적합성" },
  hypothesis: { no: "03", title: "투자 의견·조사 질문", short: "가설과 검증 질문" },
  research_plan: { no: "04", title: "자료 수집 및 계획", short: "조사 항목과 출처" },
  validation: { no: "05", title: "조사 결과 검증", short: "원문과 수치 확인" },
  valuation: { no: "06", title: "PER 밸류에이션", short: "목표 PER와 주가" },
  report_outline: { no: "07", title: "페이지 내용 설정", short: "보고서 구성 확정" },
};

const roleContent: Record<
  FileRole,
  {
    title: string;
    accept: string;
    mediaType: string;
    emptyHelp: string;
    readyHelp: string;
  }
> = {
  previous_report_pdf: {
    title: "① 이전 분기 실적 Review PDF",
    accept: ".pdf,application/pdf",
    mediaType: "application/pdf",
    emptyHelp: "텍스트 레이어가 있는 비암호화 PDF · 최대 50 MiB",
    readyHelp: "원본 보존 · PDF 구조 검사 통과",
  },
  analysis_workbook: {
    title: "② 실제 분석 Excel",
    accept:
      ".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    mediaType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    emptyHelp: "매크로·외부 링크가 없는 XLSX · 최대 100 MiB",
    readyHelp: "원본 보존 · workbook 구조 검사 통과",
  },
};

type UploadUi = {
  fileName: string;
  progress: number;
  state: "idle" | "hashing" | "uploading" | "verifying" | "failed";
  message: string;
};

function emptyUpload(): UploadUi {
  return { fileName: "", progress: 0, state: "idle", message: "" };
}

function bytesLabel(value: number): string {
  return value >= 1024 * 1024
    ? `${(value / 1024 / 1024).toFixed(1)} MiB`
    : `${Math.ceil(value / 1024)} KiB`;
}

function phaseLabel(phase: string | null): string {
  return (
    {
      queued: "검사 시작 대기",
      analysis_started: "분석 준비 중",
      pdf_analysis: "PDF 텍스트 구조 분석 중",
      excel_analysis: "Excel 수식·구조 분석 중",
      mapping: "PDF·Excel 연결 확인 중",
      cancelling: "검사 취소 처리 중",
      failed: "검사 중단",
      complete: "검사 완료",
    }[phase ?? ""] ?? "검사 상태 확인 중"
  );
}

const metricLabels: Record<string, string> = {
  target_price: "목표주가",
  current_price: "현재주가",
  revenue: "매출액",
  operating_profit: "영업이익",
  net_income: "순이익",
  eps: "Forward EPS",
  per: "적용 PER",
  investment_opinion: "투자의견",
  quarterly_performance_table: "분기 실적 표",
  segment_revenue_table: "부문별 매출 표",
  financial_statements_table: "재무제표 표",
  target_price_history_table: "목표주가 추이 표",
  valuation_bridge_table: "밸류에이션 브리지",
};

async function sha256(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

function putFile(
  url: string,
  headers: Record<string, string>,
  file: File,
  onProgress: (progress: number) => void,
): { promise: Promise<void>; abort: () => void } {
  const xhr = new XMLHttpRequest();
  const promise = new Promise<void>((resolve, reject) => {
    xhr.open("PUT", url);
    Object.entries(headers).forEach(([name, value]) => xhr.setRequestHeader(name, value));
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else {
        const code = xhr.responseText.match(/<Code>([^<]+)<\/Code>/)?.[1];
        reject(
          new Error(
            `객체 저장소가 ${xhr.status}${
              code ? ` (${code})` : ""
            }로 응답했습니다.`,
          ),
        );
      }
    };
    xhr.onerror = () => reject(new Error("파일 전송 연결이 끊겼습니다."));
    xhr.onabort = () => reject(new DOMException("업로드를 취소했습니다.", "AbortError"));
    xhr.send(file);
  });
  return { promise, abort: () => xhr.abort() };
}

function UploadCard({
  role,
  slot,
  ui,
  onSelect,
  onCancel,
  disabled,
}: {
  role: FileRole;
  slot: FilesBootstrap["slots"][number];
  ui: UploadUi;
  onSelect: (file: File) => void;
  onCancel: () => void;
  disabled: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const content = roleContent[role];
  const current = slot.currentFile;
  const busy = ["hashing", "uploading", "verifying"].includes(ui.state);
  const ready = slot.status === "ready" && current;
  return (
    <article
      className={`spec-upload-box phase2-upload-card ${
        ready ? "has-file" : ""
      } ${slot.status === "rejected" || ui.state === "failed" ? "has-error" : ""}`}
    >
      <div className="spec-upload-title">
        <span>{content.title}</span>
        <span className="phase2-required">필수</span>
      </div>
      <button
        type="button"
        className="phase2-drop-target"
        disabled={disabled || busy}
        onClick={() => {
          if (inputRef.current) {
            inputRef.current.value = "";
            inputRef.current.click();
          }
        }}
      >
        <input
          ref={inputRef}
          type="file"
          accept={content.accept}
          tabIndex={-1}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) onSelect(file);
          }}
        />
        <i aria-hidden="true">{ready ? "✓" : busy ? "…" : "+"}</i>
        <strong>{ui.fileName || current?.fileName || "파일을 선택하세요"}</strong>
        <small>
          {ready
            ? `${bytesLabel(current.sizeBytes)} · ${content.readyHelp}`
            : busy
              ? ui.message
              : content.emptyHelp}
        </small>
      </button>
      {busy && (
        <div className="phase2-upload-progress" aria-live="polite">
          <i>
            <b style={{ width: `${ui.progress}%` }} />
          </i>
          <span>{ui.state === "uploading" ? `${ui.progress}%` : ui.message}</span>
          {ui.state === "uploading" && (
            <button type="button" onClick={onCancel}>
              취소
            </button>
          )}
        </div>
      )}
      {ui.state === "failed" && (
        <p className="phase2-card-error" role="alert">
          {ui.message}
        </p>
      )}
      {ready && !busy && (
        <div className="spec-file-checks">
          <span>버전 {current.version} · 서버 검사 통과</span>
          <button
            type="button"
            disabled={disabled}
            onClick={() => inputRef.current?.click()}
          >
            파일 교체
          </button>
        </div>
      )}
    </article>
  );
}

type MappingEntry = NonNullable<InspectionProjection["mappingSet"]>["entries"][number];

type MappingCandidate = MappingEntry["candidates"][number];

function shortFingerprint(value: string | null | undefined): string {
  if (!value) return "미확인";
  return value.length > 18 ? `${value.slice(0, 10)}…${value.slice(-6)}` : value;
}

function bboxLabel(value: [number, number, number, number] | null): string {
  return value ? value.map((item) => item.toFixed(1)).join(", ") : "미확인";
}

function PdfBlockPreview({ entry }: { entry: MappingEntry }) {
  const block = entry.pdfBlock;
  const confidence = analysisConfidenceCopy(block?.analysisConfidence ?? null);
  const blockStyle = (() => {
    if (!block?.bbox || !block.pageBox) return undefined;
    const [pageX1, pageY1, pageX2, pageY2] = block.pageBox;
    const [blockX1, blockY1, blockX2, blockY2] = block.bbox;
    const width = Math.max(1, pageX2 - pageX1);
    const height = Math.max(1, pageY2 - pageY1);
    return {
      left: `${Math.max(0, ((blockX1 - pageX1) / width) * 100)}%`,
      top: `${Math.max(0, ((pageY2 - blockY2) / height) * 100)}%`,
      width: `${Math.min(100, ((blockX2 - blockX1) / width) * 100)}%`,
      height: `${Math.min(100, ((blockY2 - blockY1) / height) * 100)}%`,
    };
  })();

  return (
    <section className="phase2-mapping-side phase2-pdf-block">
      <header>
        <div>
          <h4>PDF 블록</h4>
          <b>{metricLabels[entry.metric] ?? entry.metric}</b>
        </div>
        <span data-confidence={confidence.level}>{confidence.label}</span>
      </header>
      <div className="phase2-pdf-boundary" aria-label="PDF 페이지 블록 위치">
        <i style={blockStyle} />
        <small>{block ? `${block.pageNumber}페이지` : "페이지 미확인"}</small>
      </div>
      <dl>
        <div>
          <dt>분류</dt>
          <dd>{block?.classification ?? block?.role ?? entry.kind}</dd>
        </div>
        <div>
          <dt>경계 좌표</dt>
          <dd>{bboxLabel(block?.bbox ?? null)}</dd>
        </div>
        <div>
          <dt>형상 지문</dt>
          <dd>{shortFingerprint(block?.geometryFingerprint)}</dd>
        </div>
      </dl>
      {(block?.reasonCodes.length ?? 0) > 0 && (
        <ul className="phase2-analysis-reasons" aria-label="PDF 감지 근거">
          {block?.reasonCodes.slice(0, 3).map((code) => (
            <li key={code}>{analysisReasonCopy(code)}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

function CandidatePreview({ candidate }: { candidate: MappingCandidate | undefined }) {
  if (!candidate) {
    return (
      <p className="phase2-candidate-empty">
        후보를 선택하면 값·구조·서식 정보를 비교할 수 있습니다.
      </p>
    );
  }
  const { preview } = candidate;
  const confidence = analysisConfidenceCopy(candidate.score);
  return (
    <div className="phase2-candidate-preview">
      <div className="phase2-candidate-confidence">
        <span data-confidence={confidence.level}>{confidence.label}</span>
        <small>
          구조 지문 {shortFingerprint(preview.structureFingerprint)}
        </small>
      </div>
      {preview.kind === "cell" && (
        <dl>
          <div>
            <dt>표시 값</dt>
            <dd>{preview.displayValue || "빈 값"}</dd>
          </div>
          <div>
            <dt>숫자 서식</dt>
            <dd>{preview.numberFormat || "일반"}</dd>
          </div>
        </dl>
      )}
      {preview.kind === "range" && (
        <>
          <dl>
            <div>
              <dt>범위 크기</dt>
              <dd>{preview.rowCount ?? 0}행 × {preview.columnCount ?? 0}열</dd>
            </div>
            <div>
              <dt>병합 셀</dt>
              <dd>{preview.mergedRanges?.length ?? 0}개</dd>
            </div>
          </dl>
          <p>
            헤더 미리보기 ·{" "}
            {preview.headerValues?.slice(0, 5).join(" · ") || "감지되지 않음"}
          </p>
        </>
      )}
      {preview.kind === "chart" && (
        <div className="phase2-series-preview">
          <b>계열 미리보기</b>
          <ul>
            {preview.series?.slice(0, 4).map((series, index) => (
              <li key={`${series.valueRange}-${index}`}>
                {series.label || `계열 ${index + 1}`} · {series.chartType || "chart"} ·{" "}
                {series.axis === "secondary" ? "보조축" : "주축"}
              </li>
            ))}
          </ul>
        </div>
      )}
      {preview.kind === "market_data" && (
        <dl>
          <div>
            <dt>공급자</dt>
            <dd>{preview.provider ?? "KRX"}</dd>
          </div>
          <div>
            <dt>거래일</dt>
            <dd>{preview.tradingDate ?? "기준일"}</dd>
          </div>
        </dl>
      )}
      <ul className="phase2-analysis-reasons" aria-label="Excel 후보 근거">
        {candidate.reasonCodes.slice(0, 3).map((code) => (
          <li key={code}>{analysisReasonCopy(code)}</li>
        ))}
      </ul>
    </div>
  );
}

function MappingEditor({
  entries,
  versionId,
  saving,
  onSave,
}: {
  entries: MappingEntry[];
  versionId: string | undefined;
  saving: boolean;
  onSave: (
    selections: Array<{ entryId: string; candidateId: string | null }>,
  ) => Promise<void>;
}) {
  const [selections, setSelections] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      entries.map((entry) => [entry.entryId, entry.selectedCandidateId ?? ""]),
    ),
  );
  return (
    <div className="phase2-mapping-editor" data-mapping-version={versionId}>
      {entries.map((entry) => {
        const krxCandidate = entry.candidates.find(
          (candidate) => candidate.sourceType === "market_data",
        );
        const displayedCandidates =
          entry.metric === "current_price" && krxCandidate
            ? [krxCandidate]
            : entry.candidates;
        const selectedCandidate = displayedCandidates.find(
          (candidate) => candidate.candidateId === selections[entry.entryId],
        );
        return (
          <label
            key={entry.entryId}
            className={`phase2-mapping-comparison${
              entry.required && !selections[entry.entryId] ? " needs-selection" : ""
            }`}
          >
            <PdfBlockPreview entry={entry} />
            <section className="phase2-mapping-side phase2-excel-candidate">
              <header>
                <div>
                  <h4>Excel 후보</h4>
                  <small>
                    {entry.required ? "필수" : "선택"} ·{" "}
                    {krxCandidate ? "KRX 기준일 종가" : entry.kind}
                  </small>
                </div>
              </header>
              <select
                aria-label={`${metricLabels[entry.metric] ?? entry.metric} Excel 후보`}
                value={selections[entry.entryId] ?? ""}
                disabled={Boolean(krxCandidate)}
                onChange={(event) =>
                  setSelections((current) => ({
                    ...current,
                    [entry.entryId]: event.target.value,
                  }))
                }
              >
                <option value="">원본을 선택하세요</option>
                {displayedCandidates.map((candidate) => (
                  <option key={candidate.candidateId} value={candidate.candidateId}>
                    {candidate.sourceType === "market_data"
                      ? candidate.label
                      : `${candidate.sheetName}!${candidate.address}${
                          candidate.label ? ` · ${candidate.label}` : ""
                        }`}
                    {` · ${Math.round(candidate.score * 100)}%`}
                  </option>
                ))}
              </select>
              <CandidatePreview candidate={selectedCandidate} />
            </section>
          </label>
        );
      })}
      {entries.length === 0 && (
        <p className="phase2-mapping-empty">
          PDF 또는 Excel 분석이 차단되어 매핑 후보를 만들지 못했습니다.
        </p>
      )}
      {entries.length > 0 && (
        <button
          type="button"
          className="phase2-mapping-save"
          disabled={saving}
          onClick={() =>
            void onSave(
              entries.map((entry) => ({
                entryId: entry.entryId,
                candidateId: selections[entry.entryId] || null,
              })),
            )
          }
        >
          {saving ? "새 버전 저장 중" : "매핑 보정 저장"}
        </button>
      )}
    </div>
  );
}

function ResultDialog({
  inspection,
  completing,
  savingMapping,
  onClose,
  onComplete,
  onSaveMapping,
}: {
  inspection: InspectionProjection;
  completing: boolean;
  savingMapping: boolean;
  onClose: () => void;
  onComplete: () => void;
  onSaveMapping: (
    selections: Array<{ entryId: string; candidateId: string | null }>,
  ) => Promise<void>;
}) {
  const [tab, setTab] = useState<"pdf" | "excel" | "mapping">("pdf");
  const mappingEntries = (inspection.mappingSet?.entries ?? []).filter(
    (entry) => entry.metric !== "investment_opinion",
  );
  const visibleBindingCount = mappingEntries.filter(
    (entry) => entry.selectedCandidateId,
  ).length;
  const analysis = inspection.analysis;
  return (
    <div
      className="phase2-modal-backdrop"
      onMouseDown={(event) => event.currentTarget === event.target && onClose()}
    >
      <section
        className="phase2-result-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="phase2-result-title"
      >
        <header>
          <div>
            <span>FILE INSPECTION</span>
            <h2 id="phase2-result-title">
              {inspection.outcome === "passed"
                ? "분석과 필수 매핑을 모두 확인했습니다."
                : "확인이 필요한 분석·매핑 항목이 있습니다."}
            </h2>
            <p>원본, 상세 분석 IR, 매핑 버전은 프로젝트에 함께 보존됩니다.</p>
          </div>
          <button onClick={onClose} aria-label="검사 결과 닫기">
            ×
          </button>
        </header>
        <nav role="tablist" aria-label="파일 검사 결과">
          {[
            ["pdf", "PDF 템플릿"],
            ["excel", "Excel 모델"],
            ["mapping", "PDF·데이터 연결"],
          ].map(([value, label]) => (
            <button
              key={value}
              role="tab"
              aria-selected={tab === value}
              className={tab === value ? "active" : ""}
              onClick={() => setTab(value as typeof tab)}
            >
              {label}
            </button>
          ))}
        </nav>
        <div className="phase2-result-body">
          {tab === "pdf" && (
            <section>
              <span>PDF 분석 결과</span>
              <h3>페이지·블록·슬롯·물리 객체</h3>
              <p>
                페이지 좌표계와 텍스트, 벡터 경로, 이미지, 글꼴을 추출해 재사용할
                템플릿 구조를 만들었습니다.
              </p>
              <dl>
                <div>
                  <dt>결과 버전</dt>
                  <dd>v{inspection.resultVersions?.template ?? "—"}</dd>
                </div>
                <div>
                  <dt>페이지</dt>
                  <dd>{analysis?.pdf.pageCount ?? "—"}개</dd>
                </div>
                <div>
                  <dt>블록 / 슬롯</dt>
                  <dd>
                    {analysis
                      ? `${analysis.pdf.blockCount} / ${analysis.pdf.slotCount}`
                      : "—"}
                  </dd>
                </div>
                <div>
                  <dt>물리 객체</dt>
                  <dd>{analysis?.pdf.objectCount.toLocaleString() ?? "—"}개</dd>
                </div>
                <div>
                  <dt>글꼴 / 이미지</dt>
                  <dd>
                    {analysis
                      ? `${analysis.pdf.fontCount} / ${analysis.pdf.imageCount}`
                      : "—"}
                  </dd>
                </div>
                <div>
                  <dt>표 / 차트</dt>
                  <dd>
                    {analysis
                      ? `${analysis.pdf.tableCount} / ${analysis.pdf.chartCount}`
                      : "—"}
                  </dd>
                </div>
                <div>
                  <dt>분석 경고</dt>
                  <dd>{analysis?.pdf.warningCount ?? "—"}건</dd>
                </div>
              </dl>
            </section>
          )}
          {tab === "excel" && (
            <section>
              <span>Excel 분석 결과</span>
              <h3>시트·수식·편집 셀·모델 구조</h3>
              <p>
                workbook을 계산 엔진으로 열어 수식, 병합, 이름 범위, 표·차트,
                편집 가능 셀과 외부 연결을 검사했습니다.
              </p>
              <dl>
                <div>
                  <dt>결과 버전</dt>
                  <dd>v{inspection.resultVersions?.workbook ?? "—"}</dd>
                </div>
                <div>
                  <dt>시트 / 숨김</dt>
                  <dd>
                    {analysis
                      ? `${analysis.workbook.sheetCount} / ${analysis.workbook.hiddenSheetCount}`
                      : "—"}
                  </dd>
                </div>
                <div>
                  <dt>사용 셀</dt>
                  <dd>{analysis?.workbook.usedCellCount.toLocaleString() ?? "—"}개</dd>
                </div>
                <div>
                  <dt>수식</dt>
                  <dd>{analysis?.workbook.formulaCount.toLocaleString() ?? "—"}개</dd>
                </div>
                <div>
                  <dt>입력 셀</dt>
                  <dd>{analysis?.workbook.editableCellCount.toLocaleString() ?? "—"}개</dd>
                </div>
                <div>
                  <dt>병합 / 이름 범위</dt>
                  <dd>
                    {analysis
                      ? `${analysis.workbook.mergedRangeCount} / ${analysis.workbook.namedRangeCount}`
                      : "—"}
                  </dd>
                </div>
                <div>
                  <dt>외부 연결</dt>
                  <dd>{analysis?.workbook.externalLinkCount ?? "—"}개</dd>
                </div>
              </dl>
            </section>
          )}
          {tab === "mapping" && (
            <section>
              <span>연결 결과</span>
              <h3>PDF 구성과 데이터 원본 연결</h3>
              <p>
                현재주가는 KRX 기준일 종가로 고정하고, 나머지 의미 슬롯은 Excel
                셀·범위 후보와 신뢰도를 확인합니다.
              </p>
              <dl>
                <div>
                  <dt>매핑 버전</dt>
                  <dd>v{inspection.resultVersions?.mappingSet ?? "—"}</dd>
                </div>
                <div>
                  <dt>연결 / 전체 슬롯</dt>
                  <dd>
                    {inspection.mappingSet
                      ? `${visibleBindingCount} / ${mappingEntries.length}`
                      : "—"}
                  </dd>
                </div>
                <div>
                  <dt>미매핑 필수</dt>
                  <dd>{inspection.mappingSet?.summary.unmappedRequiredCount ?? "—"}개</dd>
                </div>
              </dl>
              <MappingEditor
                key={inspection.mappingSet?.versionId}
                entries={mappingEntries}
                versionId={inspection.mappingSet?.versionId}
                saving={savingMapping}
                onSave={onSaveMapping}
              />
            </section>
          )}
          {inspection.issues.length > 0 && (
            <ul className="phase2-issue-list">
              {inspection.issues.map((issue, index) => (
                <li key={`${issue.code}-${index}`}>
                  <b>{issue.severity === "blocking" ? "차단" : "안내"}</b>
                  <span>{issue.message}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <footer>
          <span>
            {inspection.outcome === "passed"
              ? "결과를 확정하면 투자 의견·조사 질문 단계가 열립니다."
              : mappingEntries.length > 0
                ? "필수 매핑을 모두 선택하면 다음 단계로 진행할 수 있습니다."
                : "차단 원인을 해결한 파일로 교체한 뒤 새 검사를 실행하세요."}
          </span>
          {inspection.outcome === "passed" && (
            <button disabled={completing} onClick={onComplete}>
              {completing ? "확정 중" : "결과 확정 · 다음"} <b>›</b>
            </button>
          )}
        </footer>
      </section>
    </div>
  );
}

export function FilesScreen({ projectId }: { projectId: string }) {
  const router = useRouter();
  const { session } = useSession();
  const [bootstrap, setBootstrap] = useState<FilesBootstrap | null>(null);
  const [pageError, setPageError] = useState("");
  const [uploads, setUploads] = useState<Record<FileRole, UploadUi>>({
    previous_report_pdf: emptyUpload(),
    analysis_workbook: emptyUpload(),
  });
  const [starting, setStarting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [savingMapping, setSavingMapping] = useState(false);
  const [showResult, setShowResult] = useState(false);
  const xhrAbort = useRef<Partial<Record<FileRole, () => void>>>({});

  const load = useCallback(async () => {
    if (session.status !== "authenticated") return;
    try {
      const result = await apiJson<FilesBootstrap>(
        `/api/projects/${projectId}/process/files`,
      );
      setBootstrap(result);
      setPageError("");
      if (
        result.inspection?.operationStatus === "succeeded" &&
        result.inspection.outcome
      ) {
        setShowResult(true);
      }
    } catch (error) {
      if (error instanceof ClientApiError && error.status === 401) {
        window.location.href = googleLoginUrl(
          `/projects/${projectId}/process/files`,
        );
        return;
      }
      if (
        error instanceof ClientApiError &&
        error.body.error.code === "FILES_PREREQUISITE_INCOMPLETE"
      ) {
        router.replace(
          (error.body.error.meta.resumeRoute as string) ||
            `/projects/${projectId}/process/setup`,
        );
        return;
      }
      setPageError(
        error instanceof Error ? error.message : "파일 상태를 불러오지 못했습니다.",
      );
    }
  }, [projectId, router, session.status]);

  useEffect(() => {
    if (session.status === "anonymous") {
      window.location.href = googleLoginUrl(
        `/projects/${projectId}/process/files`,
      );
      return;
    }
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load, projectId, session.status]);

  const active = useMemo(
    () =>
      Boolean(
        bootstrap?.slots.some((slot) => slot.status === "scanning") ||
          (bootstrap?.inspection &&
            ["queued", "running", "cancel_requested"].includes(
              bootstrap.inspection.operationStatus,
            )),
      ),
    [bootstrap],
  );

  useEffect(() => {
    if (!active) return;
    let delay = 3000;
    let timer: number | undefined;
    let stopped = false;
    const poll = async () => {
      if (document.hidden || stopped) return;
      try {
        await load();
        delay = 3000;
      } catch {
        delay = Math.min(delay * 2, 30_000);
      }
      if (!stopped) timer = window.setTimeout(() => void poll(), delay);
    };
    const onVisible = () => {
      if (!document.hidden) {
        if (timer) window.clearTimeout(timer);
        void poll();
      }
    };
    timer = window.setTimeout(() => void poll(), delay);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      stopped = true;
      if (timer) window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [active, load]);

  const uploadFile = async (role: FileRole, file: File) => {
    if (session.status !== "authenticated") return;
    const content = roleContent[role];
    const slot = bootstrap?.slots.find((item) => item.role === role);
    if (!slot) return;
    setUploads((current) => ({
      ...current,
      [role]: {
        fileName: file.name,
        progress: 0,
        state: "hashing",
        message: "파일 checksum 계산 중",
      },
    }));
    try {
      if (file.size > slot.maxSizeBytes) {
        throw new Error(`최대 ${bytesLabel(slot.maxSizeBytes)}까지 업로드할 수 있습니다.`);
      }
      const checksumSha256 = await sha256(file);
      const upload = await apiJson<{
        uploadId: string;
        uploadUrl: string;
        headers: Record<string, string>;
      }>(`/api/projects/${projectId}/files/upload-sessions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": session.csrfToken,
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({
          role,
          filename: file.name,
          byteSize: file.size,
          mediaType: content.mediaType,
          checksumSha256,
        }),
      });
      setUploads((current) => ({
        ...current,
        [role]: {
          fileName: file.name,
          progress: 0,
          state: "uploading",
          message: "격리 저장소로 전송 중",
        },
      }));
      const transfer = putFile(upload.uploadUrl, upload.headers, file, (progress) => {
        setUploads((current) => ({
          ...current,
          [role]: { ...current[role], progress },
        }));
      });
      xhrAbort.current[role] = transfer.abort;
      await transfer.promise;
      delete xhrAbort.current[role];
      setUploads((current) => ({
        ...current,
        [role]: {
          ...current[role],
          progress: 100,
          state: "verifying",
          message: "checksum·형식·악성 여부 확인 중",
        },
      }));
      await apiJson(
        `/api/projects/${projectId}/files/upload-sessions/${upload.uploadId}/complete`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-CSRF-Token": session.csrfToken,
            "Idempotency-Key": crypto.randomUUID(),
          },
          body: JSON.stringify({ checksumSha256 }),
        },
      );
      setUploads((current) => ({ ...current, [role]: emptyUpload() }));
      await load();
    } catch (error) {
      if ((error as Error).name === "AbortError") {
        setUploads((current) => ({ ...current, [role]: emptyUpload() }));
        return;
      }
      setUploads((current) => ({
        ...current,
        [role]: {
          ...current[role],
          state: "failed",
          message:
            error instanceof Error ? error.message : "파일을 업로드하지 못했습니다.",
        },
      }));
    }
  };

  const startInspection = async () => {
    if (session.status !== "authenticated" || !bootstrap) return;
    const pdf = bootstrap.slots.find(
      (slot) => slot.role === "previous_report_pdf",
    )?.currentFile;
    const workbook = bootstrap.slots.find(
      (slot) => slot.role === "analysis_workbook",
    )?.currentFile;
    if (!pdf || !workbook) return;
    setStarting(true);
    setShowResult(false);
    try {
      await apiJson(`/api/projects/${projectId}/file-inspections`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": session.csrfToken,
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({
          pdfFileVersionId: pdf.fileVersionId,
          workbookFileVersionId: workbook.fileVersionId,
        }),
      });
      await load();
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "검사를 시작하지 못했습니다.");
    } finally {
      setStarting(false);
    }
  };

  const cancelInspection = async () => {
    if (
      session.status !== "authenticated" ||
      !bootstrap?.inspection
    ) {
      return;
    }
    setCancelling(true);
    try {
      await apiJson(
        `/api/projects/${projectId}/file-inspections/${bootstrap.inspection.inspectionId}/cancel`,
        {
          method: "POST",
          headers: {
            "X-CSRF-Token": session.csrfToken,
            "Idempotency-Key": crypto.randomUUID(),
          },
        },
      );
      await load();
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "취소 요청을 반영하지 못했습니다.");
    } finally {
      setCancelling(false);
    }
  };

  const retryInspection = async () => {
    if (session.status !== "authenticated" || !bootstrap?.inspection) return;
    setStarting(true);
    try {
      await apiJson(
        `/api/projects/${projectId}/file-inspections/${bootstrap.inspection.inspectionId}/retry`,
        {
          method: "POST",
          headers: {
            "X-CSRF-Token": session.csrfToken,
            "Idempotency-Key": crypto.randomUUID(),
          },
        },
      );
      await load();
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "검사를 다시 시작하지 못했습니다.");
    } finally {
      setStarting(false);
    }
  };

  const complete = async () => {
    if (
      session.status !== "authenticated" ||
      !bootstrap?.inspection?.resultVersions
    ) {
      return;
    }
    setCompleting(true);
    try {
      const result = await apiJson<{ nextUrl: string }>(
        `/api/projects/${projectId}/process/files/complete`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-CSRF-Token": session.csrfToken,
            "Idempotency-Key": crypto.randomUUID(),
          },
          body: JSON.stringify({
            inspectionId: bootstrap.inspection.inspectionId,
            templateVersion: bootstrap.inspection.resultVersions.template,
            workbookVersion: bootstrap.inspection.resultVersions.workbook,
            mappingSetVersion: bootstrap.inspection.resultVersions.mappingSet,
            expectedProjectVersion: bootstrap.projectVersion,
          }),
        },
      );
      router.push(result.nextUrl);
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "결과를 확정하지 못했습니다.");
      setShowResult(false);
    } finally {
      setCompleting(false);
    }
  };

  const saveMapping = async (
    selections: Array<{ entryId: string; candidateId: string | null }>,
  ) => {
    if (
      session.status !== "authenticated" ||
      !bootstrap?.inspection?.mappingSet
    ) {
      return;
    }
    setSavingMapping(true);
    try {
      await apiJson(
        `/api/projects/${projectId}/mapping-sets/${bootstrap.inspection.mappingSet.versionId}/revisions`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-CSRF-Token": session.csrfToken,
            "Idempotency-Key": crypto.randomUUID(),
          },
          body: JSON.stringify({
            expectedVersion: bootstrap.inspection.mappingSet.version,
            selections,
          }),
        },
      );
      await load();
      setShowResult(true);
    } catch (error) {
      setPageError(
        error instanceof Error ? error.message : "매핑 보정을 저장하지 못했습니다.",
      );
    } finally {
      setSavingMapping(false);
    }
  };

  if (!bootstrap) {
    return (
      <div className="phase1-page-loading" aria-label="파일 상태 불러오는 중">
        <i className="phase1-spinner" />
        <strong>{pageError || "파일 상태를 불러오고 있습니다."}</strong>
        {pageError && <button onClick={() => void load()}>다시 시도</button>}
      </div>
    );
  }

  const inspection = bootstrap.inspection;
  const slotsReady = bootstrap.slots.every((slot) => slot.status === "ready");
  const inspectionActive = Boolean(
    inspection &&
      ["queued", "running", "cancel_requested"].includes(
        inspection.operationStatus,
      ),
  );
  const workflowProgress = Math.round(
    (bootstrap.workflow.stageStates.filter((stage) => stage.status === "completed")
      .length /
      7) *
      100,
  );

  return (
    <div className="planned-process-page phase2-files-page">
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
          {bootstrap.project.company && (
            <span>
              <b>보고서 기준일</b>
              <small>{bootstrap.project.company.cutoffDate}</small>
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
              {bootstrap.project.company
                ? `${bootstrap.project.company.ticker} · ${bootstrap.project.company.targetPeriod.year}년 ${bootstrap.project.company.targetPeriod.quarter}분기`
                : "프로젝트 설정 확인 필요"}
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
                const accessible = bootstrap.workflow.allowedRoutes.includes(stage.route);
                const activeStage = stage.stageKey === "files";
                return (
                  <button
                    key={stage.stageKey}
                    className={`${activeStage ? "active" : ""} ${
                      stage.status === "completed" ? "done" : ""
                    }`}
                    disabled={!accessible || activeStage}
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
                    {activeStage && <em />}
                  </button>
                );
              })}
            </section>
          </nav>
        </aside>
        <main className="spec-main">
          <div className="spec-screen phase2-files-screen">
            <div className="spec-screen-head">
              <div>
                <p>STEP 02</p>
                <h1>필수 파일 업로드 · 적합성 검사</h1>
                <span>
                  이전 분기 PDF와 실제 분석 Excel을 업로드하고 제작 호환성을 확인합니다.
                </span>
              </div>
            </div>
            {pageError && (
              <section className="phase1-inline-error" role="alert">
                {pageError}
                <button onClick={() => setPageError("")}>닫기</button>
              </section>
            )}
            <div className="spec-upload-grid">
              {(["previous_report_pdf", "analysis_workbook"] as FileRole[]).map(
                (role) => {
                  const slot = bootstrap.slots.find((item) => item.role === role)!;
                  return (
                    <UploadCard
                      key={role}
                      role={role}
                      slot={slot}
                      ui={uploads[role]}
                      disabled={inspectionActive}
                      onSelect={(file) => void uploadFile(role, file)}
                      onCancel={() => xhrAbort.current[role]?.()}
                    />
                  );
                },
              )}
            </div>
            {slotsReady ? (
              <section
                className={`spec-panel spec-check-result phase2-inspection-card ${
                  inspection?.outcome === "failed" || inspection?.operationStatus === "failed"
                    ? "has-error"
                    : ""
                }`}
              >
                <div>
                  <span
                    className={`phase2-status ${
                      inspection?.outcome === "passed"
                        ? "passed"
                        : inspectionActive
                          ? "running"
                          : inspection?.outcome === "failed"
                            ? "blocked"
                            : ""
                    }`}
                  >
                    {inspection?.outcome === "passed"
                      ? "검사 통과"
                      : inspectionActive
                        ? "검사 중"
                        : inspection?.outcome === "failed"
                          ? "확인 필요"
                          : "검사 대기"}
                  </span>
                  <h3>
                    {inspectionActive
                      ? phaseLabel(inspection?.phase ?? null)
                      : inspection?.outcome === "passed"
                        ? "두 파일을 이번 프로젝트에 사용할 수 있습니다."
                        : inspection?.outcome === "failed"
                          ? "차단 항목을 확인하고 파일을 교체해주세요."
                          : "두 파일의 제작 호환성을 검사할 준비가 되었습니다."}
                  </h3>
                  <p>
                    {inspectionActive
                      ? "브라우저를 닫아도 서버 작업은 계속됩니다."
                      : "PDF 템플릿, Excel 구조와 두 파일의 연결을 함께 확인합니다."}
                  </p>
                </div>
                {inspectionActive && (
                  <div className="phase2-job-progress" aria-live="polite">
                    <i>
                      <b style={{ width: `${inspection?.progressPercent ?? 0}%` }} />
                    </i>
                    <span>{inspection?.progressPercent ?? 0}%</span>
                  </div>
                )}
                <div className="phase2-inspection-actions">
                  {inspectionActive ? (
                    <button
                      className="secondary"
                      disabled={cancelling || inspection?.operationStatus === "cancel_requested"}
                      onClick={() => void cancelInspection()}
                    >
                      {cancelling ? "취소 요청 중" : "검사 취소"}
                    </button>
                  ) : inspection?.outcome ? (
                    <>
                      <button className="secondary" onClick={() => void startInspection()}>
                        다시 검사
                      </button>
                      <button className="primary" onClick={() => setShowResult(true)}>
                        결과 확인
                      </button>
                    </>
                  ) : inspection?.operationStatus === "failed" && inspection.retryable ? (
                    <button className="primary" disabled={starting} onClick={() => void retryInspection()}>
                      다시 시도
                    </button>
                  ) : (
                    <button
                      className="primary"
                      disabled={starting}
                      onClick={() => void startInspection()}
                    >
                      {starting ? "검사 시작 중" : "검사 실행"}
                    </button>
                  )}
                </div>
              </section>
            ) : (
              <section className="spec-requirement-note">
                <i>!</i>
                <div>
                  <strong>두 파일의 서버 검사가 모두 끝나야 호환성 검사를 시작할 수 있습니다.</strong>
                  <p>업로드 원본은 격리 영역에서 형식·checksum·악성 여부를 먼저 확인합니다.</p>
                </div>
              </section>
            )}
          </div>
        </main>
      </div>
      {showResult && inspection?.outcome && (
        <ResultDialog
          key={inspection.inspectionId}
          inspection={inspection}
          completing={completing}
          savingMapping={savingMapping}
          onClose={() => setShowResult(false)}
          onComplete={() => void complete()}
          onSaveMapping={saveMapping}
        />
      )}
    </div>
  );
}
