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
  "message": "Image validated. The diagnostic workflow is not implemented yet."
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
| Orchestrator | `POST /internal/v1/vision/analyses` | Vision Service | Multipart `request_id`, optional `question`, and `image` → `VisionAnalysisResponse` | Analyze transient image bytes |
| Orchestrator | `POST /internal/v1/retrieval/searches` | Retrieval Service | `RetrievalSearchRequest` → `RetrievalSearchResponse` | Find supporting source material |
| Orchestrator | `POST /internal/v1/sessions` | Session Service | `SessionCreateRequest` → `SessionRecord` | Start a diagnostic session |
| Orchestrator | `GET /internal/v1/sessions/{session_id}` | Session Service | — → `SessionRecord` | Read session metadata |
| Orchestrator | `POST /internal/v1/sessions/{session_id}/messages` | Session Service | `SessionMessageAppend` → `SessionMessageRecord` | Persist a conversation turn |

### Vision

The Vision Service accepts the same validated image types and size limit as the
Gateway. It receives image bytes transiently; no asset ID, filesystem path, or
provider file URL is required. `request_id` is required and `question` is
optional context for image interpretation. The response reports `identified`,
`ambiguous`, or `unrecognized`, device fields with confidence from 0 to 1,
observed text, error codes, and warnings. Empty identification fields are valid
when the image is unclear. The mock provider is the default and clearly marks
its output as mock data. Gemini can be enabled with environment configuration.

Request `multipart/form-data` fields:

| Field | Required | Rules |
|---|---|---|
| `request_id` | Yes | UUID used to correlate the result and errors |
| `question` | No | Up to 2000 characters of user context |
| `image` | Yes | JPEG, PNG, or WebP; maximum configured image size |

The response uses the shared `VisionAnalysisResponse` model. `device.confidence`
is the provider's estimate, not a calibrated probability.

The Vision Service returns stable error envelopes for unsupported images,
provider timeouts, provider outages, and malformed provider output. Its
`/health/ready` endpoint is not ready when Gemini is selected without an API key.

### Retrieval

`POST /internal/v1/retrieval/searches` accepts JSON matching
`RetrievalSearchRequest`: a request UUID, a 1–1000 character query, optional
manufacturer and model, and a result limit from 1 to 10. The provider query
combines the question with supplied device details and is capped at 400
characters.

The response is `RetrievalSearchResponse`. Each result has a generated source
UUID, validated HTTP(S) URL, title, hostname as publisher, excerpt capped by
`RETRIEVAL_MAX_SNIPPET_CHARS`, provider relevance score clamped to 0–1, and a
UTC retrieval timestamp. Invalid or incomplete links are skipped. The mock
provider returns an empty result list rather than sample citations. Tavily is
enabled with `RETRIEVAL_PROVIDER=tavily` and the server-side `TAVILY_API_KEY`.
The service bounds provider time, result count, and excerpt size and returns a
safe error envelope for missing configuration, timeouts, upstream failures,
and malformed output. Search results include a provider excerpt; page and PDF
extraction is a separate later capability. Answer synthesis must cite only
source IDs and URLs returned by this endpoint.

### Session history

The create request may include `user_id`; it remains optional until the
authentication decision is implemented. Each appended message has a `request_id`
that the Session Service should enforce as an idempotency key within its session
to avoid duplicate turns on retry. Session and message records include timestamps.

All payloads are strict shared Pydantic models. Extra fields are rejected so
incompatible changes surface during development. Internal contracts are defined
before the Orchestrator starts calling those services; handlers are added in
their respective implementation milestones.
