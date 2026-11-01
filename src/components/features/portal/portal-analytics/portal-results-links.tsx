import { useState } from 'react'
import type { PortalLinkTaps } from '#/contexts/reporting/application/public-api'
import { RowButton as Button } from '#/components/ui/button-layouts'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '#/components/ui/collapsible'
import { InlineLink } from '#/components/ui/inline-link'
import { usePortalEditAccess } from '../portal-detail/use-portal-edit-access'
import { LINK_ICONS, linkIconKeyOrDefault } from '../link-tree/link-icons'
import type { PortalResultsPlace } from './portal-results-place'
import { formatNumber } from '#/lib/format'

const tapsText = (taps: number) =>
  taps === 0 ? 'No taps yet' : `${formatNumber(taps)} ${taps === 1 ? 'tap' : 'taps'}`

export function PortalResultsLinks({
  taps,
  place,
}: Readonly<{ taps: PortalLinkTaps; place?: PortalResultsPlace }>) {
  const [open, setOpen] = useState(false)
  const { canEdit } = usePortalEditAccess(place?.publicationState ?? 'published')
  const rows = [
    ...taps.rows,
    ...(taps.removedTaps > 0
      ? [
          {
            linkId: 'removed',
            label: 'Links you removed',
            iconKey: null,
            taps: taps.removedTaps,
          },
        ]
      : []),
  ]
  const renderRow = (row: (typeof rows)[number]) => {
    const Icon = LINK_ICONS[linkIconKeyOrDefault(row.iconKey)]
    return (
      <li key={row.linkId} className="flex min-w-0 items-center gap-3 py-2 text-sm">
        <Icon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate">{row.label}</span>
        <span className="shrink-0 text-muted-foreground tabular-nums">
          {tapsText(row.taps)}
        </span>
      </li>
    )
  }
  return (
    <div className="py-2">
      <ul>{rows.slice(0, 3).map(renderRow)}</ul>
      {rows.length > 3 ? (
        <Collapsible open={open} onOpenChange={setOpen}>
          <CollapsibleContent>
            <ul>{rows.slice(3).map(renderRow)}</ul>
          </CollapsibleContent>
          <CollapsibleTrigger asChild>
            <Button variant="ghost">
              {open ? 'Show less' : `Show ${rows.length - 3} more`}
            </Button>
          </CollapsibleTrigger>
        </Collapsible>
      ) : null}
      {rows.length === 0 ? (
        <p className="py-2 text-sm text-muted-foreground">No links in these days.</p>
      ) : null}
      {canEdit && place ? (
        <InlineLink
          to="/properties/$propertyId/portals/$portalId"
          params={{ propertyId: place.propertyId, portalId: place.portalId }}
          search={{ tab: 'page', section: 'linktree' }}
        >
          Edit links
        </InlineLink>
      ) : null}
    </div>
  )
}
