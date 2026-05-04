# Contexts — Context

**Audience:** AI agents and developers working in `src/contexts/`.

## Bounded contexts

| Context  | Responsibility                                         | Key Entities                           | Thickness |
| -------- | ------------------------------------------------------ | -------------------------------------- | --------- |
| Identity | Users, organizations, members, invitations             | User, Organization, Member, Invitation | Thin (wraps better-auth) |
| Property | Properties (hotels/restaurants) owned by organizations | Property                               | Thick     |
| Portal   | Guest-facing portal pages with links, per property     | Portal, Link, LinkCategory             | Thick     |
| Guest    | Public portal rendering, review collection, feedback   | Review, Feedback                       | Thick     |
| Team     | Staff teams and shift management                       | Team, StaffAssignment                  | Thick     |
| Staff    | Staff assignments to properties                        | StaffAssignment                        | Standard  |

**Thin contexts** (like Identity) may have empty layer folders — no mappers, no jobs, sparse use cases. That's expected.

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

| Layer             | Contains                                              | Forbidden                                          |
| ----------------- | ----------------------------------------------------- | -------------------------------------------------- |
| `domain/`         | Types, pure rules, constructors, events, errors       | `async`, I/O, framework imports, `throw`, mutation |
| `application/`    | Use cases, port interfaces, DTOs                      | DB queries, HTTP code, React, domain rule dupes    |
| `infrastructure/` | Repository impls, mappers, adapters, jobs, handlers   | Business rules, HTTP routing, React                |
| `server/`         | TanStack Start server functions                       | Business logic, direct DB access, domain rules     |

Dependencies point inward: `server` → `application` → `domain`. Infrastructure implements application ports.

## Dependency rules

- `domain/` imports nothing outside `domain/` and `shared/domain/`.
- `application/` imports from `domain/`, `shared/domain/`, `shared/events/`.
- `infrastructure/` imports from `domain/`, `application/`, `shared/`, external libs.
- `server/` imports from `application/` (use cases, DTOs), `shared/`, TanStack Start. May import error type guards (`isXxxError`) and error code types from its own `domain/errors.ts` — the only permitted server-to-domain path.
- Cross-context: import from `application/public-api.ts` only. Never from `domain/`, `infrastructure/`, `server/`, or non-public-api `application/`.

## Use case shape

Steps in order, **including only what applies**:

1. **Authorize** — `can(ctx.role, 'resource.action')`
2. **Load referenced entities** — call repos
3. **Check invariants** — call repos
4. **Build domain object** — smart constructor, returns `Result`
5. **Persist** — call repo
6. **Emit event** — via event bus
7. **Return result**

Most use cases use 4–6 steps. Pure delegation may be just (1) + (5). Query may be just (1) + (5) + (7). Skip steps that don't apply.

Anonymous/public use cases (registration, guest flows) omit `AuthContext` — they take `(input)` not `(input, ctx)`.

### When to skip layers

| Shape | Pattern |
| ----- | ------- |
| Pure third-party delegation, no auth | Server function calls port directly (sign-in, sign-out) |
| Auth check + delegation, nothing else | Keep the use case (future logic lands here) |
| Business rules, validation, events, state | Full use case pattern |

**When in doubt, prefer the use case.**

## Server function pattern

Every server function wraps logic in `tracedHandler()`:

```typescript
export const getPortal = createServerFn({ method: 'GET' })
  .validator(getPortalDto)
  .handler(tracedHandler(async ({ data }) => {
    const ctx = await resolveTenantContext(request.headers)
    const result = await getPortalUseCase(deps)({ portalId: data.portalId }, ctx)
    clearTenantCache() // evict expired tenant cache entries
    return match(result)
      .with({ _tag: 'Ok' }, ({ value }) => ({ portal: value }))
      .with({ _tag: 'Err' }, ({ error }) => { throw mapError(error) })
      .exhaustive()
  }))
```

Key points:
- **`tracedHandler`** — wraps handler with ALS request context, correlation ID, named span with timing. From `shared/observability/traced-server-fn`.
- **`resolveTenantContext(headers)`** — resolves org from session, returns `AuthContext`. Has a 5s TTL cache keyed by cookie header to deduplicate concurrent calls during page loads.
- **`clearTenantCache()`** — evict expired entries after each server function completes.
- **Error mapping** — pattern-match `_tag` and `code`, throw `Error` with `.name`, `.message`, `.code`, `.status`. Never return `{ success: false }`.
- **`catchUntagged`** — wrap untagged errors (DB, network) that would otherwise be swallowed raw.

## Functional style

- No `class`, no `this`, no `enum`. Factory functions returning records of functions.
- `readonly` on all domain fields. `ReadonlyArray<T>` in domain.
- Discriminated unions tagged with `_tag`.
- `Result<T, E>` from neverthrow in domain. Throw tagged errors at boundaries.
- `match(...).exhaustive()` from ts-pattern for union dispatch.
- Repositories: `createXxxRepository(db)` returning a record of functions.
- Use cases: `(deps) => async (input, ctx) => Promise<T>`.

## Error pattern

Tagged error shape: `{ _tag: 'XxxError', code: '<reason>', message: string, context?: Record<string, unknown> }`.

| Layer | Behavior |
| ----- | -------- |
| Domain | Returns `Result<T, DomainError>`. Never throws. |
| Application | Throws tagged errors on `Result.isErr()`. |
| Infrastructure | Catches library errors, translates to tagged errors. |
| Server | Pattern-matches `_tag`/`code`, throws `Error` with HTTP-appropriate status. |

## Events

- Past-tense: `portal.created`, `review.received`. Never commands.
- Live in emitting context's `domain/events.ts`. Master union in `shared/events/events.ts`.
- Subscribers in **receiving** context's `infrastructure/event-handlers/`.
- Handlers are idempotent, don't throw, log via shared logger.
- Durable work → enqueue BullMQ job, don't do inline.
- Event bus wired in `composition.ts`, passed to use cases via deps.

## Testing

| Layer | Type | Required |
| ----- | ---- | -------- |
| Domain | Pure unit, no setup | Always, test-first |
| Use cases | Unit with in-memory port fakes | Default test-first |
| Repositories | Integration vs real Postgres | Test-after, always test |
| Adapters | Integration with mocked external API | Test-after |

Required: 100% domain coverage. Every use case tested for happy + error paths. Every repo has tenant isolation test. Tests colocated: `rules.ts` next to `rules.test.ts`.
