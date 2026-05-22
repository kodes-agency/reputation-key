# ADR 0007 — Dashboard as a Read-Only Aggregation Context

**Status:** Implemented
**Date:** 2026-05-22
**Context:** Dashboard, Read Models, Cross-Context Data Aggregation

## Decision

Treat Dashboard as a read-only aggregation context with no domain rules, no domain events, and no write operations. Dashboard queries data from other contexts (Property, Review, Staff, Identity) via facade ports and composes read models for the UI. It owns no database tables and emits no events.

## Context

The dashboard page displays summary data aggregated from multiple bounded contexts: property counts, review statistics, staff assignments, and account-level metrics. Early implementations placed dashboard queries directly in route loaders, reaching across context boundaries with ad-hoc database queries. This violated context encapsulation and created fragile, tightly-coupled code.

The business needs:

1. Dashboard must show aggregated data from Property, Review, Staff, and Identity contexts
2. Dashboard is purely presentational — it displays data created by other contexts, never creates or modifies data itself
3. Context boundaries must be respected — dashboard cannot directly query other contexts' tables
4. Performance matters — dashboard is the landing page and must load fast

## Alternatives Considered

### A. Dashboard queries in route loaders with direct DB access

Route loaders query Property, Review, and Staff tables directly. No context boundary enforcement.

- **Pros:** Simplest to implement. Fast queries. No abstraction overhead.
- **Cons:** Violates bounded context encapsulation. Route loaders coupled to other contexts' schemas. Schema changes in any context break dashboard queries. No testability boundary.

### B. Dashboard as a read-only aggregation context (chosen)

Dashboard context defines facade ports for each data source. Other contexts implement adapters. Dashboard composes read models. No writes, no events, no tables.

- **Pros:** Respects context boundaries. Dashboard unaffected by other contexts' schema changes (adapter absorbs change). Testable in isolation with port mocks. Clear ownership of aggregation logic.
- **Cons:** More abstraction. Adapter implementations required for each data source. Slightly more wiring.

### C. Materialized dashboard views with event projection

Domain events from other contexts populate a materialized dashboard view/table. Dashboard reads from its own store.

- **Pros:** Eventually consistent, decoupled, fast reads. Scales to complex aggregations.
- **Cons:** Significant infrastructure overhead (event bus, projection handlers, state store) for what is currently simple aggregation. Premature for current requirements. Eventual consistency adds UI staleness.

## Consequences

### Positive

- Context boundaries respected — dashboard never directly queries other contexts' tables
- Dashboard is trivially testable — mock ports, verify composition
- No domain events, no writes, no state — simplest possible context
- Other contexts evolve independently; adapters absorb schema changes
- Composition layer wires ports once; adding new data sources is additive

### Negative

- Adapter layer adds indirection — simple queries go through port → adapter → actual query
- Aggregation logic lives in one place, which must be understood as a cross-cutting concern
- No caching strategy defined by this ADR — performance optimization deferred to implementation

### Risks

- If dashboard aggregation becomes complex (trends, time-series, analytics), the read-only aggregation pattern may need to evolve toward materialized views (Alternative C). Migration path is clear: add a projection handler per event type.
- Port interfaces may accumulate many methods as dashboard grows — mitigate by keeping ports query-focused and composited at the use-case level.
