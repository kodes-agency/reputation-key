# BQR-4 — Authoritative Authorization, Privacy, and Context Containment

**Status:** In progress — slice 4.1  
**Depends on:** BQR-1 (architecture rules); selected BQR-2 primitives; BQR-3 complete  
**Unblocks:** BQR-5 (user paths under real auth gates), BQR-7 pilot security evidence  
**Estimate:** 10–16 engineering days

## Outcome

Every enabled production entry point authorizes through a **single `authorize()` seam** (capability + permission + optional property scope). Dark contexts remain fail-closed. In-process review events no longer carry raw reviewer/text PII. ADR 0032/0033 match production posture.

`OUTBOX_DISPATCHER_ENABLED` remains default-off until an explicit BQR-2/6 exit decision.

## Principles

- One capability decision path for web, commands, workers, consumers, schedules (§ master plan).
- Server boundary is the primary enforcement point; use cases may re-assert for defense-in-depth.
- Identifier-only domain events (ADR 0030); reload content by ID when needed.
- No silent portal/guest/goal activation (master plan §4).

## Findings closed by this phase

| Baseline finding                                      | Slice   |
| ----------------------------------------------------- | ------- |
| 2.1 `authorize()` unused in production                | **4.1** |
| 2.3 ADR 0032 `portal.read` still listed as core (doc) | **4.3** |
| 4.1 Domain events carry raw PII                       | **4.2** |
| Residual dual canForContext + assertBetaCapability    | **4.1** |

## PR slices

| Slice       | Outcome                                                                                         | Status          |
| ----------- | ----------------------------------------------------------------------------------------------- | --------------- |
| **BQR-4.1** | Core surface capabilities; `requireAuthorized`; property/inbox/review servers use `authorize()` | **This branch** |
| **BQR-4.2** | Remove `reviewerName`/`reviewText` from `review.created`/`review.updated`; consumers re-fetch   | Pending         |
| **BQR-4.3** | Accept/align ADR 0032 & 0033; architecture tests lock authorize usage on enabled contexts       | Pending         |

## BQR-4.1 scope

### In

- Expand `Capability` with enabled-surface keys (`review.use`, `inbox.use`, …) as **core**.
- `capabilityForPermission()` map for stable permission → capability.
- `requireAuthorized()` throwing helper for server functions (`AuthError` via `throwContextError`).
- Migrate property, inbox, and review server entry points from bare `canForContext` to `requireAuthorized`.
- Unit + architecture tests.

### Out

- Migrating every dark-context server (already assertBetaCapability).
- Full use-case authorize injection (optional later).
- Identifier-only events (4.2).
- Enabling durable outbox dispatcher.

## Exit criteria (full BQR-4)

| Criterion                                                  | Met after 4.1? |
| ---------------------------------------------------------- | -------------- |
| Enabled-context server fns use authorize/requireAuthorized | Partial        |
| Core capabilities match master-plan enabled surfaces       | Yes            |
| In-process review events identifier-only                   | No (4.2)       |
| ADR 0032/0033 match code posture                           | No (4.3)       |
| Dark capabilities remain fail-closed                       | Yes            |
| `OUTBOX_DISPATCHER_ENABLED` default false                  | Yes            |
