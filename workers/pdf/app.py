from __future__ import annotations

import hashlib
import json
import os
import re
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

import pymupdf


MAX_PDF_BYTES = 50 * 1024 * 1024
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
    if re.search(r"\bp\s*/\s*e\b", text, re.IGNORECASE):
        return "per", "decimal", True
    normalized = re.sub(r"[^0-9a-z가-힣]", "", normalize_text(text))
    for metric, aliases, value_type, required in SCALAR_METRICS:
        if any(
            re.sub(r"[^0-9a-z가-힣]", "", alias.lower()) in normalized
            for alias in aliases
        ):
            return metric, value_type, required
    return None


def infer_table_metric(page_number: int, page_text: str) -> tuple[str, str] | None:
    normalized = normalize_text(page_text)
    if "부문" in normalized or "segment" in normalized:
        return "segment_revenue_table", "부문별 매출 표"
    if any(term in normalized for term in ("재무상태표", "현금흐름", "손익계산서")):
        return "financial_statements_table", "재무제표 표"
    if "목표주가" in normalized and any(term in normalized for term in ("추이", "history")):
        return "target_price_history_table", "목표주가 추이 표"
    if "분기" in normalized and sum(
        term in normalized for term in ("매출", "영업이익", "순이익")
    ) >= 2:
        return "quarterly_performance_table", "분기 실적 표"
    return TABLE_FALLBACKS.get(page_number)


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
    path_count: int,
    document_metrics: set[str],
    document_period: str | None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    blocks: list[dict[str, Any]] = []
    slots: list[dict[str, Any]] = []
    masks: list[dict[str, Any]] = []
    used_metrics: set[str] = set()
    for span in spans:
        metric_info = span["metric"]
        if not metric_info:
            continue
        metric, value_type, required = metric_info
        if metric in used_metrics or metric in document_metrics:
            continue
        used_metrics.add(metric)
        document_metrics.add(metric)
        block_id = opaque("block", f"{page_id}:scalar:{metric}")
        slot_id = opaque("slot", metric)
        box = span["bbox"]
        mask_id = opaque("mask", f"{page_id}:{slot_id}")
        blocks.append(
            {
                "blockId": block_id,
                "role": "scalar_group",
                "bbox": box,
                "objectIds": [span["objectId"]],
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
                "styleRef": span["styleId"],
                "targetObjectIds": [span["objectId"]],
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
                "objectIds": [span["objectId"]],
                "reason": f"{metric} 값 교체 영역",
            }
        )

    table_metric = infer_table_metric(page_number, page_text)
    if (
        table_metric
        and table_metric[0] not in document_metrics
        and (path_count >= 3 or page_number in TABLE_FALLBACKS)
    ):
        metric, label = table_metric
        document_metrics.add(metric)
        block_id = opaque("block", f"{page_id}:table:{metric}")
        slot_id = opaque("slot", metric)
        object_ids = [span["objectId"] for span in spans]
        content_box = union_bbox([span["bbox"] for span in spans], page_box)
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
                len(path_objects),
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
        if self.path != "/inspect":
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
            result = inspect_pdf(download_url)
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
