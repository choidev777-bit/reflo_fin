"use client";

import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import { useEffect, useRef, useState } from "react";
import { loadPdfjs } from "./pdfjs";
import styles from "./phase6.module.css";

function PdfPage({
  document,
  pageNumber,
  scale,
}: {
  document: PDFDocumentProxy;
  pageNumber: number;
  scale: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let page: PDFPageProxy | null = null;

    void document
      .getPage(pageNumber)
      .then(async (loadedPage) => {
        page = loadedPage;
        if (cancelled || !canvasRef.current) return;
        const viewport = loadedPage.getViewport({ scale });
        const ratio = Math.min(window.devicePixelRatio || 1, 2);
        const canvas = canvasRef.current;
        const context = canvas.getContext("2d");
        if (!context) return;
        canvas.width = Math.floor(viewport.width * ratio);
        canvas.height = Math.floor(viewport.height * ratio);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;
        await loadedPage.render({
          canvas,
          canvasContext: context,
          viewport,
          transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0],
        }).promise;
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });

    return () => {
      cancelled = true;
      page?.cleanup();
    };
  }, [document, pageNumber, scale]);

  if (error) return <p role="alert">페이지 {pageNumber}를 표시하지 못했습니다.</p>;
  return <canvas ref={canvasRef} aria-label={`PDF ${pageNumber}페이지`} />;
}

export function PdfPreview({
  url,
  scale,
}: {
  url: string;
  scale: number;
}) {
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let activeDocument: PDFDocumentProxy | null = null;
    let loadingTask: ReturnType<
      typeof import("pdfjs-dist")["getDocument"]
    > | null = null;

    void loadPdfjs()
      .then(async (pdfjs) => {
        loadingTask = pdfjs.getDocument({ url, withCredentials: true });
        activeDocument = await loadingTask.promise;
        if (cancelled) {
          await loadingTask.destroy();
          return;
        }
        setDocument(activeDocument);
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        const detail =
          reason instanceof Error && reason.message ? reason.message : "";
        setError(
          `PDF 미리보기를 불러오지 못했습니다.${
            detail ? ` (${detail.slice(0, 200)})` : ""
          }`,
        );
      });

    return () => {
      cancelled = true;
      void loadingTask?.destroy();
      if (activeDocument) activeDocument.cleanup();
    };
  }, [url]);

  if (error) return <div className={styles.errorBox}>{error}</div>;
  if (!document) return <div className={styles.loading}>PDF 렌더링 중…</div>;

  return (
    <div className={styles.pdfPreview}>
      {Array.from({ length: document.numPages }, (_, index) => (
        <PdfPage
          key={index + 1}
          document={document}
          pageNumber={index + 1}
          scale={scale}
        />
      ))}
    </div>
  );
}
