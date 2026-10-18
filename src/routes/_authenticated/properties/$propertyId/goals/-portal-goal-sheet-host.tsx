// Opens the Monthly portal goal's sheet from its card, on the Goals page and
// on the goal's own page (PLAN PG-10, PG-13, PG-14): to set it, "Change" on the
// ready card, "Set a private ratings number" with scans first, "Set my own
// number" in the first weeks and while the recommendation cannot be read, "Set
// a number anyway" when nothing came in, and "Set a goal from December" once
// a goal was stopped; to change it, "Change" on a goal that has not started,
// and the page's "Change number" and "Count scans instead". The sheet is a
// chunk of its own, fetched while a door to it is on screen (each page says
// whether it draws one), and it works from the card's own read, so it needs no
// read of its own. A fresh sheet (a new draft, no old refusal) is mounted for
// every opening. A change works from the goal as it was when the sheet opened;
// when it is behind the goal (someone changed it, F-1; its month ended, F-2;
// or the month turned, F-4) the goal is read again and the sheet opens afresh
// on the latest, still saying why, or closes when the latest takes no change
// (it was stopped).
//
// No Radix trigger opens it, so Radix has nowhere to put the focus back when it
// closes: the host remembers what had the focus when it was opened and returns
// it there; or to the goal's title when that is gone, and always once a goal
// was set (the door is gone with the card it was on). Each page says which
// title that is: the card's on the Goals page; on the goal's own page the card
// draws none, and the page hands in a way to its own title.
import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react'
import type {
  PortalGoalCardView,
  PortalGoalOfCard,
  PortalGoalSheetFacts,
} from '#/contexts/reporting/application/dto/monthly-portal-goal.types'
import { PORTAL_GOAL_TITLE_ID } from '#/components/goals/portal-goal-card'
import type { PortalGoalSheetCommands } from '#/components/goals/portal-goal-sheet'
import type { PortalGoalSheetIntent } from '#/components/goals/portal-goal-sheet-view'

const loadSheet = () => import('#/components/goals/portal-goal-sheet')
const PortalGoalSheet = lazy(() =>
  loadSheet().then((module) => ({ default: module.PortalGoalSheet })),
)

/** Fetch the sheet's chunk ahead of the click, while a door to it is on screen. */
const preloadPortalGoalSheet = (): void => void loadSheet()

type Opening = Readonly<{
  intent: PortalGoalSheetIntent
  /** The read the sheet opened on, for when the card no longer has a door. */
  facts: PortalGoalSheetFacts
  /** The goal a change is for, as the sheet opened on it (or read again after F-1). */
  goal: PortalGoalOfCard | null
  /** F-1, said again by the sheet opened afresh on the latest. */
  notice: unknown
  open: boolean
  key: number
}>

/** What the sheet works from, where the card has a door to it. */
const sheetFactsOf = (
  card: PortalGoalCardView | undefined,
): PortalGoalSheetFacts | null =>
  card !== undefined && 'sheet' in card ? card.sheet : null

/** The goal on the card, where it shows one. */
const goalOfCard = (card: PortalGoalCardView | undefined): PortalGoalOfCard | null =>
  card?.state === 'goal' ? card.goal : null

/**
 * Whether the card (on the Goals page) or the goal's page draws a door to the
 * sheet: every arm before a goal does; with a goal, a stopped goal's way to the
 * next one, and, for someone who may change it, "Change" while it waits for its
 * first month on the card, or "Change number" and the other measure on the
 * page while it takes a change. A running goal's card draws none, except on
 * the month's first seven days: the check-in's "Other number" (or, with the
 * number the recommended one already, "Change").
 */
export function portalGoalDoorShown(
  card: PortalGoalCardView | undefined,
  canChange: boolean,
  where: 'card' | 'page',
): boolean {
  if (card === undefined) return false
  if (card.state !== 'goal') return 'sheet' in card
  const { goal } = card
  if (goal.newGoalFrom !== null) return true
  if (!canChange) return false
  return where === 'page'
    ? goal.change !== null
    : goal.status === 'scheduled' || goal.checkIn !== null
}

/** What had the focus, unless it was nothing in particular. */
function focusedElement(): HTMLElement | null {
  const active = document.activeElement
  return active instanceof HTMLElement && active !== document.body ? active : null
}

/** The card's title, where the card draws one (the Goals page). */
export const focusPortalGoalCardTitle = (): void =>
  document.getElementById(PORTAL_GOAL_TITLE_ID)?.focus()

/**
 * Puts the focus back where the sheet was opened from, or on the goal's title.
 * Radix also fires `onCloseAutoFocus` when a phone turns and the sheet gives way
 * to the dialog; the sheet is still open then (`open`, as the frame that is
 * leaving last drew it), and its new frame keeps the focus. "Add a portal goal"
 * returns the focus the same way (`-portal-goal-add-host.tsx`).
 */
