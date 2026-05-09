import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from '#/components/ui/sidebar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import { ChevronsUpDown } from 'lucide-react'

type Props = Readonly<{
  organizations: ReadonlyArray<{ id: string; name: string }>
  activeOrganization: { id: string; name: string } | null
  onSwitch: (orgId: string) => void
}>

export function StaffOrgSwitcher({ organizations, activeOrganization, onSwitch }: Props) {
  return (
    <SidebarMenu>
      {activeOrganization && (
        <SidebarMenuItem>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <SidebarMenuButton size="lg">
                <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-muted">
                  <span className="text-xs font-bold">
                    {activeOrganization.name.charAt(0).toUpperCase()}
                  </span>
                </div>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">{activeOrganization.name}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    Organization
                  </span>
                </div>
                <ChevronsUpDown className="ml-auto size-4" />
              </SidebarMenuButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="bottom" align="start" className="w-64">
              <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                Organizations
              </div>
              {organizations.map((org) => (
                <DropdownMenuItem key={org.id} onClick={() => onSwitch(org.id)}>
                  {org.name}
                  {org.id === activeOrganization.id && (
                    <span className="ml-auto text-xs text-muted-foreground">Active</span>
                  )}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </SidebarMenuItem>
      )}
    </SidebarMenu>
  )
}
