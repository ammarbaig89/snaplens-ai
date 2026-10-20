"""Retrieval boundary; search and extraction are deferred to a later phase."""

from fastapi import FastAPI
from shared.contracts import ServiceHealth

SERVICE_NAME = "retrieval-service"
app = FastAPI(title="SnapLens Retrieval Service", version="1.0.0")


@app.get("/health/live", response_model=ServiceHealth, tags=["health"])
@app.get("/health/ready", response_model=ServiceHealth, tags=["health"])
async def health() -> ServiceHealth:
    return ServiceHealth(service=SERVICE_NAME)
