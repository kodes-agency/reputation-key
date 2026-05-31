// Inbox page v2 — three-panel email-style layout with resizable panels.
// Sidebar (folder nav) | List (review previews) | Detail (full review).
import type { InboxCtx } from './inbox-types'
import { InboxListPanel } from '#/components/inbox/inbox-list-panel-v2'
import { InboxDetailPanel } from '#/components/inbox/inbox-detail-panel'
import { InboxDetailSheet } from '#/components/inbox/inbox-detail-sheet'
import { InboxSidebar } from '#/components/layout/inbox-sidebar'
import { useInboxDetail } from '#/components/inbox/use-inbox-detail'
import { useInboxState } from '#/components/inbox/use-inbox-state'
import { useInboxKeyboardShortcuts } from '#/components/inbox/use-inbox-keyboard-shortcuts'
import type { InboxFilterValues } from '#/components/inbox/inbox-filters'
import { bulkUpdateInboxStatusFn } from '#/contexts/inbox/server/inbox'
import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { PageShell } from '#/components/layout/page-shell'
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import { Inbox } from 'lucide-react'
import { folderToStatus, type InboxSearchParams } from './inbox-search-schema'

export { inboxSearchSchema, type InboxSearchParams } from './inbox-search-schema'

const ResizeHandle = () => (
  <PanelResizeHandle className="w-1.5 bg-border/50 hover:bg-primary/30 active:bg-primary/50 transition-colors" />
)

function useIsMobile() {
  const [m, set] = useState(false)
  useEffect(() => {
    const q = window.matchMedia('(max-width: 767px)')
    set(q.matches)
    const h = (e: MediaQueryListEvent) => set(e.matches)
    q.addEventListener('change', h)
    return () => q.removeEventListener('change', h)
  }, [])
  return m
}

const FOLDER_LABELS: Record<string, string> = {
  escalated: 'Escalated',
  addressed: 'Addressed',
  archived: 'Archived',
}

export function InboxPageV2({
  ctx,
  search,
  properties,
  onNavigate,
  bulkUpdateFn,
}: {
  ctx: InboxCtx
  search: InboxSearchParams
  properties?: ReadonlyArray<{ id: string; name: string }>
  onNavigate: (o: {
    to: '.'
    search: (p: InboxSearchParams) => Partial<InboxSearchParams>
  }) => void
  bulkUpdateFn: typeof bulkUpdateInboxStatusFn
}) {
  const orgId = ctx.activeOrganization?.id
  const { itemId: _, folder, tab, ...rest } = search
  const isMobile = useIsMobile()
  const filters: InboxFilterValues = useMemo(
    () => ({
      propertyId: rest.propertyId ?? undefined,
      status:
        folderToStatus(folder) ??
        (tab === 'unaddressed' ? (['new', 'read'] as const) : undefined),
      sourceType: rest.sourceType ?? undefined,
      platform: rest.platform ?? undefined,
      ratingMin: rest.ratingMin ?? undefined,
      ratingMax: rest.ratingMax ?? undefined,
      q: rest.q ?? undefined,
    }),
    [
      rest.propertyId,
      rest.sourceType,
      rest.platform,
      rest.ratingMin,
      rest.ratingMax,
      rest.q,
      folder,
      tab,
    ],
  )

  const {
    items,
    setItems,
    nextCursor,
    isLoading,
    selectedIds,
    setSelectedIds,
    loadAction,
    loadItems,
    handleRowClick,
    closeDetail,
    handleBulkDone,
  } = useInboxState(orgId, filters, search.itemId, onNavigate)

  const selectedItem = useMemo(
    () => (search.itemId ? (items.find((i) => i.id === search.itemId) ?? null) : null),
    [search.itemId, items],
  )
  const detailState = useInboxDetail(selectedItem, !!selectedItem, { autoMarkRead: true })

  useEffect(() => {
    if (detailState.statusVersion > 0 && detailState.currentItem) {
      const u = detailState.currentItem
      setItems((p) =>
        p.map((i) =>
          i.id === u.id ? { ...i, status: u.status, updatedAt: u.updatedAt } : i,
        ),
      )
    }
  }, [detailState.statusVersion, detailState.currentItem])

  useInboxKeyboardShortcuts({
    items,
    isMobile,
    selectedItem,
    handleRowClick,
    closeDetail,
  })
  const listRef = useRef<HTMLDivElement>(null)
  const newCount = useMemo(() => items.filter((i) => i.status === 'new').length, [items])
  const folderLabel = FOLDER_LABELS[folder ?? ''] ?? 'Inbox'

  const handleToggleSelect = useCallback(
    (id: string) =>
      setSelectedIds((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id])),
    [setSelectedIds],
  )
  const handleSelectAll = useCallback(
    () => setSelectedIds(items.map((i) => i.id)),
    [items, setSelectedIds],
  )
  const handleDeselectAll = useCallback(() => setSelectedIds([]), [setSelectedIds])

  if (!orgId)
    return (
      <PageShell>
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Inbox</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Select an organization to view your inbox.
          </p>
        </div>
      </PageShell>
    )

  return (
    <PanelGroup direction="horizontal" autoSaveId="inbox-layout" className="h-full">
      <Panel defaultSize={20} minSize={15} maxSize={30} className="overflow-hidden">
        <InboxSidebar
          propertyId={search.propertyId}
          properties={properties}
          onPropertyChange={(id) =>
            onNavigate({
              to: '.',
              search: (p) => ({ ...p, propertyId: id, itemId: undefined }),
            })
          }
        />
      </Panel>
      <ResizeHandle />
      <Panel defaultSize={30} minSize={20} maxSize={50} className="overflow-hidden">
        <InboxListPanel
          folderLabel={folderLabel}
          newCount={newCount}
          showTabs={folder === undefined}
          activeTab={tab}
          searchQ={search.q}
          items={items}
          selectedIds={selectedIds}
          isLoading={isLoading}
          nextCursor={nextCursor}
          loadAction={loadAction}
          listRef={listRef}
          onTabChange={(t: 'all' | 'unaddressed' | undefined) =>
            onNavigate({ to: '.', search: (p) => ({ ...p, tab: t }) })
          }
          onSearchChange={(q: string | undefined) =>
            onNavigate({ to: '.', search: (p) => ({ ...p, q, itemId: undefined }) })
          }
          onToggleSelect={handleToggleSelect}
          onSelectAll={handleSelectAll}
          onDeselectAll={handleDeselectAll}
          onRowClick={handleRowClick}
          onLoadMore={loadItems}
          onBulkDone={handleBulkDone}
          bulkUpdateFn={bulkUpdateFn}
        />
      </Panel>
      <ResizeHandle />
      <Panel defaultSize={50} minSize={30} className="overflow-hidden">
        {selectedItem ? (
          <InboxDetailPanel
            selectedItem={selectedItem}
            detailState={detailState}
            onClose={closeDetail}
          />
        ) : (
          <div className="flex h-full flex-col border-l items-center justify-center gap-4 px-8">
            <div className="rounded-full bg-accent-muted/20 p-4">
              <Inbox className="size-14 opacity-30 text-accent" />
            </div>
            <p className="text-base font-semibold text-foreground">No message selected</p>
            <p className="text-sm text-muted-foreground/70">
              Select a review from the list to view details
            </p>
          </div>
        )}
      </Panel>
      <InboxDetailSheet
        open={isMobile && !!selectedItem}
        onOpenChange={(o) => {
          if (!o) closeDetail()
        }}
        item={selectedItem}
        detailState={detailState}
      />
    </PanelGroup>
  )
}
