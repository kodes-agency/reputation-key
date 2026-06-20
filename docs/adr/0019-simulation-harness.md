# ADR 0019: Simulation Harness & Deterministic Backends

## Status

Accepted

## Context

The architecture is event-driven across 16 bounded contexts. Events fan out to
handlers that enqueue BullMQ jobs (notifications, badge evaluation, leaderboard
snapshots, metric aggregation). Testing this reactive pipeline end-to-end
required real Redis + BullMQ + better-auth + Google + Resend — making
deterministic, isolated simulation impossible.

Three blockers:

1. **No in-memory job queue.** The notification tests created an inline `vi.fn()`
   fake per test, but no reusable `Queue`-compatible fake existed. Simulations
   couldn't process jobs without Redis.
2. **Identity and externals were hardcoded.** The container always wired
   `createBetterAuthIdentityAdapter(db)` and `sendInvitationEmail` (Resend).
   No way to swap for in-memory fakes.
3. **Existing test doubles were scattered.** `shared/testing/` had 18+ in-memory
   doubles (identity port, GBP API, Google OAuth, portal/property/inbox repos),
   but no glue factory to wire them into a full container.

## Decision

### 1. In-memory queue (`shared/testing/in-memory-queue.ts`)

A `Queue`-compatible fake that records every `add()` and optionally processes
jobs inline via a late-bound `JobRegistry`. Supports `connectRegistry()` for
post-bootstrap wiring (the registry is created inside the container, after the
queue).

### 2. Container overrides for identity + email

`createContainer` now accepts:

- `identityPort?: IdentityPort` — swap the identity adapter (defaults to
  better-auth). Simulations use `createInMemoryIdentityPort`.
- `email?: typeof sendInvitationEmail` — swap the email sender (defaults to
  Resend). Simulations use `createInMemoryEmailSender`.

### 3. Simulation container factory (`shared/testing/simulation-container.ts`)

`createSimulationContainer({ clock, db, redis, eventBus, identityPort, email })`
builds a container with deterministic backends:

- Real event bus (handlers fire synchronously in-process)
- In-memory queue (jobs recorded + processed inline, no Redis)
- Injectable clock (fast-forward time)
- Optional identity/email overrides
- `advanceClock(ms)` — advances time and re-triggers time-dependent jobs

The factory calls `bootstrap(container)` to register all event + job handlers,
then connects the in-memory queue to the registry for inline processing.

### 4. In-memory email sender (`shared/testing/in-memory-email-sender.ts`)

Records emails as `InvitationEmailParams[]` for assertion.

## Consequences

**Positive:**

- The full reactive pipeline (events → handlers → jobs → side effects) runs
  in-process without Redis/BullMQ/better-auth/Google/Resend.
- `advanceClock(ms)` triggers time-dependent jobs deterministically.
- All existing in-memory doubles (18+) are now reachable from a single factory.

**Negative:**

- The in-memory queue processes jobs synchronously — it doesn't model BullMQ's
  concurrency, retries, or failure modes. For fidelity/chaos testing, a real
  BullMQ + Redis backend is still needed (selectable via the container's `redis`
  override).
- Org creation (`createOrg`/`setActiveOrg`/`updateOrg`) is still bound to
  better-auth in the composition root. Full org-creation simulation requires
  either better-auth or SQL seeding (via `integration-helpers.ts`). Extending
  `IdentityPort` with org writes is deferred.

**What's next:** Track 5 (invariant harness) uses this simulation container to
assert cross-context consistency. Track 6 (scenario DSL) builds realistic
datasets on top of it.
