# API contracts — version 1

The shared Pydantic models live in
`shared/contracts.py`. Each FastAPI service
publishes its OpenAPI document at `/openapi.json` in its own container.

## Mobile-facing contract

### `POST /v1/diagnoses` — API Gateway

Request `multipart/form-data`:

| Field | Required | Rules |
|---|---|---|
| `question` | Yes | 1–2000 characters |
| `image` | Yes | JPEG, PNG, or WebP; maximum 10 MiB |
| `session_id` | No | UUID to continue a session |

Example fields:

```text
question=What does this error code mean?
image=<image file>
session_id=<optional UUID>
```

The Gateway checks the declared media type, file signature, and size before
forwarding the bytes to the Orchestrator. The Orchestrator repeats the checks.
Requests are capped at 10 MiB plus a small multipart envelope allowance before
the multipart parser processes them. The image is not retained after the
request; FastAPI may use a temporary spooled file while processing an upload.
Clients may send an `X-Request-ID` UUID; otherwise the Gateway creates one.

Accepted response (`202`):

```json
{
  "request_id": "550e8400-e29b-41d4-a716-446655440000",
  "session_id": "550e8400-e29b-41d4-a716-446655440001",
  "status": "accepted",
  "message": "Request accepted. The diagnostic workflow is not implemented yet."
}
```

Invalid fields use FastAPI's `422` response. Invalid or unsupported file types
return `415`; files larger than 10 MiB return `413`. Gateway upstream errors use:

```json
{
  "error": {
    "code": "UPSTREAM_UNAVAILABLE",
    "message": "The diagnostic service is temporarily unavailable.",
    "request_id": "550e8400-e29b-41d4-a716-446655440000"
  }
}
```

The Gateway maps upstream timeouts to `504` and connection or non-success
responses to `502`.

## Internal service contracts

| Caller | Method and path | Receiver | Request → response | Purpose |
|---|---|---|---|---|
| Gateway | `POST /internal/v1/diagnoses` | Diagnostic Orchestrator | Multipart `question`, optional `session_id`, and `image` → `DiagnosisAccepted` | Forward validated image bytes and request ID; no permanent image storage |
| Orchestrator | `POST /internal/v1/vision/analyses` | Vision Service | `VisionAnalysisRequest` → `VisionAnalysisResponse` | Analyze an uploaded image asset |
| Orchestrator | `POST /internal/v1/retrieval/searches` | Retrieval Service | `RetrievalSearchRequest` → `RetrievalSearchResponse` | Find supporting source material |
| Orchestrator | `POST /internal/v1/sessions` | Session Service | `SessionCreateRequest` → `SessionRecord` | Start a diagnostic session |
| Orchestrator | `GET /internal/v1/sessions/{session_id}` | Session Service | — → `SessionRecord` | Read session metadata |
| Orchestrator | `POST /internal/v1/sessions/{session_id}/messages` | Session Service | `SessionMessageAppend` → `SessionMessageRecord` | Persist a conversation turn |

### Vision

The current diagnosis upload sends image bytes transiently through the Gateway
and Orchestrator. The Vision analysis contract still uses `request_id` and
`image_asset_id`; the Orchestrator-to-Vision image handoff will be implemented
with the Vision integration phase. The response reports `identified`, `ambiguous`, or `unrecognized`,
device fields with confidence from 0 to 1, observed text, error codes, and
warnings. Empty identification fields are valid when the image is unclear.

### Retrieval

The request carries a search query, optional manufacturer and model, and a
bounded result limit. Each source has a stable ID, HTTP(S) URL, title, optional
publisher, extracted snippet, retrieval score, and retrieval timestamp. Later
answer synthesis must cite returned source IDs and must not make up references.

### Session history

The create request may include `user_id`; it remains optional until the
authentication decision is implemented. Each appended message has a `request_id`
that the Session Service should enforce as an idempotency key within its session
to avoid duplicate turns on retry. Session and message records include timestamps.

All payloads are strict shared Pydantic models. Extra fields are rejected so
incompatible changes surface during development. Internal contracts are defined
before the Orchestrator starts calling those services; handlers are added in
their respective implementation milestones.
