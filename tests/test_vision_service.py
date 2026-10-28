"""Offline tests for the Vision Service contract and provider boundary."""

import base64
import importlib.util
import json
import sys
import unittest
from tempfile import SpooledTemporaryFile
from pathlib import Path
from unittest.mock import patch
from uuid import UUID

import httpx
from fastapi import Response
from starlette.datastructures import Headers, UploadFile

ROOT = Path(__file__).resolve().parents[1]
VISION_DIR = ROOT / "services" / "vision-service"
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(VISION_DIR))

import providers as vision_providers  # noqa: E402
from shared.contracts import VisionAnalysisResponse  # noqa: E402

VISION_SPEC = importlib.util.spec_from_file_location(
    "snaplens_vision_main", VISION_DIR / "main.py"
)
assert VISION_SPEC is not None and VISION_SPEC.loader is not None
vision_service = importlib.util.module_from_spec(VISION_SPEC)
VISION_SPEC.loader.exec_module(vision_service)

REQUEST_ID = UUID("550e8400-e29b-41d4-a716-446655440000")
PNG_BYTES = b"\x89PNG\r\n\x1a\nsmall test fixture"


def run_immediate(coroutine):
    """Run a coroutine whose test provider and in-memory upload never block."""
    try:
        coroutine.send(None)
    except StopIteration as completed:
        return completed.value
    raise AssertionError("The mocked coroutine unexpectedly suspended")


def png_upload(content: bytes = PNG_BYTES) -> UploadFile:
    file = SpooledTemporaryFile()
    file.write(content)
    file.seek(0)
    return UploadFile(
        filename="device.png",
        file=file,
        headers=Headers({"content-type": "image/png"}),
    )


