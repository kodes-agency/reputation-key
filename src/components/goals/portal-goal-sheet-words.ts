// The read owns recommendation numbers. Share wording across set, change and add
// sheets; derive own-number differences through Reporting's rule.

import type { PortalGoalMeasure } from '#/contexts/reporting/application/dto/goal-recommendation.types'
import type {
  PortalGoalOffer,
  PortalGoalSheetFacts,
} from '#/contexts/reporting/application/dto/monthly-portal-goal.types'
import { ownNumberNote } from '#/contexts/reporting/application/goal-number-steps'
import { formatNumber } from '#/lib/format'
import type { GoalStatusPart } from './goal-setup-parts'
import { dayWords, portalGoalUnit, RECOMMENDED_TAG } from './portal-goal-words'

/** One part of the status line; a link's action is the number it goes back to. */
export type PortalGoalStatusPart = GoalStatusPart<number>

/** One suggested number, as a row. */
export type PortalGoalChoice = Readonly<{
  value: number
  /** "35". */
  figure: string
  /** "your usual". */
  words: string
  recommended: boolean
}>

/** U-S2 (S-4 split): the three suggestions, "a bit more" the recommended one (P-3). */
export function choicesOf(
  offer: Pick<PortalGoalOffer, 'choices'> | null,
): readonly PortalGoalChoice[] | null {
  if (offer === null) return null
  const { usual, aBitMore, stretch } = offer.choices
  return [
    {
      value: usual,
      figure: formatNumber(usual),
      words: 'your usual',
      recommended: false,
    },
    {
      value: aBitMore,
      figure: formatNumber(aBitMore),
      words: 'a bit more',
      recommended: true,
    },
    {
      value: stretch,
      figure: formatNumber(stretch),
      words: 'stretch',
      recommended: false,
    },
  ]
}

/** S-5, S-6 and S-7 (S-23 when changing): what the number is. */
export function statusOf(
  offer: PortalGoalOffer | null,
  value: number | null,
  facts: PortalGoalSheetFacts,
): readonly PortalGoalStatusPart[] {
  if (offer === null) {
    const ready =
      facts.readyOn === null ? '' : ` Your number is ready on ${dayWords(facts.readyOn)}.`
    return [{ kind: 'text', text: `No recommendation yet.${ready}` }]
  }
  const recommended = offer.choices.aBitMore
  if (value === recommended) {
    return [
      { kind: 'tag', text: RECOMMENDED_TAG },
      {
        kind: 'text',
        text: `a bit above your usual over the last ${offer.basis.weeks} weeks`,
      },
    ]
  }
  return [
    { kind: 'text', text: 'Your own number' },
    {
      kind: 'link',
      text: `Back to ${formatNumber(recommended)}, recommended`,
      action: recommended,
    },
  ]
}

/** U-S3: "We count private ratings each calendar month." */
export const countsLine = (measure: PortalGoalMeasure): string =>
  `We count ${portalGoalUnit(measure, 2)} each calendar month.`

/** S-8: how far an own number is from the month's usual, when it is far. */
export function notesOf(
  offer: PortalGoalOffer | null,
  value: number | null,
): readonly string[] {
  if (offer === null || value === null) return []
  const { num, den } = offer.usualExact
  const note = ownNumberNote(value, { num: BigInt(num), den: BigInt(den) })
  if (note === null) return []
  return [
    note.kind === 'times'
      ? `That is about ${formatNumber(note.times)} times your usual.`
      : 'That is under half your usual.',
  ]
}
