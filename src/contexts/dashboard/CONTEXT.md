# Dashboard Context

## Bounded context

Read-only aggregation surface for property-level and portal-level analytics. No writes, no events, no domain rules — pure query orchestration.

## Glossary

- **DashboardData** — The full property dashboard response: KPIs, rating distribution, trends, reply performance, engagement funnel, recent reviews.
- **PortalAnalyticsData** — Portal-scoped analytics: portal KPIs, engagement funnel, private-rating distribution/trend, and content-free response-integrity counts. No review/reply data.
- **KPIValue** — A metric with current value, prior value, and trend percentage. Used for the KPI strip.
- **PortalRatingKPIValue** — A private-rating average with eligible sample counts, source evidence, and an absolute star comparison. No eligible sample renders as `null`/`—`, never zero stars.
- **PortalCountKPIValue** — A Portal count plus source evidence. Its value is nullable while the governed projection cannot safely prove a count, so incomplete data is never presented as zero.
- **PortalMetricEvidence** — Per-family availability evidence: definition version, state, completeness, correction head, and distinct Verified Through, Latest Activity, and Computed At timestamps.
- **PortalKPIs** — Portal-scoped KPIs: scans, avg rating, feedback, review link clicks.
- **DashboardReplyStatus** — Simplified reply status for the dashboard: `'none'`, `'draft'`, `'published'`.
- **EngagementFunnel** — Scans → ratings → review link clicks. Portal-scoped; only available when a portal is selected.
- **MetricStatsPort** — Facade port for querying metric_readings data (sums by period/portal).
- **ReviewStatsPort** — Facade port for querying review/reply aggregate data (counts, ratings, reply performance, recent reviews).
- **PortalMetricsPort** — Facade port for portal-scoped metric queries (KPI sums, rating distribution, rating trends).
- **PortalResponseIntegrityPort** — Guest-owned facade for current `Accepted`, `Filtered automatically`, and `Under review` response counts in the selected period.
- **StaffPortalResolverPort** — Facade port for resolving which portals a staff user has access to. Used to scope staff dashboard queries.
- **AttentionSignalsPort** — Facade port for the property attention-band counts (unanswered reviews past SLA, new feedback, escalated inbox items, goals behind pace).
- **AttentionSignals** — The five compact signal counts shown in a property's attention band.
- **FleetEntry** — One property row in the cross-property fleet overview: identity + KPI summary + attention signals + total.
- **FleetOverviewData** — The fleet overview response: attention-sorted `FleetEntry[]` + an org-total `FleetTotals` strip.
- **StaffDashboardData** — Staff-scoped dashboard response: filtered to the portals assigned to a staff user.

## Relationships

Dashboard is a read-only aggregation context with no domain entities. It queries upstream contexts via facade ports:

- **Review context** via `ReviewStatsPort` — Aggregate review counts, ratings, reply performance, recent reviews.
- **Metric context** via `MetricStatsPort` — Summed metric readings by time period and portal.
- **Portal-scoped metric read model** via `PortalMetricsPort` — KPI sums, rating distributions, and rating trends.
- **Guest context** via `PortalResponseIntegrityPort` — Content-free response-quality classification counts and no response content/session data.

## Invariants

- Read-only: no mutations, no events produced, no event handlers.
- Prior period is computed as `same duration immediately before current period`.
- Engagement funnel returns `null` when no portal is selected (property dashboard).
- Engagement funnel uses `portal.rating` for the ratings step (NOT `portal.feedback`).
- Dashboard never queries other contexts' tables directly — only through facade ports.
- Portal analytics says **Portal responses**, not unique guests. Accepted responses feed private-rating figures; filtered/under-review counts remain visible as gentle methodology, and the UI exposes no rating-exclusion action.
- Analytics periods are half-open (`start <= business time < end`). Prior/current periods share one boundary without overlap or a millisecond gap.
- Portal private-rating averages show one decimal and the eligible sample count. The comparison is an absolute star delta only when both bounded periods have at least ten eligible ratings; All Time has no comparison and no-rating renders `—`.
- Portal KPI, distribution, and trend reads use immutable governed definition versions, allowed source policy, exact quality, and the current correction tip; retracted or invalid star values cannot remain in one chart after disappearing from another.
- Portal metric families are independently `Ready`, `Updating`, `Insufficient data` (private ratings only), or `Temporarily unavailable`. A complete quiet period is Ready with zero; pending, quarantined, obsolete, or invalid governed evidence cannot silently become zero.
- `Verified Through` describes durable pipeline completeness, `Latest Activity` describes the newest business fact, and `Computed At` describes query assembly. These timestamps are not interchangeable.
- The Portal engagement funnel is derived from the same governed, correction-aware KPI population and is withheld if any required metric family is not Ready.
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
    ports/             dashboard.repository.ts, metric-stats.port.ts, review-stats.port.ts, portal-metrics.port.ts, portal-response-integrity.port.ts, staff-portal-resolver.port.ts, attention-signals.port.ts
    use-cases/         get-dashboard-data.ts, get-portal-analytics.ts, get-staff-dashboard-data.ts, get-attention-signals.ts, get-fleet-overview.ts
    utils.ts           pure data helpers (prior period, trend, rating drop, bounds)
    public-api.ts      re-exports domain types
  infrastructure/
    read-facade.ts     BQC-5.5 governed read policy: scope where-builders, attention
                       eligibility predicate, statement timeout, cache policy (none)
    adapters/          metric-stats.adapter.ts, attention-signals.adapter.ts, staff-portal-resolver.adapter.ts
    repositories/      dashboard.repository.ts (composition only — no direct table reads)
  server/              dashboard.ts, portal-analytics.ts, staff-dashboard.ts, attention-signals.ts, fleet-overview.ts
  build.ts             composition root
