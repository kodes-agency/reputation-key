// The Monthly portal goal's set sheet, worked out (copy deck S-1…S-11; PLAN
// PG-10): from what the card read sent (`PortalGoalSheetFacts`) and what the
// manager has done in the sheet (the draft), every word, number and state it
// shows, and what Set sends. The read decides the months, the offers and the
// usual (PLAN E12); the only sums here are the box's steps along the goal grid
// and the note an own number gets, both from Reporting's application layer.
// Nothing here throws on what was typed: letters, spaces, a 0 or a number too
// big for a goal make the box invalid and Set unavailable, never an error.
import type { PortalGoalMeasure } from '#/contexts/reporting/application/dto/goal-recommendation.types'
import type {
  PortalGoalOffer,
  PortalGoalSheetFacts,
  SetMonthlyPortalGoalRequest,
} from '#/contexts/reporting/application/dto/monthly-portal-goal.types'
import {
  goalStepDown,
  goalStepUp,
  ownNumberNote,
} from '#/contexts/reporting/application/goal-number-steps'
import { formatNumber } from '#/lib/format'
import { PORTAL_GOAL_NAME } from './portal-goal-copy'
import { countsFromWords } from './portal-goal-offer-words'
import { dayWords, monthName, portalGoalCount, portalGoalUnit } from './portal-goal-words'

/** The highest monthly number a goal takes (the set command's own limit). */
const HIGHEST_NUMBER = 1_000_000
const RATINGS: PortalGoalMeasure = 'portal_rating_count'

/** What opens the sheet: the measure its door names. The month is the read's. */
export type PortalGoalSheetIntent = Readonly<{ measure: PortalGoalMeasure }>

/** What the manager has chosen so far: a month, a measure, and the box as typed. */
export type PortalGoalSheetDraft = Readonly<{
  month: string
  measure: PortalGoalMeasure
  /** What the number box holds, exactly as typed. */
  text: string
}>

/** One thing the manager did in the sheet. */
export type PortalGoalSheetChange =
  | Readonly<{ kind: 'month'; month: string }>
  | Readonly<{ kind: 'measure'; measure: PortalGoalMeasure }>
  /** A step, a suggested number, or the way back to the recommended one. */
  | Readonly<{ kind: 'number'; value: number }>
  | Readonly<{ kind: 'type'; text: string }>
  /** Enter, or the box was left. */
  | Readonly<{ kind: 'commit' }>

type Step = Readonly<{ label: string; to: number | null }>

export type PortalGoalSheetModel = Readonly<{
  /** S-1. */
  title: string
  /** S-2: when it starts, or that this month counts from its first day. */
  description: string
  /** S-2: this month and the next. */
  months: readonly Readonly<{ value: string; label: string }>[]
  /** The month in effect. */
  month: string
  /** S-3: the tile's band. */
  band: string
  unit: string
  number: Readonly<{
    text: string
    /** The number Set would send; null when the box holds none it can. */
    value: number | null
    /** Something is typed that no goal takes. */
    invalid: boolean
    /** S-11: "40 private ratings". */
    valueText: string | null
    lower: Step
    raise: Step
  }>
  /** S-4, in the order usual, a bit more, stretch; null with no offer. */
  choices:
    readonly Readonly<{ value: number; label: string; recommended: boolean }>[] | null
  /** The suggested number the box holds, if it holds one. */
  chosen: number | null
  /** S-5, S-6 (with its way back) or S-7. */
  status: Readonly<{
    text: string
    restore: Readonly<{ label: string; value: number }> | null
  }>
  /** S-8. */
  notes: readonly string[]
  /** G-16 goes with private ratings. */
  asksEveryGuest: boolean
  /** What "How we worked this out" explains; null with no offer. */
  offer: PortalGoalOffer | null
  /** S-9. */
  switchMeasure: Readonly<{ label: string; measure: PortalGoalMeasure }>
  /** S-10. */
  primary: Readonly<{ label: string; disabled: boolean }>
  submission: Omit<SetMonthlyPortalGoalRequest, 'propertyId'> | null
}>

