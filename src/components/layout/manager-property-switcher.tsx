import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from '#/components/ui/sidebar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import { Building2, ChevronsUpDown, Plus } from 'lucide-react'
import { useNavigate } from '@tanstack/react-router'
import { usePermissions } from '#/shared/hooks/usePermissions'
import { personInitials } from '#/components/inbox/person-initials'

type Props = Readonly<{
  properties: ReadonlyArray<{ id: string; name: string; slug: string }>
  propertyId: string | undefined
  organizationName: string | undefined
  /** The page in view is over every Property: the tile names the Organization. */
  isAllProperties: boolean
  /**
   * Whether All properties opens somewhere other than the property list. When
   * it does not, the list entry would be a second way to the same page.
   */
  allPropertiesIsListed: boolean
  onSwitch: (propertyId: string) => void
  onSelectAllProperties: () => void
}>

const ALL_PROPERTIES = 'All properties'

/** What the tile reads as: the property in view, All properties, or a prompt. */
function tileCopy(
  activeProperty: Props['properties'][number] | undefined,
  isAllProperties: boolean,
  organizationName: string | undefined,
) {
  if (activeProperty) {
    return {
      title: activeProperty.name,
      subtitle: activeProperty.slug,
      label: activeProperty.name,
    }
  }
  if (isAllProperties) {
    return {
      title: organizationName ?? ALL_PROPERTIES,
      subtitle: organizationName ? ALL_PROPERTIES : undefined,
      label: `${organizationName ?? ALL_PROPERTIES}, all properties. Switch to a property`,
    }
  }
  return {
    title: 'Select property',
    subtitle: 'No property selected',
    label: 'Select property',
  }
}

export function ManagerPropertySwitcher({
  properties,
  propertyId,
  organizationName,
  isAllProperties,
  allPropertiesIsListed,
  onSwitch,
  onSelectAllProperties,
}: Props) {
  const navigate = useNavigate()
  const { can } = usePermissions()
  const activeProperty = properties.find((p) => p.id === propertyId)
  const initials = personInitials(activeProperty?.name)
  const copy = tileCopy(activeProperty, isAllProperties, organizationName)

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton size="lg" tooltip={copy.label} aria-label={copy.label}>
              <div
                className={`flex aspect-square size-8 items-center justify-center rounded-lg ${
                  initials
                    ? 'bg-accent text-(--accent) text-xs font-semibold'
                    : 'bg-primary/10'
                }`}
              >
                {initials ?? <Building2 className="size-4 text-link" />}
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight group-data-[collapsible=icon]:hidden">
                <span className="truncate font-semibold">{copy.title}</span>
                {copy.subtitle ? (
                  <span className="truncate text-xs text-muted-foreground">
                    {copy.subtitle}
                  </span>
                ) : null}
              </div>
              <ChevronsUpDown className="ml-auto size-4 group-data-[collapsible=icon]:hidden" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="bottom" align="start" className="w-64">
            <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
              Properties
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onSelectAllProperties}>
              <Building2 className="mr-2 size-4" />
              {ALL_PROPERTIES}
              {isAllProperties && (
                <span className="ml-auto text-xs text-muted-foreground">Active</span>
              )}
            </DropdownMenuItem>
            {properties.map((prop) => (
              <DropdownMenuItem key={prop.id} onClick={() => onSwitch(prop.id)}>
                {prop.name}
                {prop.id === propertyId && (
                  <span className="ml-auto text-xs text-muted-foreground">Active</span>
                )}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            {allPropertiesIsListed ? (
              <DropdownMenuItem onClick={() => navigate({ to: '/properties' })}>
                <Building2 className="mr-2 size-4" />
                View all properties
              </DropdownMenuItem>
            ) : null}
            {can('property.import_gbp_v2') ? (
              <DropdownMenuItem
                onClick={() => navigate({ to: '/properties/import-google' })}
              >
                <Plus className="mr-2 size-4" />
                Import property
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
