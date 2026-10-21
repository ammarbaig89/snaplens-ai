"""HTTP boundary for the LangGraph diagnosis workflow."""

from uuid import UUID, uuid4

from fastapi import FastAPI, File, Form, Header, Response, UploadFile
from fastapi.responses import JSONResponse

from shared import config as _config  # noqa: F401
from shared.contracts import (
    DiagnosisResult,
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
from answer_providers import create_answer_provider
from workflow import (
    DiagnosisWorkflowError,
    ServiceSettings,
    VisionServiceClient,
    RetrievalServiceClient,
    create_default_workflow,
)

SERVICE_NAME = "diagnostic-orchestrator"
app = FastAPI(
    title="SnapLens Diagnostic Orchestrator",
    version="1.0.0",
    description="Coordinates image analysis, support search, and cited answers.",
)
app.add_middleware(RequestBodyLimitMiddleware)
app.state.diagnosis_graph, SERVICE_SETTINGS, ANSWER_SETTINGS = create_default_workflow()
app.state.vision_client = VisionServiceClient(
    SERVICE_SETTINGS.vision_url, SERVICE_SETTINGS.timeout_seconds
)
app.state.retrieval_client = RetrievalServiceClient(
    SERVICE_SETTINGS.retrieval_url, SERVICE_SETTINGS.timeout_seconds
)
app.state.answer_provider = create_answer_provider(ANSWER_SETTINGS)


def _error_response(
    request_id: UUID, code: str, message: str, status_code: int
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
def ready(response: Response) -> ServiceHealth:
    ready_checks = (
        app.state.vision_client.is_ready(),
        app.state.retrieval_client.is_ready(),
    )
    if not all(ready_checks) or not app.state.answer_provider.is_ready():
        response.status_code = 503
        return ServiceHealth(status="not_ready", service=SERVICE_NAME)
    return ServiceHealth(service=SERVICE_NAME)


@app.post(
    "/internal/v1/diagnoses",
    response_model=DiagnosisResult,
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
def accept_diagnosis(
    question: str = Form(..., min_length=1, max_length=2000),
    session_id: UUID | None = Form(default=None),
    image: UploadFile = File(...),
    x_request_id: UUID | None = Header(default=None, alias="X-Request-ID"),
) -> DiagnosisResult | JSONResponse:
    request_id = x_request_id or uuid4()
    content_type = image.content_type
    content = image.file.read(MAX_IMAGE_BYTES + 1)
    image.file.close()
    try:
        validate_image(content_type, content)
    except ImageUploadError as error:
        return _error_response(
            request_id, error.code, error.message, error.status_code
        )

    state = {
        "request_id": request_id,
        "session_id": session_id or uuid4(),
        "question": question,
        "image": content,
        "content_type": (content_type or "").split(";", 1)[0].strip().lower(),
    }
    try:
        result_state = app.state.diagnosis_graph.invoke(state)
        return result_state["result"]
    except DiagnosisWorkflowError as error:
        return _error_response(
            request_id, error.code, error.message, error.status_code
        )
