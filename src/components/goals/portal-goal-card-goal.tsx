// The Monthly portal goal on its card. While it waits for its first month, or
// has no month running, its month and number (G-20). While it runs: the
// month's figure against its number, the bar with today's tick, what is left
// to go with the days left and, only when the read says so, "below pace" in
// quiet amber (G-21…G-25); beside it from 42rem of card, under it below that,
// what each Portal brought in (G-26, G-27). A stopped goal says so, and that
// its month still counts (G-29). Under it all, the month before while it is
// read and through the 7th (G-30, G-31), and "View details" to the goal's page
// (G-28). The figure is the governed read's, never a forecast; the words are
// the views'.
import { Check } from 'lucide-react'
import type {
  PortalGoalOfCard,
  PortalGoalRunningMonth,
} from '#/contexts/reporting/application/dto/monthly-portal-goal.types'
import { InlineLink } from '#/components/ui/inline-link'
import { TONE_INK } from '#/components/ui/tone'
import { cn } from '#/lib/utils'
import { PortalGoalBar } from './portal-goal-bar'
import { PortalGoalPortalCounts } from './portal-goal-portal-counts'
import { lastMonthWords, runningWords, stoppedWords } from './portal-goal-running-view'
import { goalLines } from './portal-goal-words'

type Props = Readonly<{
  goal: PortalGoalOfCard
  /** The Property's local day today. */
  today: string
  propertyId: string
}>

/** G-20: the month and its number, with the day it starts while scheduled. */
function GoalLines({ goal, today }: Omit<Props, 'propertyId'>) {
  const [headline, ...rest] = goalLines(goal, today)
  return (
    <div className="flex flex-col gap-1">
      <p className="text-base font-medium tabular-nums">{headline}</p>
      {rest.map((line) => (
        <p key={line} className="text-sm text-muted-foreground tabular-nums">
          {line}
        </p>
      ))}
    </div>
  )
}

/**
 * G-21…G-25: the month so far, or that its figure cannot be read; on the goal's
 * page, with the month's first and last day under the bar.
 */
export function PortalGoalMonthSoFar({
  month,
  axis,
}: Readonly<{
  month: PortalGoalRunningMonth
  axis?: Readonly<{ from: string; to: string }>
}>) {
  const words = runningWords(month)
  if (words.kind === 'unreadable') {
    return (
      <>
        <p className="text-base font-medium tabular-nums">{words.heading}</p>
        <p className="text-sm text-muted-foreground">{words.line}</p>
      </>
    )
  }
  return (
    <>
      <p className="flex flex-wrap items-baseline gap-x-2">
        <span className="display-title text-2xl font-semibold tabular-nums">
          {words.figure}
        </span>{' '}
        <span className="text-sm text-muted-foreground">{words.unit}</span>
      </p>
      <PortalGoalBar {...words.bar} axis={axis} />
      <p className="text-sm text-muted-foreground tabular-nums">
        <span>{words.line}</span>
        {words.pace === null ? null : (
          <>
            <span aria-hidden="true"> · </span>
            <span className={TONE_INK.warn}>{words.pace}</span>
          </>
        )}
      </p>
    </>
  )
}

/** The running month, and what each Portal brought in beside or under it. */
function RunningMonth({
  goal,
  month,
  propertyId,
}: Readonly<{
  goal: PortalGoalOfCard
  month: PortalGoalRunningMonth
  propertyId: string
}>) {
  return (
    <div className="@container">
      {/* Two columns only with the counts to put beside the month. */}
      <div className={cn('grid gap-5', goal.rows !== null && '@2xl:grid-cols-2')}>
        <div className="flex flex-col gap-2">
          <PortalGoalMonthSoFar month={month} />
          {goal.stopped === null ? null : (
            <p className="text-sm text-muted-foreground">
              {stoppedWords(goal.stopped, month.key)}
            </p>
          )}
        </div>
        {goal.rows === null ? null : (
          <div className="@2xl:border-l @2xl:pl-6">
            <PortalGoalPortalCounts rows={goal.rows} propertyId={propertyId} />
          </div>
        )}
      </div>
    </div>
  )
}

/** G-30 and G-31: the month before, met with a check, otherwise in neutral words. */
function LastMonth({ goal }: Readonly<{ goal: PortalGoalOfCard }>) {
  const words = goal.lastMonth === null ? null : lastMonthWords(goal.lastMonth)
  if (words === null) return null
  return (
    <p
      className={cn(
        'flex items-center gap-1.5 border-t pt-4 text-sm tabular-nums',
        words.met ? 'text-foreground' : 'text-muted-foreground',
      )}
    >
      {words.met ? (
        <Check className={cn('size-4 shrink-0', TONE_INK.positive)} aria-hidden="true" />
      ) : null}
      <span>{words.text}</span>
    </p>
  )
}

export function PortalGoalCardGoal({ goal, today, propertyId }: Props) {
  return (
    <div className="flex flex-col gap-4">
      {goal.month === null ? (
        <GoalLines goal={goal} today={today} />
      ) : (
        <RunningMonth goal={goal} month={goal.month} propertyId={propertyId} />
      )}
      <LastMonth goal={goal} />
      {/* G-28: the goal's page. */}
      <InlineLink
        to="/properties/$propertyId/goals/portals"
        params={{ propertyId }}
        className="self-start text-sm"
      >
        View details
      </InlineLink>
    </div>
  )
}
