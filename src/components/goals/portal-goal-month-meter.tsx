// The running Monthly portal goal's meter and headline, on the card and on the
// goal's page (copy deck G-21…G-25, G-32, U-C2…U-C8; ADR 0068 amended
// 2026-10-19: one goal design system). The words are `runningWords`'; the
// layout is the shared meter's and the shared headline's, so the Portal goal's
// numbers read as the Google rating goal's do: what is left in the large type,
// the days left under it, a bar for the month with a tick where a steady month
// would stand today. The pace is not here: it is the pill in the card's corner
// and the page's header. A figure that cannot be read says so and is never a
// zero, in place of the headline and with no meter.
import type { PortalGoalRunningMonth } from '#/contexts/reporting/application/dto/monthly-portal-goal.types'
import { GoalHeadline } from './goal-headline'
import { GoalMeter } from './goal-meter'
import { runningWords } from './portal-goal-running-view'

type MeterProps = Readonly<{
  month: PortalGoalRunningMonth
  /** The month's first and last day under the bar, on the goal's page. */
  axis?: Readonly<{ from: string; to: string }>
  /** False where a section title already says "November so far": the goal's page. */
  captioned?: boolean
}>

/** The month so far against its number: caption, figure, the bar with today's tick, and today's date. */
export function PortalGoalMonthMeter({ month, axis, captioned = true }: MeterProps) {
  const words = runningWords(month)
  if (words.kind !== 'figure') return null
  return (
    <GoalMeter
      slot="portal-goal-month-meter"
      caption={captioned ? words.caption : null}
      figure={words.figure}
      bar={words.bar}
      axis={axis}
      foot={words.foot}
    />
  )
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
