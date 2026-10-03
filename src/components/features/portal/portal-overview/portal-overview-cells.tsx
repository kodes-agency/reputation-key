// The Portals overview's cells: the name with its one quiet line, the code and
// languages under it, and the responsible managers. Each is a small answer to
// one question, so the table and the phone card can place the same parts.
//
// Only the Portal's name keeps the link accent: it is the row's one way in. Any
// other link names its ink (`text-foreground`) to stay out of the accent
// (figures and notes must not turn purple).
import { Link } from '@tanstack/react-router'
import { CircleDashed, History, PencilLine, TriangleAlert } from 'lucide-react'
import { Badge } from '#/components/ui/badge'
import { OwnerDisc } from '#/components/ui/owner-disc'
import { cn } from '#/lib/utils'
import { attentionLine } from './portal-attention'
import { PortalIssuesPopover } from './portal-issues-popover'
import type {
  PortalLocalesView,
  PortalManagersView,
  PortalOverviewItem,
} from './portal-overview-view'

const FOCUS_RING =
  'rounded-sm underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'

type RowRef = Readonly<{ propertyId: string; portalId: string; name: string }>

export function PortalNameLink({ row }: Readonly<{ row: RowRef }>) {
  return (
    <Link
      to="/properties/$propertyId/portals/$portalId"
      params={{ propertyId: row.propertyId, portalId: row.portalId }}
      search={{ tab: 'page' }}
      className={cn('truncate font-medium', FOCUS_RING)}
    >
      {row.name}
    </Link>
  )
}

/**
 * The one line under a Portal's name, or nothing: status is shown only by
 * exception (round-4 owner decision). A live Portal that needs nothing has no line.
 */
export function PortalAttentionLine({
  item,
  propertyId,
}: Readonly<{ item: PortalOverviewItem; propertyId: string }>) {
  const { attention, row } = item
  const line = attentionLine(attention)
  if (line === null) return null
  switch (attention.kind) {
    case 'issues':
      return (
        <PortalIssuesPopover
          portalName={row.name}
          portalId={row.portalId}
          propertyId={propertyId}
          issues={attention.issues}
          label={line}
        >
          <TriangleAlert className="size-3.5" aria-hidden="true" />
          {line}
        </PortalIssuesPopover>
      )
    case 'draft':
      return (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <CircleDashed className="size-3.5 shrink-0" aria-hidden="true" />
          <span>
            {line} ·{' '}
            <Link
              to="/properties/$propertyId/portals/$portalId"
              params={{ propertyId, portalId: row.portalId }}
              search={{ tab: 'page' }}
              aria-label={`Continue setup for ${row.name}`}
              className={cn('font-medium whitespace-nowrap text-foreground', FOCUS_RING)}
            >
              Continue setup
            </Link>
          </span>
        </p>
      )
    case 'older_code':
      return (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <History className="size-3.5 shrink-0" aria-hidden="true" />
          <Link
            to="/properties/$propertyId/portals/$portalId"
            params={{ propertyId, portalId: row.portalId }}
            search={{ tab: 'share' }}
            aria-label={`${line}: open Share for ${row.name}`}
            className={cn('text-foreground', FOCUS_RING)}
          >
            {line}
          </Link>
        </p>
      )
    case 'pending':
      return (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <PencilLine className="size-3.5 shrink-0" aria-hidden="true" />
          {line}
        </p>
      )
    default:
      return <p className="text-xs text-muted-foreground">{line}</p>
  }
}

/** `EN BG ES DE`, with the full names for a screen reader. */
export function PortalLocaleChips({ locales }: Readonly<{ locales: PortalLocalesView }>) {
  return (
    <>
      <span aria-hidden="true" className="inline-flex flex-wrap gap-1">
        {locales.chips.map((chip) => (
          <Badge key={chip.code} variant="secondary">
            {chip.label}
          </Badge>
        ))}
      </span>
      <span className="sr-only">{locales.description}</span>
    </>
  )
}

/** What the Portal has for guests, then the languages, then (flat lists only) its group. */
export function PortalMetaLine({
  item,
  showGroup,
}: Readonly<{ item: PortalOverviewItem; showGroup: boolean }>) {
  const groupName = item.row.group?.name
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
      <span>{item.channel}</span>
      <PortalLocaleChips locales={item.locales} />
      {showGroup && groupName ? <span>· {groupName}</span> : null}
    </p>
  )
}

const MAX_DISCS = 3

/** A stack of discs for the responsible managers; "No one" is the one thing worth saying. */
export function PortalManagersCell({
  managers,
  quietWhenEmpty = false,
}: Readonly<{ managers: PortalManagersView; quietWhenEmpty?: boolean }>) {
  if (managers.isEmpty) {
    return quietWhenEmpty ? null : (
      <span className="text-sm font-medium text-warn">No one</span>
    )
  }
  const shown = managers.managers.slice(0, MAX_DISCS)
  const rest = managers.managers.length - shown.length
  return (
    <span className="inline-flex items-center">
      {shown.map((manager) => (
        <OwnerDisc
          key={manager.userId}
          initials={manager.initials}
          isAssigned
          tone="neutral"
          className="-ml-px ring-2 ring-card first:ml-0"
        />
      ))}
      {rest > 0 ? (
        <span aria-hidden="true" className="ml-1 text-xs text-muted-foreground">
          +{rest}
        </span>
      ) : null}
      <span className="sr-only">Responsible: {managers.description}</span>
    </span>
  )
}
