# Contexts — Context

**Audience:** AI agents and developers working in `src/contexts/`.

## Bounded contexts

| Context     | Description                                                          | Key Entities                                        | Layer                    |
| ----------- | -------------------------------------------------------------------- | --------------------------------------------------- | ------------------------ |
| Identity    | Users, organizations, members, invitations                           | User, Organization, Member, Invitation              | Thin (wraps better-auth) |
| Property    | Properties (hotels/restaurants) + GBP location import                | Property                                            | Thick                    |
| Portal      | Review gateway first; secondary link tree, groups, lifecycle         | Portal, Link, LinkCategory, PortalGroup             | Thick                    |
| Guest       | Rating-first Guest Responses, feedback/contact, destination actions  | GuestResponse, Rating, Feedback                     | Thick                    |
| Team        | Quarantined historical data and people migration reconciliation      | Team, TeamMembership                                | Quarantined              |
| Staff       | Participants, Property participation, and Portal attribution         | StaffParticipation, PortalResponsibility            | Thick                    |
| Integration | Organization Google authority, import/discovery, provider I/O        | GoogleConnection, GoogleImportSaga                  | Standard                 |
| Review      | Stable Reviews, source observations/lifecycle, Reply workflow        | Review, ReviewSourceObservation, Reply              | Thick                    |
| AI          | Property-scoped private-beta review analysis, reply drafting, trends | AiOperation, AiReviewAnalysis                       | Standard                 |
| Inbox       | Stable Inbox Items and numbered Handling Cycles                      | InboxItem, HandlingCycle, InboxNote                 | Thick                    |
| Metric      | Governed readings, versions, corrections, availability evidence      | MetricDefinition, MetricReading                     | Standard                 |
| Goal        | Property, Portal Group, and Portal goals over approved measures      | GoalDefinition, GoalEvaluation                      | Thick                    |
| Dashboard   | Read-only aggregation of metrics, reviews, replies                   | —                                                   | Thin (read model)        |
| Activity    | Recent Activity plus restricted Operational Action History           | RecentActivityEntry, OperationalActionHistoryRecord | Thin (subscriber)        |

**Thin contexts** (like Identity) may have empty layer folders — no mappers, no jobs, sparse use cases. That's expected. **Metric context** has no `server/` layer by design — it records readings via event handlers and background jobs, not via server functions called from routes.

Contexts communicate via domain events. Cross-context type imports allowed for events only. For behavior, subscribe to events, define a port, or import from `application/public-api.ts`.

## The four layers

```
contexts/<name>/
  domain/              types.ts, rules.ts, constructors.ts, events.ts, errors.ts
  application/
    ports/             repository and external-service interfaces
    dto/               Zod input/output schemas (forms derive from these)
    use-cases/         one file per user action
  infrastructure/
    repositories/      Drizzle implementations of ports
    mappers/           row ↔ domain (pure)
    adapters/          external service adapters (s3, ai, gbp, ...)
    jobs/              BullMQ job handlers (where applicable)
    event-handlers/    subscribers to domain events (where applicable)
  server/              TanStack Start server functions
```

| Layer             | Contains                                            | Forbidden                                          |
| ----------------- | --------------------------------------------------- | -------------------------------------------------- |
| `domain/`         | Types, pure rules, constructors, events, errors     | `async`, I/O, framework imports, `throw`, mutation |
| `application/`    | Use cases, port interfaces, DTOs                    | DB queries, HTTP code, React, domain rule dupes    |
| `infrastructure/` | Repository impls, mappers, adapters, jobs, handlers | Business rules, HTTP routing, React                |
| `server/`         | TanStack Start server functions                     | Business logic, direct DB access, domain rules     |

Dependencies point inward: `server` → `application` → `domain`. Infrastructure implements application ports.

## Dependency rules

