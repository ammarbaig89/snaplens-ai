# Environment variables

## Local setup

1. Copy `.env.example` to `.env` at the repository root.
2. Leave `VISION_PROVIDER=mock` for development and automated tests.
3. Put the Gemini key only in the ignored `.env` file. When deliberately
   testing live Vision, set `VISION_PROVIDER=gemini`.
4. Keep `RETRIEVAL_PROVIDER=mock` while developing. Set it to `tavily` only
   when you intentionally want to make a live search request; each diagnosis
   then uses Tavily.
5. Keep `ANSWER_PROVIDER=mock` during routine development. Set it to `gemini`
   when you intentionally want a source-grounded live answer. Gemini answer
   synthesis is skipped when Retrieval returns no sources.
6. Do not commit `.env`, paste API keys into source files, or put provider keys
   in the mobile app.

The API Gateway, Orchestrator, Vision Service, and Retrieval Service load the
root `.env` file through `shared/config.py`. Environment variables already
provided by the operating system or container take precedence. Docker Compose
passes the service settings into containers; running Docker remains optional.

## Active now

| Variable | Used by | Meaning | Example / default |
|---|---|---|---|
| `MAX_IMAGE_BYTES` | Gateway, Orchestrator, Vision | Maximum accepted image and request-body basis | `10485760` (10 MiB) |
| `ORCHESTRATOR_URL` | API Gateway | Internal Orchestrator address | `http://diagnostic-orchestrator:8001` |
| `HTTP_TIMEOUT_SECONDS` | API Gateway | Maximum Gateway-to-Orchestrator request time | `90` |
| `VISION_PROVIDER` | Vision Service | Selects `mock` or `gemini` | `mock` |
| `VISION_PROVIDER_TIMEOUT_SECONDS` | Vision Service | Gemini request timeout | `30` |
| `VISION_MAX_OUTPUT_TOKENS` | Vision Service | Bounds Gemini analysis response length | `512` |
| `GEMINI_API_KEY` | Vision Service | Private Google AI Studio key; required only for Gemini mode | empty in template |
| `GEMINI_MODEL` | Vision Service | Gemini model identifier | `gemini-3.8-flash` |
| `GEMINI_API_BASE_URL` | Vision Service | Gemini API base URL | `https://generativelanguage.googleapis.com/v1beta` |
| `VISION_SERVICE_URL` | Orchestrator | Internal Vision Service address | `http://vision-service:8002` in Compose |
| `RETRIEVAL_SERVICE_URL` | Orchestrator | Internal Retrieval Service address | `http://retrieval-service:8003` in Compose |
| `ORCHESTRATOR_SERVICE_TIMEOUT_SECONDS` | Orchestrator | Per-service call timeout | `35` |
| `RETRIEVAL_PROVIDER` | Retrieval Service | Selects `mock` or `tavily` | `mock` |
| `RETRIEVAL_PROVIDER_TIMEOUT_SECONDS` | Retrieval Service | Maximum wait for a search provider response | `15` |
| `RETRIEVAL_MAX_SNIPPET_CHARS` | Retrieval Service | Maximum characters returned for each source excerpt | `4000` |
| `TAVILY_API_KEY` | Retrieval Service | Private Tavily API key; required only for Tavily mode | empty in template |
| `TAVILY_API_BASE_URL` | Retrieval Service | Tavily API address | `https://api.tavily.com` |
| `TAVILY_SEARCH_DEPTH` | Retrieval Service | Search depth/latency choice | `basic` |
| `ANSWER_PROVIDER` | Orchestrator | Selects `mock` or `gemini` | `mock` |
| `ANSWER_MODEL` | Orchestrator | Gemini answer-synthesis model | `gemini-3.1-flash-lite` |
| `ANSWER_PROVIDER_TIMEOUT_SECONDS` | Orchestrator | Maximum answer provider wait | `30` |
| `ANSWER_MAX_OUTPUT_TOKENS` | Orchestrator | Bounds synthesized answer size | `1024` |
| `EXPO_PUBLIC_API_BASE_URL` | Expo mobile app | Public API Gateway URL included in the client bundle | `http://10.0.2.2:8000` for Android emulator |

The mock Vision provider is the safe default: it makes no external calls and
reports that it did not analyze the image. The Retrieval mock provider is also
offline and returns no sources. The mock answer provider makes no model calls
and asks for clarification instead of inventing repair steps. Gemini and
Tavily modes require their server-side keys and are not ready until configured.
Never add a real key to `.env.example` or GitHub.

The current local `.env` selects Gemini Vision (`gemini-3.8-flash`) and Gemini
answer synthesis (`gemini-3.1-flash-lite`) with the same key, while keeping
Retrieval set to `mock` to preserve Tavily credits. These are local settings
only; `.env.example` contains empty key placeholders and mock defaults.

## Reserved for later phases

These names are included to keep future configuration organized. They are not
all read by application code yet.

| Variable | Planned use | Phase |
|---|---|---|
| `APP_ENV`, `LOG_LEVEL` | Standardized environment and logging configuration | Reliability |
| `SESSION_SERVICE_URL` | Orchestrator-to-Session address | Persistence |
| `DATABASE_URL` | PostgreSQL connection | Deferred persistence |
| `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD` | Local PostgreSQL configuration | Deferred persistence / optional Compose |
| `REDIS_URL` | Redis connection | Deferred; add only for a clear need |
| `OTEL_SERVICE_NAME` | OpenTelemetry service identity | Reliability |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | OpenTelemetry collector | Reliability |

## Secret handling

- `.env` is ignored by Git; `.env.example` is tracked and must contain only
  placeholders or safe local defaults.
- Provider keys belong on the server side. The mobile app must call the API
  Gateway and must never receive Gemini or Tavily credentials.
- For deployment, use the host's secret manager instead of a checked-in file.
- Do not log API keys, uploaded image bytes, or full provider request bodies.