```

## Use cases

| Use case                | Input                                                     | Output                | Description                                                                                                                                                                                       |
| ----------------------- | --------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `getDashboardData`      | organizationId, propertyId, portalId?, startDate, endDate | `DashboardData`       | Orchestrates all repo queries in parallel; engagement funnel + portal-scoped KPIs when portal set                                                                                                 |
| `getPortalAnalytics`    | organizationId, propertyId, portalId, startDate, endDate  | `PortalAnalyticsData` | Portal-scoped analytics: KPIs, funnel, private-rating charts, and response-integrity methodology counts. No review/reply data.                                                                    |
| `getStaffDashboardData` | organizationId, userId, propertyId, portalId?, timeRange  | `StaffDashboardData`  | Staff-scoped dashboard aggregation filtered to assigned portals.                                                                                                                                  |
| `getAttentionSignals`   | organizationId, propertyId, slaHours, timeRange           | `AttentionSignals`    | The five attention-band signal counts for a property (unanswered, new feedback, goals behind pace, rating drop, escalated).                                                                       |
| `getFleetOverview`      | organizationId, properties[], slaHours, timeRange         | `FleetOverviewData`   | Cross-property aggregation: per-property attention + KPI summary, attention-sorted, with an org-total strip. Property identities are resolved server-side (role-aware) at the server-fn boundary. |

## Public API

Exported from `application/public-api.ts`:

- Types: `KPIValue`, `KPIs`, `RecentReview`, `DashboardReplyStatus`, `DashboardData`, `PortalKPIs`, `PortalRatingKPIValue`, `PortalAnalyticsData`, `StaffDashboardData`, `PortalRatingTrendPoint`, `AttentionSignals`, `FleetEntry`, `FleetOverviewData`, `FleetTotals`
- Error types: `DashboardErrorCode`, `DashboardError`, `isDashboardError`

## Server functions

| Function | Method | Permission | Route |
| -------- | ------------------------- | ---------- | ---------------- | ----------------------------------------------------------------------------------------- |
| | `getDashboardDataFn` | GET | `dashboard.read` | Property-scoped dashboard data with time range |
| | `getPortalAnalyticsFn` | GET | `dashboard.read` | Portal-scoped analytics data with time range |
| | `getStaffDashboardDataFn` | GET | `dashboard.read` | Staff dashboard data |
| | `getAttentionSignalsFn` | GET | `dashboard.read` | Per-property attention-band signal counts |
| | `getFleetOverviewFn` | GET | `dashboard.read` | Cross-property fleet overview (2+ properties); resolves accessible properties server-side |

## Permissions

| Permission       | AccountAdmin | PropertyManager | Staff |
| ---------------- | ------------ | --------------- | ----- |
| `dashboard.read` | ✓            | ✓               | ✓     |

## Ports

Dashboard defines facade ports (per ADR-0007 / ADR-0008) for cross-context data:

- **MetricStatsPort** — sums of metric readings by period/portal, implemented by metric-stats.adapter.ts.
- **ReviewStatsPort** — review counts, rating distribution, reply performance, recent reviews. BQC-5.5: supplied by the REVIEW context's governed `ReviewServingStats` (composition wires `review.internal.servingStats`) — ADR 0031 source eligibility is enforced at the owner on every review-content read, aggregates included. The dashboard-owned SQL adapter is deleted.
- **PortalMetricsPort** — portal-scoped metric sums, rating distribution, rating trend, and per-family availability evidence. Structurally implemented by Metric's governed `portalAnalytics` public API and wired at composition; Dashboard owns no Portal analytics SQL.
- **PortalResponseIntegrityPort** — current content-free Guest response-integrity counts. Implemented by the Guest context public API wired at composition.
- **StaffPortalResolverPort** — resolves which portals a staff user has access to for a given property. Implemented by staff context adapter.
- **AttentionSignalsPort** — unanswered-review (past SLA), new/escalated inbox-item, and goals-behind-pace counts per property. Implemented by attention-signals.adapter.ts (its review count applies the same ADR 0031 eligibility predicate — dashboard-side copy pinned equivalent to the review rule by an integration test).

Review stats, governed Portal metrics, and Guest integrity counts arrive through composition-wired owner APIs. The remaining legacy Metric/Inbox/Goal projection adapters are constructed inside `buildDashboardContext()` and remain explicit MET-01 migration work. All remaining direct SQL reads compose the `read-facade.ts` scope builders and run under its statement timeout (`DASHBOARD_READ_BUDGET_MS`); cache policy is deliberately NONE server-side (client TanStack Query staleTimes are the cache policy — a server cache would be a second read model beside the authoritative query path).
