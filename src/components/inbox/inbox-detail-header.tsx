import { Copy, Flag, FlagOff, MessageSquare, MoreHorizontal, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '#/components/ui/button'
import { Badge } from '#/components/ui/badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import type { InboxItem } from '#/contexts/inbox/application/public-api'
import { usePermissions } from '#/shared/hooks/usePermissions'
import type { InboxDetailState } from './use-inbox-detail'
import { useState } from 'react'
import { InboxReopenDialog } from './inbox-reopen-dialog'

type Props = Readonly<{
  item: InboxItem
  detail: InboxDetailState['detail']
  detailState: InboxDetailState
  onClose: () => void
}>

async function copyText(text: string, label: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
    toast.success(`${label} copied`)
  } catch {
    toast.error(`Could not copy ${label.toLowerCase()}`)
  }
}

export function InboxDetailHeader({ item, detail, detailState, onClose }: Props) {
  const [reopenOpen, setReopenOpen] = useState(false)
  const { can } = usePermissions()
  const canManage = can('inbox.manage')
  const escalationActive = item.isEscalated && item.escalationResolvedAt === null
  const isPending =
    detailState.updateStatus.isPending ||
    detailState.escalate.isPending ||
    detailState.resolveEscalation.isPending ||
    detailState.markFeedbackHandled.isPending ||
    detailState.correctFeedbackHandlingOutcome.isPending
  const reviewText = detail?.reviewText ?? null
  const translation = detail?.reviewTranslatedText ?? null
  const hasCopyAction = Boolean(reviewText || translation)

  return (
    <header className="flex min-w-0 flex-wrap items-center gap-2 border-b px-5 py-4 lg:px-6">
      <div className="mr-auto flex min-w-32 flex-1 items-center gap-2">
        <MessageSquare className="shrink-0 text-muted-foreground" />
        <span className="truncate text-sm font-semibold">
          {item.propertyName ?? 'Property'}
        </span>
        {item.platform && (
          <span className="shrink-0 text-xs text-muted-foreground">
            · {item.platform}
          </span>
        )}
      </div>

      {canManage && (
        <>
          {item.status === 'closed' ? (
            <Select
              value="closed"
              disabled={isPending}
              onValueChange={(value) => {
                if (value === 'open') setReopenOpen(true)
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
            onOpenChange={setReopenOpen}
            pending={detailState.updateStatus.isPending}
            onConfirm={({ reason, explanation }) =>
              detailState.updateStatus({
                data: {
                  inboxItemId: item.id,
                  status: 'open',
                  expectedCommandRevision: item.commandRevision,
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
                ? detailState.resolveEscalation({
                    data: {
                      inboxItemId: item.id,
                      expectedCommandRevision: item.commandRevision,
                    },
                  })
                : detailState.escalate({
                    data: {
                      inboxItemId: item.id,
                      expectedCommandRevision: item.commandRevision,
                    },
                  })
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
      )}
      {!canManage && (
        <Badge variant="secondary" className="capitalize">
          {item.status}
        </Badge>
      )}

      {hasCopyAction && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon-sm" variant="outline" aria-label="More review actions">
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {reviewText && (
              <DropdownMenuItem onSelect={() => void copyText(reviewText, 'Review text')}>
                <Copy data-icon="inline-start" />
                Copy review text
              </DropdownMenuItem>
            )}
            {translation && (
              <DropdownMenuItem
                onSelect={() => void copyText(translation, 'Translation')}
              >
                <Copy data-icon="inline-start" />
                Copy translation
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      <Button size="icon-sm" variant="ghost" aria-label="Close detail" onClick={onClose}>
        <X />
      </Button>
    </header>
  )
}
