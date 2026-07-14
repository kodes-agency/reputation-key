// Inbox sidebar folder and category items — extracted for max-lines compliance.
// Per ADR 0023: 3 folders (Open, Escalated, Closed). The default (no slug)
// is the Open working view.
import { SidebarMenuButton, SidebarMenuItem } from '#/components/ui/sidebar'
import { Badge } from '#/components/ui/badge'
import { Inbox, AlertTriangle, CheckCircle } from 'lucide-react'

export const folders = [
  { key: '', label: 'Open', icon: Inbox },
  { key: 'escalated', label: 'Escalated', icon: AlertTriangle },
  { key: 'closed', label: 'Closed', icon: CheckCircle },
] as const

export const categories = [
  { key: 'google', label: 'Google', color: '#4285F4' },
  { key: 'facebook', label: 'Facebook', color: '#1877F2' },
  { key: 'yelp', label: 'Yelp', color: '#D32323' },
] as const

export function FolderItem({
  folder,
  count,
  isActive,
  onClick,
}: Readonly<{
  folder: (typeof folders)[number]
  count: number
  isActive: boolean
  onClick?: () => void
}>) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton isActive={isActive} tooltip={folder.label} onClick={onClick}>
        <folder.icon />
        <span className="flex-1">{folder.label}</span>
        {count > 0 && (
          <Badge variant="secondary" className="ml-auto text-xs tabular-nums">
            {count}
          </Badge>
        )}
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
}

export function CategoryItem({
  category,
  isActive,
  onClick,
}: Readonly<{
  category: (typeof categories)[number]
  isActive: boolean
  onClick?: () => void
}>) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton isActive={isActive} tooltip={category.label} onClick={onClick}>
        <span
          className="flex size-2 shrink-0 rounded-full"
          style={{ backgroundColor: category.color }}
        />
        <span className="flex-1">{category.label}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
}
