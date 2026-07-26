from __future__ import annotations

import base64
import hashlib
import io
import json
import os
import re
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

import cv2
import numpy as np
import pikepdf
import pymupdf
import pypdfium2 as pdfium


MAX_PDF_BYTES = 50 * 1024 * 1024
NOTO_CJK_REGULAR = os.environ.get(
    "REFLO_PDF_FONT_REGULAR",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
)
NOTO_CJK_BOLD = os.environ.get(
    "REFLO_PDF_FONT_BOLD",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc",
)
MAX_PAGES = 100
PARSER_NAME = "PyMuPDF"
PARSER_VERSION = pymupdf.version[0]

SCALAR_METRICS: tuple[tuple[str, tuple[str, ...], str, bool], ...] = (
    ("target_price", ("목표주가", "target price"), "money", True),
    ("current_price", ("현재주가", "current price", "주가"), "money", True),
    ("revenue", ("매출액", "매출"), "money", True),
    ("operating_profit", ("영업이익",), "money", True),
    ("net_income", ("지배주주순이익", "순이익"), "money", True),
    ("eps", ("forward eps", "fwd eps", "eps"), "money", True),
    ("per", ("target per", "적용 per", "per"), "decimal", True),
    ("investment_opinion", ("투자의견", "investment opinion"), "string", False),
)

TABLE_FALLBACKS = {
    2: ("quarterly_performance_table", "분기 실적 표"),
    3: ("financial_statements_table", "재무제표 표"),
}

DATA_REGION_HEADINGS: tuple[
    tuple[str, tuple[str, ...], str, str], ...
] = (
    (
        "key_data",
        ("key data", "핵심 데이터", "주요 데이터", "주요 지표"),
        "table",
        "핵심 데이터",
    ),
    (
        "consensus_data",
        ("consensus data", "consensus", "컨센서스 데이터", "컨센서스"),
        "table",
        "컨센서스 데이터",
    ),
    (
        "stock_price",
        ("stock price", "주가 추이", "주가 차트", "주가 동향"),
        "chart",
        "주가 추이",
    ),
    (
        "financial_data",
        ("financial data", "재무 데이터", "재무지표"),
        "table",
        "재무 데이터",
    ),
)

FIGURE_HEADING_PATTERN = re.compile(
    r"^\s*(?:도표|figure)\s*(\d+)\s*[.．:]?\s*(.+?)\s*$",
    re.IGNORECASE,
)
DATA_CHART_TITLE_PATTERNS = (
    re.compile(r"\bband\b", re.IGNORECASE),
    re.compile(r"\btrend\b", re.IGNORECASE),
    re.compile(r"\bvs\.?\b", re.IGNORECASE),
    re.compile(r"\bversus\b", re.IGNORECASE),
    re.compile(r"추이"),
)
FIXED_VISUAL_TITLE_TERMS = (
    "사업개요",
    "시너지 효과",
    "시너지효과",
    "조직도",
    "프로세스",
    "개념도",
    "구조도",
    "business overview",
    "synergy",
    "organization chart",
    "process diagram",
)
FINANCIAL_TABLE_HEADINGS: tuple[
    tuple[str, tuple[str, ...], str], ...
] = (
    (
        "income_statement_table",
        ("손익계산서", "income statement", "profit and loss"),
        "손익계산서",
    ),
    (
        "balance_sheet_table",
        ("대차대조표", "재무상태표", "balance sheet"),
        "대차대조표",
    ),
    (
        "investment_indicators_table",
        ("투자지표", "investment indicators", "valuation metrics"),
        "투자지표",
    ),
    (
        "cash_flow_statement_table",
        ("현금흐름표", "cash flow statement", "cash flow"),
        "현금흐름표",
    ),
)


def digest(value: bytes | str) -> str:
    if isinstance(value, str):
        value = value.encode("utf-8")
    return hashlib.sha256(value).hexdigest()


def opaque(prefix: str, value: str) -> str:
    return f"{prefix}_{digest(value)[:20]}"


def bbox(value: Any) -> list[float]:
    if value is None:
        return [0.0, 0.0, 0.0, 0.0]
    values = list(value)
    return [round(float(values[index]), 4) for index in range(4)]


def matrix(value: Any) -> list[float]:
    values = list(value)
    return [round(float(values[index]), 6) for index in range(6)]


def rgb_color(value: int | None) -> dict[str, Any]:
    color = int(value or 0)
    return {
        "colorSpace": "DeviceRGB",
        "components": [
            round(((color >> 16) & 255) / 255, 6),
            round(((color >> 8) & 255) / 255, 6),
            round((color & 255) / 255, 6),
        ],
    }


def pdf_object_ref(xref: int) -> str:
    return f"{max(1, int(xref))} 0 R"


def union_bbox(boxes: list[list[float]], fallback: list[float]) -> list[float]:
    valid = [item for item in boxes if item[2] >= item[0] and item[3] >= item[1]]
    if not valid:
        return fallback
    return [
        min(item[0] for item in valid),
        min(item[1] for item in valid),
        max(item[2] for item in valid),
        max(item[3] for item in valid),
    ]


