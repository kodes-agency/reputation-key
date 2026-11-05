// An unreadable figure replaces the headline and ruler; never render it as zero. Pace
// belongs to the card pill or page header.

import type { PortalGoalRunningMonth } from '#/contexts/reporting/application/dto/monthly-portal-goal.types'
import { GoalHeadline } from './goal-headline'
import { GoalRuler } from './goal-ruler'
import { portalGoalRuler } from './portal-goal-ruler-view'
import { runningWords } from './portal-goal-running-view'

/** How far along the month is, against its number. */
export function PortalGoalMonthRuler({
  month,
}: Readonly<{ month: PortalGoalRunningMonth }>) {
  const ruler = portalGoalRuler(month)
  return ruler === null ? null : <GoalRuler model={ruler} />
}

/** U-C2 and U-C3: what is left to the number, or that it is passed; with the days left in the month under it. */
export function PortalGoalMonthHeadline({
  month,
}: Readonly<{ month: PortalGoalRunningMonth }>) {
  const words = runningWords(month)
  if (words.kind !== 'figure') return null
  const { headline } = words
  return (
    <>
      {headline.kind === 'passed' ? (
        <p className="text-2xl leading-tight font-semibold">{headline.text}</p>
      ) : (
        <GoalHeadline
          count={headline.count}
          words={headline.words}
          target={headline.target}
        />
      )}
      <p className="text-sm text-muted-foreground tabular-nums">{words.daysLine}</p>
    </>
  )
}

/** G-25: the month and its number with no figure, and that it cannot be read now. */
export function PortalGoalMonthUnreadable({
  month,
}: Readonly<{ month: PortalGoalRunningMonth }>) {
  const words = runningWords(month)
  if (words.kind !== 'unreadable') return null
  return (
    <>
      <p className="text-base font-medium tabular-nums">{words.heading}</p>
      <p className="text-sm text-muted-foreground">{words.line}</p>
    </>
  )
}
