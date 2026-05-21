# PRD: Phase 13 — Metrics Foundation

## Problem Statement

Managers have no visibility into how their portals are performing. Scans, ratings, feedback, and review link clicks are tracked as raw events in the database, but there is no aggregated view of these metrics over time. Without metrics, the dashboard (Phase 14) has nothing to display, goals (Phase 15) have nothing to measure, and gamification (Phase 16) has nothing to reward.

Additionally, staff and teams are currently assigned at the property level only. This prevents per-portal attribution of metrics to individual staff members or teams — a requirement for goals and leaderboards.

## Solution

Build a metrics pipeline that captures guest journey events and review arrival events as raw metric readings, pre-computes daily and weekly aggregates via materialized views, and enables per-staff and per-team attribution by extending staff and team assignments to the portal level.

The pipeline is: **event → handler → raw reading → background refresh → materialized view → dashboard query**.

## User Stories

### Metric Data Collection

1. As a manager, I want every portal scan recorded as a metric, so that I can track traffic over time
2. As a manager, I want every guest rating recorded as a metric, so that I can track satisfaction over time
3. As a manager, I want every feedback submission recorded as a metric, so that I can track private feedback volume over time
4. As a manager, I want every review link click recorded as a metric, so that I can track conversion from scan to external review
5. As a manager, I want every new Google review recorded as a metric, so that I can track review volume and average rating per property
6. As a manager, I want metric readings stored with raw values (not pre-aggregated), so that materialized views can compute any aggregation needed
7. As the system, I want metric readings stored at the portal level where applicable, so that attribution to staff and teams per portal is possible

### Staff and Team Portal Assignment

8. As an AccountAdmin, I want to assign staff members to a specific portal (not just a property), so that I can attribute that portal's metrics to those staff members
9. As an AccountAdmin, I want to assign a team to a specific portal, so that I can attribute that portal's metrics to the team
10. As an AccountAdmin, I want staff without a portal assignment to cover all portals on their assigned property (backward compatible), so that existing assignments still work
11. As a PropertyManager, I want to see which staff are responsible for which portals, so that I can manage coverage

### Aggregated Metrics

12. As a manager, I want daily aggregated metrics pre-computed, so that dashboard queries are fast
13. As a manager, I want weekly aggregated metrics pre-computed, so that trend analysis is fast
14. As a manager, I want scan count, average rating, feedback count, review count, and conversion rate derivable from the aggregates, so that I see a complete picture of portal performance
15. As a manager, I want rating distribution (1-5 breakdown) derivable from aggregates, so that I can see if ratings are skewed
16. As a manager, I want inbox KPIs (new items, addressed count, average response time) pre-computed daily, so that I can track team responsiveness without hitting the inbox items table directly
17. As the system, I want metrics aggregated hourly, so that dashboard data is at most 1 hour stale

### Tenant Isolation

18. As a manager, I want my organization's metrics completely isolated from other organizations, so that I never see another tenant's data
19. As a PropertyManager, I want to see only metrics for my assigned properties, so that I'm scoped to my responsibilities
20. As a Staff member, I want to see only metrics for my assigned properties/portals, so that my view matches my scope

### Operational

21. As the system, I want metric definitions registered in a table, so that only known metric keys can be recorded
22. As the system, I want materialized view refreshes to run as background jobs on a schedule, so that aggregation is automated
23. As a developer, I want the metric context to follow the same bounded context structure as other contexts, so that the architecture is consistent

## Implementation Decisions

### 1. New bounded context: `metric`

The metric context follows the established pattern (review, inbox). It owns:

- Domain types for metric keys, entity levels, value types
- A repository port for inserting readings and querying aggregates
- A `record-metric` use case that validates metric keys against definitions
- 5 event handlers subscribing to guest and review events
- 3 background jobs for materialized view refresh
- A build function that wires dependencies and returns a public API

The metric context consumes events but does not emit any.

### 2. Schema: `metric_definitions`

Static registry of known metric keys. Seeded with 5 built-in definitions. Supports future custom metrics (CRUD deferred).

Columns: `id (uuid PK)`, `metric_key (varchar, unique)`, `display_name (varchar)`, `entity_level ('portal' | 'property')`, `value_type ('count' | 'rating')`, `description (text)`.

### 3. Schema: `metric_readings`