class VisionServiceTests(unittest.TestCase):
    def test_mock_provider_returns_explicit_ambiguous_result(self) -> None:
        result = run_immediate(
            vision_providers.MockVisionProvider().analyze(
                request_id=REQUEST_ID,
                question="What is this?",
                image=PNG_BYTES,
                content_type="image/png",
            )
        )
        self.assertEqual(result.result_status, "ambiguous")
        self.assertEqual(result.device.confidence, 0)
        self.assertIn("no real image analysis", result.warnings[0])

    def test_analysis_route_validates_image_and_uses_configured_provider(self) -> None:
        provider = vision_providers.MockVisionProvider()
        with patch.object(vision_service.app.state, "vision_provider", provider):
            response = run_immediate(
                vision_service.analyze_image(
                    request_id=REQUEST_ID,
                    question="Read the error code",
                    image=png_upload(),
                )
            )
        self.assertIsInstance(response, VisionAnalysisResponse)
        self.assertEqual(response.request_id, REQUEST_ID)
        self.assertEqual(response.result_status, "ambiguous")

    def test_analysis_route_returns_safe_error_for_invalid_image(self) -> None:
        upload = UploadFile(
            filename="bad.svg",
            file=SpooledTemporaryFile(),
            headers=Headers({"content-type": "image/svg+xml"}),
        )
        upload.file.write(b"<svg></svg>")
        upload.file.seek(0)
        response = run_immediate(
            vision_service.analyze_image(
                request_id=REQUEST_ID,
                question=None,
                image=upload,
            )
        )
        self.assertEqual(response.status_code, 415)
        payload = json.loads(response.body)
        self.assertEqual(payload["error"]["code"], "UNSUPPORTED_IMAGE_TYPE")
        self.assertEqual(payload["error"]["request_id"], str(REQUEST_ID))

    def test_readiness_depends_on_selected_provider_configuration(self) -> None:
        response = Response()
        with patch.object(
            vision_service.app.state,
            "vision_provider",
            vision_providers.GeminiVisionProvider(
                vision_providers.VisionSettings(provider="gemini", gemini_api_key="")
            ),
        ):
            health = run_immediate(vision_service.ready(response))
        self.assertEqual(response.status_code, 503)
        self.assertEqual(health.status, "not_ready")

    def test_openapi_documents_multipart_analysis_route(self) -> None:
        operation = vision_service.app.openapi()["paths"][
            "/internal/v1/vision/analyses"
        ]["post"]
        self.assertIn("multipart/form-data", operation["requestBody"]["content"])

    def test_gemini_provider_maps_upstream_failure_to_safe_error(self) -> None:
        transport = httpx.MockTransport(
            lambda request: httpx.Response(503, json={"error": "private details"})
        )
        provider = vision_providers.GeminiVisionProvider(
            vision_providers.VisionSettings(
                provider="gemini", gemini_api_key="test-key"
            ),
            transport=transport,
        )
        with self.assertRaises(vision_providers.VisionProviderError) as raised:
            run_immediate(
                provider.analyze(
                    request_id=REQUEST_ID,
                    question=None,
                    image=PNG_BYTES,
                    content_type="image/png",
                )
            )
        self.assertEqual(raised.exception.status_code, 503)
        self.assertNotIn("private details", str(raised.exception))

    def test_gemini_provider_maps_timeout_to_safe_error(self) -> None:
        def time_out(request: httpx.Request) -> httpx.Response:
            raise httpx.ReadTimeout("private timeout details", request=request)

        provider = vision_providers.GeminiVisionProvider(
            vision_providers.VisionSettings(
                provider="gemini", gemini_api_key="test-key"
            ),
            transport=httpx.MockTransport(time_out),
        )
        with self.assertRaises(vision_providers.VisionProviderError) as raised:
            run_immediate(
                provider.analyze(
                    request_id=REQUEST_ID,
                    question=None,
                    image=PNG_BYTES,
                    content_type="image/png",
                )
            )
        self.assertEqual(raised.exception.status_code, 504)
        self.assertNotIn("private timeout details", str(raised.exception))

    def test_gemini_provider_sends_inline_image_and_parses_structured_result(self) -> None:
        model_output = {
            "result_status": "identified",
            "device": {
                "category": "washing machine",
                "brand": "Acme",
                "model": "WM-100",
                "confidence": 0.91,
            },
            "image_summary": "A washing machine control panel displays an E21 message.",
            "visible_issue": "The display shows the E21 error code.",
            "visual_observations": ["A digital control panel is visible."],
            "observed_text": ["E21"],
            "error_codes": ["E21"],
            "warnings": [],
        }
        requests: list[httpx.Request] = []

        def respond(request: httpx.Request) -> httpx.Response:
            requests.append(request)
            return httpx.Response(
                200,
                json={
                    "candidates": [
                        {"content": {"parts": [{"text": json.dumps(model_output)}]}}
                    ]
                },
            )

        settings = vision_providers.VisionSettings(
            provider="gemini", gemini_api_key="test-key", gemini_model="test-model"
        )
        provider = vision_providers.GeminiVisionProvider(
            settings, transport=httpx.MockTransport(respond)
        )
        result = run_immediate(
            provider.analyze(
                request_id=REQUEST_ID,
                question="Read the error code",
                image=PNG_BYTES,
                content_type="image/png",
            )
        )
        sent = json.loads(requests[0].content)
        sent_parts = sent["contents"][0]["parts"]
        self.assertEqual(result.device.brand, "Acme")
        self.assertEqual(
            result.image_summary,
            "A washing machine control panel displays an E21 message.",
        )
        self.assertEqual(result.visible_issue, "The display shows the E21 error code.")
        self.assertEqual(result.visual_observations, ["A digital control panel is visible."])
        self.assertEqual(result.error_codes, ["E21"])
        self.assertEqual(requests[0].headers["x-goog-api-key"], "test-key")
        self.assertEqual(
            base64.b64decode(sent_parts[0]["inline_data"]["data"]), PNG_BYTES
        )
        self.assertIn("visual_observations", sent_parts[1]["text"])

    def test_gemini_provider_rejects_invalid_model_output(self) -> None:
        transport = httpx.MockTransport(
            lambda request: httpx.Response(
                200,
                json={
                    "candidates": [
                        {"content": {"parts": [{"text": "not valid json"}]}}
                    ]
                },
            )
        )
        provider = vision_providers.GeminiVisionProvider(
            vision_providers.VisionSettings(
                provider="gemini", gemini_api_key="test-key"
            ),
            transport=transport,
        )
        with self.assertRaises(vision_providers.VisionProviderError) as raised:
            run_immediate(
                provider.analyze(
                    request_id=REQUEST_ID,
                    question=None,
                    image=PNG_BYTES,
                    content_type="image/png",
                )
            )
        self.assertEqual(
            raised.exception.code, "VISION_INVALID_PROVIDER_RESPONSE"
        )

    def test_gemini_provider_handles_missing_key_without_calling_api(self) -> None:
        provider = vision_providers.GeminiVisionProvider(
            vision_providers.VisionSettings(provider="gemini", gemini_api_key="")
        )
        with self.assertRaises(vision_providers.VisionProviderError) as raised:
            run_immediate(
                provider.analyze(
                    request_id=REQUEST_ID,
                    question=None,
                    image=PNG_BYTES,
                    content_type="image/png",
                )
            )
        self.assertEqual(raised.exception.status_code, 503)


if __name__ == "__main__":
    unittest.main()
