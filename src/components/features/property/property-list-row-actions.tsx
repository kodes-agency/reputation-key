// A property row's actions (docs/plan/property-list-table.md row 9). Every item
// is a link to where the work happens: removing a property opens the danger
// zone, whose dialogs and responsible-manager checks live there, so nothing in
// the list can change a property by accident.
import { Link } from '@tanstack/react-router'
import { Ellipsis } from 'lucide-react'
import { usePermissions } from '#/shared/hooks/usePermissions'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import { IconButton } from '#/components/ui/icon-button'

export function PropertyRowActions({
  propertyId,
  propertyName,
}: Readonly<{ propertyId: string; propertyName: string }>) {
  const { can } = usePermissions()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton
          variant="ghost"
          size="icon-sm"
          tooltip={false}
          className="text-muted-foreground"
          label={`Actions for ${propertyName}`}
        >
          <Ellipsis aria-hidden="true" />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-52">
        <DropdownMenuItem asChild>
          <Link to="/properties/$propertyId" params={{ propertyId }}>
            Open overview
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/properties/$propertyId/reviews" params={{ propertyId }}>
            Reviews
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/properties/$propertyId/settings" params={{ propertyId }}>
            Settings
          </Link>
        </DropdownMenuItem>
        {can('property.archive') ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild variant="destructive">
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
