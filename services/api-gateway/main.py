"""Public HTTP entry point; mobile clients must not call internal services."""

import logging
import os
from uuid import UUID, uuid4

import httpx
from fastapi import FastAPI, File, Form, Header, Request, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from shared import config as _config  # noqa: F401
from shared.contracts import (
    DiagnosisResult,
    DiagnosisRequest,
    ErrorBody,
    ErrorEnvelope,
    ServiceHealth,
)
from shared.image_upload import (
    ImageUploadError,
    MAX_IMAGE_BYTES,
    RequestBodyLimitMiddleware,
    validate_image,
)

SERVICE_NAME = "api-gateway"
LOGGER = logging.getLogger(SERVICE_NAME)
ORCHESTRATOR_URL = os.getenv("ORCHESTRATOR_URL", "http://localhost:8001")
HTTP_TIMEOUT_SECONDS = float(os.getenv("HTTP_TIMEOUT_SECONDS", "90"))

app = FastAPI(
    title="SnapLens API Gateway",
    version="1.0.0",
    description="The single public API entry point for SnapLens AI.",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(RequestBodyLimitMiddleware)


async def _orchestrator_ready() -> bool:
    try:
        async with httpx.AsyncClient(timeout=min(HTTP_TIMEOUT_SECONDS, 3.0)) as client:
            result = await client.get(f"{ORCHESTRATOR_URL}/health/ready")
        return result.status_code == 200
    except httpx.HTTPError:
        return False


async def _forward_diagnosis(
    body: DiagnosisRequest,
    request_id: UUID,
    content_type: str | None,
    content: bytes,
) -> httpx.Response:
    async with httpx.AsyncClient(
        base_url=ORCHESTRATOR_URL,
        timeout=HTTP_TIMEOUT_SECONDS,
    ) as client:
        return await client.post(
            "/internal/v1/diagnoses",
            data={"question": body.question}
            | ({"session_id": str(body.session_id)} if body.session_id else {}),
            files={
                "image": (
                    "upload",
                    content,
                    content_type or "application/octet-stream",
                )
            },
            headers={"X-Request-ID": str(request_id)},
        )


@app.get("/health/live", response_model=ServiceHealth, tags=["health"])
async def live() -> ServiceHealth:
    return ServiceHealth(service=SERVICE_NAME)


@app.get("/health/ready", response_model=ServiceHealth, tags=["health"])
async def ready(response: Response) -> ServiceHealth:
    if not await _orchestrator_ready():
        response.status_code = 503
        return ServiceHealth(status="not_ready", service=SERVICE_NAME)
    return ServiceHealth(service=SERVICE_NAME)


@app.post(
    "/v1/diagnoses",
    response_model=DiagnosisResult,
    responses={
        413: {"model": ErrorEnvelope},
        415: {"model": ErrorEnvelope},
        422: {"model": ErrorEnvelope},
        502: {"model": ErrorEnvelope},
        504: {"model": ErrorEnvelope},
    },
    tags=["diagnoses"],
)
async def create_diagnosis(
    request: Request,
    x_request_id: UUID | None = Header(default=None, alias="X-Request-ID"),
) -> DiagnosisResult | JSONResponse:
    request_id = x_request_id or uuid4()
    try:
        form = await request.form(max_part_size=MAX_IMAGE_BYTES + 64 * 1024)
    except Exception as error:
        return JSONResponse(
            status_code=400,
            content=ErrorEnvelope(
                error=ErrorBody(
                    code="INVALID_FORM",
                    message="Could not parse upload form.",
                    request_id=request_id,
                )
            ).model_dump(mode="json"),
        )

    question_val = form.get("question")
    if not isinstance(question_val, str) or not question_val.strip():
        return JSONResponse(
            status_code=422,
            content=ErrorEnvelope(
                error=ErrorBody(
                    code="VALIDATION_ERROR",
                    message="A question is required.",
                    request_id=request_id,
                )
            ).model_dump(mode="json"),
        )
    question = question_val.strip()

    session_id_val = form.get("session_id")
    session_id: UUID | None = None
    if isinstance(session_id_val, str) and session_id_val:
        try:
            session_id = UUID(session_id_val)
        except ValueError:
            pass

    print(f"DEBUG: form keys = {list(form.keys())}, image_val type = {type(form.get('image'))}")
    image_val = form.get("image")
    content: bytes
    content_type: str | None = None
    if hasattr(image_val, "read"):
        content_type = getattr(image_val, "content_type", None)
        read_fn = getattr(image_val, "read")
        import inspect
        if inspect.iscoroutinefunction(read_fn):
            content = await read_fn(MAX_IMAGE_BYTES + 1)
        else:
            content = read_fn(MAX_IMAGE_BYTES + 1)
        if hasattr(image_val, "close"):
            close_fn = getattr(image_val, "close")
            if inspect.iscoroutinefunction(close_fn):
                await close_fn()
            else:
                close_fn()
    elif isinstance(image_val, (bytes, bytearray)):
        content = bytes(image_val)
    elif isinstance(image_val, str):
        content = image_val.encode("latin1")
    else:
        return JSONResponse(
            status_code=422,
            content=ErrorEnvelope(
                error=ErrorBody(
                    code="MISSING_IMAGE",
                    message="An image file is required.",
                    request_id=request_id,
                )
            ).model_dump(mode="json"),
        )
    try:
        resolved_media_type = validate_image(content_type, content)
    except ImageUploadError as error:
        return JSONResponse(
            status_code=error.status_code,
            content=ErrorEnvelope(
                error=ErrorBody(
                    code=error.code,
                    message=error.message,
                    request_id=request_id,
                )
            ).model_dump(mode="json"),
        )
    body = DiagnosisRequest(question=question, session_id=session_id)
    try:
        result = await _forward_diagnosis(body, request_id, resolved_media_type, content)
    except httpx.TimeoutException:
        return JSONResponse(
            status_code=504,
            content=ErrorEnvelope(
                error=ErrorBody(
                    code="UPSTREAM_TIMEOUT",
                    message="The diagnostic service did not respond in time.",
                    request_id=request_id,
                )
            ).model_dump(mode="json"),
        )
    except httpx.HTTPError:
        return JSONResponse(
            status_code=502,
            content=ErrorEnvelope(
                error=ErrorBody(
                    code="UPSTREAM_UNAVAILABLE",
                    message="The diagnostic service is temporarily unavailable.",
                    request_id=request_id,
                )
            ).model_dump(mode="json"),
        )

    if not result.is_success:
        print(f"DEBUG: Orchestrator failed with status {result.status_code}: {result.text}")
        # Keep the orchestrator's safe, structured diagnosis error so the app
        # can show the real cause (for example provider quota or configuration).
        try:
            upstream_error = ErrorEnvelope.model_validate(result.json())
            if upstream_error.error.request_id == request_id and result.status_code in {500, 502, 503, 504}:
                return JSONResponse(
                    status_code=result.status_code,
                    content=upstream_error.model_dump(mode="json"),
                )
            LOGGER.error(
                "Orchestrator error request ID mismatch: gateway=%s orchestrator=%s status=%s",
                request_id,
                upstream_error.error.request_id,
                result.status_code,
            )
        except (ValueError, TypeError):
            LOGGER.error(
                "Orchestrator returned an unstructured error: request_id=%s status=%s content_type=%s",
                request_id,
                result.status_code,
                result.headers.get("content-type", "unknown"),
            )
        return JSONResponse(
            status_code=502,
            content=ErrorEnvelope(
                error=ErrorBody(
                    code="UPSTREAM_FAILURE",
                    message="The diagnostic service could not complete the request.",
                    request_id=request_id,
                )
            ).model_dump(mode="json"),
        )
    return DiagnosisResult.model_validate(result.json())
