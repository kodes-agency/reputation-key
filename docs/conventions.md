# Conventions

**Status:** Locked. Changes require explicit decision.
**Audience:** Developers (human and AI) working on this codebase.
**Purpose:** The canonical rules-only reference for the codebase. This document owns the _what_ and the _why_ — rationale is inline. For concrete code examples per file type, see `docs/patterns.md`.

> **Precedence:** When this document and `docs/patterns.md` describe the same rule, this document is authoritative. `docs/patterns.md` provides examples.

The rules. For concrete examples, see `docs/patterns.md`.

---

## Table of contents

1. [Stack](#stack)
2. [Folder structure](#folder-structure)
3. [Bounded contexts](#bounded-contexts)
4. [The four layers](#the-four-layers)
5. [When to skip layers](#when-to-skip-layers)
6. [Forms](#forms)
7. [Where does this code go?](#where-does-this-code-go)
8. [Functional style](#functional-style)
9. [Permissions (better-auth access control)](#permissions-better-auth-access-control)
10. [Tenant isolation](#tenant-isolation)
11. [Use case shape](#use-case-shape)
12. [Events](#events)
13. [Errors](#errors)
14. [Naming](#naming)
15. [Dependency rules (enforced by lint)](#dependency-rules-enforced-by-lint)
16. [Testing](#testing)
17. [Anti-patterns](#anti-patterns)
18. [Core principles](#core-principles)
19. [Composition root](#composition-root)
20. [When in doubt](#when-in-doubt)

---

## Stack

TanStack Start (SSR + server functions + routing) on Railway Node. Drizzle + Neon Postgres. better-auth (organization plugin, DB-backed sessions). BullMQ + Redis for jobs, rate limiting, and caching. Cloudflare R2 for storage. Resend for email. FCM for push. Anthropic for AI. Pure functional style; `neverthrow` for `Result`, `ts-pattern` for union dispatch, `Zod` for validation. **TanStack Form + shadcn/ui for all forms.** Route loaders for data fetching; `useServerFn` for mutations.

> **Note on Zod version:** This project uses Zod v4 (`^4.3.6`). TanStack Form v1 handles Zod schemas natively — pass the schema directly to `validators.onSubmit`. No adapter library is needed.

---

## Folder structure

```
src/
  contexts/<n>/
    build.ts           context build function (wires repos, use cases, publicApi)
    domain/          types.ts, rules.ts, constructors.ts, events.ts, errors.ts (+ optional: compliance.ts, scoring.ts)
    application/
      public-api.ts  typed cross-context query surface (only if other contexts query this one)
      ports/         repository and external-service interfaces
      dto/           Zod input/output schemas (forms derive from these)
      use-cases/     one file per user action
    infrastructure/
      repositories/  Drizzle implementations of ports
      mappers/       row ↔ domain (pure)
      jobs/          BullMQ job handlers
      event-handlers/ subscribers to domain events
      <service>/     external service adapters (storage, ai, gbp, ...)
    server/          TanStack Start server functions
  shared/
    domain/          brand, ids, result, pattern, errors, clock, auth-context, roles (Role type and hierarchy), permissions (Permission type and sync can() check), property-access.port (cross-context port), timezones
    events/          event bus, master event union
    db/              index.ts (Drizzle client factory + isDbHealthy), pool.ts (shared pg Pool), columns.ts (common Drizzle column helpers), schema/ (index.ts barrel, auth.ts, property.schema.ts, team.schema.ts, staff-assignment.schema.ts, audit.ts), migrations
    auth/            better-auth config (auth.ts), auth-client.ts, headers.ts, middleware.ts (resolveTenantContext), permissions.ts (access control statement), auth.functions.ts (server-side session helpers), emails.ts (email sending via Resend), server-errors.ts (shared throwContextError), auth-cli.ts (CLI config)
    jobs/            queue, worker, registry
    cache/           redis client, cache port + impl
    rate-limit/      middleware
    observability/   logger (pino), sentry
    config/          env zod schema
    fn/              pipe and other utilities
    testing/         in-memory port fakes (in-memory-identity-port.ts, in-memory-property-repo.ts, in-memory-team-repo.ts, in-memory-staff-assignment-repo.ts), capturing-event-bus.ts, fixtures.ts, db.ts (test DB helpers)
  routes/            TanStack Router file-based routes (underscore-prefix layout convention: _authenticated.tsx, _authenticated/ subdirectory for dashboard pages; top-level login.tsx, register.tsx, join.tsx for auth pages)
  components/        ui/ (shadcn primitives), layout/, forms/, features/<context>/ (identity/, property/, team/, staff/)
  integrations/      Framework integrations (devtools, analytics, etc.)
  composition.ts     dependency wiring
  bootstrap.ts       event/job handler registration
  start.ts           TanStack Start web entry
  worker/index.ts    BullMQ worker entry
```

---

## Bounded contexts

**Implemented:** `identity`, `property`, `team`, `staff`.
**Planned (not yet built):** `portal`, `guest`, `review`, `metric`, `gamification`, `notification`, `ai`, `audit`.

Each context owns its data, rules, events, errors, and public API. Contexts communicate via domain events (async) and typed PublicApi surfaces (sync). Cross-context type imports allowed for events and PublicApi types only.

Contexts vary in "thickness": thick contexts (`portal`, `review`, `metric`) own their tables and have their own domain logic; thin contexts (`identity`) primarily wrap a third-party library. Thin contexts will legitimately have empty layer folders (no mappers, no jobs, sparse use cases). That's expected.

A context can import another context's _event types_ and _PublicApi types_ (`application/public-api.ts`). A context **cannot** import another context's use cases, repositories, or internal domain functions. Synchronous cross-context queries go through a PublicApi method injected as a dependency by the composition root (per ADR-0001).

---

## The four layers

| Layer             | Contains                                                                                                                                                                     | Forbidden                                                 |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `domain/`         | Types, pure rules, smart constructors, events, errors. Additional pure-function files (e.g., `compliance.ts`, `scoring.ts`) when content warrants splitting from `rules.ts`. | `async`, I/O, framework imports, `throw`, mutation        |
| `application/`    | Use cases, port interfaces, DTOs                                                                                                                                             | DB queries, HTTP code, React, reimplementing domain rules |
| `infrastructure/` | Repository impls, mappers, adapters, job handlers, event handlers                                                                                                            | Business rules, HTTP routing, React                       |
| `server/`         | TanStack Start server functions                                                                                                                                              | Business logic, direct DB access, domain rules            |

Dependencies point inward: `routes` → `server` → `application` → `domain`. Infrastructure implements `application` ports. Domain depends on nothing outside itself and `shared/domain/`.

**Empty layer folders are fine.** Wrapper contexts may have no mappers, no jobs, no repositories. Only create files when they have content.

---

## When to skip layers

Not every operation needs every layer. The patterns are tools, not rituals. Use this guide:

| Operation shape                                                                                     | Pattern                                                                                                               |
| --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Pure third-party delegation (no auth check, no event, no transformation)                            | Server function may call the port (or third-party API) directly. Examples: sign-in, sign-out, request password reset. |
| Authorization check + delegation, nothing else                                                      | Keep the use case, even if it's effectively one line. The use case is the place future logic will land.               |
| Has business rules, multi-field validation, events, cross-entity coordination, or state transitions | Full use case with the 7-step pattern.                                                                                |

**When in doubt, prefer the use case.** A one-line use case costs three extra lines. Business logic leaking into server functions costs you weeks of refactoring later.

**The 7-step use case pattern is a template, not a law.** If a step doesn't apply, skip it; don't fake it. Most use cases will have 4–6 of the 7 steps. That's fine.

---

## Forms

All forms in the app use **TanStack Form + Zod + shadcn/ui**. This is the only supported form stack — don't use React Hook Form, Formik, or plain `useState` forms.

### Rules

1. **Schema source:** The Zod schema lives in `contexts/<ctx>/application/dto/`. It's the single source of truth for the server's input shape. The form may define its own schema when the form shape differs (e.g., all fields as strings, no optional fields), but validation rules (lengths, formats, ranges) must match what the domain enforces. See `docs/patterns.md` section 30 for the full guidance.

2. **Form components:** Built using shadcn's Field components (`Field`, `FieldGroup`, `FieldLabel`, `FieldError`, `FieldDescription`) wired with TanStack Form's `form.Field` render prop. Follow shadcn's official TanStack Form integration docs.

3. **Submission:** Every form submission goes through a `useServerFn` hook wrapping a server function. **The `useServerFn` instance is defined in the route file and passed to the form component as a prop.** Never call server functions directly from form handlers. Never define server function hooks inside components (dependency rules forbid `components/` from importing `server/`).

4. **Validation trigger:** Use `validators.onSubmit` (not `onChange`) so errors only appear after the user submits. This avoids showing errors while the user is still filling in the form. TanStack Form v1 handles Zod schemas natively — just pass the Zod schema directly, no adapter needed.

5. **Form-level state:** `useServerFn` state (`isPending`, `error`, `status`) drives submit button state and top-level error display. Never manage `isSubmitting` yourself.

6. **Shared building blocks** live in `components/forms/`:
   - `SubmitButton` — wraps shadcn `Button`, reads `isPending`, shows spinner when pending
   - `FormErrorBanner` — displays top-level action errors (translates tagged errors to user messages)
   - `FormSection` — visual grouping for long forms
   - Additional wrappers as patterns emerge — but only after a second form needs the same thing

7. **Feature-specific forms** live in `components/features/<context>/` alongside other feature UI (e.g., `CreatePortalForm.tsx`, `InviteMemberForm.tsx`).

8. **Public forms** (guest rating, feedback) follow the same pattern but submit to public server functions without auth middleware.

See `docs/patterns.md` section 25 for a canonical form example (portal create form).

---

## Where does this code go?

| What you're writing                              | Where it goes                                                                                                    |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| Pure function, business rule                     | `contexts/<ctx>/domain/rules.ts` (or a dedicated file if content warrants — e.g., `compliance.ts`, `scoring.ts`) |
| Pure function, builds an entity                  | `contexts/<ctx>/domain/constructors.ts`                                                                          |
| Entity type                                      | `contexts/<ctx>/domain/types.ts`                                                                                 |
| Domain event                                     | `contexts/<ctx>/domain/events.ts`                                                                                |
| Tagged error                                     | `contexts/<ctx>/domain/errors.ts`                                                                                |
| Use case (one user action)                       | `contexts/<ctx>/application/use-cases/<verb-noun>.ts`                                                            |
| Repository or service interface                  | `contexts/<ctx>/application/ports/`                                                                              |
| PublicApi type (cross-context query surface)     | `contexts/<ctx>/application/public-api.ts` (only if other contexts query this one)                               |
| Zod schema for HTTP input (forms derive from it) | `contexts/<ctx>/application/dto/`                                                                                |
| Context build function (wires repos + use cases) | `contexts/<ctx>/build.ts`                                                                                        |
| Drizzle repository implementation                | `contexts/<ctx>/infrastructure/repositories/`                                                                    |
| Row ↔ domain mapper                              | `contexts/<ctx>/infrastructure/mappers/`                                                                         |
| External service adapter (R2, GBP, AI, ...)      | `contexts/<ctx>/infrastructure/<service>/`                                                                       |
| BullMQ job handler                               | `contexts/<ctx>/infrastructure/jobs/<n>.job.ts`                                                                  |
| Event subscriber                                 | Receiving context's `infrastructure/event-handlers/`                                                             |
| TanStack Start server function (auth)            | `contexts/<ctx>/server/<noun>.ts`                                                                                |
| TanStack Start server function (public)          | `contexts/<ctx>/server/public-<noun>.ts`                                                                         |
| Drizzle table                                    | `shared/db/schema/<ctx>.schema.ts`                                                                               |
| URL route                                        | `routes/` (matches URL path)                                                                                     |
| Feature-specific form                            | `components/features/<ctx>/<FormName>Form.tsx`                                                                   |
| Shared form building block                       | `components/forms/`                                                                                              |
| Generic UI primitive (shadcn)                    | `components/ui/`                                                                                                 |
| Layout (header, sidebar, shell)                  | `components/layout/`                                                                                             |
| Cross-context utility (used 2+ times)            | `shared/<concern>/`                                                                                              |

If a file would import from two contexts' internals, you're doing something wrong. Use events or rethink the boundary.

---

## Functional style

**Locked:**

- No `class`. No `this`. No inheritance. No `enum` (use string literal unions).
- Prefer `type` aliases over `interface` for consistency. Interfaces are not forbidden but are not the default.
- `readonly` on all domain type fields. `ReadonlyArray<T>` for arrays in domain.
- Immutable updates only. Never mutate parameters.
- Discriminated unions tagged with `_tag`.
- `Result<T, E>` from neverthrow in domain. Throw tagged errors at application boundary.
- `match(...).exhaustive()` from ts-pattern for all union dispatch.
- Repositories are records of functions returned by factory functions: `createXxxRepository(db)`.
- Use cases are factory functions: `(deps) => async (input, ctx) => Promise<T>`.

**Why no classes:** Factory functions returning records provide the same encapsulation without `this` binding, inheritance chains, or hidden mutation. The resulting code is easier to test (inject deps), easier to compose (partial application), and more transparent (all dependencies are visible parameters).

**Pragmatic:**

- `async/await` allowed in application and infrastructure.
- Closures over mutable state allowed anywhere when hidden behind a pure interface (event bus, testable clock, in-memory fakes, etc.).
- React hooks not purified.
- TanStack Form's internal state is not purified (the library manages form state with refs and effects).
- Tests are imperative (Vitest's describe/it style is fine).
- Wrapper-context use cases may receive HTTP-scoped functions as deps (e.g., `headersFromContext`) — injected as a dependency to keep the use case testable while acknowledging the HTTP-scoped nature.

**Forbidden:**

- `class` (except React error boundaries if absolutely required).
- `enum`.
- Mutation of function parameters.
- Implicit `any`.
- `as` casts except for branded ID parsing.
- `// @ts-ignore` without an explanatory comment.
- `require()` — use ESM `import`.

---

## Permissions (better-auth access control)

All authorization uses better-auth's `createAccessControl` system. There is a single source of truth.

### The permission statement

Defined in `shared/auth/permissions.ts` using `createAccessControl(statement)`. The statement is an object mapping resource names to arrays of available actions. It defines the **universe of permissions** for the entire application. Adding a new resource or action requires a code deploy.

### Default roles

Three roles are defined using `ac.newRole(...)`: **owner** (AccountAdmin), **admin** (PropertyManager), **member** (Staff). Each role specifies which resource+action combos it can perform. These are passed to both `organization()` server plugin and `organizationClient()` client plugin.

### How to check permissions

**Server-side:** `await getAuth().api.hasPermission({ headers, body: { permissions: { resource: ['action'] } } })` — returns `{ success: true }` or `{ error: ... }`. Throws if unauthorized (better-auth handles the error).

**Client-side (UI gating only, NOT security):** `await authClient.organization.hasPermission({ permissions: { resource: ['action'] } })` — returns boolean. Use for hiding/showing UI elements based on the user's role.

**Sync client-side check (static roles only):** `authClient.organization.checkRolePermission({ permissions: { resource: ['action'] }, role: 'admin' })` — synchronous, doesn't contact server. Does NOT include dynamic roles (Phase B).

### What was removed

- `roleGuard(minRole)` function from `shared/auth/middleware.ts` — replaced by fine-grained `can()` and `hasPermission` checks
- `contexts/identity/domain/permissions.ts` with its hand-rolled `canManageUsers()`, `canInviteMembers()`, etc. — replaced by the access control statement in `shared/auth/permissions.ts`. Domain-level authorization predicates (`canInviteWithRole`, `canChangeRole`) still exist in `domain/rules.ts` and use `hasRole` as the primary gate for specific flows.

### Current authorization pattern

Use cases perform authorization as step 1 using `can(ctx.role, 'resource.action')` from `shared/domain/permissions.ts`. Some contexts keep additional authorization predicates in `domain/rules.ts` (e.g., `canInviteWithRole`, `canChangeRole` in the identity context) when the check involves domain-specific constraints. The server function may also call `auth.api.hasPermission()` as a defense-in-depth check, but the use case is the primary authorization boundary.

---

## Tenant isolation

1. Every business table has `organization_id` (non-null).
2. Every repository method takes `organizationId: OrganizationId` as the first parameter.
3. Every repository query filters `WHERE organization_id = $1 AND deleted_at IS NULL` (use `baseWhere(orgId)` helper in `shared/db/base-where.ts`).
4. `resolveTenantContext(headers)` resolves org from session and returns `AuthContext`. Server functions call this at the top of their handler.
5. Public routes resolve org from URL slug, validate via use case logic (no auth context).
6. Every repository has an integration test that attempts a cross-tenant query and asserts empty result.

No ambient tenant context. No inferring tenant from entity ID. Always explicit.

---

## Use case shape

Every use case follows this order, **including only the steps that apply**:

1. Authorize (call domain rule)
2. Validate referenced entities exist (call repos) — including loading the target of the operation if a role check depends on its current state
3. Check uniqueness / business invariants (call repos)
4. Build domain object via smart constructor (returns `Result`, throw tagged error on `.isErr()`)
5. Persist (call repo)
6. Emit event
7. Return result

Most use cases will use 4–6 of these steps. A pure delegation use case might be just (1) + (5). A query use case might be just (1) + (5) + (7). Skip the steps that don't apply; don't add ceremony for symmetry.

The order matters when steps are present, because it reflects the natural dependency chain.

**Anonymous/public use cases** (registration, public guest flows) omit the `AuthContext` parameter entirely — they take only `(input)`, not `(input, ctx)`. These have no authorization step and no tenant context. There are two registration paths: **org-creator registration** (`registerUserAndOrg`) creates a user and their first organization (route: `/register`). **Member registration** (`registerUser`) creates a user account only, no org (route: `/join`) — used by invited staff/managers. The server function resolves the org from other sources (URL slug for public routes) or creates a new org (for org-creator registration).

---

## Events

- Past-tense facts: `portal.created`, `review.received`, `goal.achieved`. Never commands.
- Live in emitting context's `domain/events.ts`. Master union in `shared/events/events.ts`.
- Constructors enforce the `_tag`: `portalCreated({ ... })`.
- Subscribers live in **receiving** context's `infrastructure/event-handlers/`.
- Handlers are idempotent.
- Handlers don't throw; they log via the shared logger (`shared/observability/logger.ts`), not `console`.
- For durable / scheduled / retryable work, the handler enqueues a BullMQ job rather than doing the work inline.
- The event bus is wired in `composition.ts` and passed to use cases via deps. Use cases emit directly; they do not check whether the bus is available.

---

## Errors

| Layer            | Behavior                                                                                                                                                                                                                                                                                                                                                                |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Domain           | Returns `Result<T, DomainError>`. Never throws.                                                                                                                                                                                                                                                                                                                         |
| Application      | Throws tagged errors on `Result.isErr()`. Awaits async normally.                                                                                                                                                                                                                                                                                                        |
| Infrastructure   | Catches library errors, translates to tagged errors or lets them bubble.                                                                                                                                                                                                                                                                                                |
| Server functions | Catches tagged errors, pattern-matches `_tag` and `code`, **throws an `Error`** with `.name`, `.message`, `.code`, and `.status` properties. TanStack Start serializes Errors via seroval and re-throws on the client, so mutations fail correctly. `resolveTenantContext` (auth middleware) uses the same `Error` throwing path — auth failures are not plain objects. |

Tagged error shape: `{ _tag: 'XxxError', code: '<reason>', message: string, context?: Record<string, unknown> }`. Errors built only via the smart constructor (e.g., `portalError(code, message)`).

Translate errors to HTTP using `match(e.code).with(...).exhaustive()` so adding a new code forces a compiler-checked update.

**Never return `{ success: false, error: message }` from server functions.** Always throw Error objects. TanStack Start's seroval serialization transports them to the client where mutations fail and `mutation.error` is populated with the Error (including `.message`).

---

## Naming

| Thing                | Convention                   | Example                                |
| -------------------- | ---------------------------- | -------------------------------------- |
| Files                | lowercase-hyphen             | `create-portal.ts`                     |
| Test files           | `.test.ts` suffix, colocated | `rules.test.ts`                        |
| Types                | PascalCase                   | `Portal`, `PortalRepository`           |
| Branded IDs          | PascalCase                   | `PortalId`, `OrganizationId`           |
| Functions            | camelCase                    | `createPortal`, `validateSlug`         |
| Use case factories   | `xxxYyy` (verb-noun)         | `createPortal`, `submitFeedback`       |
| Domain constructors  | `buildXxx`                   | `buildPortal`, `buildMetricReading`    |
| Event constructors   | past-tense matches `_tag`    | `portalCreated`, `reviewReceived`      |
| Error constructors   | `xxxError`                   | `portalError`, `reviewError`           |
| Repository factories | `createXxxRepository`        | `createPortalRepository`               |
| Domain events        | `<context>.<verb-past>`      | `portal.created`, `feedback.submitted` |
| Job names            | `<verb>-<noun>`              | `sync-reviews`, `process-hero-image`   |
| Form components      | `<Verb><Noun>Form`           | `CreatePortalForm`, `LoginForm`        |
| DB tables            | snake_case plural            | `portals`, `metric_readings`           |
| DB columns           | snake_case                   | `organization_id`, `created_at`        |

Exception: better-auth tables use camelCase columns (framework default). Everything else is snake_case.

Every business table includes: `id`, `organization_id`, `created_at`, `updated_at`. Soft-deletable tables include `deleted_at`.

---

## Dependency rules (enforced by lint)

- `domain/` imports nothing outside `domain/` and `shared/domain/`.
- `application/` imports from `domain/`, `shared/domain/`, `shared/events/`, and may import **type-only** from another context's `application/public-api.ts` (per ADR-0001).
- `infrastructure/` imports from `domain/`, `application/`, `shared/`, external libs.
- `server/` imports from `application/` (use cases, dtos), `shared/`, TanStack Start.
- `routes/` imports from `contexts/<ctx>/server/` (server functions only — not domain, application, infrastructure), `components/`, `shared/`.
- `components/` imports from other `components/`, `shared/`, `contexts/<ctx>/application/dto/` (to derive form schemas). Never from domain, application (non-dto), infrastructure, or server.
- `shared/` imports from itself and external libs only. **Exception:** `shared/events/events.ts` imports context event types (`domain/events.ts`) to build the master `DomainEvent` union — this is the only allowed cross-context type import in shared.
- `contexts/<ctx>/build.ts` may import **type-only** from another context's `application/public-api.ts` to declare it as a dependency. It imports its own use cases, ports, and repositories by value.

Forbidden:

- `contexts/A/<non-server-non-dto-non-public-api>` from `contexts/B/*` (exception: `contexts/A/application/public-api.ts` types are allowed in `contexts/B/application/` and `contexts/B/build.ts`)
- `drizzle-orm` outside `infrastructure/`
- React outside `routes/` and `components/`
- Direct DB access in `routes/` or `components/`
- `shared/testing/*` from production code

---

## Testing

| Layer            | Type                                     | Test-first?                       |
| ---------------- | ---------------------------------------- | --------------------------------- |
| Domain           | Pure unit, no setup                      | Yes, always                       |
| Use cases        | Unit with in-memory port fakes           | Yes, default                      |
| Repositories     | Integration vs real Postgres             | Test-after, but always test       |
| Adapters         | Integration with mocked external API     | Test-after                        |
| Server functions | Integration through TanStack Start       | Test-after critical paths         |
| Forms            | Component tests with user-event, minimal | Test-after for complex validation |
| UI (other)       | Sparse, pragmatic                        | No                                |
| E2E              | Playwright critical flows                | No, after feature works           |

Required per context: 100% coverage on domain rules / constructors / errors. Every use case tested for happy path + every error path. Every repository method has integration test. Tenant isolation test per repository.

Tests colocated: `rules.ts` next to `rules.test.ts`.

---

## Anti-patterns

- Adding non-orchestration logic to a use case → belongs in `domain/`.
- Repository importing another context's types → boundary is wrong, or relationship is application-level.
- Inlining a query in a route → always go through a server function.
- Skipping the port "for now" when there's real domain logic → couples use case to implementation, breaks testability. (Different from intentional thin delegation in wrapper contexts, which is fine.)
- Event handler in the emitting context → handlers belong in the receiving context.
- Putting code in `shared/` "we might need it" → wait for the second importer.
- Throwing plain `Error` → always tagged errors.
- Returning `{ success: false, error: message }` from server functions → always throw Error objects (TanStack Start serializes them for the client).
- Duplicating the Zod schema between form and server function → derive the form schema from the DTO schema using `.required()` / `.extend()` / `.omit()` (see `docs/patterns.md` section 30).
- Calling server functions directly from forms without `useServerFn` → always wrap in `useServerFn`.
- Managing form `isSubmitting` state manually → use `useServerFn` status.
- Fetching route data inside components with `useQuery` instead of a route `loader` → route loaders run on SSR, block navigation, and cache data in the router.
- Using React Hook Form, Formik, or plain `useState` for forms → use TanStack Form.
- `as` casts to non-branded types → types are wrong; fix them with parsing or `Result`.
- Using a class → should be a record of functions returned by a factory.
- Skipping a domain or use case test "it's obvious" → those are the cheapest tests; write them.
- Forcing every operation through 4 layers when 2 will do → ceremony, not architecture. See "When to skip layers".
- Forcing thin operations into the full pattern for symmetry → ceremony; skip absent steps.
- Inlining business logic into server functions to avoid "a one-line use case" → use a thin use case.
- Using `new Date()` in a use case → inject `clock` as a dependency. `new Date()` breaks test determinism.
- Following an AI suggestion that doesn't match this doc or existing code → ask whether it fits before accepting.

---

## Core principles

These principles drive every architectural decision. When in doubt, return to these.

1. **Bounded contexts before layers.** Code belongs to a business concept before it belongs to a technical layer. Group by what the code is _about_, not what it _is_.
2. **Pure core, effectful edges.** Domain logic is pure functions of their inputs. Effects (I/O, async, throws) happen only at the boundaries.
3. **Dependencies point inward.** Presentation depends on application; application depends on domain; infrastructure implements ports defined by application. Domain depends on nothing.
4. **Tenancy is non-negotiable.** Every repository method takes `organizationId` as a mandatory parameter. There is no "get by ID" without a tenant.
5. **Functional style, pragmatic at edges.** No classes, immutability by default, `Result` types in the domain, explicit dependencies via factory functions.
6. **Tests come from structure.** The architecture is designed so domain code is trivially testable, use cases are testable with in-memory port implementations, and integration tests verify infrastructure.
7. **Explicit over implicit.** No DI containers, no auto-wiring, no decorators. Dependencies are passed as function arguments. The wiring is in `composition.ts`.
8. **Conventional, not clever.** Choose boring, well-documented patterns over clever abstractions.
9. **Proportional layering.** A use case with real domain logic uses the full 7-step pattern. A use case that's only an authorization check is a one-liner. Ceremony for symmetry is an anti-pattern.
10. **Shared schemas, single source of truth.** The Zod schemas in `application/dto/` are used for both server-side validation and client-side form validation. Never duplicate the shape.

---

## Composition root

`composition.ts` is the only place where the full dependency graph is wired together.

- No DI framework, no decorators, no auto-wiring
- All dependencies visible in one file
- Each context has a `build.ts` that wires its own repos, use cases, and optional PublicApi surface. The composition root calls these build functions in dependency order and passes PublicApi surfaces between contexts (per ADR-0001).
- Easy to substitute parts in tests (build a test container with in-memory repos)
- `bootstrap.ts` registers event handlers and job handlers separately from construction
- The event bus is passed to every use case that emits events via the `events` dependency

---

## When in doubt

1. Read existing context code for the pattern.
2. Re-read this doc.
3. If still unclear, check `docs/patterns.md` for examples.
4. If the docs don't answer it, decide deliberately and update the doc _before_ writing the code.
