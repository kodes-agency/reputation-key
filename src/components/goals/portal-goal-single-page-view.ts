// The page of a goal for one Portal, one Portal Group or the average private
// rating (PLAN PG-21): its title and whom it counts, the average's line and its
// tile, and what its Stop and its change sheet are called. A Portal's or a
// group's goal is otherwise the Monthly portal goal's page, in its words
// (`portal-goal-page-view.ts`). The read decides every state, day and number
// (PLAN E12); this only says them. Pure.
import type {
  PortalGoalAverageOfPage,
  PortalGoalSingleSubject,
} from '#/contexts/reporting/application/dto/portal-goal-single-page.types'
import { daysLeftWords } from './goal-live-view'
import { goalMetricLabel } from './goal-metric-label'
import { goalFigure } from './goal-so-far'
import type { PortalGoalTileWords } from './portal-goal-page-view'
import { MONTH_FIGURE_UNREADABLE } from './portal-goal-running-view'
import { dayWords, monthName } from './portal-goal-words'

/** L-2: the average's name, and its page's title. */
const AVERAGE_GOAL_NAME = goalMetricLabel('portal_rating_average')

/** L-6: what the average is, under its title. */
export const AVERAGE_GOAL_LINE =
  'The average private rating guests give at your portals. A month needs at least 10 ratings.'

/**
 * Stop and the change sheet on a goal other than the Monthly portal goal, which
 * they would otherwise name (X-1, P-16 and S-1, after N-8's "Portal goal").
 */
export const SINGLE_GOAL_WORDS = {
  stopTitle: 'Stop this portal goal?',
  stopped: 'Portal goal stopped',
  changeTitle: 'Change this portal goal',
} as const

/** L-7: one subject as the Goals list names it, "Reception" or "Rooms (group)". */
export function singleSubjectWords(subject: PortalGoalSingleSubject): string {
  switch (subject.kind) {
    case 'portal':
      return subject.name ?? 'Portal'
    case 'portal_group':
      return `${subject.name ?? 'Group'} (group)`
    case 'property':
      return subject.name ?? ''
  }
}

/** The page's title: "Reception · portal goal"; the average's is its name. */
export function singleGoalTitle(
  subject: PortalGoalSingleSubject,
  kind: 'subject' | 'average' = 'subject',
): string {
  return kind === 'average'
    ? AVERAGE_GOAL_NAME
    : `${singleSubjectWords(subject)} · portal goal`
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
