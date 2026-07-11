# Leaderboard Context

## Bounded context

Read-only ranking of portals and portal groups within a selected property using per-metric scores and a comparison matrix. Internal portal-performance view — external Google reviews are property-scoped and cannot differentiate portals.

## Glossary

| Term                    | Definition                                                                                                                                                                                                                                                         |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **LeaderboardSnapshot** | A materialized view of rankings for a specific property, period, scope, and metric. Refreshed by metric events and hourly reconciliation.                                                                                                                          |
| **LeaderboardEntry**    | A single ranked row within a snapshot: rank, target, score, metric value, normalized score.                                                                                                                                                                        |
| **LeaderboardScope**    | `'portal'` or `'portal_group'`. Determines which entities are ranked.                                                                                                                                                                                              |
| **LeaderboardPeriod**   | Time window: `today`, `this_week`, `this_month`, `this_quarter`, `all_time`, `last_7_days`, `last_30_days`, `last_90_days`.                                                                                                                                        |
| **Comparison matrix**   | Diagnostic surface: portals as rows, each metric as a column (raw value + per-column rank, color-coded). Default landing view; complements per-metric leaderboards. Serves "pinpoint weak performers".                                                             |
| **Rating floor**        | Minimum-sample rule for the average-rating metric: a portal needs ≥5 private ratings in the period to be ranked/scored on quality; below that it shows "insufficient data". Counts (scans, feedback, clicks) have no floor — a low count is the signal, not noise. |
| **Normalization**       | Property-scoped max-value scaling: each target's raw metric is divided by the max in that property and period.                                                                                                                                                     |

## Relationships

- LeaderboardSnapshot → Property (required `propertyId`).
- LeaderboardEntry → LeaderboardSnapshot (required `snapshotId`, cascading delete).
- LeaderboardEntry → Portal or PortalGroup (via `targetType` + `targetId`).
- Leaderboard context **depends on** `MetricPublicApi` for querying metric aggregates.

## Invariants

- Snapshots are keyed by `(propertyId, period, scope, metricKey, scoreKey)`.
- Normalization is computed within the selected property and period — portals compete only against peers in the same property.
- No composite/overall score. The leaderboard ranks by one metric at a time (per-metric leaderboards) or compares metrics side-by-side (comparison matrix). The former weighted blend of max-normalized metrics was removed as dimensionally meaningless (ADR 0021).
- The rating metric (average private rating) requires a ≥5-rating floor per period to be ranked; sub-threshold portals are "insufficient data". Other metrics (counts) have no floor.
- For `portal.rating` metric, the aggregate is average (sum/count), not total.
- For other metrics, the aggregate is sum.
- Entries are deleted and re-inserted atomically within a transaction on each refresh.
- Equal scores share the same rank; secondary ordering by raw metric value for display stability only.

## Events produced

None. (The `leaderboard.snapshot.refreshed` event was pruned — it had zero subscribers. Snapshot freshness is observable via `leaderboardSnapshots.lastUpdatedAt`.)

## Events consumed

| Tag               | Source context | Handler action                                                 |
| ----------------- | -------------- | -------------------------------------------------------------- |
| `metric.recorded` | metric         | Refresh current-month snapshot for the affected property/scope |

## Architecture layers

```
leaderboard/
  domain/              types.ts, events.ts (pruned), errors.ts, scoring.ts
  application/
    ports/             leaderboard.repository.ts
    use-cases/         refresh-leaderboard.ts, reconcile-leaderboards.ts, get-leaderboard.ts
    dto/               leaderboard.dto.ts (Zod schemas)
    utils.ts           periodToRange, LEADERBOARD_PERIODS
    public-api.ts      re-exports DTO types
  infrastructure/
    repositories/      leaderboard.repository.ts (Drizzle)
    mappers/           leaderboard.mapper.ts
  server/              leaderboards.ts
  build.ts             composition root

## Use cases

| Use case                | Input                                                        | Output                                   | Permission             |
| ----------------------- | ------------------------------------------------------------ | ---------------------------------------- | ---------------------- |
| `refreshLeaderboard`    | organizationId, propertyId, period?, scope?, metricKey?      | `{ snapshotsRefreshed, entriesWritten }` | System (event handler) |
| `reconcileLeaderboards` | —                                                            | `{ snapshotsRefreshed, entriesWritten }` | System (hourly job)    |
| `getLeaderboard`        | organizationId, propertyId, period, scope, metricKey, limit? | `LeaderboardEntryWithTarget[]`           | `leaderboard.read`     |

## Public API

Exported from `application/public-api.ts`:

- Types: `LeaderboardEntryWithTarget`, `GetLeaderboardInput`

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
```
