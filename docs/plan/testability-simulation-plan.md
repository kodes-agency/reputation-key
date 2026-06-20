# Testability & Simulation Infrastructure Plan

**Status:** Ready for implementation
**Date:** 2026-06-19
**Type:** Cross-cutting infrastructure initiative (not a product arc phase)
**Source constraints:** Analysis session 2026-06-19 ("simulate multiple managers/admins/staff with reviews, goals, portals, scans to surface errors")

## 1. Goal

Make the entire stack **time-travelable, backend-swappable, and self-verifying** so a simulation can: spin up many orgs/members/roles, generate backdated reviews + goals + portals + scans, fast-forward the clock to trigger SLA/expiry/streak/rollover jobs, and **prove cross-context consistency** — surfacing latent errors that today's in-memory unit tests cannot reach.

End state: `pnpm simulate --scenario=large` builds a realistic multi-tenant dataset against an ephemeral DB, runs the full event+job pipeline, and prints an invariant report. Zero Redis/Postgres/Google/Resend/better-auth required for logic simulations; real backends selectable for fidelity/chaos runs.

## 2. Why now

The architecture emits events and drains BullMQ jobs across 16 contexts, but **nothing checks that reactions are consistent** — errors are inferred only from logs. Compounding this:

- Time-dependent correctness (SLA breach flagging, expiring-review purge, badge streak rollover, leaderboard period transitions, recurring-goal spawning) reads real wall-clock in half the stack and **cannot be tested in fast-forward**.
- Infrastructure (DB/Redis/queue/identity/externals) is resolved from module singletons, so scenarios mutate the shared dev DB and cannot run in parallel.
- A simulation harness is impossible without addressing these; with them addressed, the harness becomes a thin capstone.

Priorities in order: **correctness, testability, cleanliness, speed** (per `plan.md` philosophy). This plan serves the first two.

## 3. Constraints inventory (evidence)

### 3.1 Time — 191 non-test wall-clock sites

Mechanically counted across `src/` (comments/strings stripped). Top clusters:

| Cluster                                                        | Non-test sites | Notes                                                                                                                                          |
| -------------------------------------------------------------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `contexts/dashboard/{application,infrastructure}`              | 84             | Biggest cluster. Mostly date arithmetic off caller-supplied `startDate`; root wall-clock reads are `timeRangeToDates` (2 copies) + SLA adapter |
| `contexts/review/infrastructure`                               | 41             | Expiry/purge jobs + repo timestamps                                                                                                            |
| `contexts/goal/infrastructure`                                 | 38             | Recurring-instance spawn + reconciliation                                                                                                      |
| `bootstrap.ts`                                                 | 10             | Registration/seed flow                                                                                                                         |
| `shared/{rate-limit,auth,cache}`                               | 15             | TTL windows, JWKS cache, tenant cache                                                                                                          |
| `contexts/{notification,leaderboard,badge,...}/infrastructure` | ~40            | Job schedulers, snapshot/reconcile timestamps                                                                                                  |

**Three categories** (not all 191 need an injected clock):

- **(a) Correctness wall-clock** (~20–30 sites) — SLA cutoff, expiry purge, streak day-boundaries, recurring-goal spawn, leaderboard period boundaries, time-range presets. **MUST** receive injected clock.
- **(b) Pure date arithmetic** — e.g. `priorStartDate = startDate - range`. Fine as-is; correct once the root preset function is parameterized by `now`.
- **(c) Framework/observability timestamps** — request tracing, cache TTL, JWKS refresh, rate-limit windows, log lines. Stay on wall-clock for prod; make overridable for full determinism. **Defer** unless a scenario needs it.

**Existing seam:** `composition.ts:128` already constructs `const clock = () => new Date()` and threads it into 14 of 16 `buildXxxContext` calls. Holes: `dashboard` (line 308) and `leaderboard` (line 333) receive no clock; dashboard adapters take only `db`; badge repository uses `new Date()` internally (`badge.repository.ts:37,185`); `evaluate-badge-for-target.ts:192` and `health-check.job.ts:21` already consume injected clock (precedent).

### 3.2 Container — infra resolved from module singletons

