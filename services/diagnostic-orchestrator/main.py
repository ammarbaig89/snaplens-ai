"""Workflow boundary. LangGraph orchestration is added in a later milestone."""

from uuid import UUID, uuid4

from fastapi import FastAPI, File, Form, Header, UploadFile
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

SERVICE_NAME = "diagnostic-orchestrator"
app = FastAPI(title="SnapLens Diagnostic Orchestrator", version="1.0.0")
app.add_middleware(RequestBodyLimitMiddleware)


@app.get("/health/live", response_model=ServiceHealth, tags=["health"])
@app.get("/health/ready", response_model=ServiceHealth, tags=["health"])
async def health() -> ServiceHealth:
    return ServiceHealth(service=SERVICE_NAME)


@app.post(
    "/internal/v1/diagnoses",
    response_model=DiagnosisAccepted,
    status_code=202,
    tags=["internal"],
)
async def accept_diagnosis(
    question: str = Form(..., min_length=1, max_length=2000),
    session_id: UUID | None = Form(default=None),
    image: UploadFile = File(...),
    x_request_id: UUID | None = Header(default=None, alias="X-Request-ID"),
) -> DiagnosisAccepted | JSONResponse:
    request_id = x_request_id or uuid4()
    body = DiagnosisRequest(question=question, session_id=session_id)
    content = await image.read(MAX_IMAGE_BYTES + 1)
    await image.close()
    try:
        validate_image(image.content_type, content)
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
    return DiagnosisAccepted(
        request_id=request_id,
        session_id=body.session_id or uuid4(),
        message="Image validated. The diagnostic workflow is not implemented yet.",
    )
