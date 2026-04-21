# Conventions

The rules. For the *why*, see `docs/architecture.md`.

---

## Stack

TanStack Start (SSR + server functions + routing) on Railway Node. Drizzle + Neon Postgres. better-auth (organization plugin, DB-backed sessions). BullMQ + Redis for jobs, rate limiting, and caching. Cloudflare R2 for storage. Resend for email. FCM for push. Anthropic for AI. Pure functional style; `neverthrow` for `Result`, `ts-pattern` for union dispatch, `Zod` for HTTP-boundary validation.

---

## Folder structure

~~~
src/
  contexts/<name>/
    domain/          types.ts, rules.ts, constructors.ts, events.ts, errors.ts
    application/
      ports/         repository and external-service interfaces
      dto/           Zod input/output schemas
      use-cases/     one file per user action
    infrastructure/
      repositories/  Drizzle implementations of ports
      mappers/       row ↔ domain (pure)
      jobs/          BullMQ job handlers
      event-handlers/ subscribers to domain events
      <service>/     external service adapters (storage, ai, gbp, ...)
    server/          TanStack Start server functions
  shared/
    domain/          brand, ids, result, pattern, errors, clock
    events/          event bus, master event union
    db/              client, schema/<context>.schema.ts, migrations
    auth/            better-auth config, AuthContext, middleware
    jobs/            queue, worker, registry
    cache/           redis client, cache port + impl
    rate-limit/      middleware
    observability/   logger (pino), sentry
    config/          env zod schema
    fn/              pipe and other utilities
    testing/         in-memory port fakes, fixtures, db helpers
  routes/            TanStack Router file-based routes
  components/        ui/, layout/, forms/, features/<context>/
  composition.ts     dependency wiring
  bootstrap.ts       event/job handler registration
  server.ts          web entry
  worker.ts          worker entry
~~~

---

## Bounded contexts

`identity`, `property`, `team`, `staff`, `portal`, `guest`, `review`, `metric`, `gamification`, `notification`, `ai`, `audit`.

Each context owns its data, rules, events, errors, and public API. Contexts communicate via domain events. Cross-context type imports allowed for events only.

---

## The four layers

| Layer | Contains | Forbidden |
|---|---|---|
| `domain/` | Types, pure rules, smart constructors, events, errors | `async`, I/O, framework imports, `throw`, mutation |
| `application/` | Use cases, port interfaces, DTOs | DB queries, HTTP code, React, reimplementing domain rules |
| `infrastructure/` | Repository impls, mappers, adapters, job handlers, event handlers | Business rules, HTTP routing, React |
| `server/` | TanStack Start server functions | Business logic, direct DB access, domain rules |

Dependencies point inward: `routes` → `server` → `application` → `domain`. Infrastructure implements `application` ports. Domain depends on nothing outside itself and `shared/domain/`.

---

## Where does this code go?

| What you're writing | Where it goes |
|---|---|
| Pure function, business rule | `contexts/<ctx>/domain/rules.ts` |
| Pure function, builds an entity | `contexts/<ctx>/domain/constructors.ts` |
| Entity type | `contexts/<ctx>/domain/types.ts` |
| Domain event | `contexts/<ctx>/domain/events.ts` |
| Tagged error | `contexts/<ctx>/domain/errors.ts` |
| Use case (one user action) | `contexts/<ctx>/application/use-cases/<verb-noun>.ts` |
| Repository or service interface | `contexts/<ctx>/application/ports/` |
| Zod schema for HTTP input/output | `contexts/<ctx>/application/dto/` |
| Drizzle repository implementation | `contexts/<ctx>/infrastructure/repositories/` |
| Row ↔ domain mapper | `contexts/<ctx>/infrastructure/mappers/` |
| External service adapter (R2, GBP, AI, ...) | `contexts/<ctx>/infrastructure/<service>/` |
| BullMQ job handler | `contexts/<ctx>/infrastructure/jobs/<name>.job.ts` |
| Event subscriber | Receiving context's `infrastructure/event-handlers/` |
| TanStack Start server function (auth) | `contexts/<ctx>/server/<noun>.ts` |
| TanStack Start server function (public) | `contexts/<ctx>/server/public-<noun>.ts` |
| Drizzle table | `shared/db/schema/<ctx>.schema.ts` |
| URL route | `routes/` (matches URL path) |
| Generic UI primitive | `components/ui/` |
| Feature-specific component | `components/features/<feature>/` |
| Cross-context utility (used 2+ times) | `shared/<concern>/` |

