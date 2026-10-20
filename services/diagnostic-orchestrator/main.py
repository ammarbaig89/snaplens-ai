"""Workflow boundary. LangGraph orchestration is added in a later milestone."""

from uuid import UUID, uuid4

from fastapi import FastAPI, Header
from shared.contracts import DiagnosisAccepted, DiagnosisRequest, ServiceHealth

SERVICE_NAME = "diagnostic-orchestrator"
app = FastAPI(title="SnapLens Diagnostic Orchestrator", version="1.0.0")


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
    body: DiagnosisRequest,
    x_request_id: UUID | None = Header(default=None, alias="X-Request-ID"),
) -> DiagnosisAccepted:
    return DiagnosisAccepted(
        request_id=x_request_id or uuid4(),
        session_id=body.session_id or uuid4(),
        message="Request accepted. The diagnostic workflow is not implemented yet.",
    )
