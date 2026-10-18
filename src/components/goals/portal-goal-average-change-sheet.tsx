// The sheet that changes the average private rating goal's level (PLAN PG-21;
// copy deck S-15…S-21 in tenths, M-14, F-1, F-2, F-5): "November, now" or
// "From Dec 1", the box of tenths, what an average needs, and "Add a note".
// The primary sends "now" as a change of the running month and the months
// after it, and "from next month" as a revision; a toast says what was saved.
// It is the Monthly portal goal's sheet frame, with no suggestions: there is no
// recommended average. Its form is `portal-goal-average-change-body.tsx`.
//
// It works from the goal as the sheet opened on it. A refusal is said in the
// banner above the footer. When the sheet is behind the goal (someone changed
// it, F-1; its month ended, F-2; or the month turned, F-4) the page reads the
// goal again and opens the sheet afresh on the latest, still saying why. A goal
// stopped a moment ago (F-5) leaves nothing to change: the sheet closes on the
// latest and a toast says why. A chunk of its own, loaded on the way to it.
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import type {
  ChangeMonthlyPortalGoalNowRequest,
  PortalGoalChangeFacts,
  ReviseMonthlyPortalGoalRequest,
} from '#/contexts/reporting/application/dto/monthly-portal-goal.types'
import type { PortalGoalAverageOfPage } from '#/contexts/reporting/application/dto/portal-goal-single-page.types'
import {
  actionErrorMessage,
  useActionMutation,
} from '#/components/hooks/use-action-mutation'
import { goalRefusalCode, withGoalRefusals } from './goal-refusal'
import { PortalGoalAverageChangeBody } from './portal-goal-average-change-body'
import {
  changedAverageDraft,
  openingAverageDraft,
  portalGoalAverageChangeModel,
  type PortalGoalAverageChangeSubmission,
} from './portal-goal-average-change-view'
import { PortalGoalSheetFrame } from './portal-goal-sheet-frame'
import { changeRefusals, PORTAL_CHANGE_REOPENS } from './portal-goal-sheet-refusals'
import { SINGLE_GOAL_WORDS } from './portal-goal-single-page-view'

/** What the sheet sends, and what follows it, handed down by the page. */
export type PortalGoalAverageChangeCommands = Readonly<{
  changeMonthlyPortalGoalNowFn: (
    input: Readonly<{ data: ChangeMonthlyPortalGoalNowRequest }>,
  ) => Promise<unknown>
  reviseMonthlyPortalGoalFn: (
    input: Readonly<{ data: ReviseMonthlyPortalGoalRequest }>,
  ) => Promise<unknown>
  /** Saved, or refused as behind: the page's reads are marked stale. */
  onChanged: () => Promise<void>
}>

export type PortalGoalAverageChangeSheetProps = Readonly<{
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Saved: the page has been read again, and the sheet is done. */
  onSettled: () => void
  /** F-1, F-2, F-4: the page reads the goal again and opens the sheet afresh. */
  onBehind: (error: unknown) => void
  propertyId: string
  /** The goal as the sheet opened on it (or read again after F-1). */
  goal: PortalGoalAverageOfPage
  change: PortalGoalChangeFacts
  commands: PortalGoalAverageChangeCommands
  /** A refusal the sheet opens with, said until the next press. */
  notice?: unknown
  onCloseAutoFocus?: (event: Event) => void
}>

type Sent = Readonly<{ submission: PortalGoalAverageChangeSubmission; toast: string }>

/** The change, sent once however often it is pressed, and what follows it. */
function useAverageChange(props: PortalGoalAverageChangeSheetProps) {
  const sending = useRef(false)
  const [sent, setSent] = useState(false)
  const { commands, change, propertyId } = props
  const settle = async () => {
    await commands.onChanged()
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
          // F-5: stopped meanwhile; the page shows the stopped goal.
          void settle().then(() => toast.error(actionErrorMessage(error)))
          return
        }
        if (PORTAL_CHANGE_REOPENS.has(code)) props.onBehind(error)
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
  const notice = sent ? null : (props.notice ?? null)
  const error = goalRefusalCode(save.error) === 'invalid_transition' ? null : save.error
  return { send, pending: save.isPending, error, notice }
}

export function PortalGoalAverageChangeSheet(props: PortalGoalAverageChangeSheetProps) {
  const context = { goal: props.goal, change: props.change }
  const [draft, setDraft] = useState(() => openingAverageDraft(context))
  const model = portalGoalAverageChangeModel(draft, context)
  const edit = (next: Parameters<typeof changedAverageDraft>[1]) =>
    setDraft((current) => changedAverageDraft(current, next))
  const { send, pending, error, notice } = useAverageChange(props)
  return (
    <PortalGoalSheetFrame
      open={props.open}
      onOpenChange={props.onOpenChange}
      busy={pending}
      title={SINGLE_GOAL_WORDS.changeTitle}
      description={model.description}
      onCloseAutoFocus={props.onCloseAutoFocus}
    >
      {(phone) => (
        <PortalGoalAverageChangeBody
          model={model}
          small={phone}
          pending={pending}
          error={error}
          notice={notice}
          onChange={edit}
          onSubmit={() => {
            if (model.submission !== null && model.toast !== null) {
              send({ submission: model.submission, toast: model.toast })
            }
          }}
        />
      )}
    </PortalGoalSheetFrame>
  )
}
