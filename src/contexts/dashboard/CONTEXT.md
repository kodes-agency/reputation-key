# Dashboard Context

## Bounded context

Read-oriented aggregation surface for property-level and portal-level analytics plus
the role-aware Setup Checklist. Analytics remain pure query orchestration. The one
bounded write is a content-free, insert-only first-completion milestone; current
health always remains in the owning context and Dashboard emits no domain event.

## Glossary

- **DashboardData** — The full property dashboard response: KPIs, rating distribution, trends, reply performance, engagement funnel, recent reviews.
- **PropertyOverviewData** — The Property page projection pairing `DashboardData` and attention signals derived from the exact same KPI snapshot.
- **PortalAnalyticsData** — Portal-scoped analytics: the trusted Property-local period/timezone, portal KPIs, engagement funnel, private-rating distribution/trend, and content-free response-integrity counts. No review/reply data.
- **KPIValue** — A Review-owned current value, prior value, and trend percentage.
- **MetricKPIValue** — A governed scan or Private Feedback value with current/prior source evidence. `ready` may render a number; `updating`, `insufficient_data`, and `temporarily_unavailable` carry `null`, never zero.
- **RatingKPIValue** — A rating average with eligible sample counts, source evidence, and an absolute star comparison. No eligible sample renders as `null`/`—`, never zero stars.
- **PortalCountKPIValue** — A Portal count plus source evidence. Its value is nullable while the governed projection cannot safely prove a count, so incomplete data is never presented as zero.
- **PortalMetricEvidence** — Per-family availability evidence: definition version, state, completeness, correction head, and distinct Verified Through, Latest Activity, and Computed At timestamps.
- **PortalLifetimeReconciliationState** — All Time projection metadata: initialization/reconciliation state, projection revision, anonymous retention baseline, and the latest rebuild/seal times. It is operational evidence, never a time-series watermark.
- **PortalKPIs** — Portal-scoped KPIs: scans, avg rating, feedback, review link clicks.
- **DashboardReplyStatus** — Simplified reply status for the dashboard: `'none'`, `'draft'`, `'published'`.
- **EngagementFunnel** — Scans → ratings → review link clicks. Portal-scoped; only available when a portal is selected.
- **MetricStatsPort** — Facade port for querying metric_readings data (sums by period/portal).
- **ReviewStatsPort** — Facade port for querying review/reply aggregate data (counts, ratings, reply performance, recent reviews).
- **PortalMetricsPort** — Facade port for portal-scoped metric queries (KPI sums, rating distribution, rating trends).
- **PortalResponseIntegrityPort** — Guest-owned facade for current `Accepted`, `Filtered automatically`, and `Under review` response counts in the selected period.
- **StaffPortalResolverPort** — Facade port for resolving which portals a staff user has access to. Used to scope staff dashboard queries.
- **AttentionSignalsPort** — Facade port for current open Inbox work, active escalations, goals behind pace, and their distinct work-anchor union. Overdue Google review Response Targets come from Inbox's public API.
- **AttentionSignals** — Five compact attention reasons plus `needsAttention`, which counts distinct underlying work and a supported rating-drop concern without adding overlapping reasons twice.
- **FleetEntry** — One property row in the cross-property fleet overview: identity + Property-local period evidence + KPI summary + attention signals + total.
- **FleetOverviewData** — The keyset-paginated fleet response: name-ordered `FleetEntry[]` + an org-total `FleetTotals` strip.
- **StaffDashboardData** — Staff-scoped dashboard response: filtered to the portals assigned to a staff user.
- **Setup Checklist** — Five canonical onboarding facts with a monotonic first-completion timestamp and a separately evaluated current-health state. It is resumable, has no manual completion command, and never turns a milestone into source authority.

## Relationships

Dashboard is a read-oriented aggregation context with no domain entities. It queries upstream contexts via governed facades and two explicitly catalogued bounded read projections (Fleet/attention and Setup Checklist):

