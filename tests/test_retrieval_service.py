"""Offline tests for Retrieval Service contracts and provider behavior."""

import importlib.util
import json
import sys
import unittest
from pathlib import Path
from unittest.mock import patch
from uuid import UUID

import httpx
from fastapi import Response

ROOT = Path(__file__).resolve().parents[1]
RETRIEVAL_DIR = ROOT / "services" / "retrieval-service"
sys.path.insert(0, str(ROOT))

PROVIDER_SPEC = importlib.util.spec_from_file_location(
    "snaplens_retrieval_providers", RETRIEVAL_DIR / "retrieval_providers.py"
)
assert PROVIDER_SPEC is not None and PROVIDER_SPEC.loader is not None
retrieval_providers = importlib.util.module_from_spec(PROVIDER_SPEC)
sys.modules["retrieval_providers"] = retrieval_providers
PROVIDER_SPEC.loader.exec_module(retrieval_providers)
sys.path.insert(0, str(RETRIEVAL_DIR))
SERVICE_SPEC = importlib.util.spec_from_file_location(
    "snaplens_retrieval_main", RETRIEVAL_DIR / "main.py"
)
assert SERVICE_SPEC is not None and SERVICE_SPEC.loader is not None
retrieval_service = importlib.util.module_from_spec(SERVICE_SPEC)
SERVICE_SPEC.loader.exec_module(retrieval_service)

from shared.contracts import RetrievalSearchRequest, RetrievalSearchResponse  # noqa: E402

REQUEST_ID = UUID("550e8400-e29b-41d4-a716-446655440000")


def run_immediate(coroutine):
    """Run a coroutine whose in-memory test provider never blocks."""
    try:
        coroutine.send(None)
    except StopIteration as completed:
        return completed.value
    raise AssertionError("The mocked coroutine unexpectedly suspended")


def search_request(**kwargs) -> RetrievalSearchRequest:
    return RetrievalSearchRequest(
        request_id=REQUEST_ID,
        query="How to resolve error E21?",
        **kwargs,
    )


