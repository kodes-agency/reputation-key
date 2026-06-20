// Invariant runner — aggregates all checkers into a single report.
// Used post-simulation to surface cross-context consistency violations.

import type { Container } from '#/composition'
import type { InvariantChecker, InvariantContext, InvariantReport } from './types'
import type { InMemoryQueue } from '../in-memory-queue'
import { reviewInboxConsistency } from './checkers/review-inbox-consistency'
import { slaConsistency } from './checkers/sla-consistency'
import { inboxStatusLegal } from './checkers/inbox-status-legal'
import { noOrphanedJobs } from './checkers/no-orphaned-jobs'

export type {
  InvariantContext,
  InvariantReport,
  InvariantChecker,
  InvariantViolation,
} from './types'

/**
 * Wire the container's repos into invariant checkers.
 * Returns the full set of checkers for a simulation.
 */
export function createInvariantCheckers(
  container: Container,
  queue?: InMemoryQueue,
): ReadonlyArray<InvariantChecker> {
  return [
    reviewInboxConsistency({
      reviewRepo: container.reviewRepo,
      inboxRepo: container.inboxRepo,
    }),
    slaConsistency({
      reviewRepo: container.reviewRepo,
      replyRepo: container.replyRepo,
      clock: container.clock,
    }),
    inboxStatusLegal({
      reviewRepo: container.reviewRepo,
      replyRepo: container.replyRepo,
      inboxRepo: container.inboxRepo,
    }),
    noOrphanedJobs({ queue }),
  ]
}

/**
 * Run all invariant checkers against the simulation state.
 * Returns a report with violations and pass/fail counts.
 */
export async function runInvariants(
  checkers: ReadonlyArray<InvariantChecker>,
  ctx: InvariantContext,
): Promise<InvariantReport> {
  const results = await Promise.all(
    checkers.map(async (checker) => {
      try {
        return await checker.check(ctx)
      } catch (err) {
        return [
          {
            checker: checker.id,
            severity: 'error' as const,
            message: `Checker threw: ${err instanceof Error ? err.message : String(err)}`,
          },
        ]
      }
    }),
  )
  const violations = results.flat()
  const failedCheckerIds = new Set(violations.map((v) => v.checker))
  return {
    violations,
    totalCheckers: checkers.length,
    passed: checkers.length - failedCheckerIds.size,
    failed: failedCheckerIds.size,
    ok: violations.length === 0,
  }
}
