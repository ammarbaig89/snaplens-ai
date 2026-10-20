"""HTTP API for bounded support-information search."""

from uuid import UUID

from fastapi import FastAPI, Response
from fastapi.responses import JSONResponse

from shared import config as _config  # noqa: F401
from shared.contracts import (
    ErrorBody,
    ErrorEnvelope,
    RetrievalSearchRequest,
    RetrievalSearchResponse,
    ServiceHealth,
)
from retrieval_providers import (
    RetrievalProviderError,
    RetrievalSettings,
    create_provider,
)

SERVICE_NAME = "retrieval-service"
SETTINGS = RetrievalSettings.from_env()
app = FastAPI(
    title="SnapLens Retrieval Service",
    version="1.0.0",
    description="Searches for bounded, traceable support information.",
)
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
