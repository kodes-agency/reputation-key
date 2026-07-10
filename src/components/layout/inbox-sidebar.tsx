import { Link, useNavigate } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '#/components/ui/sidebar'
import { useQuery } from '@tanstack/react-query'
import { inboxKeys } from '#/shared/queries/query-keys'
import type { getInboxFolderCountsFn } from '#/contexts/inbox/server/inbox'
import { PropertyFilterSelect } from '#/components/inbox/property-filter-select'
import { FolderItem, CategoryItem, folders, categories } from './inbox-sidebar-items'
import {
  DEFAULT_COUNTS,
  useInboxFolder,
  useInboxPlatform,
  folderCountKey,
} from './inbox-sidebar-helpers'

interface InboxSidebarProps {
  propertyId: string | undefined
  properties?: ReadonlyArray<{ id: string; name: string }>
  onPropertyChange: (propertyId: string | undefined) => void
  /** Called after a folder/category navigation. Used to close the mobile drawer. */
  onNavigate?: () => void
  getInboxFolderCounts: typeof getInboxFolderCountsFn
}

export function InboxSidebar({
  propertyId,
  properties,
  onPropertyChange,
  onNavigate,
  getInboxFolderCounts,
}: InboxSidebarProps) {
  const activeFolder = useInboxFolder()
  const activePlatform = useInboxPlatform()
  const countsQuery = useQuery({
    queryKey: inboxKeys.counts(),
    queryFn: () => getInboxFolderCounts({ data: {} }),
    staleTime: 0,
  })
  const counts = countsQuery.data ?? DEFAULT_COUNTS
  const n = useNavigate()

  const nav = (s: Record<string, unknown>) => {
    if (propertyId) {
      n({ to: '/properties/$propertyId/reviews', params: { propertyId }, search: s })
    } else {
      n({ to: '/inbox', search: s })
    }
    onNavigate?.()
  }

  return (
    <div className="flex h-full w-full flex-col border-r overflow-hidden">
      <div className="shrink-0 px-3 py-2.5 border-b space-y-2">
        <SidebarMenu>
          <SidebarMenuItem>
            {propertyId ? (
              <SidebarMenuButton asChild tooltip="Back to dashboard" size="sm">
                <Link to="/properties/$propertyId" params={{ propertyId }}>
                  <ArrowLeft className="size-3.5" />
                  <span className="text-xs">Dashboard</span>
                </Link>
              </SidebarMenuButton>
            ) : (
              <SidebarMenuButton asChild tooltip="Back to app" size="sm">
                <Link to="/properties">
                  <ArrowLeft className="size-3.5" />
                  <span className="text-xs">Back to app</span>
                </Link>
              </SidebarMenuButton>
            )}
          </SidebarMenuItem>
        </SidebarMenu>
        <PropertyFilterSelect
          value={propertyId}
          properties={properties ?? []}
          onChange={onPropertyChange}
          className="w-full"
        />
      </div>
      <div className="flex-1 overflow-y-auto min-h-0">
        <SidebarGroup>
          <SidebarGroupLabel className="text-xs font-semibold tracking-wider uppercase text-muted-foreground px-3">
            Folders
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {folders.map((folder) => (
                <FolderItem
                  key={folder.key}
                  folder={folder}
                  count={counts[folderCountKey(folder.key)]}
                  isActive={
                    activeFolder === folder.key ||
                    (folder.key === '' && activeFolder === '')
                  }
                  onClick={() =>
                    nav({ folder: folder.key || undefined, itemId: undefined })
                  }
                />
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel className="text-xs font-semibold tracking-wider uppercase text-muted-foreground px-3">
            Categories
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {categories.map((cat) => (
                <CategoryItem
                  key={cat.key}
                  category={cat}
                  isActive={activePlatform === cat.key}
                  onClick={() =>
                    nav({
                      platform: activePlatform === cat.key ? undefined : cat.key,
                      itemId: undefined,
                    })
                  }
                />
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </div>
    </div>
  )
}
