"""Contract and handler tests for the Gateway upload boundary."""

import importlib.util
import sys
import unittest
from pathlib import Path
from typing import Any, Coroutine, TypeVar
from unittest.mock import patch
from uuid import UUID

import httpx
from fastapi import Response
from pydantic import ValidationError
from starlette.datastructures import FormData

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "services" / "diagnostic-orchestrator"))
sys.path.insert(0, str(ROOT / "services" / "api-gateway"))

import main as gateway  # noqa: E402
from shared.contracts import (  # noqa: E402
    DiagnosisResult,
    DiagnosisRequest,
    RetrievalSearchRequest,
    SessionMessageAppend,
    VisionAnalysisRequest,
)
from shared.image_upload import (  # noqa: E402
    ImageUploadError,
    MAX_IMAGE_BYTES,
    validate_image,
)

ORCHESTRATOR_PATH = ROOT / "services" / "diagnostic-orchestrator" / "main.py"
ORCHESTRATOR_SPEC = importlib.util.spec_from_file_location(
    "snaplens_orchestrator_main", ORCHESTRATOR_PATH
)
assert ORCHESTRATOR_SPEC is not None and ORCHESTRATOR_SPEC.loader is not None
orchestrator = importlib.util.module_from_spec(ORCHESTRATOR_SPEC)
ORCHESTRATOR_SPEC.loader.exec_module(orchestrator)

Result = TypeVar("Result")


def run_immediate_coroutine(coroutine: Coroutine[Any, Any, Result]) -> Result:
    """Drive a route coroutine whose test doubles complete without network I/O."""
    try:
        coroutine.send(None)
    except StopIteration as completed:
        return completed.value
    raise AssertionError("The mocked route unexpectedly suspended for I/O")


class FormRequest:
    """Lightweight Request double: exercise route logic without a socket loop."""

    def __init__(self, form: FormData) -> None:
        self._form = form

    async def form(self, *, max_part_size: int) -> FormData:
        del max_part_size
        return self._form


def form_request(
    *,
    data: dict[str, str],
    files: dict[str, tuple[str, bytes, str]],
) -> FormRequest:
    parts: list[tuple[str, Any]] = list(data.items())
    parts.extend((name, payload[1]) for name, payload in files.items())
    return FormRequest(FormData(parts))


def post_gateway(
    *,
    data: dict[str, str],
    files: dict[str, tuple[str, bytes, str]],
    headers: dict[str, str] | None = None,
) -> Any:
    request = form_request(data=data, files=files)
    request_id_value = (headers or {}).get("X-Request-ID")
    request_id = UUID(request_id_value) if request_id_value else None
    result = run_immediate_coroutine(gateway.create_diagnosis(request, request_id))
    if isinstance(result, DiagnosisResult):
        return httpx.Response(200, json=result.model_dump(mode="json"))
    return httpx.Response(
        result.status_code,
        content=result.body,
        headers=dict(result.headers),
    )


