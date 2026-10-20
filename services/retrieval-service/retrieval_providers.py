"""Provider implementations for support-information retrieval."""

import os
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Protocol
from urllib.parse import urlsplit
from uuid import UUID, uuid4

import httpx
from pydantic import AnyHttpUrl, ValidationError

from shared.contracts import (
    RetrievalSearchRequest,
    RetrievalSearchResponse,
    RetrievedSource,
)


@dataclass(frozen=True)
class RetrievalSettings:
    provider: str = "mock"
    tavily_api_key: str = ""
    tavily_api_base_url: str = "https://api.tavily.com"
    provider_timeout_seconds: float = 15.0
    search_depth: str = "basic"
    max_snippet_chars: int = 4000

    @classmethod
    def from_env(cls) -> "RetrievalSettings":
        settings = cls(
            provider=os.getenv("RETRIEVAL_PROVIDER", "mock").strip().lower(),
            tavily_api_key=os.getenv("TAVILY_API_KEY", "").strip(),
            tavily_api_base_url=os.getenv(
                "TAVILY_API_BASE_URL", "https://api.tavily.com"
            ).strip().rstrip("/"),
            provider_timeout_seconds=float(
                os.getenv("RETRIEVAL_PROVIDER_TIMEOUT_SECONDS", "15")
            ),
            search_depth=os.getenv("TAVILY_SEARCH_DEPTH", "basic").strip().lower(),
            max_snippet_chars=int(os.getenv("RETRIEVAL_MAX_SNIPPET_CHARS", "4000")),
        )
        if settings.provider not in {"mock", "tavily"}:
            raise ValueError("RETRIEVAL_PROVIDER must be either 'mock' or 'tavily'")
        if settings.provider_timeout_seconds <= 0:
            raise ValueError("RETRIEVAL_PROVIDER_TIMEOUT_SECONDS must be positive")
        if settings.search_depth not in {"basic", "advanced", "fast", "ultra-fast"}:
            raise ValueError("TAVILY_SEARCH_DEPTH is not supported")
        if not 1 <= settings.max_snippet_chars <= 4000:
            raise ValueError("RETRIEVAL_MAX_SNIPPET_CHARS must be between 1 and 4000")
        return settings


class RetrievalProviderError(Exception):
    """A provider failure with a safe message for the internal API response."""

    def __init__(self, code: str, message: str, status_code: int) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code


class RetrievalProvider(Protocol):
    async def search(
        self, request: RetrievalSearchRequest
    ) -> RetrievalSearchResponse: ...

    def is_ready(self) -> bool: ...


class MockRetrievalProvider:
    """No-network provider; it never creates fabricated citations."""

    async def search(
        self, request: RetrievalSearchRequest
    ) -> RetrievalSearchResponse:
        return RetrievalSearchResponse(request_id=request.request_id, sources=[])

    def is_ready(self) -> bool:
        return True


class TavilyRetrievalProvider:
    def __init__(
        self,
        settings: RetrievalSettings,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self.settings = settings
        self.transport = transport

    def is_ready(self) -> bool:
        return bool(self.settings.tavily_api_key)

    async def search(
        self, request: RetrievalSearchRequest
    ) -> RetrievalSearchResponse:
        if not self.is_ready():
            raise RetrievalProviderError(
                "RETRIEVAL_PROVIDER_NOT_CONFIGURED",
                "Web retrieval is not configured yet.",
                503,
            )

        query = _build_query(request)
        endpoint = f"{self.settings.tavily_api_base_url}/search"
        payload = {
            "query": query,
            "search_depth": self.settings.search_depth,
            "max_results": request.limit,
            "include_answer": False,
            "include_raw_content": False,
        }
        try:
            async with httpx.AsyncClient(
                timeout=self.settings.provider_timeout_seconds,
                transport=self.transport,
            ) as client:
                response = await client.post(
                    endpoint,
                    headers={
                        "Authorization": f"Bearer {self.settings.tavily_api_key}",
                        "Content-Type": "application/json",
                    },
                    json=payload,
                )
                response.raise_for_status()
                provider_data = response.json()
        except httpx.TimeoutException as error:
            raise RetrievalProviderError(
                "RETRIEVAL_PROVIDER_TIMEOUT",
                "The search provider did not respond in time.",
                504,
            ) from error
        except httpx.HTTPError as error:
            raise RetrievalProviderError(
                "RETRIEVAL_PROVIDER_UNAVAILABLE",
                "The search provider is temporarily unavailable.",
                503,
            ) from error
        except ValueError as error:
            raise RetrievalProviderError(
                "RETRIEVAL_INVALID_PROVIDER_RESPONSE",
                "The search provider returned unreadable results.",
                502,
            ) from error

        try:
            raw_results = provider_data["results"]
            if not isinstance(raw_results, list):
                raise TypeError("results must be a list")
            sources = []
            for result in raw_results[: request.limit]:
                source = _to_source(
                    result,
                    max_snippet_chars=self.settings.max_snippet_chars,
                )
                if source is not None:
                    sources.append(source)
            return RetrievalSearchResponse(
                request_id=request.request_id,
                sources=sources,
            )
        except (KeyError, TypeError, ValidationError, ValueError) as error:
            raise RetrievalProviderError(
                "RETRIEVAL_INVALID_PROVIDER_RESPONSE",
                "The search provider returned invalid results.",
                502,
            ) from error


def _build_query(request: RetrievalSearchRequest) -> str:
    parts = [request.query.strip()]
    device = " ".join(part.strip() for part in (request.manufacturer, request.model) if part and part.strip())
    if device:
        parts.append(device)
    return " ".join(parts)[:400]


def _to_source(result: object, max_snippet_chars: int) -> RetrievedSource | None:
    if not isinstance(result, dict):
        return None
    url = result.get("url")
    title = result.get("title")
    snippet = result.get("content")
    if not isinstance(url, str) or not isinstance(title, str) or not isinstance(snippet, str):
        return None
    url = url.strip()
    title = title.strip()
    snippet = snippet.strip()
    parsed_url = urlsplit(url)
    if parsed_url.scheme not in {"http", "https"} or not parsed_url.netloc:
        return None
    if not title or not snippet:
        return None
    try:
        valid_url = AnyHttpUrl(url)
        score = max(0.0, min(1.0, float(result.get("score", 0.0))))
        return RetrievedSource(
            source_id=uuid4(),
            url=valid_url,
            title=title[:300],
            publisher=(parsed_url.hostname or "")[:200] or None,
            snippet=snippet[:max_snippet_chars],
            score=score,
            retrieved_at=datetime.now(timezone.utc),
        )
    except (TypeError, ValueError, ValidationError):
        return None


def create_provider(settings: RetrievalSettings) -> RetrievalProvider:
    if settings.provider == "mock":
        return MockRetrievalProvider()
    if settings.provider == "tavily":
        return TavilyRetrievalProvider(settings)
    raise ValueError("Unsupported Retrieval provider configuration")
