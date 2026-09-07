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
- Produce property, fleet, staff, Portal analytics, attention, and setup-checklist reads.
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

## Invariants

1. A metric read is eligible only under its immutable definition version and source policy.
2. Goal evaluation uses half-open property-local monthly periods and approved Goal metrics.
3. Goal assignment changes preserve at least one subject and never rewrite history.
4. Corrections append; they never mutate the original reading or closed Goal result.
5. Dashboard values preserve unavailable/updating/insufficient states instead of showing zero.
6. Every tenant read includes organization and property scope or an explicit global authority.
7. Clocks, identifiers, logging, storage, and upstream reads are injected by composition.

## Interfaces and dependencies

`application/public-api.ts` is the only cross-context application interface. Server functions
under `server/` are the request boundary used by routes. Reporting depends on public
interfaces from Property, Portal, Staff, Review, Inbox, and Guest; none of their repositories
are imported. Metric-to-Goal and Metric-to-Dashboard collaboration is internal and follows
the normal domain/application/infrastructure layer rules.

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
