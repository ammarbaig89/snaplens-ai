"""HTTP API for transient image analysis."""

from uuid import UUID

from fastapi import FastAPI, File, Form, Response, UploadFile
from fastapi.responses import JSONResponse

from shared import config as _config  # noqa: F401
from shared.contracts import (
    ErrorBody,
    ErrorEnvelope,
    ServiceHealth,
    VisionAnalysisResponse,
)
from shared.image_upload import (
    ImageUploadError,
    MAX_IMAGE_BYTES,
    RequestBodyLimitMiddleware,
    validate_image,
)
from providers import (
    VisionProviderError,
    VisionSettings,
    create_provider,
)

SERVICE_NAME = "vision-service"
SETTINGS = VisionSettings.from_env()
app = FastAPI(
    title="SnapLens Vision Service",
    version="1.0.0",
    description="Identifies visible device details and text in transient image uploads.",
)
app.add_middleware(RequestBodyLimitMiddleware)
app.state.vision_provider = create_provider(SETTINGS)


def _error_response(
    request_id: UUID,
    code: str,
    message: str,
    status_code: int,
) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content=ErrorEnvelope(
            error=ErrorBody(code=code, message=message, request_id=request_id)
        ).model_dump(mode="json"),
    )


@app.get("/health/live", response_model=ServiceHealth, tags=["health"])
async def live() -> ServiceHealth:
    return ServiceHealth(service=SERVICE_NAME)


@app.get("/health/ready", response_model=ServiceHealth, tags=["health"])
async def ready(response: Response) -> ServiceHealth:
    if not app.state.vision_provider.is_ready():
        response.status_code = 503
        return ServiceHealth(status="not_ready", service=SERVICE_NAME)
    return ServiceHealth(service=SERVICE_NAME)


@app.post(
    "/internal/v1/vision/analyses",
    response_model=VisionAnalysisResponse,
    responses={
        413: {"model": ErrorEnvelope},
        415: {"model": ErrorEnvelope},
        422: {"model": ErrorEnvelope},
        502: {"model": ErrorEnvelope},
        503: {"model": ErrorEnvelope},
        504: {"model": ErrorEnvelope},
    },
    tags=["internal"],
)
async def analyze_image(
    request_id: UUID = Form(...),
    question: str | None = Form(default=None, max_length=2000),
    image: UploadFile = File(...),
) -> VisionAnalysisResponse | JSONResponse:
    content_type = image.content_type
    content = await image.read(MAX_IMAGE_BYTES + 1)
    await image.close()

    try:
        validate_image(content_type, content)
    except ImageUploadError as error:
        return _error_response(
            request_id,
            error.code,
            error.message,
            error.status_code,
        )
    if content_type is None:
        return _error_response(
            request_id,
            "UNSUPPORTED_IMAGE_TYPE",
            "Upload a JPEG, PNG, or WebP image.",
            415,
        )

    try:
        return await app.state.vision_provider.analyze(
            request_id=request_id,
            question=question,
            image=content,
            content_type=content_type.split(";", 1)[0].strip().lower(),
        )
    except VisionProviderError as error:
        return _error_response(
            request_id,
            error.code,
            error.message,
            error.status_code,
        )
