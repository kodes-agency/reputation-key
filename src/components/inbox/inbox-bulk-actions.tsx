// Inbox bulk actions — multi-select status change toolbar
// Receives bulkUpdateInboxStatusFn as prop per src/components/CONTEXT.md.
// Filters feedback-only IDs for "Mark Addressed" per CONTEXT.md rules.

import type { InboxItem } from '#/contexts/inbox/application/public-api'
import { Button } from '#/components/ui/button'
import { CheckCircle, Archive, AlertTriangle } from 'lucide-react'
import { useMutationAction } from '#/components/hooks/use-mutation-action'
import type { bulkUpdateInboxStatusFn } from '#/contexts/inbox/server/inbox'

type BulkStatus = 'addressed' | 'archived' | 'escalated'

type Props = Readonly<{
  selectedIds: ReadonlyArray<string>
  items: readonly InboxItem[]
  onDone: () => void
  bulkUpdateFn: typeof bulkUpdateInboxStatusFn
}>

export function InboxBulkActions({ selectedIds, items, onDone, bulkUpdateFn }: Props) {
  // invalidate: false — onDone refreshes the list explicitly (loadItems);
  // the inbox route has no loader.
  const bulkMutation = useMutationAction(bulkUpdateFn, {
    successMessage: 'Items updated',
    invalidate: false,
    onSuccess: onDone,
  })

  // FE-4: "Mark Addressed" only applies to feedback items (reviews have no
  // 'addressed' transition). Disable it when the selection contains no
  // feedback items, i.e. only reviews are selected.
  const selectedSourceItems = selectedIds
    .map((id) => items.find((i) => i.id === id))
    .filter((i): i is InboxItem => i != null)
  const hasFeedbackSelected = selectedSourceItems.some((i) => i.sourceType === 'feedback')
  const onlyReviewsSelected = selectedSourceItems.length > 0 && !hasFeedbackSelected

  const handleBulk = (status: BulkStatus) => {
    // "addressed" only applies to feedback items — filter out reviews
    const ids =
      status === 'addressed'
        ? selectedIds.filter((id) => {
            const item = items.find((i) => i.id === id)
            return item?.sourceType === 'feedback'
          })
        : [...selectedIds]

    if (ids.length === 0) return

    bulkMutation({
      data: {
        inboxItemIds: ids,
        status,
      },
    })
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-xs text-muted-foreground">{selectedIds.length} selected</span>
      <Button
        variant="destructive"
        size="sm"
        onClick={() => handleBulk('escalated')}
        disabled={bulkMutation.isPending}
      >
        <AlertTriangle className="size-3.5" />
        Escalate
      </Button>
      <Button
        variant="default"
        size="sm"
        onClick={() => handleBulk('addressed')}
        disabled={bulkMutation.isPending || onlyReviewsSelected}
      >
        <CheckCircle className="size-3.5" />
        Mark Addressed
      </Button>
      <Button
        variant="secondary"
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
