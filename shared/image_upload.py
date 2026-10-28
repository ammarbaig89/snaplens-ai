"""Validation helpers for transient SnapLens image uploads."""

import os
from uuid import UUID, uuid4

from starlette.responses import JSONResponse
from shared import config as _config  # noqa: F401

MAX_IMAGE_BYTES = int(os.getenv("MAX_IMAGE_BYTES", str(10 * 1024 * 1024)))
if MAX_IMAGE_BYTES <= 0:
    raise ValueError("MAX_IMAGE_BYTES must be a positive integer")
MAX_REQUEST_BODY_BYTES = MAX_IMAGE_BYTES + 64 * 1024
ALLOWED_IMAGE_TYPES = frozenset({"image/jpeg", "image/png", "image/webp"})


class ImageUploadError(ValueError):
    """An image upload failed a client-facing validation rule."""

    def __init__(self, code: str, message: str, status_code: int) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code


class RequestBodyLimitMiddleware:
    """Reject oversized requests before multipart parsing, including chunked ones."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        headers = dict(scope.get("headers", []))
        request_id = _request_id(headers.get(b"x-request-id"))
        content_length = headers.get(b"content-length")
        if content_length:
            try:
                if int(content_length) > MAX_REQUEST_BODY_BYTES:
                    await self._reject(scope, receive, send, request_id)
                    return
            except ValueError:
                pass

        received = 0

        async def limited_receive():
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > MAX_REQUEST_BODY_BYTES:
                    raise _RequestBodyTooLarge
            return message

        try:
            await self.app(scope, limited_receive, send)
        except _RequestBodyTooLarge:
            await self._reject(scope, receive, send, request_id)

    @staticmethod
    async def _reject(scope, receive, send, request_id: UUID) -> None:
        response = JSONResponse(
            status_code=413,
            content={
                "error": {
                    "code": "REQUEST_TOO_LARGE",
                    "message": "The request exceeds the allowed image upload size.",
                    "request_id": str(request_id),
                }
            },
        )
        await response(scope, receive, send)


class _RequestBodyTooLarge(Exception):
    pass


def _request_id(value: bytes | None) -> UUID:
    if value:
        try:
            return UUID(value.decode("ascii"))
        except (UnicodeDecodeError, ValueError):
            pass
    return uuid4()


def validate_image(content_type: str | None, content: bytes) -> None:
    """Check the declared media type, actual file signature, and byte limit."""
    if len(content) > MAX_IMAGE_BYTES:
        raise ImageUploadError(
            "IMAGE_TOO_LARGE",
            f"The image must be no larger than {MAX_IMAGE_BYTES // (1024 * 1024)} MB.",
            413,
        )
    if not content:
        raise ImageUploadError("EMPTY_IMAGE", "The uploaded image is empty.", 422)

    detected_type: str | None = None
    if content.startswith(b"\xff\xd8\xff"):
        detected_type = "image/jpeg"
    elif content.startswith(b"\x89PNG\r\n\x1a\n"):
        detected_type = "image/png"
    elif len(content) >= 12 and content.startswith(b"RIFF") and content[8:12] == b"WEBP":
        detected_type = "image/webp"

    # Require a supported image signature; a client-supplied MIME type alone
    # is not proof that the upload contains an image. If the declared type is
    # generic or incorrect, use the recognized signature as the source of truth.
    if detected_type not in ALLOWED_IMAGE_TYPES:
        raise ImageUploadError(
            "UNSUPPORTED_IMAGE_TYPE",
            "Upload a JPEG, PNG, or WebP image.",
            415,
        )
    return detected_type
