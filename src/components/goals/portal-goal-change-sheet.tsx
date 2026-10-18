// The sheet that changes the Monthly portal goal (PLAN PG-14; copy deck S-1,
// S-15…S-23, F-1, F-2): "November, now" or "From Dec 1", the number box, what
// the number is, a note on the way it starts the month when it is behind, the
// other measure (from the next month only), and "Add a note". The primary
// sends "now" as a change of the running month and the months after it, and
// "from next month" as a revision; a toast says what was saved.
//
// It works from the goal as the sheet opened on it, never from a read that
// moved on under it. A refusal is said in the banner above the footer. When
// the sheet is behind the goal, the goal is read again and the sheet opens
// afresh on the latest, still saying why: someone changed the goal (F-1), the
// month a change now was for has ended (F-2: the latest then offers the month
// after), or the month a change from a coming month starts with has turned
// (F-4). A goal stopped a moment ago (F-5) leaves nothing to change: the sheet
// closes on the latest and a toast says why. Part of the sheet's chunk.
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import type { PortalGoalMeasure } from '#/contexts/reporting/application/dto/goal-recommendation.types'
import type {
  PortalGoalChangeFacts,
  PortalGoalOfCard,
} from '#/contexts/reporting/application/dto/monthly-portal-goal.types'
import {
  actionErrorMessage,
  useActionMutation,
} from '#/components/hooks/use-action-mutation'
import { goalRefusalCode, withGoalRefusals } from './goal-refusal'
import type { PortalGoalSheetProps } from './portal-goal-sheet'
import { PortalGoalNoteField } from './portal-goal-note-field'
import { PortalGoalSheetBody } from './portal-goal-sheet-body'
import {
  changedChangeDraft,
  openingChangeDraft,
  portalGoalChangeModel,
  type PortalGoalChangeContext,
  type PortalGoalChangeSubmission,
} from './portal-goal-sheet-change-view'
import { PortalGoalSheetFrame } from './portal-goal-sheet-frame'
import {
  changeRefusals,
  PORTAL_CHANGE_REOPENS,
  PORTAL_GOAL_BEHIND,
} from './portal-goal-sheet-refusals'

type Props = PortalGoalSheetProps &
  Readonly<{
    goal: PortalGoalOfCard
    change: PortalGoalChangeFacts
    measure: PortalGoalMeasure
  }>

type Sent = Readonly<{ submission: PortalGoalChangeSubmission; toast: string }>

/** The change, sent once however often it is pressed, and what follows it. */
function useChangeCommand(props: Props) {
  const sending = useRef(false)
  const [sent, setSent] = useState(false)
  const { commands, change, propertyId } = props
  const settle = async () => {
    await commands.onSet()
    props.onSettled()
  }
  const run = ({ submission }: Sent) =>
    submission.when === 'now'
      ? commands.changeMonthlyPortalGoalNowFn({
          data: { propertyId, ...submission.data },
        })
      : commands.reviseMonthlyPortalGoalFn({ data: { propertyId, ...submission.data } })
  const month = change.now?.monthKey ?? change.nextMonthKey
  const save = useActionMutation(
    withGoalRefusals(run, changeRefusals(month, change.nextMonthKey)),
    {
      onSuccess: async (_output, { toast: text }) => {
        toast.success(text)
        await settle()
      },
      onError: (error) => {
        const code = goalRefusalCode(error) ?? ''
        if (code === 'invalid_transition') {
          // F-5: stopped meanwhile; the card shows the stopped goal.
          void settle().then(() => toast.error(actionErrorMessage(error)))
          return
        }
        // F-1, F-2, F-4: the host reads the goal again and opens the sheet on the latest.
        if (PORTAL_CHANGE_REOPENS.has(code)) props.onBehind?.(error)
        if (PORTAL_GOAL_BEHIND.has(code)) void commands.onSet()
      },
    },
  )
  const send = (input: Sent) => {
    if (sending.current) return
    sending.current = true
    setSent(true)
    void save(input)
      // Held by the mutation: the banner says it above the footer.
      .catch(() => undefined)
      .finally(() => {
        sending.current = false
      })
  }
  // The refusal the sheet opened with is said until the next press; F-5 is the toast's.
  const notice = sent ? null : (props.notice ?? null)
  const error = goalRefusalCode(save.error) === 'invalid_transition' ? null : save.error
  return { send, pending: save.isPending, error, notice }
}

export function PortalGoalChangeSheet(props: Props) {
  const { goal, change, facts } = props
  const [now] = useState(() => props.now ?? new Date())
  const context: PortalGoalChangeContext = { goal, change, facts, now }
  const [draft, setDraft] = useState(() => openingChangeDraft(context, props.measure))
  const model = portalGoalChangeModel(draft, context)
  const edit = (next: Parameters<typeof changedChangeDraft>[1]) =>
    setDraft((current) => changedChangeDraft(current, next, context))
  const { send, pending, error, notice } = useChangeCommand(props)
  return (
    <PortalGoalSheetFrame
      open={props.open}
      onOpenChange={props.onOpenChange}
      busy={pending}
      title={props.changeTitle ?? model.title}
      description={model.description}
      onCloseAutoFocus={props.onCloseAutoFocus}
    >
      {(phone) => (
        <PortalGoalSheetBody
          model={model}
          small={phone}
          pending={pending}
          error={error}
          notice={notice}
          onChange={edit}
          canSwitch={props.canSwitch}
          onSubmit={() => {
            if (model.submission !== null && model.toast !== null) {
              send({ submission: model.submission, toast: model.toast })
            }
          }}
          note={
            <PortalGoalNoteField
              note={model.note}
              pending={pending}
              onOpen={() => edit({ kind: 'note_open' })}
              onType={(text) => edit({ kind: 'note', text })}
            />
          }
        />
      )}
    </PortalGoalSheetFrame>
  )
}