If a file would import from two contexts' internals, you're doing something wrong. Use events or rethink the boundary.

---

## Functional style

**Locked:**
- No `class`. No `this`. No inheritance. No `enum` (use string literal unions).
- `readonly` on all domain type fields. `ReadonlyArray<T>` for arrays in domain.
- Immutable updates only. Never mutate parameters.
- Discriminated unions tagged with `_tag`.
- `Result<T, E>` from neverthrow in domain. Throw tagged errors at application boundary.
- `match(...).exhaustive()` from ts-pattern for all union dispatch.
- Repositories are records of functions returned by factory functions: `createXxxRepository(db)`.
- Use cases are factory functions: `(deps) => async (input, ctx) => Promise<T>`.

**Pragmatic:**
- `async/await` allowed in application and infrastructure.
- Closures over mutable state allowed in infrastructure (event bus, etc.) when hidden behind a pure interface.
- React hooks not purified.

**Forbidden:**
- `class` (except React error boundaries if absolutely required).
- `enum`.
- Mutation of function parameters.
- Implicit `any`.
- `as` casts except for branded ID parsing.
- `// @ts-ignore` without an explanatory comment.

---

## Tenant isolation

1. Every business table has `organization_id` (non-null).
2. Every repository method takes `organizationId: OrganizationId` as the first parameter.
3. Every repository query filters `WHERE organization_id = $1 AND deleted_at IS NULL` (use `baseWhere(orgId)` helper).
4. `tenantMiddleware` resolves org from session and attaches to `AuthContext`.
5. Public routes resolve org from URL slug, validate, use a separate middleware pipeline.
6. Every repository has an integration test that attempts a cross-tenant query and asserts empty result.

No ambient tenant context. No inferring tenant from entity ID. Always explicit.

---

## Use case shape

Every use case follows this order:

1. Authorize (call domain rule)
2. Validate referenced entities exist (call repos)
3. Check uniqueness / business invariants (call repos)
4. Build domain object via smart constructor (returns `Result`, throw tagged error on `.isErr()`)
5. Persist (call repo)
6. Emit event
7. Return result

Steps 1–6 may not all apply, but the order holds when present.

---

## Events

- Past-tense facts: `portal.created`, `review.received`, `goal.achieved`. Never commands.
- Live in emitting context's `domain/events.ts`. Master union in `shared/events/events.ts`.
- Constructors enforce the `_tag`: `portalCreated({ ... })`.
- Subscribers live in **receiving** context's `infrastructure/event-handlers/`.
- Handlers are idempotent.
- Handlers don't throw; they log.
- For durable / scheduled / retryable work, the handler enqueues a BullMQ job rather than doing the work inline.

---

## Errors

| Layer | Behavior |
|---|---|
| Domain | Returns `Result<T, DomainError>`. Never throws. |
| Application | Throws tagged errors on `Result.isErr()`. Awaits async normally. |
| Infrastructure | Catches library errors, translates to tagged errors or lets them bubble. |
| Server functions | Catches tagged errors, pattern-matches `_tag` and `code`, returns HTTP response. |

Tagged error shape: `{ _tag: 'XxxError', code: '<reason>', message: string, context?: Record<string, unknown> }`. Errors built only via the smart constructor (e.g., `portalError(code, message)`).

