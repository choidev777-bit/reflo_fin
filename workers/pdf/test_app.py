import base64
import re
import unittest
from pathlib import Path

import pymupdf

from app import (
    digest,
    inspect_pdf_bytes,
    render_pdf_bytes,
    render_plan_pdf_bytes,
    source_region_token_hashes,
)


def fixture_pdf() -> bytes:
    document = pymupdf.open()
    page = document.new_page(width=300, height=400)
    page.draw_rect(pymupdf.Rect(20, 20, 50, 50), color=(0.2, 0.7, 0.2), fill=(0.2, 0.7, 0.2))
    page.insert_textbox(
        pymupdf.Rect(60, 100, 240, 130),
        "Old report title",
        fontname="helv",
        fontsize=12,
        color=(0.05, 0.05, 0.05),
    )
    page.insert_text((20, 380), "Fixed footer", fontname="helv", fontsize=9)
    result = document.tobytes()
    document.close()
    return result


def broker_layout_pdf(side: str = "left") -> bytes:
    document = pymupdf.open()
    page = document.new_page(width=595.32, height=841.92)
    side_x = 43 if side == "left" else 405
    value_x = side_x + 87
    prose_x = 198 if side == "left" else 43
    page.insert_text((side_x, 150), "Current Price", fontname="helv", fontsize=8)
    page.insert_text((value_x, 150), "143,100", fontname="helv", fontsize=8)
    page.insert_text((side_x, 205), "Key Data", fontname="helv", fontsize=7)
    page.insert_text((side_x, 220), "Market cap", fontname="helv", fontsize=6)
    page.insert_text((value_x, 220), "3,033", fontname="helv", fontsize=6)
    page.insert_text((side_x, 335), "Consensus Data", fontname="helv", fontsize=7)
    page.insert_text((side_x, 350), "Revenue", fontname="helv", fontsize=6)
    page.insert_text((value_x, 350), "282.7", fontname="helv", fontsize=6)
    page.insert_text((side_x, 415), "Stock Price", fontname="helv", fontsize=7)
    page.insert_text((side_x, 500), "25.1", fontname="helv", fontsize=5)
    page.insert_text((side_x, 535), "Financial Data", fontname="helv", fontsize=7)
    page.insert_text((side_x, 555), "Operating profit", fontname="helv", fontsize=6)
    page.insert_text((value_x, 555), "93.7", fontname="helv", fontsize=6)
    page.insert_text(
        (prose_x, 205),
        "Revenue growth and target price assumptions are discussed here.",
        fontname="helv",
        fontsize=9,
    )
    page.insert_text(
        (prose_x, 225),
        "This long narrative belongs to the report body, not to Key Data.",
        fontname="helv",
        fontsize=9,
    )
    result = document.tobytes()
    document.close()
    return result


def overlapping_chart_pdf() -> bytes:
    document = pymupdf.open()
    page = document.new_page(width=595.32, height=841.92)
    page.insert_text(
        (48, 100),
        "Figure 21. Revenue trend",
        fontname="helv",
        fontsize=8,
    )
    page.insert_text(
        (48, 122),
        "Figure 22. Margin trend",
        fontname="helv",
        fontsize=8,
    )
    page.insert_text(
        (48, 170),
        "Source: REFLO test fixture",
        fontname="helv",
        fontsize=6,
    )
    result = document.tobytes()
    document.close()
    return result


def revised_prior_tables_pdf() -> bytes:
    document = pymupdf.open()
    page = document.new_page(width=595.32, height=841.92)
    for number, title_y, source_y, suffix in (
        (6, 80, 395, "revised"),
        (7, 445, 770, "prior"),
    ):
        page.insert_text(
            (42, title_y),
            f"Figure {number}. Quarterly performance outlook ({suffix})",
            fontname="helv",
            fontsize=9,
        )
        for row in range(5):
            top = title_y + 25 + row * 45
            page.draw_rect(
                pymupdf.Rect(42, top, 553, top + 45),
                color=(0.45, 0.45, 0.45),
                width=0.5,
            )
        page.insert_text(
            (42, source_y),
            "Source: REFLO test fixture",
            fontname="helv",
            fontsize=6,
        )
    result = document.tobytes()
    document.close()
    return result


