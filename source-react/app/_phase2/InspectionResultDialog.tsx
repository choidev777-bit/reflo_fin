"use client";

import { useMemo, useState } from "react";
import {
  analysisConfidenceCopy,
  analysisReasonCopy,
} from "./analysis-copy";
import { pdfPreviewBlockStyle } from "./pdf-preview-geometry";
import type { InspectionProjection } from "./types";

type MappingEntry = NonNullable<
  InspectionProjection["mappingSet"]
>["entries"][number];
type MappingCandidate = MappingEntry["candidates"][number];
type ConnectionStatus =
  | "connected"
  | "period_refresh"
  | "external"
  | "input"
  | "source_and_input"
  | "valuation"
  | "later"
  | "review"
  | "fixed"
  | "optional";

const metricLabels: Record<string, string> = {
  target_price: "목표주가",
  current_price: "현재주가",
  revenue: "매출액",
  operating_profit: "영업이익",
  net_income: "순이익",
  eps: "Forward EPS",
  forward_eps: "Forward EPS",
  per: "적용 PER",
  target_per: "적용 PER",
  investment_opinion: "투자의견",
  quarterly_performance_table: "분기별 실적 전망",
  segment_revenue_table: "부문별 매출",
  target_price_history_table: "목표주가 변경 이력",
  valuation_bridge_table: "도표 1. Valuation",
  income_statement_table: "손익계산서",
  balance_sheet_table: "대차대조표",
  investment_indicators_table: "투자지표",
  cash_flow_statement_table: "현금흐름표",
  financial_income_statement_table: "손익계산서",
  financial_balance_sheet_table: "대차대조표",
  financial_investment_indicators_table: "투자지표",
  financial_cash_flow_table: "현금흐름표",
  key_data: "Key Data",
  consensus_data: "Consensus Data",
  stock_price: "Stock Price",
  financial_data: "Financial Data",
  figure_1_chart: "도표 1. Valuation",
  figure_2_chart: "도표 2. 12MF P/E Band",
  figure_3_chart: "도표 3. 12MF P/B Band",
  figure_4_chart: "도표 4. 분기별 실적 추이",
  figure_5_chart: "도표 5. 분기별 수주잔고 추이",
  figure_6_chart: "도표 6. 분기별 실적 전망 수정 후",
  figure_7_chart: "도표 7. 분기별 실적 전망 수정 전",
};

const destinationByMetric: Record<string, string> = {
  target_price: "M2_목표주가_타겟멀티플",
  eps: "M2_목표주가_타겟멀티플",
  forward_eps: "M2_목표주가_타겟멀티플",
  per: "M2_목표주가_타겟멀티플",
  target_per: "M2_목표주가_타겟멀티플",
  key_data: "01A_p1_KeyData",
  consensus_data: "02_p1_Consensus",
  stock_price: "03_p1_주가추이",
  financial_data: "04_p1_FinancialData",
  valuation_bridge_table: "05_도표1_Valuation",
  figure_1_chart: "05_도표1_Valuation",
  figure_2_chart: "06_도표2_PER_Band",
  figure_3_chart: "07_도표3_PBR_Band",
  figure_4_chart: "08_도표4_분기실적추이",
  figure_5_chart: "09_도표5_수주잔고추이",
  figure_6_chart: "10_도표6_분기실적전망_수정후",
  figure_7_chart: "11_도표7_분기실적전망_수정전",
  quarterly_performance_table: "10 · 11 분기실적전망",
  income_statement_table: "12_p4_손익계산서",
  balance_sheet_table: "13_p4_대차대조표",
  investment_indicators_table: "14_p4_투자지표",
  cash_flow_statement_table: "15_p4_현금흐름표",
  financial_income_statement_table: "12_p4_손익계산서",
  financial_balance_sheet_table: "13_p4_대차대조표",
  financial_investment_indicators_table: "14_p4_투자지표",
  financial_cash_flow_table: "15_p4_현금흐름표",
};

const syntheticWritingItems = [
  {
    id: "report-date",
    field: "reportDate",
    label: "작성 기준일",
    source: "프로젝트 기준일",
  },
  {
    id: "report-title",
    field: "reportTitle",
    label: "보고서 제목",
    source: "조사 결과 기반 AI 제안",
  },
] as const;

const statusMeta: Record<
  ConnectionStatus,
  { label: string; description: string }
