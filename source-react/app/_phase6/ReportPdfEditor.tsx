"use client";

import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import { ChartNoAxesCombined, Database, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  inferReportChartType,
  ReportChartPreview,
} from "./ReportChartPreview";
import { ReportTablePreview } from "./ReportTablePreview";
import styles from "./phase6.module.css";
import type { ReportBlock, ReportPage } from "./types";

function bindingStatusLabel(
  status: NonNullable<ReportBlock["dataBinding"]>["status"],
): string {
  if (status === "confirmed") return "연결 확인";
  if (status === "suggested") return "연결 제안";
  if (status === "invalid") return "연결 오류";
  return "연결 필요";
}

function validRect(
  bbox: ReportBlock["bbox"],
  width: number,
  height: number,
): bbox is [number, number, number, number] {
  return Boolean(
    bbox &&
      bbox.length === 4 &&
      bbox.every(Number.isFinite) &&
      bbox[0] >= 0 &&
      bbox[1] >= 0 &&
      bbox[2] <= width &&
      bbox[3] <= height &&
      bbox[2] > bbox[0] &&
      bbox[3] > bbox[1],
  );
}

function PdfEditorPage({
  document,
  page,
  editable,
  activeBlockId,
  onSelectBlock,
  onInspectBlock,
  onEditChart,
}: {
  document: PDFDocumentProxy;
  page: ReportPage;
  editable: boolean;
  activeBlockId: string | null;
  onSelectBlock: (blockId: string) => void;
  onInspectBlock: (blockId: string) => void;
  onEditChart: (blockId: string) => void;
}) {
  const shellRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [error, setError] = useState(false);

  useEffect(() => {
    const shell = shellRef.current;
    if (!shell) return;
    const observer = new ResizeObserver(([entry]) => {
      setWidth(Math.max(1, Math.floor(entry.contentRect.width)));
    });
    observer.observe(shell);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!width) return;
    let cancelled = false;
    let loadedPage: PDFPageProxy | null = null;
    let renderTask: ReturnType<PDFPageProxy["render"]> | null = null;
    let textLayer: import("pdfjs-dist").TextLayer | null = null;

    void Promise.all([
      document.getPage(page.pageNumber),
      import("pdfjs-dist"),
    ])
      .then(async ([pdfPage, pdfjs]) => {
        loadedPage = pdfPage;
        if (cancelled || !canvasRef.current) return;
        const baseViewport = pdfPage.getViewport({ scale: 1 });
        const viewport = pdfPage.getViewport({ scale: width / baseViewport.width });
        const ratio = Math.min(window.devicePixelRatio || 1, 2);
        const canvas = canvasRef.current;
        const context = canvas.getContext("2d");
        if (!context) return;
        canvas.width = Math.floor(viewport.width * ratio);
        canvas.height = Math.floor(viewport.height * ratio);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        renderTask = pdfPage.render({
          canvas,
          canvasContext: context,
          viewport,
          transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0],
        });

        const textLayerContainer = textLayerRef.current;
        const textLayerRender = textLayerContainer
          ? (() => {
              textLayerContainer.replaceChildren();
              textLayerContainer.style.setProperty(
                "--total-scale-factor",
                String(viewport.scale),
              );
              textLayer = new pdfjs.TextLayer({
                textContentSource: pdfPage.streamTextContent({
                  includeMarkedContent: true,
                }),
                container: textLayerContainer,
                viewport,
              });
              return textLayer.render();
            })()
          : Promise.resolve();

        await Promise.all([renderTask.promise, textLayerRender]);
      })
      .catch((caught: unknown) => {
        if (
          !cancelled &&
          !(
            caught instanceof Error &&
            ["AbortException", "RenderingCancelledException"].includes(
              caught.name,
            )
          )
        ) {
          setError(true);
        }
      });

    return () => {
      cancelled = true;
      textLayer?.cancel();
      renderTask?.cancel();
      loadedPage?.cleanup();
    };
  }, [document, page.pageNumber, width]);

  return (
    <article
      id={`report-${page.pageId}`}
      className={styles.sourcePdfPage}
      ref={shellRef}
      style={{ aspectRatio: `${page.widthPt} / ${page.heightPt}` }}
      aria-label={`보고서 초안 ${page.pageNumber}페이지`}
    >
      {error ? (
        <div className={styles.pdfPageError} role="alert">
          {page.pageNumber}페이지를 표시하지 못했습니다.
        </div>
      ) : (
        <canvas ref={canvasRef} />
      )}
      <div
        ref={textLayerRef}
        className={styles.pdfTextLayer}
        data-pdf-text-layer
      />
      <div className={styles.pdfEditLayer}>
        {page.blocks
          .flatMap((block) => {
            const regions = (
              block.regions?.length ? block.regions : [block.bbox]
            ).filter(
              (region): region is [number, number, number, number] =>
                validRect(region, page.widthPt, page.heightPt),
            );
            if ((!block.editable && !block.dataBinding) || regions.length === 0) {
              return [];
            }
            return regions.map((bbox, regionIndex) => {
              const dataBlock = Boolean(block.dataBinding);
              const chartBlock = block.dataBinding?.kind === "chart";
              const chartSnapshot =
                block.materializedData?.kind === "chart"
                  ? block.materializedData
                  : null;
              const tableSnapshot =
                block.materializedData?.kind === "table"
                  ? block.materializedData
                  : null;
              const displayedChartType = chartBlock
                ? inferReportChartType(block)
                : null;
              const connectionLabel = block.dataBinding
                ? bindingStatusLabel(block.dataBinding.status)
                : "";
            return (
              <button
                type="button"
                key={`${block.blockId}.${regionIndex}`}
                className={styles.pdfEditHotspot}
                data-active={activeBlockId === block.blockId}
                data-enabled={editable}
                data-kind={chartBlock ? "chart" : dataBlock ? "data" : "text"}
                data-status={block.dataBinding?.status ?? "editable"}
                data-materialized={
                  chartSnapshot?.status ??
                  tableSnapshot?.status ??
                  "not-applicable"
                }
                data-chart-changed={Boolean(
                  block.chartType && chartSnapshot?.status === "ready",
                )}
                disabled={!editable}
                aria-label={
                  chartBlock
                    ? `${block.label} ${connectionLabel}, 그래프 형태 변경`
                    : dataBlock
                    ? `${block.label} 데이터 연결 확인`
                    : `${block.label} AI로 수정`
                }
                title={
                  editable
                    ? chartBlock
                      ? `${block.label} ${connectionLabel} · 그래프 형태 변경`
                      : dataBlock
                      ? `${block.label} 데이터 연결 확인`
                      : `${block.label} AI로 수정`
                    : "편집 모드를 켜주세요"
                }
                style={{
                  left: `${(bbox[0] / page.widthPt) * 100}%`,
                  top: `${(bbox[1] / page.heightPt) * 100}%`,
                  width: `${((bbox[2] - bbox[0]) / page.widthPt) * 100}%`,
                  height: `${((bbox[3] - bbox[1]) / page.heightPt) * 100}%`,
                }}
                onClick={() =>
                  chartBlock
                    ? onEditChart(block.blockId)
                    : dataBlock
                    ? onInspectBlock(block.blockId)
                    : onSelectBlock(block.blockId)
                }
              >
                {displayedChartType && chartSnapshot?.status === "ready" && (
                  <span className={styles.pdfChartReplacement}>
                    <span className={styles.pdfChartReplacementHeader}>
                      <strong>{block.label}</strong>
                      <small>
                        {block.dataBinding?.sourceLabel ??
                          block.dataBinding?.sourceAddress ??
                          "Excel 연결 필요"}
                      </small>
                    </span>
                    <ReportChartPreview
                      type={displayedChartType}
                      data={chartSnapshot}
                    />
                  </span>
                )}
                {tableSnapshot?.status === "ready" && (
                  <ReportTablePreview
                    label={block.label}
                    data={tableSnapshot}
                  />
                )}
                <span className={styles.pdfEditHotspotLabel}>
                  {chartBlock ? (
                    <ChartNoAxesCombined size={11} />
                  ) : dataBlock ? (
                    <Database size={11} />
                  ) : (
                    <Sparkles size={11} />
                  )}
                  {chartBlock
                    ? `${connectionLabel} · 그래프 변경`
                    : dataBlock
                      ? connectionLabel
                      : "AI 편집"}
                </span>
              </button>
            );
            });
          })}
      </div>
    </article>
  );
}

