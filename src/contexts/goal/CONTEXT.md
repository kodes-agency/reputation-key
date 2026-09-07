# Goal Context

## Responsibility

Goal owns the canonical monthly Goal Program model. It binds versioned targets
to an approved Metric definition/version, assigns each target to a Property,
Portal Group, or Portal, and records monthly outcomes with auditable revision
lineage.

Goal does not own metric readings, Property timezones, Portal membership, or
notification delivery. Those facts enter through public ports and durable
events.

## Stored model

| Table                      | Role                                                         |
| -------------------------- | ------------------------------------------------------------ |
| `goal_programs`            | Mutable program head and lifecycle status                    |
| `goal_program_versions`    | Append-only target, metric, timezone, and effective interval |
| `goal_subject_assignments` | Effective-dated Property, Portal Group, or Portal subject    |
| `goal_monthly_results`     | Current monthly outcome and availability state               |
| `goal_result_revisions`    | Append-only correction lineage for a monthly result          |

## Invariants

- One Program has a monotonically increasing current version.
- A Program version pins one immutable Metric definition version and never
  duplicates metric policy or price literals.
- Assignment scope is exactly one of Property, Portal Group, or Portal and must
  remain inside the Program's tenant and Property.
- Effective intervals are non-empty and may not overlap within one subject
  lineage.
- Monthly result periods are non-empty, Property-timezone calendar months.
- `eligible` results carry a boolean achievement decision; unavailable states
  do not manufacture a false result.
- Closed results cannot return to reconciliation. A late correction appends a
  revision and atomically updates the current result.
- Schedule maintenance, result transitions, audit history, and durable outbox
  facts commit in one transaction.

## Application flows

- `goal-programs.ts` creates and versions Programs, changes assignments, and
  runs the bounded maintenance operation.
- `reconcile-metric-correction.ts` applies a governed late Metric correction to
  one affected closed result.
- `goal-results-matrix.ts` builds the route-facing monthly matrix from canonical
  result records and explicit availability evidence.
- `goal-program-maintenance.job.ts` is the only recurring Goal job.

## Public API

`application/public-api.ts` exposes:

- Goal Program and subject-assignment contracts;
- `GoalExecutionPolicy`;
- monthly-result notification fact lookups;
- the Goal results matrix;
- canonical monthly-result event types and `goalMonthlyResultClosed`.

Tenant-facing server functions live in `server/goal-programs.ts`. Cross-context
consumers import only `application/public-api.ts` or implement a declared Goal
port.

## Durable events

Goal records:

- `goal.monthly_result.reconciled` when an open result has been evaluated but
  is not closed;
- `goal.monthly_result.closed` when the close CAS wins;
- `goal.monthly_result.revised` when a governed correction appends a new
  revision.

Activity consumes all three facts. Notification consumes closed and revised
facts, resolving current Goal-owned state before creating tenant-visible
notifications.

Goal consumes governed Metric correction facts through
`infrastructure/metric-correction-outbox-consumers.ts`. The consumer is
idempotent and revalidates the exact result/version lineage before mutation.

## Persistence and composition

`infrastructure/repositories/goal-program.repository.ts` is the sole Goal
repository. `build.ts` composes it with the execution policy, notification fact
lookups, durable consumer registration, maintenance job, Organization Export,
and Organization lifecycle contributors.

The Organization Export contributor emits only the five Goal Program tables.
The lifecycle contributor fences active Programs during closure and purges the
same five tables in FK-safe order at the irreversible boundary.