`createContainer(options?: { enableJobs?: boolean })` (composition.ts:122) calls `getDb()` / `getRedis()` / `getEnv()` / `getAuth()` directly. Identity adapter hardcoded at line 135 (`createBetterAuthIdentityAdapter(db)`). Google review API built inline at line 228. Email sender bound at line 157. No overrides accepted beyond `enableJobs`.

### 3.3 Identity — reads fully swappable, org writes are not

`IdentityPort` (identity.port.ts) is comprehensive: `signUp`, `createInvitation`, `acceptInvitation`, `updateMemberRole`, `removeMember`, `deleteUser`, plus reads. `createInMemoryIdentityPort` (shared/testing/in-memory-identity-port.ts) **already implements every one of these** + `seedMembers`/`seedInvitations`/`seedOrganizations`.

Gap: org lifecycle (`createOrg`/`setActiveOrg`/`updateOrg`, composition.ts:86–118,145–166) is injected as bare functions bound to `getAuth().api` — not on the port, not swappable. Auth tables are better-auth-CLI-managed only (AGENTS.md) — this plan never proposes raw SQL on auth tables.

### 3.4 Reactive layer — seam already exists

`createEventBus` (shared/events/event-bus.ts:36) is a pure in-process bus, decoupled from BullMQ. Notification tests already use a `createFakeQueue` (notification/infrastructure/event-handlers/test-fixtures.ts:48). The async part is the BullMQ job layer. So a deterministic ↔ fidelity toggle is mostly **promotion + wiring**, not new architecture.

## 4. Architecture decisions (propose ADRs)

| ADR  | Title                                   | Decision                                                                                                                                                                                                                                                                              |
| ---- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0017 | Injectable Clock                        | A `Clock = () => Date` port threaded from the container into every adapter/repo/use-case/job that reads time for domain correctness. Bare `new Date()`/`Date.now()` forbidden in correctness paths. Framework/observability timestamps remain wall-clock.                             |
| 0018 | Injectable Container                    | `createContainer` accepts optional overrides for `db`, `redis`, `env`, `clock`, `eventBus`, `queue`, `cache`, `identityPort`, `googleReviewApi`, `email`. All default to current module singletons → prod behavior unchanged. `getContainer()` remains the cached singleton for prod. |
| 0019 | Simulation Harness & Invariant Checking | A `shared/testing` simulation stack: in-memory backends behind the same ports as prod, a declarative scenario DSL, and post-run invariant checkers that assert cross-context consistency. Server-only; never shipped to client bundles.                                               |

## 5. Tracks (dependency-ordered; each shippable on its own)

Each track ends with a **gate**: concrete checks. No track ends with half-working code. Tracks 1–4 are independent refactors; 5 builds on 1–4; 6 is the capstone. Execute sequentially for safety (1 → 2 → 3 → 4 → 5 → 6), but 2/3/4 may parallelize after 1.

---

### Track 1 — Injectable Clock (ADR 0017)

**Goal.** Every domain-correctness time read comes from an injected `clock`.

**Files.**

- Create: `src/shared/domain/clock.ts` — `export type Clock = () => Date`
- Modify: `src/composition.ts` — thread `clock` into `buildDashboardContext` (line 308) and `buildLeaderboardContext` (line 333)
- Modify: `src/contexts/dashboard/infrastructure/adapters/{review-stats,metric-stats,portal-metrics,attention-signals}.adapter.ts` — accept `clock`, replace `Date.now()` (esp. `attention-signals.adapter.ts:19` SLA cutoff)
- Modify: `src/contexts/dashboard/application/utils.ts` + `src/contexts/dashboard/server/portal-analytics.ts` — `timeRangeToDates(preset, now: Date)` (currently `new Date()` at utils.ts:8 and portal-analytics.ts:39)
- Modify: `src/contexts/dashboard/build.ts` — accept + forward `clock` to adapters
- Modify: `src/contexts/leaderboard/build.ts` — accept `clock`, forward to snapshot/period logic
- Modify: `src/contexts/badge/infrastructure/repositories/badge.repository.ts` — accept `clock`, replace `new Date()` at lines 37, 185 (seed/enablement timestamps)
- Audit + modify time-dependent jobs to consume injected clock (each job already receives a deps object): `review/infrastructure/jobs/{refresh-expiring-reviews,purge-expired-reviews}.job.ts`, `goal/infrastructure/jobs/{spawn-recurring-instances,reconcile-goal-progress}.job.ts`, badge + leaderboard reconcile jobs, `metric/infrastructure/jobs/refresh-materialized-view.job.ts`
- Leave (framework, category c): `shared/observability/trace.ts`, `traced-server-fn.ts`, `shared/cache`, `shared/rate-limit`, `shared/auth/middleware.ts` tenant cache, `pubsub-jwt.verifier.ts` — unless a later track needs them