export function ReportPdfEditor({
  url,
  pages,
  editable,
  activeBlockId,
  onSelectBlock,
  onInspectBlock,
  onEditChart,
}: {
  url: string;
  pages: ReportPage[];
  editable: boolean;
  activeBlockId: string | null;
  onSelectBlock: (blockId: string) => void;
  onInspectBlock: (blockId: string) => void;
  onEditChart: (blockId: string) => void;
}) {
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let activeDocument: PDFDocumentProxy | null = null;
    let loadingTask: ReturnType<
      typeof import("pdfjs-dist")["getDocument"]
    > | null = null;

    void import("pdfjs-dist")
      .then(async (pdfjs) => {
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          "pdfjs-dist/build/pdf.worker.min.mjs",
          import.meta.url,
        ).toString();
        loadingTask = pdfjs.getDocument({ url, withCredentials: true });
        activeDocument = await loadingTask.promise;
        if (cancelled) {
          await loadingTask.destroy();
          return;
        }
        setDocument(activeDocument);
      })
      .catch(() => {
        if (!cancelled) {
          setError("보고서 초안의 기본 레이아웃을 불러오지 못했습니다.");
        }
      });

    return () => {
      cancelled = true;
      void loadingTask?.destroy();
      activeDocument?.cleanup();
    };
  }, [url]);

  if (error) return <div className={styles.errorBox}>{error}</div>;
  if (!document) {
    return <div className={styles.pdfEditorLoading}>보고서 초안 불러오는 중…</div>;
  }

  return (
    <div className={styles.sourcePdfDocument}>
      {pages.map((page) => (
        <PdfEditorPage
          key={page.pageId}
          document={document}
          page={page}
          editable={editable}
          activeBlockId={activeBlockId}
          onSelectBlock={onSelectBlock}
          onInspectBlock={onInspectBlock}
          onEditChart={onEditChart}
        />
      ))}
    </div>
  );
}
