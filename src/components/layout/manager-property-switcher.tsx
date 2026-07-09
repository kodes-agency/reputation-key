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

type Props = Readonly<{
  properties: ReadonlyArray<{ id: string; name: string; slug: string }>
  propertyId: string | undefined
  onSwitch: (propertyId: string) => void
}>

export function ManagerPropertySwitcher({ properties, propertyId, onSwitch }: Props) {
  const navigate = useNavigate()
  const activeProperty = properties.find((p) => p.id === propertyId)

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton size="lg">
              <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-primary/10">
                <Building2 className="size-4 text-link" />
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
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => navigate({ to: '/properties' })}>
              <Building2 className="mr-2 size-4" />
              View all properties
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => navigate({ to: '/import' })}>
              <Plus className="mr-2 size-4" />
              Import property
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
