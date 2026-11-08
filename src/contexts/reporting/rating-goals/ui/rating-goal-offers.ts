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

export function ratingGoalNextIntents(
  outcome: Readonly<{ state: 'reached' | 'ended' }>,
  googleShowsNow: number | null,
): readonly RatingGoalWizardIntent[] {
  const climb = { kind: 'climb' } as const
  if (outcome.state === 'ended') return [climb]
  if (googleShowsNow === null) return [climb]
  const tenths = Math.round(googleShowsNow * 10)
  const keep = { kind: 'keep', targetTenths: tenths } as const
  if (tenths < KEEP_FIRST_FROM_TENTHS) return [climb]
  return tenths >= HIGHEST_TARGET_TENTHS ? [keep] : [climb, keep]
}
