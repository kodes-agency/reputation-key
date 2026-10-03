import { RotateCcw, X } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { ButtonGroup } from '#/components/ui/button-group'
import { Checkbox } from '#/components/ui/checkbox'
import {
  useActionMutation,
  actionErrorMessage,
} from '#/components/hooks/use-action-mutation'
import { INBOX_BULK_LIMIT, type InboxItem } from '#/contexts/inbox/application/public-api'
import type { bulkUpdateInboxStatusFn } from '#/contexts/inbox/server/inbox'
import { toast } from 'sonner'
import { buildBulkReopenCommands, bulkReopenNotice } from './inbox-bulk-policy'
import { InboxReopenDialog } from './inbox-reopen-dialog'
import type { InboxAssignmentOption } from './inbox-owner-view'
import { InboxBulkAssignMenu } from './inbox-bulk-assign-menu'
import type { bulkAssignInboxItemsFn } from '#/contexts/inbox/server/inbox'
import { usePermissions } from '#/shared/hooks/usePermissions'
import { IconButton } from '#/components/ui/icon-button'

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
  // Bulk commands are immediate actions: a refusal is a toast. They used to
  // print an error banner into a screen-reader-only region, so a sighted manager
  // saw nothing at all.
  const bulkMutation = useActionMutation(bulkUpdateFn, {
    errorMessage: actionErrorMessage,
    onSuccess: (result) => {
      const notice = bulkReopenNotice(result)
      toast[notice.tone](notice.message)
      onDone()
    },
  })
  const assignmentMutation = useActionMutation(bulkAssignFn, {
    errorMessage: actionErrorMessage,
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
      // The mutation has already toasted the refusal.
    })
  }

  const handleAssignment = async (assignedToUserId: string | null) => {
    const commands = buildBulkReopenCommands(selectedIds, selected)
    if (commands.length === 0) return
    await assignmentMutation({ data: { items: commands, assignedToUserId } }).catch(
      () => {
        // The mutation has already toasted the refusal.
      },
    )
  }

  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <Checkbox
        checked={allSelectableSelected ? true : 'indeterminate'}
        // On a phone the after: box is a 40px tap target around the 16px
        // checkbox; desktop keeps the 16px one.
        className="max-md:relative max-md:after:absolute max-md:after:-inset-3 max-md:after:content-['']"
        onCheckedChange={(checked) =>
          checked === true ? onSelectAll() : onClearSelection()
        }
        aria-label={
          items.length > INBOX_BULK_LIMIT
            ? `Select first ${INBOX_BULK_LIMIT} loaded reviews`
            : 'Select all loaded reviews'
        }
      />
      <span className="shrink-0 text-sm font-medium tabular-nums">
        {selectedIds.length} selected
      </span>
      {(items.length > INBOX_BULK_LIMIT || selectedIds.length >= INBOX_BULK_LIMIT) && (
        <span className="hidden text-xs text-muted-foreground lg:inline">
          {INBOX_BULK_LIMIT} maximum
        </span>
      )}
      <div className="ml-auto flex min-w-0 items-center gap-2">
        <ButtonGroup>
          {canManageAssignments ? (
            <InboxBulkAssignMenu
              itemCount={selected.length}
              options={assignmentOptions}
              pending={assignmentMutation.isPending}
              onAssign={(userId) => void handleAssignment(userId)}
            />
          ) : null}
          <InboxReopenDialog
            itemCount={selected.length}
            pending={bulkMutation.isPending}
            onConfirm={handleReopen}
          >
            <Button
              variant="outline"
              size="sm"
              iconBelow="md"
              disabled={bulkMutation.isPending || !hasClosed}
              aria-label="Reopen"
            >
              <RotateCcw />
              <span className="max-md:sr-only">Reopen</span>
            </Button>
          </InboxReopenDialog>
        </ButtonGroup>
        {/* 36px on phones, pulled out 10px so the 16px X glyph sits on the right gutter. */}
        <IconButton
          variant="ghost"
          size="icon-sm"
          className="max-md:-mr-2.5"
          onClick={onClearSelection}
          label="Clear selection"
        >
          <X />
        </IconButton>
      </div>
    </div>
  )
}
