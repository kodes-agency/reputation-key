// Invariant: every job the simulation enqueued actually ran to completion.
//
// Three distinct states hide behind "enqueued but not processed", and they have
// different causes and different fixes. Reporting them as one line — and
// labelling all of them "without a registered handler" — sent readers hunting
// for wiring that was not missing. They are now separated:
//
//   1. no handler registered  -> ERROR. The original intent of this checker: in
//      production the queue accepts the job and it silently no-ops.
//   2. handler ran and THREW  -> ERROR, naming the error. A throwing handler in
//      a deterministic simulation is a defect, not tolerable noise.
//   3. handler registered but never invoked -> WARNING. Genuinely timing: the
//      registry is late-bound (`connectRegistry` runs after bootstrap), so a
//      job enqueued during bootstrap found no handler at the time even though
//      one exists now.
//
// A missing `deps.queue` is itself a violation: returning [] made a WIRING
// mistake in the harness present as a pass.

import type { InMemoryQueue } from '../../in-memory-queue'
import type { JobRegistry } from '#/shared/jobs/registry'
import type { InvariantChecker, InvariantViolation } from '../types'

export type NoOrphanedJobsDeps = Readonly<{
  queue?: InMemoryQueue
  /**
   * The registry the queue was connected to. Without it, "the handler threw"
   * and "there is no handler" are indistinguishable by job name alone.
   */
  registry?: JobRegistry
}>

const CHECKER = 'no-orphaned-jobs'

function countByName(
  rows: ReadonlyArray<Readonly<{ name: string }>>,
): ReadonlyMap<string, number> {
  const counts = new Map<string, number>()
  for (const row of rows) counts.set(row.name, (counts.get(row.name) ?? 0) + 1)
  return counts
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** First error message per job name, so the evidence names the cause. */
function firstErrorByName(
  failures: ReadonlyArray<Readonly<{ name: string; error: unknown }>>,
): ReadonlyMap<string, string> {
  const first = new Map<string, string>()
  for (const failure of failures) {
    if (!first.has(failure.name)) first.set(failure.name, errorText(failure.error))
  }
  return first
}

const listed = (entries: ReadonlyArray<readonly [string, number]>): string =>
  entries.map(([name, count]) => `${name} (${count})`).join(', ')

const totalOf = (entries: ReadonlyArray<readonly [string, number]>): number =>
  entries.reduce((sum, [, count]) => sum + count, 0)

export const noOrphanedJobs = (deps: NoOrphanedJobsDeps): InvariantChecker => ({
  id: CHECKER,
  description: 'Every enqueued job ran to completion under a registered handler',
  async check() {
    if (!deps.queue) {
      return [
        {
          checker: CHECKER,
          severity: 'error' as const,
          message:
            'No queue was injected — this checker cannot observe any job, so a missing job registration would report as a pass',
        },
      ]
    }
    if (!deps.registry) {
      return [
        {
          checker: CHECKER,
          severity: 'error' as const,
          message:
            'No job registry was injected — an unregistered job and a throwing handler cannot be told apart, so this checker cannot report either one honestly',
        },
      ]
    }
    const registry = deps.registry

    const enqueuedByName = countByName(deps.queue.enqueuedJobs)
    const processedByName = countByName(deps.queue.processedJobs)
    const failedByName = countByName(deps.queue.failedJobs)
    const errorByName = firstErrorByName(deps.queue.failedJobs)

    const unregistered: Array<readonly [string, number]> = []
    const threw: Array<readonly [string, number]> = []
    const undrained: Array<readonly [string, number]> = []

    for (const [name, enqueued] of enqueuedByName) {
      const outstanding = enqueued - (processedByName.get(name) ?? 0)
      if (outstanding <= 0) continue

      const failures = failedByName.get(name) ?? 0
      if (failures > 0) threw.push([name, failures])

      // Whatever is outstanding beyond the recorded throws never reached a
      // handler at all: either none is registered, or none was registered yet.
      const unaccounted = outstanding - failures
      if (unaccounted <= 0) continue

      if (registry.getHandler(name) === undefined) {
        unregistered.push([name, unaccounted])
      } else {
        undrained.push([name, unaccounted])
      }
    }

    const violations: InvariantViolation[] = []

    if (unregistered.length > 0) {
      violations.push({
        checker: CHECKER,
        severity: 'error' as const,
        message: `${totalOf(unregistered)} job(s) enqueued with no registered handler — they would silently no-op in production: ${listed(unregistered)}`,
        evidence: { unregisteredByJobName: Object.fromEntries(unregistered) },
      })
    }

    if (threw.length > 0) {
      violations.push({
        checker: CHECKER,
        severity: 'error' as const,
        message: `${totalOf(threw)} job(s) had a registered handler that THREW: ${threw
          .map(
            ([name, count]) =>
              `${name} (${count}x: ${errorByName.get(name) ?? 'unknown error'})`,
          )
          .join('; ')}`,
        evidence: {
          failedByJobName: Object.fromEntries(threw),
          firstErrorByJobName: Object.fromEntries(errorByName),
        },
      })
    }

    if (undrained.length > 0) {
      violations.push({
        checker: CHECKER,
        severity: 'warning' as const,
        message: `${totalOf(undrained)} job(s) have a registered handler but were never invoked (enqueued before the registry was connected): ${listed(undrained)}`,
        evidence: { undrainedByJobName: Object.fromEntries(undrained) },
      })
    }

    return violations
  },
})
