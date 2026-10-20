"""Smoke-check HTTP routing after `docker compose up --build`."""

import json
import os
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
from uuid import uuid4

BASE_URL = os.getenv("SNAPLENS_BASE_URL", "http://localhost:8000").rstrip("/")
TIMEOUT_SECONDS = 5


def get_json(url: str) -> tuple[int, dict[str, object]]:
    with urlopen(url, timeout=TIMEOUT_SECONDS) as response:
        return response.status, json.loads(response.read())


def post_json(
    url: str, body: dict[str, object], request_id: str
) -> tuple[int, dict[str, object]]:
    request = Request(
        url,
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json", "X-Request-ID": request_id},
        method="POST",
    )
    with urlopen(request, timeout=TIMEOUT_SECONDS) as response:
        return response.status, json.loads(response.read())


def main() -> int:
    try:
        for path in ("/health/live", "/health/ready"):
            status, health = get_json(f"{BASE_URL}{path}")
            if status != 200 or health.get("status") != "ok":
                raise RuntimeError(f"Gateway health check failed at {path}: {health}")

        request_id = str(uuid4())
        session_id = str(uuid4())
        status, result = post_json(
            f"{BASE_URL}/v1/diagnoses",
            {
                "question": "Smoke check: what does this error code mean?",
                "session_id": session_id,
            },
            request_id,
        )
        if status != 202:
            raise RuntimeError(f"Expected HTTP 202, received {status}: {result}")
        if (
            result.get("status") != "accepted"
            or result.get("session_id") != session_id
            or result.get("request_id") != request_id
        ):
            raise RuntimeError(f"Unexpected diagnosis acknowledgement: {result}")
        if "not implemented yet" not in str(result.get("message", "")):
            raise RuntimeError("Expected an explicit placeholder acknowledgement")

        print("Gateway health checks passed.")
        print("Gateway-to-Orchestrator HTTP request passed.")
        print(f"Request ID: {request_id}")
        print(f"Session ID: {session_id}")
        print("The response is a scaffold acknowledgement, not a diagnosis.")
        return 0
    except (HTTPError, URLError, TimeoutError, RuntimeError, ValueError) as exc:
        print(f"SnapLens Compose smoke check failed: {exc}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
