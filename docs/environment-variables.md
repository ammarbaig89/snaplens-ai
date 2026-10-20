# Environment variables

## Local setup

1. Copy `.env.example` to `.env` at the repository root.
2. Leave `VISION_PROVIDER=mock` for development and automated tests.
3. When you have a Gemini key, put it only in the ignored `.env` file and set
   `VISION_PROVIDER=gemini`.
4. Do not commit `.env`, paste API keys into source files, or put provider keys
   in the mobile app.

The API Gateway, Orchestrator, and Vision Service load the root `.env` file
through `shared/config.py`. Environment variables already provided by the
operating system or container take precedence. Docker Compose also passes the
Vision settings to its container; running Docker is optional for this phase.

## Active now

| Variable | Used by | Meaning | Example / default |
|---|---|---|---|
| `MAX_IMAGE_BYTES` | Gateway, Orchestrator, Vision | Maximum accepted image and request-body basis | `10485760` (10 MiB) |
| `ORCHESTRATOR_URL` | API Gateway | Internal Orchestrator address | `http://diagnostic-orchestrator:8001` |
| `HTTP_TIMEOUT_SECONDS` | API Gateway | Gateway-to-Orchestrator timeout | `5` |
| `VISION_PROVIDER` | Vision Service | Selects `mock` or `gemini` | `mock` |
| `VISION_PROVIDER_TIMEOUT_SECONDS` | Vision Service | Gemini request timeout | `30` |
| `VISION_MAX_OUTPUT_TOKENS` | Vision Service | Bounds Gemini analysis response length | `512` |
| `GEMINI_API_KEY` | Vision Service | Private Google AI Studio key; required only for Gemini mode | empty in template |
| `GEMINI_MODEL` | Vision Service | Gemini model identifier | `gemini-3.8-flash` |
| `GEMINI_API_BASE_URL` | Vision Service | Gemini API base URL | `https://generativelanguage.googleapis.com/v1beta` |

The mock provider is the safe default: it makes no external calls and reports
that it did not analyze the image. Gemini mode is not ready until a key is
configured. Never add a real key to `.env.example` or GitHub.

## Reserved for later phases

These names are included to keep future configuration organized. They are not
all read by application code yet.

| Variable | Planned use | Phase |
|---|---|---|
| `APP_ENV`, `LOG_LEVEL` | Standardized environment and logging configuration | Reliability |
| `VISION_SERVICE_URL` | Orchestrator-to-Vision address | Orchestrator integration |
| `RETRIEVAL_SERVICE_URL` | Orchestrator-to-Retrieval address | Retrieval / Orchestrator |
| `RETRIEVAL_PROVIDER` | Select mock or Tavily provider | Retrieval |
| `TAVILY_API_KEY` | Private Tavily API key | Retrieval |
| `TAVILY_API_BASE_URL` | Tavily API address | Retrieval |
| `ANSWER_PROVIDER` | Answer synthesis provider | Orchestrator |
| `ANSWER_MODEL` | Answer synthesis model | Orchestrator |
| `SESSION_SERVICE_URL` | Orchestrator-to-Session address | Persistence |
| `DATABASE_URL` | PostgreSQL connection | Deferred persistence |
| `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD` | Local PostgreSQL configuration | Deferred persistence / optional Compose |
| `REDIS_URL` | Redis connection | Deferred; add only for a clear need |
| `OTEL_SERVICE_NAME` | OpenTelemetry service identity | Reliability |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | OpenTelemetry collector | Reliability |
| `EXPO_PUBLIC_API_URL` | Public backend address for Expo | Mobile app |

## Secret handling

- `.env` is ignored by Git; `.env.example` is tracked and must contain only
  placeholders or safe local defaults.
- Provider keys belong on the server side. The mobile app must call the API
  Gateway and must never receive Gemini or Tavily credentials.
- For deployment, use the host's secret manager instead of a checked-in file.
- Do not log API keys, uploaded image bytes, or full provider request bodies.
