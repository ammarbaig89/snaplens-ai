# SnapLens AI — Project Roadmap

This is the project’s shared progress checklist. We work from the top down,
finish one phase, review it, run its relevant checks, and then push the completed
work directly to `main`.

## How to read the checklist

- `[x]` Done and checked in the repository.
- `[ ]` Not done yet.
- **NEXT** is the immediate task to start.
- **DEFERRED** means it remains part of the long-term project, but is not in the
  current work sequence.

The key learning path is:

```text
Photo + question → API Gateway → Orchestrator → Vision → Retrieval → cited answer
```

The database, mobile client, and advanced features join after this first backend
flow is useful end to end.

---

## Phase 0 — Project foundation

**Goal:** Make the repository understandable and establish service boundaries.

- [x] Create the microservices monorepo and separate service folders.
- [x] Define shared request and response contracts.
- [x] Document the architecture and service ownership.
- [x] Add local Python setup instructions and health endpoints.
- [x] Keep Dockerfiles and Compose configuration for later use.

**Done when:** A developer can identify each service’s purpose and run the
backend without needing Docker.

## Phase 1 — Gateway and safe image intake

**Goal:** Accept a photo and question through the single public API entry point.

- [x] Accept a question, optional session ID, and image using multipart form data.
- [x] Allow JPEG, PNG, and WebP; reject mismatched and unsupported file types.
- [x] Limit images to 10 MiB and cap request bodies before multipart parsing.
- [x] Forward the validated upload and request ID to the Orchestrator.
- [x] Recheck the upload in the Orchestrator.
- [x] Avoid retaining the image after request processing.
- [x] Document the API and add validation and handler tests.
- [x] Commit and push this milestone to `main` (`25fa204`).

**Done when:** The Gateway can safely receive a photo and hand it to the
Orchestrator. The current response is still a placeholder, not an AI diagnosis.

## Phase 2 — Vision Service (**IMPLEMENTED; live verification pending key**)

**Goal:** Turn an uploaded image into structured device and error-code details.

- [x] Define the Vision input and output contract for transient image bytes.
- [x] Add a provider interface so Gemini can later be replaced without changing
  the service API.
- [x] Implement a mock provider for reliable tests without network calls or API
  charges.
- [x] Return device category, brand/model when visible, observed text, error
  codes, confidence, and warnings.
- [x] Handle unclear images without guessing; return an explicit ambiguous or
  unrecognized result.
- [x] Add Gemini using a secret loaded from local environment configuration;
  never commit the key.
- [x] Test valid results, unclear images, provider errors, and invalid output.
- [x] Update the API contract and setup instructions.
- [ ] Verify a live Gemini request after the user supplies a key in the local
  ignored `.env` file.

**Done when:** A direct service request returns a validated structured result.
Mock mode and provider failure paths are testable offline; live Gemini is
verified separately after a key is configured. Orchestrator integration is in
Phase 4.

## Phase 3 — Retrieval Service (**NEXT**)

**Goal:** Find useful support information and preserve links for citations.

- [ ] Define a provider-neutral retrieval interface and bounded result contract.
- [ ] Add a mock search provider for tests.
- [ ] Integrate Tavily using a local secret; never commit the key.
- [ ] Build a search query from the question and Vision’s device details.
- [ ] Return source title, URL, excerpt, publisher when available, and retrieval
  time.
- [ ] Add timeouts, safe error responses, and tests for empty or failed searches.
- [ ] Add page and PDF text extraction as a separate, tested capability.

**Done when:** Retrieval returns a small, relevant set of traceable sources and
does not invent source links.

## Phase 4 — Diagnostic Orchestrator and cited answer

**Goal:** Connect Vision and Retrieval into one useful backend diagnosis.

- [ ] Pass the transient image from Orchestrator to Vision.
- [ ] Create the first LangGraph workflow with clear typed state.
- [ ] Send the user question and Vision result to Retrieval.
- [ ] Synthesize a step-by-step answer using retrieved evidence.
- [ ] Return citations that point to the actual retrieved source IDs and URLs.
- [ ] Include uncertainty and ask for clarification when the image or evidence
  is insufficient.
- [ ] Add safety checks to avoid unsupported or hazardous repair instructions.
- [ ] Add integration tests with mocked Vision, Retrieval, and answer providers.

**Done when:** One photo-and-question request returns a useful, cited answer, or
clearly asks the user for more information.

## Phase 5 — First mobile experience

**Goal:** Let a user try the core flow on a phone.

