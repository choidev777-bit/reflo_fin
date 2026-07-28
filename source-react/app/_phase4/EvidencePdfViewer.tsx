"use client";

import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import { useEffect, useMemo, useRef, useState } from "react";
import { apiJson } from "../_phase1/api";
import styles from "./evidence-pdf-viewer.module.css";

type ViewerMetadata = {
  title: string;
  publisher: string;
  quoteExact: string;
  sourceAccess: {
    kind: "uploaded_pdf";
    streamUrl: string;
    pageNumber: number | null;
    textFragment: string;
  } | null;
};

function normalized(value: string): string {
  return value.normalize("NFKC").replace(/\s+/g, "");
}

async function locatePage(
  document: PDFDocumentProxy,
  quote: string,
): Promise<number | null> {
  const target = normalized(quote);
  if (!target) return null;
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    const pageText = normalized(
      content.items
        .map((item) => ("str" in item ? item.str : ""))
        .join(" "),
    );
    page.cleanup();
    if (pageText.includes(target)) return pageNumber;
  }
  return null;
}

function highlightTextLayer(container: HTMLDivElement, quote: string): void {
  const spans = Array.from(
    container.querySelectorAll<HTMLSpanElement>("span"),
  ).filter((span) => !span.querySelector("span"));
  const target = normalized(quote);
  if (!target) return;
  for (const span of spans) delete span.dataset.evidenceHighlight;
  const directMatch = spans.find((span) => {
    const text = normalized(span.textContent ?? "");
    return (
      text.includes(target) ||
      (text.length >= 4 && target.includes(text))
    );
  });
  if (directMatch) {
    directMatch.dataset.evidenceHighlight = "true";
    directMatch.scrollIntoView({ block: "center", behavior: "smooth" });
    return;
  }
  for (let start = 0; start < spans.length; start += 1) {
    let candidate = "";
    for (
      let end = start;
      end < spans.length && candidate.length <= target.length + 200;
      end += 1
    ) {
      candidate = normalized(
        `${candidate} ${spans[end].textContent ?? ""}`,
      );
      if (candidate.includes(target)) {
        for (let index = start; index <= end; index += 1) {
          spans[index].dataset.evidenceHighlight = "true";
        }
        spans[start].scrollIntoView({ block: "center", behavior: "smooth" });
        return;
      }
    }
  }
}

function EvidencePdfPage({
  document,
  pageNumber,
  quote,
}: {
  document: PDFDocumentProxy;
  pageNumber: number;
  quote: string;
}) {
  const shellRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [ratio, setRatio] = useState("1 / 1.414");
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
    let page: PDFPageProxy | null = null;
    let renderTask: ReturnType<PDFPageProxy["render"]> | null = null;
    let textLayer: import("pdfjs-dist").TextLayer | null = null;
    void Promise.all([document.getPage(pageNumber), import("pdfjs-dist")])
      .then(async ([loadedPage, pdfjs]) => {
        page = loadedPage;
        const baseViewport = loadedPage.getViewport({ scale: 1 });
        setRatio(`${baseViewport.width} / ${baseViewport.height}`);
        const viewport = loadedPage.getViewport({
          scale: width / baseViewport.width,
        });
        if (cancelled || !canvasRef.current || !textLayerRef.current) return;
        const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
        const canvas = canvasRef.current;
        const context = canvas.getContext("2d");
        if (!context) return;
        canvas.width = Math.floor(viewport.width * pixelRatio);
        canvas.height = Math.floor(viewport.height * pixelRatio);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        renderTask = loadedPage.render({
          canvas,
          canvasContext: context,
          viewport,
          transform:
            pixelRatio === 1
              ? undefined
              : [pixelRatio, 0, 0, pixelRatio, 0, 0],
        });
        const container = textLayerRef.current;
        container.replaceChildren();
        container.style.setProperty("--total-scale-factor", String(viewport.scale));
        textLayer = new pdfjs.TextLayer({
          textContentSource: loadedPage.streamTextContent({
            includeMarkedContent: true,
          }),
          container,
          viewport,
        });
        await Promise.all([renderTask.promise, textLayer.render()]);
        if (!cancelled) highlightTextLayer(container, quote);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
      textLayer?.cancel();
      renderTask?.cancel();
      page?.cleanup();
    };
  }, [document, pageNumber, quote, width]);

  return (
    <div
      className={styles.page}
      ref={shellRef}
      style={{ aspectRatio: ratio }}
      aria-label={`원문 PDF ${pageNumber}페이지`}
    >
      {error ? (
        <p role="alert">원문 페이지를 표시하지 못했습니다.</p>
      ) : (
        <>
          <canvas ref={canvasRef} />
          <div ref={textLayerRef} className={styles.textLayer} />
        </>
      )}
    </div>
  );
}

