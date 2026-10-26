// "Portals using this look" (board 09): every portal the look reaches, with its
// group and whether it is live, and a way to choose which one the preview
// draws. A live portal changes only when it is published again; the note says
// so, as the board does.
//
// A portal can have its own photo, colours, or name and logo (ADR 0070). The
// rail names the parts a portal has of its own in text chips (a small copy of the
// photo in a list would be noise), sets the portals that have all three apart
// under "With their own look", and links each portal to its Look section where
// an Account Admin can change them.
import { Circle, Eye, Info } from 'lucide-react'
import { Badge } from '#/components/ui/badge'
import { InlineLink } from '#/components/ui/inline-link'
import { cn } from '#/lib/utils'
import { ownChipsOf, sourcesOf } from './property-look-reach'
import {
  describeAffected,
  type AffectedPortalRow,
  type AffectedPortals,
} from './property-look-rules'

type ListProps = Readonly<{
  propertyId: string
  /** The portal the preview draws. */
  selectedId: string | null
  onSelect: (portalId: string) => void
  /** Whether a portal gets an "Edit its look" link: an Account Admin, with a second portal to differ from. */
  offersLookEdit: (row: AffectedPortalRow) => boolean
}>

type Props = ListProps & Readonly<{ affected: AffectedPortals }>

type RowProps = Readonly<{
  propertyId: string
  row: AffectedPortalRow
  isSelected: boolean
  onSelect: (portalId: string) => void
  hasEditLink: boolean
}>

function PortalRow({ propertyId, row, isSelected, onSelect, hasEditLink }: RowProps) {
  const isLive = row.publicationState === 'published'
  const chips = ownChipsOf(sourcesOf(row))
  return (
    <li>
      <div
        className={cn(
          'rounded-md transition-colors hover:bg-accent/60',
          isSelected && 'bg-accent-muted',
        )}
      >
        <button
          type="button"
          aria-pressed={isSelected}
          onClick={() => onSelect(row.portalId)}
          className="flex min-h-11 w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 md:min-h-0"
        >
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium">{row.name}</span>
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              {isLive ? null : <Circle className="size-2.5" aria-hidden />}
              {isLive ? (row.group?.name ?? 'Not in a group') : 'Draft · not published'}
            </span>
            {chips.length === 0 ? null : (
              <span className="mt-1 flex flex-wrap gap-1">
                {chips.map((chip) => (
                  <Badge key={chip} variant="outline" className="font-normal">
                    {chip}
                  </Badge>
                ))}
              </span>
            )}
          </span>
          {isSelected ? (
            <Eye
              className="size-4 shrink-0 text-muted-foreground"
              aria-label="Shown in the preview"
            />
          ) : null}
        </button>
        {hasEditLink ? (
          <InlineLink
            to="/properties/$propertyId/portals/$portalId"
            params={{ propertyId, portalId: row.portalId }}
            search={{ tab: 'page', section: 'look' }}
            className="flex min-h-11 items-center px-3 text-xs md:min-h-0 md:pb-2"
          >
            Edit its look <span className="sr-only">({row.name})</span>
          </InlineLink>
        ) : null}
      </div>
    </li>
  )
}

function PortalList({
  rows,
  propertyId,
  selectedId,
  onSelect,
  offersLookEdit,
}: ListProps & Readonly<{ rows: readonly AffectedPortalRow[] }>) {
  if (rows.length === 0) return null
  return (
    <ul className="space-y-0.5">
      {rows.map((row) => (
        <PortalRow
          key={row.portalId}
          propertyId={propertyId}
          row={row}
          isSelected={row.portalId === selectedId}
          onSelect={onSelect}
          hasEditLink={offersLookEdit(row)}
        />
      ))}
    </ul>
  )
}

export function PropertyLookPortals({
  propertyId,
  affected,
  selectedId,
  onSelect,
  offersLookEdit,
}: Props) {
  const independent = new Set(affected.independent.map((row) => row.portalId))
  const using = affected.listed.filter((row) => !independent.has(row.portalId))
  const list = { propertyId, selectedId, onSelect, offersLookEdit }
  return (
    <section aria-labelledby="property-look-portals-heading" className="space-y-2">
      <div>
        <h2 id="property-look-portals-heading" className="text-sm font-semibold">
          Portals using this look
        </h2>
        <p className="text-sm text-muted-foreground">{describeAffected(affected)}</p>
      </div>
      <PortalList rows={using} {...list} />
      {affected.independent.length === 0 ? null : (
        <div className="space-y-1 pt-2">
          <h3 className="px-3 text-xs font-semibold text-muted-foreground">
            With their own look
          </h3>
          <PortalList rows={affected.independent} {...list} />
        </div>
      )}
      <p className="flex gap-2 text-sm text-muted-foreground">
        <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>
          Pick a portal to preview it. Live portals change only when you publish; printed
          codes keep working.
        </span>
      </p>
    </section>
  )
}