- [ ] Add an Expo / React Native TypeScript app in its own clearly named folder.
- [ ] Configure the API base URL for local development and deployed use.
- [ ] Add camera permissions and image capture or selection.
- [ ] Add a question field and submit the multipart request to the Gateway.
- [ ] Show loading, validation, network error, and retry states.
- [ ] Display the answer, warnings, and tappable source links.
- [ ] Test on at least one Android or iOS device/emulator and document setup.

**Done when:** A user can capture a photo, ask a question, and read the answer
and sources in the app.

## Phase 6 — Conversation history and data storage (**DEFERRED**)

**Goal:** Save conversations only after the single-turn experience is proven.

- [ ] Confirm what user/session data the product should retain and for how long.
- [ ] Define PostgreSQL tables, ownership boundaries, and migrations in the
  Session Service.
- [ ] Persist sessions, messages, diagnosis results, and source references.
- [ ] Add authorization and ownership checks before exposing history.
- [ ] Add Redis only for a demonstrated need such as caching, rate limits, or
  temporary workflow state; PostgreSQL remains the durable source of truth.
- [ ] Add retention and deletion behavior, plus migration and persistence tests.
- [ ] Add conversation history to the mobile app after the API is ready.

**Deferred for now:** No PostgreSQL or Redis implementation is part of the
current image, Vision, Retrieval, and cited-answer work.

## Phase 7 — Voice

**Goal:** Support hands-free questions and spoken answers.

- [ ] Add push-to-talk recording and permission handling in the mobile app.
- [ ] Select and document speech-to-text and text-to-speech providers.
- [ ] Send transcribed questions through the same diagnosis workflow.
- [ ] Read answers aloud with controls to stop, replay, or mute.
- [ ] Handle noisy audio, transcription uncertainty, and provider failures.

**Done when:** A user can ask a question by voice and hear the grounded answer.

## Phase 8 — AR guidance (**RESEARCH FIRST**)

**Goal:** Investigate whether camera overlays add safe, useful value.

- [ ] Choose a limited device/platform prototype and verify Expo/native support.
- [ ] Prototype annotations that point only to confidently identified items.
- [ ] Keep the normal text answer available as an accessible fallback.
- [ ] Evaluate tracking stability, device support, privacy, and safety before
  expanding the feature.

**Done when:** A tested prototype shows that overlays are feasible and helpful;
otherwise document the decision to postpone them.

## Phase 9 — Offline support (**RESEARCH FIRST**)

**Goal:** Offer a limited fallback when the user has no network connection.

- [ ] Identify which help content can be cached legally and safely.
- [ ] Evaluate on-device model options against supported phone hardware.
- [ ] Design clear behavior for stale data and uncertain results.
- [ ] Prototype limited offline guidance without implying live web verification.
- [ ] Measure app size, latency, battery, and answer quality before committing.

**Done when:** A measured prototype demonstrates a useful and honest offline
fallback, or the feature is explicitly postponed with reasons.

## Phase 10 — Reliability, security, and release

**Goal:** Prepare a tested and observable product for deployment.

- [ ] Add structured logs with request IDs and remove secrets and image contents
  from logs.
- [ ] Add OpenTelemetry traces and basic service metrics.
- [ ] Add rate limits, request timeouts, secret management, and dependency checks.
- [ ] Add provider cost and latency reporting and an evaluation dataset.
- [ ] Add CI for formatting/static checks and automated tests.
- [ ] Keep Docker configuration current and validate Compose when Docker is
  available or when container deployment is selected.
- [ ] Choose hosting, configure HTTPS and production secrets, and document
  deployment and rollback.
- [ ] Complete privacy, retention, accessibility, and safety review.

**Docker note:** Docker configuration stays in the repository for later. Running
Docker is deferred; local development and the current implementation do not
depend on it.

---

## Current progress snapshot

- **Completed:** Project foundation, Gateway image intake, and the Vision
  Service with mock and configurable Gemini providers.
- **Current implementation:** Vision can be called directly; the Orchestrator
  does not call it yet, so the public diagnosis endpoint is still a placeholder.
- **Next target:** Retrieval Service and its mock/Tavily provider boundary.
- **Deferred:** PostgreSQL, Redis, Docker execution, mobile app, voice, AR, and
  offline support until their phases.

## Milestone completion routine

For each phase, we will:

1. Explain the goal and service boundary in plain language.
2. Implement the smallest useful slice in dependency order.
3. Add or update the relevant automated tests and documentation.
4. Review the changes and run the phase’s checks.
5. Tick the completed items, commit directly to `main`, and push to GitHub.
6. State the next target and any required account key or user decision.