class GatewayTests(unittest.TestCase):
    PNG = b"\x89PNG\r\n\x1a\nfixture"

    def test_live_health(self) -> None:
        from main import live

        health = run_immediate_coroutine(live())
        self.assertEqual(health.model_dump(), {"status": "ok", "service": "api-gateway"})

    def test_gateway_readiness_fails_if_orchestrator_is_unavailable(self) -> None:
        from main import ready

        response = Response()

        async def unavailable() -> bool:
            return False

        with patch("main._orchestrator_ready", new=unavailable):
            health = run_immediate_coroutine(ready(response))
        self.assertEqual(response.status_code, 503)
        self.assertEqual(health.status, "not_ready")

    def test_gateway_to_orchestrator_handler_path(self) -> None:
        request_id = UUID("550e8400-e29b-41d4-a716-446655440000")
        session_id = UUID("550e8400-e29b-41d4-a716-446655440001")
        forwarded: list[tuple[DiagnosisRequest, UUID, bytes]] = []

        async def in_process_orchestrator(
            body: DiagnosisRequest,
            forwarded_id: UUID,
            content_type: str | None,
            content: bytes,
        ) -> httpx.Response:
            forwarded.append((body, forwarded_id, content))
            class FakeGraph:
                def invoke(self, state):
                    return {
                        "result": DiagnosisResult(
                            request_id=state["request_id"],
                            session_id=state["session_id"],
                            status="needs_clarification",
                            answer="Please provide the exact device model.",
                        )
                    }

            with patch.object(orchestrator.app.state, "diagnosis_graph", FakeGraph()):
                internal_request = form_request(
                    data={"question": body.question, "session_id": str(body.session_id)},
                    files={"image": ("device.png", content, content_type or "image/png")},
                )
                diagnosis = run_immediate_coroutine(
                    orchestrator.accept_diagnosis(internal_request, forwarded_id)
                )
            return httpx.Response(
                200,
                json=diagnosis.model_dump(mode="json"),
                request=httpx.Request("POST", "http://orchestrator.test/internal/v1/diagnoses"),
            )

        with patch("main._forward_diagnosis", new=in_process_orchestrator):
            response = post_gateway(
                data={"question": "What does this error code mean?", "session_id": str(session_id)},
                files={"image": ("device.png", self.PNG, "image/png")},
                headers={"X-Request-ID": str(request_id)},
            )

        self.assertEqual(response.status_code, 200)
        result = DiagnosisResult.model_validate(response.json())
        self.assertEqual(result.request_id, request_id)
        self.assertEqual(result.session_id, session_id)
        self.assertEqual(forwarded[0][1], request_id)
        self.assertEqual(forwarded[0][2], b"\x89PNG\r\n\x1a\nfixture")
        self.assertIn("exact device model", result.answer)

    def test_upload_rejects_mismatched_type_and_oversized_content(self) -> None:
        with self.assertRaises(ImageUploadError) as mismatch:
            validate_image("image/png", b"not a png")
        self.assertEqual(mismatch.exception.status_code, 415)

        with self.assertRaises(ImageUploadError) as oversized:
            validate_image("image/png", b"\x89PNG\r\n\x1a\n" + b"x" * MAX_IMAGE_BYTES)
        self.assertEqual(oversized.exception.status_code, 413)

    def test_gateway_returns_safe_error_for_unsupported_image(self) -> None:
        request_id = UUID("550e8400-e29b-41d4-a716-446655440000")
        response = post_gateway(
            data={"question": "What is this?"},
            files={"image": ("bad.svg", b"<svg></svg>", "image/svg+xml")},
            headers={"X-Request-ID": str(request_id)},
        )
        self.assertEqual(response.status_code, 415)
        payload = response.json()
        self.assertEqual(payload["error"]["code"], "UNSUPPORTED_IMAGE_TYPE")
        self.assertEqual(payload["error"]["request_id"], str(request_id))

    def test_openapi_documents_gateway_and_orchestrator_routes(self) -> None:
        self.assertIn("/v1/diagnoses", gateway.app.openapi()["paths"])
        self.assertIn("/health/ready", gateway.app.openapi()["paths"])
        self.assertIn(
            "/internal/v1/diagnoses",
            orchestrator.app.openapi()["paths"],
        )
        upload_types = gateway.app.openapi()["paths"]["/v1/diagnoses"]["post"][
            "requestBody"
        ]["content"]
        self.assertIn("multipart/form-data", upload_types)

    def test_versioned_service_contracts_are_constrained(self) -> None:
        request_id = UUID("550e8400-e29b-41d4-a716-446655440000")
        self.assertEqual(
            VisionAnalysisRequest(
                request_id=request_id,
                question="Read the visible error code",
            ).question,
            "Read the visible error code",
        )
        with self.assertRaises(ValidationError):
            RetrievalSearchRequest(request_id=request_id, query="manual", limit=11)
        self.assertEqual(
            SessionMessageAppend(
                request_id=request_id,
                role="user",
                content="Need help",
            ).request_id,
            request_id,
        )

    def test_unknown_and_invalid_fields_are_rejected(self) -> None:
        with self.assertRaises(ValidationError):
            DiagnosisRequest(question="", unexpected="not allowed")

    def test_upstream_error_is_stable_and_hides_internal_detail(self) -> None:
        async def unavailable(
            body: DiagnosisRequest,
            request_id: UUID,
            content_type: str | None,
            content: bytes,
        ) -> httpx.Response:
            raise httpx.ConnectError(
                "internal socket detail",
                request=httpx.Request("POST", "http://orchestrator/internal/v1/diagnoses"),
            )

        with patch("main._forward_diagnosis", new=unavailable):
            response = post_gateway(
                data={"question": "Need help"},
                files={"image": ("device.png", self.PNG, "image/png")},
            )
        self.assertEqual(response.status_code, 502)
        payload = response.json()
        self.assertEqual(payload["error"]["code"], "UPSTREAM_UNAVAILABLE")
        self.assertNotIn("internal socket detail", response.text)


if __name__ == "__main__":
    unittest.main()
