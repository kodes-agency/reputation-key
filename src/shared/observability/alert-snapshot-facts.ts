// What the operations snapshot says an alert was raised on, as AlertFacts
// (alert-facts.ts): job family names, readiness reasons, route event type names
// and counts the job runtime report and the delivery-lag read already hold.

import type { OperationsSnapshot } from '#/shared/health/operations-snapshot'
import type { AlertFacts } from './alert-facts'

type DeliveryLag = OperationsSnapshot['notifications']['deliveryLag']

/** The job families the runtime report finds unready, and the reasons they are. */
export function unreadyJobFacts(
  jobs: NonNullable<OperationsSnapshot['jobs']>,
): AlertFacts {
  const unready = jobs.rows.filter((row) => !row.ready)
  return {
    jobs: unready.map((row) => row.jobName),
    reasons: [...new Set(unready.flatMap((row) => row.reasons))],
    count: jobs.failing,
  }
}

/** The quarantined job count, and the families the runtime report finds dead letters for. */
export function quarantineFacts(snapshot: OperationsSnapshot, count: number): AlertFacts {
  const jobs = (snapshot.jobs?.rows ?? [])
    .filter((row) => row.deadLetterCount > 0)
    .map((row) => row.jobName)
  return jobs.length > 0 ? { count, jobs } : { count }
}

/**
 * What is waiting when in-app delivery runs late: the pending count, the source
 * receipts by route event type (a closed set of names, never a row's content),
 * and the reasons that qualify them. The breakdown comes from a bounded scan
 * of the oldest facts, so a stage that hit its cap says so.
 */
export function inAppDeliveryLagFacts(lag: DeliveryLag, pending: number): AlertFacts {
  const reasons = [
    ...(lag.sourceSaturated ? ['source_scan_saturated'] : []),
    ...(lag.materializationPending > 0 ? ['materialization_pending'] : []),
    ...(lag.materializationSaturated ? ['materialization_scan_saturated'] : []),
  ]
  return {
    count: pending,
    codes: lag.sourceReceiptPendingByEventType,
    ...(reasons.length > 0 ? { reasons } : {}),
  }
}