Raw event-level readings. No partitioning at MVP scale. One row per event.

Columns: `id (uuid PK)`, `organization_id (varchar)`, `property_id (uuid)`, `portal_id (uuid, nullable)`, `metric_key (varchar)`, `value (real)`, `recorded_at (timestamptz)`.

`portal_id` is null for property-level metrics (reviews). Compound index on `(organization_id, metric_key, recorded_at)`.

No `team_id` or `user_id` columns — attribution is derived at query time by joining through `staff_assignments`/`teams`, not denormalized onto every reading.

### 4. Schema migration: nullable `portalId` on `staff_assignments` and `teams`

Both tables gain a nullable `portal_id` column referencing `portals.id`.

- `portal_id = null` means "covers all portals on the property" (backward compatible, existing rows unchanged)
- `portal_id = set` means "covers only that specific portal"

Unique indexes on both tables extended to include `portal_id`. This enables per-staff and per-team metric attribution at the portal level — the prerequisite for Phase 15 goals.

### 5. Event-to-metric mapping (5 handlers, 5 metric keys)

Raw readings only. Each handler inserts one row per event. All aggregation happens in materialized views.

| Event `_tag`          | `metric_key`               | `entity_level` | Raw `value`      |
| --------------------- | -------------------------- | -------------- | ---------------- |
| `scan.recorded`       | `portal.scan`              | portal         | `1`              |
| `rating.submitted`    | `portal.rating`            | portal         | Star value (1-5) |
| `feedback.submitted`  | `portal.feedback`          | portal         | `1`              |
| `review-link.clicked` | `portal.review_link_click` | portal         | `1`              |
| `review.created`      | `property.review`          | property       | Star value (1-5) |

No handlers for: `review.updated`, `review.expired`, inbox events, or admin/lifecycle events.

### 6. Materialized views (3 views, raw SQL migrations)

**`mv_daily_metrics`**: One row per `(organization_id, property_id, portal_id, metric_key, date)`. Columns: `count`, `sum_value`, `avg_value`. Refreshed hourly.

**`mv_weekly_metrics`**: Same shape aggregated by ISO week. Refreshed daily.

**`mv_daily_inbox_metrics`**: Computed directly from `inbox_items` table (no `metric_readings` involved). Columns: `organization_id, property_id, date, new_count, addressed_count, avg_response_hours`. Refreshed hourly.

All views use plain `REFRESH MATERIALIZED VIEW` (not `CONCURRENTLY`). Brief read lock during refresh is acceptable at MVP scale.

### 7. Background jobs (3 jobs)

All follow the existing BullMQ job pattern (see `refresh-expiring-reviews.job.ts` for prior art).

- `refreshDailyMetrics` — hourly, refreshes `mv_daily_metrics`
- `refreshWeeklyMetrics` — daily, refreshes `mv_weekly_metrics`
- `refreshDailyInboxMetrics` — hourly, refreshes `mv_daily_inbox_metrics`

### 8. Composition wiring

`composition.ts` builds the metric context after existing contexts, passing `db`, `events`, `clock`, and `jobQueue`. Event handlers are registered via `registerMetricHandlers()`. Jobs are registered in the job registry.

### 9. Derived metrics (computed by views, not stored)

From `mv_daily_metrics` the dashboard can derive:

- Scan count = `count` where `metric_key = 'portal.scan'`
- Average rating = `avg_value` where `metric_key = 'portal.rating'`
- Feedback count = `count` where `metric_key = 'portal.feedback'`
- Review link clicks = `count` where `metric_key = 'portal.review_link_click'`
- Conversion rate = clicks / scans (join two rows in view)
- Review count = `count` where `metric_key = 'property.review'`
- Average review rating = `avg_value` where `metric_key = 'property.review'`
- Rating distribution = `count ... GROUP BY value` where `metric_key = 'portal.rating'`

From `mv_daily_inbox_metrics`: new item volume, response rate (addressed / new), average response time in hours.

### 10. Context structure

