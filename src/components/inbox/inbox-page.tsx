// Inbox page — email split layout with unified list + detail panel
import { z } from 'zod/v4'
import type { InboxCtx } from './inbox-types'
import { InboxListPanel } from '#/components/inbox/inbox-list-panel'
import { InboxDetailSheet } from '#/components/inbox/inbox-detail-sheet'
import { InboxDetailPanel } from '#/components/inbox/inbox-detail-panel'
import { useInboxDetail } from '#/components/inbox/use-inbox-detail'
import { useInboxState } from '#/components/inbox/use-inbox-state'
import type { InboxFilterValues } from '#/components/inbox/inbox-filters'
import { useState, useEffect, useCallback } from 'react'
import { PageShell } from '#/components/layout/page-shell'

export const INBOX_PAGE_SIZE = 50

export const inboxSearchSchema = z.object({
  itemId: z.string().uuid().optional(),
  propertyId: z.string().optional(),
  status: z
    .enum(['new', 'read', 'addressed', 'escalated', 'archived'])
    .optional()
    .catch('new'),
  sourceType: z.enum(['review', 'feedback']).optional(),
  platform: z.string().optional(),
  ratingMin: z.coerce.number().int().min(1).max(5).optional(),
  ratingMax: z.coerce.number().int().min(1).max(5).optional(),
})

export type InboxSearchParams = z.infer<typeof inboxSearchSchema>

interface InboxPageProps {
  ctx: InboxCtx
  search: InboxSearchParams
  onNavigate: (opts: {
    to: '.'
    search: (prev: InboxSearchParams) => Partial<InboxSearchParams>
  }) => void
}

export function InboxPage({ ctx, search, onNavigate }: InboxPageProps) {
  const orgId = ctx.activeOrganization?.id
  const { itemId: _, ...rest } = search
  const filters = rest as InboxFilterValues
  const setFilters = useCallback(
    (next: InboxFilterValues) =>
      onNavigate({ to: '.', search: (prev) => ({ ...prev, ...next }) }),
    [onNavigate],
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

  const selectedItem = search.itemId
    ? (items.find((i) => i.id === search.itemId) ?? null)
    : null

  const [isMobile, setIsMobile] = useState(false)
  useEffect(() => {
    const mql = window.matchMedia('(max-width: 767px)')
    setIsMobile(mql.matches)
    const h = (e: MediaQueryListEvent) => setIsMobile(e.matches)
    mql.addEventListener('change', h)
    return () => mql.removeEventListener('change', h)
  }, [])

  const detailState = useInboxDetail(selectedItem, !!selectedItem, { autoMarkRead: true })
  useEffect(() => {
    if (detailState.lastMarkedId)
      setItems((p) =>
        p.map((i) =>
          i.id === detailState.lastMarkedId
            ? { ...i, status: 'read' as const, readAt: new Date() }
            : i,
        ),
      )
  }, [detailState.lastMarkedId])

  // Sync list item status when user changes status in detail panel
  useEffect(() => {
    if (detailState.statusVersion > 0 && detailState.currentItem) {
      const updated = detailState.currentItem
      setItems((p) =>
        p.map((i) =>
          i.id === updated.id
            ? { ...i, status: updated.status, updatedAt: updated.updatedAt }
            : i,
        ),
      )
    }
  }, [detailState.statusVersion, detailState.currentItem])

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
    <div className="flex h-[calc(100vh-4rem)]">
      <div
        className={`flex-1 overflow-y-auto border-r ${selectedItem ? 'hidden md:flex md:flex-col' : 'flex flex-col'}`}
      >
        <InboxListPanel
          filters={filters}
          items={items}
          selectedIds={selectedIds}
          isLoading={isLoading}
          isPending={loadAction.isPending}
          nextCursor={nextCursor}
          onFiltersChange={setFilters}
          onToggleSelect={(id) =>
            setSelectedIds((p) =>
              p.includes(id) ? p.filter((i) => i !== id) : [...p, id],
            )
          }
          onSelectAll={() => setSelectedIds(items.map((i) => i.id))}
          onDeselectAll={() => setSelectedIds([])}
          onRowClick={handleRowClick}
          onLoadMore={loadItems}
          onBulkDone={handleBulkDone}
        />
      </div>
      {selectedItem && (
        <InboxDetailPanel
          selectedItem={selectedItem}
          detailState={detailState}
          onClose={closeDetail}
        />
      )}
      <InboxDetailSheet
        open={isMobile && !!selectedItem}
        onOpenChange={(o) => {
          if (!o) closeDetail()
        }}
        item={selectedItem}
        detailState={detailState}
      />
    </div>
  )
}
