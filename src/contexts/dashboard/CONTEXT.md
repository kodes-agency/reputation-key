# Dashboard Context

## Bounded context

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
- **PortalMetricsPort** — Facade port for portal-scoped metric queries (KPI sums, rating distribution, rating trends).
- **StaffPortalResolverPort** — Facade port for resolving which portals a staff user has access to. Used to scope staff dashboard queries.
- **AttentionSignalsPort** — Facade port for the property attention-band counts (unanswered reviews past SLA, new feedback, escalated inbox items, goals behind pace).
- **AttentionSignals** — The five compact signal counts shown in a property's attention band.
- **FleetEntry** — One property row in the cross-property fleet overview: identity + KPI summary + attention signals + total.
- **FleetOverviewData** — The fleet overview response: attention-sorted `FleetEntry[]` + an org-total `FleetTotals` strip.
- **StaffDashboardData** — Staff-scoped dashboard response: filtered to the portals assigned to a staff user.

## Relationships

Dashboard is a read-only aggregation context with no domain entities. It queries three upstream contexts via facade ports:

- **Review context** via `ReviewStatsPort` — Aggregate review counts, ratings, reply performance, recent reviews.
- **Metric context** via `MetricStatsPort` — Summed metric readings by time period and portal.
- **Portal context** via `PortalMetricsPort` — Portal-scoped KPI sums, rating distributions, rating trends.

## Invariants

- Read-only: no mutations, no events produced, no event handlers.
- Prior period is computed as `same duration immediately before current period`.
- Engagement funnel returns `null` when no portal is selected (property dashboard).
- Engagement funnel uses `portal.rating` for the ratings step (NOT `portal.feedback`).
- Dashboard never queries other contexts' tables directly — only through facade ports.
- When `portalId` is provided to `getKPIs`, metric queries (scans, feedback) are portal-scoped. Review KPIs (reviews, avgRating) remain property-scoped.

## Events produced

None. Dashboard is a read-only query context — it does not emit domain events.

## Events consumed

None. Dashboard does not subscribe to events from other contexts. All data is fetched on-demand via facade ports when server functions are called.

## Architecture layers

```
dashboard/
  domain/              types.ts, errors.ts
  application/
    ports/             dashboard.repository.ts, metric-stats.port.ts, review-stats.port.ts, portal-metrics.port.ts, staff-portal-resolver.port.ts, attention-signals.port.ts
    use-cases/         get-dashboard-data.ts, get-portal-analytics.ts, get-staff-dashboard-data.ts, get-attention-signals.ts, get-fleet-overview.ts
    utils.ts           pure data helpers
    public-api.ts      re-exports domain types
  infrastructure/
    adapters/          metric-stats.adapter.ts, review-stats.adapter.ts, portal-metrics.adapter.ts, attention-signals.adapter.ts, staff-portal-resolver.adapter.ts
    repositories/      dashboard.repository.ts (Drizzle)
  server/              dashboard.ts, portal-analytics.ts, staff-dashboard.ts, attention-signals.ts, fleet-overview.ts
  build.ts             composition root
```

## Use cases

| Use case                | Input                                                     | Output                | Description                                                                                                                                                                                       |
| ----------------------- | --------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `getDashboardData`      | organizationId, propertyId, portalId?, startDate, endDate | `DashboardData`       | Orchestrates all repo queries in parallel; engagement funnel + portal-scoped KPIs when portal set                                                                                                 |
| `getPortalAnalytics`    | organizationId, propertyId, portalId, startDate, endDate  | `PortalAnalyticsData` | Portal-scoped analytics: KPIs, funnel, rating distribution, rating trend. No review/reply data.                                                                                                   |
| `getStaffDashboardData` | organizationId, userId, propertyId, portalId?, timeRange  | `StaffDashboardData`  | Staff-scoped dashboard aggregation filtered to assigned portals.                                                                                                                                  |
| `getAttentionSignals`   | organizationId, propertyId, slaHours, timeRange           | `AttentionSignals`    | The five attention-band signal counts for a property (unanswered, new feedback, goals behind pace, rating drop, escalated).                                                                       |
| `getFleetOverview`      | organizationId, properties[], slaHours, timeRange         | `FleetOverviewData`   | Cross-property aggregation: per-property attention + KPI summary, attention-sorted, with an org-total strip. Property identities are resolved server-side (role-aware) at the server-fn boundary. |

## Public API

Exported from `application/public-api.ts`:

- Types: `KPIValue`, `KPIs`, `RecentReview`, `DashboardReplyStatus`, `DashboardData`, `PortalKPIs`, `PortalAnalyticsData`, `StaffDashboardData`, `PortalRatingTrendPoint`, `AttentionSignals`, `FleetEntry`, `FleetOverviewData`, `FleetTotals`
- Error types: `DashboardErrorCode`, `DashboardError`, `isDashboardError`

## Server functions

| Function | Method                    | Permission | Route            |
| -------- | ------------------------- | ---------- | ---------------- | ----------------------------------------------------------------------------------------- |
|          | `getDashboardDataFn`      | GET        | `dashboard.read` | Property-scoped dashboard data with time range                                            |
|          | `getPortalAnalyticsFn`    | GET        | `dashboard.read` | Portal-scoped analytics data with time range                                              |
|          | `getStaffDashboardDataFn` | GET        | `dashboard.read` | Staff dashboard data                                                                      |
|          | `getAttentionSignalsFn`   | GET        | `dashboard.read` | Per-property attention-band signal counts                                                 |
|          | `getFleetOverviewFn`      | GET        | `dashboard.read` | Cross-property fleet overview (2+ properties); resolves accessible properties server-side |

## Permissions

| Permission       | AccountAdmin | PropertyManager | Staff |
| ---------------- | ------------ | --------------- | ----- |
| `dashboard.read` | ✓            | ✓               | ✓     |

## Ports

Dashboard defines facade ports (per ADR-0007 / ADR-0008) for cross-context data:

- **MetricStatsPort** — sums of metric readings by period/portal, implemented by metric context adapter.
- **ReviewStatsPort** — review counts, rating distribution, reply performance, recent reviews, implemented by review context adapter.
- **PortalMetricsPort** — portal-scoped metric sums, rating distribution, and rating trend. Implemented by portal-metrics.adapter.ts.
- **StaffPortalResolverPort** — resolves which portals a staff user has access to for a given property. Implemented by staff context adapter.
- **AttentionSignalsPort** — unanswered-review (past SLA), new/escalated inbox-item, and goals-behind-pace counts per property. Implemented by attention-signals.adapter.ts.

All ports are constructed inside `buildDashboardContext()` (BQC-5.2) from the injected db/clock/staffPublicApi — the composition root no longer wires individual dashboard adapters.
