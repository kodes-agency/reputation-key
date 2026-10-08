// The Portals overview's cells: the name, the code and languages under it, and the
// responsible managers (the one quiet line under the name is `portal-attention-line`).
// Each is a small answer to one question, so the table and the phone card can place
// the same parts.
//
// Only the Portal's name keeps the link accent: it is the row's one way in. Any
// other link names its ink (`text-foreground`) to stay out of the accent
// (figures and notes must not turn purple).
import { Link } from '@tanstack/react-router'
import { Badge } from '#/components/ui/badge'
import { OwnerDisc } from '#/components/ui/owner-disc'
import { ROW_NAME_LINK } from '#/components/ui/row-link'
import { cn } from '#/lib/utils'
import type {
  PortalLocalesView,
  PortalManagersView,
  PortalOverviewItem,
} from './portal-overview-view'

type RowRef = Readonly<{ propertyId: string; portalId: string; name: string }>

export function PortalNameLink({ row }: Readonly<{ row: RowRef }>) {
  return (
    <Link
      to="/properties/$propertyId/portals/$portalId"
      params={{ propertyId: row.propertyId, portalId: row.portalId }}
      search={{ tab: 'page' }}
      className={cn('truncate font-medium', ROW_NAME_LINK)}
    >
      {row.name}
    </Link>
  )
}

/** `EN BG ES DE`, with the full names for a screen reader. */
function PortalLocaleChips({ locales }: Readonly<{ locales: PortalLocalesView }>) {
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