- `domain/` imports nothing outside `domain/` and `shared/domain/`.
- `application/` imports from `domain/`, `shared/domain/`, `shared/events/`.
- `infrastructure/` imports from `domain/`, `application/`, `shared/`, external libs.
- `server/` imports from `application/` (use cases, DTOs), `shared/`, TanStack Start. May import error type guards (`isXxxError`) and error code types from its own `domain/errors.ts` — the only permitted server-to-domain path.
- Cross-context: import from `application/public-api.ts` only. Never from `domain/`, `infrastructure/`, `server/`, or non-public-api `application/`.
- **Exception:** Cross-context adapter implementations (e.g., `integration/infrastructure/adapters/google-review-api.adapter.ts` implementing `review/application/ports/google-review-api.port.ts`) may import the port they implement. The port IS the public interface for adapter contracts.
- **Port completeness (LIF-01):** that exception is the implementer's _only_ legal path, so a port written for foreign adapters must publish every name its own signatures use — re-export the owning context's domain types instead of leaving an implementer unable to spell them. `identity/application/ports/organization-export-contributor.port.ts` and `organization-lifecycle-contributor.port.ts` carry the Organization Export and lifecycle contributor contracts for this reason. Re-export, never copy: `CLASSIFICATIONS_BY_CONTEXT` is declared once in the port and re-exported by `application/organization-export-contract.ts`, because a second copy would drift away from the rule the bundle builder actually enforces.

### Mechanical enforcement (BQC-5.1)

These rules are executable, not aspirational:

- `eslint.config.js` (eslint-plugin-boundaries element types + `boundaries/dependencies`, default disallow) enforces the layer rules above.
- The local ESLint rule `local/cross-context-public-api` (`eslint-rules/cross-context-public-api.mjs`) enforces the cross-context public-api-only rule, including the adapter-port exception.
- `server/` and `routes/` may not import `#/shared/db` — DB access goes through use cases/repositories; health probes use `shared/health/` seams.
- `no-restricted-imports` bans runtime imports (`node:*`, `bullmq`, `ioredis`) in `domain/` and queue/redis clients in `application/`.

