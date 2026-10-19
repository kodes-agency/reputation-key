// The Monthly portal goal on its card, drawn in the shared card frame (ADR 0068,
// amended 2026-10-19: one goal design system). The frame is the Google rating
// goal's: the goal's name with the one pace pill in the corner (`portal-goal-
// status-view.ts`), then the columns. While the goal runs: what is left to the
// month's number and the days left (U-C2…U-C4), what is stopped or unchanged
// under them, the month so far as the meter with today's tick beside or under
// it (U-C5…U-C8), what each Portal brought in as the list in a column of its own
// from 48rem of card and one line under the days left below that (G-26, G-27),
// and "View details" to the goal's page (G-28). While it waits for its first
// month, or has no month running, its month and number (G-20), with "Change"
// while it waits, for someone who may change it. A stopped goal says so, that
// its month still counts, and offers the next goal from the month after (G-29).
// Under it all, the month before while it is read and through the 7th (G-30,
// G-31). On the month's first seven days, for someone who may change the goal,
// the month-start check-in takes the card's body (`portal-goal-check-in.tsx`)
// and the card wears no pill; when the recommended number is the month's
// already, it is one line under the month instead (K-7). The figure is the
// governed read's, never a forecast; the words are the views'.
import { Link } from '@tanstack/react-router'
import { Check } from 'lucide-react'
import type {
  PortalGoalCheckIn as Asking,
  PortalGoalOfCard,
  PortalGoalRunningMonth,
} from '#/contexts/reporting/application/dto/monthly-portal-goal.types'
import { Button } from '#/components/ui/button'
import { CardContent } from '#/components/ui/card'
import { TONE_INK } from '#/components/ui/tone'
import { cn } from '#/lib/utils'
import { usePermissions } from '#/shared/hooks/usePermissions'
import { GoalCardActions, GoalCardColumns, GoalCardFrame } from './goal-card-frame'
import { PortalGoalCheckIn, type PortalGoalCheckInCommands } from './portal-goal-check-in'
import { sameNumberWords } from './portal-goal-check-in-view'
import { PORTAL_GOAL_NAME } from './portal-goal-copy'
import {
  PortalGoalMonthHeadline,
  PortalGoalMonthMeter,
  PortalGoalMonthUnreadable,
} from './portal-goal-month-meter'
import { PortalGoalPortalCounts } from './portal-goal-portal-counts'
import { countsLine, lastMonthWords, stoppedWords } from './portal-goal-running-view'
import type { PortalGoalSheetIntent } from './portal-goal-sheet-intent'
import { portalGoalPace } from './portal-goal-status-view'
import { goalLines, monthName, shownMeasure } from './portal-goal-words'

type OpenSheet = (intent: PortalGoalSheetIntent) => void

