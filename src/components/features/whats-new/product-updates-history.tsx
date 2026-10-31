import type { ProductUpdatesClientGetter } from '#/shared/whats-new/types'
import { useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Sparkles } from 'lucide-react'
import { usePropertyId } from '#/components/hooks/use-property-id'
import { PageHeader } from '#/components/layout/page-header'
import { PageShell } from '#/components/layout/page-shell'
import { SectionTitle } from '#/components/ui/section-title'
import { EmptyState } from '#/components/ui/empty-state'
import { RegionError } from '#/components/ui/region-error'
import { hasFailed, isRetrying } from '#/components/hooks/is-retrying'
import { formatMonthYear } from '#/lib/format'
import { productUpdatesQuery } from './queries'
import type { ProductUpdate } from '#/shared/whats-new/types'
import { updatesByMonth } from './selection'
import { UpdateEntry } from './update-entry'
import { useMarkProductUpdatesSeen } from './use-product-update-actions'

export function ProductUpdatesHistoryContent({
  entries,
  propertyId,
}: Readonly<{ entries: readonly ProductUpdate[]; propertyId: string | null }>) {
  if (!entries.length)
    return <EmptyState icon={Sparkles} title="Updates will appear here" />
  return (
    <div className="space-y-10">
      {updatesByMonth(entries).map(([month, updates]) => (
        <section key={month} aria-labelledby={`updates-${month}`} className="space-y-6">
          <SectionTitle id={`updates-${month}`}>
            {formatMonthYear(`${month}-01`)}
          </SectionTitle>
          {updates.map((entry) => (
            <UpdateEntry key={entry.id} entry={entry} propertyId={propertyId} />
          ))}
        </section>
      ))}
    </div>
  )
}

function useMarkHistorySeen(
  unseenIds: readonly string[],
  markSeen: (ids: readonly string[]) => Promise<void>,
) {
  const attempted = useRef('')
  useEffect(() => {
    if (!unseenIds.length) return
    const key = unseenIds.join(',')
    if (attempted.current === key) return
    attempted.current = key
    void markSeen(unseenIds).catch(() => undefined)
  }, [unseenIds, markSeen])
}

export function ProductUpdatesHistory({
  getClient,
}: Readonly<{ getClient: ProductUpdatesClientGetter }>) {
  const propertyId = usePropertyId()
  const query = useQuery(productUpdatesQuery(propertyId, getClient))
  const markSeen = useMarkProductUpdatesSeen(propertyId, getClient)
  useMarkHistorySeen(query.data?.unseenIds ?? [], markSeen)
  return (
    <PageShell tier="narrow">
      <PageHeader
        title="What's new"
        description="Improvements and fixes for your day with RepKey."
      />
      {hasFailed(query) ? (
        <RegionError
          message="Updates couldn’t be loaded."
          onRetry={() => void query.refetch()}
          retrying={isRetrying(query)}
        />
      ) : query.data ? (
        <ProductUpdatesHistoryContent
          entries={query.data.entries}
          propertyId={propertyId}
        />
      ) : (
        <p role="status" className="text-sm text-muted-foreground">
          Loading updates…
        </p>
      )}
    </PageShell>
  )
}
