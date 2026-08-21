// Review context — new-review discovery backoff ladder (pure).
//
// The discovery sweep FIRES every 15 minutes (a literal cadence in
// src/worker/index.ts) and used to schedule EVERY connected property back on
// a flat 15-minute interval: 96 polls per property per day. At 500 connected
// properties that is ~48,000 `reviews.list` calls a day — and because a
// snapshot run scans and then confirms, the real provider call count is at
// least double that. Almost all of those calls find nothing: reviews arrive
// in bursts, and most properties are quiet for days at a time.
//
// This module decides how long an individual property waits before it is
// polled again, from the recency of REAL activity:
//
//   - review_sync_state.last_new_review_at — a snapshot page persisted a
//     review we had never seen before (migration 0071);
//   - review_sync_state.last_notification_at — a GBP push notification was
//     received for the property, which proves the location is live and that
//     Google is publishing for it;
//   - the property's own observation start (properties.created_at) — the
//     floor for a property that has produced no activity yet, so a freshly
//     imported property is hot from the moment it is connected instead of
//     being indistinguishable from one that has been silent for a year.
//
// last_success_at is deliberately NOT an activity signal: it only records
// that we polled, so keying on it would pin every property to `hot` forever.
//
// Pure and clock-injected (domain rule: no `new Date()` / `Date.now()`).

/** Discovery cadence tier, coldest last. */
export type DiscoveryBackoffTier = 'hot' | 'warm' | 'cold'

/**
 * Durable activity evidence for one property. Every field is nullable: a
 * property may have produced no review, received no push, and (for a
 * review_sync_state row whose property row could not be joined) have no
 * observation start either.
 */
export type DiscoveryActivity = Readonly<{
  /** review_sync_state.last_new_review_at */
  lastNewReviewAt: Date | null
  /** review_sync_state.last_notification_at */
  lastNotificationAt: Date | null
  /** properties.created_at — when this property entered our observation. */
  observedSince: Date | null
}>

/**
 * The ladder is expressed as MULTIPLES of the configured base interval
 * (REVIEW_DISCOVERY_INTERVAL_MINUTES, default 15 minutes) so the existing
 * operator knob still moves the whole ladder, and so a deployment that tunes
 * the base does not silently lose the backoff shape.
 *
 * With the default 15-minute base:
 *   hot  → 15m → 96 polls/property/day  (activity within the last 6 hours)
 *   warm →  1h → 24 polls/property/day  (activity within the last 3 days)
 *   cold →  6h →  4 polls/property/day  (quiet for 3 days or more)
 */
export const DISCOVERY_TIER_MULTIPLIER: Readonly<Record<DiscoveryBackoffTier, number>> =
  Object.freeze({ hot: 1, warm: 4, cold: 24 })

/** Quiet for at least this long → demoted out of `hot`. */
export const DISCOVERY_WARM_AFTER_MS = 6 * 60 * 60 * 1000

/** Quiet for at least this long → demoted to `cold`. */
export const DISCOVERY_COLD_AFTER_MS = 3 * 24 * 60 * 60 * 1000

/**
 * Hard cap on the computed interval. A quiet property is still polled four
 * times a day, so even with GBP push completely dark the worst-case latency
 * for a brand-new review on a long-silent property is six hours — not the
 * ~25 days the refresh sweep alone would give it.
 */
export const DISCOVERY_MAX_INTERVAL_MS = 6 * 60 * 60 * 1000

/**
 * Most recent activity instant, or null when nothing is known. A push counts
 * as activity: it is stronger evidence than a persisted review (it means
 * Google is publishing for this location right now).
 */
export const lastDiscoveryActivityAt = (activity: DiscoveryActivity): Date | null => {
  let newest: Date | null = null
  for (const candidate of [
    activity.lastNewReviewAt,
    activity.lastNotificationAt,
    activity.observedSince,
  ]) {
    if (candidate === null) continue
    if (newest === null || candidate.getTime() > newest.getTime()) newest = candidate
  }
  return newest
}

/**
 * Tier for a property at `now`. A property with NO activity evidence at all
 * cannot be shown to be live, so it takes the coldest tier — that is the
 * quota-shaped default, and the only way to get there is for the property
 * row's own creation time to be unknown.
 *
 * Activity in the future (clock skew between the app and Postgres) is treated
 * as "just happened" rather than as a negative quiet duration.
 */
export const discoveryTierFor = (
  activity: DiscoveryActivity,
  now: Date,
): DiscoveryBackoffTier => {
  const lastActivityAt = lastDiscoveryActivityAt(activity)
  if (lastActivityAt === null) return 'cold'
  const quietForMs = Math.max(0, now.getTime() - lastActivityAt.getTime())
  if (quietForMs < DISCOVERY_WARM_AFTER_MS) return 'hot'
  if (quietForMs < DISCOVERY_COLD_AFTER_MS) return 'warm'
  return 'cold'
}

/**
 * Interval this property must wait before its next discovery poll: the base
 * interval scaled by the tier multiplier, capped at
 * DISCOVERY_MAX_INTERVAL_MS. Never below the base interval — the ladder only
 * ever REDUCES polling.
 */
export const discoveryIntervalMs = (
  activity: DiscoveryActivity,
  now: Date,
  baseIntervalMs: number,
): number => {
  const tier = discoveryTierFor(activity, now)
  const scaled = baseIntervalMs * DISCOVERY_TIER_MULTIPLIER[tier]
  return Math.max(baseIntervalMs, Math.min(scaled, DISCOVERY_MAX_INTERVAL_MS))
}

/** Absolute instant of this property's next discovery poll. */
export const nextDiscoveryDueAt = (
  activity: DiscoveryActivity,
  now: Date,
  baseIntervalMs: number,
): Date => new Date(now.getTime() + discoveryIntervalMs(activity, now, baseIntervalMs))
