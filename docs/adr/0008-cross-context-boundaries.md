# ADR 0008 — Cross-Context Data Access Rules

**Status:** Accepted
**Date:** 2026-05-23
**Context:** Architecture, Bounded Context Boundaries

## Context

Bounded contexts must not directly query other contexts' database tables. Early implementations placed cross-context queries directly in route loaders and use cases, reaching across context boundaries with ad-hoc database queries. This violated context encapsulation and created fragile, tightly-coupled code.

The codebase has multiple bounded contexts (identity, staff, property, portal, team, guest, review, inbox, metric, goal, integration, dashboard) that need to access data owned by other contexts. Without clear rules, developers instinctively write SQL JOINs across context boundaries.

## Decision

1. **All cross-context data access goes through `public-api.ts` or dedicated lookup ports.**
   - Each context exposes a `public-api.ts` barrel that re-exports types, event constructors, and port interfaces.
   - Contexts that need data from another context define a port interface in their own `application/ports/` and consume it via dependency injection.
   - Example: Dashboard defines `ReviewStatsPort` and `MetricStatsPort`; other contexts' adapters implement them.

2. **Infrastructure adapters encapsulate SQL queries.**
   - Cross-context SQL queries are acceptable in the infrastructure layer (`infrastructure/adapters/`), where they are isolated behind port interfaces.
   - Adapters may query any table needed to fulfill the port contract — the SQL is an implementation detail.

3. **Domain and application layers never import from other contexts' internals.**
   - `domain/` and `application/` layers must only import from other contexts' `public-api.ts` or from shared kernel (`#/shared/`).
   - Direct imports from another context's `domain/`, `infrastructure/`, or `server/` layers are boundary violations.

4. **Events are the preferred mechanism for cross-context side effects.**
   - When a context needs to react to changes in another context, it subscribes to domain events via `infrastructure/event-handlers/`.
   - Event types are imported from the producing context's `public-api.ts`.

## Consequences

### Positive

- **Clear context boundaries** — Each context has a well-defined API surface. Internal schema changes don't ripple across contexts.
- **Independent schema evolution** — Contexts can add, rename, or restructure tables without breaking consumers (adapters absorb the change).
- **Centralized and auditable** — All cross-context access is visible in port interfaces and adapter implementations.
- **Testability** — Contexts can be tested in isolation by mocking port interfaces.

### Negative

- **More indirection** — Simple lookups require port → adapter → query instead of a direct JOIN.
- **More wiring** — The composition layer (`composition.ts`) must wire adapters to ports for each cross-context dependency.

### Risks

- If developers bypass ports and write direct cross-context queries, the boundary degrades. Mitigate with lint rules or architectural tests that forbid cross-context internal imports.