def normalize_text(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip().lower()


def infer_metric(text: str) -> tuple[str, str, bool] | None:
    if re.match(r"^\s*(buy|hold|sell|매수|중립|매도)\b", text, re.IGNORECASE):
        return "investment_opinion", "string", False
    if re.search(r"\bp\s*/\s*e\b", text, re.IGNORECASE):
        return "per", "decimal", True
    normalized = re.sub(r"[^0-9a-z가-힣]", "", normalize_text(text))
    for metric, aliases, value_type, required in SCALAR_METRICS:
        if any(
            normalized.startswith(
                re.sub(r"[^0-9a-z가-힣]", "", alias.lower())
            )
            for alias in aliases
        ):
            return metric, value_type, required
    return None


def infer_table_metric(page_number: int, page_text: str) -> tuple[str, str] | None:
    normalized = normalize_text(page_text)
    if any(
        term in normalized
        for term in ("부문별 매출", "사업부별 매출", "segment revenue")
    ):
        return "segment_revenue_table", "부문별 매출 표"
    if any(term in normalized for term in ("재무상태표", "현금흐름", "손익계산서")):
        return "financial_statements_table", "재무제표 표"
    if "목표주가" in normalized and any(term in normalized for term in ("추이", "history")):
        return "target_price_history_table", "목표주가 추이 표"
    if any(
        term in normalized
        for term in ("분기 실적 표", "분기별 실적", "quarterly performance")
    ):
        return "quarterly_performance_table", "분기 실적 표"
    return TABLE_FALLBACKS.get(page_number)


def normalized_heading(value: str) -> str:
    return re.sub(r"[^0-9a-z가-힣]", "", normalize_text(value))


def data_region_heading(
    value: str,
) -> tuple[str, str, str] | None:
    normalized = normalized_heading(value)
    for metric, aliases, value_type, label in DATA_REGION_HEADINGS:
        if any(normalized == normalized_heading(alias) for alias in aliases):
            return metric, value_type, label
    return None


def dominant_prose_left(spans: list[dict[str, Any]]) -> float | None:
    groups: dict[int, int] = {}
    for span in spans:
        text = str(span.get("text") or "").strip()
        if len(text) < 20:
            continue
        key = round(float(span["bbox"][0]) / 4) * 4
        groups[key] = groups.get(key, 0) + len(text)
    if not groups:
        return None
    return float(max(groups.items(), key=lambda item: item[1])[0])


def boxes_intersect(left: list[float], right: list[float]) -> bool:
    return not (
        left[2] <= right[0]
        or left[0] >= right[2]
        or left[3] <= right[1]
        or left[1] >= right[3]
    )


def figure_heading(value: str) -> tuple[int, str] | None:
    match = FIGURE_HEADING_PATTERN.match(re.sub(r"\s+", " ", value).strip())
    if not match:
        return None
    return int(match.group(1)), match.group(2).strip()


def is_data_chart_title(value: str) -> bool:
    return any(pattern.search(value) for pattern in DATA_CHART_TITLE_PATTERNS)


def is_fixed_visual_title(value: str) -> bool:
    normalized = normalize_text(value)
    return any(term in normalized for term in FIXED_VISUAL_TITLE_TERMS)


def is_source_caption(value: str) -> bool:
    normalized = normalize_text(value)
    return normalized.startswith(("자료:", "자료：", "source:", "source："))


def region_column(
    heading_box: list[float],
    page_box: list[float],
) -> tuple[float, float]:
    page_width = max(1.0, page_box[2] - page_box[0])
    midpoint = page_box[0] + page_width / 2
    margin = max(24.0, page_width * 0.07)
    gutter = max(8.0, page_width * 0.017)
    if float(heading_box[0]) < midpoint:
        return page_box[0] + margin, midpoint - gutter
    return midpoint + gutter, page_box[2] - margin


def object_ids_in_region(
    page_objects: list[dict[str, Any]],
    region_box: list[float],
) -> list[str]:
    return [
        str(item["objectId"])
        for item in page_objects
        if boxes_intersect(list(item.get("bbox") or [0, 0, 0, 0]), region_box)
    ]


def source_caption_bottom(
    spans: list[dict[str, Any]],
    heading_box: list[float],
    column: tuple[float, float] | None,
) -> float | None:
    captions = [
        span
        for span in spans
        if is_source_caption(str(span.get("text") or ""))
        and float(span["bbox"][1]) > float(heading_box[3])
        and (
            column is None
            or column[0] - 8
            <= (float(span["bbox"][0]) + float(span["bbox"][2])) / 2
            <= column[1] + 8
        )
    ]
    if not captions:
        return None
    nearest = min(captions, key=lambda span: float(span["bbox"][1]))
    return float(nearest["bbox"][3])


def detect_figure_regions(
    spans: list[dict[str, Any]],
    page_box: list[float],
) -> list[dict[str, Any]]:
    headings: list[dict[str, Any]] = []
    for span in spans:
        detected = figure_heading(str(span.get("text") or ""))
        if not detected:
            continue
        number, title = detected
        if is_fixed_visual_title(title):
            kind = "fixed_visual"
        elif is_data_chart_title(title):
            kind = "data_chart"
        else:
            continue
        headings.append(
            {
                "span": span,
                "figureNumber": number,
                "title": title,
                "kind": kind,
            }
        )

    regions: list[dict[str, Any]] = []
    page_width = max(1.0, page_box[2] - page_box[0])
    full_margin = max(24.0, page_width * 0.07)
    for heading in headings:
        heading_box = list(heading["span"]["bbox"])
        if heading["kind"] == "fixed_visual":
            column = None
            left = page_box[0] + full_margin
            right = page_box[2] - full_margin
        else:
            column = region_column(heading_box, page_box)
            left, right = column
        caption_bottom = source_caption_bottom(spans, heading_box, column)
        if caption_bottom is None:
            later_headings = [
                item
                for item in headings
                if float(item["span"]["bbox"][1]) > float(heading_box[1]) + 4
            ]
            next_top = (
                min(float(item["span"]["bbox"][1]) for item in later_headings)
                if later_headings
                else page_box[3] - 60
            )
            caption_bottom = min(
                next_top - 8,
                float(heading_box[1]) + (page_box[3] - page_box[1]) * 0.28,
            )
        regions.append(
            {
                **heading,
                "bbox": [
                    round(left, 4),
                    round(float(heading_box[1]), 4),
                    round(right, 4),
                    round(max(float(heading_box[3]), caption_bottom + 2), 4),
                ],
            }
        )
    return regions


def financial_table_heading(value: str) -> tuple[str, str] | None:
    normalized = normalized_heading(value)
    for metric, aliases, label in FINANCIAL_TABLE_HEADINGS:
        if any(normalized == normalized_heading(alias) for alias in aliases):
            return metric, label
    return None


def detect_financial_table_regions(
    spans: list[dict[str, Any]],
    page_box: list[float],
) -> list[dict[str, Any]]:
    headings: list[dict[str, Any]] = []
    for span in spans:
        detected = financial_table_heading(str(span.get("text") or ""))
        if not detected:
            continue
        metric, label = detected
        headings.append({"span": span, "metric": metric, "label": label})
    required_metrics = {item[0] for item in FINANCIAL_TABLE_HEADINGS}
    if {item["metric"] for item in headings} != required_metrics:
        return []

    all_source_bottoms = [
        float(span["bbox"][3])
        for span in spans
        if is_source_caption(str(span.get("text") or ""))
    ]
    page_width = max(1.0, page_box[2] - page_box[0])
    default_bottom = (
        max(all_source_bottoms) + 2
        if all_source_bottoms
        else page_box[3] - max(60.0, page_width * 0.1)
    )
    regions: list[dict[str, Any]] = []
    for heading in headings:
        heading_box = list(heading["span"]["bbox"])
        column = region_column(heading_box, page_box)
        next_in_column = [
            item
            for item in headings
            if float(item["span"]["bbox"][1]) > float(heading_box[1]) + 4
            and region_column(list(item["span"]["bbox"]), page_box) == column
        ]
        bottom = (
            min(float(item["span"]["bbox"][1]) for item in next_in_column) - 12
            if next_in_column
            else default_bottom
        )
        regions.append(
            {
                **heading,
                "bbox": [
                    round(column[0], 4),
                    round(float(heading_box[1]), 4),
                    round(column[1], 4),
                    round(max(float(heading_box[3]), bottom), 4),
                ],
            }
        )
    return regions


def detect_data_regions(
    spans: list[dict[str, Any]],
    page_box: list[float],
) -> list[dict[str, Any]]:
    headings: list[dict[str, Any]] = []
    for span in spans:
        detected = data_region_heading(str(span.get("text") or ""))
        if not detected:
            continue
        metric, value_type, label = detected
        headings.append(
            {
                "span": span,
                "metric": metric,
                "valueType": value_type,
                "label": label,
            }
        )
    headings.sort(
        key=lambda item: (
            float(item["span"]["bbox"][1]),
            float(item["span"]["bbox"][0]),
        )
    )
    regions: list[dict[str, Any]] = []
    page_width = max(1.0, page_box[2] - page_box[0])
    max_column_width = min(150.0, max(120.0, page_width * 0.25))
    prose_left = dominant_prose_left(spans)
    for heading in headings:
        heading_box = heading["span"]["bbox"]
        heading_left = float(heading_box[0])
        heading_top = float(heading_box[1])
        next_heading = next(
            (
                item
                for item in headings
                if float(item["span"]["bbox"][1]) > heading_top + 1
                and abs(float(item["span"]["bbox"][0]) - heading_left) <= 36
            ),
            None,
        )
        hard_bottom = (
            float(next_heading["span"]["bbox"][1]) - 2
            if next_heading
            else float(page_box[3]) - 12
        )
        right_limit = heading_left + max_column_width
        if prose_left is not None and prose_left > heading_left + 30:
            right_limit = min(right_limit, prose_left - 8)
        candidates = sorted(
            (
                span
                for span in spans
                if float(span["bbox"][1]) >= heading_top - 1
                and float(span["bbox"][1]) < hard_bottom
                and float(span["bbox"][0]) >= heading_left - 10
                and float(span["bbox"][0]) <= right_limit
            ),
            key=lambda span: (
                float(span["bbox"][1]),
                float(span["bbox"][0]),
            ),
        )
        included: list[dict[str, Any]] = []
        previous_bottom = float(heading_box[3])
        for span in candidates:
            top = float(span["bbox"][1])
            if included and top - previous_bottom > 36:
                break
            included.append(span)
            previous_bottom = max(previous_bottom, float(span["bbox"][3]))
        if not included:
            included = [heading["span"]]
        region_box = union_bbox(
            [span["bbox"] for span in included],
            heading_box,
        )
        regions.append(
            {
                **heading,
                "bbox": region_box,
                "spans": included,
            }
        )
    return regions


def content_streams(doc: pymupdf.Document, page: pymupdf.Page) -> list[dict[str, Any]]:
    streams: list[dict[str, Any]] = []
    for xref in page.get_contents() or []:
        try:
            stream = doc.xref_stream(xref) or b""
        except Exception:
            stream = b""
        streams.append(
            {
                "objectRef": pdf_object_ref(xref),
                "tokenHash": digest(stream),
                "byteLength": len(stream),
            }
        )
    if not streams:
        streams.append(
            {
                "objectRef": pdf_object_ref(page.xref),
                "tokenHash": digest(b""),
                "byteLength": 0,
            }
        )
    return streams


def extract_fonts(
    doc: pymupdf.Document, page: pymupdf.Page, resources: dict[str, Any]
) -> dict[str, str]:
    font_map: dict[str, str] = {}
    known = {item["resourceId"] for item in resources["fonts"]}
    for item in page.get_fonts(full=True):
        xref = int(item[0])
        subtype = str(item[2] or "Unknown")
        base_font = str(item[3] or item[4] or "Unknown")
        resource_name = str(item[4] or f"F{xref}")
        resource_id = opaque("font", f"{xref}:{resource_name}:{base_font}")
        font_map[base_font] = resource_id
        font_map[resource_name] = resource_id
        if resource_id in known:
            continue
        font_bytes = b""
        try:
            extracted = doc.extract_font(xref)
            if extracted and len(extracted) >= 4 and isinstance(extracted[3], bytes):
                font_bytes = extracted[3]
        except Exception:
            pass
        resources["fonts"].append(
            {
                "resourceId": resource_id,
                "resourceName": resource_name[:100],
                "objectRef": pdf_object_ref(xref or page.xref),
                "baseFont": base_font[:500],
                "fullName": base_font[:500],
                "subtype": subtype[:100],
                "encoding": str(item[5] or "")[:200],
                "toUnicodePresent": bool(font_bytes),
                "embedded": bool(font_bytes),
                **({"fontProgramHash": digest(font_bytes)} if font_bytes else {}),
                "subset": "+" in base_font,
                "glyphIds": [],
                "licenseStatus": "unknown",
            }
        )
        known.add(resource_id)
    return font_map


def extract_images(
    doc: pymupdf.Document,
    page: pymupdf.Page,
    page_id: str,
    resources: dict[str, Any],
    page_objects: list[dict[str, Any]],
    stream_ref: str,
    start_z: int,
) -> int:
    known = {item["resourceId"] for item in resources["images"]}
    z_order = start_z
    for image in page.get_images(full=True):
        xref = int(image[0])
        image_id = opaque("image", str(xref))
        if image_id not in known:
            try:
                extracted = doc.extract_image(xref)
                image_bytes = extracted.get("image", b"")
            except Exception:
                extracted = {}
                image_bytes = b""
            resources["images"].append(
                {
                    "resourceId": image_id,
                    "objectRef": pdf_object_ref(xref),
                    "widthPx": max(1, int(image[2])),
                    "heightPx": max(1, int(image[3])),
                    "colorSpace": str(image[5] or "Unknown")[:100],
                    "filters": [str(image[8])] if len(image) > 8 and image[8] else [],
                    "sha256": digest(image_bytes),
                }
            )
            known.add(image_id)
        try:
            rects = page.get_image_rects(xref)
        except Exception:
            rects = []
        for occurrence, rect in enumerate(rects):
            object_id = opaque("obj", f"{page_id}:image:{xref}:{occurrence}")
            token_hash = digest(f"{xref}:{occurrence}:{bbox(rect)}")
            page_objects.append(
                {
                    "objectId": object_id,
                    "type": "image",
                    "role": "fixed_design",
                    "bbox": bbox(rect),
                    "zOrder": z_order,
                    "ctm": [1, 0, 0, 1, 0, 0],
                    "sourceLocator": {
                        "pageObjectRef": pdf_object_ref(page.xref),
                        "containerPath": ["page", page.number, "image", occurrence],
                        "streamObjectRef": stream_ref,
                        "operatorStart": occurrence,
                        "operatorEnd": occurrence + 1,
                        "tokenHash": token_hash,
                        "sharedXObject": False,
                        "cloneOnWriteRequired": False,
                    },
                    "clipStack": [],
                    "resourceRefs": [image_id],
                    "imageRef": image_id,
                }
            )
            z_order += 1
    return z_order


def extract_text_and_styles(
    page: pymupdf.Page,
    page_id: str,
    page_data: dict[str, Any],
    resources: dict[str, Any],
    font_map: dict[str, str],
    stream_ref: str,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], str]:
    objects: list[dict[str, Any]] = []
    span_records: list[dict[str, Any]] = []
    page_text_parts: list[str] = []
    known_styles = {item["resourceId"] for item in resources["styles"]}
    z_order = 0
    for block_index, raw_block in enumerate(page_data.get("blocks", [])):
        if raw_block.get("type") != 0:
            continue
        for line_index, line in enumerate(raw_block.get("lines", [])):
            direction = line.get("dir", (1, 0))
            writing_mode = "vertical" if abs(float(direction[1])) > abs(float(direction[0])) else "horizontal"
            for span_index, span in enumerate(line.get("spans", [])):
                chars = span.get("chars", [])
                text = "".join(str(char.get("c", "")) for char in chars)
                if not text:
                    text = str(span.get("text", ""))
                if not text.strip():
                    continue
                span_box = bbox(span.get("bbox"))
                page_text_parts.append(text)
                font_name = str(span.get("font") or "Unknown")
                font_ref = font_map.get(font_name) or opaque("font", font_name)
                style_source = {
                    "font": font_name,
                    "size": round(float(span.get("size") or 1), 4),
                    "flags": int(span.get("flags") or 0),
                    "color": int(span.get("color") or 0),
                    "alpha": int(span.get("alpha") or 255),
                }
                style_hash = digest(json.dumps(style_source, sort_keys=True))
                style_id = opaque("style", style_hash)
                if style_id not in known_styles:
                    resources["styles"].append(
                        {
                            "resourceId": style_id,
                            "propertiesHash": style_hash,
                            "properties": style_source,
                        }
                    )
                    known_styles.add(style_id)
                object_id = opaque(
                    "obj", f"{page_id}:text:{block_index}:{line_index}:{span_index}:{text}"
                )
                metric = infer_metric(text)
                role = "dynamic_value" if metric and any(char.isdigit() for char in text) else "fixed_design"
                origin = span.get("origin") or [span_box[0], span_box[3]]
                glyphs = []
                for char in chars:
                    char_text = str(char.get("c", ""))
                    char_box = bbox(char.get("bbox"))
                    char_origin = char.get("origin") or [char_box[0], char_box[3]]
                    glyphs.append(
                        {
                            "characterCode": f"{ord(char_text[0]):X}" if char_text else "0",
                            "unicode": char_text[:16],
                            "glyphId": 0,
                            "advance": max(0, round(char_box[2] - char_box[0], 4)),
                            "offset": [
                                round(float(char_origin[0]), 4),
                                round(float(char_origin[1]), 4),
                            ],
                        }
                    )
                token_hash = digest(
                    json.dumps(
                        {"text": text, "bbox": span_box, "style": style_hash},
                        ensure_ascii=False,
                        sort_keys=True,
                    )
                )
                text_run = {
                    "text": text[:20000],
                    "glyphs": glyphs,
                    "glyphSequenceHash": digest(
                        "".join(glyph["characterCode"] for glyph in glyphs)
                    ),
                    "textMatrix": [1, 0, 0, 1, float(origin[0]), float(origin[1])],
                    "baseline": [
                        [round(float(origin[0]), 4), round(float(origin[1]), 4)],
                        [span_box[2], round(float(origin[1]), 4)],
                    ],
                    "fontRef": font_ref,
                    "fontSize": max(0.01, round(float(span.get("size") or 1), 4)),
                    "writingMode": writing_mode,
                    "characterSpacing": 0,
                    "wordSpacing": 0,
                    "horizontalScaling": 100,
                    "textRise": 0,
                    "renderingMode": 0,
                    "fillColor": rgb_color(span.get("color")),
                    "opacity": round(int(span.get("alpha") or 255) / 255, 6),
                    "blendMode": "Normal",
                    "lineHeight": max(0.01, round(span_box[3] - span_box[1], 4)),
                    "alignment": "unknown",
                    "actualTextPresent": True,
                }
                objects.append(
                    {
                        "objectId": object_id,
                        "type": "text_run",
                        "role": role,
                        "bbox": span_box,
                        "zOrder": z_order,
                        "ctm": [1, 0, 0, 1, 0, 0],
                        "sourceLocator": {
                            "pageObjectRef": pdf_object_ref(page.xref),
                            "containerPath": [
                                "page",
                                page.number,
                                "text",
                                block_index,
                                line_index,
                                span_index,
                            ],
                            "streamObjectRef": stream_ref,
                            "operatorStart": z_order,
                            "operatorEnd": z_order + 1,
                            "tokenHash": token_hash,
                            "sharedXObject": False,
                            "cloneOnWriteRequired": False,
                        },
                        "styleRef": style_id,
                        "clipStack": [],
                        "resourceRefs": [font_ref],
                        "textRun": text_run,
                    }
                )
                span_records.append(
                    {
                        "objectId": object_id,
                        "styleId": style_id,
                        "bbox": span_box,
                        "text": text,
                        "fontSize": text_run["fontSize"],
                        "metric": metric,
                    }
                )
                z_order += 1
    return objects, span_records, "\n".join(page_text_parts)


