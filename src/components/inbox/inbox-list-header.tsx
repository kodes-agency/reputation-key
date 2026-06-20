// Inbox list panel header — title, All/Unaddressed tabs, and search bar.
// Extracted from inbox-page-v2.tsx for max-lines compliance.
import { Menu, Search } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { Badge } from '#/components/ui/badge'
import { Input } from '#/components/ui/input'

type Props = Readonly<{
  folderLabel: string
  newCount: number
  showTabs: boolean
  activeTab: 'all' | 'unaddressed' | undefined
  searchQ: string | undefined
  onTabChange: (tab: 'all' | 'unaddressed' | undefined) => void
  onSearchChange: (q: string | undefined) => void
  /** Opens the folder sidebar drawer (mobile only). */
  onOpenSidebar?: () => void
}>

export function InboxListHeader({
  folderLabel,
  newCount,
  showTabs,
  activeTab,
  searchQ,
  onTabChange,
  onSearchChange,
  onOpenSidebar,
}: Props) {
  return (
    <div className="shrink-0 border-b px-4 py-2.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 min-w-0">
          {onOpenSidebar && (
            <Button
              variant="ghost"
              size="icon"
              className="-ml-1 size-8 md:hidden"
              onClick={onOpenSidebar}
              aria-label="Open folders"
            >
              <Menu className="size-4" />
            </Button>
          )}
          <h1 className="truncate text-lg font-semibold tracking-tight">{folderLabel}</h1>
          {newCount > 0 && (
            <Badge variant="secondary" className="text-xs tabular-nums">
              {newCount} new
            </Badge>
          )}
        </div>
        {/* All / Unaddressed tabs — only show in root Inbox (no folder selected) */}
        {showTabs && (
          <div className="flex items-center gap-1">
            <Button
              variant={activeTab !== 'unaddressed' ? 'secondary' : 'ghost'}
              size="sm"
              className="h-7 text-xs"
              onClick={() => onTabChange(undefined)}
            >
              All
            </Button>
            <Button
              variant={activeTab === 'unaddressed' ? 'secondary' : 'ghost'}
              size="sm"
              className="h-7 text-xs"
              onClick={() => onTabChange('unaddressed')}
            >
              Unaddressed
            </Button>
          </div>
        )}
      </div>
      {/* Search bar */}
      <div className="relative mt-2">
        <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search reviews..."
          value={searchQ ?? ''}
          onChange={(e) => onSearchChange(e.target.value || undefined)}
          className="h-8 pl-8 text-sm"
        />
      </div>
    </div>
  )
}