class RetrievalServiceTests(unittest.TestCase):
    def test_mock_provider_returns_no_fabricated_sources(self) -> None:
        result = run_immediate(
            retrieval_providers.MockRetrievalProvider().search(search_request())
        )
        self.assertEqual(result, RetrievalSearchResponse(request_id=REQUEST_ID, sources=[]))

    def test_tavily_provider_sends_device_context_and_maps_results(self) -> None:
        requests: list[httpx.Request] = []
        result_data = {
            "results": [
                {
                    "url": "https://support.example.com/manual",
                    "title": "Product support manual",
                    "content": "Check the drain filter and consult the manual.",
                    "score": 0.92,
                },
                {"url": "javascript:alert(1)", "title": "bad", "content": "bad"},
            ]
        }

        def respond(request: httpx.Request) -> httpx.Response:
            requests.append(request)
            return httpx.Response(200, json=result_data)

        settings = retrieval_providers.RetrievalSettings(
            provider="tavily", tavily_api_key="test-key"
        )
        provider = retrieval_providers.TavilyRetrievalProvider(
            settings, transport=httpx.MockTransport(respond)
        )
        result = run_immediate(
            provider.search(search_request(manufacturer="Acme", model="WM-100", limit=2))
        )
        sent = json.loads(requests[0].content)
        self.assertEqual(requests[0].url, "https://api.tavily.com/search")
        self.assertEqual(requests[0].headers["authorization"], "Bearer test-key")
        self.assertEqual(sent["query"], "How to resolve error E21? Acme WM-100")
        self.assertEqual(sent["max_results"], 2)
        self.assertFalse(sent["include_answer"])
        self.assertEqual(len(result.sources), 1)
        source = result.sources[0]
        self.assertEqual(str(source.url), "https://support.example.com/manual")
        self.assertEqual(source.publisher, "support.example.com")
        self.assertEqual(source.score, 0.92)
        self.assertEqual(source.title, "Product support manual")

    def test_tavily_provider_bounds_snippet_and_result_count(self) -> None:
        transport = httpx.MockTransport(
            lambda request: httpx.Response(
                200,
                json={
                    "results": [
                        {
                            "url": f"https://support.example.com/{i}",
                            "title": f"Manual {i}",
                            "content": "x" * 5000,
                            "score": 2,
                        }
                        for i in range(3)
                    ]
                },
            )
        )
        provider = retrieval_providers.TavilyRetrievalProvider(
            retrieval_providers.RetrievalSettings(
                provider="tavily", tavily_api_key="test-key", max_snippet_chars=120
            ),
            transport=transport,
        )
        result = run_immediate(provider.search(search_request(limit=2)))
        self.assertEqual(len(result.sources), 2)
        self.assertEqual(len(result.sources[0].snippet), 120)
        self.assertEqual(result.sources[0].score, 1.0)

    def test_missing_tavily_key_is_not_ready_and_does_not_call_api(self) -> None:
        provider = retrieval_providers.TavilyRetrievalProvider(
            retrieval_providers.RetrievalSettings(provider="tavily")
        )
        with self.assertRaises(retrieval_providers.RetrievalProviderError) as raised:
            run_immediate(provider.search(search_request()))
        self.assertEqual(raised.exception.status_code, 503)
        response = Response()
        with patch.object(retrieval_service.app.state, "retrieval_provider", provider):
            health = run_immediate(retrieval_service.ready(response))
        self.assertEqual(response.status_code, 503)
        self.assertEqual(health.status, "not_ready")

    def test_tavily_timeout_maps_to_safe_error(self) -> None:
        def time_out(request: httpx.Request) -> httpx.Response:
            raise httpx.ReadTimeout("private timeout details", request=request)

        provider = retrieval_providers.TavilyRetrievalProvider(
            retrieval_providers.RetrievalSettings(
                provider="tavily", tavily_api_key="test-key"
            ),
            transport=httpx.MockTransport(time_out),
        )
        with self.assertRaises(retrieval_providers.RetrievalProviderError) as raised:
            run_immediate(provider.search(search_request()))
        self.assertEqual(raised.exception.status_code, 504)
        self.assertNotIn("private timeout details", str(raised.exception))

    def test_tavily_upstream_error_maps_to_safe_error(self) -> None:
        provider = retrieval_providers.TavilyRetrievalProvider(
            retrieval_providers.RetrievalSettings(
                provider="tavily", tavily_api_key="test-key"
            ),
            transport=httpx.MockTransport(
                lambda request: httpx.Response(429, json={"error": "private details"})
            ),
        )
        with self.assertRaises(retrieval_providers.RetrievalProviderError) as raised:
            run_immediate(provider.search(search_request()))
        self.assertEqual(raised.exception.status_code, 503)
        self.assertNotIn("private details", str(raised.exception))

    def test_invalid_provider_response_maps_to_safe_error(self) -> None:
        provider = retrieval_providers.TavilyRetrievalProvider(
            retrieval_providers.RetrievalSettings(
                provider="tavily", tavily_api_key="test-key"
            ),
            transport=httpx.MockTransport(
                lambda request: httpx.Response(200, json={"unexpected": []})
            ),
        )
        with self.assertRaises(retrieval_providers.RetrievalProviderError) as raised:
            run_immediate(provider.search(search_request()))
        self.assertEqual(raised.exception.status_code, 502)

    def test_search_route_returns_safe_provider_error(self) -> None:
        provider = retrieval_providers.TavilyRetrievalProvider(
            retrieval_providers.RetrievalSettings(provider="tavily")
        )
        with patch.object(retrieval_service.app.state, "retrieval_provider", provider):
            response = run_immediate(retrieval_service.search(search_request()))
        self.assertEqual(response.status_code, 503)
        payload = json.loads(response.body)
        self.assertEqual(payload["error"]["code"], "RETRIEVAL_PROVIDER_NOT_CONFIGURED")
        self.assertEqual(payload["error"]["request_id"], str(REQUEST_ID))

    def test_openapi_documents_json_search_contract(self) -> None:
        operation = retrieval_service.app.openapi()["paths"][
            "/internal/v1/retrieval/searches"
        ]["post"]
        self.assertIn("application/json", operation["requestBody"]["content"])


if __name__ == "__main__":
    unittest.main()
