import { MessageSquare, X } from 'lucide-react'
import { useState } from 'react'
import { Button } from '#/components/ui/button'
import { Badge } from '#/components/ui/badge'
import type { InboxItem } from '#/contexts/inbox/application/public-api'
import { usePermissions } from '#/shared/hooks/usePermissions'
import type { InboxDetailState } from './use-inbox-detail'
import { InboxDetailCopyMenu } from './inbox-detail-copy-menu'
import { InboxDetailManagerActions } from './inbox-detail-manager-actions'

type Props = Readonly<{
  item: InboxItem
  detail: InboxDetailState['detail']
  detailState: InboxDetailState
  onClose: () => void
}>

export function InboxDetailHeader({ item, detail, detailState, onClose }: Props) {
  const [reopenOpen, setReopenOpen] = useState(false)
  const { can } = usePermissions()
  const canManage = can('inbox.manage')

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
        <InboxDetailManagerActions
          item={item}
          detailState={detailState}
          reopenOpen={reopenOpen}
          onReopenOpenChange={setReopenOpen}
        />
      )}
      {!canManage && (
        <Badge variant="secondary" className="capitalize">
          {item.status}
        </Badge>
      )}

      <InboxDetailCopyMenu detail={detail} />

      <Button size="icon-sm" variant="ghost" aria-label="Close detail" onClick={onClose}>
        <X />
      </Button>
    </header>
  )
}
