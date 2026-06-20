// Invariant: no jobs were enqueued without a registered handler.
// Catches missing job registrations — a job was enqueued but the handler
// wasn't registered, meaning the job would silently no-op in production.

import type { InMemoryQueue } from '../../in-memory-queue'
import type { InvariantChecker } from '../types'

export type NoOrphanedJobsDeps = Readonly<{
  queue?: InMemoryQueue
}>

export const noOrphanedJobs = (deps: NoOrphanedJobsDeps): InvariantChecker => ({
  id: 'no-orphaned-jobs',
  description: 'No jobs were enqueued without a registered handler',
  async check() {
    if (!deps.queue) return []

    const enqueued = deps.queue.enqueuedJobs
    const processed = deps.queue.processedJobs
    const orphaned = enqueued.length - processed.length

    if (orphaned <= 0) return []

    // Identify which job names were never processed
    const processedNames = new Set(processed.map((j) => j.name))
    const orphanedJobs = enqueued.filter((j) => !processedNames.has(j.name))
    const orphanedByName = new Map<string, number>()
    for (const job of orphanedJobs) {
      orphanedByName.set(job.name, (orphanedByName.get(job.name) ?? 0) + 1)
    }

    return [
      {
        checker: 'no-orphaned-jobs',
        severity: 'warning' as const,
        message: `${orphaned} job(s) enqueued without a registered handler`,
        evidence: {
          totalEnqueued: enqueued.length,
          totalProcessed: processed.length,
          orphanedByJobName: Object.fromEntries(orphanedByName),
        },
      },
    ]
  },
})