**Approach.**

1. Add `Clock` type. Reuse the existing `clock = () => new Date()` in composition.ts as the single prod instance.
2. Parameterize the two `timeRangeToDates` copies by `now`; callers (server fns) pass `clock()`.
3. Dashboard adapters: `createAttentionSignalsAdapter(db, clock)` etc.; composition passes `clock`.
4. Thread `clock` into dashboard + leaderboard builds (match the 14 contexts that already do).
5. Jobs: each job handler already takes a deps record — add `clock: Clock` where it reads time, wire from the job-registry bootstrap.
6. Sweep: `search` for `new Date(` / `Date.now(` in `contexts/*/infrastructure` + `contexts/*/application`; for each hit, classify (a/b/c); convert (a), leave (b)/(c) with a one-line `// clock: derived from input` / `// framework timestamp` comment where ambiguous.

**Scope (in).** Category (a) sites only. Dashboard + leaderboard + badge repo + time-dependent jobs.

**Scope (out).** Framework/observability timestamps (category c). DB column `.defaultNow()` (server-side time is correct for inserts; backdating is handled by the seeder setting explicit values). UI components.

**Gate criteria.**

- `pnpm typecheck` + `pnpm test` green.
- New test: `attention-signals` SLA flag flips when a fake clock advances past `slaHours` against the same review rows — proves the cutoff reads injected clock, not wall-clock.
- New test: a leaderboard snapshot's period boundary advances with an injected clock.
- `search` confirms zero bare `new Date()`/`Date.now()` remain in `contexts/*/infrastructure/jobs` correctness paths.
- ADR 0017 written.

**Rough effort.** 3–4 days. Mostly mechanical threading; the classification sweep is the careful part.

---

### Track 2 — Injectable Container (ADR 0018)

**Goal.** `createContainer` accepts backend overrides; prod path unchanged.

**Files.**

- Modify: `src/composition.ts` — widen `createContainer` options type; default every override to the current module-singleton call
- No change: `getContainer()` (line 442) — stays the cached singleton for prod

**Approach.**

```ts
export function createContainer(options?: {
  enableJobs?: boolean
  db?: Database
  redis?: Redis | undefined
  env?: Env
  clock?: Clock
  eventBus?: EventBus
  queue?: Queue
  cache?: Cache
  identityPort?: IdentityPort
  googleReviewApi?: GoogleReviewApiPort
  email?: (args: InviteEmailArgs) => Promise<void>
}) {
  const db = options?.db ?? getDb()
  const redis = options?.redis ?? getRedis()
  const env = options?.env ?? getEnv()
  const clock = options?.clock ?? (() => new Date())
  const eventBus = options?.eventBus ?? createEventBus()
  // ... thread overrides through buildInfrastructure + context builds
}
```

Every `getAuth()` call in `createOrg`/`setActiveOrg`/`updateOrg` (composition.ts:86–166) must route through the chosen identity seam (resolved in Track 4); for now keep them but route via an internal `resolveIdentity()` that an override can replace.

**Scope (in).** Options surface only. No behavior change when called with no options.

**Scope (out).** Changing prod call sites. Removing `getContainer`.

**Gate criteria.**

- `pnpm test` green; existing `getContainer()` consumers unchanged.
- New test: construct two containers in one process with different `clock` values; assert they report independent `now`. Proves no hidden singleton coupling remains.
- New test: container constructed with an injected `eventBus` delivers events only to that bus.
- ADR 0018 written.

