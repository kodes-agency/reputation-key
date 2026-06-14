# Phase 16.2 Code Review — Badges and Leaderboards

**Date:** 2026-06-14
**Status:** All findings resolved. Verified: 0 typecheck errors, 1961/1961 tests pass across 221 files.

---

## All Findings Resolved

### P0-1. ✅ `streakMet` used `new Date()` instead of injected clock

**Fix:** `const date = new Date(deps.clock())`

### P0-2. ✅ False positive — day-key formats match

SQL `AT TIME ZONE` and JS `dayKeyInTimezone` both convert to property timezone correctly.

### P0-3. ✅ Every `metric.recorded` triggered 80 leaderboard refreshes

**Fix:** Targeted refresh: `period: 'this_month'`, `scope`, `metricKey: 'overall'`.

### P0-4. ✅ `as never` cast on badge definition ID

**Fix:** `badgeId(data.badgeDefinitionId)`.

### P1-1. ✅ Event constructors lack validation assertions

**Fix:** Added `assert()` calls for `organizationId` and `occurredAt` in both badge and leaderboard event constructors.

### P1-2. ✅ `occurredAt` auto-generated instead of caller-provided

**Fix:** Both constructors now accept `occurredAt` as a caller-provided parameter.

### P1-3. ✅ Leaderboard event tag missing entity segment

**Fix:** `'leaderboard.snapshot.refreshed'` (three-segment format).

### P1-4. ✅ Missing CONTEXT.md

**Fix:** Created `src/contexts/badge/CONTEXT.md` and `src/contexts/leaderboard/CONTEXT.md`.

### P1-5. ✅ Build functions lack explicit return types

**Fix:** Added `BadgeContextApi` and `LeaderboardContextApi` explicit types.

### P1-6. ✅ Badge public API exposes raw repository methods

**Fix:** Created `setOrganizationBadgeEnablement` use case. Public API now wraps it through the use case layer.

### P1-7. ✅ `evaluateBadgeForTarget` input used raw `string` types

**Fix:** Uses branded types `OrganizationId`, `PropertyId`, `PortalId | PortalGroupId`.

### P2-1. ✅ N+1 queries in leaderboard metric aggregation

**Fix:** Replaced per-target `metricApi.queryAggregate` calls with a single batch SQL `GROUP BY target_id` query. The leaderboard repo no longer depends on `MetricPublicApi` — queries `metric_readings` directly.

### P2-2. ✅ Non-atomic delete-then-insert in `writeSnapshot`

**Fix:** Wrapped in `db.transaction()`.

### P2-3. ✅ `listPropertiesWithMetricEvents` scans entire `metric_readings`

**Fix:** Added `WHERE occurred_at >= NOW() - INTERVAL '90 days'` time-window filter.

### P2-4. ✅ Badge reconcile iterates all orgs × properties × targets × definitions

**Status:** Inherent to the reconcile pattern. The N+1 fix (P2-1) also reduces per-target cost. No further optimization needed at current scale.

### P3-1. ✅ Badge mapper fabricated criteria data

**Fix:** Query now selects all definition columns including `criteriaJson`. Mapper constructs real `BadgeDefinition`.

### P3-2. ✅ Notification handler imported from `domain/events` instead of `public-api`

**Fix:** `import type { BadgeAwarded } from '#/contexts/badge/application/public-api'`.

### P3-3. ✅ Event handler registration inconsistency

**Fix:** Created `registerBadgeEventHandlers` and `registerLeaderboardEventHandlers`. Handlers now register inside the build functions, matching the goal context pattern. Removed inline handler from `composition.ts`.

### P3-4. ✅ `evaluateBadgeForTarget` returned only first award

**Fix:** Return type changed to `ReadonlyArray<BadgeEvaluationResult>` — all results surfaced. Events were already emitted for all awards; now the return value matches.

---

## Verification

- TypeScript: 0 errors
- Tests: 1961/1961 passing across 221 files
- 30 new tests covering badge evaluation, streaks, idempotency, date utils, notification handler
