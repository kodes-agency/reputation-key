// The running Monthly portal goal's headline and how far along the month is, on the
// card and on the goal's page (copy deck G-21…G-25, U-C2…U-C8; ADR 0068 amended
// 2026-10-19 and 2026-11-01: one goal design system). The words are `runningWords`';
// the layout is the shared headline's and the shared ruler's, so the Portal goal's
// numbers read as the Google rating goal's do. The pace is not here: it is the pill
// in the card's corner and the page's header. A figure that cannot be read says so
// and is never a zero, in place of the headline and with no ruler.
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
