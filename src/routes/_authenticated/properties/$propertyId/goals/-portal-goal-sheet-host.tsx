// Opens the Monthly portal goal's set sheet from the card on the Goals page
// (PLAN PG-10): "Change" on the ready card, "Set a private ratings number"
// with scans first, "Set my own number" in the first weeks and while the
// recommendation cannot be read, and "Set a number anyway" when nothing came
// in. The sheet is a chunk of its own, fetched while a door to it is on screen,
// and it works from the card's own read, so it needs no read of its own. A
// fresh sheet (a new draft, no old refusal) is mounted for every opening.
//
// No Radix trigger opens it, so Radix has nowhere to put the focus back when it
// closes: the host remembers what had the focus when it was opened and returns
// it there; or to the card's title when that is gone, and always once a goal
// was set (the door is gone with the card it was on).
import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react'
import type {
  PortalGoalCardView,
  PortalGoalSheetFacts,
} from '#/contexts/reporting/application/dto/monthly-portal-goal.types'
import { PORTAL_GOAL_TITLE_ID } from '#/components/goals/portal-goal-card'
import type { PortalGoalCommands } from '#/components/goals/portal-goal-card-ready'
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
  open: boolean
  key: number
}>

/** What the set sheet works from, where the card has a door to it. */
const sheetFactsOf = (
  card: PortalGoalCardView | undefined,
): PortalGoalSheetFacts | null =>
  card !== undefined && 'sheet' in card ? card.sheet : null

/** What had the focus, unless it was nothing in particular. */
function focusedElement(): HTMLElement | null {
  const active = document.activeElement
  return active instanceof HTMLElement && active !== document.body ? active : null
}

/**
 * Puts the focus back where the sheet was opened from, or on the card's title.
 * Radix also fires `onCloseAutoFocus` when a phone turns and the sheet gives way
 * to the dialog; the sheet is still open then (`open`, as the frame that is
 * leaving last drew it), and its new frame keeps the focus.
 */
function useFocusReturn() {
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
      const back =
        !toTitle.current && opener.current?.isConnected
          ? opener.current
          : document.getElementById(PORTAL_GOAL_TITLE_ID)
      back?.focus()
    },
  }
}

/**
 * The set sheet of the Goals page's card: `open` opens it on a measure, and
 * `sheet` is the element the page draws (nothing until it is first opened).
 */
export function usePortalGoalSheet(
  propertyId: string,
  card: PortalGoalCardView | undefined,
  commands: Pick<PortalGoalCommands, 'setMonthlyPortalGoalFn' | 'onSet'>,
): Readonly<{ open: (intent: PortalGoalSheetIntent) => void; sheet: ReactNode }> {
  const [opening, setOpening] = useState<Opening | null>(null)
  const focus = useFocusReturn()
  const facts = sheetFactsOf(card)
  const doorShown = facts !== null
  useEffect(() => {
    if (doorShown) preloadPortalGoalSheet()
  }, [doorShown])
  const open = (intent: PortalGoalSheetIntent) => {
    if (facts === null) return
    focus.remember()
    setOpening((current) => ({ intent, facts, open: true, key: (current?.key ?? 0) + 1 }))
  }
  const setOpen = (next: boolean) =>
    setOpening((current) => (current === null ? null : { ...current, open: next }))
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
          // The card's read as it is now (its months move when the month turns,
          // F-4); once the card shows a goal, the read the sheet opened on.
          facts={facts ?? opening.facts}
          intent={opening.intent}
          commands={commands}
          onCloseAutoFocus={focus.returnFocus(opening.open)}
        />
      </Suspense>
    )
  return { open, sheet }
}
