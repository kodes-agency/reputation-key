// Inbox bulk actions — multi-select status change toolbar
// Receives bulkUpdateInboxStatusFn as prop per src/components/CONTEXT.md.

import { Button } from '#/components/ui/button'
import { CheckCircle, Archive, Mail } from 'lucide-react'
import { useMutationAction } from '#/components/hooks/use-mutation-action'
import type { bulkUpdateInboxStatusFn } from '#/contexts/inbox/server/inbox'

type BulkStatus = 'read' | 'addressed' | 'archived'

type Props = Readonly<{
  selectedIds: ReadonlyArray<string>
  onDone: () => void
  bulkUpdateFn: typeof bulkUpdateInboxStatusFn
}>

export function InboxBulkActions({ selectedIds, onDone, bulkUpdateFn }: Props) {
  const bulkMutation = useMutationAction(bulkUpdateFn, {
    successMessage: 'Items updated',
    onSuccess: onDone,
  })

  const handleBulk = (status: BulkStatus) => {
    bulkMutation({
      data: {
        inboxItemIds: [...selectedIds],
        status,
      },
    })
  }

  return (
    <div className="flex items-center gap-1.5">
      <span className="text-xs text-muted-foreground">
        {selectedIds.length} selected
      </span>
      <Button
        variant="outline"
        size="sm"
        onClick={() => handleBulk('read')}
        disabled={bulkMutation.isPending}
      >
        <Mail className="size-3.5" />
        Mark Read
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={() => handleBulk('addressed')}
        disabled={bulkMutation.isPending}
      >
        <CheckCircle className="size-3.5" />
        Addressed
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={() => handleBulk('archived')}
        disabled={bulkMutation.isPending}
      >
        <Archive className="size-3.5" />
        Archive
      </Button>
    </div>
  )
}
