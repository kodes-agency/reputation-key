# Shared — Context

**Audience:** AI agents and developers working in `src/shared/`.

## Folder structure

```
shared/
  domain/        brand, ids, result, errors, clock, auth-context, roles, permissions, timezones
  events/        event bus, master DomainEvent union
  db/            Drizzle client factory, pool, columns, schema/ (auth, property, team, staff-assignment, portal, audit), migrations
  auth/          better-auth config, client, headers, middleware, permissions, server session helpers, emails, server-errors
  jobs/          BullMQ queue, worker, registry
  cache/         Redis client, cache port + implementations (redis-cache, noop-cache)
  rate-limit/    middleware
  observability/ logger (pino), traced-server-fn, request-context, trace (correlation IDs, timing)
  config/        env Zod schema
  testing/       in-memory port fakes, capturing-event-bus, fixtures, integration helpers
  hooks/         usePermissions (client-side permission check hook)
```

## What goes here

Shared code is **used by 2+ modules** across the codebase. If only one context uses it, it belongs in that context. Wait for the second importer before extracting to shared.

## Auth (`shared/auth/`)

- **`auth.ts`** — better-auth server config with organization plugin and access control statement
- **`auth-client.ts`** — better-auth client instance
- **`middleware.ts`** — `resolveTenantContext(headers)` resolves org from session, returns `AuthContext`. Has a 5s TTL cache keyed by cookie header to deduplicate concurrent server function calls. Call `clearTenantCache()` at the end of each server function.
- **`permissions.ts`** — `createAccessControl(statement)` defining the universe of `resource.action` permissions
- **`auth.functions.ts`** — server-side session helpers (`getSession`)
- **`server-errors.ts`** — `throwContextError` (logs before throwing), `catchUntagged` for wrapping non-domain errors
- **`emails.ts`** — email sending via Resend

## Domain types (`shared/domain/`)

- **`ids.ts`** — branded ID types (`OrganizationId`, `PropertyId`, `PortalId`, etc.) and constructors
- **`roles.ts`** — `Role` type (`'AccountAdmin' | 'PropertyManager' | 'Staff'`), `toDomainRole()`, `hasRole()` hierarchy check
- **`permissions.ts`** — `Permission` type, `can(role, permission)` sync check. Use in server functions and route guards.
- **`auth-context.ts`** — `AuthContext` type (`{ userId, organizationId, role }`)
- **`errors.ts`** — base error types
- **`clock.ts`** — injectable clock for test determinism. Use cases receive `clock` as a dependency instead of `new Date()`.
- **`result.ts`** — neverthrow `Result` re-exports
- **`brand.ts`** — branded type helpers for nominal typing
- **`timezones.ts`** — timezone list and utilities

## Observability (`shared/observability/`)

- **`logger.ts`** — pino logger via `getLogger()`. Use everywhere instead of `console.*`.
- **`traced-server-fn.ts`** — `tracedHandler()` wraps server function handlers with:
  - ALS-based request context with correlation IDs
  - Named request spans with timing (logs at debug level)
  - Repository methods wrapped with `trace()` for query-level timing
- **`request-context.ts`** — ALS-based per-request context storage
- **`trace.ts`** — `trace()` wrapper for repository-level query timing

## Cache (`shared/cache/`)

- **`cache.port.ts`** — cache interface (`get`, `set`, `delete`)
- **`redis-cache.ts`** — Redis-backed implementation
- **`noop-cache.ts`** — no-op implementation for dev/when Redis is unavailable
- **`redis.ts`** — shared Redis client

## Testing (`shared/testing/`)

In-memory port fakes for unit testing use cases without a database:
- `in-memory-identity-port.ts`, `in-memory-property-repo.ts`, `in-memory-team-repo.ts`, `in-memory-staff-assignment-repo.ts`
- `in-memory-portal-repo.ts`, `in-memory-portal-link-repo.ts`
- `capturing-event-bus.ts` — event bus that captures emitted events for assertions
- `fixtures.ts` — test data builders
- `integration-helpers.ts` — integration test utilities

**Test-only code.** Never imported from production modules.

## Rules

- `shared/` imports from itself and external libs only
- **Exception:** `shared/events/events.ts` imports context event types to build the master `DomainEvent` union
- **Exception:** `shared/testing/` may import types from `contexts/` to implement test doubles
- Never put business logic in shared — only infrastructure and cross-cutting concerns
- Never put React code in shared (except `shared/hooks/usePermissions`)
