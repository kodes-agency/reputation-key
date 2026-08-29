import { Flag, FlagOff } from 'lucide-react'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import type { InboxItem } from '#/contexts/inbox/application/public-api'
import type { InboxDetailState } from './use-inbox-detail'
import { InboxReopenDialog } from './inbox-reopen-dialog'

/** Any in-flight header command disables every other header command. */
function isHeaderCommandPending(detailState: InboxDetailState): boolean {
  return (
    detailState.updateStatus.isPending ||
    detailState.escalate.isPending ||
    detailState.resolveEscalation.isPending ||
    detailState.markFeedbackHandled.isPending ||
    detailState.correctFeedbackHandlingOutcome.isPending
  )
}

type Props = Readonly<{
  item: InboxItem
  detailState: InboxDetailState
  reopenOpen: boolean
  onReopenOpenChange: (open: boolean) => void
}>

/** Work-status and escalation controls, rendered only for `inbox.manage`. */
export function InboxDetailManagerActions({
  item,
  detailState,
  reopenOpen,
  onReopenOpenChange,
}: Props) {
  const escalationActive = item.isEscalated && item.escalationResolvedAt === null
  const isPending = isHeaderCommandPending(detailState)
  const expected = {
    inboxItemId: item.id,
    expectedCommandRevision: item.commandRevision,
  }

  return (
    <>
      {item.status === 'closed' ? (
        <Select
          value="closed"
          disabled={isPending}
          onValueChange={(value) => {
            if (value === 'open') onReopenOpenChange(true)
          }}
        >
          <SelectTrigger size="sm" aria-label="Work status" className="w-24">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="open">Open</SelectItem>
              <SelectItem value="closed">Closed</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
      ) : (
        <Badge variant="secondary">Open</Badge>
      )}

      <InboxReopenDialog
        open={reopenOpen}
        onOpenChange={onReopenOpenChange}
        pending={detailState.updateStatus.isPending}
        onConfirm={({ reason, explanation }) =>
          detailState.updateStatus({
            data: {
              ...expected,
              status: 'open',
              reopenReason: reason,
              reopenExplanation: explanation,
            },
          })
        }
      />

      <Button
        size="sm"
        variant="outline"
        disabled={isPending}
        onClick={() =>
          escalationActive
            ? detailState.resolveEscalation({ data: expected })
            : detailState.escalate({ data: expected })
        }
      >
        {escalationActive ? (
          <FlagOff data-icon="inline-start" />
        ) : (
          <Flag data-icon="inline-start" />
        )}
        {escalationActive ? 'Resolve' : 'Escalate'}
      </Button>
    </>
  )
}
