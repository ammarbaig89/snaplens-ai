"""LangGraph workflow that coordinates the Vision, Retrieval, and answer services."""

import os
import re
from typing import Literal, TypedDict
from uuid import UUID

import httpx
from langgraph.graph import END, START, StateGraph

from shared.contracts import (
    DiagnosisResult,
    ErrorEnvelope,
    RetrievalSearchRequest,
    RetrievalSearchResponse,
    RetrievedSource,
    VisionAnalysisResponse,
)
from answer_providers import AnswerProvider, AnswerProviderError, AnswerSettings

_HAZARD_TERMS = re.compile(
    r"\b(?:mains electricity|live wire|gas line|gas leak|refrigerant|"
    r"high voltage|pressurized|pressure vessel|capacitor|fuel line)\b",
    re.IGNORECASE,
)
_REPAIR_ACTIONS = re.compile(
    r"\b(?:open|remove|disconnect|bypass|replace|repair|adjust|recharge|"
    r"touch|test|rewire|loosen|tighten|work on)\b",
    re.IGNORECASE,
)


class DiagnosisWorkflowError(Exception):
    def __init__(self, code: str, message: str, status_code: int) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code


class DiagnosisState(TypedDict, total=False):
    request_id: UUID
    session_id: UUID
    question: str
    image: bytes
    content_type: str
    vision: VisionAnalysisResponse
    retrieval: RetrievalSearchResponse
    warnings: list[str]
    result: DiagnosisResult


class ServiceSettings:
    def __init__(self) -> None:
        self.vision_url = os.getenv("VISION_SERVICE_URL", "http://localhost:8002").rstrip("/")
        self.retrieval_url = os.getenv(
            "RETRIEVAL_SERVICE_URL", "http://localhost:8003"
        ).rstrip("/")
        self.timeout_seconds = float(os.getenv("ORCHESTRATOR_SERVICE_TIMEOUT_SECONDS", "35"))
        if self.timeout_seconds <= 0:
            raise ValueError("ORCHESTRATOR_SERVICE_TIMEOUT_SECONDS must be positive")


