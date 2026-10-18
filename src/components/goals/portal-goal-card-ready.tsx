// The Monthly portal goal card once the number is ready (P-3, P-4; copy deck
// G-13…G-18): the recommended number for the month the read named, what it
// stands on with "How we worked this out", the Portals that join later, the
// ask-every-guest line when it counts private ratings, and Use. With scans
// first (P-2) one sentence says it all. Use sets the goal in one tap, exactly
// as offered: that month, that measure, that number; "Change" (with scans
// first, "Set a private ratings number") opens the set sheet instead. The
// commands come from the page that draws the card (components import no
// routes); a set, or a refusal that means the card is behind, reads the
// Portal goals again.
import { useRef } from 'react'
import type {
  PortalGoalOffer,
  SetMonthlyPortalGoalRequest,
} from '#/contexts/reporting/application/dto/monthly-portal-goal.types'
import {
  actionErrorMessage,
  useActionMutation,
} from '#/components/hooks/use-action-mutation'
import { Button } from '#/components/ui/button'
import { goalRefusalCode, withGoalRefusals } from './goal-refusal'
import type { PortalGoalCheckInCommands } from './portal-goal-check-in'
import { PORTAL_ASK_EVERY_GUEST_LINE } from './portal-goal-copy'
import { offerWords } from './portal-goal-offer-words'
import { PORTAL_GOAL_BEHIND, PORTAL_SHEET_REFUSALS } from './portal-goal-sheet-refusals'
import type { PortalGoalSheetIntent } from './portal-goal-sheet-view'
import { PortalGoalWorkedOut } from './portal-goal-worked-out'

/** The commands the card sends, handed down by the page. */
export type PortalGoalCommands = Readonly<{
  setMonthlyPortalGoalFn: (
    input: Readonly<{ data: SetMonthlyPortalGoalRequest }>,
  ) => Promise<unknown>
  /** Reads the Portal goals again: after a set, and after a refusal that means the card is behind. */
  onSet: () => Promise<void>
  /**
   * Opens the set sheet on a measure. A page that draws no sheet leaves it
   * out, and the card then draws no door to it.
   */
  openSheet?: (intent: PortalGoalSheetIntent) => void
  /**
   * The month-start check-in's Use and Keep. A page that leaves them out
   * draws no check-in: the card shows the running month.
   */
  checkIn?: PortalGoalCheckInCommands
}>

type Props = Readonly<{
  propertyId: string
  offer: PortalGoalOffer
  commands: PortalGoalCommands
}>

/** Use: the offer as it stands, sent once however often it is pressed. */
function useSetFromOffer({ propertyId, offer, commands }: Props) {
  const words = offerWords(offer)
  const sending = useRef(false)
  const set = useActionMutation(
    withGoalRefusals(commands.setMonthlyPortalGoalFn, PORTAL_SHEET_REFUSALS),
    {
      successMessage: words.setToast,
      errorMessage: actionErrorMessage,
      onSuccess: commands.onSet,
      onError: (error) => {
        if (PORTAL_GOAL_BEHIND.has(goalRefusalCode(error) ?? '')) void commands.onSet()
      },
    },
  )
  const use = () => {
    if (sending.current) return
    sending.current = true
    void set({
      data: {
        propertyId,
        metric: offer.measure,
        targetValue: offer.choices.aBitMore,
        startMonth: offer.month,
        targetSource: 'recommended',
      },
    })
      // The toast says a refusal; settled here so it never escapes the click.
      .catch(() => undefined)
      .finally(() => {
        sending.current = false
      })
  }
  return { words, use, pending: set.isPending }
}

/** "Change" beside Use; with scans first, a link to private ratings under it. */
function SheetDoor({
  door,
  openSheet,
  beside,
}: Readonly<{
  door: ReturnType<typeof offerWords>['door']
  openSheet: NonNullable<PortalGoalCommands['openSheet']>
  beside: boolean
}>) {
  const open = () => openSheet({ measure: door.measure })
  return beside ? (
    <Button variant="outline" onClick={open}>
      {door.label}
    </Button>
  ) : (
    <Button variant="link" size="inline" touch className="self-start" onClick={open}>
      {door.label}
    </Button>
  )
}

export function PortalGoalCardReady(props: Props) {
  const { offer } = props
  const { openSheet } = props.commands
  const { words, use, pending } = useSetFromOffer(props)
  // With scans first the door is to the other measure: a link, not a second button.
  const beside = offer.measure === 'portal_rating_count'
  return (
    <div className="flex flex-col gap-4">
      {words.heading === null || words.figure === null ? null : (
        <div className="flex flex-col gap-1">
          <p className="text-sm text-muted-foreground">{words.heading}</p>
          <p className="flex flex-wrap items-baseline gap-2">
            <span className="display-title text-3xl leading-none font-semibold tabular-nums">
              {words.figure.value}
            </span>
            <span className="text-sm text-muted-foreground">{words.figure.unit}</span>
          </p>
        </div>
      )}
      <div className="flex flex-col gap-2 text-sm">
        <p>
          {words.lead} <PortalGoalWorkedOut offer={offer} />
        </p>
        {words.countsFrom === null ? null : (
          <p className="text-muted-foreground">{words.countsFrom}</p>
        )}
        {words.newPortals === null ? null : (
          <p className="text-muted-foreground">{words.newPortals}</p>
        )}
        {words.asksEveryGuest ? (
          <p className="text-muted-foreground">{PORTAL_ASK_EVERY_GUEST_LINE}</p>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button pending={pending} pendingLabel="Saving…" onClick={use}>
          {words.use}
        </Button>
        {openSheet && beside ? (
          <SheetDoor door={words.door} openSheet={openSheet} beside />
        ) : null}
      </div>
      {openSheet && !beside ? (
        <SheetDoor door={words.door} openSheet={openSheet} beside={false} />
      ) : null}
    </div>
  )
}