- **Review context** via `ReviewStatsPort` — Aggregate review counts, ratings, reply performance, recent reviews.
- **Metric context** via `MetricStatsPort` — Summed metric readings by time period and portal.
- **Portal-scoped metric read model** via `PortalMetricsPort` — KPI sums, rating distributions, and rating trends.
- **Anonymous Portal lifetime read model** via `PortalLifetimeMetricsPort` — retained All Time totals and reconciliation metadata; it contains no response/session identity or exact activity time.
- **Guest context** via `PortalResponseIntegrityPort` — Content-free response-quality classification counts and no response content/session data.

## Invariants

- Analytics are read-only. Setup Checklist reads may insert an absent content-free first-completion milestone with `ON CONFLICT DO NOTHING`; there is no update/delete/manual-completion operation, no event, and no event handler.
- Setup completion is derived only from the five EXP-01 canonical facts. A later outage changes current health to degraded but never clears or rewrites historical completion.
- Setup scope is Organization-wide for AccountAdmin and the exact current PropertyAccessGrant set for PropertyManager. A manager with no Property access receives a content-free `no_access` result without a canonical-fact query. Staff is beta-dark and rejected at the server boundary.
- Single-Property dated presets are rolling Property-local calendar windows ending at the injected current instant. Their preceding comparison has the same number of Property-local days and ends exactly at the current-period start; DST does not shift the local wall-clock boundary. All Time is unbounded and non-comparative.
- Fleet derives the same rolling and preceding boundaries independently for every row from that Property's trusted timezone. A Fleet average is weighted by eligible rating count, exposes its total sample, and its per-row comparison is an absolute star delta only when both periods have at least ten eligible ratings.
- Property attention uses that same absolute-star comparison and requires at least ten eligible Google reviews in both periods before a rating decline can become a reason for attention.
- Engagement funnel returns `null` when no portal is selected (property dashboard).
- Engagement funnel uses `portal.rating` for the ratings step (NOT `portal.feedback`).
- Dashboard does not create a second business authority. Its named attention/Fleet and Setup Checklist read facades may join content-minimal canonical columns under exact tenant/Property scope; only the Setup milestone table is Dashboard-owned.
- Portal analytics says **Portal responses**, not unique guests. Accepted responses feed private-rating figures; filtered/under-review counts remain visible as gentle methodology, and the UI exposes no rating-exclusion action.
- Analytics periods are half-open (`start <= business time < end`). Prior/current periods share one boundary without overlap or a millisecond gap. Server functions resolve the IANA timezone from the trusted Property public API; browser input cannot select analytics time semantics.
- Portal private-rating averages show one decimal and the eligible sample count. The comparison is an absolute star delta only when both bounded periods have at least ten eligible ratings; All Time has no comparison and no-rating renders `—`.
- All Time is served only from Metric's anonymous Portal lifetime aggregate. It exposes the aggregate's reconciliation state and immutable source versions, never queries a scan-from-epoch period projection, and never derives a daily trend or prior-period comparison from totals.
- Portal KPI, distribution, and trend reads use immutable governed definition versions, allowed source policy, exact quality, and the current correction tip; retracted or invalid star values cannot remain in one chart after disappearing from another.
- Dashboard metric families share `MetricAvailabilityState`: `Ready`, `Updating`, `Insufficient data`, or `Temporarily unavailable`. A complete quiet count period is Ready with zero; no eligible rating sample is Insufficient data; pending or invalid governed evidence cannot silently become zero.
- `Verified Through` describes durable pipeline completeness, `Latest Activity` describes the newest business fact, and `Computed At` describes query assembly. These timestamps are not interchangeable.
- The Portal engagement funnel is derived from the same governed, correction-aware KPI population and is withheld if any required metric family is not Ready.
- Property and Staff scan/Private Feedback cards preserve immutable version and minimum-sample evidence from `MetricStatsPort`. A missing version row is `updating`; insufficient governed evidence is `temporarily_unavailable`; neither becomes zero or a trend. Their legacy engagement funnel is withheld unless all three source families are ready.
- When `portalId` is provided to `getKPIs`, metric queries (scans, feedback) are portal-scoped. Review KPIs (reviews, avgRating) remain property-scoped.
- `Private Feedback` is submitted feedback text in the reporting period. It is not inferred from a low private rating.
- `Items to Triage` counts current open Inbox work across Review and Private Feedback sources. `Escalated` is an overlapping reason and includes every unresolved escalation, even if its Inbox item is closed.
- `Needs Attention` is the union of stable Review, Inbox-source, and Goal work anchors, plus one supported rating-drop concern. Property and Fleet totals never add overlapping reason counts.

