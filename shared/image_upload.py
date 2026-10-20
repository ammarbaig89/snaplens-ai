"""Validation helpers for transient SnapLens image uploads."""

from uuid import UUID, uuid4

from starlette.responses import JSONResponse

MAX_IMAGE_BYTES = 10 * 1024 * 1024
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

    media_type = (content_type or "").split(";", 1)[0].strip().lower()
    if media_type not in ALLOWED_IMAGE_TYPES:
        raise ImageUploadError(
            "UNSUPPORTED_IMAGE_TYPE",
            "Upload a JPEG, PNG, or WebP image.",
            415,
        )

    signatures = {
        "image/jpeg": content.startswith(b"\xff\xd8\xff"),
        "image/png": content.startswith(b"\x89PNG\r\n\x1a\n"),
        "image/webp": (
            len(content) >= 12
            and content.startswith(b"RIFF")
            and content[8:12] == b"WEBP"
        ),
    }
    if not signatures[media_type]:
        raise ImageUploadError(
            "IMAGE_CONTENT_MISMATCH",
            "The file contents do not match the declared image type.",
            415,
        )
