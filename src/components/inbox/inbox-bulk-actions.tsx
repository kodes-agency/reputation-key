import { RotateCcw, UserRoundCog, X } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { Checkbox } from '#/components/ui/checkbox'
import { useActionMutation } from '#/components/hooks/use-action-mutation'
import { FormErrorBanner } from '#/components/forms/form-error-banner'
import { INBOX_BULK_LIMIT, type InboxItem } from '#/contexts/inbox/application/public-api'
import type { bulkUpdateInboxStatusFn } from '#/contexts/inbox/server/inbox'
import { toast } from 'sonner'
import { buildBulkReopenCommands, bulkReopenNotice } from './inbox-bulk-policy'
import { InboxReopenDialog } from './inbox-reopen-dialog'
import {
  InboxBulkAssignmentDialog,
  type InboxAssignmentOption,
} from './inbox-bulk-assignment-dialog'
import type { bulkAssignInboxItemsFn } from '#/contexts/inbox/server/inbox'
import { usePermissions } from '#/shared/hooks/usePermissions'

type Props = Readonly<{
  selectedIds: ReadonlyArray<string>
  items: readonly InboxItem[]
  onDone: () => void
  onSelectAll: () => void
  onClearSelection: () => void
  bulkUpdateFn: typeof bulkUpdateInboxStatusFn
  bulkAssignFn: typeof bulkAssignInboxItemsFn
  assignmentOptions: ReadonlyArray<InboxAssignmentOption>
}>

export function InboxBulkActions({
  selectedIds,
  items,
  onDone,
  onSelectAll,
  onClearSelection,
  bulkUpdateFn,
  bulkAssignFn,
  assignmentOptions,
}: Props) {
  const { can } = usePermissions()
  const selectedSet = new Set(selectedIds)
  const selected = items.filter((item) => selectedSet.has(item.id))
  const bulkMutation = useActionMutation(bulkUpdateFn, {
    onSuccess: (result) => {
      const notice = bulkReopenNotice(result)
      toast[notice.tone](notice.message)
      onDone()
    },
  })
  const assignmentMutation = useActionMutation(bulkAssignFn, {
    onSuccess: (result) => {
      if (result.updated === 0) {
        toast.error('No assignments changed. Reload the list and check access.')
        return
      }
      toast.success(
        `${result.updated} ${result.updated === 1 ? 'assignment' : 'assignments'} updated`,
      )
      onDone()
    },
  })
  const selectable = items.slice(0, INBOX_BULK_LIMIT)
  const allSelectableSelected =
    selectable.length > 0 && selectable.every((item) => selectedSet.has(item.id))
  const hasClosed = selected.some((item) => item.status === 'closed')
  const canManageAssignments = can('inbox.manage')

  const handleReopen = async ({
    reason,
    explanation,
  }: Readonly<{
    reason:
      | 'guest_follow_up_still_needed'
      | 'internal_follow_up_still_needed'
      | 'new_information'
      | 'correcting_handling_status'
      | 'other'
    explanation: string | null
  }>) => {
    const commands = buildBulkReopenCommands(selectedIds, selected)
    if (commands.length === 0) return
    await bulkMutation({
      data: {
        items: commands,
        status: 'open',
        reopenReason: reason,
        reopenExplanation: explanation,
      },
    }).catch(() => {
      // The mutation owns the failure state rendered below.
    })
  }

  const handleAssignment = async (assignedToUserId: string | null) => {
    const commands = buildBulkReopenCommands(selectedIds, selected)
    if (commands.length === 0) return
    await assignmentMutation({ data: { items: commands, assignedToUserId } }).catch(
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
          {canManageAssignments ? (
            <InboxBulkAssignmentDialog
              itemCount={selected.length}
              options={assignmentOptions}
              pending={assignmentMutation.isPending}
              onConfirm={handleAssignment}
            >
              <Button
                variant="outline"
                size="sm"
                disabled={assignmentMutation.isPending || selected.length === 0}
              >
                <UserRoundCog data-icon="inline-start" />
                Assign
              </Button>
            </InboxBulkAssignmentDialog>
          ) : null}
          <InboxReopenDialog
            itemCount={selected.length}
            pending={bulkMutation.isPending}
            onConfirm={handleReopen}
          >
            <Button
              variant="outline"
              size="sm"
              disabled={bulkMutation.isPending || !hasClosed}
            >
              <RotateCcw data-icon="inline-start" />
              Reopen
            </Button>
          </InboxReopenDialog>
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
      <FormErrorBanner error={assignmentMutation.error} />
    </div>
  )
}
