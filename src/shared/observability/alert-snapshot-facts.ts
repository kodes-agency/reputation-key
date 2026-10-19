// What the operations snapshot says an alert was raised on, as AlertFacts
// (alert-facts.ts): job family names, readiness reasons and counts the job
// runtime report already holds.

import type { OperationsSnapshot } from '#/shared/health/operations-snapshot'
import type { AlertFacts } from './alert-facts'

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