export function EvidencePdfViewer({
  projectId,
  evidenceId,
}: {
  projectId: string;
  evidenceId: string;
}) {
  const [metadata, setMetadata] = useState<ViewerMetadata | null>(null);
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [pageNumber, setPageNumber] = useState<number | null>(null);
  const [error, setError] = useState("");
  const streamUrl = useMemo(
    () => `/api/projects/${projectId}/evidence/${evidenceId}/source`,
    [evidenceId, projectId],
  );

  useEffect(() => {
    let stopped = false;
    void apiJson<ViewerMetadata>(
      `/api/projects/${projectId}/evidence/${evidenceId}/viewer`,
    )
      .then((next) => {
        if (!stopped) setMetadata(next);
      })
      .catch((caught) => {
        if (!stopped) {
          setError(
            caught instanceof Error
              ? caught.message
              : "원문 정보를 불러오지 못했습니다.",
          );
        }
      });
    return () => {
      stopped = true;
    };
  }, [evidenceId, projectId]);

  useEffect(() => {
    if (!metadata?.sourceAccess?.streamUrl) return;
    let stopped = false;
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
        loadingTask = pdfjs.getDocument({
          url: streamUrl,
          withCredentials: true,
        });
        activeDocument = await loadingTask.promise;
        if (stopped) return;
        setDocument(activeDocument);
        const located =
          metadata.sourceAccess?.pageNumber ??
          (await locatePage(activeDocument, metadata.quoteExact));
        setPageNumber(located ?? 1);
      })
      .catch(() => {
        if (!stopped) setError("PDF 원문을 불러오지 못했습니다.");
      });
    return () => {
      stopped = true;
      void loadingTask?.destroy();
      activeDocument?.cleanup();
    };
  }, [metadata, streamUrl]);

  if (error) {
    return (
      <main className={styles.screen}>
        <section className={styles.error} role="alert">
          <strong>원문을 열지 못했습니다.</strong>
          <span>{error}</span>
        </section>
      </main>
    );
  }

  return (
    <main className={styles.screen}>
      <header className={styles.header}>
        <div>
          <small>ORIGINAL SOURCE</small>
          <h1>{metadata?.title ?? "원문 PDF"}</h1>
          <p>{metadata?.publisher ?? "원문을 불러오는 중입니다."}</p>
        </div>
        <button type="button" onClick={() => window.close()}>
          닫기
        </button>
      </header>
      <section className={styles.quote}>
        <strong>검증 인용문</strong>
        <mark>{metadata?.quoteExact ?? "인용문을 불러오는 중입니다."}</mark>
      </section>
      <nav className={styles.pagination} aria-label="PDF 페이지 이동">
        <button
          type="button"
          disabled={!pageNumber || pageNumber <= 1}
          onClick={() =>
            setPageNumber((current) => Math.max(1, (current ?? 1) - 1))
          }
        >
          이전 페이지
        </button>
        <strong>
          {pageNumber ?? "—"} / {document?.numPages ?? "—"}
        </strong>
        <button
          type="button"
          disabled={!pageNumber || !document || pageNumber >= document.numPages}
          onClick={() =>
            setPageNumber((current) =>
              Math.min(document?.numPages ?? 1, (current ?? 1) + 1),
            )
          }
        >
          다음 페이지
        </button>
      </nav>
      <section className={styles.document}>
        {document && pageNumber ? (
          <EvidencePdfPage
            document={document}
            pageNumber={pageNumber}
            quote={metadata?.quoteExact ?? ""}
          />
        ) : (
          <p className={styles.loading}>PDF 원문을 준비하고 있습니다.</p>
        )}
      </section>
    </main>
  );
}
