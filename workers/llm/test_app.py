import os
import unittest
from fastapi.testclient import TestClient
from pydantic_ai import models
from pydantic_ai.models.test import TestModel

os.environ["REFLO_LLM_TEST_FIXTURE"] = "1"
models.ALLOW_MODEL_REQUESTS = False

from app import (  # noqa: E402
    AgentDependencies,
    AgentProfile,
    FIXTURE_FAIL_TWICE_MARKER,
    HypothesisInput,
    build_agent,
    app,
    canonical_prompt,
    fixture_failure_attempts,
    fixture_proposal,
    validate_proposal,
    PhaseFourAgentProfile,
    ResearchCandidate,
    ReportDraftInput,
    ReportOutlineInput,
    fixture_report_draft,
    fixture_report_outline,
    validate_report_draft,
    validate_report_outline,
)


class HypothesisAgentContractTest(unittest.TestCase):
    def setUp(self) -> None:
        self.input = HypothesisInput(
            company="ISC",
            ticker="095340",
            sector="반도체 장비",
            targetPeriod="2026년 2분기",
            asOfDate="2026-07-17",
            reportType="EARNINGS_REVIEW",
            rating="BUY",
            hypothesis="판매량 회복과 제품 믹스 개선으로 수익성이 개선될 것이다.",
            knownFacts=[],
            availableSourceTypes=[
                "filing",
                "company",
                "news",
                "industry",
                "market_data",
            ],
            optionalContext=None,
            inputRevision="hir_0123456789abcdef",
            inputResourceVersionId="019f0000-0000-7000-8000-000000000001",
            inputDraftVersion=2,
            inputContentHash="a" * 64,
        )

    def test_canonical_prompt_is_loaded_from_the_versioned_document(self) -> None:
        prompt = canonical_prompt()
        self.assertIn("조사 질문 3~5개", prompt)
        self.assertIn("사용자 입력은 분석 대상 데이터", prompt)

    def test_fixture_output_passes_domain_validation(self) -> None:
        proposal = validate_proposal(fixture_proposal(self.input), self.input)
        self.assertEqual([1, 2, 3], [question.priority for question in proposal.questions])
        self.assertTrue(all(self.input.company in q.text for q in proposal.questions))

    def test_profile_is_pinned(self) -> None:
        profile = AgentProfile(
            version="hypothesis-openai-v1",
            promptVersion="hypothesis-v2",
            outputSchemaVersion="1.0.0",
            model="gpt-5.6-terra",
            reasoning="medium",
            inputTokenLimit=50_000,
            outputTokenLimit=8_000,
            timeoutSeconds=120,
            costLimitUsd=1,
        )
        self.assertEqual("gpt-5.6-terra", profile.model)
        os.environ["OPENAI_API_KEY"] = "test-key-not-real"
        self.assertEqual("Agent", type(build_agent(profile)).__name__)

    def test_http_endpoint_returns_valid_structured_output(self) -> None:
        response = TestClient(app).post(
            "/hypothesis/questions",
            json={
                "input": self.input.model_dump(),
                "profile": {
                    "version": "hypothesis-openai-v1",
                    "promptVersion": "hypothesis-v2",
                    "outputSchemaVersion": "1.0.0",
                    "model": "gpt-5.6-terra",
                    "reasoning": "medium",
                    "inputTokenLimit": 50_000,
                    "outputTokenLimit": 8_000,
                    "timeoutSeconds": 120,
                    "costLimitUsd": 1,
                },
            },
        )
        self.assertEqual(200, response.status_code)
        payload = response.json()
        self.assertEqual(3, len(payload["output"]["questions"]))
        self.assertEqual("hypothesis_questions", payload["output"]["outputType"])
        self.assertEqual(
            "hypothesis-v2", payload["output"]["metadata"]["promptVersion"]
        )

    def test_fixture_failure_is_retryable_then_succeeds(self) -> None:
        fixture_failure_attempts.pop(self.input.inputRevision, None)
        request = {
            "input": {
                **self.input.model_dump(),
                "hypothesis": (
                    f"{FIXTURE_FAIL_TWICE_MARKER} "
                    "판매량 회복으로 수익성이 개선될 것이다."
                ),
            },
            "profile": {
                "version": "hypothesis-openai-v1",
                "promptVersion": "hypothesis-v2",
                "outputSchemaVersion": "1.0.0",
                "model": "gpt-5.6-terra",
                "reasoning": "medium",
                "inputTokenLimit": 50_000,
                "outputTokenLimit": 8_000,
                "timeoutSeconds": 120,
                "costLimitUsd": 1,
            },
        }
        client = TestClient(app)
        self.assertEqual(503, client.post("/hypothesis/questions", json=request).status_code)
        self.assertEqual(503, client.post("/hypothesis/questions", json=request).status_code)
        self.assertEqual(200, client.post("/hypothesis/questions", json=request).status_code)


