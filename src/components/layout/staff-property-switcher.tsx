import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from '#/components/ui/sidebar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import { Building2, ChevronsUpDown } from 'lucide-react'

type Props = Readonly<{
  properties: ReadonlyArray<{ id: string; name: string; slug: string }>
  propertyId: string | undefined
  onSwitch: (propertyId: string) => void
}>

export function StaffPropertySwitcher({ properties, propertyId, onSwitch }: Props) {
  const activeProperty = properties.find((p) => p.id === propertyId)

  if (properties.length <= 1) return null

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton size="lg">
              <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-accent">
                <Building2 className="size-4" />
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-semibold">
                  {activeProperty?.name ?? 'Select property'}
                </span>
                <span className="truncate text-xs text-muted-foreground">
                  {activeProperty?.slug ?? 'No property selected'}
                </span>
              </div>
              <ChevronsUpDown className="ml-auto size-4" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="bottom" align="start" className="w-64">
            <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
              Properties
            </div>
            <DropdownMenuSeparator />
            {properties.map((prop) => (
              <DropdownMenuItem key={prop.id} onClick={() => onSwitch(prop.id)}>
                {prop.name}
                {prop.id === propertyId && (
                  <span className="ml-auto text-xs text-muted-foreground">Active</span>
                )}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
