// Inbox bulk actions — multi-select status change toolbar.
// Per ADR 0023: bulk status is open ⇄ closed. Escalation is a per-item
// manual action (not bulk). No source-type guards.

import type { InboxItem } from '#/contexts/inbox/application/public-api'
import { Button } from '#/components/ui/button'
import { CheckCircle, RotateCcw } from 'lucide-react'
import { useActionMutation } from '#/components/hooks/use-action-mutation'
import type { bulkUpdateInboxStatusFn } from '#/contexts/inbox/server/inbox'

type BulkStatus = 'open' | 'closed'

type Props = Readonly<{
  selectedIds: ReadonlyArray<string>
  items: readonly InboxItem[]
  onDone: () => void
  bulkUpdateFn: typeof bulkUpdateInboxStatusFn
}>

export function InboxBulkActions({ selectedIds, items, onDone, bulkUpdateFn }: Props) {
  // invalidate: false — onDone refreshes the list explicitly (loadItems);
  // the inbox route has no loader.
  const bulkMutation = useActionMutation(bulkUpdateFn, {
    successMessage: 'Items updated',
    onSuccess: onDone,
  })

  // Offer Reopen when any selected item is closed; Close when any is open.
  const selected = selectedIds
    .map((id) => items.find((i) => i.id === id))
    .filter((i): i is InboxItem => i != null)
  const hasOpen = selected.some((i) => i.status === 'open')
  const hasClosed = selected.some((i) => i.status === 'closed')

  const handleBulk = (status: BulkStatus) => {
    if (selectedIds.length === 0) return
    bulkMutation({
      data: {
        inboxItemIds: [...selectedIds],
        status,
      },
    })
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-xs text-muted-foreground">{selectedIds.length} selected</span>
      <Button
        variant="default"
        size="sm"
        onClick={() => handleBulk('closed')}
        disabled={bulkMutation.isPending || !hasOpen}
      >
        <CheckCircle className="size-3.5" />
        Mark Closed
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={() => handleBulk('open')}
        disabled={bulkMutation.isPending || !hasClosed}
      >
        <RotateCcw className="size-3.5" />
        Reopen
      </Button>
    </div>
  )
}
