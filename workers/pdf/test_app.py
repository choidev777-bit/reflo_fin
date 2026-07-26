import base64
import unittest
from pathlib import Path

import pymupdf

from app import inspect_pdf_bytes, render_pdf_bytes


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


class PdfWorkerRenderTest(unittest.TestCase):
    def test_inspection_still_builds_template_ir(self) -> None:
        result = inspect_pdf_bytes(fixture_pdf())
        self.assertTrue(result["compatible"])
        self.assertEqual(1, result["pageCount"])
        self.assertEqual(1, len(result["templateIr"]["pages"]))

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
        pages = {
            page["pageNumber"]: page for page in result["templateIr"]["pages"]
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

        page_four = pages[4]
        fixed_visuals = [
            block
            for block in page_four["blocks"]
            if block["role"] == "fixed_design"
            and str(block.get("generationRule") or "").startswith("도표 6.")
        ]
        self.assertEqual(1, len(fixed_visuals))
        self.assertEqual([], fixed_visuals[0]["slotIds"])
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


if __name__ == "__main__":
    unittest.main()
