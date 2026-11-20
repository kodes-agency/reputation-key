// The two bulk commands of the Inbox list, and what each says when it settles.
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  actionErrorMessage,
  useActionMutation,
} from '#/components/hooks/use-action-mutation'
// Type-only: both server fns arrive as props per src/components/CONTEXT.md "Server-function boundary".
import type {
  bulkAssignInboxItemsFn,
  bulkUpdateInboxStatusFn,
} from '#/contexts/inbox/server/inbox'
import { bulkReopenNotice } from './inbox-bulk-policy'
import { inboxCachePolicy } from './inbox-cache-policy'

type Input = Readonly<{
  bulkUpdateFn: typeof bulkUpdateInboxStatusFn
  bulkAssignFn: typeof bulkAssignInboxItemsFn
  /** The command changed something: the selection is spent and the list is re-read. */
  onDone: () => void
}>

/**
 * Bulk commands are immediate actions: a refusal is a toast. They used to
 * print an error banner into a screen-reader-only region, so a sighted manager
 * saw nothing at all.
 */
export function useInboxBulkCommands({ bulkUpdateFn, bulkAssignFn, onDone }: Input) {
  const qc = useQueryClient()
  const reopen = useActionMutation(bulkUpdateFn, {
    errorMessage: actionErrorMessage,
    onSuccess: (result) => {
      const notice = bulkReopenNotice(result)
      toast[notice.tone](notice.message)
      onDone()
    },
  })
  const assign = useActionMutation(bulkAssignFn, {
    errorMessage: actionErrorMessage,
    onSuccess: async (result) => {
      if (result.updated === 0) {
        // An assignment is all or nothing, and the usual reason for nothing is
        // one row whose revision is behind (a colleague's change, another tab).
        // The command reads its fence from the rows, so the same selection
        // would be refused for ever: re-read them, and keep the selection for
        // the next try (no `onDone`). Awaited, so the command stays pending
        // and the toast waits until the rows are current: a retry before then
        // would send the same stale row.
        await inboxCachePolicy.onBulkCommandSettled(qc)
        toast.error(
          'No assignments changed. The list was refreshed; check access and try again.',
        )
        return
      }
      toast.success(
        `${result.updated} ${result.updated === 1 ? 'assignment' : 'assignments'} updated`,
      )
      onDone()
    },
  })
  return { reopen, assign }
}
