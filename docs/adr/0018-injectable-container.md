# ADR 0018: Injectable Container

## Status

Accepted

## Context

`createContainer` resolved all infrastructure — `getDb()`, `getRedis()`, `getEnv()`
— from module-level singletons at call time, accepting only `{ enableJobs }` as
an option. The identity adapter was hardcoded (`createBetterAuthIdentityAdapter(db)`),
and the event bus was always freshly created internally.

This blocked two things:

1. **Simulation isolation.** A simulation could not point at an ephemeral DB or
   Redis without env-swapping before process import. Two parallel scenarios
   could not run against different stores in one process.
2. **Deterministic backends.** The event bus and queue could not be swapped for
   in-memory fakes without changing the container internals.

## Decision

Widen `createContainer` to accept optional overrides for every backend:

```ts
createContainer(options?: {
  enableJobs?: boolean
  db?: Database           // default: getDb()
  redis?: Redis           // default: getRedis()
  env?: ReturnType<typeof getEnv>  // default: getEnv()
  clock?: Clock           // default: () => new Date()  (ADR 0017)
  eventBus?: EventBus     // default: createEventBus()
})
```

Every override defaults to the existing module-singleton call. When called with
no options (the prod path via `getContainer()`), behavior is identical to
before.

## Consequences

**Positive:**

- Simulations and tests can inject ephemeral DB/Redis, a controllable clock, and
  a deterministic event bus without env tricks.
- Multiple isolated containers can coexist in one process (parallel scenarios).
- `getContainer()` is unchanged — prod singleton behavior preserved.

**Negative:**

- The options type is larger. Acceptable — each override is optional and
  defaults to the existing singleton.

**What's next:** Track 3 (`createSimulationContainer`) exercises these overrides
with in-memory backends. Track 4 adds `identityPort`, `googleReviewApi`, and
`email` overrides for full external-service swappability.
