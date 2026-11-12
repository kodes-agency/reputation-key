// The read owns subject scope, eligibility, states and figures. Portal and group goals
// reuse the monthly page; averages retain sample-floor messaging and several-subject
// goals retain Stop.

import type {
  PortalGoalAverageOfPage,
  PortalGoalSingleSubject,
} from '#/contexts/reporting/monthly-goals/contracts'
import { daysLeftWords } from '../../../../components/goals/goal-live-view'
import { goalMetricLabel } from '../../../../components/goals/goal-metric-label'
import { goalFigure } from '../../../../components/goals/goal-so-far'
import type { PortalGoalTileWords } from './portal-goal-page-view'
import { MONTH_FIGURE_UNREADABLE } from './portal-goal-running-view'
import { dayWords, monthName } from './portal-goal-words'

/** The average's name, and its page's title. */
const AVERAGE_GOAL_NAME = goalMetricLabel('portal_rating_average')

/** What the average is, under its title. */
export const AVERAGE_GOAL_LINE =
  'The average private rating guests give at your portals. A month needs at least 10 ratings.'

/**
 * Stop and the change sheet on a goal other than the Monthly portal goal, which
 * they would otherwise name.
 */
export const SINGLE_GOAL_WORDS = {
  stopTitle: 'Stop this portal goal?',
  stopped: 'Portal goal stopped',
  changeTitle: 'Change this portal goal',
} as const

/**
 * One subject as the Goals list names it, "Reception" or "Rooms
 * (group)"; one Portal could not name, "Portal" or "Portal group".
 */
export function singleSubjectWords(subject: PortalGoalSingleSubject): string {
  switch (subject.kind) {
    case 'portal':
      return subject.name ?? 'Portal'
    case 'portal_group':
      return subject.name === null ? 'Portal group' : `${subject.name} (group)`
    case 'property':
      return subject.name ?? ''
  }
}

/**
 * Where a Portal's or a group's goal counts, as a sentence ends: "at
 * Reception", "at the portals in Rooms"; null for the Property's own.
 */
export function subjectPlace(subject: PortalGoalSingleSubject): string | null {
  switch (subject.kind) {
    case 'portal':
      return subject.name ?? 'this portal'
    case 'portal_group':
      return subject.name === null
        ? 'the portals in this group'
        : `the portals in ${subject.name}`
    case 'property':
      return null
  }
}

/**
 * The page's title: "Reception · portal goal". The Property's average is its
 * name; a Portal's or a group's average says whose ("Reception · Average
 * private rating"), as its row on the Goals page does.
 */
export function singleGoalTitle(
  subject: PortalGoalSingleSubject,
  kind: 'subject' | 'average' = 'subject',
): string {
  if (kind === 'subject') return `${singleSubjectWords(subject)} · portal goal`
  return subject.kind === 'property'
    ? AVERAGE_GOAL_NAME
    : `${singleSubjectWords(subject)} · ${AVERAGE_GOAL_NAME}`
}

/** For the Property's average; a Portal's or a group's says where it counts. */
export function averageGoalLine(subject: PortalGoalSingleSubject): string {
  const place = subjectPlace(subject)
  return place === null
    ? AVERAGE_GOAL_LINE
    : `The average private rating guests give at ${place}. A month needs at least 10 ratings.`
}

/** "4.5": an average's figure, to one decimal. */
const averageFigure = (value: number): string =>
  goalFigure('portal_rating_average', value)

/**
 * The average's tile: this month's governed average against its level ("4.6
 * so far · goal 4.5"), or how many ratings it still needs ("More ratings
 * needed · 6 of 10"), with the days left; its first month while it waits for
 * it; nothing once it no longer counts a month.
 */
export function averageTiles(
  goal: PortalGoalAverageOfPage,
): readonly PortalGoalTileWords[] {
  const { month } = goal
  if (month !== null) {
    const { reading } = month
    const detail = daysLeftWords(month.daysAfterToday)
    const base = { key: 'this', label: monthName(month.key) }
    switch (reading.kind) {
      case 'live':
        return [
          {
            ...base,
            value: `${averageFigure(reading.value)} so far · goal ${averageFigure(month.target)}`,
            detail,
          },
        ]
      case 'too_few':
        return [
          {
            ...base,
            value: `More ratings needed · ${reading.sampleCount} of ${reading.minimumSample}`,
            detail,
          },
        ]
      case 'unavailable':
        return [{ ...base, value: null, detail: MONTH_FIGURE_UNREADABLE }]
    }
  }
  if (goal.status === 'scheduled' && goal.startsOn !== null) {
    return [
      {
        key: 'this',
        label: monthName(goal.startsOn.slice(0, 7)),
        value: `Goal ${averageFigure(goal.target)}`,
        detail: `Starts on ${dayWords(goal.startsOn)}`,
      },
    ]
  }
  return []
}

/**
 * A goal that counts no month now says why, under its title: "Stopped on Nov
 * 12.", "Stopped." with no day recorded, or "Paused.";
 * nothing for a goal that is counting or waiting for its first month.
 */
export function goalStateLine(
  goal: Readonly<{ status: PortalGoalAverageOfPage['status']; endedOn: string | null }>,
): string | null {
  if (goal.status === 'paused') return 'Paused.'
  if (goal.status !== 'ended') return null
  return goal.endedOn === null ? 'Stopped.' : `Stopped on ${dayWords(goal.endedOn)}.`
}