```
src/contexts/metric/
├── CONTEXT.md
├── domain/
│   └── types.ts
├── application/
│   ├── ports/
│   │   └── metric.repository.ts
│   └── use-cases/
│       └── record-metric.ts
├── infrastructure/
│   ├── event-handlers/
│   │   ├── on-scan-recorded.ts
│   │   ├── on-rating-submitted.ts
│   │   ├── on-feedback-submitted.ts
│   │   ├── on-review-link-clicked.ts
│   │   ├── on-review-created.ts
│   │   └── index.ts
│   ├── jobs/
│   │   ├── refresh-daily-metrics.job.ts
│   │   ├── refresh-weekly-metrics.job.ts
│   │   └── refresh-daily-inbox-metrics.job.ts
│   └── repositories/
│       └── metric.repository.ts
├── build.ts
└── CONTEXT.md
```

## Testing Decisions

### What makes a good test

Tests verify external behavior (input → output), not implementation details. Event handler tests verify the correct repository call is made given a specific event payload. Integration tests verify materialized views produce correct aggregates given seeded data. No tests assert on internal variable names, function structure, or SQL syntax.

### Modules to test

| Module                    | Test type                                                                             | Prior art                                       |
| ------------------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------- |
| Event handlers (5)        | Unit — mock event → verify `insertReading` call with correct `metric_key` and `value` | `on-property-created.test.ts` in review context |
| `record-metric` use case  | Unit — validates metric_key exists in definitions, inserts reading                    | `sync-reviews` use case tests in review context |
| Materialized view refresh | Integration — seed readings → run refresh SQL → query view → verify aggregates        | `refresh-expiring-reviews.job.test.ts`          |
| Inbox materialized view   | Integration — seed `inbox_items` → run refresh → verify counts and response times     | Same pattern                                    |
| Tenant isolation          | Integration — two orgs' readings → refresh → verify no cross-contamination            | `inbox` context tenant isolation tests          |
| Background jobs           | Integration — verify jobs register and run without error                              | Review job tests                                |

### Modules NOT tested (deferred)

- E2E spanning full pipeline (scan → reading → refresh → dashboard query) — deferred to Phase 14 when dashboard exists
- Performance tests with 1M+ rows — deferred to Phase 22 with partitioning

## Out of Scope

- **Dashboard UI** — Phase 14
- **Table partitioning** — Deferred to Phase 22 or when 500+ properties. Compound index on `(organization_id, metric_key, recorded_at)` handles MVP scale.
- **`CONCURRENTLY` refresh** — Deferred to Phase 22. Plain refresh is acceptable at MVP scale.
- **Custom metric registration** — Schema supports it (`metric_definitions` table), but CRUD API and UI deferred until a real use case emerges.
- **E2E tests** — Deferred to Phase 14 when dashboard provides a surface to test against.
- **Review `review.updated` and `review.expired` events** — Metrics only track arrivals, not mutations or expirations.
- **Inbox event readings** — Inbox KPIs computed directly from `inbox_items` table, no metric readings.
- **Admin/lifecycle events** (property/team/staff CRUD, portal lifecycle, integration connections) — Not business metrics.
- **Analytics page** — Arc 8.
- **Leaderboards** — Arc 6.

## Further Notes

### Build order within this phase

1. Migration: add `portalId` to `staff_assignments` + `teams` (nullable FK)
2. Schema: `metric_definitions` + `metric_readings` tables (Drizzle)
3. Seed: 5 built-in metric definitions
4. Event handlers: 5 handlers inserting raw readings
5. Materialized views: 3 views (raw SQL migrations)
6. Background jobs: 3 refresh jobs
7. Wire in `composition.ts`
8. Tests

### Attribution chain for Phase 15 (Goals)

Portal metrics → `propertyId` → `staff_assignments` → `userId` (per-staff metrics)
Portal metrics → `propertyId` → `teams` → team members (per-team metrics)
Review metrics → `propertyId` → same chain (per-property, then per-staff/team)
Organization metrics → `organizationId` directly from event payload.

If a property has multiple staff, metrics are shared across all of them at the property level. Per-portal attribution is enabled by the `portalId` FK on assignments.

### ADR recommendation

Consider an ADR for the "raw readings + materialized views" approach vs. pre-computed metrics. This is the most architecturally significant decision in this phase: it affects every future metric consumer (dashboard, goals, gamification, analytics). The key trade-off is write simplicity (trivial handlers) vs. read latency (hourly staleness, refresh cost).

### Estimated effort

5-7 days. Materialized view SQL and event handler wiring are straightforward. Portal-level assignment migration is small.
