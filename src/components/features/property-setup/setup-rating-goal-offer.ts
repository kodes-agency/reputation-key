// The Google import's last step offers the rating goal wizard (ADR 0067,
// decisions 9 and 13): only after a single-Property import (a multi-Property
// import skips it and the setup strip reminds per Property), and only once
// Google's numbers for the new Property are in and a goal can be set. Until
// then it says nothing; the setup strip reminds later.
import type { RatingGoalSetupView } from '#/contexts/reporting/application/dto/rating-goal.types'
import { ratingGoalStartIntent } from '#/components/goals/rating-goal-overview-view'
import type { RatingGoalWizardIntent } from '#/components/goals/rating-goal-wizard-view'
import type { SetupImportedProperty } from './property-setup-contract'

export type ImportRatingGoalOffer =
  | Readonly<{ kind: 'nothing' }>
  | Readonly<{ kind: 'offer'; intent: RatingGoalWizardIntent }>

/** The Property a single-Property import set up; null for any other import. */
export function ratingGoalImportProperty(
  properties: readonly SetupImportedProperty[],
): string | null {
  const [only, ...more] = properties
  return only !== undefined && more.length === 0 ? only.propertyId : null
}

export function importRatingGoalOffer(
  setup: RatingGoalSetupView | undefined,
): ImportRatingGoalOffer {
  if (setup === undefined || !setup.eligibility.eligible || setup.hasActiveGoal) {
    return { kind: 'nothing' }
  }
  return { kind: 'offer', intent: ratingGoalStartIntent(setup) }
}

/** Read again while there is no answer yet: Google's first numbers come with the first sync. */
export function waitsForGoogle(setup: RatingGoalSetupView | undefined): boolean {
  if (setup === undefined) return true
  return !setup.eligibility.eligible && setup.eligibility.reason === 'waiting_for_google'
}