def extract_paths(
    page: pymupdf.Page,
    page_id: str,
    stream_ref: str,
    start_z: int,
) -> list[dict[str, Any]]:
    objects: list[dict[str, Any]] = []
    for index, drawing in enumerate(page.get_drawings()):
        drawing_box = bbox(drawing.get("rect"))
        compact = {
            "items": [list(map(str, item)) for item in drawing.get("items", [])],
            "fill": drawing.get("fill"),
            "color": drawing.get("color"),
            "width": drawing.get("width"),
            "closePath": drawing.get("closePath"),
        }
        path_data = json.dumps(compact, ensure_ascii=False, default=str)[:200000]
        token_hash = digest(path_data)
        objects.append(
            {
                "objectId": opaque("obj", f"{page_id}:path:{index}:{token_hash}"),
                "type": "path",
                "role": "fixed_design",
                "bbox": drawing_box,
                "zOrder": start_z + index,
                "ctm": [1, 0, 0, 1, 0, 0],
                "sourceLocator": {
                    "pageObjectRef": pdf_object_ref(page.xref),
                    "containerPath": ["page", page.number, "path", index],
                    "streamObjectRef": stream_ref,
                    "operatorStart": start_z + index,
                    "operatorEnd": start_z + index + 1,
                    "tokenHash": token_hash,
                    "sharedXObject": False,
                    "cloneOnWriteRequired": False,
                },
                "clipStack": [],
                "resourceRefs": [],
                "pathData": path_data,
            }
        )
    return objects