/** The offer for a month and a measure, as the read sent it. */
function offerFor(
  facts: PortalGoalSheetFacts,
  month: string,
  measure: PortalGoalMeasure,
): PortalGoalOffer | null {
  const offers = facts.offers[measure]
  if (month === facts.ownNumber.current.key) return offers.current
  if (month === facts.ownNumber.next.key) return offers.next
  return null
}

/** The month in effect: the draft's, unless the read no longer offers it. */
function monthOf(draft: PortalGoalSheetDraft, facts: PortalGoalSheetFacts): string {
  const { current, next } = facts.ownNumber
  return draft.month === current.key || draft.month === next.key
    ? draft.month
    : facts.month
}

/** The box with the offer's recommended number in it, or empty without one. */
const recommendedText = (offer: PortalGoalOffer | null): string =>
  offer === null ? '' : String(offer.choices.aBitMore)

export function openingDraft(
  facts: PortalGoalSheetFacts,
  intent: PortalGoalSheetIntent,
): PortalGoalSheetDraft {
  return {
    month: facts.month,
    measure: intent.measure,
    text: recommendedText(offerFor(facts, facts.month, intent.measure)),
  }
}

/**
 * What a typed text reads as: nothing, a whole number (any size, grouping and
 * spaces ignored), or something else.
 */
type Reading =
  | Readonly<{ kind: 'empty' }>
  | Readonly<{ kind: 'whole'; n: number }>
  | Readonly<{ kind: 'other' }>

function readText(text: string): Reading {
  const digits = text.replaceAll(/[\s,]/gu, '')
  if (digits === '') return { kind: 'empty' }
  return /^\d+$/u.test(digits) ? { kind: 'whole', n: Number(digits) } : { kind: 'other' }
}

const takes = (n: number): boolean =>
  Number.isSafeInteger(n) && n >= 1 && n <= HIGHEST_NUMBER

/** Whether the box holds one of the offer's three suggested numbers. */
function suggests(offer: PortalGoalOffer | null, text: string): boolean {
  const reading = readText(text)
  if (offer === null || reading.kind !== 'whole') return false
  const { usual, aBitMore, stretch } = offer.choices
  return [usual, aBitMore, stretch].includes(reading.n)
}

export function changedDraft(
  draft: PortalGoalSheetDraft,
  change: PortalGoalSheetChange,
  facts: PortalGoalSheetFacts,
): PortalGoalSheetDraft {
  switch (change.kind) {
    case 'month': {
      // A month's choices come with it. Where there are none, a number of the
      // manager's own stays, but not one the other month suggested.
      const offer = offerFor(facts, change.month, draft.measure)
      const left = offerFor(facts, monthOf(draft, facts), draft.measure)
      return {
        ...draft,
        month: change.month,
        text: offer
          ? recommendedText(offer)
          : suggests(left, draft.text)
            ? ''
            : draft.text,
      }
    }
    case 'measure':
      // A number of one measure is no number of the other.
      return {
        ...draft,
        measure: change.measure,
        text: recommendedText(offerFor(facts, monthOf(draft, facts), change.measure)),
      }
    case 'number':
      return { ...draft, text: String(change.value) }
    case 'type':
      return { ...draft, text: change.text }
    case 'commit': {
      const reading = readText(draft.text)
      return reading.kind === 'whole' && Number.isSafeInteger(reading.n)
        ? { ...draft, text: String(reading.n) }
        : draft
    }
  }
}

const stepTo = (verb: 'Lower' | 'Raise', to: number | null): Step => ({
  label: to === null ? verb : `${verb} to ${formatNumber(to)}`,
  to,
})

/** S-11: − and + along the goal grid, from the number typed (or from none). */
function stepsFrom(reading: Reading): Readonly<{ lower: Step; raise: Step }> {
  if (reading.kind !== 'whole' || reading.n === 0) {
    return { lower: stepTo('Lower', null), raise: stepTo('Raise', 1) }
  }
  if (reading.n > HIGHEST_NUMBER) {
    return { lower: stepTo('Lower', HIGHEST_NUMBER), raise: stepTo('Raise', null) }
  }
  return {
    lower: stepTo('Lower', goalStepDown(reading.n)),
    raise: stepTo('Raise', reading.n === HIGHEST_NUMBER ? null : goalStepUp(reading.n)),
  }
}

