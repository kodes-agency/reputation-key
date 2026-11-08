import type { RatingGoalSetupView } from '#/contexts/reporting/rating-goals/contracts'
import {
  HIGHEST_TARGET_TENTHS,
  KEEP_FIRST_FROM_TENTHS,
} from '#/contexts/reporting/application/rating-goal-setup-plan'
import type { RatingGoalWizardIntent } from './rating-goal-wizard-view'

export function ratingGoalStartIntent(
  setup: RatingGoalSetupView,
): RatingGoalWizardIntent {
  const shows = setup.google?.shows ?? null
  return setup.offerKeepFirst && shows !== null
    ? { kind: 'keep', targetTenths: Math.round(shows * 10) }
    : { kind: 'climb' }
}

/** Keep is offered from 4.7 and alone from 4.9, where no higher tenth can be planned. */
export function ratingGoalNextIntents(
  outcome: Readonly<{ state: 'reached' | 'ended'; targetTenths: number }>,
): readonly RatingGoalWizardIntent[] {
  const climb = { kind: 'climb' } as const
  if (outcome.state === 'ended') return [climb]
  const keep = { kind: 'keep', targetTenths: outcome.targetTenths } as const
  if (outcome.targetTenths < KEEP_FIRST_FROM_TENTHS) return [climb]
  return outcome.targetTenths >= HIGHEST_TARGET_TENTHS ? [keep] : [climb, keep]
}
