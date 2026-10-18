// The Monthly portal goal on its card. While it waits for its first month, or
// has no month running, its month and number (G-20), with "Change" while it
// waits, for someone who may change it. While it runs: the month's figure
// against its number, the bar with today's tick, what is left to go with the
// days left and, only when the read says so, "below pace" in quiet amber
// (G-21…G-25); beside it from 42rem of card, under it below that, what each
// Portal brought in (G-26, G-27). A stopped goal says so, that its month still
// counts, and offers the next goal from the month after (G-29). Under it all,
// the month before while it is read and through the 7th (G-30, G-31), and
// "View details" to the goal's page (G-28). On the month's first seven days,
// for someone who may change the goal, the month-start check-in takes the
// card's body (`portal-goal-check-in.tsx`); when the recommended number is the
// month's already, it is one line under the month instead (K-7). The figure is
// the governed read's, never a forecast; the words are the views'.
import { Check } from 'lucide-react'
import type {
  PortalGoalOfCard,
  PortalGoalRunningMonth,
} from '#/contexts/reporting/application/dto/monthly-portal-goal.types'
import { Button } from '#/components/ui/button'
import { InlineLink } from '#/components/ui/inline-link'
import { TONE_INK } from '#/components/ui/tone'
import { cn } from '#/lib/utils'
import { usePermissions } from '#/shared/hooks/usePermissions'
import { PortalGoalBar } from './portal-goal-bar'
import { PortalGoalCheckIn, type PortalGoalCheckInCommands } from './portal-goal-check-in'
import { sameNumberWords } from './portal-goal-check-in-view'
import { PortalGoalPortalCounts } from './portal-goal-portal-counts'
import { lastMonthWords, runningWords, stoppedWords } from './portal-goal-running-view'
import type { PortalGoalSheetIntent } from './portal-goal-sheet-view'
import { goalLines, monthName, shownMeasure } from './portal-goal-words'

type OpenSheet = (intent: PortalGoalSheetIntent) => void

type Props = Readonly<{
  goal: PortalGoalOfCard
  /** The Property's local day today. */
  today: string
  propertyId: string
  /** Opens the sheet; a page that draws none leaves it out, and no door is drawn. */
  openSheet?: OpenSheet
  /** The month-start check-in's commands; a page that leaves them out draws none. */
  checkIn?: Readonly<{
    commands: PortalGoalCheckInCommands
    /** Reads the card again once it is answered. */
    onAnswered: () => Promise<void>
    /** Its region heading's level: one below the card's title. */
    headingAs: 'h2' | 'h3' | 'h4'
  }>
}>

/** A door to the sheet, in the card's line. */
function SheetLink({ label, onClick }: Readonly<{ label: string; onClick: () => void }>) {
  return (
    <Button variant="link" size="inline" touch className="self-start" onClick={onClick}>
      {label}
    </Button>
  )
}

/**
 * G-29: a stopped goal still counts to the end of its month (when one is
 * counting now), and the next goal can be set from the month after it.
 */
export function PortalGoalStopped({
  goal,
  monthKey,
  openSheet,
}: Readonly<{ goal: PortalGoalOfCard; monthKey: string | null; openSheet?: OpenSheet }>) {
  const words =
    goal.stopped === null || monthKey === null
      ? null
      : stoppedWords(goal.stopped, monthKey)
  const from = goal.newGoalFrom
  const door = from !== null && openSheet !== undefined ? from : null
  if (words === null && door === null) return null
  return (
    <p className="flex flex-wrap items-baseline gap-x-2 text-sm text-muted-foreground">
      {words === null ? null : <span>{words}</span>}
      {door === null ? null : (
        <SheetLink
          label={`Set a goal from ${monthName(door)}`}
          onClick={() => openSheet?.({ measure: shownMeasure(goal), month: door })}
        />
      )}
    </p>
  )
}

/** G-20: the month and its number, with the day it starts and "Change" while scheduled. */
function GoalLines({ goal, today, openSheet }: Omit<Props, 'propertyId'>) {
  const { can } = usePermissions()
  const [headline, ...rest] = goalLines(goal, today)
  const change =
    goal.status === 'scheduled' && openSheet !== undefined && can('goal.update')
      ? openSheet
      : null
  return (
    <div className="flex flex-col gap-1">
      <p className="text-base font-medium tabular-nums">{headline}</p>
      {rest.map((line) => (
        <p key={line} className="text-sm text-muted-foreground tabular-nums">
          {line}
        </p>
      ))}
      {change === null ? null : (
        <SheetLink
          label="Change"
          onClick={() => change({ mode: 'change', measure: goal.measure })}
        />
      )}
      {goal.status === 'ended' ? (
        <PortalGoalStopped goal={goal} monthKey={null} openSheet={openSheet} />
      ) : null}
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
  openSheet,
}: Readonly<{
  goal: PortalGoalOfCard
  month: PortalGoalRunningMonth
  propertyId: string
  openSheet?: OpenSheet
}>) {
  return (
    <div className="@container">
      {/* Two columns only with the counts to put beside the month. */}
      <div className={cn('grid gap-5', goal.rows !== null && '@2xl:grid-cols-2')}>
        <div className="flex flex-col gap-2">
          <PortalGoalMonthSoFar month={month} />
          <PortalGoalStopped goal={goal} monthKey={month.key} openSheet={openSheet} />
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

/** K-7: December keeps the recommended number it has, and "Change" to the sheet. */
function SameNumberLine({
  goal,
  openSheet,
}: Readonly<{ goal: PortalGoalOfCard; openSheet?: OpenSheet }>) {
  if (goal.checkIn?.kind !== 'same') return null
  const words = sameNumberWords(goal.checkIn)
  return (
    <p className="flex flex-wrap items-baseline gap-x-2 text-sm text-muted-foreground">
      <span>{words.text}</span>
      {openSheet === undefined ? null : (
        <SheetLink
          label={words.change}
          onClick={() => openSheet({ mode: 'change', measure: goal.measure })}
        />
      )}
    </p>
  )
}

export function PortalGoalCardGoal({
  goal,
  today,
  propertyId,
  openSheet,
  checkIn,
}: Props) {
  const { can } = usePermissions()
  // Only someone who may change the goal is asked, on a page that can answer.
  const asked = checkIn !== undefined && can('goal.update') ? goal.checkIn : null
  return (
    <div className="flex flex-col gap-4">
      {checkIn && asked !== null && asked.kind !== 'same' ? (
        <PortalGoalCheckIn
          goal={goal}
          checkIn={asked}
          propertyId={propertyId}
          commands={checkIn.commands}
          onAnswered={checkIn.onAnswered}
          openSheet={openSheet}
          headingAs={checkIn.headingAs}
        />
      ) : (
        <>
          {goal.month === null ? (
            <GoalLines goal={goal} today={today} openSheet={openSheet} />
          ) : (
            <RunningMonth
              goal={goal}
              month={goal.month}
              propertyId={propertyId}
              openSheet={openSheet}
            />
          )}
          {asked === null ? null : <SameNumberLine goal={goal} openSheet={openSheet} />}
          <LastMonth goal={goal} />
        </>
      )}
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
