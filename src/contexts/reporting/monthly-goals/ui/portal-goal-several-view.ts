import type { PortalGoalSeveralOfPage, PortalGoalSingleSubject } from '../contracts'
import { goalListSubjectText } from '#/components/goals/goal-assignment-subject-label'
import { goalLiveView } from '#/components/goals/goal-live-view'
import { pageBodyLine } from '#/components/goals/portal-goal-page-view'
import { dayWords } from '#/components/goals/portal-goal-words'

/** Keep the page's subject order and wording aligned with the Goals list. */
export function severalGoalWords(
  metric: PortalGoalSeveralOfPage['metric'],
  subjects: readonly PortalGoalSingleSubject[],
  propertyName: string,
): Readonly<{ title: string; line: string }> {
  const whom =
    goalListSubjectText(subjects, (subject) =>
      subject.kind === 'property'
        ? propertyName
        : (subject.name ?? (subject.kind === 'portal' ? 'Portal' : 'Group')),
    ) ?? propertyName
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
