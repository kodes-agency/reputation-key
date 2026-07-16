---
status: accepted
---

# 0032 — Beta capability and cohort controls

A server-side `BetaCapabilities` policy decides whether a user, organization, property, route, command, event consumer, and scheduled job may use a capability. This replaces hidden-navigation gating with an auditable, fail-closed decision point that the UI, API, workers, and schedulers share.

## Decision

Capabilities are categorized into three sets (aligned with [BQR master plan §4](../product-readiness-program-2026-07/beta-quality-remediation-2026-07/master-plan.md) and BQR-0/BQR-4 code):

1. **Core** — on by default for authenticated users (subject to global kill switch / suspension):
   - `identity.invite`
   - `property.create`, `property.connect_gbp`, `property.publish_reply`
   - `review.use`, `inbox.use`, `dashboard.use`, `staff.use`, `integration.use`
   - `activity.use`, `notification.in_app`, `metric.internal`
2. **Non-core** — off by default, allowlistable per organization:
   - `identity.register`, `organization.create`
   - `team.use`, `goal.use`, `badge.use`, `leaderboard.use`
   - `portal.read` (**not** core — BQR-0 removed portal from core; portal/guest stay dark)
   - `ai.analyze`, `ai.generate_reply`, `ai.detect_trends`
3. **Blocked** — always off, cannot be allowlisted:
   - `gbp.reply.auto_publish`, `gbp.ai.cross_property_summary`, `gbp.review_solicitation_gamification`
   - `notification.send_email`, `portal.write`, `portal.upload`

The decision function consumes authenticated user, organization, property, environment cohort, and operator overrides. It returns a typed `CapabilityDecision` with a stable reason code.

Mutations and external side effects fail closed: unknown capability, missing policy, unsupported region, unavailable policy store, or suspended organization all deny.

Emergency kill switches (`BETA_CAPABILITIES_OFF` env var) stop new effects immediately while preserving canonical data. Queued jobs re-check capability before side-effect execution so a kill switch affects already-enqueued work.

**Supersedes** any prior listing of `portal.read` as core (including earlier drafts of this ADR).

## Implementation

- `src/shared/auth/beta-capabilities.ts` — decision function, capability registry, core/blocked sets
- `BETA_ALLOWLIST_ORGS` / `BETA_SUSPENDED_ORGS` / `BETA_E2E_GLOBAL_CAPABILITIES` — operator env vars
- `assertBetaCapability()` / `assertGlobalCapability()` — throw on deny
- `requireAuthorized()` maps permission → capability (BQR-4.1)
- Registration route checks `identity.register` before rendering

## Considered options

- **Feature flags only.** Rejected — flags don't enforce at the data/event/worker level.
- **Role-based gating.** Rejected — roles describe who, not what's enabled in the beta cohort.
- **Per-tenant database table.** Deferred — env vars suffice for internal beta; a table is warranted at external beta scale.
