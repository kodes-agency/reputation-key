# Reporting Context

Reporting owns the product's governed metrics, Goal Programs, and dashboard read models.
The three capabilities share one build, one application interface, and one standard layer
set because Goal evaluation and dashboard presentation are downstream views of the same
metric authority.

## Responsibilities

- Record version-pinned metric readings and append-only corrections.
- Maintain anonymous Portal lifetime aggregates and Current on Google snapshots.
- Resolve governed metric availability, provenance, completeness, and correction impact.
- Create, revise, assign, schedule, evaluate, and close monthly Goal Programs.
- Produce property, fleet, staff, Portal analytics, Portals overview results, attention, setup-checklist, and
  per-Property setup reads.
- Register metric projection consumers, Goal correction consumers, and Goal maintenance.
- Contribute Reporting-owned records to organization export and lifecycle operations.

## Core model

- **Metric definition/version**: frozen code-reviewed measurement policy.
- **Metric reading**: immutable, version-pinned fact with event-time attribution.
- **Metric correction**: append-only retraction, replacement, or adjustment.
- **Goal Program**: versioned monthly target over an approved metric and subject set.
- **Goal monthly result**: evaluation head with append-only revision evidence.
- **Dashboard read model**: content-minimal presentation assembled from governed sources.
- **Portal lifetime aggregate**: anonymous all-time values with rebuild and seal evidence.
- **Portal results measures**: the five figures on a Portal's Results view, each named for
  what it counts. Qualified scans (not raw page opens; counted from August 2026), private
  ratings, the average private rating, guests who opened Google (Google review link opens
  only; a secondary link is not one), and private notes. The reading floors live in
  `domain/portal-results-thresholds.ts`.
- **Results window**: a bounded range is that many whole Property-local calendar days ending with
  today, opening at local midnight (`localDaysWindow`); the period before is the same number of
  days before that, cut at the same time of day so both are equally long (today is still in
  progress). "Last 30 days" on 30 Sep is 1-30 Sep against 2-31 Aug. A Portal's Results tab
  and the Portals overview read the same window, so a Portal's row and its own tab agree.
- **Results series**: a Portal's window cut into weekly buckets anchored to its own first day
  (`domain/portal-results-series.ts`). A bucket carries qualified scans, the prior window's scans
  in the same position, and an average computed as sum over count of that bucket's own ratings,
  held back below the average floor. Versions that went live inside the window (Portal's
  `listPublicationActivationsBetween`) are placed on their local day. All Time has no series.
- **Guests by language**: private ratings (not scans) counted by the language of the page the
  guest saw, read from Guest (`getPortalRatingLanguages`). A rating with no recorded language is
  counted on its own line, never guessed.
- **Portals overview results**: the same five measures for every Portal at once, then per Portal
  Group, per Property for its Portals in no group, per Property as a subtotal, and in total
  (`getPortalResultsOverview`, read in a fixed number of statements per distinct time zone however
  many Portals are asked about). Every row is assembled by the code that assembles a single
  Portal's Results, and each Property is read through its own window (its time zone, built the way a
  Portal's Results view builds it), so a Portal's row says what its own Results view says. The total
  adds Property readings and has no window of its own. All Time is not read here. A group's figures
  are its readings under the group each Portal had when the guest acted (ADR 0040), so a Portal that
  moves keeps its earlier results with its old group. A group's evidence is the weakest of the
  Portals with readings under it, whether they are in the group today (`memberPortalIds`) or only
  contributed (`contributingPortalIds`). The caller supplies the roster (Portal owns the list and
  each Portal's current group) and each Property's time zone; Reporting supplies the numbers.
  The server function reads one Property, or, with none named, the whole Organization (the All
  properties page): then the roster is every Portal of every Property the caller may read for both
  `portal.read` and `dashboard.read` and is assigned to (each asked per Property before anything is
  read), a Property with no time zone on record is left out of the results rather than read in a
  guessed zone, and the one-read limit of 1000 Portals applies to the whole Organization (past it
  the page shows its list without results; each Property's own page still reads its own).
- **Property setup**: seven per-Property steps derived at read time from current facts
  (Google binding, first sync, reply language, AI decision, responsible manager, reply
  voice, published Portal). It records no milestones, unlike the Organization checklist.

## Invariants

1. A metric read is eligible only under its immutable definition version and source policy.
2. Goal evaluation uses half-open property-local monthly periods and approved Goal metrics.
   A revision starts at the first local month that begins at or after the end of every
   month still open or reconciling, so that month stays inside its version's window. After
   the Property's timezone moves east, the next local month begins before the open month
   ends, so the revision starts one local month later and the skipped local month is not
   evaluated under either version. The start date is shown when the revision is scheduled.
3. Goal assignment changes preserve at least one subject and never rewrite history.
4. Corrections append; they never mutate the original reading or closed Goal result.
5. Dashboard values preserve unavailable/updating/insufficient states instead of showing zero.
   A Portal's average private rating is held back below five ratings (with the true n and
   the reason), and compared with the prior period only at ten ratings in each period. Google
   opens are `insufficient` (`destination_unattributed`) while any click in the period never
   recorded which link was opened. A funnel step that out-counts the step before it is shown
   as counts only, never as a percentage over 100. Qualified scans have no history before
   their registry `effectiveFrom`, which the read model hands over as `qualifiedScansSince`:
   a prior window that opens before it has no prior figure (`measure_not_yet_counted`), and a
   current one that does carries the `measure_started_mid_period` note.
6. Every tenant read includes organization and property scope or an explicit global authority.
7. Clocks, identifiers, logging, storage, and upstream reads are injected by composition.

## Interfaces and dependencies

`application/public-api.ts` is the only cross-context application interface. Server functions
under `server/` are the request boundary used by routes. Reporting depends on public
interfaces from Property, Portal, Staff, Review, Inbox, and Guest; none of their repositories
are imported. Metric-to-Goal and Metric-to-Dashboard collaboration is internal and follows
the normal domain/application/infrastructure layer rules.

`getDashboardDataFn` is the one server function no route calls: the Property dashboard
moved to `getPropertyOverviewFn`. It stays because the dashboard-governance and
review-expiry e2e specs call it by export name to prove the governed read (grant
filtering, reply redaction, expired-Review exclusion).

The unified `buildReportingContext` returns one public interface, one combined outbox
registration function, Goal maintenance, metric maintenance, and named lifecycle/export
contributors. Root composition may continue exposing capability-specific aliases such as
`metricPublicApi`, `goalPublicApi`, and `dashboardPublicApi`; they reference the same Reporting
interface.

## Persistence

Reporting owns the metric, Goal Program, dashboard setup-checklist, Portal lifetime, and
Current on Google tables declared in the shared schema package. Repositories remain split by
aggregate and read purpose even though they share a bounded context.

## Durable facts

Metric and Goal event modules are named `metric-events.ts` and `goal-events.ts`. Their event
tags remain stable for outbox replay compatibility. Reporting consumes Guest, Portal, Review,
and metric-correction facts through the shared durable consumer registry.

## Verification

- `build.test.ts` pins the unified interface and worker contributions.
- `infrastructure/runtime-dependency-injection.test.ts` rejects ambient runtime state.
- Unit tests remain beside their domain, use-case, repository, adapter, and server subjects.
- Integration tests exercise PostgreSQL constraints, projections, lifecycle, and exports.
