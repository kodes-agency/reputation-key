# Leaderboard Context

Read-only ranking of portals and portal groups within a selected property using composite and per-metric scores.

## Glossary

| Term                    | Definition                                                                                                                                |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **LeaderboardSnapshot** | A materialized view of rankings for a specific property, period, scope, and metric. Refreshed by metric events and hourly reconciliation. |
| **LeaderboardEntry**    | A single ranked row within a snapshot: rank, target, score, metric value, normalized score.                                               |
| **LeaderboardScope**    | `'portal'` or `'portal_group'`. Determines which entities are ranked.                                                                     |
| **LeaderboardPeriod**   | Time window: `today`, `this_week`, `this_month`, `this_quarter`, `all_time`, `last_7_days`, `last_30_days`, `last_90_days`.               |
| **CompositeScore**      | Weighted blend of normalized component metrics: 40% avg rating, 30% feedback, 20% scans, 10% review-link clicks.                          |
| **Normalization**       | Property-scoped max-value scaling: each target's raw metric is divided by the max in that property and period.                            |

## Relationships

- LeaderboardSnapshot → Property (required `propertyId`).
- LeaderboardEntry → LeaderboardSnapshot (required `snapshotId`, cascading delete).
- LeaderboardEntry → Portal or PortalGroup (via `targetType` + `targetId`).
- Leaderboard context **depends on** `MetricPublicApi` for querying metric aggregates.
- Leaderboard context **emits** `leaderboard.snapshot.refreshed` events (currently unconsumed).

## Invariants

- Snapshots are keyed by `(propertyId, period, scope, metricKey, scoreKey)`.
- Normalization is computed within the selected property and period — portals compete only against peers in the same property.
- Composite weights are system-defined: 40% rating, 30% feedback, 20% scans, 10% review-link clicks.
- For `portal.rating` metric, the aggregate is average (sum/count), not total.
- For other metrics, the aggregate is sum.
- Entries are deleted and re-inserted atomically within a transaction on each refresh.
- Equal scores share the same rank; secondary ordering by raw metric value for display stability only.

## Events produced

| Tag                              | Payload                                                                      | When                       |
| -------------------------------- | ---------------------------------------------------------------------------- | -------------------------- |
| `leaderboard.snapshot.refreshed` | organizationId, propertyId, period, scope, metricKey, snapshotId, occurredAt | Snapshot refresh completes |

## Events consumed

| Tag               | Source context | Handler action                                                 |
| ----------------- | -------------- | -------------------------------------------------------------- |
| `metric.recorded` | metric         | Refresh current-month snapshot for the affected property/scope |

## Architecture layers

```
leaderboard/
  domain/              types.ts, events.ts, errors.ts
  application/
    ports/             leaderboard.repository.ts
    dto/               leaderboard.dto.ts (Zod schemas)
    utils.ts           periodToRange, LEADERBOARD_PERIODS
    public-api.ts      re-exports DTO types, event types/constructors
  infrastructure/
    repositories/      leaderboard.repository.ts (Drizzle)
    mappers/           leaderboard.mapper.ts
  server/              leaderboards.ts
  build.ts             composition root
```

## Use cases

| Use case                | Input                                                        | Output                                   | Permission             |
| ----------------------- | ------------------------------------------------------------ | ---------------------------------------- | ---------------------- |
| `refreshLeaderboard`    | organizationId, propertyId, period?, scope?, metricKey?      | `{ snapshotsRefreshed, entriesWritten }` | System (event handler) |
| `reconcileLeaderboards` | —                                                            | `{ snapshotsRefreshed, entriesWritten }` | System (hourly job)    |
| `getLeaderboard`        | organizationId, propertyId, period, scope, metricKey, limit? | `LeaderboardEntryWithTarget[]`           | `leaderboard.read`     |

## Public API

Exported from `application/public-api.ts`:

- Types: `LeaderboardEntry`, `LeaderboardSnapshot`, `LeaderboardEntryWithTarget`, `GetLeaderboardInput`
- Event types: `LeaderboardSnapshotRefreshed`, `LeaderboardEvent`
- Event constructors: `leaderboardSnapshotRefreshed`

## Server functions

| Function         | Method | Permission         | Route          |
| ---------------- | ------ | ------------------ | -------------- |
| `getLeaderboard` | GET    | `leaderboard.read` | `/leaderboard` |

## Permissions

| Permission         | AccountAdmin | PropertyManager | Staff |
| ------------------ | ------------ | --------------- | ----- |
| `leaderboard.read` | ✓            | ✓               | ✓     |

## Background jobs

- **leaderboard.reconcile** — hourly job that refreshes all snapshots for all properties with metric events. Covers all periods, scopes, and metrics.
