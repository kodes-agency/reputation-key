// Property Google rating goal — the daily evaluation of every active goal.
//
// A goal's status also moves without a new fact from Google: its pace window
// slides every day, so a goal can fall below its pace on a day Review verified
// nothing. Once a day every active goal is therefore evaluated as a page read
// or the snapshot consumer would evaluate it (rating-goal-shared.ts), and the
// same evaluation raises whatever notice the change calls for — Below pace
// above all, which no snapshot raises on its own (ADR 0067 decision 6).
//
// The listing crosses tenants and carries identifiers only. Each goal's
// Organization and Property are decided again by `authorize` (goal.use,
// suspension, the beta allowlist) before anything of theirs is read. A goal
// that ended or was replaced since it was listed is skipped. One goal that
// fails does not stop the others: the run finishes, then fails with its counts
// and content-free causes so the queue retries it, and the retry tells nobody
// twice (the evaluation writes a change once).

import { isRatingGoalError } from '../../domain/rating-goal'
import type { RatingGoalScope } from '../ports/property-rating-goal.repository'
import {
  evaluateActiveRatingGoal,
  type RatingGoalEvaluationDependencies,
} from './rating-goal-shared'

/** Goals listed per page. */
const PAGE_SIZE = 100

/** May the sweep act for this Organization and Property now? */
export type AuthorizeRatingGoalScope = (
  organizationId: string,
  propertyId: string,
) => Promise<boolean>

export type RatingGoalSweepStats = Readonly<{
  /** Active goals listed. */
  inspected: number
  /** Goals evaluated (stored or not). */
  evaluated: number
  /** Goals whose Organization or Property policy refused. */
  denied: number
  /** Notices raised, one fact each. */
  notices: number
  /** Goals whose evaluation threw. */
  failed: number
  /**
   * What they failed of: a rating goal error code, `sqlstate_<code>` for a
   * database refusal, else the error's class. Never a message or an
   * identifier (BQC-7.3).
   */
  failureCauses: Readonly<Record<string, number>>
}>

/** Thrown after the run when any goal failed; carries the run's counts. */
export class RatingGoalSweepError extends Error {
  readonly stats: RatingGoalSweepStats

  constructor(stats: RatingGoalSweepStats) {
    const causes = Object.entries(stats.failureCauses)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([cause, count]) => `${cause} x${count}`)
      .join(', ')
    super(`Rating goal evaluation failed for ${stats.failed} goal(s): ${causes}`)
    this.name = 'RatingGoalSweepError'
    this.stats = stats
  }
}

const SQLSTATE = /^[0-9A-Z]{5}$/u

/** The SQLSTATE of a database refusal, through the query error that wraps it. */
function sqlStateOf(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null
  const { code, cause } = error as { code?: unknown; cause?: unknown }
  if (typeof code === 'string' && SQLSTATE.test(code)) return code
  return sqlStateOf(cause)
}

function failureCauseOf(error: unknown): string {
  if (isRatingGoalError(error)) return error.code
  const sqlState = sqlStateOf(error)
  if (sqlState !== null) return `sqlstate_${sqlState}`
  return error instanceof Error ? error.name : 'unknown'
}

type ScopeOutcome =
  | Readonly<{ kind: 'evaluated'; notices: number }>
  | Readonly<{ kind: 'denied' }>
  | Readonly<{ kind: 'skipped' }>
  | Readonly<{ kind: 'failed'; cause: string }>

async function evaluateScope(
  deps: RatingGoalEvaluationDependencies,
  authorize: AuthorizeRatingGoalScope,
  scope: RatingGoalScope,
): Promise<ScopeOutcome> {
  // A policy outage throws here and fails the run for a queue retry.
  if (!(await authorize(scope.organizationId, scope.propertyId))) {
    return { kind: 'denied' }
  }
  try {
    const goal = await deps.repository.findActive(scope.organizationId, scope.propertyId)
    if (goal === null || goal.id !== scope.goalId) return { kind: 'skipped' }
    const evaluated = await evaluateActiveRatingGoal(deps, goal)
    return { kind: 'evaluated', notices: evaluated.notices.length }
  } catch (error) {
    return { kind: 'failed', cause: failureCauseOf(error) }
  }
}

/** The run's counts with one more goal's outcome added. */
function tally(stats: RatingGoalSweepStats, outcome: ScopeOutcome): RatingGoalSweepStats {
  const inspected = { ...stats, inspected: stats.inspected + 1 }
  switch (outcome.kind) {
    case 'evaluated':
      return {
        ...inspected,
        evaluated: stats.evaluated + 1,
        notices: stats.notices + outcome.notices,
      }
    case 'denied':
      return { ...inspected, denied: stats.denied + 1 }
    case 'skipped':
      return inspected
    case 'failed':
      return {
        ...inspected,
        failed: stats.failed + 1,
        failureCauses: {
          ...stats.failureCauses,
          [outcome.cause]: (stats.failureCauses[outcome.cause] ?? 0) + 1,
        },
      }
  }
}

const NO_GOALS: RatingGoalSweepStats = {
  inspected: 0,
  evaluated: 0,
  denied: 0,
  notices: 0,
  failed: 0,
  failureCauses: {},
}

/** Evaluates every active rating goal once, page by page in goal id order. */
export async function sweepRatingGoals(
  deps: RatingGoalEvaluationDependencies,
  authorize: AuthorizeRatingGoalScope,
): Promise<RatingGoalSweepStats> {
  let stats = NO_GOALS
  let after: Pick<RatingGoalScope, 'goalId'> | null = null
  for (;;) {
    const page = await deps.repository.listActiveGoalScopes(after, PAGE_SIZE)
    for (const scope of page) {
      stats = tally(stats, await evaluateScope(deps, authorize, scope))
    }
    const last = page.at(-1)
    if (page.length < PAGE_SIZE || last === undefined) break
    after = { goalId: last.goalId }
  }
  if (stats.failed > 0) throw new RatingGoalSweepError(stats)
  return stats
}
