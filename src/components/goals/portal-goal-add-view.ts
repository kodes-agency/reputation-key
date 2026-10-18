// "Add a portal goal", worked out (PLAN PG-20; copy deck M-1…M-14): from what
// the add read sent (`PortalGoalAddOptions`) and what the manager has chosen,
// every word, number and state of the sheet's steps but "A goal for each
// portal" (`portal-goal-add-each-view.ts`), and what Set sends. The read
// decides which choices are open, every number, and "Has a goal" (PLAN E12);
// the only sums here are the box's steps (the goal grid for a count, tenths for
// the average). Nothing here throws on what was typed.
import type {
  AddPortalGoalRequest,
  PortalGoalAddHeld,
  PortalGoalAddOffer,
  PortalGoalAddOptions,
} from '#/contexts/reporting/application/dto/monthly-portal-goal-add.types'
import { formatNumber } from '#/lib/format'
import { goalMetricLabel } from './goal-metric-label'
import { countsFromWords } from './portal-goal-offer-words'
import {
  choicesOf,
  readText,
  stepsFrom,
  takes,
  type PortalGoalSheetModel,
} from './portal-goal-sheet-view'
import { dayWords, monthName, portalGoalCount, portalGoalUnit } from './portal-goal-words'

/** What the sheet adds: a goal for one Portal, for each, for a group, or the average. */
export type PortalGoalAddKind = 'portal' | 'each' | 'group' | 'average'

/** The steps an address may open: the choice, or one of its own steps. */
export type PortalGoalAddStep = 'choose' | PortalGoalAddKind

/** M-2: the sheet's title on every step. */
export const ADD_TITLE = 'Add a portal goal'
/** M-9: a subject that takes no second goal on the measure. */
const HAS_A_GOAL = 'Has a goal'

const AVERAGE: AddPortalGoalRequest['metric'] = 'portal_rating_average'

/** What a goal for one Portal, one group or the average sends; the host adds the Property. */
export type PortalGoalAddSubmission = Omit<AddPortalGoalRequest, 'propertyId'>

/** M-rule: whether anything can be added, so whether "More portal goals" says so. */
export function portalGoalAddOffered(options: PortalGoalAddOptions): boolean {
  const { onePortal, groups, average } = options
  return (
    onePortal.length > 0 ||
    groups.length > 0 ||
    (average.available && average.heldBy === null)
  )
}

type Choice = Readonly<{
  kind: PortalGoalAddKind
  title: string
  description: string
  disabled: boolean
  /** Why it is closed, when that is a fact to tell. */
  fact: string | null
}>

/** M-3…M-6: the choices the read opens, in the screens' order. */
function choicesFor(options: PortalGoalAddOptions): readonly Choice[] {
  const { average } = options
  const open = (kind: PortalGoalAddKind, title: string, description: string): Choice => ({
    kind,
    title,
    description,
    disabled: false,
    fact: null,
  })
  return [
    ...(options.onePortal.length > 0
      ? [
          open(
            'portal',
            'A goal for one portal',
            'Its own monthly number, next to the property’s.',
          ),
        ]
      : []),
    ...(options.eachPortal.length > 0
      ? [open('each', 'A goal for each portal', 'One recommended number per portal.')]
      : []),
    ...(options.groups.length > 0
      ? [
          open(
            'group',
            'A goal for a portal group',
            'One number for the portals in a group.',
          ),
        ]
      : []),
    {
      kind: 'average',
      title: goalMetricLabel(AVERAGE),
      description:
        'A level to hold for the whole property. Needs 10 private ratings a month.',
      disabled: !average.available || average.heldBy !== null,
      fact:
        average.heldBy !== null
          ? HAS_A_GOAL
          : average.available
            ? null
            : `Your portals had ${formatNumber(average.last4Weeks)} in the last 4 weeks.`,
    },
  ]
}

/** M-2…M-8: the first step, with the choice picked so far. */
export function chooseModel(
  options: PortalGoalAddOptions,
  picked: PortalGoalAddKind | null,
) {
  const choices = choicesFor(options)
  const chosen = choices.find(({ kind }) => kind === picked)
  return {
    description: 'What do you want to add?',
    choices,
    next: { disabled: chosen === undefined || chosen.disabled },
  }
}

