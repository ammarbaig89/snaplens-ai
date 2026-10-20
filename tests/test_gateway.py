"""Contract and handler tests for the Gateway upload boundary."""

import json
import importlib.util
import sys
from tempfile import SpooledTemporaryFile
import unittest
from pathlib import Path
from typing import Any, Coroutine, TypeVar
from unittest.mock import patch
from uuid import UUID

import httpx
from fastapi import Response
from pydantic import ValidationError
from starlette.datastructures import Headers, UploadFile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "services" / "api-gateway"))

import main as gateway  # noqa: E402
from shared.contracts import (  # noqa: E402
    DiagnosisAccepted,
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


class GatewayTests(unittest.TestCase):
    @staticmethod
    def png_upload(content: bytes = b"\x89PNG\r\n\x1a\nfixture") -> UploadFile:
        file = SpooledTemporaryFile()
        file.write(content)
        file.seek(0)
        return UploadFile(
            filename="device.png",
            file=file,
            headers=Headers({"content-type": "image/png"}),
        )

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
        from main import create_diagnosis

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
            accepted = run_immediate_coroutine(
                orchestrator.accept_diagnosis(
                    question=body.question,
                    session_id=body.session_id,
                    image=self.png_upload(content),
                    x_request_id=forwarded_id,
                )
            )
            return httpx.Response(
                202,
                json=accepted.model_dump(mode="json"),
                request=httpx.Request("POST", "http://orchestrator/internal/v1/diagnoses"),
            )

        with patch("main._forward_diagnosis", new=in_process_orchestrator):
            result = run_immediate_coroutine(
                create_diagnosis(
                    question="What does this error code mean?",
                    session_id=session_id,
                    image=self.png_upload(),
                    x_request_id=request_id,
                )
            )

        self.assertIsInstance(result, DiagnosisAccepted)
        self.assertEqual(result.request_id, request_id)
        self.assertEqual(result.session_id, session_id)
        self.assertEqual(forwarded[0][1], request_id)
        self.assertEqual(forwarded[0][2], b"\x89PNG\r\n\x1a\nfixture")
        self.assertIn("Image validated", result.message)

    def test_upload_rejects_mismatched_type_and_oversized_content(self) -> None:
        with self.assertRaises(ImageUploadError) as mismatch:
            validate_image("image/png", b"not a png")
        self.assertEqual(mismatch.exception.status_code, 415)

        with self.assertRaises(ImageUploadError) as oversized:
            validate_image("image/png", b"\x89PNG\r\n\x1a\n" + b"x" * MAX_IMAGE_BYTES)
        self.assertEqual(oversized.exception.status_code, 413)

    def test_gateway_returns_safe_error_for_unsupported_image(self) -> None:
        from main import create_diagnosis

        request_id = UUID("550e8400-e29b-41d4-a716-446655440000")
        upload = UploadFile(
            filename="bad.svg",
            file=SpooledTemporaryFile(),
            headers=Headers({"content-type": "image/svg+xml"}),
        )
        upload.file.write(b"<svg></svg>")
        upload.file.seek(0)
        response = run_immediate_coroutine(
            create_diagnosis(
                question="What is this?",
                session_id=None,
                image=upload,
                x_request_id=request_id,
            )
        )
        self.assertEqual(response.status_code, 415)
        payload = json.loads(response.body)
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
        asset_id = UUID("550e8400-e29b-41d4-a716-446655440002")
        self.assertEqual(
            VisionAnalysisRequest(
                request_id=request_id,
                image_asset_id=asset_id,
            ).image_asset_id,
            asset_id,
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
        from main import create_diagnosis

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
            response = run_immediate_coroutine(
                create_diagnosis(
                    question="Need help",
                    session_id=None,
                    image=self.png_upload(),
                    x_request_id=None,
                )
            )
        self.assertEqual(response.status_code, 502)
        payload = json.loads(response.body)
        self.assertEqual(payload["error"]["code"], "UPSTREAM_UNAVAILABLE")
        self.assertNotIn("internal socket detail", response.body.decode())


if __name__ == "__main__":
    unittest.main()
