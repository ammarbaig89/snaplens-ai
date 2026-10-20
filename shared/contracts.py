"""Strict version 1 HTTP contracts shared across SnapLens services."""

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import AnyHttpUrl, BaseModel, ConfigDict, Field


class ContractModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class DiagnosisRequest(ContractModel):
    """Text-first diagnosis request; media upload is added in a later milestone."""

    question: str = Field(min_length=1, max_length=2000)
    session_id: UUID | None = None
    image_asset_id: UUID | None = None


class DiagnosisAccepted(ContractModel):
    request_id: UUID
    session_id: UUID
    status: Literal["accepted"] = "accepted"
    message: str


class DeviceIdentification(ContractModel):
    category: str | None = Field(default=None, max_length=120)
    brand: str | None = Field(default=None, max_length=120)
    model: str | None = Field(default=None, max_length=160)
    confidence: float = Field(ge=0, le=1)


class VisionAnalysisRequest(ContractModel):
    request_id: UUID
    image_asset_id: UUID


class VisionAnalysisResponse(ContractModel):
    request_id: UUID
    result_status: Literal["identified", "ambiguous", "unrecognized"]
    device: DeviceIdentification
    observed_text: list[str] = Field(default_factory=list, max_length=100)
    error_codes: list[str] = Field(default_factory=list, max_length=30)
    warnings: list[str] = Field(default_factory=list, max_length=30)


class RetrievalSearchRequest(ContractModel):
    request_id: UUID
    query: str = Field(min_length=1, max_length=1000)
    manufacturer: str | None = Field(default=None, max_length=120)
    model: str | None = Field(default=None, max_length=160)
    limit: int = Field(default=5, ge=1, le=10)


class RetrievedSource(ContractModel):
    source_id: UUID
    url: AnyHttpUrl
    title: str = Field(min_length=1, max_length=300)
    publisher: str | None = Field(default=None, max_length=200)
    snippet: str = Field(min_length=1, max_length=4000)
    score: float = Field(ge=0, le=1)
    retrieved_at: datetime


class RetrievalSearchResponse(ContractModel):
    request_id: UUID
    sources: list[RetrievedSource] = Field(default_factory=list, max_length=10)


class SessionCreateRequest(ContractModel):
    user_id: UUID | None = None


class SessionRecord(ContractModel):
    session_id: UUID
    user_id: UUID | None = None
    status: Literal["active", "closed"] = "active"
    created_at: datetime


class SessionMessageAppend(ContractModel):
    request_id: UUID
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=8000)


class SessionMessageRecord(ContractModel):
    message_id: UUID
    session_id: UUID
    request_id: UUID
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=8000)
    created_at: datetime


class ErrorBody(ContractModel):
    code: str
    message: str
    request_id: UUID


class ErrorEnvelope(ContractModel):
    error: ErrorBody


class ServiceHealth(ContractModel):
    status: Literal["ok", "not_ready"] = "ok"
    service: str
