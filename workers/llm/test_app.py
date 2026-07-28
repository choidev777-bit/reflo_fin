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
        self.assertIn("검증 가능한 질문 3~7개", prompt)
        self.assertIn("직전 분기, 전년 동기, 컨센서스", prompt)
        self.assertIn("다음 분기와 하반기 또는 연간", prompt)
        self.assertIn("포괄적인 DRIVER 질문을 추가하지 않는다", prompt)
        self.assertIn("동종업체의 고유명사", prompt)

    def test_fixture_output_passes_domain_validation(self) -> None:
        proposal = validate_proposal(fixture_proposal(self.input), self.input)
        self.assertEqual(
            [1, 2, 3, 4, 5],
            [question.priority for question in proposal.questions],
        )
        self.assertTrue(all(self.input.company in q.text for q in proposal.questions))

    def test_earnings_review_requires_consensus_comparison(self) -> None:
        proposal = fixture_proposal(self.input)
        proposal.questions[0] = proposal.questions[0].model_copy(
            update={
                "text": f"{self.input.targetPeriod} {self.input.company} 매출과 영업이익은 전년 동기 대비 어떻게 변했는가?",
                "purpose": "외형 성장 확인",
                "metrics": ["매출", "영업이익"],
                "comparison": "전년 동기",
            }
        )
        with self.assertRaisesRegex(ValueError, "consensus"):
            validate_proposal(proposal, self.input)

    def test_segment_questions_replace_duplicate_broad_driver(self) -> None:
        proposal = fixture_proposal(self.input)
        driver = proposal.questions[2]
        proposal.questions.extend(
            [
                driver.model_copy(
                    update={
                        "questionKey": "q_06",
                        "role": "SEGMENT",
                        "text": f"{self.input.targetPeriod} {self.input.company} 사업부 A의 수요와 제품 믹스는 개선됐는가?",
                        "priority": 6,
                    }
                ),
                driver.model_copy(
                    update={
                        "questionKey": "q_07",
                        "role": "SEGMENT",
                        "text": f"{self.input.targetPeriod} {self.input.company} 사업부 B의 수요와 제품 믹스는 개선됐는가?",
                        "priority": 7,
                    }
                ),
            ]
        )
        with self.assertRaisesRegex(ValueError, "duplicates"):
            validate_proposal(proposal, self.input)

    def test_undisclosed_segment_metric_is_rejected(self) -> None:
        proposal = fixture_proposal(self.input)
        proposal.questions[2] = proposal.questions[2].model_copy(
            update={
                "text": f"{self.input.targetPeriod} {self.input.company} 주요 제품의 매출 비중은 얼마인가?",
                "metrics": ["매출 비중"],
            }
        )
        with self.assertRaisesRegex(ValueError, "undisclosed detailed metrics"):
            validate_proposal(proposal, self.input)

    def test_undisclosed_contribution_ranking_is_rejected(self) -> None:
        proposal = fixture_proposal(self.input)
        proposal.questions[2] = proposal.questions[2].model_copy(
            update={
                "text": (
                    f"{self.input.targetPeriod} {self.input.company} 주요 제품의 "
                    "수요와 믹스 중 무엇이 더 크게 작용했는가?"
                ),
            }
        )
        with self.assertRaisesRegex(ValueError, "contribution ranking"):
            validate_proposal(proposal, self.input)

    def test_ungrounded_peer_names_are_rejected(self) -> None:
        proposal = fixture_proposal(self.input)
        proposal.questions[4] = proposal.questions[4].model_copy(
            update={
                "text": (
                    f"{self.input.company}의 이익 추정치와 목표 PER, 목표주가 및 "
                    "동종업체(Ibiden, Unimicron) 대비 상승 여력은 어떠한가?"
                )
            }
        )
        with self.assertRaisesRegex(ValueError, "not grounded"):
            validate_proposal(proposal, self.input)

    def test_prior_fixed_target_price_is_rejected(self) -> None:
        proposal = fixture_proposal(self.input)
        proposal.questions[4] = proposal.questions[4].model_copy(
            update={
                "text": (
                    f"{self.input.company}의 이익 추정치와 목표 PER을 반영한 "
                    "목표주가 81,000원 및 상승 여력은 타당한가?"
                )
            }
        )
        with self.assertRaisesRegex(ValueError, "updated target price"):
            validate_proposal(proposal, self.input)

    def test_product_acronyms_from_hypothesis_cannot_be_dropped(self) -> None:
        product_input = self.input.model_copy(
            update={
                "hypothesis": (
                    "AI 데이터센터용 FCBGA·FCCSP 성장과 MLB 신규 수요로 "
                    "실적이 개선될 것이다."
                )
            }
        )
        with self.assertRaisesRegex(ValueError, "FCBGA"):
            validate_proposal(fixture_proposal(product_input), product_input)

    def test_profile_is_pinned(self) -> None:
        profile = AgentProfile(
            version="hypothesis-openai-v3",
            promptVersion="hypothesis-v4",
            outputSchemaVersion="1.0.0",
            model="gpt-5.4-mini",
            reasoning="medium",
            inputTokenLimit=50_000,
            outputTokenLimit=8_000,
            timeoutSeconds=120,
            costLimitUsd=1,
        )
        self.assertEqual("gpt-5.4-mini", profile.model)
        os.environ["OPENAI_API_KEY"] = "test-key-not-real"
        self.assertEqual("Agent", type(build_agent(profile)).__name__)

    def test_http_endpoint_returns_valid_structured_output(self) -> None:
        response = TestClient(app).post(
            "/hypothesis/questions",
            json={
                "input": self.input.model_dump(),
                "profile": {
                    "version": "hypothesis-openai-v3",
                    "promptVersion": "hypothesis-v4",
                    "outputSchemaVersion": "1.0.0",
                    "model": "gpt-5.4-mini",
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
        self.assertEqual(5, len(payload["output"]["questions"]))
        self.assertEqual("hypothesis_questions", payload["output"]["outputType"])
        self.assertEqual(
            "hypothesis-v4", payload["output"]["metadata"]["promptVersion"]
        )
        self.assertEqual(
            {
                "provider",
                "model",
                "promptVersion",
                "outputSchemaId",
                "startedAt",
                "finishedAt",
                "usage",
            },
            set(payload["output"]["metadata"]),
        )
        self.assertNotIn("latencyMs", payload["output"]["metadata"])

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
                "version": "hypothesis-openai-v3",
                "promptVersion": "hypothesis-v4",
                "outputSchemaVersion": "1.0.0",
                "model": "gpt-5.4-mini",
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
            version="hypothesis-openai-v3",
            promptVersion="hypothesis-v4",
            outputSchemaVersion="1.0.0",
            model="gpt-5.4-mini",
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
            "version": "research-openai-v2",
            "model": "gpt-5.4-mini",
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
            metricId="신규 수주",
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
        self.assertEqual("gpt-5.4-mini", profile.model)
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
                    "version": "validation-openai-v2",
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
                    "version": "report-outline-v2",
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
                    "version": "report-draft-v2",
                },
            },
        )
        self.assertEqual(200, response.status_code)
        self.assertEqual("fixture", response.json()["generationSource"])
        self.assertEqual("body-1", response.json()["blocks"][0]["blockId"])


if __name__ == "__main__":
    unittest.main()