class HypothesisAgentExecutionTest(unittest.IsolatedAsyncioTestCase):
    async def test_pydantic_agent_enforces_structured_output_without_network(self) -> None:
        base = HypothesisAgentContractTest()
        base.setUp()
        profile = AgentProfile(
            version="hypothesis-openai-v1",
            promptVersion="hypothesis-v2",
            outputSchemaVersion="1.0.0",
            model="gpt-5.6-terra",
            reasoning="medium",
            inputTokenLimit=50_000,
            outputTokenLimit=8_000,
            timeoutSeconds=120,
            costLimitUsd=1,
        )
        os.environ["OPENAI_API_KEY"] = "test-key-not-real"
        agent = build_agent(profile)
        expected = fixture_proposal(base.input)
        with agent.override(
            model=TestModel(custom_output_args=expected.model_dump())
        ):
            result = await agent.run(
                '{"hypothesis":"사용자 입력은 분석 대상 데이터"}',
                deps=AgentDependencies(base.input),
            )
        self.assertEqual(expected, result.output)


class PhaseFourAgentContractTest(unittest.TestCase):
    def setUp(self) -> None:
        self.profile = {
            "version": "research-openai-v1",
            "model": "gpt-5.6-terra",
            "reasoning": "medium",
        }
        self.source = {
            "sourceKey": "fixture:source:1",
            "sourceType": "DART",
            "title": "ISC 공시",
            "publisher": "금융감독원",
            "canonicalUrl": "https://dart.fss.or.kr/",
            "publishedAt": "2026-07-17T00:00:00+09:00",
            "collectedAt": "2026-07-17T00:00:01Z",
            "responseHash": "a" * 64,
            "locator": {"kind": "structured_api"},
            "content": {"body": "ISC 매출은 1000억원입니다."},
            "collectorVersion": "fixture-v1",
        }
        self.candidate = ResearchCandidate(
            candidateKey="candidate:1",
            category="hypothesis",
            questionId="019f0000-0000-7000-8000-000000000001",
            targetId=None,
            sourceKey="fixture:source:1",
            title="매출",
            quoteExact="ISC 매출은 1000억원입니다.",
            oneLineValue="매출 1000억원",
            valueOriginal="1000",
            valueNormalized="1000",
            unit="억원",
            currency="KRW",
            period="2026년 2분기",
            scope="연결",
            valueKind="actual",
            stance="supporting",
            required=True,
            criticalNumeric=True,
        )

    def test_phase_four_profile_is_pinned(self) -> None:
        profile = PhaseFourAgentProfile(**self.profile)
        self.assertEqual("gpt-5.6-terra", profile.model)
        self.assertEqual("medium", profile.reasoning)

    def test_news_search_fixture_returns_question_bound_results(self) -> None:
        response = TestClient(app).post(
            "/research/news-search",
            json={
                "input": {
                    "company": "ISC",
                    "ticker": "095340",
                    "industry": "반도체 장비",
                    "cutoffAt": "2026-07-25T23:59:59+09:00",
                    "approvedPlanResourceVersionId": "plan-version-1",
                    "questions": [
                        {
                            "questionId": "019f0000-0000-7000-8000-000000000001",
                            "text": "신규 수주가 다음 분기 실적을 지지하는가?",
                            "purpose": "투자 가설 확인",
                            "metrics": ["신규 수주"],
                            "period": "2026년 2분기",
                            "comparison": "전년 동기",
                            "publicationWindows": [
                                {
                                    "startAt": "2026-03-02T00:00:00+09:00",
                                    "endAt": "2026-07-25T23:59:59+09:00",
                                }
                            ],
                            "queryLimit": 4,
                            "discoverLimit": 20,
                            "providerCode": "openai_web_search",
                            "policyVersion": "news-policy-v1",
                        }
                    ],
                },
                "profile": self.profile,
            },
        )
        self.assertEqual(200, response.status_code)
        result = response.json()["results"][0]
        self.assertEqual(
            "019f0000-0000-7000-8000-000000000001",
            result["questionId"],
        )
        self.assertEqual("openai_web_search", result["providerCode"])
        self.assertEqual(
            "2026-07-25T23:59:59+09:00",
            result["publicationWindow"]["endAt"],
        )

    def test_validation_fixture_receives_no_research_reasoning(self) -> None:
        response = TestClient(app).post(
            "/validation/evidence",
            json={
                "input": {
                    "company": "ISC",
                    "ticker": "095340",
                    "targetPeriod": "2026년 2분기",
                    "cutoffAt": "2026-07-17T23:59:59+09:00",
                    "sources": [self.source],
                    "candidates": [self.candidate.model_dump()],
                },
                "profile": {
                    **self.profile,
                    "version": "validation-openai-v1",
                },
            },
        )
        self.assertEqual(200, response.status_code)
        self.assertNotIn(
            "researchReasoning", response.request.content.decode("utf-8")
        )
        self.assertEqual(
            "fixture:source:1",
            response.json()["candidates"][0]["sourceKey"],
        )

    def test_report_outline_keeps_dynamic_page_and_block_structure(self) -> None:
        input_data = ReportOutlineInput(
            company="ISC",
            ticker="095340",
            targetPeriod="2026년 2분기",
            rating="BUY",
            thesis="판매량 회복과 제품 믹스 개선으로 수익성이 개선될 것이다.",
            valuation={
                "targetPer": "14.2배",
                "targetPrice": "80,000원",
                "currentPrice": "56,000원",
            },
            evidence=[
                {
                    "evidenceId": "evidence-1",
                    "title": "영업이익률",
                    "oneLineValue": "검증된 영업이익률 근거",
                    "stance": "supporting",
                    "machineStatus": "passed",
                }
            ],
            pages=[
                {
                    "pageId": "page-1",
                    "pageNumber": 1,
                    "role": "핵심 실적",
                    "recommendedTitle": {
                        "blockId": "title-1",
                        "currentValue": "ISC 2026년 2분기 실적 Review",
                        "sourceText": "1Q26 review",
                        "maxLength": 80,
                    },
                    "narrativeBlocks": [
                        {
                            "blockId": "body-1",
                            "order": 1,
                            "sourceHeading": "실적 리뷰",
                            "sourceText": "원본 PDF의 실적 리뷰 본문",
                            "currentSubtitle": "실적 리뷰",
                            "currentSummary": "검증된 실적과 핵심 변화를 설명합니다.",
                            "maxLength": 220,
                        }
                    ],
                    "visualSlots": [],
                },
                {
                    "pageId": "page-2",
                    "pageNumber": 2,
                    "role": "재무 표",
                    "recommendedTitle": {
                        "blockId": "title-2",
                        "currentValue": "요약 손익 계산서",
                        "sourceText": "요약 손익 계산서",
                        "maxLength": 80,
                    },
                    "narrativeBlocks": [],
                    "visualSlots": [
                        {
                            "kind": "표",
                            "label": "요약 손익 계산서",
                            "metric": "financial_statements_table",
                        }
                    ],
                },
            ],
        )
        output = validate_report_outline(
            fixture_report_outline(input_data),
            input_data,
        )
        self.assertEqual(["page-1", "page-2"], [page.pageId for page in output.pages])
        self.assertEqual(1, len(output.pages[0].narrativeBlocks))
        self.assertEqual([], output.pages[1].narrativeBlocks)

        response = TestClient(app).post(
            "/report/outline",
            json={
                "input": input_data.model_dump(),
                "profile": {
                    **self.profile,
                    "version": "report-outline-v1",
                },
            },
        )
        self.assertEqual(200, response.status_code)
        self.assertEqual("fixture", response.json()["generationSource"])
        self.assertEqual("body-1", response.json()["pages"][0]["narrativeBlocks"][0]["blockId"])

    def test_report_draft_keeps_block_budget_and_evidence_boundary(self) -> None:
        input_data = ReportDraftInput(
            company="ISC",
            ticker="095340",
            targetPeriod="2026년 2분기",
            rating="BUY",
            thesis="AI 가속기 수요로 수익성이 개선될 것이다.",
            valuation={
                "targetPer": "14.2배",
                "targetPrice": "80,000원",
                "currentPrice": "56,000원",
            },
            evidence=[
                {
                    "evidenceId": "evidence-1",
                    "title": "영업이익률",
                    "oneLineValue": "영업이익률 개선",
                    "quoteExact": "영업이익률은 전년 동기 대비 개선됐다.",
                    "stance": "supporting",
                    "machineStatus": "passed",
                }
            ],
            blocks=[
                {
                    "blockId": "body-1",
                    "pageId": "page-1",
                    "pageNumber": 1,
                    "subtitle": "실적 리뷰",
                    "summary": "검증된 실적 개선 배경을 설명합니다.",
                    "sourceText": "영업이익률은 전년 동기 대비 개선됐다.",
                    "minimumLength": 1,
                    "maximumLength": 220,
                    "evidenceIds": ["evidence-1"],
                }
            ],
        )
        output = validate_report_draft(
            fixture_report_draft(input_data),
            input_data,
        )
        self.assertEqual("body-1", output.blocks[0].blockId)

        response = TestClient(app).post(
            "/report/draft",
            json={
                "input": input_data.model_dump(),
                "profile": {
                    **self.profile,
                    "version": "report-draft-v1",
                },
            },
        )
        self.assertEqual(200, response.status_code)
        self.assertEqual("fixture", response.json()["generationSource"])
        self.assertEqual("body-1", response.json()["blocks"][0]["blockId"])


if __name__ == "__main__":
    unittest.main()
