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

## Implemented Facade Ports

The following facade ports are currently implemented:

### ReviewStatsPort (`application/ports/review-stats.port.ts`)

Aggregation queries against review/reply data. Implemented by `infrastructure/adapters/review-stats.adapter.ts`.

- `getPeriodStats(orgId, propertyId, startDate, endDate)` — Count + average rating for a period
- `getRatingDistribution(orgId, propertyId, startDate, endDate)` — Star-rating distribution buckets
- `getRatingTrend(orgId, propertyId, startDate, endDate)` — Daily average rating for trend chart
- `getReviewVolume(orgId, propertyId, startDate, endDate)` — Daily review count for volume chart
- `getReplyPerformance(orgId, propertyId, startDate, endDate)` — Reply rate + average reply hours
- `getRecentReviews(orgId, propertyId, limit)` — Last N reviews with reply status

### MetricStatsPort (`application/ports/metric-stats.port.ts`)

Aggregation queries against metric_readings data. Implemented by `infrastructure/adapters/metric-stats.adapter.ts`.

- `getSumsByPeriod(orgId, propertyId, startDate, endDate)` — Summed metric values by metricKey for a property
- `getSumsByPortal(orgId, propertyId, portalId, startDate, endDate)` — Summed metric values by metricKey for a portal

Both ports follow the facade pattern: dashboard's application layer depends only on the port interface, never on other contexts' database tables. Adapters in the infrastructure layer encapsulate the SQL queries.

## Consequences

### Positive

- Context boundaries respected — dashboard never directly queries other contexts' tables
- Dashboard is trivially testable — mock ports, verify composition
- No domain events, no writes, no state — simplest possible context
- Other contexts evolve independently; adapters absorb schema changes
- Composition layer wires ports once; adding new data sources is additive
- Facade ports are query-focused: `ReviewStatsPort` for review aggregations, `MetricStatsPort` for metric aggregations

### Negative

- Adapter layer adds indirection — simple queries go through port → adapter → actual query
- Aggregation logic lives in one place, which must be understood as a cross-cutting concern
- No caching strategy defined by this ADR — performance optimization deferred to implementation

### Risks

- If dashboard aggregation becomes complex (trends, time-series, analytics), the read-only aggregation pattern may need to evolve toward materialized views (Alternative C). Migration path is clear: add a projection handler per event type.
- Port interfaces may accumulate many methods as dashboard grows — mitigate by keeping ports query-focused and composited at the use-case level.
