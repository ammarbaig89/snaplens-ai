"""Offline tests for the LangGraph diagnosis path and citation guarantees."""

import importlib.util
import json
import sys
import unittest
from pathlib import Path
from uuid import UUID, uuid4

import httpx

ROOT = Path(__file__).resolve().parents[1]
ORCHESTRATOR_DIR = ROOT / "services" / "diagnostic-orchestrator"
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ORCHESTRATOR_DIR))

import answer_providers  # noqa: E402
import workflow as orchestrator_workflow  # noqa: E402
from shared.contracts import (  # noqa: E402
    RetrievalSearchRequest,
    RetrievalSearchResponse,
    RetrievedSource,
    VisionAnalysisResponse,
    DeviceIdentification,
)

REQUEST_ID = UUID("550e8400-e29b-41d4-a716-446655440000")
SESSION_ID = UUID("550e8400-e29b-41d4-a716-446655440001")
IMAGE = b"\x89PNG\r\n\x1a\nfixture"
SOURCE = RetrievedSource(
    source_id=UUID("550e8400-e29b-41d4-a716-446655440002"),
    url="https://support.example.test/manual",
    title="Manufacturer support manual",
    publisher="support.example.test",
    snippet="The E21 code indicates a blocked drain filter.",
    score=0.91,
    retrieved_at="2026-10-21T10:00:00Z",
)


def vision_result(
    status="identified",
    *,
    brand="Acme",
    model="WM-100",
    category="washing machine",
    codes=None,
    observed=None,
):
    return VisionAnalysisResponse(
        request_id=REQUEST_ID,
        result_status=status,
        device=DeviceIdentification(
            brand=brand, model=model, category=category, confidence=0.92
        ),
        error_codes=codes or [],
        observed_text=observed or [],
        warnings=[],
    )


class FakeVisionClient:
    def __init__(self, result):
        self.result = result
        self.calls = []

    def analyze(self, request_id, question, image, content_type):
        self.calls.append((request_id, question, image, content_type))
        return self.result

    def is_ready(self):
        return True


class FakeRetrievalClient:
    def __init__(self, sources=None):
        self.sources = sources or []
        self.requests: list[RetrievalSearchRequest] = []

    def search(self, request):
        self.requests.append(request)
        return RetrievalSearchResponse(request_id=request.request_id, sources=self.sources)

    def is_ready(self):
        return True


