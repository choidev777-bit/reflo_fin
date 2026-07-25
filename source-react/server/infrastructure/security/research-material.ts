import { connect } from "node:net";
import { ApiError } from "../../http/api-error";

const MAX_PDF_BYTES = 50 * 1024 * 1024;

async function clamScan(
  bytes: Buffer,
): Promise<"clean" | "infected" | "scan_unavailable"> {
  const host = process.env.REFLO_CLAMAV_HOST?.trim();
  if (!host) {
    return process.env.NODE_ENV === "production" ? "scan_unavailable" : "clean";
  }
  const port = Number(process.env.REFLO_CLAMAV_PORT ?? "3310");
  return new Promise((resolve) => {
    const socket = connect({ host, port });
    const chunks: Buffer[] = [];
    socket.setTimeout(30_000);
    socket.on("connect", () => {
      socket.write("zINSTREAM\0");
      const size = Buffer.alloc(4);
      size.writeUInt32BE(bytes.byteLength);
      socket.write(size);
      socket.write(bytes);
      socket.write(Buffer.alloc(4));
    });
    socket.on("data", (chunk: Buffer) => chunks.push(chunk));
    socket.on("end", () => {
      const reply = Buffer.concat(chunks).toString("utf8");
      resolve(
        reply.includes("FOUND")
          ? "infected"
          : reply.includes("OK")
            ? "clean"
            : "scan_unavailable",
      );
    });
    socket.on("timeout", () => {
      socket.destroy();
      resolve("scan_unavailable");
    });
    socket.on("error", () => resolve("scan_unavailable"));
  });
}

export async function inspectResearchPdf(bytes: Buffer): Promise<void> {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_PDF_BYTES) {
    throw new ApiError(
      422,
      "SOURCE_FILE_SIZE_INVALID",
      "기업 IR PDF는 50MB 이하 파일만 올릴 수 있습니다.",
    );
  }
  const header = bytes.subarray(0, 8).toString("ascii");
  const sample = bytes.toString("latin1");
  if (!header.startsWith("%PDF-")) {
    throw new ApiError(
      422,
      "SOURCE_FILE_TYPE_INVALID",
      "PDF 형식의 기업 IR 자료만 올려주세요.",
    );
  }
  if (/\/Encrypt\b/.test(sample)) {
    throw new ApiError(
      422,
      "SOURCE_FILE_ENCRYPTED",
      "암호화된 PDF는 읽을 수 없습니다. 암호를 해제한 원본을 올려주세요.",
    );
  }
  if (
    /\/EmbeddedFiles\b|\/Collection\b|\/XFA\b|\/Launch\b|\/RichMedia\b|\/JavaScript\b/.test(
      sample,
    )
  ) {
    throw new ApiError(
      422,
      "SOURCE_FILE_UNSAFE_FEATURE",
      "첨부 파일·스크립트가 없는 안전한 PDF로 다시 저장해 올려주세요.",
    );
  }
  const malwareStatus = await clamScan(bytes);
  if (malwareStatus === "infected") {
    throw new ApiError(
      422,
      "MALWARE_DETECTED",
      "악성 코드가 감지되어 파일을 사용할 수 없습니다.",
    );
  }
  if (malwareStatus === "scan_unavailable" && process.env.NODE_ENV === "production") {
    throw new ApiError(
      503,
      "MALWARE_SCAN_UNAVAILABLE",
      "파일 보안 검사를 완료할 수 없습니다. 잠시 후 다시 시도해주세요.",
      { retryable: true },
    );
  }
}
