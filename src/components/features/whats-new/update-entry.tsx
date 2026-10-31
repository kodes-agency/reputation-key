import { Check, ListFilter, MessageCircle, MessagesSquare } from 'lucide-react'
import type { ProductUpdate } from '#/shared/whats-new/types'
import { TONE_FILL, TONE_INK } from '#/components/ui/tone'
import { SectionTitle } from '#/components/ui/section-title'
import { TouchInlineLink } from '#/components/ui/inline-touch-link'
import { usePermissions } from '#/shared/hooks/usePermissions'
import { useCapabilities } from '#/shared/hooks/useCapabilities'

const ICON = { Check, ListFilter, MessageCircle, MessagesSquare }

function ShowMe({
  entry,
  propertyId,
  onFollow,
}: Readonly<{
  entry: ProductUpdate
  propertyId: string | null
  onFollow?: () => void
}>) {
  const { can } = usePermissions()
  const capabilities = useCapabilities()
  const link = entry.showMe
  if (!link || (link.needsProperty && !propertyId)) return null
  if (entry.requires?.capability && !capabilities.has(entry.requires.capability))
    return null
  if (link.to.endsWith('/replies') && !can('reply.manage')) return null
  if (link.to.endsWith('/guests') && !can('dashboard.read')) return null
  if (link.to === '/inbox' && !can('inbox.read')) return null
  return (
    <TouchInlineLink
      to={link.to}
      params={{ propertyId: propertyId ?? '' }}
      search={propertyId ? { propertyId } : {}}
      onClick={onFollow}
    >
      Show me<span className="sr-only">: {entry.title}</span>
    </TouchInlineLink>
  )
}

export function UpdateEntry({
  entry,
  propertyId,
  onFollow,
  level = 3,
}: Readonly<{
  entry: ProductUpdate
  propertyId: string | null
  onFollow?: () => void
  level?: 2 | 3
}>) {
  const Icon = ICON[entry.icon]
  return (
    <article className="flex min-w-0 gap-3">
      <span
        aria-hidden="true"
        className={`flex size-10 shrink-0 items-center justify-center rounded-lg ${TONE_FILL.info} ${TONE_INK.info}`}
      >
        <Icon className="size-5" />
      </span>
      <div className="min-w-0 space-y-1">
        <SectionTitle level={level}>{entry.title}</SectionTitle>
        {entry.body && <p className="text-sm text-muted-foreground">{entry.body}</p>}
        <ShowMe entry={entry} propertyId={propertyId} onFollow={onFollow} />
      </div>
    </article>
  )
}
