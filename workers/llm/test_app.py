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


if __name__ == "__main__":
    unittest.main()
