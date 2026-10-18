// Monthly portal goal — the number box's steps and the note an own number gets,
// for the set sheet (pure, client-safe; ADR 0068 decision 4).
//
// The − and + of the box move along the same grid the recommended number is
// rounded onto, and an own number is measured against the month's exact usual
// as the card read sends it (decimal integers in lowest terms: JSON has no
// BigInt). Components import Reporting's values from here, never from the
// domain (the components boundary in eslint.config.js).
import {
  ownNumberNote as ownNumberNoteOfExact,
  type OwnNumberNote,
} from '../domain/goal-number-steps'
import type { PortalGoalRatio } from '../domain/goal-recommendation-types'

export { goalStepDown, goalStepUp } from '../domain/goal-number-steps'
export type { OwnNumberNote }

/** About how many times the month's usual an own number is, or under half of it; else null. */
export function ownNumberNote(
  typed: number,
  usual: PortalGoalRatio,
): OwnNumberNote | null {
  return ownNumberNoteOfExact(typed, { num: BigInt(usual.num), den: BigInt(usual.den) })
}
