from __future__ import annotations

import io
import json
import os
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from pypdf import PdfReader


def inspect_pdf(download_url: str) -> dict:
    with urllib.request.urlopen(download_url, timeout=120) as response:
        payload = response.read(50 * 1024 * 1024 + 1)
    issues: list[dict[str, str]] = []
    if len(payload) > 50 * 1024 * 1024:
        issues.append(
            {
                "code": "FILE_TOO_LARGE",
                "severity": "blocking",
                "message": "PDF는 최대 50 MiB까지 지원합니다.",
            }
        )
        return {
            "pageCount": 0,
            "textLayer": False,
            "compatible": False,
            "issues": issues,
            "parserName": "pypdf",
            "parserVersion": "6.1.1",
        }

    try:
        reader = PdfReader(io.BytesIO(payload), strict=True)
        if reader.is_encrypted:
            issues.append(
                {
                    "code": "FILE_ENCRYPTED",
                    "severity": "blocking",
                    "message": "암호화된 PDF는 지원하지 않습니다.",
                }
            )
        page_count = len(reader.pages)
        if page_count < 1 or page_count > 100:
            issues.append(
                {
                    "code": "PDF_PAGE_LIMIT_EXCEEDED",
                    "severity": "blocking",
                    "message": "PDF는 1~100페이지만 지원합니다.",
                }
            )
        text_pages = 0
        for page in reader.pages:
            text = page.extract_text() or ""
            if text.strip():
                text_pages += 1
        text_layer = page_count > 0 and text_pages == page_count
        if not text_layer:
            issues.append(
                {
                    "code": "PDF_TEXT_LAYER_REQUIRED",
                    "severity": "blocking",
                    "message": "모든 페이지에 선택 가능한 텍스트가 필요합니다.",
                }
            )
    except Exception:
        page_count = 0
        text_layer = False
        issues.append(
            {
                "code": "PDF_PARSE_FAILED",
                "severity": "blocking",
                "message": "PDF 구조를 읽을 수 없습니다.",
            }
        )

    return {
        "pageCount": page_count,
        "textLayer": text_layer,
        "compatible": not any(issue["severity"] == "blocking" for issue in issues),
        "issues": issues,
        "parserName": "pypdf",
        "parserVersion": "6.1.1",
    }


class Handler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        if self.path != "/health":
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(b'{"status":"ok"}')

    def do_POST(self) -> None:
        if self.path != "/inspect":
            self.send_error(404)
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            request = json.loads(self.rfile.read(length))
            download_url = request.get("downloadUrl")
            if not isinstance(download_url, str) or not download_url.startswith(("http://", "https://")):
                raise ValueError("downloadUrl is required")
            result = inspect_pdf(download_url)
            body = json.dumps(result, ensure_ascii=False).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except Exception as error:
            body = json.dumps({"error": str(error)}).encode("utf-8")
            self.send_response(422)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    def log_message(self, format: str, *args: object) -> None:
        return


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8091"))
    ThreadingHTTPServer(("0.0.0.0", port), Handler).serve_forever()
