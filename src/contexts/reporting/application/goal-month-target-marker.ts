// Reporting — how a goal month came by the target it is judged against.
//
// A month opens on its version's target. While it runs, a manager can give it
// a target of its own, and every such change is logged. A surface that shows a
// month's target says so when the target is no longer the one the month started
// with: who changed it last, when, what it started at, and how many times it
// changed. A month changed and then changed back is judged against its first
// target again, so it carries no marker.
//
// Type-only imports beside the effective-target rule: this module is safe to
// reach from a route or a component.
import { effectiveMonthTarget } from './goal-effective-month-target'
import type {
  GoalMonthlyResult,
  GoalMonthTargetChange,
  GoalProgramVersion,
} from './ports/goal-program.repository'

export type GoalMonthTargetHistory = Readonly<{
  /** The target the month is judged against now. */
  effectiveTarget: number
  /** The target the month started with. */
  startTarget: number
  /** How many times the month's target was changed. */
  changeCount: number
  /** The latest change; null for a month whose target never changed. */
  lastChange: Readonly<{ at: Date; by: string }> | null
}>

/** What a surface prints beside a month's target once it differs from the first one. */
export type GoalMonthTargetMarker = Readonly<{
  changedAt: Date
  changedBy: string
  startTarget: number
  changeCount: number
}>

/** The part of a Program bundle a month's target history is read from. */
type TargetChangeSource = Readonly<{
  targetChanges?: readonly Pick<
    GoalMonthTargetChange,
    'monthlyResultId' | 'previousTargetValue' | 'createdAt' | 'createdBy'
  >[]
}>

/**
 * A month's target and the changes that led to it. `version` must be the
 * version the month belongs to (`programVersionId`), not the Program's head.
 */
export function monthTargetHistory(
  bundle: TargetChangeSource,
  result: Pick<GoalMonthlyResult, 'id' | 'targetValue'>,
  version: Pick<GoalProgramVersion, 'targetValue'>,
): GoalMonthTargetHistory {
  const effectiveTarget = effectiveMonthTarget(result, version)
  const changes = (bundle.targetChanges ?? [])
    .filter((change) => change.monthlyResultId === result.id)
    .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())
  const first = changes.at(0)
  const last = changes.at(-1)
  return {
    effectiveTarget,
    // Without a logged change the month still has the target it started with.
    startTarget: first?.previousTargetValue ?? effectiveTarget,
    changeCount: changes.length,
    lastChange: last ? { at: last.createdAt, by: last.createdBy } : null,
  }
}

/**
 * The marker of a month whose target is not the one it started with; null
 * otherwise, including for a month changed back to its first target.
 */
export function monthTargetMarker(
  bundle: TargetChangeSource,
  result: Pick<GoalMonthlyResult, 'id' | 'targetValue'>,
  version: Pick<GoalProgramVersion, 'targetValue'>,
): GoalMonthTargetMarker | null {
  const history = monthTargetHistory(bundle, result, version)
  if (!history.lastChange || history.effectiveTarget === history.startTarget) return null
  return {
    changedAt: history.lastChange.at,
    changedBy: history.lastChange.by,
    startTarget: history.startTarget,
    changeCount: history.changeCount,
  }
}
