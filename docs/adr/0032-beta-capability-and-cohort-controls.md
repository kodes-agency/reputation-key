---
status: proposed
---

# 0032 — Beta capability and cohort controls

A server-side `BetaCapabilities` policy decides whether a user, organization, property, route, command, event consumer, and scheduled job may use a capability. This replaces hidden-navigation gating with an auditable, fail-closed decision point that the UI, API, workers, and schedulers share.

## Decision

Capabilities are categorized into three sets:

1. **Core** — always on for authenticated users in allowlisted organizations: `identity.invite`, `property.create`, `property.connect_gbp`, `property.publish_reply`, `portal.read`.
2. **Non-core** — off by default, allowlistable per organization: `identity.register`, `team.use`, `goal.use`, `badge.use`, `leaderboard.use`, `ai.analyze`, `ai.generate_reply`, `ai.detect_trends`.
3. **Blocked** — always off, cannot be allowlisted: `gbp.reply.auto_publish`, `gbp.ai.cross_property_summary`, `gbp.review_solicitation_gamification`, `notification.send_email`, `portal.write`, `portal.upload`.

The decision function consumes authenticated user, organization, property, environment cohort, and operator overrides. It returns a typed `CapabilityDecision` with a stable reason code (`capability_on`, `capability_off`, `capability_blocked`, `capability_not_core`, `capability_missing_org`, `capability_suspended`).

Mutations and external side effects fail closed: unknown capability, missing policy, unsupported region, unavailable policy store, or suspended organization all deny.

Emergency kill switches (`BETA_CAPABILITIES_OFF` env var) stop new effects immediately while preserving canonical data. Queued jobs re-check capability before side-effect execution so a kill switch affects already-enqueued work.

## Implementation

- `src/shared/auth/beta-capabilities.ts` — decision function, capability registry
- `BETA_ALLOWLIST_ORGS` / `BETA_SUSPENDED_ORGS` — operator-controlled env vars
- `assertGlobalCapability()` — throws `BetaCapabilityError` on deny
- Registration route (`/register`) checks `identity.register` before rendering

## Considered options

- **Feature flags only.** Rejected — flags don't enforce at the data/event/worker level.
- **Role-based gating.** Rejected — roles describe who, not what's enabled in the beta cohort.
- **Per-tenant database table.** Deferred — env vars suffice for internal beta; a table is warranted at external beta scale.
