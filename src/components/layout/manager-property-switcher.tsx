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
  onSwitch: (propertyId: string) => void
  scope: Readonly<{
    all: Readonly<{ isActive: boolean; onSelect: () => void }> | null
  }>
}>

export function ManagerPropertySwitcher({
  properties,
  propertyId,
  onSwitch,
  scope,
}: Props) {
  const navigate = useNavigate()
  const { can } = usePermissions()
  const activeProperty = properties.find((p) => p.id === propertyId)
  const allPropertiesActive = scope.all?.isActive === true
  const initials = personInitials(activeProperty?.name)

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              tooltip={activeProperty?.name ?? 'All properties'}
              aria-label={activeProperty?.name ?? 'All properties'}
            >
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
                <span className="truncate font-semibold">
                  {activeProperty?.name ??
                    (allPropertiesActive ? 'All properties' : 'Select property')}
                </span>
                <span className="truncate text-xs text-muted-foreground">
                  {activeProperty?.slug ??
                    (allPropertiesActive ? 'Workspace' : 'No property selected')}
                </span>
              </div>
              <ChevronsUpDown className="ml-auto size-4 group-data-[collapsible=icon]:hidden" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="bottom" align="start" className="w-64">
            <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
              Properties
            </div>
            <DropdownMenuSeparator />
            {scope.all ? (
              <DropdownMenuItem onClick={scope.all.onSelect}>
                All properties
                {scope.all.isActive ? (
                  <span className="ml-auto text-xs text-muted-foreground">Active</span>
                ) : null}
              </DropdownMenuItem>
            ) : null}
            {properties.map((prop) => (
              <DropdownMenuItem key={prop.id} onClick={() => onSwitch(prop.id)}>
                {prop.name}
                {prop.id === propertyId && (
                  <span className="ml-auto text-xs text-muted-foreground">Active</span>
                )}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => navigate({ to: '/properties' })}>
              <Building2 className="mr-2 size-4" />
              View all properties
            </DropdownMenuItem>
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
