// The Monthly portal goal's sheet (PLAN PG-10, PG-14; copy deck S-1…S-23,
// F-1…F-5): a dialog on a desktop and a full-screen sheet on a phone
// (`portal-goal-sheet-frame.tsx`). It sets the goal, or changes it
// (`portal-goal-change-sheet.tsx`), as the door that opened it says. Setting,
// it opens on the number the card offered (or an empty box where there is
// none yet), with the focus in the box; Set sends that month, that measure and
// that number, recorded as recommended only when it is the recommendation.
//
// A chunk of its own, loaded when a door to it is on screen. It owns its draft
// (the host mounts it afresh, with a key, for every opening) and its commands.
// A refusal is said once: in the banner above the footer, with the goal read
// again when it means the card is behind (the month turned, F-4: the sheet
// then shows the months the read offers now); except a goal set a moment ago
// elsewhere (F-3), which leaves nothing to set here, so the sheet closes on
// the latest and a toast says why. While a command is on its way the sheet
// cannot be dismissed.
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import type {
  ChangeMonthlyPortalGoalNowRequest,
  PortalGoalOfCard,
  PortalGoalSheetFacts,
  ReviseMonthlyPortalGoalRequest,
} from '#/contexts/reporting/application/dto/monthly-portal-goal.types'
import {
  actionErrorMessage,
  useActionMutation,
} from '#/components/hooks/use-action-mutation'
import { goalRefusalCode, withGoalRefusals } from './goal-refusal'
import type { PortalGoalCommands } from './portal-goal-card-ready'
import { PortalGoalChangeSheet } from './portal-goal-change-sheet'
import { goalSetToast } from './portal-goal-offer-words'
import { PortalGoalSheetBody } from './portal-goal-sheet-body'
import { PortalGoalSheetFrame } from './portal-goal-sheet-frame'
import { PORTAL_GOAL_BEHIND, PORTAL_SHEET_REFUSALS } from './portal-goal-sheet-refusals'
import {
  changedDraft,
  openingDraft,
  portalGoalSheetModel,
  type PortalGoalSetIntent,
  type PortalGoalSheetChange,
  type PortalGoalSheetIntent,
} from './portal-goal-sheet-view'

/** What the sheet sends: the set, and the two changes. */
export type PortalGoalSheetCommands = Pick<
  PortalGoalCommands,
  'setMonthlyPortalGoalFn' | 'onSet'
> &
  Readonly<{
    changeMonthlyPortalGoalNowFn: (
      input: Readonly<{ data: ChangeMonthlyPortalGoalNowRequest }>,
    ) => Promise<unknown>
    reviseMonthlyPortalGoalFn: (
      input: Readonly<{ data: ReviseMonthlyPortalGoalRequest }>,
    ) => Promise<unknown>
  }>

export type PortalGoalSheetProps = Readonly<{
  open: boolean
  /** Cancel, Escape, the overlay or the corner close. */
  onOpenChange: (open: boolean) => void
  /**
   * The goal was set or changed, here or a moment ago elsewhere, and the card
   * has been read again: the sheet is done, and the goal's title takes the focus.
   */
  onSettled: () => void
  propertyId: string
  facts: PortalGoalSheetFacts
  intent: PortalGoalSheetIntent
  commands: PortalGoalSheetCommands
  /** The goal a change is for, as the sheet opened on it; null when setting. */
  goal?: PortalGoalOfCard | null
  /** A refusal the sheet opens with: F-1, F-2 or F-4, said again on the latest. */
  notice?: unknown
  /**
   * F-1, F-2 or F-4 on a change: the sheet is behind the goal, and the host
   * reads it again and opens the sheet afresh on the latest.
   */
  onBehind?: (error: unknown) => void
  /** Where the focus goes on closing: there is no trigger for Radix to return it to. */
  onCloseAutoFocus?: (event: Event) => void
  /** The sheet's clock, for "starts below pace"; now unless a story fixes it. */
  now?: Date
}>

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

function PortalGoalSetSheet(
  props: PortalGoalSheetProps & Readonly<{ intent: PortalGoalSetIntent }>,
) {
  const { facts, propertyId } = props
  const [draft, setDraft] = useState(() => openingDraft(facts, props.intent))
  const model = portalGoalSheetModel(draft, facts)
  const { send, pending, error } = useSetCommand(props)
  const onChange = (change: PortalGoalSheetChange) =>
    setDraft((current) => changedDraft(current, change, facts))
  return (
    <PortalGoalSheetFrame
      open={props.open}
      onOpenChange={props.onOpenChange}
      busy={pending}
      title={model.title}
      description={model.description}
      onCloseAutoFocus={props.onCloseAutoFocus}
    >
      {(phone) => (
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
      )}
    </PortalGoalSheetFrame>
  )
}

export function PortalGoalSheet(props: PortalGoalSheetProps) {
  const { intent, goal } = props
  if (intent.mode !== 'change') return <PortalGoalSetSheet {...props} intent={intent} />
  // A change needs the goal and what it is made against; a stopped goal takes none.
  if (goal === undefined || goal === null || goal.change === null) return null
  return (
    <PortalGoalChangeSheet
      {...props}
      goal={goal}
      change={goal.change}
      measure={intent.measure}
    />
  )
}
