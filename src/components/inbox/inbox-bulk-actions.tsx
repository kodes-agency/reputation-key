import { RotateCcw, X } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { Checkbox } from '#/components/ui/checkbox'
import { useActionMutation } from '#/components/hooks/use-action-mutation'
import { FormErrorBanner } from '#/components/forms/form-error-banner'
import { INBOX_BULK_LIMIT, type InboxItem } from '#/contexts/inbox/application/public-api'
import type { bulkUpdateInboxStatusFn } from '#/contexts/inbox/server/inbox'

type Props = Readonly<{
  selectedIds: ReadonlyArray<string>
  items: readonly InboxItem[]
  onDone: () => void
  onSelectAll: () => void
  onClearSelection: () => void
  bulkUpdateFn: typeof bulkUpdateInboxStatusFn
}>

export function InboxBulkActions({
  selectedIds,
  items,
  onDone,
  onSelectAll,
  onClearSelection,
  bulkUpdateFn,
}: Props) {
  const bulkMutation = useActionMutation(bulkUpdateFn, {
    successMessage: 'Items reopened',
    onSuccess: onDone,
  })
  const selectedSet = new Set(selectedIds)
  const selected = items.filter((item) => selectedSet.has(item.id))
  const selectable = items.slice(0, INBOX_BULK_LIMIT)
  const allSelectableSelected =
    selectable.length > 0 && selectable.every((item) => selectedSet.has(item.id))
  const hasClosed = selected.some((item) => item.status === 'closed')

  const handleReopen = () => {
    if (selectedIds.length === 0) return
    bulkMutation({ data: { inboxItemIds: [...selectedIds], status: 'open' } }).catch(
      () => {
        // The mutation owns the failure state rendered below.
      },
    )
  }

  return (
    <div className="mt-4 space-y-2">
      <div className="flex min-h-10 flex-wrap items-center gap-2">
        <Checkbox
          checked={allSelectableSelected ? true : 'indeterminate'}
          onCheckedChange={(checked) =>
            checked === true ? onSelectAll() : onClearSelection()
          }
          aria-label={
            items.length > INBOX_BULK_LIMIT
              ? `Select first ${INBOX_BULK_LIMIT} loaded reviews`
              : 'Select all loaded reviews'
          }
        />
        <span className="text-sm font-medium tabular-nums">
          {selectedIds.length} selected
        </span>
        {(items.length > INBOX_BULK_LIMIT || selectedIds.length >= INBOX_BULK_LIMIT) && (
          <span className="text-xs text-muted-foreground">
            {INBOX_BULK_LIMIT} maximum
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleReopen}
            disabled={bulkMutation.isPending || !hasClosed}
          >
            <RotateCcw data-icon="inline-start" />
            Reopen
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onClearSelection}
            aria-label="Clear selection"
          >
            <X />
          </Button>
        </div>
      </div>
      <FormErrorBanner error={bulkMutation.error} />
    </div>
  )
}
