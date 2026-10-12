import { ChevronDown, ChevronRight } from 'lucide-react'
import { IconButton } from '#/components/ui/icon-button'

/**
 * The chevron that opens and closes a Property's or a group's Portals in the
 * overview table: one control, so the Property head and the group head cannot
 * drift. It sits left of the name, pulled back 4px so the glyph, not the box,
 * lines up with the table's edge.
 */
export function PortalOverviewToggle({
  name,
  expanded,
  onToggle,
}: Readonly<{ name: string; expanded: boolean; onToggle: () => void }>) {
  const Chevron = expanded ? ChevronDown : ChevronRight
  return (
    <IconButton
      variant="ghost"
      size="icon-sm"
      tooltip={false}
      className="-ml-1 text-muted-foreground"
      label={`Portals in ${name}`}
      aria-expanded={expanded}
      onClick={onToggle}
    >
      <Chevron aria-hidden="true" />
    </IconButton>
  )
}
