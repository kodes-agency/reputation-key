// The readings behind the push health, reconciliation-age, head-coverage and
// count-drop alerts (alert-definitions.ts declares the alerts; this holds what
// they measure).
//
// All five are P2: each is a degraded fast path or a slipping safety net, not
// lost data. Polling provides the full-read safety net within the configured
// window. Their facts are counts only (alert-facts.ts).

import type { OperationsSnapshot } from '#/shared/health/operations-snapshot'
import type { AlertReading } from './alert-reading'
import {
  COUNT_DROP_PERSISTENT_AFTER_MS,
  HEAD_COVERAGE_ALERT_AFTER_MS,
  PUSH_MISSED_AFTER_MS,
} from '#/shared/domain/push-health'

const MINUTES = PUSH_MISSED_AFTER_MS / 60_000

/**
 * Polling found a new Review that no Google push covered within an hour, while
 * a topic is configured. A single miss counts: the fast path is meant to cover
 * every Review, and a miss is the only sign of a push that never came.
 */
export function readPushMissed(snapshot: OperationsSnapshot): AlertReading | null {
  const missed = snapshot.syncPush.push.missed24h
  if (!snapshot.sync.gbpPushEnabled || missed <= 0) return null
  return {
    value: missed,
    detail: `${missed} new review(s) found by polling in the last 24h had no Google push accepted within ${MINUTES} minutes (${snapshot.syncPush.push.late24h} more arrived late)`,
    facts: { count: missed },
  }
}

/**
 * Polling is finding new Reviews and Pub/Sub accepted no push at all in the
 * same day: the topic, the subscription or the endpoint is down. The common
 * case of a quiet day (nothing new) stays silent.
 */
export function readPushSilent(snapshot: OperationsSnapshot): AlertReading | null {
  const { newByPoll24h, acceptedPushes24h } = snapshot.syncPush.push
  if (!snapshot.sync.gbpPushEnabled || newByPoll24h <= 0 || acceptedPushes24h > 0) {
    return null
  }
  return {
    value: newByPoll24h,
    detail: `${newByPoll24h} new review(s) were found by polling in the last 24h and Pub/Sub accepted no push in that time — push is silent`,
    facts: { count: newByPoll24h },
  }
}

/**
 * A syncable Property has gone past its limit without a completed
 * reconciliation. It does not depend on push: the full reconciliation is
 * the safety net push relies on, and with push dark it is the only path. The
 * limit is the configured window plus two hours, or, above a day, a day plus
 * two hours for a Property no head check covers.
 */
export function readReconciliationAge(snapshot: OperationsSnapshot): AlertReading | null {
  const { overdueCount, oldestAgeMs, overdueAfterMs } = snapshot.syncPush.reconciliation
  if (overdueCount <= 0) return null
  return {
    value: oldestAgeMs ?? 0,
    threshold: overdueAfterMs,
    windowMs: overdueAfterMs,
    detail: `${overdueCount} syncable property(ies) have no completed reconciliation inside their window (${overdueAfterMs}ms with head cover); the oldest is ${oldestAgeMs ?? 0}ms behind`,
    facts: { count: overdueCount },
  }
}

/**
 * With a reconciliation window wider than a day, a Property skips its full
 * listing only while a persisting head check keeps its newest page stored.
 * One that went a day without that cover is still listed daily, so nothing is
 * lost; the wider window is just not holding for it (head checks dark or off,
 * failing, or the Property failing). Silent at a day or less.
 */
export function readHeadCoverage(snapshot: OperationsSnapshot): AlertReading | null {
  const { active, uncoveredCount, oldestUncoveredAgeMs } = snapshot.syncPush.headCoverage
  if (!active || uncoveredCount <= 0) return null
  return {
    value: oldestUncoveredAgeMs ?? 0,
    detail: `${uncoveredCount} syncable property(ies) had no head check store their newest page in the last ${HEAD_COVERAGE_ALERT_AFTER_MS}ms while the reconciliation window is over a day; they are listed in full daily instead`,
    facts: { count: uncoveredCount },
  }
}

/**
 * Google's review total has stayed below what a Property shows for 72 hours
 * after a head check first saw it, through up to twelve full reads the checks
 * asked for. A listing did not resolve it: Google may count a review it no
 * longer lists, or the reverse, or keep a deleted review in its list. The
 * checks stop asking for reads; someone looks at the Property instead.
 */
export function readCountDropPersistent(
  snapshot: OperationsSnapshot,
): AlertReading | null {
  const { persistentCount, oldestAgeMs } = snapshot.syncPush.countDrop
  if (persistentCount <= 0) return null
  return {
    value: oldestAgeMs ?? COUNT_DROP_PERSISTENT_AFTER_MS,
    detail: `${persistentCount} syncable property(ies) still show more reviews than Google's total ${COUNT_DROP_PERSISTENT_AFTER_MS}ms after a head check first saw it; head checks stopped asking for full reads`,
    facts: { count: persistentCount },
  }
}