**Rough effort.** 1–2 days.

---

### Track 3 — Deterministic Backend Toggle

**Goal.** The reactive layer runs fully in-process with no Redis, deterministically, OR through real BullMQ for fidelity — same interfaces.

**Files.**

- Create: `src/shared/testing/in-memory-job-queue.ts` — promote the `createFakeQueue` pattern from `notification/infrastructure/event-handlers/test-fixtures.ts:48`; option to run handlers inline (synchronous) or queue-and-drain
- Confirm: `src/shared/cache/noop-cache.ts` (exists) — ensure it satisfies `Cache` for sim
- Create: `src/shared/testing/simulation-container.ts` — `createSimulationContainer({ clock, runJobsInline })` that calls `createContainer` with in-memory bus + in-memory queue + noop cache + injected clock
- Modify: job-registry/worker bootstrap so an in-memory queue can register + drain the same handlers (extract handler registration from `src/worker/index.ts` + `bootstrap.ts` into a reusable `registerJobHandlers(registry, container)` so the sim can call it without spinning the BullMQ Worker)

**Scope (in).** Reusable in-memory queue; `createSimulationContainer`; extracted handler registration.

**Scope (out).** Changing the real BullMQ worker path. Running jobs across real concurrency for chaos (defer to a fidelity mode toggle in Track 6).

**Gate criteria.**

- `createSimulationContainer()` builds with no Redis/Postgres connection required for the reactive path (DB still needed for persistence unless Track 6 ephemeral DB is wired).
- Test: emit a `ReviewCreated` event → inbox item + notification job fire inline → no Redis touched.
- Existing notification/metric event-handler tests still pass (they already use fakes; this just standardizes the fake).
- Mark new helpers `@expected-unused` from prod or ensure reachability so the fallow gate passes.

**Rough effort.** 2–3 days.

---

### Track 4 — Swappable Identity + Externals (ADR 0019 part 1)

**Goal.** Full org/member/review/email simulation with zero better-auth / Google / Resend.

**Files.**

- Modify: `src/contexts/identity/application/ports/identity.port.ts` — add `createOrganization`, `updateOrganization`, `setActiveOrganization` is already present; decide: put org writes on the port (preferred) OR keep `createOrg`/`updateOrg` as injectable functions surfaced via container option (Track 2)
- Modify: `src/contexts/identity/infrastructure/adapters/auth-identity.adapter.ts` — implement the new org-write methods against `getAuth().api` (mirrors composition.ts:86–118)
- Modify: `src/shared/testing/in-memory-identity-port.ts` — implement the new org-write methods in-memory (extend the existing `organizations` map; `seedOrganizations` already populates it). Replace `new Date()` at lines 71–72 with an injected clock.
- Create: `src/shared/testing/in-memory-google-review-api.ts` — deterministic fake implementing the same port as `createGoogleReviewApiAdapter`; returns canned/parametrized reviews
- Create: `src/shared/testing/in-memory-email.ts` — records sent emails in an array; implements the shape injected at composition.ts:157
- Audit (Track 0 output): confirm no use-case path calls `getAuth()`/Google/Resend directly bypassing the seams. Flag any direct calls for rerouting.

**Scope (in).** Identity org writes on the port; deterministic externals; container wiring (via Track 2 overrides).

**Scope (out).** Changing better-auth schema/migrations (AGENTS.md forbids — auth stays CLI-managed). Real OAuth token refresh logic.

**Gate criteria.**

- Test: build a container with in-memory identity + in-memory Google review API + in-memory email; create an org, add members with all three roles, run a review sync, accept an invitation — no better-auth/Google/Resend invoked.
- Auth-table rule honored: no new `scripts/migrations/*.sql` touches auth tables; `auth:generate`/`auth:migrate` untouched.
- Import protection: all new files are `*.server.ts` or under `shared/testing/` and must not leak to client bundles — verified by the vite import-protection rules + a dev-server hydration smoke check (CONTEXT.md "Client/Server Boundary").

**Rough effort.** 2–3 days.

---

