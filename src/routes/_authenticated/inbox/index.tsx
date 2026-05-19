// Inbox list page — top-level route for viewing all inbox items
import { createFileRoute, getRouteApi } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { useAction } from '#/components/hooks/use-action'
import type { AuthRouteContext } from '#/routes/_authenticated'
import { getInboxItemsFn } from '#/contexts/inbox/server/inbox'
import { Badge } from '#/components/ui/badge'
import { EmptyState } from '#/components/ui/empty-state'
import { Skeleton } from '#/components/ui/skeleton'
import { InboxList } from '#/components/inbox/inbox-list'
import { InboxFilters } from '#/components/inbox/inbox-filters'
import type { InboxFilterValues } from '#/components/inbox/inbox-filters'
import { InboxBulkActions } from '#/components/inbox/inbox-bulk-actions'
import { Inbox } from 'lucide-react'
import { useState, useEffect, useCallback, useRef } from 'react'
import type { InboxItem } from '#/contexts/inbox/application/public-api'

const authRoute = getRouteApi('/_authenticated')

export const Route = createFileRoute('/_authenticated/inbox/')({
  staleTime: 30_000,
  component: InboxPage,
})

function InboxPage() {
  const ctx = authRoute.useRouteContext() as AuthRouteContext
  const orgId = ctx.activeOrganization?.id

  const [filters, setFilters] = useState<InboxFilterValues>({
    status: undefined,
    sourceType: undefined,
    platform: undefined,
    ratingMin: undefined,
    ratingMax: undefined,
  })

  const [selectedIds, setSelectedIds] = useState<ReadonlyArray<string>>([])
  const [items, setItems] = useState<ReadonlyArray<InboxItem>>([])
  const [isLoading, setIsLoading] = useState(true)

  const loadAction = useAction(useServerFn(getInboxItemsFn))
  const abortRef = useRef(false)

  const loadItems = useCallback(async () => {
    if (!orgId) return
    abortRef.current = false
    setIsLoading(true)
    try {
      const result = await loadAction({
        data: {
          status: filters.status,
          sourceType: filters.sourceType,
          platform: filters.platform,
          ratingMin: filters.ratingMin,
          ratingMax: filters.ratingMax,
          limit: 50,
        },
      })
      if (!abortRef.current) {
        setItems(result.items ?? [])
      }
    } catch {
      // Error is stored on loadAction.error — UI can access it there
    } finally {
      if (!abortRef.current) {
        setIsLoading(false)
      }
    }
  }, [
    orgId,
    filters.status,
    filters.sourceType,
    filters.platform,
    filters.ratingMin,
    filters.ratingMax,
  ])

  useEffect(() => {
    loadItems()
    return () => {
      abortRef.current = true
    }
  }, [loadItems])

  // Clear selection when filters change
  useEffect(() => {
    setSelectedIds([])
  }, [filters])

  const handleToggleSelect = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id],
    )
  }

  const handleSelectAll = () => {
    setSelectedIds(items.map((i) => i.id))
  }

  const handleDeselectAll = () => {
    setSelectedIds([])
  }

  const handleRowClick = (_item: InboxItem) => {
    // TODO: Navigate to detail page or open sheet when detail route is implemented
  }

  const newCount = items.filter((i) => i.status === 'new').length

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

  return (
    <div className="mx-auto max-w-5xl space-y-6">
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
      <InboxBulkActions
        selectedIds={selectedIds}
        onDone={() => {
          setSelectedIds([])
          void loadItems()
        }}
      />

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
        <InboxList
          items={items}
          selectedIds={selectedIds}
          onToggleSelect={handleToggleSelect}
          onSelectAll={handleSelectAll}
          onDeselectAll={handleDeselectAll}
          onRowClick={handleRowClick}
        />
      )}
    </div>
  )
}