/** A subject's key, as an address names it: `portal:<id>`, `portal_group:<id>`. */
const keyOfSubject = (subject: PortalGoalAddOffer['subject']): string =>
  subject.kind === 'portal'
    ? `portal:${subject.portalId}`
    : `portal_group:${subject.portalGroupId}`

const subjectKey = (offer: PortalGoalAddOffer): string => keyOfSubject(offer.subject)

const offersOf = (options: PortalGoalAddOptions, of: 'portal' | 'group') =>
  of === 'portal' ? options.onePortal : options.groups

/** A Portal or group the manager can pick, or not: "Has a goal", "New · ready Oct 29". */
export type PortalGoalAddRow = Readonly<{
  key: string
  name: string
  disabled: boolean
  note: string | null
  /** The goal that holds it, for "Has a goal"'s link. */
  held: PortalGoalAddHeld | null
}>

export function subjectRow(offer: PortalGoalAddOffer): PortalGoalAddRow {
  return {
    key: subjectKey(offer),
    name: offer.name,
    disabled: offer.heldBy !== null,
    note:
      offer.heldBy !== null
        ? HAS_A_GOAL
        : offer.readyOn === null
          ? null
          : `New · ready ${dayWords(offer.readyOn)}`,
    held: offer.heldBy,
  }
}

/** M-9: "Which portal?" (or group), with the one picked so far. */
export function whichModel(
  options: PortalGoalAddOptions,
  of: 'portal' | 'group',
  picked: string | null,
) {
  const rows = offersOf(options, of).map(subjectRow)
  const chosen = rows.find(({ key }) => key === picked)
  return {
    description: of === 'portal' ? 'Which portal?' : 'Which group?',
    rows,
    next: { disabled: chosen === undefined || chosen.disabled },
  }
}

/** The offer a key names, among the Portals or the groups. */
export function offerOf(
  options: PortalGoalAddOptions,
  key: string | null,
): PortalGoalAddOffer | null {
  return (
    [...options.onePortal, ...options.groups].find(
      (offer) => subjectKey(offer) === key,
    ) ?? null
  )
}

/** The Set button: "Set 22 for December", "Set 55 scans for December"; "Set goal" with no number. */
function primaryOf(
  options: PortalGoalAddOptions,
  number: string | null,
): Readonly<{ label: string; disabled: boolean }> {
  return number === null
    ? { label: 'Set goal', disabled: true }
    : { label: `Set ${number} for ${monthName(options.month)}`, disabled: false }
}

/** M-10: the number step of a goal for one Portal or one group. */
export function numberModel(
  options: PortalGoalAddOptions,
  offer: PortalGoalAddOffer,
  text: string,
) {
  const { measure, month } = options
  const reading = readText(text)
  const value = reading.kind === 'whole' && takes(reading.n) ? reading.n : null
  const choices = offer.choices === null ? null : choicesOf({ choices: offer.choices })
  const submission: PortalGoalAddSubmission | null =
    value === null
      ? null
      : {
          subject: offer.subject,
          metric: measure,
          targetValue: value,
          startMonth: month,
          targetSource: value === offer.choices?.aBitMore ? 'recommended' : 'own',
        }
  return {
    band: `${offer.name} · ${monthName(month)}`,
    description: options.current
      ? countsFromWords(month, offer.soFar)
      : `Starts on ${dayWords(`${month}-01`)}.`,
    unit: portalGoalUnit(measure, value ?? 0),
    number: {
      text,
      value,
      invalid: reading.kind !== 'empty' && value === null,
      valueText: value === null ? null : portalGoalCount(measure, value),
      ...stepsFrom(reading),
    } satisfies PortalGoalSheetModel['number'],
    choices,
    chosen: choices?.find((choice) => choice.value === value)?.value ?? null,
    primary: primaryOf(
      options,
      value === null
        ? null
        : measure === 'portal_rating_count'
          ? formatNumber(value)
          : portalGoalCount(measure, value),
    ),
    submission,
  }
}

/** The average's box: tenths from 1 to 5. */
const LOWEST_AVERAGE = 1
const HIGHEST_AVERAGE = 5
const TENTHS = 10