### Track 5 — Invariant Harness (ADR 0019 part 2) — "see errors"

**Goal.** Post-scenario (and optionally continuous) checkers that prove cross-context consistency and report drift as the surfaced "errors."

**Files.**

- Create: `src/shared/testing/invariants/types.ts` — `InvariantViolation { id, severity, message, evidence }`
- Create: `src/shared/testing/invariants/index.ts` — `runInvariants(container): Promise<InvariantReport>`
- Create one checker per invariant (each a pure function of the container's repos/APIs):
  - `review-created-produces-inbox-item.ts` — every `ReviewCreated` event / review row has exactly one inbox item (no orphans, no dupes)
  - `badge-award-notifies-audience.ts` — every badge award → one notification per audience member (managers + assigned staff)
  - `leaderboard-snapshot-matches-metrics.ts` — snapshot scores recomputable from metric readings within tolerance
  - `sla-flag-matches-data.ts` — reviews older than `now − slaHours` with no published reply are flagged (uses Track 1 clock)
  - `inbox-status-transitions-legal.ts` — every inbox status transition is on the ADR-0004 graph; no stuck/illegal states
  - `no-orphaned-failed-jobs.ts` — queue has no stuck/failed jobs (in-memory queue tracks these; real BullMQ reads `failed` count)

**Scope (in).** The six invariants above; the runner; severity classification (error/warning).

**Scope (out).** Performance invariants (latency p95) — defer. UI rendering invariants — covered by E2E.

**Gate criteria.**

- Test: a deliberately-broken scenario (e.g. delete an inbox item, leaving an orphaned review) → the relevant checker reports a violation.
- Test: a clean scenario → zero violations.
- Each checker has a unit test against an in-memory container.
- The runner prints a human-readable + machine-readable (JSON) report.

**Rough effort.** 3–4 days. The invariants encode real domain rules; this is where subtle bugs get caught.

---

### Track 6 — Scenario DSL + Seed Capstone (C7, C8, C9)

**Goal.** `pnpm simulate` builds a realistic dataset and reports invariants.

**Files.**

- Create: `src/shared/testing/scenario/builder.ts` — declarative world builder:
  ```ts
  buildScenario({
    clock: controlledClock('2026-06-01'),
    orgs: [
      {
        name: 'Acme Hotels',
        managers: 3,
        staff: 12,
        properties: [
          {
            name: 'Acme Downtown',
            portals: 2,
            goals: 2,
            reviews: {
              count: 120,
              overDays: 45,
              negativeRatio: 0.25,
              repliedRatio: 0.4,
              pastSlaRatio: 0.1,
            },
          },
        ],
        scans: { perPortalPerDay: 8, overDays: 45 },
      },
      // ...more orgs
    ],
    runJobs: 'inline', // or 'bullmq' for fidelity
    backends: 'in-memory', // or 'real'
  })
  ```
  Compiles to use-case calls against a `createSimulationContainer`. Reviews/metrics carry explicit timestamps (backdated relative to `clock`) so DB `.defaultNow()` is never the source of truth.
- Create: `src/shared/testing/scenario/time-travel.ts` — `advanceClock(container, days)` that moves the injected clock and triggers the time-dependent jobs (expiry purge, recurring-goal spawn, streak rollover, leaderboard period refresh) — exercises exactly the Track-1-corrected paths
- Create: `scripts/seed.ts` — orchestrator: build ephemeral DB → `buildScenario` → `runInvariants` → print report. Uses real Postgres (per-run schema) for persistence fidelity; or in-memory identity + real business tables.
- Create: `scripts/simulate.ts` (or extend seed.ts) — CLI: `pnpm simulate --scenario=large --backends=real` for fidelity/chaos runs
- Wire ephemeral DB: per-run Postgres schema via `DATABASE_URL` override + `db:push`, OR Docker-compose throwaway instance. Document the recipe.
- Add `package.json` scripts: `simulate`, `seed`

**Scope (in).** Declarative builder; time-travel; seed + simulate CLI; invariant report; ephemeral-DB recipe.

**Scope (out).** UI for scenarios. CI integration of large simulations (defer — add a small smoke scenario to CI first). Chaos/fault-injection beyond running through real BullMQ.

**Gate criteria.**

- `pnpm simulate --scenario=small` produces a multi-org dataset (≥2 orgs, all three roles, properties/portals/goals, backdated reviews positioned across the SLA boundary) and a **clean invariant report**.
- `advanceClock(container, 2 days)` against a scenario with a review 47h old (SLA 48h) → after advance, SLA invariant flags it; expiry purge job removes expired reviews.
- A fidelity run (`--backends=real`) against a real Postgres + Redis succeeds end-to-end.
- Ephemeral DB recipe documented; running twice against a fresh DB yields identical results (idempotent).
- The simulation surfaces at least one previously-unknown inconsistency OR proves consistency (either is a valid gate outcome).

**Rough effort.** 4–5 days.

## 6. Cross-cutting rules honored throughout

- **Auth tables (AGENTS.md):** never raw SQL on `user/session/account/verification/organization/member/invitation`. Org writes go through the port → better-auth adapter in prod; in-memory in sim. `auth:generate`/`auth:migrate` untouched.
- **Client/server boundary (CONTEXT.md):** all new files use Node builtins → live in `scripts/`, `shared/testing/` with `*.server.ts` naming or explicit `import '@tanstack/react-start/server-only'`. Verify with a dev-server hydration smoke after each track.
- **Drizzle filter:** business tables only via `db:generate`/`db:migrate`. No schema changes planned in this initiative (it's pure infra).
- **Fallow gate:** new `shared/testing/*` exports are consumed by tests/sims or marked `@expected-unused`. Run `pnpm exec fallow dead-code --changed-since origin/main` before each commit.
- **ADR updates:** each track updates `CONTEXT.md` "Architecture Decisions" table + writes its ADR before the gate.

## 7. Track dependency graph

```
Track 1 (Clock) ──┬─→ Track 5 (Invariants) ─→ Track 6 (Capstone)
                  │
Track 2 (Container) ─┬─→ Track 3 (Deterministic backend) ─┘
                     └─→ Track 4 (Identity + externals) ──┘
```

- Track 1 first (everything time-dependent depends on it).
- Tracks 2, 3, 4 can parallelize after 1 (different files; coordinate on the container-options surface in 2).
- Track 5 needs 1 (SLA invariant) + 3 (in-memory queue for orphan-job check).
- Track 6 is the integration capstone.

## 8. Rough total effort

| Track                   | Effort                                               |
| ----------------------- | ---------------------------------------------------- |
| 0 Audit                 | 0.5 day                                              |
| 1 Clock                 | 3–4 days                                             |
| 2 Container             | 1–2 days                                             |
| 3 Deterministic backend | 2–3 days                                             |
| 4 Identity + externals  | 2–3 days                                             |
| 5 Invariants            | 3–4 days                                             |
| 6 Capstone              | 4–5 days                                             |
| **Total**               | **~16–22 days** (serial; ~12–15 with 2/3/4 parallel) |

## 9. What this buys beyond simulation

- **Clock injection:** every SLA/expiry/streak/period rule becomes fast-forward unit-testable today, not just for sims. Independently the highest-value change.
- **Container injection:** per-test ephemeral backends; no more shared-dev-DB test interference.
- **Invariant harness:** a permanent regression net for cross-context consistency, usable in CI on a small scenario regardless of simulation use.
- **Identity/external fakes:** identity + review-sync use-cases become fully unit-testable without better-auth/Google.

## 10. Open questions to resolve during implementation

- Org writes: extend `IdentityPort` (cleaner) vs. keep `createOrg` as an injectable function surfaced via container option (smaller diff). Recommend extending the port for symmetry.
- Ephemeral DB strategy: per-run Postgres schema (fast, local) vs. Neon branch (cloud-faithful). Decide in Track 6 based on where sims run (local dev vs. CI).
- Whether category-(c) framework timestamps need injection for full determinism — revisit only if a scenario's invariant depends on them (unlikely).
- Chaos/fault-injection scope: defer a dedicated fault-injection mode (kill mid-job, Redis drop) to a follow-up after the deterministic + fidelity modes land.