> = {
  connected: {
    label: "Excel 위치 연결",
    description: "현재 Excel 원본 위치를 그대로 사용할 수 있습니다.",
  },
  period_refresh: {
    label: "기간 갱신 필요",
    description: "새 보고서 기간에 맞게 열과 수식을 갱신해야 합니다.",
  },
  external: {
    label: "자료 수집 필요",
    description: "자료 수집 단계에서 최신 원본을 연결합니다.",
  },
  input: {
    label: "사용자 입력 필요",
    description: "Excel 입력 단계에서 전망값을 확정합니다.",
  },
  source_and_input: {
    label: "자료 수집·입력",
    description: "실제값 수집과 전망값 입력이 모두 필요합니다.",
  },
  valuation: {
    label: "밸류에이션 단계",
    description: "밸류에이션 계산 결과로 확정합니다.",
  },
  later: {
    label: "후속 단계",
    description: "후속 의사결정 또는 초안 작성 단계에서 생성합니다.",
  },
  review: {
    label: "연결 확인 필요",
    description: "Excel 원본 위치를 확인해야 합니다.",
  },
  fixed: { label: "유지", description: "원본 레이아웃과 문구를 유지합니다." },
  optional: { label: "선택", description: "현재 원본을 선택적으로 사용합니다." },
};

function metricLabel(metric: string): string {
  return metricLabels[metric] ?? metric.replaceAll("_", " ");
}

function effectiveCandidateId(
  entry: MappingEntry,
  selectedCandidateId = entry.selectedCandidateId,
): string | null {
  const candidate = entry.candidates.find(
    (item) => item.candidateId === selectedCandidateId,
  );
  if (
    entry.plan?.exclusiveSource &&
    candidate?.sourceType !== "market_data"
  ) {
    return null;
  }
  return selectedCandidateId;
}

function connectionStatus(
  entry: MappingEntry,
  selectedCandidateId = entry.selectedCandidateId,
): ConnectionStatus {
  const effectiveId = effectiveCandidateId(entry, selectedCandidateId);
  const candidate = entry.candidates.find(
    (item) => item.candidateId === effectiveId,
  );
  if (candidate) {
    switch (candidate.dataReadiness.state) {
      case "period_refresh_required":
        return "period_refresh";
      case "source_collection_required":
        return "external";
      case "user_input_required":
        return "input";
      case "source_and_input_required":
        return "source_and_input";
      case "valuation_required":
        return "valuation";
      case "later_stage":
        return "later";
      case "review_required":
        return "review";
      default:
        return "connected";
    }
  }
  if (entry.plan?.resolution === "external_pending") return "external";
  if (entry.plan?.resolution === "later_stage") return "later";
  // 후보가 하나도 없으면 이 화면에는 고를 것이 없다. 원본 선택 dropdown은
  // 후보가 있을 때만 그려지므로, review로 두면 사용자가 할 수 있는 일이 없는
  // 채로 완료 버튼이 `원본 확인 필요`에 영구히 잠긴다. 서버의 게이트 규칙
  // (requiredSlotBlocksInspection)과 같은 기준을 쓴다.
  if (entry.candidates.length === 0) return "later";
  if (entry.required) return "review";
  return "optional";
}

function selectedCandidate(
  entry: MappingEntry,
  selectedCandidateId = entry.selectedCandidateId,
): MappingCandidate | undefined {
  const effectiveId = effectiveCandidateId(entry, selectedCandidateId);
  return entry.candidates.find((candidate) => candidate.candidateId === effectiveId);
}

function candidateLabel(candidate: MappingCandidate | undefined): string {
  if (!candidate) return "연결된 원본 없음";
  if (candidate.sourceType === "market_data") {
    return candidate.label ?? "KRX 기준일 종가";
  }
  return `${candidate.sheetName}!${candidate.address}`;
}

function sheetRole(
  sheetName: string,
): "model" | "calculation" | "output" | "source" | "other" {
  if (/^M[12]_/.test(sheetName)) return "model";
  if (/^M3_|^99_/.test(sheetName)) return "calculation";
  if (/^(?:0[1-9]|1[0-9])[A-Z]?_/.test(sheetName)) return "output";
  if (/^(?:D\d+_|Z(?:\d+)?_|_REFLO)/.test(sheetName)) return "source";
  return "other";
}