/** A typed average: a number from 1 to 5 with at most one decimal (a comma or a point). */
function averageOf(text: string): Readonly<{ empty: boolean; value: number | null }> {
  const typed = text.trim().replace(',', '.')
  if (typed === '') return { empty: true, value: null }
  if (!/^\d(\.\d)?$/u.test(typed)) return { empty: false, value: null }
  const value = Number(typed)
  return {
    empty: false,
    value: value >= LOWEST_AVERAGE && value <= HIGHEST_AVERAGE ? value : null,
  }
}

const tenth = (value: number): number => Math.round(value * TENTHS) / TENTHS
const averageWords = (value: number): string => value.toFixed(1)

function averageSteps(value: number | null) {
  const step = (verb: 'Lower' | 'Raise', to: number | null) => ({
    label: to === null ? verb : `${verb} to ${averageWords(to)}`,
    to,
  })
  if (value === null) {
    return { lower: step('Lower', null), raise: step('Raise', LOWEST_AVERAGE) }
  }
  return {
    lower: step('Lower', value <= LOWEST_AVERAGE ? null : tenth(value - 1 / TENTHS)),
    raise: step('Raise', value >= HIGHEST_AVERAGE ? null : tenth(value + 1 / TENTHS)),
  }
}

const AVERAGE_UNIT = 'average private rating'

/** M-6, M-14: the average step; its box starts empty, and the number is the manager's own. */
export function averageModel(options: PortalGoalAddOptions, text: string) {
  const { empty, value } = averageOf(text)
  return {
    description: goalMetricLabel(AVERAGE),
    band: monthName(options.month),
    unit: AVERAGE_UNIT,
    status: 'Needs 10 private ratings a month.',
    number: {
      text,
      value,
      invalid: !empty && value === null,
      valueText: value === null ? null : `${averageWords(value)} ${AVERAGE_UNIT}`,
      ...averageSteps(value),
    } satisfies PortalGoalSheetModel['number'],
    primary: primaryOf(options, value === null ? null : averageWords(value)),
    submission:
      value === null
        ? null
        : ({
            subject: { kind: 'property' },
            metric: AVERAGE,
            targetValue: value,
            startMonth: options.month,
            targetSource: 'own',
          } satisfies PortalGoalAddSubmission),
  }
}

/** The box as Enter or leaving it writes it: a whole count plainly, an average to tenths. */
export function committedText(text: string, average: boolean): string {
  if (average) {
    const { value } = averageOf(text)
    return value === null ? text : averageWords(value)
  }
  const reading = readText(text)
  return reading.kind === 'whole' && Number.isSafeInteger(reading.n)
    ? String(reading.n)
    : text
}

/** M-12: "Reception goal set: 22 private ratings for December"; the average's by its name. */
export function addedToast(
  options: PortalGoalAddOptions,
  sent: PortalGoalAddSubmission,
): string {
  const month = monthName(options.month)
  const { subject, targetValue } = sent
  if (subject.kind === 'property') {
    return `${goalMetricLabel(AVERAGE)} goal set: ${averageWords(targetValue)} for ${month}`
  }
  const name = offerOf(options, keyOfSubject(subject))?.name ?? ''
  return `${name} goal set: ${portalGoalCount(options.measure, targetValue)} for ${month}`
}

/** What an address asks the sheet to open on: `?add=` and its subject. */
export type PortalGoalAddAddress = Readonly<{
  add?: PortalGoalAddStep
  subject?: string
}>

/**
 * The step an address opens, with its subject when that is one the read offers
 * (anyone can type an address); a step the read does not offer opens the
 * choice. No `add`, no sheet.
 */
export function openingOf(
  options: PortalGoalAddOptions,
  address: PortalGoalAddAddress,
): Readonly<{ step: PortalGoalAddStep; subject: string | null }> | null {
  const { add } = address
  if (add === undefined) return null
  if (add === 'choose') return { step: 'choose', subject: null }
  const open = choicesFor(options).find(({ kind }) => kind === add)
  if (open === undefined || open.disabled) return { step: 'choose', subject: null }
  if (add !== 'portal' && add !== 'group') return { step: add, subject: null }
  const offered = offerOf(options, address.subject ?? null)
  const fits =
    offered !== null &&
    offered.subject.kind === (add === 'portal' ? 'portal' : 'portal_group')
  return { step: add, subject: fits ? subjectKey(offered) : null }
}
