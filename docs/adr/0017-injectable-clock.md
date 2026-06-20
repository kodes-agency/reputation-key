# ADR 0017: Injectable Clock

## Status

Accepted

## Context

Time-dependent correctness logic — SLA breach flagging, review expiry/purge,
badge streak rollover, leaderboard snapshot timestamps, dashboard time-range
presets — read `new Date()` / `Date.now()` directly in roughly half the stack.

This made the behaviors **untestable in fast-forward**: you cannot advance the
clock to trigger an SLA breach or a review purge without waiting real
wall-clock time. It also blocked deterministic simulation (the broader
testability initiative, see `docs/plan/testability-simulation-plan.md`).

An audit found 191 non-test time-reading sites, but classified them into three
categories:

- **(a) Correctness wall-clock** (~20–30 sites): SLA cutoff, expiry, streaks,
  period boundaries, time-range presets. Must be injectable.
- **(b) Pure date arithmetic**: derives from caller-supplied dates
  (e.g. `priorStartDate = startDate − range`). Fine as-is.
- **(c) Framework/observability timestamps**: request tracing, cache TTL,
  rate-limit windows. May stay on wall-clock.

The time-dependent **BullMQ jobs already injected `clock`** (review
expiry/purge, goal spawn/reconcile, badge evaluation, health-check). The gaps
were: dashboard (no clock at all), leaderboard (no clock), badge repository
internals, and the attention-signals SLA adapter.

## Decision

Introduce a `Clock = () => Date` type (`src/shared/domain/clock.ts`) and thread
it from the composition root into every adapter, repository, and server
function that reads time for domain correctness.

**What changed:**

- `src/shared/domain/clock.ts` — the `Clock` type. The composition root
  constructs one prod instance: `() => new Date()`.
- `timeRangeToDates(preset, now)` — parameterized by an injected `now`.
  Previously read wall-clock internally. Used by all dashboard server
  functions.
- `slaCutoff(now, slaHours)` — pure SLA cutoff function extracted from the
  attention-signals adapter. Previously `new Date(Date.now() − slaHours * …)`.
- `createAttentionSignalsAdapter(db, clock)` — accepts clock; SLA cutoff reads
  `clock()` not `Date.now()`.
- `buildDashboardContext` / `buildLeaderboardContext` — accept `clock`, forward
  to adapters/repos.
- `createBadgeRepository(db, clock)` / `createLeaderboardRepository(db, events,
clock)` — write timestamps read `clock()`.
- All 5 dashboard server functions call `timeRangeToDates(preset, clock())`
  using `getContainer().clock`.
- The container exposes `clock` on its public return object.

**What did NOT change:**

- The time-dependent jobs — they already injected `clock`.
- Framework timestamps (category c) — request tracing, cache TTL, rate-limit
  windows, tenant-cache eviction, JWKS refresh stay on wall-clock.
- DB column defaults (`.defaultNow()`) — server-side insert time is correct for
  prod; simulations set explicit values when backdating.

## Consequences

**Positive:**

- Every SLA/expiry/streak/period rule is now fast-forward unit-testable.
- `timeRangeToDates` and `slaCutoff` are pure functions with deterministic tests.
- The foundation for deterministic simulation (Track 2+) is in place.
- The duplicate `timeRangeToDates` copy in `server/portal-analytics.ts` was
  removed — single source of truth in `application/utils.ts`.

**Negative:**

- Two more parameters on the dashboard/leaderboard build functions and the
  attention/badge/leaderboard repository factories. Acceptable — matches the
  existing convention used by 14 other contexts.
- Framework timestamps remain wall-clock. Full determinism for those paths is
  deferred (only needed if a simulation invariant depends on them).
