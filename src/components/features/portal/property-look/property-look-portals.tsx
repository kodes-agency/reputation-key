// "Portals using this look" (board 09): every portal the look reaches, with its
// group and whether it is live, and a way to choose which one the preview
// draws. A live portal changes only when it is published again; the note says
// so, as the board does.
import { Circle, Eye, Info } from 'lucide-react'
import { cn } from '#/lib/utils'
import { describeAffected, type AffectedPortals } from './property-look-rules'

type Props = Readonly<{
  affected: AffectedPortals
  /** The portal the preview draws. */
  selectedId: string | null
  onSelect: (portalId: string) => void
}>

export function PropertyLookPortals({ affected, selectedId, onSelect }: Props) {
  return (
    <section aria-labelledby="property-look-portals-heading" className="space-y-2">
      <div>
        <h2 id="property-look-portals-heading" className="text-sm font-semibold">
          Portals using this look
        </h2>
        <p className="text-sm text-muted-foreground">{describeAffected(affected)}</p>
      </div>
      {affected.listed.length === 0 ? null : (
        <ul className="space-y-0.5">
          {affected.listed.map((row) => {
            const isSelected = row.portalId === selectedId
            const isLive = row.publicationState === 'published'
            return (
              <li key={row.portalId}>
                <button
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() => onSelect(row.portalId)}
                  className={cn(
                    'flex min-h-11 w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left outline-none transition-colors hover:bg-accent/60 focus-visible:ring-[3px] focus-visible:ring-ring/50 md:min-h-0',
                    isSelected && 'bg-accent-muted',
                  )}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{row.name}</span>
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      {isLive ? null : <Circle className="size-2.5" aria-hidden />}
                      {isLive
                        ? (row.group?.name ?? 'Not in a group')
                        : 'Draft · not published'}
                    </span>
                  </span>
                  {isSelected ? (
                    <Eye
                      className="size-4 shrink-0 text-muted-foreground"
                      aria-label="Shown in the preview"
                    />
                  ) : null}
                </button>
              </li>
            )
          })}
        </ul>
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
