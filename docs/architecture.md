# Neon Reputation — Architecture

**Status:** Locked. Changes require explicit decision.
**Audience:** Developers (human and AI) working on this codebase.
**Purpose:** This document is the source of truth for how code is organized, where things live, and how the layers interact. Read it before writing code. Refer back to it when making structural decisions.

For a tight, scannable rules-only version, see `docs/conventions.md`. This document explains the *why*; conventions explains the *what*.

---

## Table of contents

1. [Core principles](#core-principles)
2. [The stack](#the-stack)
3. [Bounded contexts](#bounded-contexts)
4. [The four layers](#the-four-layers)
5. [Folder structure](#folder-structure)
6. [Inside a context](#inside-a-context)
7. [Inside `shared/`](#inside-shared)
8. [Inside `routes/` and `components/`](#inside-routes-and-components)
9. [The composition root](#the-composition-root)
10. [Patterns and conventions](#patterns-and-conventions)
11. [Functional style rules](#functional-style-rules)
12. [Tenant isolation](#tenant-isolation)
13. [Events and cross-context communication](#events-and-cross-context-communication)
14. [Background jobs](#background-jobs)
15. [Error handling](#error-handling)
16. [Testing strategy](#testing-strategy)
17. [Dependency rules](#dependency-rules)
18. [Naming conventions](#naming-conventions)
19. [Where does this code go? — Decision guide](#where-does-this-code-go--decision-guide)
20. [Anti-patterns to avoid](#anti-patterns-to-avoid)
21. [Living document](#living-document)

---

## Core principles

These principles drive every architectural decision. When in doubt, return to these.

1. **Bounded contexts before layers.** Code belongs to a business concept (portal, review, metric) before it belongs to a technical layer. Group by what the code is *about*, not what it *is*.

2. **Pure core, effectful edges.** Domain logic is pure functions of their inputs. Effects (I/O, async, throws) happen only at the boundaries.

3. **Dependencies point inward.** Presentation depends on application; application depends on domain; infrastructure implements ports defined by application. Domain depends on nothing.

4. **Tenancy is non-negotiable.** Every repository method takes `organizationId` as a mandatory parameter. There is no "get by ID" without a tenant. The type system enforces it.

5. **Functional style, pragmatic at edges.** No classes, immutability by default, `Result` types in the domain, explicit dependencies via factory functions. We use `async/await` and throws at the application boundary because pure-async-Result chains are unergonomic in TypeScript.

6. **Tests come from structure.** The architecture is designed so domain code is trivially testable, use cases are testable with in-memory port implementations, and integration tests verify infrastructure. If something is hard to test, the architecture is wrong.

7. **Explicit over implicit.** No DI containers, no auto-wiring, no decorators, no metadata-driven framework magic. Dependencies are passed as function arguments. The wiring is in `composition.ts`, visible.

8. **Conventional, not clever.** Choose boring, well-documented patterns over clever abstractions. AI assistance and team onboarding both benefit from familiarity.

---

## The stack

| Concern | Tool | Notes |
|---|---|---|
| Meta-framework | TanStack Start | SSR, routing, server functions in one |
| Hosting | Railway | API + worker + Redis in one project |
| Database | Neon (Pro) | Postgres, branching per environment, PITR |
| Auth | better-auth | Organization plugin, Drizzle adapter, DB-backed sessions |
| ORM | Drizzle | Postgres driver, schemas per context |
| Background jobs | BullMQ | Redis-backed, repeatable jobs replace cron |
| Cache + rate limit | Redis (Railway managed) | Same instance as BullMQ |
| Storage | Cloudflare R2 | S3-compatible, no egress fees |
| Email | Resend | Transactional + digests |
| Push notifications | Firebase Cloud Messaging | Critical reviews only |
| AI | Anthropic | Behind an adapter |
| Image processing | sharp | Runs in worker |
| Pattern matching | ts-pattern | For discriminated unions |
| Result types | neverthrow | Domain-layer error handling |
| Validation | Zod | At HTTP boundaries (server function inputs) |

---

## Bounded contexts

The application is divided into bounded contexts. Each owns its data, its rules, its events, and its public API. Contexts communicate through domain events, never through direct internal imports.

| Context | Owns | Notes |
|---|---|---|
| `identity` | Users, organizations, members, invitations, roles, permissions | Wraps better-auth |
| `property` | Properties (locations) | The org unit everything else lives under |
| `team` | Teams within properties | Optional middle layer for staff |
| `staff` | Staff assignments to properties/teams | Determines property access |
| `portal` | Portals, link trees, themes, hero images, QR codes | The core product object |
| `guest` | Public scan/rate/feedback flows, anonymous sessions, anti-gating compliance | Entirely public-facing |
| `review` | Reviews, replies, platform adapters (GBP, etc.) | Sync from external sources |
| `metric` | Metric definitions, readings, aggregations, materialized views | High-write, high-read |
| `gamification` | Goals, badges, leaderboards | Computed from metrics |
| `notification` | Notifications across channels (in-app, email, push), preferences | Subscribes to many events |
| `ai` | AI provider port, sentiment, reply drafting, priority scoring, trend detection, usage quotas | Behind an adapter |
| `audit` | Audit logs of significant actions | Subscribes to events from all contexts |

**Rule:** A context can import another context's *types* and *events* (these are the public API). A context **cannot** import another context's use cases, repositories, or internal domain functions.

If you find yourself wanting to import another context's use case, the right move is one of:
- Subscribe to an event the other context emits
- Define an interface in your own context's `application/ports/` and have the other context provide an implementation
- Reconsider whether the boundary is in the right place

---

## The four layers

Every context has the same four layers, in dependency order from innermost to outermost.

### 1. Domain (`domain/`)

The pure core. Knows nothing about databases, HTTP, frameworks, or the outside world.

**Contains:**
- Type definitions for entities (`Portal`, `Review`, `Metric`)
- Pure business rules (`validateSlug`, `canCreatePortals`, `shouldRouteToFeedback`)
- Smart constructors that build domain objects from raw input (`buildPortal`)
- Domain events (`PortalCreated`, `ReviewReceived`)
- Domain errors (`PortalError`, `ReviewError`)

**Forbidden:**
- `async` / `await`
- Database queries
- HTTP concerns
- Framework imports (no React, no TanStack Start, no Drizzle)
- `fetch` or external API calls
- `throw` (errors are returned as `Result`)

**Tests:** Unit tests, no setup, no mocks. Run in milliseconds.

### 2. Application (`application/`)

The orchestration layer. Coordinates domain logic, repository calls, and external services to fulfill use cases.

**Contains:**
- Use cases — one per user action (`createPortal`, `submitFeedback`)
- Port definitions — interfaces for things the context depends on (`PortalRepository`, `PortalStorage`)
- DTOs — Zod schemas for input/output shapes that cross network boundaries

**Forbidden:**
- Direct database queries (use the repository port)
- HTTP-specific code (no TanStack Start server function code)
- React imports
- Reimplementing domain rules (call them, don't duplicate them)

**Tests:** Use cases tested with in-memory port implementations. Run in milliseconds.

### 3. Infrastructure (`infrastructure/`)

The outside-world layer. Where the rubber meets the road.

**Contains:**
- Repository implementations using Drizzle
- Mappers between DB rows and domain types
- External service adapters (GBP API, AI provider, R2, Resend, FCM)
- Background job handlers
- Event handlers that perform side effects

**Forbidden:**
- Business rules (those are in `domain/`)
- HTTP routing (that's in `server/`)
- React

**Tests:** Integration tests against real database (Neon branch) for repositories. Adapter tests with mocked external APIs.

### 4. Server (`server/`)

The presentation layer. TanStack Start server functions exposed to the client.

**Contains:**
- TanStack Start server function definitions
- Input validation using Zod schemas from `application/dto/`
- Middleware composition (auth, tenant, role)
- Error translation (catch tagged errors, return HTTP responses)

**Forbidden:**
- Business logic
- Direct database access
- Domain rule reimplementation

**Tests:** Integration tests covering HTTP behavior — status codes, response shapes, middleware enforcement.

---

## Folder structure

~~~
src/
  contexts/                # Business logic, one folder per bounded context
    identity/
    property/
    team/
    staff/
    portal/
    guest/
    review/
    metric/
    gamification/
    notification/
    ai/
    audit/

  shared/                  # Cross-cutting concerns used by multiple contexts
    domain/                # Brand, ids, Result, ts-pattern re-exports, base errors
    events/                # Event bus implementation, master event union
    db/                    # Drizzle client, schema barrel, migrations
    auth/                  # better-auth config, AuthContext type, middleware
    jobs/                  # BullMQ queue/worker factories, job registry
    cache/                 # Redis client, Cache port + Redis implementation
    rate-limit/            # Rate limit middleware
    observability/         # Logger (pino), Sentry setup
    config/                # Env Zod schema, loader
    fn/                    # Functional utilities (pipe, etc.)
    testing/               # In-memory port fakes, fixture builders, test DB helpers

  routes/                  # TanStack Router file-based routes
    __root.tsx
    index.tsx
    (auth)/
    (dashboard)/
    p/                     # Public guest portal routes

  components/              # React components
    ui/                    # shadcn primitives
    layout/                # Shell, sidebar, navigation
    forms/                 # Reusable form components
    features/              # Feature-specific components, organized by context

  composition.ts           # Wires the dependency graph
  bootstrap.ts             # Registers event/job handlers at startup
  server.ts                # TanStack Start server entry
  worker.ts                # BullMQ worker entry
~~~

### Top-level rules

- `contexts/` holds all business logic. Contexts are first-class citizens.
- `shared/` holds cross-cutting concerns. **High bar for entry: code goes here only when a second context needs it.**
- `routes/` is TanStack Router's territory. Files here are thin — they call server functions and render components.
- `components/` is React UI. No business logic, no direct DB access.
- The four loose files (`composition.ts`, `bootstrap.ts`, `server.ts`, `worker.ts`) are entry points and wiring. Each is small.

---

## Inside a context

Every context follows the same internal structure:

~~~
contexts/portal/
  domain/
    types.ts               # Entity types (Portal, PortalLinkCategory, ...)
    rules.ts               # Pure business rules
    constructors.ts        # Smart constructors (buildPortal, ...)
    events.ts              # Domain events + constructors
    errors.ts              # Tagged error types + constructor

  application/
    ports/                 # Interfaces for dependencies
      portal.repository.ts
      portal-link.repository.ts
      portal-storage.port.ts
    dto/                   # Zod schemas for input/output shapes
      create-portal.dto.ts
      update-portal.dto.ts
      ...
    use-cases/             # One file per user action
      create-portal.ts
      update-portal.ts
      delete-portal.ts
      list-portals.ts
      ...

  infrastructure/
    repositories/          # Drizzle implementations of ports
      portal.repository.ts
      portal-link.repository.ts
    mappers/               # Pure functions: row ↔ domain
      portal.mapper.ts
    storage/               # External storage adapters
      r2-portal-storage.ts
    jobs/                  # Background job handlers for this context
      process-hero-image.job.ts
    event-handlers/        # Subscribers to events (this context's or others')
      ...

  server/                  # TanStack Start server functions
    portals.ts             # Authenticated dashboard functions
    public-portals.ts      # Public guest-facing functions
~~~

### Rules within a context

- One file per use case. If a use case is doing two things, split it.
- One repository per aggregate. If a repository has 30 methods, it's two repositories.
- Mappers are pure and live in `infrastructure/mappers/`. The domain never sees row shapes.
- Public and authenticated server functions live in separate files. The trust boundary should be visible.

---

## Inside `shared/`

`shared/` holds cross-cutting concerns. Each subfolder is a focused concern.

### `shared/domain/`

Pure types and utilities used across contexts.

- `brand.ts` — Branded type utility
- `ids.ts` — `OrganizationId`, `UserId` (genuinely shared IDs)
- `result.ts` — Re-exports from neverthrow (`Result`, `ok`, `err`, `ResultAsync`)
- `pattern.ts` — Re-exports from ts-pattern (`match`, `P`)
- `errors.ts` — Base error shape conventions
- `clock.ts` — `Clock` port for testable time

### `shared/events/`

The event bus and the master event type.

- `event-bus.ts` — In-process event bus (`EventBus` interface + implementation)
- `events.ts` — Master `DomainEvent` union (re-exports each context's event types)

### `shared/db/`

Database infrastructure.

- `client.ts` — Drizzle client factory
- `schema/` — One file per context (`portal.schema.ts`, `review.schema.ts`, ...) plus an `index.ts` barrel
- `migrations/` — Drizzle-generated SQL

**Note:** Schemas live in `shared/db/` (not in each context) because the Drizzle schema barrel must be a single module. Migrations need to see all tables together.

### `shared/auth/`

- `auth.ts` — better-auth configuration
- `context.ts` — `AuthContext` type
- `middleware.ts` — `authMiddleware`, `tenantMiddleware`, `roleGuard(minRole)`

### `shared/jobs/`

- `queue.ts` — BullMQ queue factory
- `worker.ts` — BullMQ worker factory
- `registry.ts` — Job name → handler registration

### `shared/cache/`

- `redis.ts` — Redis client factory (shared with BullMQ)
- `cache.port.ts` — `Cache` interface
- `redis-cache.ts` — Redis implementation

### `shared/rate-limit/`

- `middleware.ts` — Rate limit middleware using Redis

### `shared/observability/`

- `logger.ts` — pino structured logger
- `errors.ts` — Sentry setup

### `shared/config/`

- `env.ts` — Zod-validated environment variable schema and loader

### `shared/fn/`

Functional utilities not in neverthrow or ts-pattern. Often empty; add only as needed.

### `shared/testing/`

Test infrastructure used across contexts.

- `in-memory-repos/` — Patterns for in-memory implementations of common ports
- `fixtures.ts` — Domain object builders (`buildTestPortal`, `buildTestAuthContext`)
- `db.ts` — Helpers for setting up Neon test branches

---

## Inside `routes/` and `components/`

### `routes/`

TanStack Router file-based routing. Each file corresponds to a URL path.

**A route file contains:**
- Route configuration (path, search params Zod schema, loader)
- The page component
- Form/action wiring that calls server functions

**A route file does not contain:**
- Business logic
- Direct database queries
- Domain rules
- Anything you'd want to unit test in isolation

Layouts use TanStack Router's pathless route convention `(name)/` for grouping without affecting URLs.

### `components/`

React components organized by purpose.

~~~
components/
  ui/              # shadcn primitives (Button, Input, Dialog, ...)
  layout/          # Shell, sidebar, header, navigation
  forms/           # Reusable form components
  features/
    portal/        # Portal-specific UI components
    review/
    inbox/
    dashboard/
    ...
~~~

**A component file contains:**
- React component definition, hooks, JSX, styles
- Component-local state and effects

**A component file does not contain:**
- Business logic
- Direct server function calls (those happen in routes or dedicated data hooks)
- Domain rules

---

## The composition root

`composition.ts` is the only place where the full dependency graph is wired together.

**Pattern:** A factory function that takes environment configuration and returns a `Container` — a record holding the database client, event bus, repositories, adapters, and all use cases.

The container is built once at startup. Both `server.ts` and `worker.ts` build it and use it.

**Why this matters:**
- No DI framework, no decorators, no auto-wiring
- All dependencies visible in one file
- Easy to substitute parts in tests (build a test container with in-memory repos)
- Easy to trace what depends on what (read top to bottom)

**`bootstrap.ts`** is a separate file that takes the built container and registers event handlers and job handlers. Keeping registration separate from construction makes both easier to understand.

---

## Patterns and conventions

### Use cases as factory functions

Every use case follows this exact shape:

~~~ts
type Deps = { ... };
type Ctx = AuthContext;

export const someUseCase = (deps: Deps) =>
  async (input: SomeInput, ctx: Ctx): Promise<Result> => {
    // 1. Authorize (call domain rule)
    // 2. Validate referenced entities exist (call repos)
    // 3. Check uniqueness/business invariants (call repos)
    // 4. Build domain object (smart constructor, returns Result, throw on err)
    // 5. Persist (call repo)
    // 6. Emit event
    // 7. Return result
  };
~~~

The six steps may not all apply to every use case, but they happen in this order when present. This consistency makes use cases instantly readable.

### Repositories as records of functions

~~~ts
type SomeRepository = Readonly<{
  findById: (orgId: OrganizationId, id: SomeId) => Promise<Something | null>;
  insert: (orgId: OrganizationId, entity: Something) => Promise<void>;
  // ...
}>;

export const createSomeRepository = (db: Database): SomeRepository => ({
  findById: async (orgId, id) => { /* Drizzle query */ },
  insert: async (orgId, entity) => { /* Drizzle insert */ },
});
~~~

No classes. Records of functions returned by factories. The factory closes over the database client. This is a fully functional pattern (a record of functions over closed-over immutable dependency).

### Ports as interfaces in `application/`

Ports are TypeScript types defining capability contracts. The implementation lives in `infrastructure/`. The use case depends only on the type.

This is what makes use cases testable without a database: pass an in-memory implementation of the port instead of the Drizzle one.

### Mappers as pure functions

~~~ts
export const portalFromRow = (row: PortalRow): Portal => ({ ... });
export const portalToRow = (portal: Portal): PortalRow => ({ ... });
~~~

One per direction. Lives in `infrastructure/mappers/`. The only place in the code where both row and domain shapes are visible at once.

### Domain events as discriminated unions

~~~ts
export type PortalCreated = Readonly<{
  _tag: 'portal.created';
  portalId: PortalId;
  organizationId: OrganizationId;
  occurredAt: Date;
  // ...
}>;

export const portalCreated = (args: Omit<PortalCreated, '_tag'>): PortalCreated => ({
  _tag: 'portal.created', ...args,
});
~~~

The constructor is the only way to build the event, ensuring `_tag` is always correct. Subscribers pattern-match on `_tag` for type-safe dispatch.

### Tagged errors

~~~ts
export type PortalError = Readonly<{
  _tag: 'PortalError';
  code: 'forbidden' | 'slug_taken' | 'invalid_theme' | '...';
  message: string;
  context?: Readonly<Record<string, unknown>>;
}>;

export const portalError = (code: '...', message: string, context?: '...'): PortalError => ({ ... });
~~~

Errors are plain objects, not class instances. The `_tag` distinguishes error types globally. The `code` distinguishes reasons within a type. Both are pattern-matched exhaustively.

---

## Functional style rules

### What is locked

- **No classes.** Anywhere. Use factory functions returning records.
- **No `this`.** Functions don't bind `this`.
- **No inheritance.** No `extends` (except for built-in `Error` subclasses, which we avoid by using tagged objects instead).
- **`readonly` everywhere applicable.** Domain types use `readonly` on every field. Arrays are `ReadonlyArray<T>`.
- **Immutable updates.** Never mutate; produce new values.
- **Discriminated unions over enums.** Use string literal unions (`'foo' | 'bar'`), not TypeScript `enum`.
- **`Result` in domain.** Domain functions that can fail return `Result<T, E>` from neverthrow.
- **Throw at application boundary.** Use cases throw tagged errors. Server functions catch them and translate to HTTP.
- **`ts-pattern` for union dispatch.** Use `match(...).exhaustive()` whenever handling discriminated unions.

### What is pragmatic

- **`async/await` is allowed in application and infrastructure layers.** No requirement to use `ResultAsync` chains for orchestration.
- **Closures over mutable state are allowed in infrastructure** (event bus subscriber map, BullMQ connection, etc.) — the mutation is hidden behind a pure interface.
- **React hooks are not purified.** React's effectful model is accepted as-is.
- **Tests are imperative.** Vitest's `describe`/`it` style is fine.

### What is forbidden

- `class` declarations (except React error boundaries if absolutely necessary)
- `enum` declarations (use union types)
- Mutation of function parameters
- Implicit any
- `// @ts-ignore` without a comment explaining why
- `as` casts to any type that isn't a branded ID (use Zod parsing or `Result` for type-safe conversion)

---

## Tenant isolation

Tenancy is the most important architectural invariant. Get this wrong and the product is broken.

### The rules

1. **Every business table has `organization_id` as a non-null column.** Even when it could be derived through joins. This makes filtering trivial and makes accidental cross-tenant queries impossible.

2. **Every repository method takes `organizationId` as the first parameter.** No exceptions. The TypeScript signature enforces it.

3. **Every repository query filters by `organization_id`.** Use the helper `baseWhere(orgId)` (in `shared/db/`) which enforces this pattern.

4. **Soft-deleted rows are filtered too.** `baseWhere` adds `AND deleted_at IS NULL` for tables that support soft delete.

5. **The `tenantMiddleware` resolves `organizationId` from the better-auth session and attaches it to the `AuthContext` passed to use cases.** Use cases never read the org from anywhere else.

6. **Public guest-facing routes resolve `organizationId` from the URL slug** (e.g., `/p/{orgSlug}/{portalSlug}`) and validate the portal exists and is active. They use a different middleware pipeline.

7. **Cross-tenant queries are explicitly tested.** Every repository has an integration test that creates two organizations, queries with the wrong org ID, and asserts no leakage.

### What this rules out

- Ambient tenant context (e.g., AsyncLocalStorage). Too easy to forget.
- Inferring tenant from the entity ID alone. Always pass it explicitly.
- "Helper" methods that omit `organizationId`. Every method requires it.

---

## Events and cross-context communication

Contexts communicate through domain events, never through direct internal imports.

### How it works

1. A use case in context A emits a domain event after persisting a change.
2. The event flows through the in-process event bus (`shared/events/event-bus.ts`).
3. Handlers in context B (or anywhere) subscribed to that event run as side effects.

### Rules

- **Events are facts, named in the past tense.** `portal.created`, `review.received`, `goal.achieved`. Not commands.
- **Events live in their owning context's `domain/events.ts`.** The context that emits them owns them.
- **The master `DomainEvent` union is in `shared/events/events.ts`.** It's a re-export of all contexts' event types.
- **Subscribers live in the *receiving* context's `infrastructure/event-handlers/`.** The receiver decides what to do with the event.
- **Handlers should be idempotent.** Retries are possible.
- **Handlers should not throw.** Failures are logged, not propagated to the emitter.
- **Cross-context type imports are allowed for events.** Context B can import `PortalCreated` type from context A. It cannot import context A's use cases or repositories.

### When to use jobs instead of events

- **Events** are for in-process side effects within the current request lifecycle. Synchronous emission, asynchronous handler execution.
- **Jobs (BullMQ)** are for durable, retryable work that needs to survive process restarts or run on a schedule.

A common pattern: an event handler enqueues a job. Example: `review.received` event → handler enqueues `analyze-sentiment` job → worker runs the AI call.

---

## Background jobs

BullMQ + Redis. Long-lived worker process on Railway.

### Patterns

- **Job handlers live in their context's `infrastructure/jobs/`.**
- **Job registration happens in `bootstrap.ts`** at worker startup.
- **Repeatable jobs replace cron.** BullMQ's repeat options handle scheduling.
- **Every job is idempotent.** Use a deterministic job ID where appropriate.
- **Every job has a retry policy.** Exponential backoff, max attempts, dead-letter queue.
- **Long-running work should be split into smaller jobs.** Don't have one job that runs for an hour; have one job that enqueues many smaller jobs.

### Per-tenant fairness

For high-volume jobs (review sync), implement per-organization queues or use BullMQ's job grouping features so one large tenant doesn't starve smaller ones.

---

## Error handling

### Layered approach

- **Domain layer:** Returns `Result<T, DomainError>`. Never throws.
- **Application layer (use cases):** Calls domain functions, unwraps `Result`, throws tagged error on failure. Awaits async operations normally.
- **Infrastructure layer:** Catches library errors (Drizzle, external APIs) and either translates them to tagged errors or lets them bubble.
- **Server function layer:** Catches tagged errors using `ts-pattern` matching on `_tag` and `code`, translates to HTTP responses.

### Error translation pattern

~~~ts
const errorToHttp = (e: PortalError) =>
  match(e.code)
    .with('forbidden', () => ({ status: 403, body: '...' }))
    .with('not_found', () => ({ status: 404, body: '...' }))
    .with('slug_taken', () => ({ status: 409, body: '...' }))
    .otherwise(() => ({ status: 400, body: '...' }))
    .exhaustive();
~~~

The `.exhaustive()` ensures the compiler tells us when a new error code is added.

### What never to do

- Don't throw plain `Error` objects in domain or application code. Always tagged errors.
- Don't catch and swallow errors silently. Either handle them meaningfully or let them propagate.
- Don't use error messages as control flow. Match on `_tag` and `code`.

---

## Testing strategy

Tests are colocated with the code they test (`portal.rules.ts` next to `portal.rules.test.ts`).

### By layer

| Layer | Test type | Speed | Test-first? |
|---|---|---|---|
| Domain | Pure unit, no setup | Microseconds | Yes, always |
| Application (use cases) | Unit with in-memory port fakes | Milliseconds | Yes, default |
| Infrastructure (repos) | Integration against real Postgres | Hundreds of ms | Test-after, but always test |
| Infrastructure (adapters) | Integration with mocked external APIs | Hundreds of ms | Test-after |
| Server functions | Integration through TanStack Start | Seconds | Test-after critical paths |
| UI | Sparse, pragmatic | Slow | No |
| End-to-end | Playwright critical flows | Slow | No, after feature is built |

### Required tests for every context

- **Domain:** 100% coverage on rules, constructors, errors. Easy because they're pure.
- **Use cases:** Every use case has tests for happy path and every error path. Use in-memory port implementations.
- **Repositories:** Integration test for each method. Tenant isolation test (cross-org query returns empty).
- **Server functions:** Integration tests for happy path and key error paths (auth, validation, role).

### Test infrastructure

- Vitest as the runner
- Neon branch per integration test suite, or local Docker Postgres in CI
- In-memory port implementations in `shared/testing/in-memory-repos/`
- Fixture builders in `shared/testing/fixtures.ts`

---

## Dependency rules

These rules are enforced by ESLint (or `dependency-cruiser`) and by code review.

### What can import what

~~~
domain/         ← imports nothing outside domain/ and shared/domain/
application/    ← imports from domain/, shared/domain/
infrastructure/ ← imports from domain/, application/, shared/, external libs
server/         ← imports from application/ (use cases, dtos), shared/, TanStack Start
routes/         ← imports from server/ (server functions), components/, shared/
components/     ← imports from other components/, shared/, NEVER from contexts/
shared/         ← imports from itself, external libs only
~~~

### Forbidden imports

- `contexts/A/*` from `contexts/B/*` (use events instead, or cross-context types only)
- `drizzle-orm` from anywhere outside `infrastructure/`
- React from anywhere outside `routes/`, `components/`, and component-related files
- Direct database access from `routes/` or `components/` (always go through use cases via server functions)
- `shared/testing/*` from production code

### Enforcement

ESLint rules in the project root will mechanically prevent these violations. CI fails if rules are broken.

---

## Naming conventions

### Files

- Lowercase with hyphens: `create-portal.ts`, `portal.repository.ts`
- Test files: same name with `.test.ts` suffix, colocated
- One concept per file. If a file is exporting unrelated things, split it.

### Types

- PascalCase: `Portal`, `PortalRepository`, `CreatePortalInput`
- Branded types are PascalCase: `PortalId`, `OrganizationId`
- Discriminated union members include `_tag` field

### Functions

- camelCase: `createPortal`, `validateSlug`
- Factory functions returning use cases or repos: `createXxx` or `xxxFn`
- Smart constructors for domain types: `buildXxx` (e.g., `buildPortal`)
- Smart constructors for events: `xxxYyyy` (past tense, matches event tag, e.g., `portalCreated`)
- Smart constructors for errors: `xxxError` (e.g., `portalError`)

### Domain events

- Format: `<context>.<verb-past-tense>`
- Examples: `portal.created`, `review.received`, `feedback.submitted`, `goal.achieved`

### Job names

- Format: `<verb>-<noun>` or `<verb>-<noun>-<modifier>`
- Examples: `sync-reviews`, `process-hero-image`, `evaluate-badges`, `refresh-daily-metrics`

### Database tables

- snake_case, plural: `portals`, `portal_link_categories`, `metric_readings`
- Always include: `id`, `organization_id`, `created_at`, `updated_at`
- Soft-deletable tables include: `deleted_at`

---

## Where does this code go? — Decision guide

When you're not sure where new code belongs, walk this decision tree:

**Is it a pure function with no I/O, no async, no framework dependency?**
- Specific to one context → `contexts/<context>/domain/rules.ts` (or `constructors.ts`)
- Used by multiple contexts → `shared/domain/`

**Is it a TypeScript type?**
- Specific to one context's entities → `contexts/<context>/domain/types.ts`
- Specific to one context's input/output → `contexts/<context>/application/dto/`
- Cross-context (IDs, base errors) → `shared/domain/`

**Is it an interface/contract for a dependency?**
- It's a port → `contexts/<context>/application/ports/`

**Is it the implementation of a port?**
- Database-backed → `contexts/<context>/infrastructure/repositories/`
- External service → `contexts/<context>/infrastructure/<service-type>/`

**Is it an orchestration of business logic?**
- One user action → `contexts/<context>/application/use-cases/<verb-noun>.ts`

**Is it a server function (TanStack Start)?**
- Authenticated dashboard function → `contexts/<context>/server/<noun>.ts`
- Public guest function → `contexts/<context>/server/public-<noun>.ts`

**Is it a React component?**
- Generic UI primitive → `components/ui/`
- Layout/navigation → `components/layout/`
- Feature-specific → `components/features/<feature>/`

**Is it a URL route?**
- → `routes/` (matching the URL path)

**Is it a background job handler?**
- → `contexts/<context>/infrastructure/jobs/<job-name>.job.ts`

**Is it a subscriber to a domain event?**
- → `contexts/<context>/infrastructure/event-handlers/<event-name>.handler.ts`
- (Goes in the *receiving* context, not the emitting one)

**Is it a Drizzle table definition?**
- → `shared/db/schema/<context>.schema.ts`

**Is it a domain event definition?**
- → `contexts/<context>/domain/events.ts`

**Is it a tagged error definition?**
- → `contexts/<context>/domain/errors.ts`

**Is it test infrastructure (fakes, fixtures)?**
- Used by multiple contexts → `shared/testing/`
- Specific to one context's tests → colocated with the test files

**Is it cross-cutting infrastructure (logger, env, queue setup)?**
- → `shared/<concern>/`

---

## Anti-patterns to avoid

These are mistakes the architecture is designed to prevent. Watch for them.

### "I'll just add this method to the use case"

If you're adding non-orchestration logic to a use case (validation, calculation, transformation), it belongs in `domain/`. Use cases should only orchestrate.

### "This repository needs to know about another context"

If `PortalRepository` is importing types from the review context, you have a cross-context dependency in the wrong place. Either the boundary is wrong, or the relationship belongs in `application/` (a use case calling two repositories).

### "I'll just inline this query in the route"

Routes don't access databases directly. Always go through a server function, which goes through a use case, which goes through a repository.

### "We can skip the port and just import the repo directly"

Skipping the port couples the use case to a specific implementation. Tests become harder. Future swaps become rewrites. Always define the port.

### "I'll add the new event handler in the same context that emits the event"

Event handlers belong in the *receiving* context, not the emitting one. Otherwise contexts become tangled.

### "I'll just put this in `shared/`, we might need it later"

`shared/` has a high bar. Code goes there only after a *second* context needs it. Premature `shared/` placement creates dependencies that don't exist.

### "I'll throw a generic Error here, easier to handle"

Generic errors lose the type information that makes pattern matching exhaustive. Always use tagged errors.

### "I'll cast this with `as` to make TypeScript happy"

`as` casts circumvent the type system. The only acceptable casts are for branded IDs at parsing boundaries. If you're casting elsewhere, the types are wrong.

### "I'll use a class for this, it's cleaner"

We don't use classes. If something feels like it wants to be a class, it's probably a record of functions returned by a factory.

### "I'll skip the test for this, it's obvious"

Domain and use case tests are cheap. The "obvious" code is exactly the code that breaks subtly six months later. Test it.

### "The AI suggested this pattern, let's go with it"

If AI suggests a pattern that doesn't appear in this document or in existing code, ask whether it fits. AI doesn't always know our conventions. This document is the source of truth.

---

## Living document

This architecture is locked, but not frozen. If you discover a genuine reason to change something, the process is:

1. Identify the rule and why it's not working
2. Propose the change explicitly (not just write code that breaks the rule)
3. Update this document before changing the code
4. Apply the change consistently across the codebase

Drift kills architectures. Either follow the rules or change them deliberately.