def image_only_pdf() -> bytes:
    document = pymupdf.open()
    page = document.new_page(width=300, height=400)
    page.draw_rect(
        pymupdf.Rect(30, 30, 270, 370),
        color=(0.2, 0.2, 0.2),
        fill=(0.95, 0.95, 0.95),
    )
    result = document.tobytes()
    document.close()
    return result


class PdfWorkerRenderTest(unittest.TestCase):
    def test_typed_render_plan_inserts_a_sanitized_vector_and_preserves_fixed_text(
        self,
    ) -> None:
        source = fixture_pdf()
        bbox = [60, 100, 240, 130]
        svg = (
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="60 100 180 30">'
            '<rect x="60" y="100" width="180" height="30" fill="#ffffff"/>'
            '<text x="70" y="120" font-size="12">Vector title</text></svg>'
        )
        asset_hash = digest(svg.encode("utf-8"))
        token_hashes = source_region_token_hashes(source, 1, bbox)
        result = render_plan_pdf_bytes(
            source,
            {
                "schemaVersion": "1.0",
                "artifactType": "render_plan",
                "renderPlanId": "render-plan-test",
                "renderPlanVersion": 1,
                "commands": [
                    {
                        "commandId": "command-title",
                        "pageId": "page-1",
                        "blockId": "page-1.title",
                        "slotId": "slot-title",
                        "strategy": "block_vector_replace",
                        "targetObjectIds": ["source-title"],
                        "expectedTokenHashes": token_hashes,
                        "vectorAssetHash": asset_hash,
                    }
                ],
                "vectorAssets": [
                    {
                        "slotId": "slot-title",
                        "assetKind": "scalar",
                        "sha256": asset_hash,
                        "mediaType": "image/svg+xml",
                    }
                ],
            },
            {
                "page-1.title": {"pageNumber": 1, "bbox": bbox},
            },
            {asset_hash: svg},
            [
                {
                    "blockId": "page-1.footer",
                    "pageNumber": 1,
                    "bbox": [20, 365, 120, 390],
                    "text": "Updated footer",
                    "sourceObjectIds": ["source-footer"],
                }
            ],
        )
        self.assertTrue(result["validation"]["passed"])
        self.assertTrue(result["qpdfPassed"])
        self.assertEqual(["command-title"], result["appliedCommandIds"])
        rendered = base64.b64decode(result["pdfBase64"])
        document = pymupdf.open(stream=rendered, filetype="pdf")
        text = "\n".join(page.get_text() for page in document)
        document.close()
        self.assertIn("Vector title", text)
        self.assertNotIn("Old report title", text)
        self.assertIn("Updated footer", text)
        self.assertNotIn("Fixed footer", text)
        self.assertNotEqual(digest(source), result["sha256"])

    def test_typed_render_plan_rejects_asset_and_token_hash_mismatch(self) -> None:
        source = fixture_pdf()
        svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"/>'
        plan = {
            "renderPlanId": "render-plan-test",
            "commands": [
                {
                    "commandId": "command-title",
                    "pageId": "page-1",
                    "blockId": "page-1.title",
                    "slotId": "slot-title",
                    "strategy": "block_vector_replace",
                    "targetObjectIds": ["source-title"],
                    "expectedTokenHashes": ["0" * 64],
                    "vectorAssetHash": digest(svg.encode("utf-8")),
                }
            ],
        }
        with self.assertRaisesRegex(ValueError, "TOKEN_HASH_MISMATCH"):
            render_plan_pdf_bytes(
                source,
                plan,
                {
                    "page-1.title": {
                        "pageNumber": 1,
                        "bbox": [60, 100, 240, 130],
                    }
                },
                {digest(svg.encode("utf-8")): svg},
            )

        plan["commands"][0]["expectedTokenHashes"] = source_region_token_hashes(
            source, 1, [60, 100, 240, 130]
        )
        with self.assertRaisesRegex(ValueError, "VECTOR_ASSET_HASH_MISMATCH"):
            render_plan_pdf_bytes(
                source,
                plan,
                {
                    "page-1.title": {
                        "pageNumber": 1,
                        "bbox": [60, 100, 240, 130],
                    }
                },
                {digest(svg.encode("utf-8")): svg + "tampered"},
            )

    def test_inspection_still_builds_template_ir(self) -> None:
        payload = fixture_pdf()
        result = inspect_pdf_bytes(payload)
        self.assertTrue(result["compatible"])
        self.assertEqual(1, result["pageCount"])
        self.assertEqual(1, len(result["templateIr"]["pages"]))
        self.assertEqual(
            "pdf-analysis/2.0",
            result["templateIr"]["analysisMetadata"]["pipelineVersion"],
        )
        repeated = inspect_pdf_bytes(payload)
        self.assertEqual(result["templateIr"], repeated["templateIr"])

    def test_render_replaces_only_the_target_region(self) -> None:
        result = render_pdf_bytes(
            fixture_pdf(),
            [
                {
                    "blockId": "page-1.title",
                    "pageNumber": 1,
                    "bbox": [60, 100, 240, 130],
                    "text": "New report title",
                    "role": "title",
                    "templateBlockId": "page-1.title",
                    "sourceObjectIds": ["source-title"],
                }
            ],
        )
        self.assertTrue(result["validation"]["passed"])
        self.assertTrue(result["qpdfPassed"])
        self.assertEqual(
            "region_background_patch",
            result["renderPlan"]["operations"][0]["strategy"],
        )
        rendered = base64.b64decode(result["pdfBase64"])
        document = pymupdf.open(stream=rendered, filetype="pdf")
        text = "\n".join(page.get_text() for page in document)
        document.close()
        self.assertIn("New report title", text)
        self.assertNotIn("Old report title", text)
        self.assertIn("Fixed footer", text)

    def test_render_rejects_out_of_page_patch(self) -> None:
        with self.assertRaisesRegex(ValueError, "outside"):
            render_pdf_bytes(
                fixture_pdf(),
                [
                    {
                        "blockId": "outside",
                        "pageNumber": 1,
                        "bbox": [250, 350, 320, 420],
                        "text": "Outside",
                    }
                ],
            )

    def test_preview_can_keep_source_text_when_a_patch_overflows(self) -> None:
        result = render_pdf_bytes(
            fixture_pdf(),
            [
                {
                    "blockId": "page-1.title",
                    "pageNumber": 1,
                    "bbox": [60, 100, 80, 112],
                    "text": "This replacement is intentionally too long",
                }
            ],
            skip_overflow=True,
        )
        self.assertEqual([], result["renderPlan"]["operations"])
        self.assertIn(
            "BLOCK_OVERFLOW_SKIPPED",
            [warning["code"] for warning in result["warnings"]],
        )
        rendered = base64.b64decode(result["pdfBase64"])
        document = pymupdf.open(stream=rendered, filetype="pdf")
        text = "\n".join(page.get_text() for page in document)
        document.close()
        self.assertIn("Old report title", text)

    def test_detects_optional_data_regions_without_position_hardcoding(self) -> None:
        result = inspect_pdf_bytes(broker_layout_pdf())
        page = result["templateIr"]["pages"][0]
        slots = page["slots"]
        region_metrics = {
            slot["semanticKey"]["metric"]
            for slot in slots
            if slot["semanticKey"]["metric"]
            in {"key_data", "consensus_data", "stock_price", "financial_data"}
        }
        self.assertEqual(
            {"key_data", "consensus_data", "stock_price", "financial_data"},
            region_metrics,
        )
        self.assertTrue(
            all(
                slot["required"] is False
                for slot in slots
                if slot["semanticKey"]["metric"] in region_metrics
            )
        )
        data_blocks = [
            block
            for block in page["blocks"]
            if block.get("generationRule")
            in {"핵심 데이터", "컨센서스 데이터", "주가 추이", "재무 데이터"}
        ]
        self.assertEqual(4, len(data_blocks))
        self.assertTrue(all(block["bbox"][2] < 190 for block in data_blocks))
        self.assertNotIn(
            "quarterly_performance_table",
            {slot["semanticKey"]["metric"] for slot in slots},
        )

        current_price = next(
            slot
            for slot in slots
            if slot["semanticKey"]["metric"] == "current_price"
        )
        current_block = next(
            block
            for block in page["blocks"]
            if block["blockId"] == current_price["blockId"]
        )
        self.assertGreater(current_block["bbox"][0], 100)

    def test_detects_the_same_optional_regions_in_a_right_sidebar(self) -> None:
        result = inspect_pdf_bytes(broker_layout_pdf("right"))
        page = result["templateIr"]["pages"][0]
        region_slots = [
            slot
            for slot in page["slots"]
            if slot["semanticKey"]["metric"]
            in {"key_data", "consensus_data", "stock_price", "financial_data"}
        ]
        self.assertEqual(4, len(region_slots))
        region_block_ids = {slot["blockId"] for slot in region_slots}
        region_blocks = [
            block for block in page["blocks"] if block["blockId"] in region_block_ids
        ]
        self.assertTrue(all(block["bbox"][0] > 390 for block in region_blocks))

    def test_splits_revised_and_prior_performance_tables_by_figure_heading(
        self,
    ) -> None:
        result = inspect_pdf_bytes(revised_prior_tables_pdf())
        page = result["templateIr"]["pages"][0]
        slots = {
            slot["semanticKey"]["metric"]: slot for slot in page["slots"]
        }

        self.assertTrue(result["compatible"], result["issues"])
        self.assertEqual(
            {"figure_6_chart", "figure_7_chart"},
            {"figure_6_chart", "figure_7_chart"} & slots.keys(),
        )
        self.assertEqual("table", slots["figure_6_chart"]["valueType"])
        self.assertEqual("table", slots["figure_7_chart"]["valueType"])
        self.assertNotIn("quarterly_performance_table", slots)

        blocks = {
            slot["semanticKey"]["metric"]: next(
                block
                for block in page["blocks"]
                if block["blockId"] == slot["blockId"]
            )
            for slot in slots.values()
            if slot["semanticKey"]["metric"]
            in {"figure_6_chart", "figure_7_chart"}
        }
        revised = blocks["figure_6_chart"]
        prior = blocks["figure_7_chart"]
        self.assertEqual("table", revised["classification"])
        self.assertEqual("table", prior["classification"])
        self.assertLess(revised["bbox"][3], prior["bbox"][1])
        self.assertLess(revised["bbox"][0], 50)
        self.assertGreater(revised["bbox"][2], 545)

    def test_isc_template_ir_classifies_editable_charts_fixed_visual_and_tables(
        self,
    ) -> None:
        fixture = (
            Path(__file__).resolve().parents[2]
            / "fixtures"
            / "ISC_4Q25_실적리뷰_하나증권.pdf"
        )
        if not fixture.exists():
            self.skipTest("ISC PDF fixture is not available in this test package.")

        result = inspect_pdf_bytes(fixture.read_bytes())
        self.assertTrue(result["compatible"], result["issues"])
        pages = {
            page["pageNumber"]: page for page in result["templateIr"]["pages"]
        }
        styles = {
            style["resourceId"]: style
            for style in result["templateIr"]["resources"]["styles"]
        }
        chart_slots = {
            slot["semanticKey"]["metric"]: slot
            for page in pages.values()
            for slot in page["slots"]
            if slot["valueType"] == "chart"
        }
        expected_chart_scopes = {
            "figure_2_chart": "ISC 12MF P/E Band",
            "figure_3_chart": "ISC 12MF P/B Band",
            "figure_7_chart": "분기 영업이익 vs 시가총액 추이",
            "figure_8_chart": "어플리케이션 별 매출 비중 추이",
            "figure_9_chart": "연간 실적 추이 및 전망",
            "figure_10_chart": "제품별 매출 추이 및 전망",
        }
        self.assertTrue(expected_chart_scopes.keys() <= chart_slots.keys())
        for metric, scope in expected_chart_scopes.items():
            self.assertTrue(chart_slots[metric]["required"])
            self.assertEqual(scope, chart_slots[metric]["semanticKey"]["scope"])
            style = styles[chart_slots[metric]["styleRef"]]["typedTemplate"]
            self.assertEqual("chart", style["templateType"])

        figure_seven = next(
            block
            for page in pages.values()
            for block in page["blocks"]
            if str(block.get("generationRule") or "").startswith("도표 7.")
        )
        self.assertEqual("composite_chart", figure_seven["classification"])

        page_four = pages[4]
        fixed_visuals = [
            block
            for block in page_four["blocks"]
            if block["role"] == "fixed_design"
            and str(block.get("generationRule") or "").startswith("도표 6.")
        ]
        self.assertEqual(1, len(fixed_visuals))
        self.assertEqual([], fixed_visuals[0]["slotIds"])
        self.assertEqual("fixed_visual", fixed_visuals[0]["classification"])
        self.assertNotIn("figure_6_chart", chart_slots)

        expected_table_metrics = {
            "income_statement_table",
            "balance_sheet_table",
            "investment_indicators_table",
            "cash_flow_statement_table",
        }
        page_five_table_slots = [
            slot
            for slot in pages[5]["slots"]
            if slot["valueType"] == "table"
        ]
        self.assertEqual(
            expected_table_metrics,
            {
                slot["semanticKey"]["metric"]
                for slot in page_five_table_slots
            },
        )
        self.assertTrue(all(slot["required"] for slot in page_five_table_slots))
        self.assertNotIn(
            "financial_statements_table",
            {
                slot["semanticKey"]["metric"]
                for slot in page_five_table_slots
            },
        )
        page_five_blocks = [
            block
            for block in pages[5]["blocks"]
            if block["role"] == "table"
        ]
        self.assertEqual(4, len(page_five_blocks))
        self.assertEqual(4, len({tuple(block["bbox"]) for block in page_five_blocks}))
        self.assertTrue(
            all(block["classification"] == "table" for block in page_five_blocks)
        )

        dynamic_blocks = [
            block
            for page in pages.values()
            for block in page["blocks"]
            if block["role"] in {"scalar_group", "table", "chart"}
        ]
        self.assertGreater(len(dynamic_blocks), 0)
        for block in dynamic_blocks:
            self.assertRegex(block["geometryFingerprint"], r"^[0-9a-f]{64}$")
            self.assertGreaterEqual(block["analysisConfidence"], 0.85)
            self.assertTrue(block["reasonCodes"])
            typed_style = styles[block["styleTemplateRef"]]["typedTemplate"]
            expected_type = (
                "scalar" if block["role"] == "scalar_group" else block["role"]
            )
            self.assertEqual(expected_type, typed_style["templateType"])

        for page in pages.values():
            crop_box = page["boxes"]["cropBox"]
            for block in page["blocks"]:
                block_box = block["bbox"]
                self.assertGreaterEqual(block_box[0], crop_box[0])
                self.assertGreaterEqual(block_box[1], crop_box[1])
                self.assertLessEqual(block_box[2], crop_box[2])
                self.assertLessEqual(block_box[3], crop_box[3])
                self.assertFalse(
                    any(
                        intersection["risk"] == "overlap"
                        for intersection in block["intersections"]
                    ),
                    block,
                )

    def test_blocks_dangerously_overlapping_dynamic_regions(self) -> None:
        result = inspect_pdf_bytes(overlapping_chart_pdf())
        self.assertFalse(result["compatible"])
        self.assertIn(
            "PDF_DYNAMIC_BLOCK_OVERLAP",
            [issue["code"] for issue in result["issues"]],
        )

    def test_ocr_fallback_is_separate_and_blocks_low_confidence(self) -> None:
        result = inspect_pdf_bytes(
            image_only_pdf(),
            ocr_fallback=[
                {
                    "pageNumber": 1,
                    "confidence": 0.72,
                    "words": [
                        {
                            "text": "Target Price 120,000",
                            "bbox": [40, 50, 180, 70],
                        }
                    ],
                }
            ],
        )
        self.assertFalse(result["compatible"])
        self.assertIn(
            "PDF_OCR_LOW_CONFIDENCE",
            [issue["code"] for issue in result["issues"]],
        )
        self.assertNotIn(
            "PDF_TEXT_LAYER_REQUIRED",
            [issue["code"] for issue in result["issues"]],
        )
        self.assertTrue(
            re.fullmatch(
                r"[0-9a-f]{64}",
                result["templateIr"]["analysisMetadata"]["ocrInputHash"],
            )
        )


if __name__ == "__main__":
    unittest.main()
