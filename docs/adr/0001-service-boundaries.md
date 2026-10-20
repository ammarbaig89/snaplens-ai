# ADR 0001: Explicit service boundaries in a monorepo

- **Status:** Accepted for the initial implementation
- **Date:** 2026-10-20

## Context

SnapLens needs distinct API, orchestration, vision, retrieval, and session
responsibilities. It is also a learning project; independently operating many
production deployments before contracts and workflows are proven would make
early changes unnecessarily difficult.

## Decision

Keep each service in its own application directory and container in one
repository. Use versioned HTTP contracts and Docker Compose for local service
discovery. Expose only the API Gateway to the mobile app. Keep provider calls
inside the service that owns them. Do not add a message broker or separate
deployment infrastructure in the first milestone.

## Consequences

- Service ownership and boundaries are visible from the start.
- Local development remains one command and one network.
- HTTP contracts can be validated before provider integrations are added.
- Each service still adds build and operational work, so later extraction or
  scaling should be justified by a real need.
