"""Public HTTP entry point; mobile clients must not call internal services."""

import os
from uuid import UUID, uuid4

import httpx
from fastapi import FastAPI, File, Form, Header, Response, UploadFile
from fastapi.responses import JSONResponse
from shared.contracts import (
    DiagnosisAccepted,
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
ORCHESTRATOR_URL = os.getenv("ORCHESTRATOR_URL", "http://localhost:8001")
HTTP_TIMEOUT_SECONDS = float(os.getenv("HTTP_TIMEOUT_SECONDS", "5"))

app = FastAPI(
    title="SnapLens API Gateway",
    version="1.0.0",
    description="The single public API entry point for SnapLens AI.",
)
app.add_middleware(RequestBodyLimitMiddleware)


async def _orchestrator_ready() -> bool:
    try:
        async with httpx.AsyncClient(timeout=HTTP_TIMEOUT_SECONDS) as client:
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
    response_model=DiagnosisAccepted,
    status_code=202,
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
    question: str = Form(..., min_length=1, max_length=2000),
    session_id: UUID | None = Form(default=None),
    image: UploadFile = File(...),
    x_request_id: UUID | None = Header(default=None, alias="X-Request-ID"),
) -> DiagnosisAccepted | JSONResponse:
    request_id = x_request_id or uuid4()
    body = DiagnosisRequest(question=question, session_id=session_id)
    content_type = image.content_type
    content = await image.read(MAX_IMAGE_BYTES + 1)
    await image.close()
    try:
        validate_image(content_type, content)
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
    try:
        result = await _forward_diagnosis(body, request_id, content_type, content)
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
        return JSONResponse(
            status_code=502,
            content=ErrorEnvelope(
                error=ErrorBody(
                    code="UPSTREAM_FAILURE",
                    message="The diagnostic service could not accept the request.",
                    request_id=request_id,
                )
            ).model_dump(mode="json"),
        )
    return DiagnosisAccepted.model_validate(result.json())
