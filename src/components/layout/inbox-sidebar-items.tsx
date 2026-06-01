// Inbox sidebar folder and category items — extracted for max-lines compliance.
import { Link } from '@tanstack/react-router'
import { SidebarMenuButton, SidebarMenuItem } from '#/components/ui/sidebar'
import { Badge } from '#/components/ui/badge'
import { Inbox, AlertTriangle, CheckCircle, Archive } from 'lucide-react'

export const folders = [
  { key: '', label: 'Inbox', icon: Inbox },
  { key: 'escalated', label: 'Escalated', icon: AlertTriangle },
  { key: 'addressed', label: 'Addressed', icon: CheckCircle },
  { key: 'archived', label: 'Archived', icon: Archive },
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
}: Readonly<{
  folder: (typeof folders)[number]
  count: number
  isActive: boolean
}>) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={isActive} tooltip={folder.label}>
        <Link to="/inbox" search={{ folder: folder.key || undefined, itemId: undefined }}>
          <folder.icon />
          <span className="flex-1">{folder.label}</span>
          {count > 0 && (
            <Badge variant="secondary" className="ml-auto text-xs tabular-nums">
              {count}
            </Badge>
          )}
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
}

export function CategoryItem({
  category,
  isActive,
}: Readonly<{
  category: (typeof categories)[number]
  isActive: boolean
}>) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={isActive} tooltip={category.label}>
        <Link
          to="/inbox"
          search={{
            platform: isActive ? undefined : category.key,
            itemId: undefined,
          }}
        >
          <span
            className="flex size-2 shrink-0 rounded-full"
            style={{ backgroundColor: category.color }}
          />
          <span className="flex-1">{category.label}</span>
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
}
