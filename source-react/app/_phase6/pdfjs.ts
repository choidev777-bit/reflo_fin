"use client";

// pdfjs-dist 6.x의 기본 `build/` 산출물은 Map.prototype.getOrInsertComputed,
// Math.sumPrecise, Promise.try, 명시적 자원 관리(`using`)처럼 2025년 이후 엔진에만
//있는 API를 polyfill 없이 사용한다. Safari 18 계열에서는 문서를 여는 즉시 worker가
// `getOrInsertComputed is not a function`으로 죽어 초안과 미리보기가 아예 렌더되지
// 않으므로, core-js polyfill이 포함된 `legacy/build/`를 고정으로 사용한다.
// 두 산출물을 섞으면 TextLayer가 다른 인스턴스에 묶이므로 진입점을 여기로 모은다.
export async function loadPdfjs() {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/legacy/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();
  return pdfjs;
}
