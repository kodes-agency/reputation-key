---
status: accepted
date: 2026-07-16
---

# 0030 — Identifier-only domain events and outbox payloads

Cross-context domain events, durable outbox rows, and consumer job payloads must carry **identifiers and stable facts only**. They must not carry review text, reviewer identity, reply bodies, free-text notes, or other source/PII content. Consumers re-load protected content through owning-context lookup ports when authorized.

This ADR records the contract already assumed by the outbox adapter, event schema registry, threat model, and Google access disclosure. It closes the documentation gap that left “ADR 0030” referenced without a file (BQR-1.4).

## Context

- Durable delivery (transactional outbox → BullMQ → consumers) can retain payloads longer than the Google raw-content TTL and may be copied into logs, DLQs, and support exports.
- Google source content and AI processing boundaries are governed by [ADR 0031](0031-google-source-content-and-ai-processing-boundary.md). Events must not become a second ungoverned copy of that content.
- Implementation strips known content keys at outbox insert time (`src/shared/outbox/event-adapter.ts`) and registers identifier-only Zod schemas for relay/dispatch validation.

Historical note: PRE17C planning text once reserved “ADR 0030” for OpenTelemetry vendor decoupling. That work is **not** this decision. Observability vendor independence remains an implementation concern of the shared `trace` / OTLP helpers; service objectives live in [ADR 0038](0038-beta-service-objectives-and-recovery.md).

## Decision

1. **Identifier-only payloads.** Domain events and outbox rows may include:
   - branded IDs (review, property, organization, reply, inbox item, connection, …);
   - enums and stable codes (status, platform, error class);
   - timestamps and non-content scalars (counts, ratings as numeric facts when already public to the consumer’s need);
   - correlation / trace identifiers.
2. **Forbidden content.** Payloads must not include:
   - review text / snippet / body fields;
   - reviewer display name or profile photo URL;
   - reply text, rejection free text, note text;
   - OAuth tokens, encrypted secrets, or raw provider webhook bodies.
3. **Strip at the durable boundary.** Before insert into `outbox_events`, adapters remove a denylist of content field names (and must not re-introduce them). Prefer tightening toward allowlist schemas at insert over time (expand → switch); denylist + Zod validation at relay remains the current expand-phase control.
4. **Consumers re-fetch.** Outbox consumers and projections that need display text call the owning context’s repository/public API under normal authorization. They never treat the event payload as a content cache.
5. **Telemetry and health.** Operational metrics and traces that mention reviews or outbox work remain identifier-only (counts, ages, statuses)—no content strings.

## Consequences

- Event constructors and schema registrations must not grow content fields without an explicit superseding ADR.
- Inbox, metric, activity, and notification projections must use lookup ports for any text they store denormalized under a separate retention policy.
- Security reviews treat content-in-event as a P0 leak class (see threat model “Review text in outbox events”).
- BQR-2/BQR-3 may replace the denylist with insert-time allowlist schemas and finish raw-content lifecycle without changing this decision.

## Alternatives considered

- **Full payload events for convenience.** Rejected: multiplies Google source content and PII across Redis, logs, and backups.
- **Encrypt content in events.** Rejected: still duplicates source content and complicates TTL/purge; identifiers + re-fetch are simpler and align with ADR 0031.
