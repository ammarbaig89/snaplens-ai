"""Smoke-check HTTP routing after `docker compose up --build`."""

import base64
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


def post_diagnosis(
    url: str, question: str, session_id: str, request_id: str
) -> tuple[int, dict[str, object]]:
    boundary = f"SnapLens{uuid4().hex}"
    image = base64.b64decode(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/OkcAAAAASUVORK5CYII="
    )
    body = b"".join(
        [
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"question\"\r\n\r\n{question}\r\n".encode(),
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"session_id\"\r\n\r\n{session_id}\r\n".encode(),
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"image\"; filename=\"smoke.png\"\r\nContent-Type: image/png\r\n\r\n".encode(),
            image,
            f"\r\n--{boundary}--\r\n".encode(),
        ]
    )
    request = Request(
        url,
        data=body,
        headers={
            "Content-Type": f"multipart/form-data; boundary={boundary}",
            "X-Request-ID": request_id,
        },
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
        status, result = post_diagnosis(
            f"{BASE_URL}/v1/diagnoses",
            "Smoke check: what does this error code mean?",
            session_id,
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
        if "Image validated" not in str(result.get("message", "")):
            raise RuntimeError("Expected an explicit placeholder acknowledgement")

        print("Gateway health checks passed.")
        print("Gateway-to-Orchestrator image upload passed.")
        print(f"Request ID: {request_id}")
        print(f"Session ID: {session_id}")
        print("The response is a scaffold acknowledgement, not a diagnosis.")
        return 0
    except (HTTPError, URLError, TimeoutError, RuntimeError, ValueError) as exc:
        print(f"SnapLens Compose smoke check failed: {exc}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
