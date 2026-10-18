// A change sheet's command (PLAN PG-14, PG-21; copy deck S-21, F-1, F-2, F-5):
// the Monthly portal goal's, and the average's on its own page. "Now" is sent
// as a change of the running month and the months after it, "from next month"
// as a revision, once however often the primary is pressed; a toast says what
// was saved, the reads are marked stale and the sheet is done. A refusal is
// held for the sheet's banner, and the reads are marked stale when it means
// they are behind; when it leaves the sheet behind the goal (F-1, F-2, F-4) the
// host reads the goal again and opens the sheet afresh on the latest. A goal
// stopped a moment ago (F-5) leaves nothing to change: the sheet closes on the
// latest and a toast says why. The refusal a sheet opened with is said until
// the next press.
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import type {
  ChangeMonthlyPortalGoalNowRequest,
  PortalGoalChangeFacts,
  ReviseMonthlyPortalGoalRequest,
} from '#/contexts/reporting/application/dto/monthly-portal-goal.types'
import {
  actionErrorMessage,
  useActionMutation,
} from '#/components/hooks/use-action-mutation'
import { goalRefusalCode, withGoalRefusals } from './goal-refusal'
import type { PortalGoalChangeSubmission } from './portal-goal-change-submission'
import {
  changeRefusals,
  PORTAL_CHANGE_REOPENS,
  PORTAL_GOAL_BEHIND,
} from './portal-goal-sheet-refusals'

type Sent = Readonly<{ submission: PortalGoalChangeSubmission; toast: string }>

type Input = Readonly<{
  commands: Readonly<{
    changeMonthlyPortalGoalNowFn: (
      input: Readonly<{ data: ChangeMonthlyPortalGoalNowRequest }>,
    ) => Promise<unknown>
    reviseMonthlyPortalGoalFn: (
      input: Readonly<{ data: ReviseMonthlyPortalGoalRequest }>,
    ) => Promise<unknown>
  }>
  propertyId: string
  /** What the change is made against, as the sheet opened on it. */
  change: PortalGoalChangeFacts
  /** Marks the goal's reads stale: after a save, and after a refusal that means they are behind. */
  markStale: () => Promise<void>
  /** Saved, and read again: the sheet is done. */
  onSettled: () => void
  /** F-1, F-2, F-4: the host reads the goal again and opens the sheet afresh. */
  onBehind?: (error: unknown) => void
  /** A refusal the sheet opened with. */
  notice?: unknown
}>

export function usePortalGoalChangeCommand(input: Input) {
  const sending = useRef(false)
  const [sent, setSent] = useState(false)
  const { commands, change, propertyId } = input
  const settle = async () => {
    await input.markStale()
    input.onSettled()
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
        if (PORTAL_CHANGE_REOPENS.has(code)) input.onBehind?.(error)
        if (PORTAL_GOAL_BEHIND.has(code)) void input.markStale()
      },
    },
  )
  const send = (sentNow: Sent) => {
    if (sending.current) return
    sending.current = true
    setSent(true)
    void save(sentNow)
      // Held by the mutation: the banner says it above the footer.
      .catch(() => undefined)
      .finally(() => {
        sending.current = false
      })
  }
  const notice = sent ? null : (input.notice ?? null)
  const error = goalRefusalCode(save.error) === 'invalid_transition' ? null : save.error
  return { send, pending: save.isPending, error, notice }
}