/** S-4: the three suggestions, "a bit more" the recommended one (P-3). */
function choicesOf(offer: PortalGoalOffer | null): PortalGoalSheetModel['choices'] {
  if (offer === null) return null
  const { usual, aBitMore, stretch } = offer.choices
  return [
    { value: usual, label: `${formatNumber(usual)} · your usual`, recommended: false },
    {
      value: aBitMore,
      label: `${formatNumber(aBitMore)} · a bit more`,
      recommended: true,
    },
    { value: stretch, label: `${formatNumber(stretch)} · stretch`, recommended: false },
  ]
}

/** S-5, S-6 and S-7: what the number is. */
function statusOf(
  offer: PortalGoalOffer | null,
  value: number | null,
  facts: PortalGoalSheetFacts,
): PortalGoalSheetModel['status'] {
  if (offer === null) {
    const ready =
      facts.readyOn === null ? '' : ` Your number is ready on ${dayWords(facts.readyOn)}.`
    return { text: `No recommendation yet.${ready}`, restore: null }
  }
  const recommended = offer.choices.aBitMore
  if (value === recommended) {
    return {
      text: `Recommended · a bit above your usual over the last ${offer.basis.weeks} weeks`,
      restore: null,
    }
  }
  return {
    text: 'Your own number',
    restore: {
      label: `Back to ${formatNumber(recommended)}, recommended`,
      value: recommended,
    },
  }
}

/** S-8: how far an own number is from the month's usual, when it is far. */
function notesOf(offer: PortalGoalOffer | null, value: number | null): readonly string[] {
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

/** S-10: "Set 40 for November", "Set 55 scans for November"; "Set goal" with no number. */
function primaryOf(
  measure: PortalGoalMeasure,
  month: string,
  value: number | null,
): PortalGoalSheetModel['primary'] {
  if (value === null) return { label: 'Set goal', disabled: true }
  const number =
    measure === RATINGS ? formatNumber(value) : portalGoalCount(measure, value)
  return { label: `Set ${number} for ${monthName(month)}`, disabled: false }
}

export function portalGoalSheetModel(
  draft: PortalGoalSheetDraft,
  facts: PortalGoalSheetFacts,
): PortalGoalSheetModel {
  const { measure } = draft
  const month = monthOf(draft, facts)
  const { current, next } = facts.ownNumber
  const offer = offerFor(facts, month, measure)
  const reading = readText(draft.text)
  const value = reading.kind === 'whole' && takes(reading.n) ? reading.n : null
  const soFar = measure === RATINGS ? current.soFar.ratings : current.soFar.scans
  const choices = choicesOf(offer)
  return {
    title: PORTAL_GOAL_NAME,
    description:
      month === current.key
        ? countsFromWords(month, soFar)
        : `Starts on ${dayWords(`${month}-01`)}.`,
    months: [current.key, next.key].map((key) => ({ value: key, label: monthName(key) })),
    month,
    band: monthName(month),
    unit: portalGoalUnit(measure, value ?? 0),
    number: {
      text: draft.text,
      value,
      invalid: reading.kind !== 'empty' && value === null,
      valueText: value === null ? null : portalGoalCount(measure, value),
      ...stepsFrom(reading),
    },
    choices,
    chosen: choices?.find((choice) => choice.value === value)?.value ?? null,
    status: statusOf(offer, value, facts),
    notes: notesOf(offer, value),
    asksEveryGuest: measure === RATINGS,
    offer,
    switchMeasure:
      measure === RATINGS
        ? { label: 'Count scans instead', measure: 'qualified_scans' }
        : { label: 'Count private ratings instead', measure: RATINGS },
    primary: primaryOf(measure, month, value),
    submission:
      value === null
        ? null
        : {
            metric: measure,
            targetValue: value,
            startMonth: month,
            targetSource: value === offer?.choices.aBitMore ? 'recommended' : 'own',
          },
  }
}
