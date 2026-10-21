// The readings behind the push health and reconciliation-age alerts
// (alert-definitions.ts declares the alerts; this holds what they measure).
//
// All three are P2: each is a degraded fast path or a slipping safety net, not
// lost data. Polling still finds every Review within about six hours, so none
// of them pages out of hours. Their facts are counts only (alert-facts.ts).

import type { OperationsSnapshot } from '#/shared/health/operations-snapshot'
import type { AlertFacts } from './alert-facts'
import { PUSH_MISSED_AFTER_MS } from '#/shared/domain/push-health'

type AlertReading = Readonly<{ value: number; detail: string; facts?: AlertFacts }>

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
 * A syncable Property has gone past the limit without a completed
 * reconciliation. It does not depend on push: the six-hour reconciliation is
 * the safety net push relies on, and with push dark it is the only path.
 */
export function readReconciliationAge(snapshot: OperationsSnapshot): AlertReading | null {
  const { overdueCount, oldestAgeMs } = snapshot.syncPush.reconciliation
  if (overdueCount <= 0) return null
  return {
    value: oldestAgeMs ?? 0,
    detail: `${overdueCount} syncable property(ies) have no completed reconciliation inside the limit; the oldest is ${oldestAgeMs ?? 0}ms behind`,
    facts: { count: overdueCount },
  }
}