class VisionServiceClient:
    def __init__(
        self,
        base_url: str,
        timeout_seconds: float,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.timeout_seconds = timeout_seconds
        self.transport = transport

    def analyze(
        self,
        request_id: UUID,
        question: str,
        image: bytes,
        content_type: str,
    ) -> VisionAnalysisResponse:
        try:
            with httpx.Client(
                base_url=self.base_url,
                timeout=self.timeout_seconds,
                transport=self.transport,
            ) as client:
                response = client.post(
                    "/internal/v1/vision/analyses",
                    data={"request_id": str(request_id), "question": question},
                    files={"image": ("upload", image, content_type)},
                )
                response.raise_for_status()
                result = VisionAnalysisResponse.model_validate(response.json())
        except httpx.TimeoutException as error:
            raise DiagnosisWorkflowError(
                "VISION_SERVICE_TIMEOUT", "Image analysis timed out.", 504
            ) from error
        except httpx.HTTPStatusError as error:
            upstream = _validated_upstream_error(error.response, request_id)
            if upstream is not None:
                raise DiagnosisWorkflowError(
                    upstream.error.code,
                    upstream.error.message,
                    error.response.status_code
                    if error.response.status_code in {502, 503, 504}
                    else 502,
                ) from error
            raise DiagnosisWorkflowError(
                "VISION_SERVICE_UNAVAILABLE",
                "Image analysis is temporarily unavailable.",
                503,
            ) from error
        except (httpx.HTTPError, ValueError) as error:
            raise DiagnosisWorkflowError(
                "VISION_SERVICE_UNAVAILABLE",
                "Image analysis is temporarily unavailable.",
                503,
            ) from error
        if result.request_id != request_id:
            raise DiagnosisWorkflowError(
                "VISION_INVALID_RESPONSE", "Image analysis returned an invalid result.", 502
            )
        return result

    def is_ready(self) -> bool:
        return _service_ready(
            self.base_url, self.timeout_seconds, self.transport
        )


class RetrievalServiceClient:
    def __init__(
        self,
        base_url: str,
        timeout_seconds: float,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.timeout_seconds = timeout_seconds
        self.transport = transport

    def search(
        self, request: RetrievalSearchRequest
    ) -> RetrievalSearchResponse:
        try:
            with httpx.Client(
                base_url=self.base_url,
                timeout=self.timeout_seconds,
                transport=self.transport,
            ) as client:
                response = client.post(
                    "/internal/v1/retrieval/searches",
                    json=request.model_dump(mode="json"),
                )
                response.raise_for_status()
                result = RetrievalSearchResponse.model_validate(response.json())
        except httpx.TimeoutException as error:
            raise DiagnosisWorkflowError(
                "RETRIEVAL_SERVICE_TIMEOUT", "Support search timed out.", 504
            ) from error
        except httpx.HTTPStatusError as error:
            upstream = _validated_upstream_error(error.response, request.request_id)
            if upstream is not None:
                raise DiagnosisWorkflowError(
                    upstream.error.code,
                    upstream.error.message,
                    error.response.status_code
                    if error.response.status_code in {502, 503, 504}
                    else 502,
                ) from error
            raise DiagnosisWorkflowError(
                "RETRIEVAL_SERVICE_UNAVAILABLE",
                "Support search is temporarily unavailable.",
                503,
            ) from error
        except httpx.HTTPError as error:
            raise DiagnosisWorkflowError(
                "RETRIEVAL_SERVICE_UNAVAILABLE",
                "Support search is temporarily unavailable.",
                503,
            ) from error
        except ValueError as error:
            raise DiagnosisWorkflowError(
                "RETRIEVAL_INVALID_RESPONSE",
                "Support search returned an invalid result.",
                502,
            ) from error
        if result.request_id != request.request_id:
            raise DiagnosisWorkflowError(
                "RETRIEVAL_INVALID_RESPONSE",
                "Support search returned an invalid result.",
                502,
            )
        return result

    def is_ready(self) -> bool:
        return _service_ready(
            self.base_url, self.timeout_seconds, self.transport
        )


def _service_ready(
    base_url: str,
    timeout_seconds: float,
    transport: httpx.BaseTransport | None,
) -> bool:
    try:
        with httpx.Client(
            base_url=base_url, timeout=min(timeout_seconds, 3.0), transport=transport
        ) as client:
            response = client.get("/health/ready")
        return response.status_code == 200
    except httpx.HTTPError:
        return False


def _validated_upstream_error(
    response: httpx.Response, request_id: UUID
) -> ErrorEnvelope | None:
    try:
        error = ErrorEnvelope.model_validate(response.json())
    except (ValueError, TypeError):
        return None
    return error if error.error.request_id == request_id else None


def build_workflow(
    vision_client: VisionServiceClient,
    retrieval_client: RetrievalServiceClient,
    answer_provider: AnswerProvider,
):
    def analyze_node(state: DiagnosisState) -> dict:
        vision = vision_client.analyze(
            request_id=state["request_id"],
            question=state["question"],
            image=state["image"],
            content_type=state["content_type"],
        )
        return {"vision": vision}

    def next_after_vision(
        state: DiagnosisState,
    ) -> Literal["retrieve", "answer"]:
        vision = state["vision"]
        has_clue = bool(
            vision.device.brand
            or vision.device.model
            or vision.device.category
            or vision.observed_text
            or vision.error_codes
        )
        if vision.result_status == "unrecognized" and not has_clue:
            return "answer"
        return "retrieve"

    def retrieve_node(state: DiagnosisState) -> dict:
        vision = state["vision"]
        details = []
        if vision.error_codes:
            details.append("error codes " + ", ".join(vision.error_codes))
        elif vision.observed_text:
            details.append("visible text " + ", ".join(vision.observed_text[:5]))
        if vision.device.category:
            details.append(vision.device.category)
        query = state["question"]
        if details:
            query = f"{query} {' '.join(details)}"
        request = RetrievalSearchRequest(
            request_id=state["request_id"],
            query=query[:1000],
            manufacturer=vision.device.brand,
            model=vision.device.model,
            limit=5,
        )
        try:
            retrieval = retrieval_client.search(request)
            return {"retrieval": retrieval}
        except DiagnosisWorkflowError as error:
            # Keep image understanding usable when web search is temporarily
            # down or its free-tier quota is exhausted. The answer node will
            # return a clarification result and never invent repair steps.
            return {
                "retrieval": RetrievalSearchResponse(
                    request_id=state["request_id"], sources=[]
                ),
                "warnings": [
                    f"Support search is unavailable: {error.message} No repair steps were generated."
                ],
            }

    def answer_node(state: DiagnosisState) -> dict:
        vision = state["vision"]
        retrieval = state.get(
            "retrieval",
            RetrievalSearchResponse(request_id=state["request_id"], sources=[]),
        )
        if not retrieval.sources:
            if vision.result_status == "unrecognized":
                answer = (
                    "I couldn't identify the device from this image. Please send a "
                    "clearer photo of its label or share its make and model."
                )
            else:
                answer = (
                    "I couldn't find verified support information for this request. "
                    "Please share the device's make and model or a clearer photo of its label."
                )
            result = DiagnosisResult(
                request_id=state["request_id"],
                session_id=state["session_id"],
                status="needs_clarification",
                answer=answer,
                citations=[],
                warnings=_unique_warnings(
                    vision.warnings
                    + state.get("warnings", [])
                    + ["No verified support sources were found; no repair steps were generated."]
                ),
            )
            return {"result": result}

        try:
            draft = answer_provider.synthesize(
                question=state["question"], vision=vision, retrieval=retrieval
            )
        except AnswerProviderError as error:
            # Preserve the useful vision and search results if text generation
            # hits a provider outage or quota. Returning citations without
            # synthesized repair advice is safer than failing the whole request.
            result = DiagnosisResult(
                request_id=state["request_id"],
                session_id=state["session_id"],
                status="needs_clarification",
                answer=(
                    "I found support references, but couldn't prepare a verified "
                    "step-by-step answer right now. Review the sources and confirm "
                    "they match your exact device model."
                ),
                citations=retrieval.sources,
                warnings=_unique_warnings(
                    vision.warnings
                    + state.get("warnings", [])
                    + [f"Answer generation is unavailable: {error.message} No repair steps were generated."]
                ),
            )
            return {"result": result}

        cited_ids = set(draft.cited_source_ids)
        citations = [source for source in retrieval.sources if source.source_id in cited_ids]
        unsafe_procedure = bool(
            _HAZARD_TERMS.search(draft.answer)
            and _REPAIR_ACTIONS.search(draft.answer)
        )
        if unsafe_procedure:
            status = "needs_clarification"
            answer = (
                "This may involve hazardous internal repairs. Stop and contact a "
                "qualified technician; I can't guide you through that work."
            )
        elif not citations:
            status = "needs_clarification"
            answer = (
                "I found support references but could not prepare an answer tied to "
                "those sources. Please confirm the device's exact make and model."
            )
        else:
            status = "needs_clarification" if draft.needs_clarification else "completed"
            answer = draft.answer
        result = DiagnosisResult(
            request_id=state["request_id"],
            session_id=state["session_id"],
            status=status,
            answer=answer,
            citations=citations,
            warnings=_unique_warnings(
                vision.warnings
                + state.get("warnings", [])
                + draft.warnings
                + (["Potentially hazardous repair instructions were blocked."] if unsafe_procedure else [])
            ),
        )
        return {"result": result}

    graph = StateGraph(DiagnosisState)
    graph.add_node("analyze_image", analyze_node)
    graph.add_node("retrieve_support", retrieve_node)
    graph.add_node("synthesize_answer", answer_node)
    graph.add_edge(START, "analyze_image")
    graph.add_conditional_edges(
        "analyze_image",
        next_after_vision,
        {"retrieve": "retrieve_support", "answer": "synthesize_answer"},
    )
    graph.add_edge("retrieve_support", "synthesize_answer")
    graph.add_edge("synthesize_answer", END)
    return graph.compile()


def _unique_warnings(warnings: list[str]) -> list[str]:
    unique = list(dict.fromkeys(warning for warning in warnings if warning.strip()))
    return unique[:30]


def create_default_workflow():
    service_settings = ServiceSettings()
    from answer_providers import create_answer_provider

    answer_settings = AnswerSettings.from_env()
    return (
        build_workflow(
            VisionServiceClient(
                service_settings.vision_url, service_settings.timeout_seconds
            ),
            RetrievalServiceClient(
                service_settings.retrieval_url, service_settings.timeout_seconds
            ),
            create_answer_provider(answer_settings),
        ),
        service_settings,
        answer_settings,
    )
