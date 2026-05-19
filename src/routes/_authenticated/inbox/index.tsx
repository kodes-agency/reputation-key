// Inbox page — email split layout with unified list + detail panel
import { createFileRoute, getRouteApi, useNavigate } from '@tanstack/react-router'
import { z } from 'zod/v4'
import { useServerFn } from '@tanstack/react-start'
import { useAction } from '#/components/hooks/use-action'
import { useMutationAction } from '#/components/hooks/use-mutation-action'
import type { AuthRouteContext } from '#/routes/_authenticated'
import { getInboxItemsFn, updateInboxStatusFn } from '#/contexts/inbox/server/inbox'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import { EmptyState } from '#/components/ui/empty-state'
import { Skeleton } from '#/components/ui/skeleton'
import { InboxList } from '#/components/inbox/inbox-list'
import { InboxFilters } from '#/components/inbox/inbox-filters'
import type { InboxFilterValues } from '#/components/inbox/inbox-filters'
import { InboxBulkActions } from '#/components/inbox/inbox-bulk-actions'
import { InboxDetailSheet } from '#/components/inbox/inbox-detail-sheet'
import { InboxDetailContent } from '#/components/inbox/inbox-detail-content'
import { useInboxDetail } from '#/components/inbox/use-inbox-detail'
import { getStatusActions } from '#/components/inbox/inbox-detail-helpers'
import { InboxStatusBadge } from '#/components/inbox/inbox-status-badge'
import { X, MessageSquare, Loader2, Inbox } from 'lucide-react'
import { useState, useEffect, useCallback, useRef } from 'react'
import type { InboxItem } from '#/contexts/inbox/application/public-api'
import type { Cursor } from '#/contexts/inbox/application/ports/inbox.repository'

const authRoute = getRouteApi('/_authenticated')

