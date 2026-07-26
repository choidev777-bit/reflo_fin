import type { CSSProperties } from "react";

type PdfRect = [number, number, number, number];

export function pdfPreviewBlockStyle(
  bbox: PdfRect | null,
  pageBox: PdfRect | null,
): CSSProperties | undefined {
  if (!bbox || !pageBox) return undefined;
  const [pageX1, pageY1, pageX2, pageY2] = pageBox;
  const [blockX1, blockY1, blockX2, blockY2] = bbox;
  const width = Math.max(1, pageX2 - pageX1);
  const height = Math.max(1, pageY2 - pageY1);

  // Template IR is extracted by PyMuPDF in a top-left coordinate system.
  return {
    left: `${Math.max(0, ((blockX1 - pageX1) / width) * 100)}%`,
    top: `${Math.max(0, ((blockY1 - pageY1) / height) * 100)}%`,
    width: `${Math.min(100, ((blockX2 - blockX1) / width) * 100)}%`,
    height: `${Math.min(100, ((blockY2 - blockY1) / height) * 100)}%`,
  };
}
