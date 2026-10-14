// The Properties list's "Google goal" cell, worked out from the stored goal the
// fleet read carries (decision 13): "4.5 · On pace", "Set goal", or a dash. It
// never evaluates the goal; the goal's own pages do.
import type { FleetRatingGoal } from '#/contexts/reporting/application/public-api'
import { RATING_GOAL_STATUS, ratingText } from '#/components/goals/rating-goal-view'

export type GoogleGoalCell =
  /**
   * An active goal: its target and the status it last stored (null before the
   * first), and both as one line ("4.5 · On pace") for a phone and a name.
   */
  | Readonly<{ kind: 'goal'; target: string; status: string | null; text: string }>
  /** No goal, one is offered, and the viewer may set it. */
  | Readonly<{ kind: 'set' }>
  | Readonly<{ kind: 'none' }>

/** `canCreate`: the viewer holds `goal.create` (from `usePermissions`). */
export function googleGoalCell(
  goal: FleetRatingGoal | null,
  canCreate: boolean,
): GoogleGoalCell {
  if (goal === null) return { kind: 'none' }
  if (goal.kind === 'set') {
    const target = ratingText(goal.target)
    const status = goal.status === null ? null : RATING_GOAL_STATUS[goal.status].label
    return {
      kind: 'goal',
      target,
      status,
      text: status === null ? target : `${target} · ${status}`,
    }
  }
  return goal.offered && canCreate ? { kind: 'set' } : { kind: 'none' }
}