const sheetRoleCopy = {
  model: "모델 입력",
  calculation: "계산 · 검증",
  output: "PDF 출력",
  source: "원천 · 시스템",
  other: "기타",
} as const;

function pageSubject(
  pageNumber: number,
  pageCount: number,
  metrics: string[],
): string {
  if (pageNumber === 1) return "핵심 요약";
  if (metrics.some((metric) => /figure_[1-5]_chart/.test(metric))) {
    return "밸류에이션 · 도표";
  }
  if (
    metrics.some((metric) =>
      /quarterly|figure_[67]_chart/.test(metric),
    )
  ) {
    return "실적 전망";
  }
  if (
    metrics.some((metric) =>
      /statement|indicators|financial_/.test(metric),
    )
  ) {
    return "재무제표";
  }
  if (pageNumber === pageCount) return "고지 · 컴플라이언스";
  return "보고서 구성";
}

function ResultStatus({
  status,
}: {
  status: ConnectionStatus;
}) {
  return (
    <span className="phase2-result-status" data-status={status}>
      {statusMeta[status].label}
    </span>
  );
}

function PdfStructurePanel({
  inspection,
  entries,
  selections,
  onSelectionChange,
}: {
  inspection: InspectionProjection;
  entries: MappingEntry[];
  selections: Record<string, string>;
  onSelectionChange: (entryId: string, candidateId: string) => void;
}) {
  const pages = inspection.analysis?.pdf.pages ?? [];
  const [selectedPage, setSelectedPage] = useState(pages[0]?.pageNumber ?? 1);
  const currentPage =
    pages.find((page) => page.pageNumber === selectedPage) ?? pages[0];
  const pageCount = pages.length || inspection.analysis?.pdf.pageCount || 0;
  const entryBySlot = useMemo(
    () => new Map(entries.map((entry) => [entry.slotId, entry])),
    [entries],
  );
  const actualItems = (currentPage?.slots ?? []).map((slot) => {
    const entry = entryBySlot.get(slot.slotId);
    const selectedId = entry ? selections[entry.entryId] || null : null;
    return {
      id: slot.slotId,
      label: metricLabel(slot.metric),
      kind:
        slot.valueType === "chart"
          ? "차트"
          : slot.valueType === "table"
            ? "표"
            : "수치",
      source: entry
        ? entry.plan?.sourceLabel ??
          candidateLabel(selectedCandidate(entry, selectedId))
        : "분석된 PDF 슬롯",
      status: entry
        ? connectionStatus(entry, selectedId)
        : slot.required
          ? ("review" as const)
          : ("optional" as const),
      bbox: slot.bbox,
      pageBox: currentPage?.pageBox ?? null,
      confidence: slot.confidence,
    };
  });
  const baseWritingItems =
    selectedPage === 1
      ? syntheticWritingItems.map((item) => ({
          ...item,
          kind: "작성 영역",
          status: "later" as const,
          source: currentPage?.headerFields[item.field]?.text
            ? `원문 · ${currentPage.headerFields[item.field]?.text}`
            : item.source,
          bbox: currentPage?.headerFields[item.field]?.bbox ?? null,
          pageBox: currentPage?.pageBox ?? null,
          confidence: null,
        }))
      : [];
  const narrativeWritingItems = (
    currentPage?.narrativeSections ?? []
  ).flatMap((section) => [
    {
      id: `body-${section.order}-title`,
      label: `본문 ${section.order} 소제목`,
      source: `원문 · ${section.headingText}`,
      kind: "작성 영역",
      status: "later" as const,
      bbox: section.headingBbox,
      pageBox: currentPage?.pageBox ?? null,
      confidence: null,
    },
    {
      id: `body-${section.order}`,
      label: `본문 ${section.order}`,
      source: `원문 · ${section.sourceText.slice(0, 64)}`,
      kind: "작성 영역",
      status: "later" as const,
      bbox: section.bodyBbox,
      pageBox: currentPage?.pageBox ?? null,
      confidence: null,
    },
  ]);
  const writingItems = [...baseWritingItems, ...narrativeWritingItems];
  const fixedItems =
    selectedPage === pageCount && selectedPage > 4
      ? [
          {
            id: "compliance-fixed",
            label: "고지 · 컴플라이언스",
            kind: "고정 영역",
            source: "이전 보고서 원문 유지",
            status: "fixed" as const,
            bbox: null,
            pageBox: currentPage?.pageBox ?? null,
            confidence: null,
          },
        ]
      : [];
  const items = [...writingItems, ...actualItems, ...fixedItems];
  const [selectedItemId, setSelectedItemId] = useState(items[0]?.id ?? "");
  const selectedItem =
    items.find((item) => item.id === selectedItemId) ?? items[0];
  const selectedEntry = selectedItem
    ? entryBySlot.get(selectedItem.id)
    : undefined;
  const selectedEntryCandidateId = selectedEntry
    ? selections[selectedEntry.entryId] || ""
    : "";

  return (
    <section
      className="phase2-result-workspace"
      role="region"
      aria-label="PDF 구성"
    >
      <div className="phase2-pdf-workspace">
        <nav className="phase2-page-rail" aria-label="PDF 페이지">
          {pages.map((page) => {
            const metrics = page.slots.map((slot) => slot.metric);
            return (
              <button
                key={page.pageId}
                type="button"
                aria-current={page.pageNumber === selectedPage ? "page" : undefined}
                onClick={() => {
                  setSelectedPage(page.pageNumber);
                  setSelectedItemId("");
                }}
              >
                <b>{String(page.pageNumber).padStart(2, "0")}</b>
                <span>{pageSubject(page.pageNumber, pageCount, metrics)}</span>
              </button>
            );
          })}
        </nav>

        <div className="phase2-page-preview-column">
          <div
            className="phase2-page-preview"
            aria-label={`${selectedPage}페이지 영역 미리보기`}
          >
            <div className="phase2-page-preview-header">
              <span>{String(selectedPage).padStart(2, "0")}</span>
              <small>
                {pageSubject(
                  selectedPage,
                  pageCount,
                  currentPage?.slots.map((slot) => slot.metric) ?? [],
                )}
              </small>
            </div>
            {items
              .filter((item) => item.bbox)
              .map((item) => (
              <i
                key={item.id}
                data-selected={selectedItem?.id === item.id}
                style={pdfPreviewBlockStyle(item.bbox, item.pageBox)}
              />
              ))}
            {!selectedItem?.bbox && (
              <div className="phase2-page-preview-placeholder">
                <b>{selectedItem?.label ?? "페이지 영역"}</b>
                <span>
                  {selectedItem?.status === "fixed"
                    ? "원문 레이아웃 유지"
                    : "후속 단계에서 내용 생성"}
                </span>
              </div>
            )}
          </div>
          <details className="phase2-analysis-details">
            <summary>분석 세부정보</summary>
            <dl>
              <div>
                <dt>블록 · 슬롯</dt>
                <dd>
                  {inspection.analysis?.pdf.blockCount ?? 0} ·{" "}
                  {inspection.analysis?.pdf.slotCount ?? 0}
                </dd>
              </div>
              <div>
                <dt>물리 객체</dt>
                <dd>{inspection.analysis?.pdf.objectCount.toLocaleString() ?? 0}</dd>
              </div>
              <div>
                <dt>표 · 차트</dt>
                <dd>
                  {inspection.analysis?.pdf.tableCount ?? 0} ·{" "}
                  {inspection.analysis?.pdf.chartCount ?? 0}
                </dd>
              </div>
            </dl>
          </details>
        </div>

        <div className="phase2-element-list">
          <div className="phase2-element-list-heading">
            <b>{selectedPage}페이지 요소</b>
            <span>{items.length}개</span>
          </div>
          {selectedEntry &&
            selectedItem?.status === "review" &&
            selectedEntry.candidates.length > 0 && (
              <label className="phase2-candidate-control">
                <span>{selectedItem.label} 원본</span>
                <select
                  value={selectedEntryCandidateId}
                  onChange={(event) =>
                    onSelectionChange(selectedEntry.entryId, event.target.value)
                  }
                >
                  <option value="">원본을 선택하세요</option>
                  {selectedEntry.candidates.map((candidate) => (
                    <option
                      key={candidate.candidateId}
                      value={candidate.candidateId}
                    >
                      {candidateLabel(candidate)} ·{" "}
                      {Math.round(candidate.score * 100)}%
                    </option>
                  ))}
                </select>
              </label>
            )}
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              className={selectedItem?.id === item.id ? "active" : ""}
              onClick={() => setSelectedItemId(item.id)}
            >
              <span>
                <b>{item.label}</b>
                <small>{item.kind} · {item.source}</small>
              </span>
              <ResultStatus status={item.status} />
            </button>
          ))}
          {items.length === 0 && (
            <p className="phase2-empty-copy">이 페이지에서 의미 슬롯을 찾지 못했습니다.</p>
          )}
        </div>
      </div>
    </section>
  );
}