def build_blocks_and_slots(
    page_number: int,
    page_id: str,
    page_box: list[float],
    page_text: str,
    spans: list[dict[str, Any]],
    page_objects: list[dict[str, Any]],
    document_metrics: set[str],
    document_period: str | None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    blocks: list[dict[str, Any]] = []
    slots: list[dict[str, Any]] = []
    masks: list[dict[str, Any]] = []
    used_metrics: set[str] = set()
    prose_left = dominant_prose_left(spans)
    data_regions = detect_data_regions(spans, page_box)
    data_region_object_ids: set[str] = set()

    for region in data_regions:
        metric = str(region["metric"])
        value_type = str(region["valueType"])
        label = str(region["label"])
        box = region["bbox"]
        object_ids = [
            str(item["objectId"])
            for item in page_objects
            if boxes_intersect(list(item.get("bbox") or [0, 0, 0, 0]), box)
        ]
        data_region_object_ids.update(object_ids)
        block_id = opaque(
            "block",
            f"{page_id}:data-region:{metric}:{region['span']['objectId']}",
        )
        slot_id = opaque(
            "slot",
            f"{page_id}:data-region:{metric}:{region['span']['objectId']}",
        )
        mask_id = opaque("mask", f"{page_id}:{slot_id}")
        blocks.append(
            {
                "blockId": block_id,
                "role": "chart" if value_type == "chart" else "table",
                "bbox": box,
                "objectIds": object_ids,
                "slotIds": [slot_id],
                "allowedRegion": box,
                "patchStrategy": "block_vector_replace",
                "fallbackStrategies": ["region_background_patch"],
                "overflow": "reject",
                "validationMaskIds": [mask_id],
                "intersections": [],
                "generationRule": label,
            }
        )
        slots.append(
            {
                "slotId": slot_id,
                "blockId": block_id,
                "valueType": value_type,
                "semanticKey": {
                    "metric": metric,
                    **({"period": document_period} if document_period else {}),
                },
                "required": False,
                "targetObjectIds": object_ids,
                "bindingRefs": [],
                "valueAuthority": "mapping",
                "overflow": "reject",
            }
        )
        masks.append(
            {
                "maskId": mask_id,
                "kind": "dynamic",
                "geometry": box,
                "blockIds": [block_id],
                "objectIds": object_ids,
                "reason": f"{label} 선택 영역",
            }
        )

    figure_regions = detect_figure_regions(spans, page_box)
    for region in figure_regions:
        number = int(region["figureNumber"])
        title = str(region["title"])
        box = list(region["bbox"])
        object_ids = object_ids_in_region(page_objects, box)
        data_region_object_ids.update(object_ids)
        if region["kind"] == "fixed_visual":
            block_id = opaque(
                "block",
                f"{page_id}:fixed-visual:figure:{number}:{title}",
            )
            blocks.append(
                {
                    "blockId": block_id,
                    "role": "fixed_design",
                    "bbox": box,
                    "objectIds": object_ids,
                    "slotIds": [],
                    "allowedRegion": box,
                    "patchStrategy": "operator_replace",
                    "fallbackStrategies": [],
                    "overflow": "reject",
                    "validationMaskIds": [],
                    "intersections": [],
                    "generationRule": f"도표 {number}. {title}",
                }
            )
            continue

        metric = f"figure_{number}_chart"
        if metric in document_metrics:
            continue
        document_metrics.add(metric)
        block_id = opaque("block", f"{page_id}:chart:{metric}:{title}")
        slot_id = opaque("slot", f"{page_id}:chart:{metric}:{title}")
        mask_id = opaque("mask", f"{page_id}:{slot_id}")
        blocks.append(
            {
                "blockId": block_id,
                "role": "chart",
                "bbox": box,
                "objectIds": object_ids,
                "slotIds": [slot_id],
                "allowedRegion": box,
                "patchStrategy": "block_vector_replace",
                "fallbackStrategies": ["region_background_patch"],
                "overflow": "reject",
                "validationMaskIds": [mask_id],
                "intersections": [],
                "generationRule": f"도표 {number}. {title}",
            }
        )
        slots.append(
            {
                "slotId": slot_id,
                "blockId": block_id,
                "valueType": "chart",
                "semanticKey": {
                    "metric": metric,
                    "scope": title[:100],
                    **({"period": document_period} if document_period else {}),
                },
                "required": True,
                "targetObjectIds": object_ids,
                "bindingRefs": [],
                "valueAuthority": "mapping",
                "overflow": "reject",
            }
        )
        masks.append(
            {
                "maskId": mask_id,
                "kind": "dynamic",
                "geometry": box,
                "blockIds": [block_id],
                "objectIds": object_ids,
                "reason": f"도표 {number} 데이터 차트 재생성 영역",
            }
        )

    financial_table_regions = detect_financial_table_regions(spans, page_box)
    for region in financial_table_regions:
        metric = str(region["metric"])
        label = str(region["label"])
        box = list(region["bbox"])
        object_ids = object_ids_in_region(page_objects, box)
        data_region_object_ids.update(object_ids)
        document_metrics.add(metric)
        block_id = opaque("block", f"{page_id}:table:{metric}")
        slot_id = opaque("slot", f"{page_id}:table:{metric}")
        mask_id = opaque("mask", f"{page_id}:{slot_id}")
        blocks.append(
            {
                "blockId": block_id,
                "role": "table",
                "bbox": box,
                "objectIds": object_ids,
                "slotIds": [slot_id],
                "allowedRegion": box,
                "patchStrategy": "block_vector_replace",
                "fallbackStrategies": ["region_background_patch"],
                "overflow": "reject",
                "validationMaskIds": [mask_id],
                "intersections": [],
                "generationRule": label,
            }
        )
        slots.append(
            {
                "slotId": slot_id,
                "blockId": block_id,
                "valueType": "table",
                "semanticKey": {
                    "metric": metric,
                    "scope": label,
                    **({"period": document_period} if document_period else {}),
                },
                "required": True,
                "targetObjectIds": object_ids,
                "bindingRefs": [],
                "valueAuthority": "mapping",
                "overflow": "reject",
            }
        )
        masks.append(
            {
                "maskId": mask_id,
                "kind": "dynamic",
                "geometry": box,
                "blockIds": [block_id],
                "objectIds": object_ids,
                "reason": f"{label} 재생성 영역",
            }
        )

    for span in spans:
        metric_info = span["metric"]
        if not metric_info:
            continue
        metric, value_type, required = metric_info
        span_left = float(span["bbox"][0])
        if span["objectId"] in data_region_object_ids:
            continue
        if prose_left is not None and abs(span_left - prose_left) <= 24:
            continue
        if len(str(span.get("text") or "").strip()) > 80:
            continue
        if metric in used_metrics or metric in document_metrics:
            continue
        target_span = span
        if value_type != "string":
            same_row_values = [
                candidate
                for candidate in spans
                if candidate["objectId"] != span["objectId"]
                and candidate["objectId"] not in data_region_object_ids
                and float(candidate["bbox"][0]) >= float(span["bbox"][2]) - 2
                and abs(
                    float(candidate["bbox"][1]) - float(span["bbox"][1])
                )
                <= 3
                and any(
                    char.isdigit()
                    for char in str(candidate.get("text") or "")
                )
            ]
            if same_row_values:
                target_span = min(
                    same_row_values,
                    key=lambda candidate: float(candidate["bbox"][0]),
                )
        used_metrics.add(metric)
        document_metrics.add(metric)
        block_id = opaque("block", f"{page_id}:scalar:{metric}")
        slot_id = opaque("slot", f"{page_id}:{metric}:{span['objectId']}")
        box = target_span["bbox"]
        mask_id = opaque("mask", f"{page_id}:{slot_id}")
        blocks.append(
            {
                "blockId": block_id,
                "role": "scalar_group",
                "bbox": box,
                "objectIds": [target_span["objectId"]],
                "slotIds": [slot_id],
                "allowedRegion": box,
                "patchStrategy": "operator_replace",
                "fallbackStrategies": ["region_background_patch"],
                "overflow": "shrink_to_fit",
                "validationMaskIds": [mask_id],
                "intersections": [],
            }
        )
        slots.append(
            {
                "slotId": slot_id,
                "blockId": block_id,
                "valueType": value_type,
                "semanticKey": {
                    "metric": metric,
                    **({"period": document_period} if document_period else {}),
                },
                "required": required,
                "styleRef": target_span["styleId"],
                "targetObjectIds": [target_span["objectId"]],
                "bindingRefs": [],
                "valueAuthority": "mapping",
                "overflow": "shrink_to_fit",
                "maxLength": 200,
            }
        )
        masks.append(
            {
                "maskId": mask_id,
                "kind": "dynamic",
                "geometry": box,
                "blockIds": [block_id],
                "objectIds": [target_span["objectId"]],
                "reason": f"{metric} 값 교체 영역",
            }
        )

    table_metric = infer_table_metric(page_number, page_text)
    if (
        table_metric
        and not financial_table_regions
        and not figure_regions
        and table_metric[0] not in document_metrics
        and (
            sum(1 for item in page_objects if item.get("type") == "path") >= 3
            or page_number in TABLE_FALLBACKS
        )
    ):
        metric, label = table_metric
        document_metrics.add(metric)
        block_id = opaque("block", f"{page_id}:table:{metric}")
        slot_id = opaque("slot", f"{page_id}:table:{metric}")
        object_ids = [str(item["objectId"]) for item in page_objects]
        content_box = union_bbox(
            [list(item.get("bbox") or page_box) for item in page_objects],
            page_box,
        )
        mask_id = opaque("mask", f"{page_id}:{slot_id}")
        blocks.append(
            {
                "blockId": block_id,
                "role": "table",
                "bbox": content_box,
                "objectIds": object_ids,
                "slotIds": [slot_id],
                "allowedRegion": content_box,
                "patchStrategy": "block_vector_replace",
                "fallbackStrategies": ["region_background_patch"],
                "overflow": "reject",
                "validationMaskIds": [mask_id],
                "intersections": [],
                "generationRule": label,
            }
        )
        slots.append(
            {
                "slotId": slot_id,
                "blockId": block_id,
                "valueType": "table",
                "semanticKey": {
                    "metric": metric,
                    **({"period": document_period} if document_period else {}),
                },
                "required": True,
                "targetObjectIds": object_ids,
                "bindingRefs": [],
                "valueAuthority": "mapping",
                "overflow": "reject",
            }
        )
        masks.append(
            {
                "maskId": mask_id,
                "kind": "dynamic",
                "geometry": content_box,
                "blockIds": [block_id],
                "objectIds": object_ids,
                "reason": f"{label} 재생성 영역",
            }
        )

    masks.append(
        {
            "maskId": opaque("mask", f"{page_id}:fixed"),
            "kind": "fixed",
            "geometry": page_box,
            "blockIds": [],
            "objectIds": [],
            "reason": "동적 영역을 제외한 고정 디자인 기준",
        }
    )
    return blocks, slots, masks


def inspect_pdf_bytes(payload: bytes) -> dict[str, Any]:
    issues: list[dict[str, str]] = []
    if len(payload) > MAX_PDF_BYTES:
        return {
            "pageCount": 0,
            "textLayer": False,
            "compatible": False,
            "issues": [
                {
                    "code": "FILE_TOO_LARGE",
                    "severity": "blocking",
                    "message": "PDF는 최대 50 MiB까지 지원합니다.",
                }
            ],
            "parserName": PARSER_NAME,
            "parserVersion": PARSER_VERSION,
            "templateIr": None,
            "summary": {},
        }
    try:
        doc = pymupdf.open(stream=payload, filetype="pdf")
    except Exception:
        return {
            "pageCount": 0,
            "textLayer": False,
            "compatible": False,
            "issues": [
                {
                    "code": "PDF_PARSE_FAILED",
                    "severity": "blocking",
                    "message": "PDF 구조를 읽을 수 없습니다.",
                }
            ],
            "parserName": PARSER_NAME,
            "parserVersion": PARSER_VERSION,
            "templateIr": None,
            "summary": {},
        }

    try:
        if doc.needs_pass:
            issues.append(
                {
                    "code": "FILE_ENCRYPTED",
                    "severity": "blocking",
                    "message": "암호화된 PDF는 지원하지 않습니다.",
                }
            )
        page_count = doc.page_count
        if page_count < 1 or page_count > MAX_PAGES:
            issues.append(
                {
                    "code": "PDF_PAGE_LIMIT_EXCEEDED",
                    "severity": "blocking",
                    "message": "PDF는 1~100페이지만 지원합니다.",
                }
            )
        pdf_hash = digest(payload)
        template_id = opaque("tpl", pdf_hash)
        resources: dict[str, list[Any]] = {
            "fonts": [],
            "images": [],
            "xobjects": [],
            "styles": [],
            "clipPaths": [],
        }
        pages: list[dict[str, Any]] = []
        text_page_count = 0
        document_metrics: set[str] = set()
        document_period: str | None = None
        for page_index in range(min(page_count, MAX_PAGES)):
            page = doc.load_page(page_index)
            page_number = page_index + 1
            page_id = opaque("page", f"{pdf_hash}:{page_number}")
            streams = content_streams(doc, page)
            stream_ref = streams[0]["objectRef"]
            font_map = extract_fonts(doc, page, resources)
            raw_text = page.get_text("rawdict", sort=False)
            text_objects, spans, page_text = extract_text_and_styles(
                page, page_id, raw_text, resources, font_map, stream_ref
            )
            if page_text.strip():
                text_page_count += 1
            if document_period is None:
                period_match = re.search(
                    r"\b([1-4])Q\s*(\d{2})\b", page_text, re.IGNORECASE
                )
                if period_match:
                    document_period = (
                        f"{period_match.group(1)}Q{period_match.group(2)}"
                    )
            path_objects = extract_paths(
                page, page_id, stream_ref, len(text_objects)
            )
            objects = text_objects + path_objects
            next_z = extract_images(
                doc,
                page,
                page_id,
                resources,
                objects,
                stream_ref,
                len(objects),
            )
            _ = next_z
            page_box = bbox(page.rect)
            blocks, slots, masks = build_blocks_and_slots(
                page_number,
                page_id,
                page_box,
                page_text,
                spans,
                objects,
                document_metrics,
                document_period,
            )
            links = []
            for link in page.get_links():
                target = str(link.get("uri") or link.get("file") or link.get("page", ""))
                if target:
                    links.append({"bbox": bbox(link.get("from")), "target": target[:2000]})
            annotations = []
            annotations_iter = page.annots()
            if annotations_iter:
                for annotation in annotations_iter:
                    annotations.append(
                        {
                            "objectRef": pdf_object_ref(annotation.xref),
                            "subtype": str(annotation.type[1] or annotation.type[0])[:100],
                            "bbox": bbox(annotation.rect),
                        }
                    )
            if annotations:
                issues.append(
                    {
                        "code": "PDF_ANNOTATIONS_PRESENT",
                        "severity": "warning",
                        "message": f"{page_number}페이지에 주석 {len(annotations)}개가 있습니다.",
                    }
                )
            transform = matrix(page.transformation_matrix)
            try:
                inverse = matrix(~page.transformation_matrix)
            except Exception:
                inverse = transform
            boxes: dict[str, Any] = {
                "mediaBox": bbox(page.mediabox),
                "cropBox": bbox(page.cropbox),
            }
            for source_name, target_name in (
                ("bleedbox", "bleedBox"),
                ("trimbox", "trimBox"),
                ("artbox", "artBox"),
            ):
                value = getattr(page, source_name, None)
                if value is not None:
                    boxes[target_name] = bbox(value)
            pages.append(
                {
                    "pageId": page_id,
                    "pageNumber": page_number,
                    "pageLabel": str(page_number),
                    "pageObjectRef": pdf_object_ref(page.xref),
                    "boxes": boxes,
                    "rotation": int(page.rotation),
                    "userUnit": 1,
                    "pdfToViewMatrix": transform,
                    "viewToPdfMatrix": inverse,
                    "contentStreams": streams,
                    "resourceInheritance": {
                        "inherited": False,
                        "ownerObjectRef": pdf_object_ref(page.xref),
                    },
                    "blocks": blocks,
                    "slots": slots,
                    "objects": objects,
                    "validationMasks": masks,
                    "links": links,
                    "annotations": annotations,
                    "taggedStatus": "tagged_needs_revalidation"
                    if b"/MarkInfo" in payload
                    else "not_tagged",
                }
            )

        text_layer = page_count > 0 and text_page_count == page_count
        if not text_layer:
            issues.append(
                {
                    "code": "PDF_TEXT_LAYER_REQUIRED",
                    "severity": "blocking",
                    "message": "모든 페이지에 선택 가능한 텍스트가 필요합니다.",
                }
            )
        pdf_format = str(doc.metadata.get("format") or "PDF 1.7")
        match = re.search(r"(\d\.\d)", pdf_format)
        pdf_version = match.group(1) if match else "1.7"
        profile_hash = digest(
            "288:opaque_srgb:0.995:2:0.5:2"
        )
        warnings = [
            {"code": issue["code"], "message": issue["message"]}
            for issue in issues
            if issue["severity"] != "blocking"
        ]
        template_ir = {
            "schemaVersion": "1.0",
            "templateId": template_id,
            "templateVersion": 1,
            "source": {
                "pdfHash": pdf_hash,
                "pdfVersion": pdf_version,
                "parser": {"name": PARSER_NAME, "version": PARSER_VERSION},
                "taggedPdf": b"/MarkInfo" in payload,
                "linearized": b"/Linearized" in payload[:2048],
            },
            "pages": pages,
            "resources": resources,
            "validationProfile": {
                "profileId": opaque("profile", profile_hash),
                "renderDpi": 288,
                "background": "opaque_srgb",
                "fixedPixelMatchThreshold": 0.995,
                "channelDifferenceThreshold": 2,
                "maxCoordinateErrorPt": 0.5,
                "maxEdgeDisplacementPx": 2,
                "profileHash": profile_hash,
            },
            "analysisWarnings": warnings,
        }
        all_blocks = [block for page in pages for block in page["blocks"]]
        all_slots = [slot for page in pages for slot in page["slots"]]
        all_objects = [item for page in pages for item in page["objects"]]
        summary = {
            "blockCount": len(all_blocks),
            "slotCount": len(all_slots),
            "requiredSlotCount": sum(1 for slot in all_slots if slot["required"]),
            "objectCount": len(all_objects),
            "textObjectCount": sum(1 for item in all_objects if item["type"] == "text_run"),
            "pathCount": sum(1 for item in all_objects if item["type"] == "path"),
            "fontCount": len(resources["fonts"]),
            "imageCount": len(resources["images"]),
            "tableCount": sum(1 for block in all_blocks if block["role"] == "table"),
            "chartCount": sum(1 for block in all_blocks if block["role"] == "chart"),
            "warningCount": len(warnings),
        }
        return {
            "pageCount": page_count,
            "textLayer": text_layer,
            "compatible": not any(
                issue["severity"] == "blocking" for issue in issues
            ),
            "issues": issues,
            "parserName": PARSER_NAME,
            "parserVersion": PARSER_VERSION,
            "templateIr": template_ir,
            "summary": summary,
        }
    finally:
        doc.close()


def inspect_pdf(download_url: str) -> dict[str, Any]:
    with urllib.request.urlopen(download_url, timeout=120) as response:
        payload = response.read(MAX_PDF_BYTES + 1)
    return inspect_pdf_bytes(payload)


def download_pdf(download_url: str) -> bytes:
    with urllib.request.urlopen(download_url, timeout=120) as response:
        payload = response.read(MAX_PDF_BYTES + 1)
    if len(payload) > MAX_PDF_BYTES:
        raise ValueError("PDF exceeds the 50 MiB limit")
    if not payload.startswith(b"%PDF-"):
        raise ValueError("source is not a PDF")
    return payload


def color_components(value: int | None) -> tuple[float, float, float]:
    color = int(value or 0)
    return (
        ((color >> 16) & 255) / 255,
        ((color >> 8) & 255) / 255,
        (color & 255) / 255,
    )


def source_style(page: pymupdf.Page, rect: pymupdf.Rect) -> dict[str, Any]:
    candidates: list[dict[str, Any]] = []
    for block in page.get_text("dict", flags=pymupdf.TEXTFLAGS_DICT).get("blocks", []):
        if block.get("type") != 0:
            continue
        for line in block.get("lines", []):
            for span in line.get("spans", []):
                span_rect = pymupdf.Rect(span.get("bbox"))
                overlap = span_rect & rect
                if overlap.is_empty:
                    continue
                font_name = str(span.get("font") or "")
                candidates.append(
                    {
                        "overlap": overlap.get_area(),
                        "fontSize": float(span.get("size") or 10),
                        "color": color_components(span.get("color")),
                        "bold": bool(int(span.get("flags") or 0) & 16)
                        or bool(
                            re.search(
                                r"(bold|black|semibold|demi|medium|medi)",
                                font_name,
                                re.IGNORECASE,
                            )
                        ),
                        "lineHeight": max(
                            1.0,
                            float(span_rect.height)
                            / max(1.0, float(span.get("size") or 10)),
                        ),
                    }
                )
    if not candidates:
        return {
            "fontSize": max(7.0, min(11.0, rect.height * 0.7)),
            "color": (0.0, 0.0, 0.0),
            "bold": False,
            "lineHeight": 1.25,
        }
    return max(candidates, key=lambda item: item["overlap"])


def render_pdfium_page(
    document: pdfium.PdfDocument,
    page_index: int,
    scale: float,
) -> np.ndarray:
    page = document[page_index]
    bitmap = page.render(scale=scale, rev_byteorder=True)
    array = bitmap.to_numpy().copy()
    if array.ndim == 2:
        array = cv2.cvtColor(array, cv2.COLOR_GRAY2RGB)
    elif array.shape[2] == 4:
        rgb = array[:, :, :3].astype(np.float32)
        alpha = array[:, :, 3:4].astype(np.float32) / 255.0
        array = np.clip(rgb * alpha + 255.0 * (1.0 - alpha), 0, 255).astype(
            np.uint8
        )
    return array[:, :, :3]


def validate_fixed_regions(
    source_pdf: bytes,
    result_pdf: bytes,
    patches: list[dict[str, Any]],
    dpi: int = 288,
) -> dict[str, Any]:
    source = pdfium.PdfDocument(source_pdf)
    result = pdfium.PdfDocument(result_pdf)
    if len(source) != len(result):
        raise ValueError("result page count differs from the source PDF")
    scale = dpi / 72
    patches_by_page: dict[int, list[list[float]]] = {}
    for patch in patches:
        patches_by_page.setdefault(int(patch["pageNumber"]) - 1, []).append(
            [float(value) for value in patch["bbox"]]
        )
    page_results: list[dict[str, Any]] = []
    passed = True
    try:
        for page_index in range(len(source)):
            source_image = render_pdfium_page(source, page_index, scale)
            result_image = render_pdfium_page(result, page_index, scale)
            if source_image.shape != result_image.shape:
                raise ValueError("result page dimensions differ from the source PDF")
            fixed_mask = np.ones(source_image.shape[:2], dtype=np.uint8)
            for rect in patches_by_page.get(page_index, []):
                guard = 1.0
                x0 = max(0, int(np.floor((rect[0] - guard) * scale)))
                y0 = max(0, int(np.floor((rect[1] - guard) * scale)))
                x1 = min(
                    fixed_mask.shape[1],
                    int(np.ceil((rect[2] + guard) * scale)),
                )
                y1 = min(
                    fixed_mask.shape[0],
                    int(np.ceil((rect[3] + guard) * scale)),
                )
                fixed_mask[y0:y1, x0:x1] = 0
            difference = cv2.absdiff(source_image, result_image)
            changed = (np.max(difference, axis=2) > 2).astype(np.uint8)
            changed[fixed_mask == 0] = 0
            fixed_pixels = int(np.count_nonzero(fixed_mask))
            changed_pixels = int(np.count_nonzero(changed))
            match_ratio = (
                1.0
                if fixed_pixels == 0
                else max(0.0, 1.0 - changed_pixels / fixed_pixels)
            )
            component_count = 0
            if changed_pixels:
                component_count = max(
                    0,
                    cv2.connectedComponentsWithStats(changed, connectivity=8)[0] - 1,
                )
            page_passed = match_ratio >= 0.995
            passed = passed and page_passed
            page_results.append(
                {
                    "pageNumber": page_index + 1,
                    "fixedPixelMatchRatio": round(match_ratio, 8),
                    "changedFixedPixels": changed_pixels,
                    "differenceComponentCount": component_count,
                    "passed": page_passed,
                }
            )
    finally:
        source.close()
        result.close()
    return {
        "profile": {
            "renderer": "PDFium",
            "dpi": dpi,
            "color": "opaque_srgb",
            "channelDifferenceThreshold": 2,
            "fixedPixelMatchThreshold": 0.995,
        },
        "passed": passed,
        "pages": page_results,
    }


def normalize_render_patches(
    patches: Any,
    page_count: int,
) -> list[dict[str, Any]]:
    if not isinstance(patches, list):
        raise ValueError("patches must be an array")
    normalized: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in patches:
        if not isinstance(item, dict):
            raise ValueError("patch item must be an object")
        block_id = str(item.get("blockId") or "").strip()
        page_number = int(item.get("pageNumber") or 0)
        text = str(item.get("text") or "").strip()
        rect = item.get("bbox")
        if (
            not block_id
            or block_id in seen
            or page_number < 1
            or page_number > page_count
            or not text
            or len(text) > 2_000
            or not isinstance(rect, list)
            or len(rect) != 4
        ):
            raise ValueError("invalid report patch")
        coordinates = [float(value) for value in rect]
        if (
            not all(np.isfinite(value) for value in coordinates)
            or coordinates[2] <= coordinates[0]
            or coordinates[3] <= coordinates[1]
        ):
            raise ValueError("invalid report patch rectangle")
        seen.add(block_id)
        normalized.append(
            {
                "blockId": block_id,
                "pageNumber": page_number,
                "bbox": coordinates,
                "text": text,
                "role": str(item.get("role") or "narrative"),
                "templateBlockId": item.get("templateBlockId"),
                "sourceObjectIds": item.get("sourceObjectIds") or [],
            }
        )
    return normalized


def render_pdf_bytes(
    payload: bytes,
    patch_input: Any,
    skip_overflow: bool = False,
) -> dict[str, Any]:
    document = pymupdf.open(stream=payload, filetype="pdf")
    try:
        patches = normalize_render_patches(patch_input, document.page_count)
        patches_by_page: dict[int, list[dict[str, Any]]] = {}
        for patch in patches:
            patches_by_page.setdefault(patch["pageNumber"] - 1, []).append(patch)

        warnings: list[dict[str, str]] = []
        render_operations: list[dict[str, Any]] = []
        applied_patches: list[dict[str, Any]] = []
        for page_index, page_patches in patches_by_page.items():
            page = document[page_index]
            page_rect = page.rect
            prepared: list[dict[str, Any]] = []
            for patch in page_patches:
                rect = pymupdf.Rect(patch["bbox"])
                if not page_rect.contains(rect):
                    raise ValueError(
                        f"patch {patch['blockId']} is outside the source page"
                    )
                style = source_style(page, rect)
                uses_korean = bool(re.search(r"[가-힣]", patch["text"]))
                font_file: str | None = None
                if uses_korean and os.path.exists(NOTO_CJK_REGULAR):
                    font_file = (
                        NOTO_CJK_BOLD
                        if style["bold"] and os.path.exists(NOTO_CJK_BOLD)
                        else NOTO_CJK_REGULAR
                    )
                    font_name = (
                        "RefloNotoCjkBold"
                        if style["bold"]
                        else "RefloNotoCjkRegular"
                    )
                else:
                    font_name = "korea" if uses_korean else "helv"
                source_font_size = float(style["fontSize"])
                minimum_font_size = max(5.5, source_font_size * 0.55)
                font_step = max(0.25, source_font_size * 0.03)
                fitted_font_size = source_font_size
                spare_height = -1.0
                while fitted_font_size >= minimum_font_size:
                    shape = page.new_shape()
                    spare_height = shape.insert_textbox(
                        rect,
                        patch["text"],
                        fontname=font_name,
                        fontfile=font_file,
                        fontsize=fitted_font_size,
                        lineheight=style["lineHeight"],
                        color=style["color"],
                        align=pymupdf.TEXT_ALIGN_LEFT,
                    )
                    if spare_height >= 0:
                        break
                    fitted_font_size -= font_step
                if spare_height < 0:
                    if skip_overflow:
                        warnings.append(
                            {
                                "code": "BLOCK_OVERFLOW_SKIPPED",
                                "message": (
                                    f"{patch['blockId']} 블록이 원본 영역을 벗어나 "
                                    "미리보기에서는 원문을 유지했습니다."
                                ),
                            }
                        )
                        continue
                    raise ValueError(
                        f"BLOCK_OVERFLOW:{patch['blockId']}:{round(spare_height, 3)}"
                    )
                page.add_redact_annot(rect, fill=None, cross_out=False)
                prepared.append(
                    {
                        "patch": patch,
                        "rect": rect,
                        "style": style,
                        "fontName": font_name,
                        "fontFile": font_file,
                        "sourceFontSize": source_font_size,
                        "fittedFontSize": fitted_font_size,
                    }
                )
            if prepared:
                page.apply_redactions(
                    images=pymupdf.PDF_REDACT_IMAGE_NONE,
                    graphics=pymupdf.PDF_REDACT_LINE_ART_NONE,
                    text=pymupdf.PDF_REDACT_TEXT_REMOVE,
                )
            for item in prepared:
                patch = item["patch"]
                rect = item["rect"]
                style = item["style"]
                font_name = item["fontName"]
                font_file = item["fontFile"]
                source_font_size = item["sourceFontSize"]
                fitted_font_size = item["fittedFontSize"]
                shape = page.new_shape()
                spare_height = shape.insert_textbox(
                    rect,
                    patch["text"],
                    fontname=font_name,
                    fontfile=font_file,
                    fontsize=fitted_font_size,
                    lineheight=style["lineHeight"],
                    color=style["color"],
                    align=pymupdf.TEXT_ALIGN_LEFT,
                )
                if spare_height < 0:
                    raise ValueError(
                        f"BLOCK_OVERFLOW:{patch['blockId']}:{round(spare_height, 3)}"
                    )
                shape.commit(overlay=True)
                if fitted_font_size < source_font_size - 0.01:
                    warnings.append(
                        {
                            "code": "FONT_SIZE_REDUCED_TO_FIT",
                            "message": (
                                f"{patch['blockId']} 블록 글자 크기를 "
                                f"{source_font_size:.2f}pt에서 "
                                f"{fitted_font_size:.2f}pt로 줄였습니다."
                            ),
                        }
                    )
                render_operations.append(
                    {
                        "blockId": patch["blockId"],
                        "pageNumber": patch["pageNumber"],
                        "bbox": patch["bbox"],
                        "strategy": "region_background_patch",
                        "font": font_name,
                        "fontSize": round(fitted_font_size, 4),
                        "sourceFontSize": round(source_font_size, 4),
                        "sourceObjectIds": patch["sourceObjectIds"],
                    }
                )
                applied_patches.append(patch)
        intermediate = document.tobytes(
            garbage=0,
            deflate=True,
            clean=False,
        )
    finally:
        document.close()

    final_stream = io.BytesIO()
    with pikepdf.Pdf.open(io.BytesIO(intermediate)) as final_pdf:
        final_pdf.save(final_stream)
    result = final_stream.getvalue()
    validation = validate_fixed_regions(payload, result, applied_patches)
    if not validation["passed"]:
        raise ValueError("FIXED_REGION_VISUAL_REGRESSION")
    if applied_patches:
        warnings.append(
            {
                "code": "REGION_BACKGROUND_PATCH_FALLBACK",
                "message": (
                    "초기 구현은 변경 영역의 텍스트 객체만 제거한 뒤 벡터 텍스트를 "
                    "삽입합니다. content stream operator 직접 교체는 후속 구현 대상입니다."
                ),
            }
        )
        warnings.append(
            {
                "code": "FONT_SUBSTITUTED_WITHIN_METRIC_TOLERANCE",
                "message": (
                    "새 한글 문자는 원본 subset glyph를 재사용하지 못하면 Noto Sans CJK로 "
                    "대체되며 원본 영역 안에서 크기를 검증합니다."
                ),
            }
        )
    return {
        "pdfBase64": base64.b64encode(result).decode("ascii"),
        "sha256": digest(result),
        "byteSize": len(result),
        "mediaType": "application/pdf",
        "renderPlan": {
            "version": "report-render-plan-v1",
            "sourcePdfHash": digest(payload),
            "operations": render_operations,
        },
        "validation": validation,
        "warnings": warnings,
    }


def render_pdf(
    download_url: str,
    patches: Any,
    skip_overflow: bool = False,
) -> dict[str, Any]:
    return render_pdf_bytes(
        download_pdf(download_url),
        patches,
        skip_overflow=skip_overflow,
    )


class Handler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        if self.path != "/health":
            self.send_error(404)
            return
        body = json.dumps(
            {"status": "ok", "parser": PARSER_NAME, "version": PARSER_VERSION}
        ).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self) -> None:
        if self.path not in {"/inspect", "/render"}:
            self.send_error(404)
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            request = json.loads(self.rfile.read(length))
            download_url = request.get("downloadUrl")
            if not isinstance(download_url, str) or not download_url.startswith(
                ("http://", "https://")
            ):
                raise ValueError("downloadUrl is required")
            result = (
                inspect_pdf(download_url)
                if self.path == "/inspect"
                else render_pdf(
                    download_url,
                    request.get("patches"),
                    skip_overflow=bool(request.get("skipOverflow")),
                )
            )
            body = json.dumps(result, ensure_ascii=False).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except Exception as error:
            body = json.dumps({"error": str(error)}, ensure_ascii=False).encode("utf-8")
            self.send_response(422)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    def log_message(self, format: str, *args: object) -> None:
        return


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8091"))
    ThreadingHTTPServer(("0.0.0.0", port), Handler).serve_forever()