## Events produced

None. Dashboard does not emit domain events.

## Events consumed

None. Dashboard does not subscribe to events from other contexts. All data is fetched on-demand via facade ports when server functions are called.

## Architecture layers

```
dashboard/
  domain/              types.ts, errors.ts
  application/
    ports/             dashboard.repository.ts, metric-stats.port.ts, review-stats.port.ts, portal-metrics.port.ts, portal-lifetime-metrics.port.ts, portal-response-integrity.port.ts, staff-portal-resolver.port.ts, attention-signals.port.ts, setup-checklist.repository.ts
    use-cases/         get-dashboard-data.ts, get-property-overview.ts, get-portal-analytics.ts, get-staff-dashboard-data.ts, get-attention-signals.ts, get-fleet-overview.ts, get-setup-checklist.ts
    utils.ts           pure data helpers (prior period, trend, rating drop, bounds)
    public-api.ts      re-exports domain types
  infrastructure/
    read-facade.ts     BQC-5.5 governed read policy: scope where-builders, attention
                       eligibility predicate, statement timeout, cache policy (none)
    adapters/          metric-stats.adapter.ts, attention-signals.adapter.ts, staff-portal-resolver.adapter.ts
    repositories/      dashboard.repository.ts (composition only), setup-checklist.repository.ts (bounded canonical-fact read + insert-only milestone)
  server/              dashboard.ts, portal-analytics.ts, staff-dashboard.ts, fleet-overview.ts, setup-checklist.ts, resolve-property-period.ts
  build.ts             composition root
```

## Use cases

| Use case                | Input                                                                       | Output                 | Description                                                                                                                                                                                         |
| ----------------------- | --------------------------------------------------------------------------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `getDashboardData`      | organizationId, propertyId, portalId?, startDate, endDate, propertyTimezone | `DashboardData`        | Orchestrates all repo queries in parallel; engagement funnel + portal-scoped KPIs when portal set                                                                                                   |
| `getPropertyOverview`   | Dashboard input                                                             | `PropertyOverviewData` | Runs Dashboard, atomic attention, and Inbox target reads concurrently, then derives rating attention from the Dashboard KPI snapshot without a duplicate KPI fan-out.                               |
| `getPortalAnalytics`    | organizationId, propertyId, portalId, startDate, endDate, propertyTimezone  | `PortalAnalyticsData`  | Portal-scoped analytics: bounded presets use governed period projections; All Time uses the anonymous lifetime aggregate and exposes its reconciliation state without a time trend.                 |
| `getStaffDashboardData` | organizationId, userId, propertyId, portalId?, timeRange, propertyTimezone  | `StaffDashboardData`   | Staff-scoped dashboard aggregation filtered to assigned portals.                                                                                                                                    |
| `getAttentionSignals`   | organizationId, propertyId, timeRange, propertyTimezone                     | `AttentionSignals`     | Five attention reasons plus the distinct work total for one property; Inbox owns the overdue response-target count.                                                                                 |
| `getFleetOverview`      | organizationId, properties[], timeRange                                     | `FleetOverviewData`    | Cross-property aggregation: per-property attention + KPI summary, name-ordered and keyset-paginated, with one batched Inbox target read for the page. Property identities are resolved server-side. |
| `getSetupChecklist`     | organizationId, role, exact Property scope, allowed actions                 | `SetupChecklist`       | Derives five canonical facts, records only missing first-completion timestamps, and returns complete/incomplete/waiting/no-access/degraded states with authorized actions.                          |

## Public API

Exported from `application/public-api.ts`:

- Types: `KPIValue`, `MetricKPIValue`, `MetricAvailabilityState`, `RatingKPIValue`, `KPIs`, `RecentReview`, `DashboardReplyStatus`, `DashboardData`, `PortalAnalyticsData`, `PortalLifetimeReconciliationState`, `PortalResponseIntegritySummary`, `PortalRatingTrendPoint`, `RatingTrendPoint`, `ReviewVolumePoint`, `AttentionSignals`, `FleetEntry`, `FleetOverviewData`, `FleetMetricEvidence`, `FleetTotals`
- Setup types: `SetupChecklist`, `SetupChecklistStep`, `SetupChecklistAction`
- Error type: `DashboardError`

