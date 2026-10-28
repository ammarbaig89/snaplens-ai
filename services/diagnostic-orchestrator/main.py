"""HTTP boundary for the LangGraph diagnosis workflow."""

import logging
from uuid import UUID, uuid4

from fastapi import FastAPI, File, Form, Header, Request, Response, UploadFile
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
LOGGER = logging.getLogger(SERVICE_NAME)
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
    openapi_extra={
        "requestBody": {
            "required": True,
            "content": {
                "multipart/form-data": {
                    "schema": {
                        "type": "object",
                        "required": ["question", "image"],
                        "properties": {
                            "question": {"type": "string", "maxLength": 2000},
                            "session_id": {"type": "string", "format": "uuid"},
                            "image": {"type": "string", "format": "binary"},
                        },
                    }
                }
            },
        }
    },
    tags=["internal"],
)
async def accept_diagnosis(
    request: Request,
    x_request_id: UUID | None = Header(default=None, alias="X-Request-ID"),
) -> DiagnosisResult | JSONResponse:
    request_id = x_request_id or uuid4()
    try:
        form = await request.form(max_part_size=MAX_IMAGE_BYTES + 64 * 1024)
    except Exception as error:
        return _error_response(
            request_id, "INVALID_FORM", "Could not parse internal upload form.", 400
        )

    question_val = form.get("question")
    if not isinstance(question_val, str) or not question_val.strip():
        return _error_response(
            request_id, "VALIDATION_ERROR", "A question is required.", 422
        )
    question = question_val.strip()

    session_id_val = form.get("session_id")
    session_id: UUID | None = None
    if isinstance(session_id_val, str) and session_id_val:
        try:
            session_id = UUID(session_id_val)
        except ValueError:
            pass

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
        return _error_response(
            request_id, "MISSING_IMAGE", "An image file is required.", 422
        )
    try:
        resolved_media_type = validate_image(content_type, content)
    except ImageUploadError as error:
        return _error_response(
            request_id, error.code, error.message, error.status_code
        )

    state = {
        "request_id": request_id,
        "session_id": session_id or uuid4(),
        "question": question,
        "image": content,
        "content_type": resolved_media_type,
    }
    try:
        result_state = app.state.diagnosis_graph.invoke(state)
        return result_state["result"]
    except DiagnosisWorkflowError as error:
        return _error_response(
            request_id, error.code, error.message, error.status_code
        )
    except Exception:
        LOGGER.exception("Diagnosis workflow failed: request_id=%s", request_id)
        return _error_response(
            request_id,
            "DIAGNOSIS_UNEXPECTED_FAILURE",
            "The diagnosis encountered an internal error. Check the orchestrator terminal using this request ID.",
            500,
        )
