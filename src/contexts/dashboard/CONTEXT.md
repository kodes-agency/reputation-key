# Dashboard Context

Read-only aggregation surface for property-level and portal-level analytics. No writes, no events, no domain rules — pure query orchestration.

## Glossary

- **DashboardData** — The full property dashboard response: KPIs, rating distribution, trends, reply performance, engagement funnel, recent reviews.
- **PortalAnalyticsData** — Portal-scoped analytics: portal KPIs, engagement funnel, rating distribution, rating trend. No review/reply data.
- **KPIValue** — A metric with current value, prior value, and trend percentage. Used for the KPI strip.
- **PortalKPIs** — Portal-scoped KPIs: scans, avg rating, feedback, review link clicks.
- **DashboardReplyStatus** — Simplified reply status for the dashboard: `'none'`, `'draft'`, `'published'`.
- **EngagementFunnel** — Scans → ratings → review link clicks. Portal-scoped; only available when a portal is selected.
- **MetricStatsPort** — Facade port for querying metric_readings data (sums by period/portal).
- **ReviewStatsPort** — Facade port for querying review/reply aggregate data (counts, ratings, reply performance, recent reviews).
- **PortalMetricsPort** — Facade port for portal-scoped metric queries (KPI sums, rating distribution, rating trend).

## Architecture layers

```
dashboard/
  domain/              types.ts, errors.ts
  application/
    ports/             dashboard.repository.ts, metric-stats.port.ts, review-stats.port.ts, portal-metrics.port.ts
    dto/               dashboard.dto.ts (Zod schemas)
    use-cases/         get-dashboard-data.ts, get-portal-analytics.ts
    public-api.ts      re-exports domain types
  infrastructure/
    adapters/          metric-stats.adapter.ts, review-stats.adapter.ts, portal-metrics.adapter.ts
    repositories/      dashboard.repository.ts (Drizzle)
  server/              dashboard.ts, portal-analytics.ts
  build.ts             composition root
```

## Facade ports

Dashboard defines three facade ports (per ADR-0007 / ADR-0008) for cross-context data:

- **MetricStatsPort** — sums of metric readings by period/portal, implemented by metric context adapter.
- **ReviewStatsPort** — review counts, rating distribution, reply performance, recent reviews, implemented by review context adapter.
- **PortalMetricsPort** — portal-scoped metric sums, rating distribution, and rating trend. Implemented by portal-metrics.adapter.ts.

All ports are injected at composition time via `buildDashboardContext()`.

## Public API

Exported from `application/public-api.ts`:

- Types: `KPIValue`, `RecentReview`, `DashboardReplyStatus`, `DashboardData`, `PortalKPIs`, `PortalAnalyticsData`

## Use cases

| Use case              | Input                                            | Output                | Description                                                                                         |
| --------------------- | ------------------------------------------------ | --------------------- | --------------------------------------------------------------------------------------------------- |
| `getDashboardData`    | orgId, propertyId, portalId?, startDate, endDate | `DashboardData`       | Orchestrates all repo queries in parallel; engagement funnel + portal-scoped KPIs when portal set   |
| `getPortalAnalytics`  | orgId, propertyId, portalId, startDate, endDate  | `PortalAnalyticsData` | Portal-scoped analytics: KPIs, funnel, rating distribution, rating trend. No review/reply data.    |

## Server functions

| Function               | Method | Permission       | Route                                              |
| ---------------------- | ------ | ---------------- | -------------------------------------------------- |
| `getDashboardDataFn`   | GET    | `dashboard.read` | Property-scoped dashboard data with time range     |
| `getPortalAnalyticsFn` | GET    | `dashboard.read` | Portal-scoped analytics data with time range       |

## Permissions

| Permission       | AccountAdmin | PropertyManager | Staff |
| ---------------- | ------------ | --------------- | ----- |
| `dashboard.read` | ✓            | ✓               | ✓     |

## Dependencies (inbound)

- Identity context — resolves tenant context from session
- Property context — property ownership check (implicit via tenant context)

## Dependencies (outbound, via ports)

- Metric context — `MetricStatsPort` (metric sums by period/portal)
- Review context — `ReviewStatsPort` (review stats, reply performance, recent reviews)
- Portal metrics — `PortalMetricsPort` (portal-scoped KPI sums, rating distribution, rating trend)

## Invariants

- Read-only: no mutations, no events produced, no event handlers.
- Prior period is computed as `same duration immediately before current period`.
- Engagement funnel returns `null` when no portal is selected (property dashboard).
- Engagement funnel uses `portal.rating` for the ratings step (NOT `portal.feedback`).
- Dashboard never queries other contexts' tables directly — only through facade ports.
- When `portalId` is provided to `getKPIs`, metric queries (scans, feedback) are portal-scoped. Review KPIs (reviews, avgRating) remain property-scoped.