export function useFocusReturn(focusTitle: () => void) {
  const opener = useRef<HTMLElement | null>(null)
  const toTitle = useRef(false)
  return {
    remember: () => {
      opener.current = focusedElement()
      toTitle.current = false
    },
    /** A goal was set: the card is the goal now, whatever opened the sheet. */
    toTitle: () => {
      toTitle.current = true
    },
    returnFocus: (open: boolean) => (event: Event) => {
      event.preventDefault()
      if (open) return
      if (!toTitle.current && opener.current?.isConnected) opener.current.focus()
      else focusTitle()
    },
  }
}

/** Where a host's sheet is: open or closed, and the key it is mounted under. */
type Keyed = Readonly<{ open: boolean; key: number }>

/**
 * An opening afresh: open, under the next key, so a fresh sheet is mounted (a
 * new draft, no old refusal). "Add a portal goal" opens the same way.
 */
export const afresh = (current: Keyed | null): Keyed => ({
  open: true,
  key: (current?.key ?? 0) + 1,
})

/** Opens or closes the sheet there is, on what it opened on; with none, still none. */
export const openedAs =
  (open: boolean) =>
  <T extends Keyed>(current: T | null): T | null =>
    current === null ? null : { ...current, open }

type SheetHost = Readonly<{
  propertyId: string
  card: PortalGoalCardView | undefined
  commands: PortalGoalSheetCommands
  /**
   * Puts the focus on the goal's title, wherever the page draws it: no
   * default, so a page never sends it to a title it does not have.
   */
  focusTitle: () => void
  /** Reads the card again, for the sheet a change refused as behind opens afresh on. */
  reread: () => Promise<PortalGoalCardView | undefined>
  /** The page draws a door to the sheet (`portalGoalDoorShown`): its chunk is fetched. */
  doorShown: boolean
  /** A Portal's or a group's goal (PLAN PG-21): what its change sheet is called. */
  changeTitle?: string
  /** False when the goal's subject already holds a goal for the other measure. */
  canSwitch?: boolean
}>

/**
 * The sheet of the goal's card: `open` opens it to set the goal on a measure,
 * or to change it, and `sheet` is the element the page draws (nothing until
 * it is first opened).
 */
export function usePortalGoalSheet({
  propertyId,
  card,
  commands,
  focusTitle,
  reread,
  doorShown,
  changeTitle,
  canSwitch,
}: SheetHost): Readonly<{
  open: (intent: PortalGoalSheetIntent) => void
  sheet: ReactNode
}> {
  const [opening, setOpening] = useState<Opening | null>(null)
  const focus = useFocusReturn(focusTitle)
  const facts = sheetFactsOf(card)
  useEffect(() => {
    if (doorShown) preloadPortalGoalSheet()
  }, [doorShown])
  const open = (intent: PortalGoalSheetIntent) => {
    const goal = goalOfCard(card)
    if (facts === null || (intent.mode === 'change' && goal === null)) return
    focus.remember()
    setOpening((current) => ({ intent, facts, goal, notice: null, ...afresh(current) }))
  }
  const setOpen = (next: boolean) => setOpening(openedAs(next))
  // F-1, F-2, F-4: the latest goal, and a fresh sheet on it that says why. A
  // latest goal that takes no change (it was stopped) closes the sheet as it
  // is, so the focus goes back as on any close.
  const reopenOnTheLatest = (notice: unknown) =>
    void reread().then((latest) =>
      setOpening((current) => {
        if (current === null || !current.open) return current
        const goal = goalOfCard(latest)
        if (latest !== undefined && (goal === null || goal.change === null)) {
          return { ...current, open: false }
        }
        return {
          ...current,
          goal: goal ?? current.goal,
          facts: sheetFactsOf(latest) ?? current.facts,
          notice,
          key: current.key + 1,
        }
      }),
    )
  const changing = opening?.intent.mode === 'change'
  const sheet =
    opening === null ? null : (
      <Suspense fallback={null}>
        <PortalGoalSheet
          key={opening.key}
          open={opening.open}
          onOpenChange={setOpen}
          onSettled={() => {
            focus.toTitle()
            setOpen(false)
          }}
          propertyId={propertyId}
          // Setting, the card's read as it is now (its months move when the
          // month turns, F-4); once the card shows a goal, the read the sheet
          // opened on. Changing, always the read it opened on.
          facts={changing ? opening.facts : (facts ?? opening.facts)}
          intent={opening.intent}
          goal={opening.goal}
          notice={opening.notice}
          onBehind={reopenOnTheLatest}
          commands={commands}
          onCloseAutoFocus={focus.returnFocus(opening.open)}
          changeTitle={changeTitle}
          canSwitch={canSwitch}
        />
      </Suspense>
    )
  return { open, sheet }
}
