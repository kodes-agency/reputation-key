// The page of a goal for one Portal, one Portal Group or the average private
// rating (PLAN PG-21): its title and whom it counts, where its ratings count,
// the average's line and its tile, a stopped or paused goal's state, what its
// Stop and its change sheet are called, and the plain page of a goal for
// several subjects. A Portal's or a group's goal is otherwise the Monthly
// portal goal's page, in its words (`portal-goal-page-view.ts`). The read
// decides every state, day and number (PLAN E12); this only says them. Pure.
import type { GoalMetric, GoalSubject } from '#/contexts/reporting/application/public-api'
import type {
  PortalGoalAverageOfPage,
  PortalGoalSeveralOfPage,
  PortalGoalSingleSubject,
} from '#/contexts/reporting/application/dto/portal-goal-single-page.types'
import { goalListSubjectText } from './goal-assignment-subject-label'
import { daysLeftWords, goalLiveView } from './goal-live-view'
import { goalMetricLabel } from './goal-metric-label'
import { goalFigure } from './goal-so-far'
import { pageBodyLine, type PortalGoalTileWords } from './portal-goal-page-view'
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

/**
 * L-7: one subject as the Goals list names it, "Reception" or "Rooms
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

/** L-6 for the Property's average; a Portal's or a group's says where it counts. */
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
 * 12." (G-29's first words), "Stopped." with no day recorded, or "Paused.";
 * nothing for a goal that is counting or waiting for its first month.
 */
export function goalStateLine(
  goal: Readonly<{ status: PortalGoalAverageOfPage['status']; endedOn: string | null }>,
): string | null {
  if (goal.status === 'paused') return 'Paused.'
  if (goal.status !== 'ended') return null
  return goal.endedOn === null ? 'Stopped.' : `Stopped on ${dayWords(goal.endedOn)}.`
}

/** A subject named as the read named it, back in the Goals list's shape. */
function goalSubjectOf(subject: PortalGoalSingleSubject): GoalSubject {
  const id = subject.key.slice(subject.key.indexOf(':') + 1)
  switch (subject.kind) {
    case 'property':
      return { kind: 'property', propertyId: id }
    case 'portal':
      return { kind: 'portal', portalId: id }
    case 'portal_group':
      return { kind: 'portal_group', portalGroupId: id }
  }
}

/**
 * L-7: a goal for several subjects as its row on the Goals page names them,
 * "Reception and 2 more" (the Property by its name, a nameless one as the row
 * says it).
 */
function severalSubjectsWords(
  subjects: readonly PortalGoalSingleSubject[],
  propertyName: string,
): string {
  const names = new Map(subjects.map(({ key, name }) => [key, name]))
  const nameOf = (subject: GoalSubject): string => {
    if (subject.kind === 'property') return propertyName
    const key =
      subject.kind === 'portal'
        ? `portal:${subject.portalId}`
        : `portal_group:${subject.portalGroupId}`
    return names.get(key) ?? (subject.kind === 'portal' ? 'Portal' : 'Group')
  }
  return goalListSubjectText(subjects.map(goalSubjectOf), nameOf) ?? propertyName
}

/**
 * The plain page of a goal for several subjects: its title ("Reception and 2
 * more · portal goal") and what it counts where (P-2's line for a count, L-6's
 * for the average).
 */
export function severalGoalWords(
  metric: GoalMetric,
  subjects: readonly PortalGoalSingleSubject[],
  propertyName: string,
): Readonly<{ title: string; line: string }> {
  const whom = severalSubjectsWords(subjects, propertyName)
  return {
    title: `${whom} · portal goal`,
    line:
      metric === 'portal_rating_average'
        ? `The average private rating guests give at ${whom}. A month needs at least 10 ratings.`
        : pageBodyLine(metric, [whom], propertyName),
  }
}

/**
 * This month of a goal for several subjects, as its row on the Goals page says
 * it ("3 subjects · 1 below pace"); its first day while it waits ("Starts on
 * Dec 1."); nothing once it counts no month.
 */
export function severalMonthLine(goal: PortalGoalSeveralOfPage): string | null {
  if (goal.live !== null) return goalLiveView(goal.live)?.text ?? null
  if (goal.status === 'scheduled' && goal.startsOn !== null) {
    return `Starts on ${dayWords(goal.startsOn)}.`
  }
  return null
}
