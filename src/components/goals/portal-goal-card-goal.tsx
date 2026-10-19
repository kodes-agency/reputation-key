// The Monthly portal goal on its card, drawn in the shared card frame (ADR 0068,
// amended 2026-10-19: one goal design system). The frame is the Google rating
// goal's: the goal's name with the one pace pill in the corner (`portal-goal-
// status-view.ts`), then the columns. While the goal runs: what is left to the
// month's number and the days left (U-C2…U-C4), what is stopped or unchanged
// under them, the month so far as the meter with today's tick beside or under
// it (U-C5…U-C8), what each Portal brought in as the list in a column of its own
// from 48rem of card and one line under the days left below that (G-26, G-27),
// and "View details" to the goal's page (G-28). A month whose figure cannot be
// read has no meter, so its lines stand in one column with "View details"
// under them, as a goal with no month running does (G-25). While it waits for
// its first month, or has no month running, its month and number (G-20), with
// "Change" while it waits, for someone who may change it. A stopped goal says
// so, that its month still counts, and offers the next goal from the month
// after (G-29). Under it all, the month before while it is read and through
// the 7th (G-30, G-31). On the month's first seven days, for someone who may
// change the goal, the month-start check-in takes the card's body
// (`portal-goal-check-in.tsx`) and the card wears no pill; when the
// recommended number is the month's already, it is one line under the month
// instead (K-7). The figure is the governed read's, never a forecast; the
// words are the views'.
import type {
  PortalGoalCheckIn as Asking,
  PortalGoalOfCard,
  PortalGoalRunningMonth,
} from '#/contexts/reporting/application/dto/monthly-portal-goal.types'
import { CardContent } from '#/components/ui/card'
import { usePermissions } from '#/shared/hooks/usePermissions'
import { GoalCardColumns, GoalCardFrame } from './goal-card-frame'
import { PortalGoalCheckIn, type PortalGoalCheckInCommands } from './portal-goal-check-in'
import {
  Details,
  LastMonthLine,
  SameNumberLine,
  SheetLink,
} from './portal-goal-card-lines'
import { PORTAL_GOAL_NAME } from './portal-goal-copy'
import {
  PortalGoalMonthHeadline,
  PortalGoalMonthMeter,
  PortalGoalMonthUnreadable,
} from './portal-goal-month-meter'
import { PortalGoalPortalCounts } from './portal-goal-portal-counts'
import {
  countsLine,
  lastMonthWords,
  runningWords,
  stoppedWords,
} from './portal-goal-running-view'
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

/**
 * Air between the list and the headline beside it: the list fills its column,
 * so without it the counts end at the grid gap from the headline's figure.
 * Inline, because a new utility class would grow the stylesheet in first paint.
 */
const SIGNATURE_AIR = { paddingInlineEnd: '1.5rem' } as const

type RunningProps = Readonly<{
  goal: PortalGoalOfCard
  month: PortalGoalRunningMonth
  propertyId: string
  openSheet?: OpenSheet
  sameNumber: boolean
}>

/** The running month: its headline and what is stopped, its meter, and the Portals' counts beside them. */
function MonthColumns({ goal, month, propertyId, openSheet, sameNumber }: RunningProps) {
  const { rows } = goal
  // A column of its own only with a list of Portals to put in it.
  const listed = rows !== null && countsLine(rows) !== null
  return (
    <GoalCardColumns
      wide={listed}
      signature={
        listed ? (
          <div className="hidden @3xl:block" style={SIGNATURE_AIR}>
            <PortalGoalPortalCounts rows={rows} propertyId={propertyId} />
          </div>
        ) : null
      }
      story={
        <>
          <PortalGoalMonthHeadline month={month} />
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
  )
}

/**
 * G-25: a month whose figure cannot be read has no meter to put in a column of
 * its own, so it takes the shape of a goal with no month running: one column
 * of lines, then "View details" under them.
 */
function UnreadableMonth({
  goal,
  month,
  propertyId,
  openSheet,
  sameNumber,
}: RunningProps) {
  return (
    <CardContent className="flex flex-col gap-4">
      <PortalGoalMonthUnreadable month={month} />
      <PortalGoalStopped goal={goal} monthKey={month.key} openSheet={openSheet} />
      {sameNumber ? <SameNumberLine goal={goal} openSheet={openSheet} /> : null}
      <Details propertyId={propertyId} />
    </CardContent>
  )
}

/** G-30 and G-31: the month before, under whichever body the card draws. */
function MonthBefore({ goal }: Readonly<{ goal: PortalGoalOfCard }>) {
  const last = goal.lastMonth === null ? null : lastMonthWords(goal.lastMonth)
  if (last === null) return null
  return (
    <CardContent>
      <LastMonthLine words={last} />
    </CardContent>
  )
}

/** The running month: a figure in columns, or the lines of one that cannot be read. */
function RunningBody(props: RunningProps) {
  const unreadable = runningWords(props.month).kind === 'unreadable'
  return (
    <>
      {unreadable ? <UnreadableMonth {...props} /> : <MonthColumns {...props} />}
      <MonthBefore goal={props.goal} />
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
          {/* Set apart, so it does not read as a fourth choice; U3 moves the check-in above the card. */}
          <div className="border-t pt-4">
            <Details propertyId={propertyId} />
          </div>
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