Fix violations by routing through public interfaces (extend the owning context's `application/public-api.ts` when the surface is missing), never by suppressing the rules.

#### Fallow suppression registry (BQC-5.8)

`.fallowrc.json` is strict JSON (unknown keys rejected), so the reason/owner/expiry
for every fallow suppression lives here. Every entry names its rule, the config
mechanism, the owner, and the review/expiry point.

**B-class — required controls, wire-or-remove in BQC-6/7** (each also carries a
classification note in its own file header):

| Item                                                                                                                                                                                                                                                                                                                                                                                    | Mechanism                         | Owner   | Reason                                                                                               | Expiry      |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- | ------- | ---------------------------------------------------------------------------------------------------- | ----------- |
| `server/plugins/security-headers.ts`                                                                                                                                                                                                                                                                                                                                                    | `overrides` → `unused-files: off` | BQC-7   | B0.7 control; Nitro plugin discovery inert under TanStack Start (STD-P1-07)                          | BQC-7 close |
| `shared/security/security-headers.ts` `securityHeadersPlugin` + `default`                                                                                                                                                                                                                                                                                                               | `ignoreExports`                   | BQC-7   | One wiring seam kept for the B0.7 plugin                                                             | BQC-7 close |
| `components/hooks/web-vitals.ts` (`setVitalsReporter`)                                                                                                                                                                                                                                                                                                                                  | `ignoreExports`                   | BQC-7   | B2.7 wired in BQC-6.8 (LCP+CLS client collection); reporter seam is the future collector destination | BQC-7 close |
| `shared/observability/telemetry.ts` (`initObservability`)                                                                                                                                                                                                                                                                                                                               | `ignoreExports`                   | BQC-7   | B3.5 telemetry init — wires the same observability destination as the BQC-6.8 vitals reporter        | BQC-7 close |
| `identity/server/auth-settings.org.ts`, `organizations.roles.ts`, `policy-admin.ts`, `property/server/region-move.ts`                                                                                                                                                                                                                                                                   | `overrides` → `unused-files: off` | BQC-6/7 | Catalogued entry points (entry-point-catalogue) awaiting UI wiring                                   | BQC-7 close |
| Catalogued-but-unwired fns in wired files: `listRecentActivityFn` (activity), `stampLastInboxViewFn` (inbox-queries), `assignInboxItemFn` (inbox-item-actions), `createOrganizationFn` (auth-settings.org), `connectGoogle`/`updateConnectionVisibility` (google-connections), `createProperty`/`updateProperty` (properties), `updateGoal` (goals), 6 portal-group fns (portal-groups) | `ignoreExports`                   | BQC-6/7 | Catalogued entry points awaiting UI wiring                                                           | BQC-7 close |

**E-class — public interface retained for a documented consumer:**

| Item                                                                                               | Mechanism                                          | Consumer / reason                                                                                    |
| -------------------------------------------------------------------------------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `contexts/*/application/public-api.ts` event & facts re-exports (34 names, one rule)               | `ignoreExports` glob                               | BQC-5.1 cross-context contract; pinned by `src/shared/architecture/cross-context-public-api.test.ts` |
| `shared/db/schema/auth.ts` `session`/`account`/`verification` (+ existing `member`/`organization`) | `ignoreExports`                                    | better-auth managed schema consumed by the CLI/migrations                                            |
| `shared/bqc/status-schema.ts` exports                                                              | `ignoreExports`                                    | BQC tooling schema consumed by ignored `scripts/bqc/**`                                              |
| `shared/auth/auth-client.ts` hook re-exports (7 inline `fallow-ignore-next-line unused-export`)    | inline                                             | Owner: Identity; documented convenience surface; review at BQC-6 close                               |
| `contexts/*/domain/errors.ts` `isActivityError`/`isMetricError` and peer context guards            | `ignoreExports` glob                               | Error-guard convention pinned by `src/shared/architecture/domain-error-convention.test.ts`           |
| `components/ui/**` (shadcn primitives)                                                             | `overrides` → `unused-exports`/`unused-types: off` | Vendored shadcn/ui surface kept whole for upgrade fidelity — see `src/components/CONTEXT.md`         |

**`unused-types` decision:** trialled `warn` on 2026-07-28 (fallow 3.5.0) after
stripping all 232 no-op `fallow-ignore-next-line unused-type` comments (the rule
was off, so every comment was inert). The trial surfaced **393** warn-tier
findings — the codebase's type surface is deliberately exported contract
(public-api types, DTO types, domain types), so the rule stays **OFF**. The
type-only module exclusions for any future re-enable are pre-declared in
`overrides` (`**/*.dto.ts`, `**/domain/events.ts` → `unused-types: off`).

**`ignoreDependencies` additions:** `shadcn` (component generator CLI driven by
`components.json`, used via `npx` — never imported), `@tailwindcss/typography`
(CSS-only `@plugin` reference in `src/styles.css`).

## Build modules (BQC-5.2)

Each context has exactly one build module (`contexts/<name>/build.ts`) — normally
the wiring seam the composition root calls. Team, Badge, and Leaderboard are the
explicit quarantine/contraction exceptions: their retained build modules are
inert, are not production-composed, and the composition root must not import or
call them. Team retains its inventory boundary; Badge retains only historical
event decoding; Leaderboard retains only the content-free legacy Recognition
inventory/report. Neither Recognition context constructs an application,
repository, server operation, consumer, job, or schedule. Active context builds
construct their repos, adapters, use cases, and event-handler registrations and
return:

```typescript
{
  ;(publicApi, internal)
} // + optional readiness/runtime contributions
```

- `publicApi` — the governed cross-context interface (matches `application/public-api.ts`).
- `internal` — owning-context construction details available only to the composition root while a seam is being wired (`repos`, use cases, command stores). They are not a presentation or cross-context API. Legacy flattened entries are an explicitly staged ARC-03 residual; new and migrated entry points use a named public/runtime interface and delete their flattened alias in the same slice.
- **Readiness/runtime contributions** (optional) — e.g. identity's `refreshPolicyStore`, Review's `registerWorkerJobs`, and Inbox's durable-consumer and response-target reminder-release contributions. They capture owning repositories/use cases and accept only root infrastructure or parsed runtime configuration.
- **Shutdown hook** (optional, none today) — a context with teardown needs would expose it here; no context requires one at present.

Contract for the composition root (`src/composition.ts`):

- It **selects** the enabled modules and **supplies** cross-context adapters and true root scalars (db/redis/logger/clock/env, event bus, queues + job registry, outbox repo, provider endpoints + processing router).
- It must **not** import individual use cases, event handlers, or business rules — those are constructed inside the owning build module.
- A build module may import its **own** context's infrastructure, but never a foreign context's — foreign pieces arrive as injected deps typed via the target's `application/public-api.ts` (or a narrow structural port owned by the consuming context).
- Worker/job/consumer/schedule registration is owned by BQC-3 (`bootstrap.ts` + `worker/`); the composition root supplies the one runtime registry to context-owned registration contributions and never introduces another worker/job registry. Bootstrap invokes those named contributions instead of reaching through to context repositories.
- Build **order is load-bearing** (TDZ): staff → identity → property → portal/guest → integration → review → inbox → metric → goal → dashboard → activity → notification. Team, Badge, and Leaderboard are not composed. Notification may retain narrowly scoped, neutral historical Badge compatibility without constructing Badge. Late-binding closures (e.g. staff's `portalLookup`) are the sanctioned escape hatch, not reordering.

## Use case shape

Steps in order, **including only what applies**:

1. **Authorize** — `can(ctx.role, 'resource.action')`
2. **Load referenced entities** — call repos
3. **Check invariants** — call repos
4. **Build domain object** — smart constructor (throws on invariant violation)
5. **Persist** — call repo
6. **Emit event** — via event bus
7. **Return result**

Most use cases use 4–6 steps. Pure delegation may be just (1) + (5). Query may be just (1) + (5) + (7). Skip steps that don't apply.

Anonymous/public use cases (registration, guest flows) omit `AuthContext` — they take `(input)` not `(input, ctx)`.

### When to skip layers

| Shape                                     | Pattern                                                 |
| ----------------------------------------- | ------------------------------------------------------- |
| Pure third-party delegation, no auth      | Server function calls port directly (sign-in, sign-out) |
| Auth check + delegation, nothing else     | Keep the use case (future logic lands here)             |
| Business rules, validation, events, state | Full use case pattern                                   |

**When in doubt, prefer the use case.**

## Server function pattern

Every server function wraps logic in `tracedHandler()`:

```typescript
export const draftReplyFn = createServerFn({ method: 'POST' })
  .validator(draftReplyDto)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)

        try {
          const { reviewPublicApi } = getContainer()
          return await reviewPublicApi.reply.draft(
            { reviewId: reviewId(data.reviewId), text: data.text },
            ctx,
          )
        } catch (e) {
          if (isReviewError(e))
            throwContextError('ReviewError', e, reviewErrorStatus(e.code))
          throw catchUntagged(e)
        }
      },
      'POST',
      'review.draftReply',
    ),
  )
```

Key points:

- **`tracedHandler`** — wraps handler with ALS request context, correlation ID, named span with timing. From `shared/observability/traced-server-fn`.
- **`resolveTenantContext(headers)`** — resolves org from session, returns `AuthContext`. Has a 5s TTL cache keyed by cookie header to deduplicate concurrent calls during page loads.
- **Named context interface** — server adapters call their owning public API (`reviewPublicApi.reply` in the example). Do not add a new flattened `container.useCases` alias; migrate an existing alias one consumer family at a time.
- **Error mapping** — catch with `isXxxError(e)` type guard, map `_tag`/`code` to HTTP status via `throwContextError()`. Never return `{ success: false }`.
- **`catchUntagged`** — wrap untagged errors (DB, network) that would otherwise be swallowed raw.

## Functional style

- No `class`, no `this`, no `enum`. Factory functions returning records of functions.
- **Exception:** `class ... extends Error` for runtime `instanceof` checks and seroval-compatible error serialization. See `shared/auth/server-errors.ts` (`ServerFunctionError`) and `shared/domain/assert.ts` (`UnreachableError`).
- `readonly` on all domain fields. `ReadonlyArray<T>` in domain.
- Discriminated unions tagged with `_tag`.
- Error handling follows the layer table below (BQR-1.2). Do not invent a third shape.
- `match(...).exhaustive()` from ts-pattern for union dispatch.
- Repositories: `createXxxRepository(db)` returning a record of functions.
- Use cases: `(deps) => async (input, ctx) => Promise<T>`.

## Error pattern (authoritative — BQR-1.2)

Tagged business-error shape: `Error & { _tag: 'XxxError', code: '<reason>', message: string, context?: Record<string, unknown> }`. Tagged identity fields are enumerable so logs and serializers retain them; the real `Error` supplies a stack and interoperable runtime identity.

Factories live in each context's `domain/errors.ts` (`xxxError` + `isXxxError`) and use `createErrorFactory` from `#/shared/domain/errors`. Use `createTaggedError` only when a context needs additional enumerable identity fields, such as Integration's `recoverable` flag. Do not build plain-object business errors.

| Layer                   | Behavior                                                                                                                |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Domain (pure)           | Validation/constructors return `Result<T, XxxError>`. Do **not** throw plain `Error` or untagged `{ code }` objects.    |
| Domain (assert helpers) | May throw **only** a tagged `XxxError` from the context factory. Used for lifecycle transition guards.                  |
| Application             | Throws tagged `XxxError` for business failure. Do not propagate `Result` through async orchestration only for ceremony. |
| Infrastructure          | Translate library failures only when the domain can handle them meaningfully; otherwise preserve the native failure.    |
| Server                  | Catches via `isXxxError(e)`, maps once to safe HTTP with `throwContextError`. Never return `{ success: false }`.        |

Ordinary alternatives that are not failures use explicit outcome unions. Unexpected programmer, configuration, or corrupt-state faults remain sanitized native errors at the delivery boundary.

**Supersedes** older wording that said “all layers throw” or that domain constructors always throw. Shared source of truth for the shape is `src/shared/domain/errors.ts`.

## Events

- Past-tense: `portal.created`, `review.created`. Never commands.
- Live in emitting context's `domain/events.ts`. Master union in `shared/events/events.ts`.
- Subscribers in **receiving** context's `infrastructure/event-handlers/`.
- Handlers are idempotent, don't throw, log via shared logger.
- Durable work → enqueue BullMQ job, don't do inline.
- Event bus wired in `composition.ts`, passed to use cases via deps.

## Permission check pattern

- **Use cases** check `can(role, permission)` as the **primary authorization gate**. Every use case that receives `AuthContext` must perform this check as its first step.
- **Server functions** may optionally add a defense-in-depth `can()` check for routes that don't delegate to a use case (e.g., thin wrappers around third-party APIs). This is not a replacement for the use-case gate.
- **All new use cases** must define a permission. If no existing permission fits, add one to `shared/domain/permissions.ts` and document it in the context's `CONTEXT.md`.

## Testing

| Layer        | Type                                 | Required                |
| ------------ | ------------------------------------ | ----------------------- |
| Domain       | Pure unit, no setup                  | Always, test-first      |
| Use cases    | Unit with in-memory port fakes       | Default test-first      |
| Repositories | Integration vs real Postgres         | Test-after, always test |
| Adapters     | Integration with mocked external API | Test-after              |

Required: 100% domain coverage. Every use case tested for happy + error paths. Every repo has tenant isolation test. Tests colocated: `rules.ts` next to `rules.test.ts`.

## Context acceptance matrix (BQC-5.10)

`src/shared/architecture/context-acceptance-matrix.test.ts` is the executable acceptance checklist for the 17 bounded-context rows (phase doc §5.10). Each row names its verdict (enabled/limited, private beta, or dark), its criterion, and the pin that carries the full proof. Rows already covered by an owning suite (provider-target-selection, atomic-review-outbox, inbox applyOnce, dark-context-matrix, dark-consumer-gating, …) reference those suites instead of duplicating them; the matrix adds new pins only where no suite held the row (Identity grant sole-access scan, Staff no-authZ participation scan, the Metric staff-gamification call-site gap, AI private-beta contract closure, Activity/audit sole-writer scans, the properties-table WATCH register).

Rerun rule: the matrix does not implement missing product behavior. A failing row returns to its owner; after the owner fix lands, the matrix is updated and rerun. Registered gaps (F1–F3, the properties-table WATCH, the `isGamificationViolation` call-site gap, and the two documented ambient-clock exceptions) are listed in the matrix header.