Translate errors to HTTP using `match(e.code).with(...).exhaustive()` so adding a new code forces a compiler-checked update.

---

## Naming

| Thing | Convention | Example |
|---|---|---|
| Files | lowercase-hyphen | `create-portal.ts` |
| Test files | `.test.ts` suffix, colocated | `rules.test.ts` |
| Types | PascalCase | `Portal`, `PortalRepository` |
| Branded IDs | PascalCase | `PortalId`, `OrganizationId` |
| Functions | camelCase | `createPortal`, `validateSlug` |
| Use case factories | `xxxYyy` (verb-noun) | `createPortal`, `submitFeedback` |
| Domain constructors | `buildXxx` | `buildPortal`, `buildMetricReading` |
| Event constructors | past-tense matches `_tag` | `portalCreated`, `reviewReceived` |
| Error constructors | `xxxError` | `portalError`, `reviewError` |
| Repository factories | `createXxxRepository` | `createPortalRepository` |
| Domain events | `<context>.<verb-past>` | `portal.created`, `feedback.submitted` |
| Job names | `<verb>-<noun>` | `sync-reviews`, `process-hero-image` |
| DB tables | snake_case plural | `portals`, `metric_readings` |
| DB columns | snake_case | `organization_id`, `created_at` |

Every business table includes: `id`, `organization_id`, `created_at`, `updated_at`. Soft-deletable tables include `deleted_at`.

---

## Dependency rules (enforced by lint)

- `domain/` imports nothing outside `domain/` and `shared/domain/`.
- `application/` imports from `domain/`, `shared/domain/`.
- `infrastructure/` imports from `domain/`, `application/`, `shared/`, external libs.
- `server/` imports from `application/` (use cases, dtos), `shared/`, TanStack Start.
- `routes/` imports from `server/`, `components/`, `shared/`. Never from contexts directly.
- `components/` imports from other `components/`, `shared/`. Never from contexts.
- `shared/` imports from itself and external libs only.

Forbidden:
- `contexts/A/*` from `contexts/B/*` (use events, or cross-context **types** for events only)
- `drizzle-orm` outside `infrastructure/`
- React outside `routes/` and `components/`
- Direct DB access in `routes/` or `components/`
- `shared/testing/*` from production code

---

## Testing

| Layer | Type | Test-first? |
|---|---|---|
| Domain | Pure unit, no setup | Yes, always |
| Use cases | Unit with in-memory port fakes | Yes, default |
| Repositories | Integration vs real Postgres | Test-after, but always test |
| Adapters | Integration with mocked external API | Test-after |
| Server functions | Integration through TanStack Start | Test-after critical paths |
| UI | Sparse, pragmatic | No |
| E2E | Playwright critical flows | No, after feature works |

Required per context: 100% coverage on domain rules / constructors / errors. Every use case tested for happy path + every error path. Every repository method has integration test. Tenant isolation test per repository.

Tests colocated: `rules.ts` next to `rules.test.ts`.

---

## Anti-patterns

- Adding non-orchestration logic to a use case → belongs in `domain/`.
- Repository importing another context's types → boundary is wrong, or relationship is application-level.
- Inlining a query in a route → always go through use case.
- Skipping the port "for now" → couples use case to implementation, breaks testability.
- Event handler in the emitting context → handlers belong in the receiving context.
- Putting code in `shared/` "we might need it" → wait for the second importer.
- Throwing plain `Error` → always tagged errors.
- `as` casts to non-branded types → types are wrong; fix them with parsing or `Result`.
- Using a class → should be a record of functions returned by a factory.
- Skipping a domain or use case test "it's obvious" → those are the cheapest tests; write them.
- Following an AI suggestion that doesn't match this doc or existing code → ask whether it fits before accepting.

---

## When in doubt

1. Read existing context code for the pattern.
2. Re-read this doc.
3. If still unclear, check `docs/architecture.md`.
4. If the doc doesn't answer it, decide deliberately and update the doc *before* writing the code.
