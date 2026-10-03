// "New portal" on the All properties page. A portal belongs to one Property, and
// this page is not in one, so with several Properties the button asks which; with
// one it goes straight there. The New portal form itself is still a page of the
// Property's own (the dialog arrives with slice 26).
import { Link } from '@tanstack/react-router'
import { ChevronDown, Plus } from 'lucide-react'
import { usePermissions } from '#/shared/hooks/usePermissions'
import { Button } from '#/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'

export type NewPortalProperty = Readonly<{ id: string; name: string }>

const BUTTON = 'min-h-11 sm:min-h-9'

export function PortalAllPropertiesNewPortal({
  properties,
}: Readonly<{ properties: readonly NewPortalProperty[] }>) {
  const { can } = usePermissions()
  const [only] = properties
  if (!can('portal.create') || only === undefined) return null
  if (properties.length === 1) {
    return (
      <Button asChild className={BUTTON}>
        <Link to="/properties/$propertyId/portals/new" params={{ propertyId: only.id }}>
          <Plus />
          New portal
        </Link>
      </Button>
    )
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button className={BUTTON}>
          <Plus aria-hidden="true" />
          New portal
          <ChevronDown aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56">
        <DropdownMenuLabel>Which property is it for?</DropdownMenuLabel>
        {properties.map((property) => (
          <DropdownMenuItem key={property.id} asChild className="min-h-11 md:min-h-8">
            <Link
              to="/properties/$propertyId/portals/new"
              params={{ propertyId: property.id }}
            >
              {property.name}
            </Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