export function WorkbookStructurePanel({
  inspection,
  entries,
  selections,
  workbookName,
}: {
  inspection: InspectionProjection;
  entries: MappingEntry[];
  selections: Record<string, string>;
  workbookName: string;
}) {
  const sheets = inspection.analysis?.workbook.sheets ?? [];
  const [roleFilter, setRoleFilter] = useState<
    "all" | ReturnType<typeof sheetRole>
  >("all");
  const filteredSheets = sheets.filter(
    (sheet) => roleFilter === "all" || sheetRole(sheet.name) === roleFilter,
  );
  const [selectedSheetId, setSelectedSheetId] = useState(sheets[0]?.sheetId ?? "");
  const selectedSheet =
    filteredSheets.find((sheet) => sheet.sheetId === selectedSheetId) ??
    filteredSheets[0] ??
    sheets[0];
  const linkedEntries = selectedSheet
    ? entries.filter((entry) => {
        const selected = selectedCandidate(
          entry,
          selections[entry.entryId] || null,
        );
        const destination =
          entry.plan?.destinationLabel ?? destinationByMetric[entry.metric];
        return (
          selected?.sheetName === selectedSheet.name ||
          destination === selectedSheet.name
        );
      })
    : [];
  const roleFilters = [
    ["all", "전체"],
    ["model", "모델 입력"],
    ["calculation", "계산 · 검증"],
    ["output", "PDF 출력"],
    ["source", "원천 · 시스템"],
  ] as const;

  return (
    <section
      className="phase2-result-workspace"
      role="tabpanel"
      aria-label="Excel 자동화 구조"
    >
      <header className="phase2-panel-heading">
        <div>
          <span>EXCEL 자동화 구조</span>
          <h3>입력 · 계산 · PDF 출력 시트</h3>
          <p>시트 역할과 연결된 보고서 요소를 읽기 전용으로 확인합니다.</p>
        </div>
        <strong>{sheets.length}개 시트</strong>
      </header>

      <div className="phase2-sheet-filters" aria-label="시트 역할 필터">
        {roleFilters.map(([value, label]) => (
          <button
            key={value}
            type="button"
            aria-pressed={roleFilter === value}
            onClick={() => setRoleFilter(value)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="phase2-workbook-workspace">
        <div className="phase2-sheet-list">
          {filteredSheets.map((sheet) => {
            const role = sheetRole(sheet.name);
            const mappingCount = entries.filter((entry) => {
              const selected = selectedCandidate(
                entry,
                selections[entry.entryId] || null,
              );
              return (
                selected?.sheetName === sheet.name ||
                entry.plan?.destinationLabel === sheet.name ||
                destinationByMetric[entry.metric] === sheet.name
              );
            }).length;
            return (
              <button
                key={sheet.sheetId}
                type="button"
                className={selectedSheet?.sheetId === sheet.sheetId ? "active" : ""}
                onClick={() => setSelectedSheetId(sheet.sheetId)}
              >
                <span>
                  <b>{sheet.name}</b>
                  <small>{sheetRoleCopy[role]} · {sheet.usedRange}</small>
                </span>
                <em>{mappingCount > 0 ? `${mappingCount}개 연결` : "구조 확인"}</em>
              </button>
            );
          })}
          {filteredSheets.length === 0 && (
            <p className="phase2-empty-copy">이 역할에 해당하는 시트가 없습니다.</p>
          )}
        </div>

        <div className="phase2-workbook-preview">
          <header>
            <span>{workbookName}</span>
            <b>{selectedSheet?.name ?? "시트 선택"}</b>
          </header>
          <div className="phase2-formula-bar">
            <span>{selectedSheet?.usedRange ?? "A1"}</span>
            <p>
              {selectedSheet
                ? `${selectedSheet.formulaCount.toLocaleString()}개 수식 · 읽기 전용 분석`
                : "시트를 선택하세요"}
            </p>
          </div>
          <div className="phase2-workbook-grid">
            <div>
              <small>역할</small>
              <b>
                {selectedSheet
                  ? sheetRoleCopy[sheetRole(selectedSheet.name)]
                  : "—"}
              </b>
            </div>
            <div>
              <small>입력 후보</small>
              <b>{selectedSheet?.editableCellCount ?? 0}셀</b>
            </div>
            <div>
              <small>표 · 차트</small>
              <b>
                {selectedSheet?.tableCount ?? 0} · {selectedSheet?.chartCount ?? 0}
              </b>
            </div>
            <div>
              <small>병합</small>
              <b>{selectedSheet?.mergedRangeCount ?? 0}개</b>
            </div>
          </div>
          <section className="phase2-sheet-outputs">
            <h4>연결된 보고서 요소</h4>
            {linkedEntries.length > 0 ? (
              <ul>
                {linkedEntries.map((entry) => (
                  <li key={entry.entryId}>
                    <span>{metricLabel(entry.metric)}</span>
                    <ResultStatus
                      status={connectionStatus(
                        entry,
                        selections[entry.entryId] || null,
                      )}
                    />
                  </li>
                ))}
              </ul>
            ) : (
              <p>이 시트는 직접 출력보다 계산 또는 원천 보관에 사용됩니다.</p>
            )}
          </section>
          <footer>
            <span>계산 상태</span>
            <b>
              {inspection.analysis?.workbook.calculationErrorCount
                ? `오류 ${inspection.analysis.workbook.calculationErrorCount}건`
                : "구조 검사 통과"}
            </b>
          </footer>
        </div>
      </div>
    </section>
  );
}

function CandidateDetails({
  candidate,
}: {
  candidate: MappingCandidate | undefined;
}) {
  if (!candidate) return null;
  const confidence = analysisConfidenceCopy(candidate.score);
  return (
    <div className="phase2-selected-source">
      <div>
        <ResultStatus status="connected" />
        <span data-confidence={confidence.level}>{confidence.label}</span>
      </div>
      <b>{candidateLabel(candidate)}</b>
      {candidate.reasonCodes.length > 0 && (
        <p>
          {candidate.reasonCodes
            .slice(0, 3)
            .map(analysisReasonCopy)
            .join(" · ")}
        </p>
      )}
    </div>
  );
}

export function MappingWorkspace({
  entries,
  selections,
  onSelectionChange,
}: {
  entries: MappingEntry[];
  selections: Record<string, string>;
  onSelectionChange: (entryId: string, candidateId: string) => void;
}) {
  const [filter, setFilter] = useState<"all" | ConnectionStatus>("all");
  const [selectedKey, setSelectedKey] = useState(entries[0]?.entryId ?? "report-date");
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const actualRows = entries.map((entry) => {
    const selectedId = selections[entry.entryId] || null;
    return {
      key: entry.entryId,
      pageNumber: entry.pdfBlock?.pageNumber ?? 0,
      label: metricLabel(entry.metric),
      status: connectionStatus(entry, selectedId),
      entry,
    };
  });
  const writingRows = syntheticWritingItems.map((item) => ({
    key: item.id,
    pageNumber: 1,
    label: item.label,
    status: "later" as const,
    item,
  }));
  const rows = [...writingRows, ...actualRows].sort(
    (left, right) =>
      left.pageNumber - right.pageNumber ||
      left.label.localeCompare(right.label, "ko"),
  );
  const filteredRows = rows.filter(
    (row) => filter === "all" || row.status === filter,
  );
  const selectedRow =
    rows.find((row) => row.key === selectedKey) ?? filteredRows[0] ?? rows[0];
  const entry = selectedRow && "entry" in selectedRow ? selectedRow.entry : null;
  const writingItem =
    selectedRow && "item" in selectedRow ? selectedRow.item : null;
  const selectedId = entry ? selections[entry.entryId] || null : null;
  const candidate = entry ? selectedCandidate(entry, selectedId) : undefined;
  const status = selectedRow?.status ?? "later";
  const sourceLabel = writingItem
    ? writingItem.source
    : entry?.plan?.sourceLabel ??
      (candidate ? candidateLabel(candidate) : "원본 후보 확인 필요");
  const destinationLabel = writingItem
    ? "페이지 내용 설정에서 PDF 직접 반영"
    : entry?.plan?.destinationLabel ??
      destinationByMetric[entry?.metric ?? ""] ??
      candidate?.sheetName ??
      "PDF 직접 반영";
  const filters = [
    ["all", "전체"],
    ["connected", "자동 연결"],
    ["external", "후속 수집"],
    ["later", "후속 단계"],
    ["review", "확인 필요"],
  ] as const;

  return (
    <section
      className="phase2-result-workspace"
      role="tabpanel"
      aria-label="연결 규칙"
    >
      <header className="phase2-panel-heading">
        <div>
          <span>연결 규칙</span>
          <h3>원천에서 PDF 요소까지 이어지는 경로</h3>
          <p>자동 연결은 유지하고, 애매한 항목만 원본 후보를 선택합니다.</p>
        </div>
        <strong>{entries.length}개 슬롯</strong>
      </header>

      <div className="phase2-mapping-filters" aria-label="연결 상태 필터">
        {filters.map(([value, label]) => (
          <button
            key={value}
            type="button"
            aria-pressed={filter === value}
            onClick={() => setFilter(value)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="phase2-connection-workspace">
        <div className="phase2-connection-list">
          {filteredRows.map((row) => (
            <button
              key={row.key}
              type="button"
              className={selectedRow?.key === row.key ? "active" : ""}
              onClick={() => setSelectedKey(row.key)}
            >
              <span>
                <small>{row.pageNumber ? `${row.pageNumber}페이지` : "페이지 미확인"}</small>
                <b>{row.label}</b>
              </span>
              <ResultStatus status={row.status} />
            </button>
          ))}
          {filteredRows.length === 0 && (
            <p className="phase2-empty-copy">이 상태에 해당하는 요소가 없습니다.</p>
          )}
        </div>

        <div className="phase2-connection-inspector">
          <header>
            <div>
              <small>
                {selectedRow?.pageNumber
                  ? `${selectedRow.pageNumber}페이지`
                  : "작성 영역"}
              </small>
              <h4>{selectedRow?.label ?? "연결 항목"}</h4>
            </div>
            <ResultStatus status={status} />
          </header>

          <div className="phase2-source-chain">
            <div>
              <small>원천 · 담당 단계</small>
              <b>{sourceLabel}</b>
              <span>
                {writingItem
                  ? "조사 결과 검증 이후 생성"
                  : entry?.plan?.ownerStage ?? "업로드 Excel"}
              </span>
            </div>
            <i aria-hidden="true">→</i>
            <div>
              <small>계산 · 출력 위치</small>
              <b>{destinationLabel}</b>
              <span>
                {status === "external"
                  ? "자료 수집 후 계산"
                  : status === "later"
                    ? "사용자 승인 후 반영"
                    : "현재 workbook에서 읽음"}
              </span>
            </div>
            <i aria-hidden="true">→</i>
            <div>
              <small>PDF 요소</small>
              <b>{selectedRow?.label ?? "—"}</b>
              <span>원본 좌표와 서식 유지</span>
            </div>
          </div>

          {entry && (
            <>
              <div className="phase2-mini-pdf">
                <span>PDF 위치</span>
                <div>
                  <i
                    style={pdfPreviewBlockStyle(
                      entry.pdfBlock?.bbox ?? null,
                      entry.pdfBlock?.pageBox ?? null,
                    )}
                  />
                  <small>{entry.pdfBlock?.pageNumber ?? "—"}페이지</small>
                </div>
              </div>
              <CandidateDetails candidate={candidate} />
              {entry.candidates.length > 0 &&
                !entry.plan?.exclusiveSource &&
                (status === "review" || editingEntryId === entry.entryId) && (
                  <label className="phase2-candidate-control">
                    <span>Excel 원본 후보</span>
                    <select
                      value={selectedId ?? ""}
                      onChange={(event) =>
                        onSelectionChange(entry.entryId, event.target.value)
                      }
                    >
                      <option value="">원본을 선택하세요</option>
                      {entry.candidates.map((item) => (
                        <option key={item.candidateId} value={item.candidateId}>
                          {candidateLabel(item)} · {Math.round(item.score * 100)}%
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              {status === "connected" &&
                entry.candidates.length > 1 &&
                !entry.plan?.exclusiveSource &&
                editingEntryId !== entry.entryId && (
                  <button
                    type="button"
                    className="phase2-change-source"
                    onClick={() => setEditingEntryId(entry.entryId)}
                  >
                    연결 원본 변경
                  </button>
                )}
            </>
          )}

          <p className="phase2-connection-note">
            {statusMeta[status].description}
          </p>
        </div>
      </div>
    </section>
  );
}

export function InspectionResultDialog({
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
  const entries = useMemo(
    () => inspection.mappingSet?.entries ?? [],
    [inspection.mappingSet?.entries],
  );
  const initialSelections = useMemo(
    () =>
      Object.fromEntries(
        entries.map((entry) => [
          entry.entryId,
          effectiveCandidateId(entry) ?? "",
        ]),
      ),
    [entries],
  );
  const [selections, setSelections] =
    useState<Record<string, string>>(initialSelections);
  const statuses = entries.map((entry) =>
    connectionStatus(entry, selections[entry.entryId] || null),
  );
  const connectedCount = entries.filter((entry) =>
    effectiveCandidateId(entry, selections[entry.entryId] || null),
  ).length;
  const periodRefreshCount = statuses.filter(
    (status) => status === "period_refresh",
  ).length;
  const narrativeSectionCount =
    inspection.analysis?.pdf.pages.reduce(
      (total, page) => total + (page.narrativeSections?.length ?? 0),
      0,
    ) ?? 0;
  const followupCount =
    statuses.filter((status) =>
      ["external", "input", "source_and_input", "valuation", "later"].includes(
        status,
      ),
    ).length +
    syntheticWritingItems.length +
    narrativeSectionCount * 2;
  const reviewCount = statuses.filter((status) => status === "review").length;
  const dirty = entries.some(
    (entry) =>
      (selections[entry.entryId] || "") !==
      (initialSelections[entry.entryId] || ""),
  );
  const actionableBlockingIssues = inspection.issues.filter(
    (issue) =>
      issue.severity === "blocking" &&
      !(
        issue.code === "REQUIRED_MAPPING_UNRESOLVED" &&
        reviewCount === 0
      ),
  );
  const needsPolicyRefresh =
    inspection.outcome !== "passed" &&
    reviewCount === 0 &&
    actionableBlockingIssues.length === 0;
  const save = async () => {
    await onSaveMapping(
      entries.map((entry) => ({
        entryId: entry.entryId,
        candidateId: selections[entry.entryId] || null,
      })),
    );
  };

  return (
    <div
      className="phase2-modal-backdrop"
      onMouseDown={(event) => event.currentTarget === event.target && onClose()}
    >
      <section
        className="phase2-result-dialog phase2-inspection-result"
        role="dialog"
        aria-modal="true"
        aria-labelledby="phase2-result-title"
      >
        <header>
          <div>
            <span>FILE INSPECTION</span>
            <h2 id="phase2-result-title">PDF - Excel 연결 확인</h2>
          </div>
          <button onClick={onClose} aria-label="검사 결과 닫기">
            ×
          </button>
        </header>

        <div className="phase2-result-summary" aria-label="분석 결과 요약">
          <div>
            <small>Excel 위치</small>
            <b>{connectedCount}</b>
          </div>
          <div>
            <small>기간 갱신</small>
            <b>{periodRefreshCount}</b>
          </div>
          <div>
            <small>후속 작업</small>
            <b>{followupCount}</b>
          </div>
          <div data-attention={reviewCount > 0}>
            <small>확인 필요</small>
            <b>{reviewCount}</b>
          </div>
        </div>

        <div className="phase2-result-body">
          <PdfStructurePanel
            inspection={inspection}
            entries={entries}
            selections={selections}
            onSelectionChange={(entryId, candidateId) =>
              setSelections((current) => ({
                ...current,
                [entryId]: candidateId,
              }))
            }
          />
        </div>

        <footer style={{ justifyContent: "flex-end" }}>
          {reviewCount > 0 ? (
            <button type="button" disabled>
              원본 확인 필요
            </button>
          ) : dirty || needsPolicyRefresh ? (
            <button type="button" disabled={savingMapping} onClick={() => void save()}>
              {savingMapping ? "분석 결과 반영 중" : "분석 결과 반영"}
            </button>
          ) : inspection.outcome === "passed" ? (
            <button type="button" disabled={completing} onClick={onComplete}>
              {completing ? "확정 중" : "분석 결과 확정 · 다음"}
            </button>
          ) : (
            <button type="button" disabled>
              파일 확인 필요
            </button>
          )}
        </footer>
      </section>
    </div>
  );
}
