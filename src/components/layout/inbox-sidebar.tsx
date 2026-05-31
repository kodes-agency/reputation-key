// Inbox sidebar — replaces main sidebar on /inbox routes.
// Email-style folder panel with badge counts + category labels.
// Fetches folder counts internally via server function.
//
// NOTE: This component imports server functions (getInboxFolderCountsFn) per
// the CONTEXT.md exception for inbox-scoped data-fetching components.
// The server function is not passed as a prop because the sidebar is
// a self-contained sub-tree of the inbox page.
import { Link, useRouterState } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '#/components/ui/sidebar'
import { useServerFn } from '@tanstack/react-start'
import { useAction } from '#/components/hooks/use-action'
import { getInboxFolderCountsFn } from '#/contexts/inbox/server/inbox'
import { PropertyFilterSelect } from '#/components/inbox/property-filter-select'
import { FolderItem, CategoryItem, folders, categories } from './inbox-sidebar-items'
import { useState, useEffect } from 'react'

export interface InboxFolderCounts {
  inbox: number
  unaddressed: number
  escalated: number
  addressed: number
  archived: number
}

const DEFAULT_COUNTS: InboxFolderCounts = {
  inbox: 0,
  unaddressed: 0,
  escalated: 0,
  addressed: 0,
  archived: 0,
}

function useInboxFolder(): string {
  return useRouterState({
    select: (s) => {
      const params = new URLSearchParams(s.location.searchStr)
      return params.get('folder') ?? ''
    },
  })
}

function useInboxPlatform(): string {
  return useRouterState({
    select: (s) => {
      const params = new URLSearchParams(s.location.searchStr)
      return params.get('platform') ?? ''
    },
  })
}

function folderCountKey(
  folder: (typeof folders)[number]['key'],
): keyof InboxFolderCounts {
  if (folder === '') return 'unaddressed'
  return folder as keyof InboxFolderCounts
}

interface InboxSidebarProps {
  propertyId: string | undefined
  properties?: ReadonlyArray<{ id: string; name: string }>
  onPropertyChange: (propertyId: string | undefined) => void
}

export function InboxSidebar({
  propertyId,
  properties,
  onPropertyChange,
}: InboxSidebarProps) {
  const activeFolder = useInboxFolder()
  const activePlatform = useInboxPlatform()
  const [counts, setCounts] = useState<InboxFolderCounts>(DEFAULT_COUNTS)
  const fetchCounts = useAction(useServerFn(getInboxFolderCountsFn))

  useEffect(() => {
    fetchCounts({ data: {} })
      .then((result) => {
        const data = result as InboxFolderCounts | undefined
        if (data) setCounts(data)
      })
      .catch(() => {
        // Silently keep default counts on error
      })
  }, [fetchCounts])

  return (
    <div className="flex h-full w-full flex-col border-r overflow-hidden">
      <div className="shrink-0 px-3 py-2.5 border-b space-y-2">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild tooltip="Back to app" size="sm">
              <Link to="/properties">
                <ArrowLeft className="size-3.5" />
                <span className="text-xs">Back to app</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <PropertyFilterSelect
          value={propertyId}
          properties={properties}
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
                />
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </div>
    </div>
  )
}
