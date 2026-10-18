// The Monthly portal goal's set sheet (PLAN PG-10; copy deck S-1…S-11,
// F-1…F-4): a dialog on a desktop and a full-screen sheet on a phone, built on
// the dialog primitives and nothing of the Google rating goal's. It opens on
// the number the card offered (or an empty box where there is none yet), with
// the focus in the box; Set sends that month, that measure and that number,
// recorded as recommended only when it is the recommendation.
//
// A chunk of its own, loaded when a door to it is on screen. It owns its draft
// (the host mounts it afresh, with a key, for every opening) and the set
// command. A refusal is said once: in the banner above the footer, with the
// goal read again when it means the card is behind (the month turned, F-4:
// the sheet then shows the months the read offers now); except a goal set a
// moment ago elsewhere (F-3), which leaves nothing to set here, so the sheet
// closes on the latest and a toast says why. While Set is on its way the sheet
// cannot be dismissed.
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import type { PortalGoalSheetFacts } from '#/contexts/reporting/application/dto/monthly-portal-goal.types'
import {
  actionErrorMessage,
  useActionMutation,
} from '#/components/hooks/use-action-mutation'
import { useIsMobile } from '#/components/hooks/use-mobile'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog'
import { SheetContent } from '#/components/ui/sheet'
import { goalRefusalCode, withGoalRefusals } from './goal-refusal'
import type { PortalGoalCommands } from './portal-goal-card-ready'
import { goalSetToast } from './portal-goal-offer-words'
import { PortalGoalSheetBody } from './portal-goal-sheet-body'
import { PORTAL_GOAL_BEHIND, PORTAL_SHEET_REFUSALS } from './portal-goal-sheet-refusals'
import {
  changedDraft,
  openingDraft,
  portalGoalSheetModel,
  type PortalGoalSheetChange,
  type PortalGoalSheetIntent,
} from './portal-goal-sheet-view'

export type PortalGoalSheetProps = Readonly<{
  open: boolean
  /** Cancel, Escape, the overlay or the corner close. */
  onOpenChange: (open: boolean) => void
  /**
   * A goal was set, here or a moment ago elsewhere, and the card has been read
   * again: the sheet is done, and the card's title takes the focus.
   */
  onSettled: () => void
  propertyId: string
  facts: PortalGoalSheetFacts
  intent: PortalGoalSheetIntent
  commands: Pick<PortalGoalCommands, 'setMonthlyPortalGoalFn' | 'onSet'>
  /** Where the focus goes on closing: there is no trigger for Radix to return it to. */
  onCloseAutoFocus?: (event: Event) => void
}>

/** Opening: the focus goes to the number box. */
function focusTheNumber(event: Event): void {
  const content = event.currentTarget
  if (!(content instanceof HTMLElement)) return
  const box = content.querySelector<HTMLElement>('[data-autofocus]')
  if (box === null) return
  event.preventDefault()
  box.focus()
}

/** Set, sent once however often it is pressed, and what follows it. */
function useSetCommand(props: PortalGoalSheetProps) {
  const sending = useRef(false)
  const { commands, onSettled } = props
  const settle = async () => {
    await commands.onSet()
    onSettled()
  }
  const set = useActionMutation(
    withGoalRefusals(commands.setMonthlyPortalGoalFn, PORTAL_SHEET_REFUSALS),
    {
      onSuccess: async (_output, { data }) => {
        toast.success(goalSetToast(data.startMonth, data.metric, data.targetValue))
        await settle()
      },
      onError: (error) => {
        const code = goalRefusalCode(error) ?? ''
        if (code === 'subject_has_goal') {
          // F-3: nothing is left to set here; the card shows the goal that was.
          void settle().then(() => toast.error(actionErrorMessage(error)))
        } else if (PORTAL_GOAL_BEHIND.has(code)) {
          void commands.onSet()
        }
      },
    },
  )
  const send = (data: Parameters<typeof set>[0]['data']) => {
    if (sending.current) return
    sending.current = true
    void set({ data })
      // Held by the mutation: the banner says it above the footer.
      .catch(() => undefined)
      .finally(() => {
        sending.current = false
      })
  }
  // F-3 is the toast's to say, once the sheet has closed.
  const shown = goalRefusalCode(set.error) === 'subject_has_goal' ? null : set.error
  return { send, pending: set.isPending, error: shown }
}

export function PortalGoalSheet(props: PortalGoalSheetProps) {
  const { facts, propertyId } = props
  const phone = useIsMobile()
  const [draft, setDraft] = useState(() => openingDraft(facts, props.intent))
  const model = portalGoalSheetModel(draft, facts)
  const { send, pending, error } = useSetCommand(props)
  const onChange = (change: PortalGoalSheetChange) =>
    setDraft((current) => changedDraft(current, change, facts))
  const header = (
    <DialogHeader>
      <DialogTitle className={phone ? 'pe-12' : undefined}>{model.title}</DialogTitle>
      <DialogDescription>{model.description}</DialogDescription>
    </DialogHeader>
  )
  const body = (
    <PortalGoalSheetBody
      model={model}
      small={phone}
      pending={pending}
      error={error}
      onChange={onChange}
      onSubmit={() => {
        if (model.submission !== null) send({ propertyId, ...model.submission })
      }}
    />
  )
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange} busy={pending}>
      {phone ? (
        // Full screen: the sheet is the window's height, scrolls inside, and
        // keeps the dialog's padding variable so the footer pins the same way.
        <SheetContent
          side="bottom"
          data-portal-goal-sheet="sheet"
          onOpenAutoFocus={focusTheNumber}
          onCloseAutoFocus={props.onCloseAutoFocus}
          className="h-dvh gap-4 overflow-y-auto p-(--dialog-pad) [--dialog-pad:1rem]"
        >
          {header}
          {body}
        </SheetContent>
      ) : (
        <DialogContent
          size="md"
          data-portal-goal-sheet="dialog"
          onOpenAutoFocus={focusTheNumber}
          onCloseAutoFocus={props.onCloseAutoFocus}
        >
          {header}
          {body}
        </DialogContent>
      )}
    </Dialog>
  )
}