## Server functions

| Function                  | Method | Permission                                | Route                                                                                     |
| ------------------------- | ------ | ----------------------------------------- | ----------------------------------------------------------------------------------------- |
| `getDashboardDataFn`      | GET    | `dashboard.read`                          | Property-scoped dashboard data with time range                                            |
| `getPropertyOverviewFn`   | GET    | `dashboard.read` + `dashboard.fleet_read` | Property page Dashboard and attention projection sharing one KPI snapshot                 |
| `getPortalAnalyticsFn`    | GET    | `dashboard.read`                          | Portal-scoped analytics data with time range                                              |
| `getStaffDashboardDataFn` | GET    | `dashboard.read`                          | Staff dashboard data                                                                      |
| `getFleetOverviewFn`      | GET    | `dashboard.read`                          | Cross-property fleet overview; resolves accessible Properties server-side                 |
| `getSetupChecklistFn`     | GET    | `dashboard.read` + `dashboard.fleet_read` | Role-aware Setup Checklist; Staff rejected and PropertyManager scope resolved server-side |

## Permissions

| Permission             | AccountAdmin | PropertyManager | Staff |
| ---------------------- | ------------ | --------------- | ----- |
| `dashboard.read`       | ✓            | ✓               | ✓     |
| `dashboard.fleet_read` | ✓            | ✓               | —     |

## Ports

Dashboard defines facade ports (per ADR-0007 / ADR-0008) for cross-context data:

- **MetricStatsPort** — sums of metric readings by period/portal, implemented by metric-stats.adapter.ts.
- **ReviewStatsPort** — review counts, rating distribution, reply performance, recent reviews. BQC-5.5: supplied by the REVIEW context's governed `ReviewServingStats` (composition wires `review.internal.servingStats`) — ADR 0031 source eligibility is enforced at the owner on every review-content read, aggregates included. The dashboard-owned SQL adapter is deleted.
- **PortalMetricsPort** — portal-scoped metric sums, rating distribution, rating trend, and per-family availability evidence. Structurally implemented by Metric's governed `portalAnalytics` public API and wired at composition; Dashboard owns no Portal analytics SQL.
- **PortalLifetimeMetricsPort** — anonymous per-Portal All Time totals plus source-version and reconciliation metadata. Structurally implemented by `MetricPublicApi.portalLifetime.get`; Dashboard owns no lifetime SQL and never invokes rebuild/seal from a read.
- **PortalResponseIntegrityPort** — current content-free Guest response-integrity counts. Implemented by the Guest context public API wired at composition.
- **StaffPortalResolverPort** — resolves which portals a staff user has access to for a given property. Implemented by staff context adapter.
- **AttentionSignalsPort** — open-Inbox, active-escalation, goals-behind-pace, and distinct-work counts per property. Implemented by `attention-signals.adapter.ts`; overdue Google response-target counts come from Inbox's public API at each property or Fleet use-case boundary.
- **SetupChecklistRepository** — one transaction reads the five content-minimal canonical facts under tenant/Property scope and inserts missing `setup_checklist_milestones`; it cannot fake, update, or delete completion.

Review stats, governed Portal metrics, and Guest integrity counts arrive through composition-wired owner APIs. The remaining Metric reads are limited by the executable MET-01 authority inventory to two named Dashboard projections. The legacy KPI projection now pins the four Portal analytics definition versions, registry consumer/source policy, current correction tips, and minimum-sample signals. The Fleet projection pins its three versions and returns per-family evidence. Both run under the shared statement timeout (`DASHBOARD_READ_BUDGET_MS`). Cache policy is deliberately NONE server-side (client TanStack Query staleTimes are the cache policy — a server cache would be a second read model beside the authoritative query path). Inbox and Goal projection reads remain separately catalogued owner-contract work; neither widens Metric authority.

The cross-Property Fleet request never applies one selected or organization-wide timezone to every row. Its bounded projection derives each row's period from the trusted timezone already selected with that Property.
