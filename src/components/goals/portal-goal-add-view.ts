// "Add a portal goal", worked out (PLAN PG-20; copy deck M-1…M-14): from what
// the add read sent (`PortalGoalAddOptions`) and what the manager has chosen,
// every word and state of the sheet's choosing steps, what an address opens,
// and what Set says once done. The number steps are
// `portal-goal-add-number-view.ts`, and "A goal for each portal"
// `portal-goal-add-each-view.ts`. The read decides which choices are open,
// every number, private-rating eligibility, and "Has a goal" (PLAN E12).
import type {
  AddPortalGoalRequest,
  PortalGoalAddHeld,
  PortalGoalAddOffer,
  PortalGoalAddOptions,
} from '#/contexts/reporting/application/dto/monthly-portal-goal-add.types'
import { formatNumber } from '#/lib/format'
import { goalMetricLabel } from './goal-metric-label'
import {
  AVERAGE_METRIC,
  averageWords,
  type PortalGoalAddSubmission,
} from './portal-goal-add-number-view'
import { dayWords, monthName, portalGoalCount } from './portal-goal-words'

/** What the sheet adds: a goal for one Portal, for each, for a group, or the average. */
export type PortalGoalAddKind = 'portal' | 'each' | 'group' | 'average'

/** The steps an address may open: the choice, or one of its own steps. */
export type PortalGoalAddStep = 'choose' | PortalGoalAddKind

/** M-2: the sheet's title on every step. */
export const ADD_TITLE = 'Add a portal goal'
/** M-9: a subject that takes no second goal on the measure. */
const HAS_A_GOAL = 'Has a goal'

type Choice = Readonly<{
  kind: PortalGoalAddKind
  title: string
  description: string
  disabled: boolean
  /** Why it is closed, when that is a fact to tell. */
  fact: string | null
  /** The goal that closes it, for "Has a goal"'s link (the average's). */
  held: PortalGoalAddHeld | null
}>

/** Some Portal or group of these still takes a goal: one without "Has a goal". */
const someOpen = (offers: readonly PortalGoalAddOffer[]): boolean =>
  offers.some(({ heldBy }) => heldBy === null)

/**
 * M-3…M-6: the choices the read opens, in the screens' order. A goal for one
 * Portal, for each, or for a group is drawn while one of its Portals or groups
 * can still take a goal; with every one held there is nothing to pick there.
 */
function choicesFor(options: PortalGoalAddOptions): readonly Choice[] {
  const { average } = options
  const open = (kind: PortalGoalAddKind, title: string, description: string): Choice => ({
    kind,
    title,
    description,
    disabled: false,
    fact: null,
    held: null,
  })
  return [
    ...(someOpen(options.onePortal)
      ? [
          open(
            'portal',
            'A goal for one portal',
            'Its own monthly number, next to the property’s.',
          ),
        ]
      : []),
    ...(someOpen(options.eachPortal.map(({ offer }) => offer))
      ? [open('each', 'A goal for each portal', 'One recommended number per portal.')]
      : []),
    ...(someOpen(options.groups)
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
      title: goalMetricLabel(AVERAGE_METRIC),
      description:
        'A level to hold for the whole property. Needs 10 private ratings a month.',
      disabled: !average.available || average.heldBy !== null,
      fact:
        average.heldBy !== null
          ? HAS_A_GOAL
          : average.available
            ? null
            : `Your portals had ${formatNumber(average.last4Weeks)} in the last 4 weeks.`,
      held: average.heldBy,
    },
  ]
}

/**
 * M-rule: whether anything can be added (a choice that is open), so whether
 * "More portal goals" asks and the Goals page draws the door.
 */
export function portalGoalAddOffered(options: PortalGoalAddOptions): boolean {
  return choicesFor(options).some(({ disabled }) => !disabled)
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
    showSpotLine: ![...options.onePortal, ...options.groups].some(
      (offer) => offer.staffTarget,
    ),
    choices,
    next: { disabled: chosen === undefined || chosen.disabled },
  }
}

/** A subject's key, as an address names it: `portal:<id>`, `portal_group:<id>`. */
const keyOfSubject = (subject: PortalGoalAddOffer['subject']): string =>
  subject.kind === 'portal'
    ? `portal:${subject.portalId}`
    : `portal_group:${subject.portalGroupId}`

/**
 * The subjects a save added a goal for, as the reads of their goals' month so
 * far name them (a Portal Group page's goal card reads `portal_group:<id>`);
 * the average's Property has no such read apart from the Portal-goal reads.
 */
export const addedSubjectKeys = (
  subject: AddPortalGoalRequest['subject'],
): readonly string[] => (subject.kind === 'property' ? [] : [keyOfSubject(subject)])

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

/**
 * The offer the number step is for, while it can still take a goal: null once
 * the read no longer offers it or says it has a goal (it was taken a moment
 * ago), so the step goes back to its list, where its row says so.
 */
export function numberOfferOf(
  options: PortalGoalAddOptions,
  key: string | null,
): PortalGoalAddOffer | null {
  const offer = offerOf(options, key)
  return offer === null || offer.heldBy !== null ? null : offer
}

/** M-12: "Reception goal set: 22 private ratings for December"; the average's by its name. */
export function addedToast(
  options: PortalGoalAddOptions,
  sent: PortalGoalAddSubmission,
): string {
  const month = monthName(options.month)
  const { subject, targetValue } = sent
  if (subject.kind === 'property') {
    return `${goalMetricLabel(AVERAGE_METRIC)} goal set: ${averageWords(targetValue)} for ${month}`
  }
  const name = offerOf(options, keyOfSubject(subject))?.name ?? ''
  return `${name} goal set: ${portalGoalCount(offerOf(options, keyOfSubject(subject))?.measure ?? options.measure, targetValue)} for ${month}`
}

/** What an address asks the sheet to open on: `?add=` and its subject. */
export type PortalGoalAddAddress = Readonly<{
  add?: PortalGoalAddStep
  subject?: string
}>

/**
 * The step an address opens, with its subject when that is one the read offers
 * and it can still take a goal (anyone can type an address); a step the read
 * does not offer opens the choice. No `add`, or nothing to add (the M-rule),
 * no sheet.
 */
export function openingOf(
  options: PortalGoalAddOptions,
  address: PortalGoalAddAddress,
): Readonly<{ step: PortalGoalAddStep; subject: string | null }> | null {
  const { add } = address
  if (add === undefined || !portalGoalAddOffered(options)) return null
  if (add === 'choose') return { step: 'choose', subject: null }
  const open = choicesFor(options).find(({ kind }) => kind === add)
  if (open === undefined || open.disabled) return { step: 'choose', subject: null }
  if (add !== 'portal' && add !== 'group') return { step: add, subject: null }
  const offered = numberOfferOf(options, address.subject ?? null)
  const fits =
    offered !== null &&
    offered.subject.kind === (add === 'portal' ? 'portal' : 'portal_group')
  return { step: add, subject: fits ? subjectKey(offered) : null }
}

/** Staff choices stay hidden while the account capability is off, including old links. */
export function staffGoalOptions(
  options: PortalGoalAddOptions,
  enabled: boolean,
): PortalGoalAddOptions {
  if (enabled) return options
  return {
    ...options,
    onePortal: options.onePortal.filter((offer) => !offer.staffTarget),
    groups: options.groups.filter((offer) => !offer.staffTarget),
    eachPortal: options.eachPortal.filter(({ offer }) => !offer.staffTarget),
  }
}