const inboxSearchSchema = z.object({
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

type InboxSearchParams = z.infer<typeof inboxSearchSchema>

export const Route = createFileRoute('/_authenticated/inbox/')({
  validateSearch: (search) => inboxSearchSchema.parse(search),
  staleTime: 30_000,
  component: InboxPage,
})

function InboxPage() {
  const ctx = authRoute.useRouteContext() as AuthRouteContext
  const orgId = ctx.activeOrganization?.id
  const search = Route.useSearch()
  const navigate = useNavigate()

  // Derive filters from URL search params
  const filters: InboxFilterValues = {
    propertyId: search.propertyId,
    status: search.status,
    sourceType: search.sourceType,
    platform: search.platform,
    ratingMin: search.ratingMin,
    ratingMax: search.ratingMax,
  }

  const setFilters = useCallback(
    (next: InboxFilterValues) => {
      navigate({
        to: '.',
        search: (prev: InboxSearchParams) => ({
          ...prev,
          propertyId: next.propertyId,
          status: next.status,
          sourceType: next.sourceType,
          platform: next.platform,
          ratingMin: next.ratingMin,
          ratingMax: next.ratingMax,
        }),
      })
    },
    [navigate],
  )

  // Selected item from URL
  const selectedId = search.itemId
  const [items, setItems] = useState<ReadonlyArray<InboxItem>>([])
  const [nextCursor, setNextCursor] = useState<Cursor | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [selectedIds, setSelectedIds] = useState<ReadonlyArray<string>>([])

  const loadAction = useAction(useServerFn(getInboxItemsFn))
  const abortRef = useRef(false)

  // Keep loadAction ref current
  const loadActionRef = useRef(loadAction)
  loadActionRef.current = loadAction

  const selectedItem = selectedId
    ? (items.find((i) => i.id === selectedId) ?? null)
    : null

  // Mobile detection for sheet rendering
  const [isMobile, setIsMobile] = useState(false)
  useEffect(() => {
    const mql = window.matchMedia('(max-width: 767px)')
    setIsMobile(mql.matches)
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches)
    mql.addEventListener('change', handler)
    return () => mql.removeEventListener('change', handler)
  }, [])

  // Load items
  const loadItems = useCallback(
    async (cursor?: Cursor) => {
      if (!orgId) return
      abortRef.current = false
      if (!cursor) setIsLoading(true)
      try {
        const result = await loadActionRef.current({
          data: {
            propertyId: filters.propertyId,
            status: filters.status,
            sourceType: filters.sourceType,
            platform: filters.platform,
            ratingMin: filters.ratingMin,
            ratingMax: filters.ratingMax,
            cursor: cursor ? btoa(JSON.stringify(cursor)) : undefined,
            limit: 50,
          },
        })
        if (!abortRef.current) {
          const newItems = result.items ?? []
          if (cursor) {
            setItems((prev) => [...prev, ...newItems])
          } else {
            setItems(newItems)
          }
          setNextCursor(result.nextCursor ?? null)
        }
      } catch {
        // Error is stored on loadAction.error
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

  // Reload on filter change
  useEffect(() => {
    loadItems()
    return () => {
      abortRef.current = true
    }
  }, [loadItems])

  // Clear selection when filters change
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

  // Close detail if selected item no longer in filtered results (after load completes)
  useEffect(() => {
    if (
      selectedId &&
      !isLoading &&
      items.length > 0 &&
      !items.some((i) => i.id === selectedId)
    ) {
      navigate({
        to: '.',
        search: (prev: InboxSearchParams) => ({ ...prev, itemId: undefined }),
      })
    }
  }, [selectedId, items, isLoading, navigate])

  // Auto-mark as read on selection (debounced 500ms)
  const markReadMutation = useMutationAction(updateInboxStatusFn, {
    onSuccess: () => {
      setItems((prev) =>
        prev.map((i) =>
          i.id === selectedId ? { ...i, status: 'read' as const, readAt: new Date() } : i,
        ),
      )
    },
  })
  const markReadRef = useRef(markReadMutation)
  markReadRef.current = markReadMutation

  const lastMarkedRef = useRef<string | null>(null)
  useEffect(() => {
    if (!selectedId || lastMarkedRef.current === selectedId) return
    const item = items.find((i) => i.id === selectedId)
    if (!item || item.status !== 'new') return

    const timer = setTimeout(() => {
      lastMarkedRef.current = selectedId
      markReadRef.current({ data: { inboxItemId: selectedId, status: 'read' } })
    }, 500)
    return () => clearTimeout(timer)
  }, [selectedId, items])

  // Row click — set selected item in URL
  const handleRowClick = useCallback(
    (item: InboxItem) => {
      navigate({
        to: '.',
        search: (prev: InboxSearchParams) => ({ ...prev, itemId: item.id }),
      })
    },
    [navigate],
  )

  // Close detail panel
  const closeDetail = useCallback(() => {
    navigate({
      to: '.',
      search: (prev: InboxSearchParams) => ({ ...prev, itemId: undefined }),
    })
  }, [navigate])

  const handleToggleSelect = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id],
    )
  }

  const handleSelectAll = () => setSelectedIds(items.map((i) => i.id))
  const handleDeselectAll = () => setSelectedIds([])

  const handleBulkDone = () => {
    setSelectedIds([])
    void loadItems()
    if (selectedId) closeDetail()
  }

  const newCount = items.filter((i) => i.status === 'new').length

  // Single detail hook instance — shared by desktop panel and mobile sheet
  const detailState = useInboxDetail(selectedItem, !!selectedItem)

  if (!orgId) {
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
  }

  const currentItem = detailState.currentItem ?? selectedItem
  const statusActions = currentItem ? getStatusActions(currentItem.status) : []

  return (
    <div className="flex h-[calc(100vh-4rem)]">
      {/* List panel */}
      <div
        className={`flex-1 overflow-y-auto border-r ${
          selectedItem ? 'hidden md:flex md:flex-col' : 'flex flex-col'
        }`}
      >
        <div className="space-y-4 p-6">
          {/* Header */}
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

          {/* Filters */}
          <InboxFilters value={filters} onChange={setFilters} />

          {/* Bulk actions */}
          <InboxBulkActions selectedIds={selectedIds} onDone={handleBulkDone} />

          {/* Content */}
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
                  ? 'Try adjusting your filters to see more results.'
                  : 'New reviews and feedback will appear here as they come in.'}
              </p>
            </EmptyState>
          ) : (
            <>
              <InboxList
                items={items}
                selectedIds={selectedIds}
                onToggleSelect={handleToggleSelect}
                onSelectAll={handleSelectAll}
                onDeselectAll={handleDeselectAll}
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

      {/* Detail panel (desktop) */}
      {selectedItem && (
        <div className="hidden md:flex w-[480px] shrink-0 flex-col border-l">
          {/* Detail header */}
          <div className="flex items-center justify-between border-b px-4 py-3">
            <div className="flex items-center gap-2">
              <MessageSquare className="size-4 text-muted-foreground" />
              <span className="text-base font-medium">
                {currentItem?.sourceType === 'review' ? 'Review' : 'Feedback'} Detail
              </span>
              {currentItem && <InboxStatusBadge status={currentItem.status} />}
            </div>
            <Button variant="ghost" size="icon" className="size-8" onClick={closeDetail}>
              <X className="size-4" />
            </Button>
          </div>

          {/* Detail content */}
          <div className="flex-1 overflow-y-auto">
            {detailState.isLoading || !currentItem ? (
              <div className="space-y-4 p-4">
                <Skeleton className="h-6 w-3/4" />
                <Skeleton className="h-20 w-full" />
                <Skeleton className="h-4 w-1/2" />
              </div>
            ) : (
              <InboxDetailContent
                currentItem={currentItem}
                detail={detailState.detail}
                statusActions={statusActions}
                updateStatus={detailState.updateStatus}
                notes={detailState.notes}
                onNoteAdded={() => {
                  void detailState.refresh()
                }}
              />
            )}
          </div>
        </div>
      )}

      {/* Detail sheet (mobile only) */}
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
