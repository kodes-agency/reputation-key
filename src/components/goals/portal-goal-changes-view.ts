// What changed on the Monthly portal goal, as its page lists it (copy deck
// P-10…P-12): each dated fact the read returned, newest first, the person named
// when the page knows them, "(recommended)" when the number was the one
// recommended, the unit when the goal switched what it counts, a note on its
// own line, and each Portal going live; a day of another year says its year.
// At most 12 until "Show all". Pure.
import type { PortalGoalChange } from '#/contexts/reporting/application/dto/monthly-portal-goal-page.types'
import { formatLocalDate, formatNumber } from '#/lib/format'
import { dayWords, listOfNames, monthName, portalGoalUnit } from './portal-goal-words'

/** How many changes the page lists before "Show all". */
const CHANGES_SHOWN = 12

/** How many changes the page lists before "Show all": the first one it adds takes the focus. */
export const FIRST_HIDDEN_CHANGE = CHANGES_SHOWN

export type PortalGoalChangeLine = Readonly<{
  key: string
  /** "Oct 23", or "Mar 3, 2025" in another year. */
  date: string
  /** "Elena set 40 a month from November (recommended)" */
  text: string
  /** A note the change was made with, in quotes; null without one. */
  note: string | null
}>

/** Who did it, as the sentence starts: "Elena set", or "Set" with no name. */
function doer(name: string | null, verb: string): string {
  return name === null
    ? `${verb.charAt(0).toUpperCase()}${verb.slice(1)}`
    : `${name} ${verb}`
}

const recommended = (source: 'recommended' | 'own' | null): string =>
  source === 'recommended' ? ' (recommended)' : ''

/** One change, in words. */
function changeText(
  change: PortalGoalChange,
  personName: (userId: string) => string | null,
): string {
  switch (change.kind) {
    case 'set_from': {
      const name = personName(change.by)
      const number = `${formatNumber(change.target)} a month from ${monthName(change.fromMonth)}`
      return change.switched
        ? `${doer(name, 'switched')} to ${portalGoalUnit(change.measure, 2)}: ${number}${recommended(change.source)}`
        : `${doer(name, 'set')} ${number}${recommended(change.source)}`
    }
    case 'set_month':
      return `${doer(personName(change.by), 'set')} ${monthName(change.month)} to ${formatNumber(change.target)}${recommended(change.source)}`
    case 'stopped': {
      const name = personName(change.by)
      return name === null ? 'The goal was stopped' : `${name} stopped the goal`
    }
    case 'went_live':
      return `${listOfNames(change.portals)} went live`
  }
}

/** "Oct 23" this year; "Mar 3, 2025" in another. */
const changeDay = (day: string, today: string): string =>
  day.slice(0, 4) === today.slice(0, 4) ? dayWords(day) : (formatLocalDate(day) ?? day)

const noteOf = (change: PortalGoalChange): string | null =>
  (change.kind === 'set_from' || change.kind === 'set_month') && change.note !== null
    ? `“${change.note}”`
    : null

/**
 * The changes as the page lists them: newest first (as read), the first 12
 * unless all are asked for, and whether more are left.
 */
export function changeLines(
  changes: readonly PortalGoalChange[],
  personName: (userId: string) => string | null,
  today: string,
  all = false,
): Readonly<{ lines: readonly PortalGoalChangeLine[]; more: boolean }> {
  const shown = all ? changes : changes.slice(0, CHANGES_SHOWN)
  return {
    lines: shown.map((change, index) => ({
      key: `${change.on}-${index}`,
      date: changeDay(change.on, today),
      text: changeText(change, personName),
      note: noteOf(change),
    })),
    more: shown.length < changes.length,
  }
}
