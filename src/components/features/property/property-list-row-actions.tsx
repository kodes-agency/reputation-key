// A property row's actions (docs/plan/property-list-table.md row 9). Every item
// is a link to where the work happens: removing a property opens the danger
// zone, whose dialogs and responsible-manager checks live there, so nothing in
// the list can change a property by accident.
import { Link } from '@tanstack/react-router'
import { Ellipsis } from 'lucide-react'
import { usePermissions } from '#/shared/hooks/usePermissions'
import { Button } from '#/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'

// A 44 px target below `md`, 32 px from there up. A link used as a menu item
// takes the menu's ink (`dropdown-menu-item` opts out of the link default).
const ITEM = 'min-h-11 md:min-h-8'

export function PropertyRowActions({
  propertyId,
  propertyName,
}: Readonly<{ propertyId: string; propertyName: string }>) {
  const { can } = usePermissions()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-11 text-muted-foreground md:size-8"
          aria-label={`Actions for ${propertyName}`}
        >
          <Ellipsis aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-52">
        <DropdownMenuItem asChild className={ITEM}>
          <Link to="/properties/$propertyId" params={{ propertyId }}>
            Open overview
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild className={ITEM}>
          <Link to="/properties/$propertyId/reviews" params={{ propertyId }}>
            Reviews
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild className={ITEM}>
          <Link to="/properties/$propertyId/settings" params={{ propertyId }}>
            Settings
          </Link>
        </DropdownMenuItem>
        {can('property.archive') ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild variant="destructive" className={ITEM}>
              <Link to="/properties/$propertyId/settings/danger" params={{ propertyId }}>
                Remove from workspace…
              </Link>
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