class OrchestratorWorkflowTests(unittest.TestCase):
    def test_workflow_analyzes_searches_and_cites_only_retrieved_sources(self):
        vision = FakeVisionClient(vision_result(codes=["E21"]))
        retrieval = FakeRetrievalClient([SOURCE])
        graph = orchestrator_workflow.build_workflow(
            vision, retrieval, answer_providers.MockAnswerProvider()
        )
        result_state = graph.invoke(
            {
                "request_id": REQUEST_ID,
                "session_id": SESSION_ID,
                "question": "What does E21 mean?",
                "image": IMAGE,
                "content_type": "image/png",
            }
        )
        result = result_state["result"]
        self.assertEqual(len(vision.calls), 1)
        self.assertEqual(vision.calls[0][2], IMAGE)
        self.assertEqual(len(retrieval.requests), 1)
        self.assertIn("E21", retrieval.requests[0].query)
        self.assertEqual(retrieval.requests[0].manufacturer, "Acme")
        self.assertEqual(result.status, "needs_clarification")
        self.assertEqual([source.source_id for source in result.citations], [SOURCE.source_id])

    def test_unrecognized_image_skips_paid_retrieval(self):
        vision = FakeVisionClient(
            vision_result(
                "unrecognized", brand=None, model=None, category=None, codes=[], observed=[]
            )
        )
        retrieval = FakeRetrievalClient([SOURCE])
        graph = orchestrator_workflow.build_workflow(
            vision, retrieval, answer_providers.MockAnswerProvider()
        )
        state = graph.invoke(
            {
                "request_id": REQUEST_ID,
                "session_id": SESSION_ID,
                "question": "Can you fix this?",
                "image": IMAGE,
                "content_type": "image/png",
            }
        )
        self.assertEqual(retrieval.requests, [])
        self.assertEqual(state["result"].status, "needs_clarification")
        self.assertIn("couldn't identify", state["result"].answer)

    def test_no_search_results_never_calls_answer_provider(self):
        class MustNotSynthesize:
            def synthesize(self, **kwargs):
                raise AssertionError("No-source flow should not invoke synthesis")

            def is_ready(self):
                return True

        graph = orchestrator_workflow.build_workflow(
            FakeVisionClient(vision_result()), FakeRetrievalClient(), MustNotSynthesize()
        )
        state = graph.invoke(
            {
                "request_id": REQUEST_ID,
                "session_id": SESSION_ID,
                "question": "What should I do?",
                "image": IMAGE,
                "content_type": "image/png",
            }
        )
        result = state["result"]
        self.assertEqual(result.status, "needs_clarification")
        self.assertEqual(result.citations, [])
        self.assertIn("No verified support sources", result.warnings[-1])

    def test_gemini_answer_rejects_invented_citation_ids(self):
        other_source_id = uuid4()
        response_payload = {
            "candidates": [
                {
                    "content": {
                        "parts": [
                            {
                                "text": json.dumps(
                                    {
                                        "answer": "Do this step.",
                                        "cited_source_ids": [str(other_source_id)],
                                        "needs_clarification": False,
                                        "warnings": [],
                                    }
                                )
                            }
                        ]
                    }
                }
            ]
        }
        provider = answer_providers.GeminiAnswerProvider(
            answer_providers.AnswerSettings(provider="gemini", api_key="test-key"),
            transport=httpx.MockTransport(
                lambda request: httpx.Response(200, json=response_payload)
            ),
        )
        with self.assertRaises(answer_providers.AnswerProviderError) as raised:
            provider.synthesize(
                "Help", vision_result(), RetrievalSearchResponse(request_id=REQUEST_ID, sources=[SOURCE])
            )
        self.assertEqual(raised.exception.status_code, 502)

    def test_workflow_replaces_hazardous_repair_instructions(self):
        class UnsafeAnswerProvider:
            def synthesize(self, **kwargs):
                return answer_providers.AnswerDraft(
                    answer="Open the gas line and replace the valve.",
                    cited_source_ids=[SOURCE.source_id],
                    needs_clarification=False,
                )

            def is_ready(self):
                return True

        graph = orchestrator_workflow.build_workflow(
            FakeVisionClient(vision_result()),
            FakeRetrievalClient([SOURCE]),
            UnsafeAnswerProvider(),
        )
        state = graph.invoke(
            {
                "request_id": REQUEST_ID,
                "session_id": SESSION_ID,
                "question": "How do I fix this?",
                "image": IMAGE,
                "content_type": "image/png",
            }
        )
        result = state["result"]
        self.assertEqual(result.status, "needs_clarification")
        self.assertIn("qualified technician", result.answer)
        self.assertIn("instructions were blocked", result.warnings[-1])

    def test_vision_client_timeout_is_safe(self):
        def time_out(request):
            raise httpx.ReadTimeout("private network details", request=request)

        client = orchestrator_workflow.VisionServiceClient(
            "http://vision.test", 1, transport=httpx.MockTransport(time_out)
        )
        with self.assertRaises(orchestrator_workflow.DiagnosisWorkflowError) as raised:
            client.analyze(REQUEST_ID, "What is this?", IMAGE, "image/png")
        self.assertEqual(raised.exception.status_code, 504)
        self.assertNotIn("private network details", str(raised.exception))

    def test_vision_client_posts_transient_multipart_image(self):
        requests = []

        def respond(request):
            requests.append(request)
            return httpx.Response(200, json=vision_result().model_dump(mode="json"))

        client = orchestrator_workflow.VisionServiceClient(
            "http://vision.test", 2, transport=httpx.MockTransport(respond)
        )
        result = client.analyze(REQUEST_ID, "Read E21", IMAGE, "image/png")
        self.assertEqual(result.request_id, REQUEST_ID)
        self.assertEqual(requests[0].url.path, "/internal/v1/vision/analyses")
        self.assertIn(b"Read E21", requests[0].content)
        self.assertIn(IMAGE, requests[0].content)

    def test_retrieval_client_posts_contract_json(self):
        requests = []

        def respond(request):
            requests.append(request)
            return httpx.Response(
                200,
                json=RetrievalSearchResponse(
                    request_id=REQUEST_ID, sources=[SOURCE]
                ).model_dump(mode="json"),
            )

        client = orchestrator_workflow.RetrievalServiceClient(
            "http://retrieval.test", 2, transport=httpx.MockTransport(respond)
        )
        search_request = RetrievalSearchRequest(
            request_id=REQUEST_ID, query="What does E21 mean?", manufacturer="Acme"
        )
        result = client.search(search_request)
        body = json.loads(requests[0].content)
        self.assertEqual(result.sources[0].source_id, SOURCE.source_id)
        self.assertEqual(requests[0].url.path, "/internal/v1/retrieval/searches")
        self.assertEqual(body["query"], "What does E21 mean?")
        self.assertEqual(body["manufacturer"], "Acme")


if __name__ == "__main__":
    unittest.main()
