# API contracts — version 1

The shared Pydantic models live in
`packages/contracts/src/snaplens_contracts/models.py`. Each FastAPI service
publishes its OpenAPI document at `/openapi.json` in its own container.

## Mobile-facing contract

### `POST /v1/diagnoses` — API Gateway

Request JSON:

```json
{
  "question": "What does this error code mean?",
  "session_id": null,
  "image_asset_id": null
}
```

`question` is required (1–2000 characters). `session_id` continues an existing
session when supplied. `image_asset_id` is reserved for the future secure media
upload flow; it is not an uploaded image in this milestone. Clients may send an
`X-Request-ID` UUID; otherwise the Gateway creates one.

Accepted response (`202`):

```json
{
  "request_id": "550e8400-e29b-41d4-a716-446655440000",
  "session_id": "550e8400-e29b-41d4-a716-446655440001",
  "status": "accepted",
  "message": "Request accepted. The diagnostic workflow is not implemented yet."
}
```

Validation errors use FastAPI's `422` response. Gateway upstream errors use:

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
| Gateway | `POST /internal/v1/diagnoses` | Diagnostic Orchestrator | `DiagnosisRequest` → `DiagnosisAccepted` | Start a workflow; forwards body and request ID |
| Orchestrator | `POST /internal/v1/vision/analyses` | Vision Service | `VisionAnalysisRequest` → `VisionAnalysisResponse` | Analyze an uploaded image asset |
| Orchestrator | `POST /internal/v1/retrieval/searches` | Retrieval Service | `RetrievalSearchRequest` → `RetrievalSearchResponse` | Find supporting source material |
| Orchestrator | `POST /internal/v1/sessions` | Session Service | `SessionCreateRequest` → `SessionRecord` | Start a diagnostic session |
| Orchestrator | `GET /internal/v1/sessions/{session_id}` | Session Service | — → `SessionRecord` | Read session metadata |
| Orchestrator | `POST /internal/v1/sessions/{session_id}/messages` | Session Service | `SessionMessageAppend` → `SessionMessageRecord` | Persist a conversation turn |

### Vision

The request contains `request_id` and `image_asset_id`. The asset ID refers to
media accepted by the future upload flow; it is not a filesystem path or
provider URL. The response reports `identified`, `ambiguous`, or `unrecognized`,
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
