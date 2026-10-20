"""Session service boundary; database persistence is added in the next phase."""

from fastapi import FastAPI
from snaplens_contracts import ServiceHealth

SERVICE_NAME = "session-service"
app = FastAPI(title="SnapLens Session Service", version="1.0.0")


@app.get("/health/live", response_model=ServiceHealth, tags=["health"])
@app.get("/health/ready", response_model=ServiceHealth, tags=["health"])
async def health() -> ServiceHealth:
    return ServiceHealth(service=SERVICE_NAME)
