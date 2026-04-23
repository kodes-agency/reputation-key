# Neon Reputation — Architecture

**Status:** Locked. Changes require explicit decision.
**Audience:** Developers (human and AI) working on this codebase.
**Purpose:** This document is the source of truth for how code is organized, where things live, and how the layers interact. Read it before writing code. Refer back to it when making structural decisions.

For a tight, scannable rules-only version, see `docs/conventions.md`. This document explains the _why_; conventions explains the _what_. For concrete code examples per file type, see `docs/patterns.md`.

---

## Table of contents

1. [Core principles](#core-principles)
2. [The stack](#the-stack)
3. [Bounded contexts](#bounded-contexts)
4. [The four layers](#the-four-layers)
5. [Layer flexibility — when to use less](#layer-flexibility--when-to-use-less)
6. [Folder structure](#folder-structure)
7. [Inside a context](#inside-a-context)
8. [Inside `shared/`](#inside-shared)
9. [Inside `routes/` and `components/`](#inside-routes-and-components)
10. [Forms](#forms)
11. [The composition root](#the-composition-root)
12. [Patterns and conventions](#patterns-and-conventions)
13. [Functional style rules](#functional-style-rules)
14. [Tenant isolation](#tenant-isolation)
15. [Events and cross-context communication](#events-and-cross-context-communication)
16. [Background jobs](#background-jobs)
17. [Error handling](#error-handling)
18. [Testing strategy](#testing-strategy)
19. [Dependency rules](#dependency-rules)
20. [Naming conventions](#naming-conventions)
21. [Where does this code go? — Decision guide](#where-does-this-code-go--decision-guide)
22. [Anti-patterns to avoid](#anti-patterns-to-avoid)
23. [Living document](#living-document)

---

## Core principles

These principles drive every architectural decision. When in doubt, return to these.

1. **Bounded contexts before layers.** Code belongs to a business concept (portal, review, metric) before it belongs to a technical layer. Group by what the code is _about_, not what it _is_.

2. **Pure core, effectful edges.** Domain logic is pure functions of their inputs. Effects (I/O, async, throws) happen only at the boundaries.

3. **Dependencies point inward.** Presentation depends on application; application depends on domain; infrastructure implements ports defined by application. Domain depends on nothing.

4. **Tenancy is non-negotiable.** Every repository method takes `organizationId` as a mandatory parameter. There is no "get by ID" without a tenant. The type system enforces it.

5. **Functional style, pragmatic at edges.** No classes, immutability by default, `Result` types in the domain, explicit dependencies via factory functions. We use `async/await` and throws at the application boundary because pure-async-Result chains are unergonomic in TypeScript.

6. **Tests come from structure.** The architecture is designed so domain code is trivially testable, use cases are testable with in-memory port implementations, and integration tests verify infrastructure. If something is hard to test, the architecture is wrong.

7. **Explicit over implicit.** No DI containers, no auto-wiring, no decorators, no metadata-driven framework magic. Dependencies are passed as function arguments. The wiring is in `composition.ts`, visible.

8. **Conventional, not clever.** Choose boring, well-documented patterns over clever abstractions. AI assistance and team onboarding both benefit from familiarity.

9. **Proportional layering.** The patterns scale to the operation. A use case with real domain logic uses the full 7-step pattern. A use case that's only an authorization check is a one-liner. An operation with no business logic at all might skip the use case entirely. Ceremony for symmetry is an anti-pattern, not a virtue.

10. **Shared schemas, single source of truth.** The Zod schemas in `application/dto/` are used for both server-side validation (inside server functions) and client-side form validation (inside TanStack Form). Never duplicate the shape.

---

## The stack

| Concern                  | Tool                      | Notes                                                               |
| ------------------------ | ------------------------- | ------------------------------------------------------------------- |
| Meta-framework           | TanStack Start            | SSR, routing, server functions in one                               |
| Hosting                  | Railway                   | API + worker + Redis in one project                                 |
| Database                 | Neon (Pro)                | Postgres, branching per environment, PITR                           |
| Auth                     | better-auth               | Organization plugin, Drizzle adapter, DB-backed sessions            |
| ORM                      | Drizzle                   | Postgres driver, schemas per context                                |
| Background jobs          | BullMQ                    | Redis-backed, repeatable jobs replace cron                          |
| Cache + rate limit       | Redis (Railway managed)   | Same instance as BullMQ                                             |
| Storage                  | Cloudflare R2             | S3-compatible, no egress fees                                       |
| Email                    | Resend                    | Transactional + digests                                             |
| Push notifications       | Firebase Cloud Messaging  | Critical reviews only                                               |
| AI                       | Anthropic                 | Behind an adapter                                                   |
| Image processing         | sharp                     | Runs in worker                                                      |
| Pattern matching         | ts-pattern                | For discriminated unions                                            |
| Result types             | neverthrow                | Domain-layer error handling                                         |
| Validation               | Zod (v4)                  | DTO schemas in `application/dto/`; dual-use for server + forms      |
| Client cache / mutations | TanStack Query            | Wraps server function calls                                         |
| UI primitives            | shadcn/ui                 | Field components: `Field`, `FieldLabel`, `FieldError`, `FieldGroup` |
| Forms                    | TanStack Form + shadcn/ui | Zod schema passed to `validators.onSubmit`; v1 handles Zod natively |

---

## Bounded contexts

The application is divided into bounded contexts. Each owns its data, its rules, its events, and its public API. Contexts communicate through domain events, never through direct internal imports.

| Context        | Owns                                                                                         | Notes                                        |
| -------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------- |
| `identity`     | Users, organizations, members, invitations, roles, permissions                               | Wraps better-auth — a thin context by nature |
| `property`     | Properties (locations)                                                                       | The org unit everything else lives under     |
| `team`         | Teams within properties                                                                      | Optional middle layer for staff              |
| `staff`        | Staff assignments to properties/teams                                                        | Determines property access                   |
| `portal`       | Portals, link trees, themes, hero images, QR codes                                           | The core product object                      |
| `guest`        | Public scan/rate/feedback flows, anonymous sessions, anti-gating compliance                  | Entirely public-facing                       |
| `review`       | Reviews, replies, platform adapters (GBP, etc.)                                              | Sync from external sources                   |
| `metric`       | Metric definitions, readings, aggregations, materialized views                               | High-write, high-read                        |
| `gamification` | Goals, badges, leaderboards                                                                  | Computed from metrics                        |
| `notification` | Notifications across channels (in-app, email, push), preferences                             | Subscribes to many events                    |
| `ai`           | AI provider port, sentiment, reply drafting, priority scoring, trend detection, usage quotas | Behind an adapter                            |
| `audit`        | Audit logs of significant actions                                                            | Subscribes to events from all contexts       |

**Rule:** A context can import another context's _types_ and _events_ (these are the public API). A context **cannot** import another context's use cases, repositories, or internal domain functions.

If you find yourself wanting to import another context's use case, the right move is one of:

- Subscribe to an event the other context emits
- Define an interface in your own context's `application/ports/` and have the other context provide an implementation
- Reconsider whether the boundary is in the right place

### A note on context "thickness"

Contexts vary widely in how much code they contain. Two extremes:

**Thick contexts** (`portal`, `review`, `metric`) own their tables, have their own non-trivial business rules, manage state transitions, and emit several event types. They use the full layered architecture, and every layer earns its place.

**Thin contexts** (`identity`) primarily wrap a third-party library that already provides the domain (better-auth provides users, sessions, organizations, invitations). The four-layer structure still applies, but layers will have less in them. Some operations won't need a use case at all, and some layer folders will be empty.

Don't judge the architecture by its thinnest context. The patterns are right; they just have less work to do when wrapping someone else's well-designed library.

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
- Additional pure-function files when content warrants splitting from `rules.ts` (e.g., `permissions.ts`, `compliance.ts`, `scoring.ts`)

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
- DTOs — Zod schemas for input/output shapes that cross network boundaries **and are reused as form schemas**

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
- Auth/tenant resolution via `resolveTenantContext(headers)` and `roleGuard()` calls at the top of each handler
- Error translation (catch tagged errors, throw `Response`)

**Forbidden:**

- Business logic
- Direct database access
- Domain rule reimplementation

**Tests:** Integration tests covering HTTP behavior — status codes, response shapes, auth enforcement.

### Auth resolution in server functions

Server functions resolve auth context manually at the top of each handler. The pattern is:

```ts
export const someServerFn = createServerFn({ method: 'POST' })
  .inputValidator(SomeSchema)
  .handler(async ({ data }) => {
    const headers = headersFromContext()
    const ctx = await resolveTenantContext(headers)
    // optionally: roleGuard('PropertyManager')(ctx)
    // then call use case or delegate
  })
```

This approach was chosen over TanStack `createMiddleware()` chains because:

- The auth resolution logic is explicit and visible in each handler
- `headersFromContext()` needs to extract from the current request, and wrapping it in middleware adds indirection
- The pattern works identically for authenticated and public server functions (public ones just skip `resolveTenantContext`)

If the codebase grows and middleware chains become beneficial (e.g., shared rate limiting, global auth checks), this can be migrated to `createMiddleware()` later without changing use cases.

---

## Layer flexibility — when to use less

The four-layer architecture is the default for operations with real business complexity. But not every operation has business complexity, and forcing every operation through every layer creates ceremony, not architecture.

### The three operation shapes

**Full pattern:** use when the operation has multiple validation steps, smart constructor logic, state transitions, cross-entity coordination, domain events, or non-trivial persistence mapping. This is the majority case for thick contexts.

**Thin use case (auth check + delegation):** use when the only domain logic is an authorization check, and the rest is delegation to a port. Keep the use case because (a) authorization is real domain logic, (b) future logic lands here naturally, (c) shape consistency helps AI navigate.

**Direct delegation:** use only when there is no authorization check beyond "authenticated or anonymous," no domain rules, no event, and no transformation. Rare and almost exclusive to wrapper contexts. The third-party library's API serves as the port.

### How to choose

1. **Does the operation have any business logic beyond an authorization check?** → Full pattern.
2. **Does it require an authorization check?** → Thin use case.
3. **Is it pure delegation to a third-party library?** → Direct delegation.
4. **When in doubt, default to the full or thin pattern.** The cost of "too much structure" for a simple operation is small. The cost of "too little structure" when complexity grows is large.

### The 7-step template is a template, not a law

Most use cases will use 4–6 of the seven steps. Skip the steps that don't apply. Don't fake them with empty validation calls or no-op constructors.

---

## Folder structure

```
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
    domain/                # Brand, ids, Result, ts-pattern re-exports, base errors, AuthContext, clock
    events/                # Event bus implementation, master event union
    db/                    # Drizzle client, schema barrel, migrations
    auth/                  # better-auth config, middleware
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
    api/                   # API-only routes (e.g., health)

  components/              # React components
    ui/                    # shadcn primitives including Field, FieldLabel, FieldError, FieldGroup, Input, ...
    layout/                # Shell, sidebar, header, footer, navigation
    forms/                 # Shared form building blocks (SubmitButton, FormErrorBanner, ...)
    features/              # Feature-specific components organized by context

  integrations/            # Framework integrations not owned by a context
    tanstack-query/        # QueryClient provider, devtools setup

  composition.ts           # Wires the dependency graph
  bootstrap.ts             # Registers event/job handlers at startup
  start.ts                 # TanStack Start web entry (framework convention)
  worker/
    index.ts               # BullMQ worker entry
```

### Top-level rules

- `contexts/` holds all business logic. Contexts are first-class citizens.
- `shared/` holds cross-cutting concerns. **High bar for entry: code goes here only when a second context needs it.**
- `routes/` is TanStack Router's territory. Files here are thin — they call server functions and render components.
- `components/` is React UI. Four subfolders: `ui/` (shadcn primitives), `layout/` (shell/nav), `forms/` (shared form building blocks), `features/` (feature-specific UI grouped by context).
- `integrations/` is framework-plumbing that doesn't belong to any context (TanStack Query provider, etc.).
- The entry points (`composition.ts`, `bootstrap.ts`, `start.ts`, `worker/index.ts`) are small and visible.

---

## Inside a context

Every context follows the same internal structure:

```
contexts/portal/
  domain/
    types.ts               # Entity types (Portal, PortalLinkCategory, ...)
    rules.ts               # Pure business rules
    constructors.ts        # Smart constructors (buildPortal, ...) — optional for thin wrapper contexts
    events.ts              # Domain events + constructors
    errors.ts              # Tagged error types + constructor
    # Optional additional pure files when content warrants splitting:
    # permissions.ts, compliance.ts, scoring.ts, etc.

  application/
    ports/                 # Interfaces for dependencies
      portal.repository.ts
      portal-link.repository.ts
      portal-storage.port.ts
    dto/                   # Zod schemas — dual-use for server validation AND form validation
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
```

### Rules within a context

- One file per use case. If a use case is doing two things, split it.
- One repository per aggregate. If a repository has 30 methods, it's two repositories.
- Mappers are pure and live in `infrastructure/mappers/`. The domain never sees row shapes.
- Public and authenticated server functions live in separate files. The trust boundary should be visible.
- Not every folder will be populated for every context. A wrapper context like `identity` may have no `mappers/` (no DB rows to translate), no `jobs/` (no background work), and a small `application/use-cases/` (most operations are thin or direct delegation). That's fine — empty folders are better than folders with placeholder files.

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
- `auth-context.ts` — `AuthContext` type (the pure data type; the middleware that produces it lives in `shared/auth/`)

### `shared/events/`

The event bus and the master event type.

- `event-bus.ts` — In-process event bus (`EventBus` type + implementation)
- `events.ts` — Master `DomainEvent` union (re-exports each context's event types)

### `shared/db/`

Database infrastructure.

- `client.ts` — Drizzle client factory
- `base-where.ts` — `baseWhere(orgId)` helper enforcing tenancy + soft-delete filtering (to be added when first non-identity repository is built; identity context wraps better-auth which handles tenancy internally)
- `schema/` — One file per context (`portal.schema.ts`, `review.schema.ts`, ...) plus an `index.ts` barrel
- `migrations/` — Drizzle-generated SQL

**Note:** Schemas live in `shared/db/` (not in each context) because the Drizzle schema barrel must be a single module. Migrations need to see all tables together.

### `shared/auth/`

- `auth.ts` — better-auth configuration
- `auth-client.ts` — client-side auth
- `headers.ts` — `headersFromContext()` builds `Headers` from the current TanStack Start request; used by server functions to pass session cookies to better-auth APIs
- `headers.ts` — `headersFromContext()` — builds a `Headers` object carrying the current request's cookies and headers from the TanStack Start server context; used by server functions to pass session info to better-auth APIs
- `middleware.ts` — `resolveTenantContext(headers)`, `requireAuth(headers)`, `roleGuard(minRole)` — these are plain async functions (not TanStack `createMiddleware()` chains) that resolve `AuthContext` from the request session. Server functions call them directly at the top of their handler. The `roleGuard` function returns a closure that checks the user's role against the hierarchy.

### `shared/jobs/`

- `queue.ts` — BullMQ queue factory
- `worker.ts` — BullMQ worker factory
- `registry.ts` — Job name → handler registration

### `shared/cache/`

- `redis.ts` — Redis client factory (shared with BullMQ)
- `cache.port.ts` — `Cache` type
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

- `in-memory-repos/` — In-memory implementations of common ports
- `capturing-event-bus.ts` — Event bus that records emissions for test assertions
- `fixtures.ts` — Domain object builders (`buildTestPortal`, `buildTestAuthContext`)
- `db.ts` — Helpers for setting up Neon test branches

---

## Inside `routes/` and `components/`

### `routes/`

TanStack Router file-based routing. Each file corresponds to a URL path.

**A route file contains:**

- Route configuration (path, search params Zod schema, loader)
- The page component
- Form/action wiring that calls server functions via TanStack Query mutations

**A route file does not contain:**

- Business logic
- Direct database queries
- Domain rules
- Anything you'd want to unit test in isolation

Layouts use TanStack Router's pathless route convention `(name)/` for grouping without affecting URLs.

### `components/`

React components organized by purpose.

```
components/
  ui/              # shadcn primitives (Button, Input, Dialog, Form, FormField, ...)
  layout/          # Shell, sidebar, header, footer, navigation
  forms/           # Shared form building blocks (SubmitButton, FormErrorBanner, FormSection)
  features/
    portal/        # Portal-specific UI (CreatePortalForm, LinkTreeEditor, ThemePicker)
    review/
    inbox/
    dashboard/
    identity/
    ...
```

**A component file contains:**

- React component definition, hooks, JSX, styles
- Component-local state and effects
- TanStack Query hooks (queries/mutations)

**A component file does not contain:**

- Business logic
- Direct database access
- Domain rules

**Form components live in `components/features/<context>/`** as named components (e.g., `CreatePortalForm.tsx`). They use shadcn's Form components from `components/ui/` and shared form building blocks from `components/forms/`.

---

## Forms

Forms are pervasive in this application. Every context has at least one. Because of that, we standardize the form stack and patterns rigorously — there is one way to do forms, and AI should never invent a different way.

### The form stack

**TanStack Form + Zod + shadcn/ui.** All three work together:

- **Zod** defines the schema (lives in `application/dto/`, already required for server-side validation)
- **TanStack Form** manages form state, field subscriptions, validation on submit (`validators.onSubmit`), submission flow
- **shadcn/ui** provides the visual components: `Field`, `FieldGroup`, `FieldLabel`, `FieldError`, `FieldDescription`, `FieldSet`, `FieldLegend`, plus primitives like `Input`, `Textarea`, `Select`, `Checkbox`

shadcn publishes an official integration guide for TanStack Form. That guide is the authoritative reference for wiring individual field components. Our conventions extend it with project-specific patterns (submission via mutations, error handling, folder structure).

### Why this stack

- **Single source of truth.** The Zod schema in `application/dto/` validates server input _and_ form input. Shape and validation rules cannot drift.
- **Type safety end-to-end.** `z.infer<typeof Schema>` gives form values type. TanStack Form uses that type for field names, values, and errors. Change the schema, TypeScript flags every form that breaks.
- **Stack consistency.** TanStack Start + TanStack Router + TanStack Query + TanStack Form are designed together. One mental model across routing, data fetching, and forms.
- **Design system consistency.** shadcn/ui primitives are used for every form input. Our app looks like itself on every page.
- **Performance.** TanStack Form subscribes at the field level; large forms don't re-render entire trees on each keystroke.

### How forms are structured in the codebase

For a form called `CreatePortalForm`, the files involved are:

1. **`contexts/portal/application/dto/create-portal.dto.ts`** — the Zod schema. Already exists because it's the server function's input validator. Reused by the form.

2. **`contexts/portal/server/portals.ts`** — the server function `createPortal` that validates with the same schema and calls the use case.

3. **`components/features/portal/CreatePortalForm.tsx`** — the React component. Uses TanStack Form + shadcn's `Field` components. **Receives the mutation as a prop** — never imports server functions directly (dependency rules forbid `components/` from importing `server/`).

4. **`routes/.../create-portal.tsx`** — the route file. Defines the `useMutation` wrapping the server function, creates the form mutation, and passes it as a prop to `<CreatePortalForm mutation={mutation} />`. Also handles post-submit navigation via `useNavigate()`.

### Submission pattern

Every form submission goes through a TanStack Query `useMutation` wrapping a server function. This is mandatory — no direct server function calls from form handlers.

**The mutation is defined in the route, not in the form component.** Routes import server functions; components cannot (dependency rules). The route creates the mutation and passes it to the form component as a prop:

```tsx
// routes/.../create-portal.tsx — defines mutation, renders form
const mutation = useMutation({
  mutationFn: (input: CreatePortalInput) => createPortal({ data: input }),
  onSuccess: () => navigate({ to: '/dashboard/portals' }),
})
return <CreatePortalForm mutation={mutation} />

// components/features/portal/CreatePortalForm.tsx — receives mutation as prop
type Props = { mutation: UseMutationResult<...> }
export function CreatePortalForm({ mutation }: Props) { ... }
```

Reasons for this split:

- **Dependency rules.** `components/` cannot import from `server/`. The route is the composition point.
- **Testability.** Form components receive a mock mutation — no server function dependency.
- **Unified mutation state.** `isPending`, `isError`, `isSuccess`, `error` drive UI affordances automatically. No hand-rolled `isSubmitting` state.
- **Cache invalidation.** `onSuccess` in the route invalidates related queries declaratively (`queryClient.invalidateQueries({ queryKey: ['portals'] })`).
- **Optimistic updates.** When useful, the mutation can apply changes immediately and roll back on error.
- **Error handling pipeline.** Server functions throw `Response` with tagged error bodies. The mutation's `error` is that response; the form displays it via `FormErrorBanner`.

### Post-submit navigation

After a successful mutation, use TanStack Router's `useNavigate()` for client-side navigation:

```tsx
const navigate = useNavigate()
const mutation = useMutation({
  onSuccess: () => navigate({ to: '/dashboard' }),
})
```

**Never use `window.location.href`** — it causes a hard page reload, losing router state, cached queries, and session context. Use `router.invalidate()` + `useNavigate()` for type-safe, client-side navigation. The sign-in flow is no exception: after successful authentication, call `router.invalidate()` to refresh session state, then `navigate()` to the target page.

### Shared form building blocks (`components/forms/`)

These wrap shadcn primitives with project conventions baked in:

- **`SubmitButton`** — reads mutation state, disables while pending, shows spinner
- **`FormErrorBanner`** — displays top-level mutation errors (translating tagged error codes to user-friendly messages)
- **`FormSection`** — visual grouping with heading and description for long forms

Only add a new shared form block when a second form needs the same thing. Don't pre-build.

### Feature-specific form components (`components/features/<ctx>/`)

These live next to other feature UI. Naming: `<Verb><Noun>Form.tsx` — `CreatePortalForm`, `InviteMemberForm`, `EditPropertyForm`.

### Public forms

Guest-facing forms (rating submission, feedback) follow the same pattern but submit to public server functions without auth middleware. The `FormErrorBanner` for public forms should be especially user-friendly — guests don't understand tagged error codes.

### Why not React Hook Form

RHF is a valid choice in isolation. We don't use it because:

- Mixing RHF with the rest of the TanStack stack creates two mental models
- Schema-first integration with Zod is marginally cleaner in TanStack Form for our use case
- TanStack Form + shadcn has a clear, official integration path

If you're more familiar with RHF from prior projects, the transition is small (a weekend of practice). The consistency win across the codebase is worth it.

See `docs/patterns.md` for a complete canonical form example.

---

## The composition root

`composition.ts` is the only place where the full dependency graph is wired together.

**Pattern:** A factory function that takes environment configuration and returns a `Container` — a record holding the database client, event bus, repositories, adapters, and all use cases.

The container is built once at startup. Both `start.ts` and `worker/index.ts` build it and use it.

**Why this matters:**

- No DI framework, no decorators, no auto-wiring
- All dependencies visible in one file
- Easy to substitute parts in tests (build a test container with in-memory repos)
- Easy to trace what depends on what (read top to bottom)

**`bootstrap.ts`** is a separate file that takes the built container and registers event handlers and job handlers. Keeping registration separate from construction makes both easier to understand.

**The event bus is passed to every use case that emits events** via the `events` dependency. Use cases call `deps.events.emit(...)` directly; they do not check whether the bus is present. The bus is always present in production and in tests (either real or capturing).

---

## Patterns and conventions

### Use cases as factory functions

Every use case follows this shape, including only the steps that apply:

```ts
type Deps = { ... };
type Ctx = AuthContext;

export const someUseCase = (deps: Deps) =>
  async (input: SomeInput, ctx: Ctx): Promise<R> => {
    // 1. Authorize (call domain rule)
    // 2. Validate referenced entities exist (call repos)
    // 3. Check uniqueness/business invariants (call repos)
    // 4. Build domain object (smart constructor, returns Result, throw on err)
    // 5. Persist (call repo)
    // 6. Emit event
    // 7. Return result
  };
```

Steps 1–7 happen in this order _when present_, because the order reflects the natural dependency chain. When a step doesn't apply, skip it. Most use cases will have 4–6 steps.

**Anonymous/public use cases:** Operations that run before authentication (registration, public guest flows) omit the `AuthContext` parameter entirely:

```ts
export const registerUser = (deps: Deps) =>
  async (input: RegisterInput): Promise<R> => { ... }
```

These use cases have no authorization step and no tenant context. The server function resolves the org from other sources (e.g., URL slug for public routes) or creates a new org (for registration).

For full examples of the three use case shapes (full, thin, direct delegation), see `docs/patterns.md`.

### Repositories as records of functions

```ts
type SomeRepository = Readonly<{
  findById: (orgId: OrganizationId, id: SomeId) => Promise<Something | null>
  insert: (orgId: OrganizationId, entity: Something) => Promise<void>
  // ...
}>

export const createSomeRepository = (db: Database): SomeRepository => ({
  findById: async (orgId, id) => {
    /* Drizzle query */
  },
  insert: async (orgId, entity) => {
    /* Drizzle insert */
  },
})
```

No classes. Records of functions returned by factories. The factory closes over the database client.

### Ports as type aliases in `application/`

Ports are TypeScript `type` aliases defining capability contracts. The implementation lives in `infrastructure/`. The use case depends only on the type.

**Exception for wrapper contexts:** When wrapping a third-party library that already provides a stable, well-typed API, the third-party API itself can serve as the port for direct-delegation operations. Don't write a wrapper port that does nothing but forward calls.

### Mappers as pure functions

One per direction (`xxxFromRow`, `xxxToRow`). Lives in `infrastructure/mappers/`. The only place in the code where both row and domain shapes are visible at once.

### Domain events as discriminated unions

Tagged with `_tag` matching the event name. Built via smart constructors. Subscribers pattern-match on `_tag` for type-safe dispatch.

### Tagged errors

Plain objects with `_tag` (error type) and `code` (specific reason). Built via smart constructors. Pattern-matched exhaustively in server function error translation.

### Forms use case schemas

Zod schemas in `application/dto/` are reused by forms. The form imports the schema and passes it to `validators.onSubmit`. TanStack Form v1 handles Zod schemas natively — no adapter library required. No duplication.

---

## Functional style rules

### What is locked

- **No classes.** Anywhere. Use factory functions returning records.
- **No `this`.** Functions don't bind `this`.
- **No inheritance.** No `extends` (except for built-in `Error` subclasses, which we avoid by using tagged objects instead).
- **`readonly` everywhere applicable.** Domain types use `readonly` on every field. Arrays are `ReadonlyArray<T>`.
- **Immutable updates.** Never mutate; produce new values.
- **Discriminated unions over enums.** Use string literal unions, not TypeScript `enum`.
- **`Result` in domain.** Domain functions that can fail return `Result<T, E>` from neverthrow.
- **Throw at application boundary.** Use cases throw tagged errors. Server functions catch them and translate to HTTP responses (throw Response).
- **`ts-pattern` for union dispatch.** Use `match(...).exhaustive()` whenever handling discriminated unions.
- **Prefer `type` over `interface`.** Interfaces are not forbidden, but `type` is the default for consistency.

### What is pragmatic

- **`async/await` is allowed in application and infrastructure layers.**
- **Closures over hidden mutable state are allowed anywhere** when the interface is pure. This covers the event bus, testable clocks, in-memory fakes, etc. The mutation is an implementation detail.
- **React hooks are not purified.** React's effectful model is accepted as-is.
- **TanStack Form's internal state is not purified.** The library manages form state with refs and effects; that's fine.
- **Tests are imperative.** Vitest's `describe`/`it` style is fine.
- **Wrapper-context use cases may receive HTTP-scoped functions as deps.** When a use case needs to call a third-party API that requires request-scoped state (e.g., session headers for better-auth), the function producing that state (`headersFromContext`) is injected as a dependency rather than importing the HTTP utility directly. This keeps the use case testable (inject a stub) while acknowledging that the dependency is HTTP-scoped. The `registerUserAndOrg` use case is the current example. If better-auth adds a way to act on a user ID without headers, this can be cleaned up.

### What is forbidden

- `class` declarations (except React error boundaries if absolutely necessary)
- `enum` declarations (use union types)
- Mutation of function parameters
- Implicit any
- `// @ts-ignore` without a comment explaining why
- `as` casts to any type that isn't a branded ID
- `require()` — use ESM `import`
- Returning `{ success: false, error }` objects from server functions (always throw Response)

---

## Tenant isolation

Tenancy is the most important architectural invariant. Get this wrong and the product is broken.

### The rules

1. **Every business table has `organization_id` as a non-null column.** Even when it could be derived through joins. This makes filtering trivial and makes accidental cross-tenant queries impossible.

2. **Every repository method takes `organizationId` as the first parameter.** No exceptions. The TypeScript signature enforces it.

3. **Every repository query filters by `organization_id`.** Use the helper `baseWhere(orgId)` (in `shared/db/`) which enforces this pattern.

4. **Soft-deleted rows are filtered too.** `baseWhere` adds `AND deleted_at IS NULL` for tables that support soft delete.

5. **The `resolveTenantContext(headers)` function resolves `organizationId` from the better-auth session and returns the `AuthContext` passed to use cases.** Server functions call this at the top of their handler. Use cases never read the org from anywhere else.

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
- **Subscribers live in the _receiving_ context's `infrastructure/event-handlers/`.** The receiver decides what to do with the event.
- **Handlers should be idempotent.** Retries are possible.
- **Handlers log via the structured logger, never `console`.** Failures are logged, not propagated to the emitter.
- **Cross-context type imports are allowed for events.** Context B can import `PortalCreated` type from context A. It cannot import context A's use cases or repositories.
- **The event bus is always available to use cases via `deps.events`.** Wired in `composition.ts`. No TODO comments for event emission — wire it up.

### When to use jobs instead of events

- **Events** are for in-process side effects within the current request lifecycle.
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
- **Long-running work should be split into smaller jobs.**

### Per-tenant fairness

For high-volume jobs (review sync), implement per-organization queues or use BullMQ's job grouping features so one large tenant doesn't starve smaller ones.

---

## Error handling

### Layered approach

- **Domain layer:** Returns `Result<T, DomainError>`. Never throws.
- **Application layer (use cases):** Calls domain functions, unwraps `Result`, throws tagged error on failure. Awaits async operations normally.
- **Infrastructure layer:** Catches library errors (Drizzle, external APIs) and either translates them to tagged errors or lets them bubble.
- **Server function layer:** Catches tagged errors using `ts-pattern` matching on `_tag` and `code`, **throws `new Response(...)`** with the appropriate HTTP status.
- **Client layer:** TanStack Query mutations surface errors via `error` state. `FormErrorBanner` component displays them with user-friendly messages.

### Error translation pattern

```ts
const errorToHttp = (e: PortalError) =>
  match(e.code)
    .with('forbidden', () => ({ status: 403, body: { ... } }))
    .with('not_found', () => ({ status: 404, body: { ... } }))
    .with('slug_taken', () => ({ status: 409, body: { ... } }))
    .with('invalid_slug', 'invalid_theme', () => ({ status: 400, body: { ... } }))
    .exhaustive()
```

The `.exhaustive()` ensures the compiler tells us when a new error code is added — every possible code must have a matching `.with()` branch, or TypeScript will error. Do not chain `.otherwise()` before `.exhaustive()`; `.otherwise()` returns a plain value, not a chainable matcher.

### What never to do

- Don't throw plain `Error` objects in domain or application code. Always tagged errors.
- Don't catch and swallow errors silently.
- Don't use error messages as control flow. Match on `_tag` and `code`.
- Don't return `{ success: false, error: message }` from server functions. Always throw Response.

---

## Testing strategy

Tests are colocated with the code they test.

### By layer

| Layer                     | Test type                                               | Speed          | Test-first?                 |
| ------------------------- | ------------------------------------------------------- | -------------- | --------------------------- |
| Domain                    | Pure unit, no setup                                     | Microseconds   | Yes, always                 |
| Application (use cases)   | Unit with in-memory port fakes                          | Milliseconds   | Yes, default                |
| Infrastructure (repos)    | Integration against real Postgres                       | Hundreds of ms | Test-after, but always test |
| Infrastructure (adapters) | Integration with mocked external APIs                   | Hundreds of ms | Test-after                  |
| Server functions          | Integration through TanStack Start                      | Seconds        | Test-after critical paths   |
| Forms                     | Component tests with user-event, for complex validation | Slow           | Test-after when warranted   |
| UI (other)                | Sparse, pragmatic                                       | Slow           | No                          |
| End-to-end                | Playwright critical flows                               | Slow           | No, after feature is built  |

### Required tests for every context

- **Domain:** 100% coverage on rules, constructors, errors.
- **Use cases:** Every use case has tests for happy path and every error path.
- **Repositories:** Integration test for each method. Tenant isolation test (cross-org query returns empty).
- **Server functions:** Integration tests for happy path and key error paths.
- **Forms:** Component tests only for complex validation flows, multi-step forms, or public forms with spam protection.

### Test infrastructure

- Vitest as the runner
- Neon branch per integration test suite, or local Docker Postgres in CI
- In-memory port implementations in `shared/testing/in-memory-repos/`
- Capturing event bus in `shared/testing/capturing-event-bus.ts`
- Fixture builders in `shared/testing/fixtures.ts`

---

## Dependency rules

These rules are enforced by ESLint (or `dependency-cruiser`) and by code review.

### What can import what

```
domain/         ← imports nothing outside domain/ and shared/domain/
application/    ← imports from domain/, shared/domain/
infrastructure/ ← imports from domain/, application/, shared/, external libs
server/         ← imports from application/ (use cases, dtos), shared/, TanStack Start
routes/         ← imports from contexts/<ctx>/server/, components/, shared/, integrations/
components/     ← imports from other components/, shared/, contexts/<ctx>/application/dto/ (for form schemas only)
shared/         ← imports from itself, external libs only
integrations/   ← imports from shared/, external libs only
```

### Forbidden imports

- `contexts/A/*` from `contexts/B/*` (except domain event types, from `domain/events.ts`)
- `drizzle-orm` from anywhere outside `infrastructure/`
- React from anywhere outside `routes/`, `components/`, and `integrations/`
- Direct database access from `routes/` or `components/`
- `shared/testing/*` from production code
- `contexts/<ctx>/domain` or `contexts/<ctx>/application/use-cases` or `contexts/<ctx>/infrastructure` from `components/` (only `application/dto/` is importable for form schemas)

### Enforcement

ESLint rules in the project root mechanically prevent these violations. CI fails if rules are broken.

---

## Naming conventions

### Files

- Lowercase with hyphens: `create-portal.ts`, `portal.repository.ts`
- Test files: same name with `.test.ts` suffix, colocated
- Form components: PascalCase matching React convention: `CreatePortalForm.tsx`
- One concept per file. If a file is exporting unrelated things, split it.

### Types

- PascalCase: `Portal`, `PortalRepository`, `CreatePortalInput`
- Branded types are PascalCase: `PortalId`, `OrganizationId`
- Discriminated union members include `_tag` field

### Functions

- camelCase: `createPortal`, `validateSlug`
- Factory functions returning use cases or repos: `createXxx`
- Server functions end in camelCase: `createPortal`, `inviteMember`, `signInUser`
- Smart constructors for domain types: `buildXxx`
- Smart constructors for events: past-tense matching `_tag`
- Smart constructors for errors: `xxxError`
- Form components: `<Verb><Noun>Form` (e.g., `CreatePortalForm`, `LoginForm`)

### Domain events

- Format: `<context>.<verb-past-tense>`
- Examples: `portal.created`, `review.received`

### Job names

- Format: `<verb>-<noun>` or `<verb>-<noun>-<modifier>`
- Examples: `sync-reviews`, `process-hero-image`

### Database tables

- snake_case, plural: `portals`, `portal_link_categories`, `metric_readings`
- Always include: `id`, `organization_id`, `created_at`, `updated_at`
- Soft-deletable tables include: `deleted_at`
- Exception: better-auth tables use camelCase columns (framework default)

---

## Where does this code go? — Decision guide

When you're not sure where new code belongs, walk this decision tree:

**Is it a pure function with no I/O, no async, no framework dependency?**

- Specific to one context → `contexts/<context>/domain/rules.ts` (or a dedicated file like `permissions.ts` if content warrants)
- Used by multiple contexts → `shared/domain/`

**Is it a TypeScript type?**

- Specific to one context's entities → `contexts/<context>/domain/types.ts`
- Specific to one context's input/output (used for both server validation AND form validation) → `contexts/<context>/application/dto/`
- Cross-context (IDs, base errors, AuthContext) → `shared/domain/`

**Is it an interface/contract for a dependency?**

- It's a port → `contexts/<context>/application/ports/`

**Is it the implementation of a port?**

- Database-backed → `contexts/<context>/infrastructure/repositories/`
- External service → `contexts/<context>/infrastructure/<service-type>/`

**Is it an orchestration of business logic?**

- Real domain logic → `contexts/<context>/application/use-cases/<verb-noun>.ts` (full pattern)
- Only an authorization check → `contexts/<context>/application/use-cases/<verb-noun>.ts` (thin pattern)
- Pure delegation, no auth check, no logic → no use case; server function calls third-party API directly

**Is it a server function (TanStack Start)?**

- Authenticated dashboard function → `contexts/<context>/server/<noun>.ts`
- Public guest function → `contexts/<context>/server/public-<noun>.ts`

**Is it a React component?**

- shadcn primitive or general-purpose UI → `components/ui/`
- Layout/navigation → `components/layout/`
- Shared form building block (SubmitButton, FormErrorBanner, FormSection) → `components/forms/`
- Feature-specific form or other component → `components/features/<feature>/`

**Is it a URL route?**

- → `routes/` (matching the URL path)

**Is it a framework integration (QueryClient provider, etc.)?**

- → `integrations/`

**Is it a background job handler?**

- → `contexts/<context>/infrastructure/jobs/<job-name>.job.ts`

**Is it a subscriber to a domain event?**

- → `contexts/<context>/infrastructure/event-handlers/<event-name>.handler.ts`
- (Goes in the _receiving_ context, not the emitting one)

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

If you're adding non-orchestration logic to a use case (validation, calculation, transformation), it belongs in `domain/`.

### "This repository needs to know about another context"

If `PortalRepository` is importing types from the review context, you have a cross-context dependency in the wrong place.

### "I'll just inline this query in the route"

Routes don't access databases directly. Always go through a server function.

### "We can skip the port and just import the repo directly"

Skipping the port couples the use case to a specific implementation. (Different from intentional wrapper-context direct delegation.)

### "I'll add the new event handler in the same context that emits the event"

Event handlers belong in the _receiving_ context, not the emitting one.

### "I'll just put this in `shared/`, we might need it later"

`shared/` has a high bar. Code goes there only after a _second_ context needs it.

### "I'll throw a generic Error here, easier to handle"

Generic errors lose the type information that makes pattern matching exhaustive.

### "I'll return `{ success: false, error: message }` from this server function, it's easier than throwing"

Never. Always throw Response with appropriate status. The client catches via mutation error state. Consistency matters.

### "I'll use React Hook Form for this form, I know it better"

One form stack: TanStack Form + Zod + shadcn. No exceptions.

### "I'll duplicate the Zod schema for the form, the DTO is shaped differently"

If it's shaped differently, the DTO is wrong. Fix the DTO. The schema is the single source of truth.

### "I'll manage `isSubmitting` state in the form component"

Use the TanStack Query mutation's `isPending`. Never hand-roll submission state.

### "I'll call the server function directly from the form onSubmit"

Wrap every server function call in a TanStack Query `useMutation`.

### "I'll cast this with `as` to make TypeScript happy"

`as` casts circumvent the type system. Only acceptable for branded IDs at parsing boundaries.

### "I'll use a class for this, it's cleaner"

We don't use classes. If something feels like it wants to be a class, it's probably a record of functions returned by a factory.

### "I'll skip the test for this, it's obvious"

Domain and use case tests are cheap. The "obvious" code is exactly the code that breaks subtly six months later.

### "Every operation should follow the full 7-step pattern for consistency"

Consistency in _shape_ is good. Forcing operations to fake business logic they don't have is not.

### "This use case is one line, let me just inline it in the server function"

The thin use case pattern exists exactly for this case. Keep it.

### "The AI suggested this pattern, let's go with it"

If AI suggests a pattern that doesn't appear in this document or in existing code, ask whether it fits before accepting.

---

## Living document

This architecture is locked, but not frozen. If you discover a genuine reason to change something, the process is:

1. Identify the rule and why it's not working
2. Propose the change explicitly (not just write code that breaks the rule)
3. Update this document before changing the code
4. Apply the change consistently across the codebase

Drift kills architectures. Either follow the rules or change them deliberately.
