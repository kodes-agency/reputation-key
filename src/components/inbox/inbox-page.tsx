// Inbox page — email split layout with unified list + detail panel
import { z } from 'zod/v4'
import { useServerFn } from '@tanstack/react-start'
import { useAction } from '#/components/hooks/use-action'
import type { InboxCtx } from './inbox-types'
import { getInboxItemsFn } from '#/contexts/inbox/server/inbox'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import { EmptyState } from '#/components/ui/empty-state'
import { Skeleton } from '#/components/ui/skeleton'
import { InboxList } from '#/components/inbox/inbox-list'
import { InboxFilters } from '#/components/inbox/inbox-filters'
import type { InboxFilterValues } from '#/components/inbox/inbox-filters'
import { InboxBulkActions } from '#/components/inbox/inbox-bulk-actions'
import { InboxDetailSheet } from '#/components/inbox/inbox-detail-sheet'
import { InboxDetailPanel } from '#/components/inbox/inbox-detail-panel'
import { useInboxDetail } from '#/components/inbox/use-inbox-detail'
import { Loader2, Inbox } from 'lucide-react'
import { useState, useEffect, useCallback, useRef } from 'react'
import type { InboxItem, Cursor } from '#/contexts/inbox/application/public-api'

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
  const filters: InboxFilterValues = {
    propertyId: search.propertyId,
    status: search.status,
    sourceType: search.sourceType,
    platform: search.platform,
    ratingMin: search.ratingMin,
    ratingMax: search.ratingMax,
  }

  const setFilters = useCallback(
    (next: InboxFilterValues) =>
      onNavigate({
        to: '.',
        search: (prev: InboxSearchParams) => ({ ...prev, ...next }),
      }),
    [onNavigate],
  )

  const selectedId = search.itemId
  const [items, setItems] = useState<ReadonlyArray<InboxItem>>([])
  const [nextCursor, setNextCursor] = useState<Cursor | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [selectedIds, setSelectedIds] = useState<ReadonlyArray<string>>([])

  const loadAction = useAction(useServerFn(getInboxItemsFn))
  const abortRef = useRef(false)
  const loadActionRef = useRef(loadAction)
  loadActionRef.current = loadAction

  const selectedItem = selectedId
    ? (items.find((i) => i.id === selectedId) ?? null)
    : null

  const [isMobile, setIsMobile] = useState(false)
  useEffect(() => {
    const mql = window.matchMedia('(max-width: 767px)')
    setIsMobile(mql.matches)
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches)
    mql.addEventListener('change', handler)
    return () => mql.removeEventListener('change', handler)
  }, [])

  const loadItems = useCallback(
    async (cursor?: Cursor) => {
      if (!orgId) return
      abortRef.current = false
      if (!cursor) setIsLoading(true)
      try {
        const result = await loadActionRef.current({
          data: {
            ...filters,
            cursor: cursor ? btoa(JSON.stringify(cursor)) : undefined,
            limit: INBOX_PAGE_SIZE,
          },
        })
        if (!abortRef.current) {
          const newItems = result.items ?? []
          if (cursor) setItems((prev) => [...prev, ...newItems])
          else setItems(newItems)
          setNextCursor(result.nextCursor ?? null)
        }
      } catch {
        /* error on loadAction */
      } finally {
        if (!abortRef.current) setIsLoading(false)
      }
    },
    [
      orgId,
      filters.propertyId,
      filters.status,
      filters.sourceType,
      filters.platform,
      filters.ratingMin,
      filters.ratingMax,
    ],
  )

  useEffect(() => {
    loadItems()
    return () => {
      abortRef.current = true
    }
  }, [loadItems])
  useEffect(() => {
    setSelectedIds([])
  }, [
    filters.status,
    filters.sourceType,
    filters.platform,
    filters.ratingMin,
    filters.ratingMax,
    filters.propertyId,
  ])

  useEffect(() => {
    if (
      selectedId &&
      !isLoading &&
      items.length > 0 &&
      !items.some((i) => i.id === selectedId)
    )
      onNavigate({
        to: '.',
        search: (prev: InboxSearchParams) => ({ ...prev, itemId: undefined }),
      })
  }, [selectedId, items, isLoading, onNavigate])

  const handleRowClick = useCallback(
    (item: InboxItem) =>
      onNavigate({
        to: '.',
        search: (prev: InboxSearchParams) => ({ ...prev, itemId: item.id }),
      }),
    [onNavigate],
  )
  const closeDetail = useCallback(
    () =>
      onNavigate({
        to: '.',
        search: (prev: InboxSearchParams) => ({ ...prev, itemId: undefined }),
      }),
    [onNavigate],
  )
  const handleBulkDone = () => {
    setSelectedIds([])
    void loadItems()
    if (selectedId) closeDetail()
  }

  const newCount = items.filter((i) => i.status === 'new').length
  const detailState = useInboxDetail(selectedItem, !!selectedItem, { autoMarkRead: true })

  useEffect(() => {
    if (detailState.lastMarkedId)
      setItems((prev) =>
        prev.map((i) =>
          i.id === detailState.lastMarkedId
            ? { ...i, status: 'read' as const, readAt: new Date() }
            : i,
        ),
      )
  }, [detailState.lastMarkedId])

  if (!orgId)
    return (
      <div className="mx-auto max-w-4xl space-y-8">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Inbox</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Select an organization to view your inbox.
          </p>
        </div>
      </div>
    )

  return (
    <div className="flex h-[calc(100vh-4rem)]">
      <div
        className={`flex-1 overflow-y-auto border-r ${selectedItem ? 'hidden md:flex md:flex-col' : 'flex flex-col'}`}
      >
        <div className="space-y-4 p-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-semibold tracking-tight">Inbox</h1>
              {newCount > 0 && (
                <Badge variant="destructive" className="text-xs">
                  {newCount} new
                </Badge>
              )}
            </div>
          </div>
          <InboxFilters value={filters} onChange={setFilters} />
          <InboxBulkActions selectedIds={selectedIds} onDone={handleBulkDone} />
          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : items.length === 0 ? (
            <EmptyState icon={Inbox} title="No inbox items">
              <p className="text-sm text-muted-foreground">
                {filters.status || filters.sourceType || filters.platform
                  ? 'Try adjusting your filters.'
                  : 'New reviews and feedback will appear here.'}
              </p>
            </EmptyState>
          ) : (
            <>
              <InboxList
                items={items}
                selectedIds={selectedIds}
                onToggleSelect={(id) =>
                  setSelectedIds((p) =>
                    p.includes(id) ? p.filter((i) => i !== id) : [...p, id],
                  )
                }
                onSelectAll={() => setSelectedIds(items.map((i) => i.id))}
                onDeselectAll={() => setSelectedIds([])}
                onRowClick={handleRowClick}
              />
              {nextCursor && (
                <div className="flex justify-center py-4">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={loadAction.isPending}
                    onClick={() => loadItems(nextCursor)}
                  >
                    {loadAction.isPending && (
                      <Loader2 className="mr-2 size-4 animate-spin" />
                    )}
                    Load more
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
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
        onOpenChange={(open) => {
          if (!open) closeDetail()
        }}
        item={selectedItem}
        detailState={detailState}
      />
    </div>
  )
}
