"""HTTP API for bounded support-information search."""

from uuid import UUID

from fastapi import FastAPI, File, Form, Response, UploadFile
from fastapi.responses import JSONResponse

from shared import config as _config  # noqa: F401
from shared.contracts import (
    ErrorBody,
    ErrorEnvelope,
    RetrievalExtractionResponse,
    RetrievalSearchRequest,
    RetrievalSearchResponse,
    ServiceHealth,
)
from retrieval_providers import (
    RetrievalProviderError,
    RetrievalSettings,
    create_provider,
)
from extractors import (
    MAX_DOCUMENT_BYTES,
    DocumentExtractionError,
    extract_document_text,
)
from shared.image_upload import RequestBodyLimitMiddleware

SERVICE_NAME = "retrieval-service"
SETTINGS = RetrievalSettings.from_env()
app = FastAPI(
    title="SnapLens Retrieval Service",
    version="1.0.0",
    description="Searches for bounded, traceable support information.",
)
app.add_middleware(RequestBodyLimitMiddleware)
app.state.retrieval_provider = create_provider(SETTINGS)


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
    if not app.state.retrieval_provider.is_ready():
        response.status_code = 503
        return ServiceHealth(status="not_ready", service=SERVICE_NAME)
    return ServiceHealth(service=SERVICE_NAME)


@app.post(
    "/internal/v1/retrieval/searches",
    response_model=RetrievalSearchResponse,
    responses={
        502: {"model": ErrorEnvelope},
        503: {"model": ErrorEnvelope},
        504: {"model": ErrorEnvelope},
    },
    tags=["internal"],
)
async def search(
    request: RetrievalSearchRequest,
) -> RetrievalSearchResponse | JSONResponse:
    try:
        return await app.state.retrieval_provider.search(request)
    except RetrievalProviderError as error:
        return _error_response(
            request.request_id,
            error.code,
            error.message,
            error.status_code,
        )


@app.post(
    "/internal/v1/retrieval/extractions",
    response_model=RetrievalExtractionResponse,
    responses={
        413: {"model": ErrorEnvelope},
        415: {"model": ErrorEnvelope},
        422: {"model": ErrorEnvelope},
    },
    tags=["internal"],
)
async def extract_document(
    request_id: UUID = Form(...),
    document: UploadFile = File(...),
) -> RetrievalExtractionResponse | JSONResponse:
    content_type = (document.content_type or "").split(";", 1)[0].strip().lower()
    content = await document.read(MAX_DOCUMENT_BYTES + 1)
    await document.close()
    try:
        extracted_text = extract_document_text(content, content_type)
    except DocumentExtractionError as error:
        return _error_response(
            request_id, error.code, error.message, error.status_code
        )
    return RetrievalExtractionResponse(
        request_id=request_id,
        content_type=content_type,
        text=extracted_text,
    )
