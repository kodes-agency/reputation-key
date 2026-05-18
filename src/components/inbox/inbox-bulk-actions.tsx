import { Button } from '#/components/ui/button'
import { CheckCircle, Archive, Mail } from 'lucide-react'
import { useMutationAction } from '#/components/hooks/use-mutation-action'
import { bulkUpdateInboxStatusFn } from '#/contexts/inbox/server/inbox'

type BulkStatus = 'read' | 'addressed' | 'archived'

type Props = Readonly<{
  selectedIds: ReadonlyArray<string>
  orgId: string
  userId: string
  onDone: () => void
}>

export function InboxBulkActions({ selectedIds, orgId, userId, onDone }: Props) {
  const bulkMutation = useMutationAction(bulkUpdateInboxStatusFn, {
    successMessage: 'Items updated',
    onSuccess: onDone,
  })

  const handleBulk = (status: BulkStatus) => {
    bulkMutation({
      data: {
        inboxItemIds: [...selectedIds],
        status,
        organizationId: orgId,
        userId,
      },
    })
  }

  if (selectedIds.length === 0) return null

  return (
    <div className="sticky top-0 z-10 flex items-center gap-3 rounded-lg border bg-muted/50 px-4 py-2 backdrop-blur-sm">
      <span className="text-sm font-medium">
        {selectedIds.length} selected
      </span>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => handleBulk('read')}
          disabled={bulkMutation.isPending}
        >
          <Mail className="size-3.5" />
          Mark Read
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => handleBulk('addressed')}
          disabled={bulkMutation.isPending}
        >
          <CheckCircle className="size-3.5" />
          Mark Addressed
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => handleBulk('archived')}
          disabled={bulkMutation.isPending}
        >
          <Archive className="size-3.5" />
          Archive
        </Button>
      </div>
    </div>
  )
}
