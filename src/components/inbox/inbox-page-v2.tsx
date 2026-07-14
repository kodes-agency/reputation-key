// Inbox page v2 — three-panel email-style layout with resizable panels.
// Sidebar (folder nav) | List (review previews) | Detail (full review).
import type { InboxCtx } from './inbox-types'
import {
  InboxListPanel,
  type InboxListPanelProps,
} from '#/components/inbox/inbox-list-panel-v2'
import { InboxSidebar } from '#/components/layout/inbox-sidebar'
import { useInboxPage, type InboxPageNav } from './use-inbox-page'
import type { InboxServerFns } from './types'
import { useRef, useState } from 'react'
import { Panel, PanelGroup } from 'react-resizable-panels'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '#/components/ui/sheet'
import type { InboxSearchParams } from './inbox-search-schema'
import {
  ResizeHandle,
  folderLabelFor,
  InboxNoOrgState,
  InboxDetailPane,
} from './inbox-page-parts'
import { InboxDetailSheet } from './inbox-detail-sheet'

export { inboxSearchSchema, type InboxSearchParams } from './inbox-search-schema'

export function InboxPageV2({
  ctx,
  search,
  properties,
  onNavigate,
  inboxFns,
  onPropertyChange,
  activePropertyId,
}: {
  ctx: InboxCtx
  search: InboxSearchParams
  properties?: ReadonlyArray<{ id: string; name: string }>
  onNavigate: InboxPageNav
  inboxFns: InboxServerFns
  /** Override for the property-switcher dropdown. */
  onPropertyChange?: (propertyId: string | undefined) => void
  /** Active property — from route param on /reviews, from search on /inbox. */
  activePropertyId?: string
}) {
  const effectivePropertyId = activePropertyId ?? search.propertyId
  const s = useInboxPage(
    ctx.activeOrganization?.id,
    { ...search, propertyId: effectivePropertyId },
    onNavigate,
    inboxFns,
  )
  const listRef = useRef<HTMLDivElement>(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)

  if (!ctx.activeOrganization?.id) return <InboxNoOrgState />

  const handlePropertyChange =
    onPropertyChange ??
    ((id: string | undefined) =>
      onNavigate({
        to: '.',
        search: (p) => ({ ...p, propertyId: id, itemId: undefined }),
      }))

  const listPanelProps: InboxListPanelProps = {
    folderLabel: folderLabelFor(s.folder),
    openCount: s.openCount,
    searchQ: search.q,
    items: s.items,
    selectedIds: s.selectedIds,
    isLoading: s.isLoading,
    error: s.error,
    onRetry: s.refetch,
    nextCursor: s.nextCursor,
    loadAction: s.loadAction,
    listRef,
    onSearchChange: (q) =>
      onNavigate({ to: '.', search: (p) => ({ ...p, q, itemId: undefined }) }),
    onToggleSelect: s.handleToggleSelect,
    onSelectAll: s.handleSelectAll,
    onDeselectAll: s.handleDeselectAll,
    onRowClick: s.handleRowClick,
    onLoadMore: s.loadMore,
    onBulkDone: s.handleBulkDone,
    bulkUpdateFn: inboxFns.bulkUpdateInboxStatus,
  }

  // Mobile: the list fills the viewport. Folders/categories live in a left
  // drawer (opened from the list header); the detail opens as a right sheet.
  // The desktop 3-panel PanelGroup would cramp to unusable widths below md.
  if (s.isMobile) {
    return (
      <div className="flex h-full w-full flex-col overflow-hidden">
        <InboxListPanel {...listPanelProps} onOpenSidebar={() => setSidebarOpen(true)} />
        <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
          <SheetContent
            side="left"
            className="w-[280px] gap-0 p-0"
            showCloseButton={false}
          >
            <SheetHeader className="sr-only">
              <SheetTitle>Folders &amp; categories</SheetTitle>
              <SheetDescription>
                Switch inbox folders and filter by platform.
              </SheetDescription>
            </SheetHeader>
            <InboxSidebar
              propertyId={effectivePropertyId}
              properties={properties}
              onPropertyChange={(id) => {
                handlePropertyChange(id)
                setSidebarOpen(false)
              }}
              onNavigate={() => setSidebarOpen(false)}
              getInboxFolderCounts={inboxFns.getInboxFolderCounts}
            />
          </SheetContent>
        </Sheet>
        <InboxDetailSheet
          open={!!s.selectedItem}
          onOpenChange={(o) => {
            if (!o) s.closeDetail()
          }}
          item={s.selectedItem}
          detailState={s.detailState}
          detailFns={inboxFns}
        />
      </div>
    )
  }

  return (
    <PanelGroup direction="horizontal" autoSaveId="inbox-layout" className="h-full">
      <Panel defaultSize={20} minSize={15} maxSize={30} className="overflow-hidden">
        <InboxSidebar
          propertyId={effectivePropertyId}
          properties={properties}
          onPropertyChange={handlePropertyChange}
          getInboxFolderCounts={inboxFns.getInboxFolderCounts}
        />
      </Panel>
      <ResizeHandle />
      <Panel defaultSize={30} minSize={20} maxSize={50} className="overflow-hidden">
        <InboxListPanel {...listPanelProps} />
      </Panel>
      <ResizeHandle />
      <InboxDetailPane
        selectedItem={s.selectedItem}
        detailState={s.detailState}
        isMobile={s.isMobile}
        onClose={s.closeDetail}
        detailFns={inboxFns}
      />
    </PanelGroup>
  )
}