type Props = Readonly<{
  goal: PortalGoalOfCard
  /** The Property's local day today. */
  today: string
  propertyId: string
  /** The card's `data-slot`: the Goals page's card and the Overview's are the same card. */
  slot: string
  /** The title's id: a sheet or a dialog that closes hands the focus back to it. */
  titleId: string
  /** The title's level; null where the page's own title names the card. */
  titleAs: 'h2' | 'h3' | null
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
function GoalLines({
  goal,
  today,
  openSheet,
}: Pick<Props, 'goal' | 'today' | 'openSheet'>) {
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

/** G-30 and G-31: the month before, met with a check, otherwise in neutral words. */
function LastMonthLine({
  words,
}: Readonly<{ words: NonNullable<ReturnType<typeof lastMonthWords>> }>) {
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

/** G-28: the goal's page, as a tap target like the first goal's. */
function Details({ propertyId }: Readonly<{ propertyId: string }>) {
  return (
    <GoalCardActions>
      <Button asChild variant="outline">
        <Link to="/properties/$propertyId/goals/portals" params={{ propertyId }}>
          View details
        </Link>
      </Button>
    </GoalCardActions>
  )
}

/**
 * G-26 and G-27: each Portal's count. The list is the card's signature visual,
 * drawn in a column of its own from 48rem of card; a card too narrow for it says
 * the same in one line under the days left. A sentence (one Portal, or 5 and
 * more with "See each") is drawn at every width.
 */
function StoryCounts({
  rows,
  propertyId,
}: Readonly<{ rows: PortalGoalOfCard['rows']; propertyId: string }>) {
  if (rows === null) return null
  const line = countsLine(rows)
  if (line === null) return <PortalGoalPortalCounts rows={rows} propertyId={propertyId} />
  return <p className="text-sm text-muted-foreground tabular-nums @3xl:hidden">{line}</p>
}

/** The running month: its headline and what is stopped, its meter, and the Portals' counts beside them. */
function RunningBody({
  goal,
  month,
  propertyId,
  openSheet,
  sameNumber,
}: Readonly<{
  goal: PortalGoalOfCard
  month: PortalGoalRunningMonth
  propertyId: string
  openSheet?: OpenSheet
  sameNumber: boolean
}>) {
  const { rows } = goal
  const last = goal.lastMonth === null ? null : lastMonthWords(goal.lastMonth)
  // A column of its own only with a list of Portals to put in it.
  const listed = rows !== null && countsLine(rows) !== null
  return (
    <>
      <GoalCardColumns
        wide={listed}
        signature={
          listed ? (
            <div className="hidden @3xl:block">
              <PortalGoalPortalCounts rows={rows} propertyId={propertyId} />
            </div>
          ) : null
        }
        story={
          <>
            <PortalGoalMonthHeadline month={month} />
            <PortalGoalMonthUnreadable month={month} />
            <StoryCounts rows={rows} propertyId={propertyId} />
            <PortalGoalStopped goal={goal} monthKey={month.key} openSheet={openSheet} />
            {sameNumber ? <SameNumberLine goal={goal} openSheet={openSheet} /> : null}
          </>
        }
        side={
          <>
            <PortalGoalMonthMeter month={month} />
            <Details propertyId={propertyId} />
          </>
        }
      />
      {last === null ? null : (
        <CardContent>
          <LastMonthLine words={last} />
        </CardContent>
      )}
    </>
  )
}

/** A goal with no month running: its month and number, and the month before. */
function WaitingBody({
  goal,
  today,
  propertyId,
  openSheet,
  sameNumber,
}: Readonly<{
  goal: PortalGoalOfCard
  today: string
  propertyId: string
  openSheet?: OpenSheet
  sameNumber: boolean
}>) {
  const last = goal.lastMonth === null ? null : lastMonthWords(goal.lastMonth)
  return (
    <CardContent className="flex flex-col gap-4">
      <GoalLines goal={goal} today={today} openSheet={openSheet} />
      {sameNumber ? <SameNumberLine goal={goal} openSheet={openSheet} /> : null}
      {last === null ? null : <LastMonthLine words={last} />}
      <Details propertyId={propertyId} />
    </CardContent>
  )
}

export function PortalGoalCardGoal({
  goal,
  today,
  propertyId,
  slot,
  titleId,
  titleAs,
  openSheet,
  checkIn,
}: Props) {
  const { can } = usePermissions()
  // Only someone who may change the goal is asked, on a page that can answer.
  const asked: Asking | null =
    checkIn !== undefined && can('goal.update') ? goal.checkIn : null
  const question = asked !== null && asked.kind !== 'same' ? asked : null
  const sameNumber = asked !== null
  return (
    <GoalCardFrame
      slot={slot}
      title={titleAs === null ? null : PORTAL_GOAL_NAME}
      titleAs={titleAs ?? 'h3'}
      titleId={titleId}
      // The check-in takes the card's body and no running month is drawn, so no pace is said.
      status={question === null ? portalGoalPace(goal.month) : null}
      container
      dataState="goal"
    >
      {checkIn && question !== null ? (
        <CardContent className="flex flex-col gap-4">
          <PortalGoalCheckIn
            goal={goal}
            checkIn={question}
            propertyId={propertyId}
            commands={checkIn.commands}
            onAnswered={checkIn.onAnswered}
            openSheet={openSheet}
            headingAs={checkIn.headingAs}
          />
          <Details propertyId={propertyId} />
        </CardContent>
      ) : goal.month === null ? (
        <WaitingBody
          goal={goal}
          today={today}
          propertyId={propertyId}
          openSheet={openSheet}
          sameNumber={sameNumber}
        />
      ) : (
        <RunningBody
          goal={goal}
          month={goal.month}
          propertyId={propertyId}
          openSheet={openSheet}
          sameNumber={sameNumber}
        />
      )}
    </GoalCardFrame>
  )
}
