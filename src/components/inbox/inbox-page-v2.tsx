// Inbox page v2 — three-panel email-style layout with resizable panels.
// Sidebar (folder nav) | List (review previews) | Detail (full review).
import type { InboxCtx } from './inbox-types'
import { InboxListPanel } from '#/components/inbox/inbox-list-panel-v2'
import { InboxDetailPanel } from '#/components/inbox/inbox-detail-panel'
import { InboxDetailSheet } from '#/components/inbox/inbox-detail-sheet'
import { InboxSidebar } from '#/components/layout/inbox-sidebar'
import { useInboxPage, type InboxPageNav } from './use-inbox-page'
import { bulkUpdateInboxStatusFn } from '#/contexts/inbox/server/inbox'
import { useRef } from 'react'
import { PageShell } from '#/components/layout/page-shell'
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import { Inbox } from 'lucide-react'
import type { InboxSearchParams } from './inbox-search-schema'

export { inboxSearchSchema, type InboxSearchParams } from './inbox-search-schema'

const ResizeHandle = () => (
  <PanelResizeHandle className="w-1.5 bg-border/50 hover:bg-primary/30 active:bg-primary/50 transition-colors" />
)

const FOLDER_LABELS: Record<string, string> = {
  escalated: 'Escalated',
  addressed: 'Addressed',
  archived: 'Archived',
}

function EmptyDetailPlaceholder() {
  return (
    <div className="flex h-full flex-col border-l items-center justify-center gap-4 px-8">
      <div className="rounded-full bg-accent-muted/20 p-4">
        <Inbox className="size-14 opacity-30 text-accent" />
      </div>
      <p className="text-base font-semibold text-foreground">No message selected</p>
      <p className="text-sm text-muted-foreground/70">
        Select a review from the list to view details
      </p>
    </div>
  )
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
  onNavigate: InboxPageNav
  bulkUpdateFn: typeof bulkUpdateInboxStatusFn
}) {
  const orgId = ctx.activeOrganization?.id
  const s = useInboxPage(orgId, search, onNavigate)
  const listRef = useRef<HTMLDivElement>(null)
  const folderLabel = FOLDER_LABELS[s.folder ?? ''] ?? 'Inbox'

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
          newCount={s.newCount}
          showTabs={s.folder === undefined}
          activeTab={s.tab}
          searchQ={search.q}
          items={s.items}
          selectedIds={s.selectedIds}
          isLoading={s.isLoading}
          error={s.error}
          onRetry={s.loadItems}
          nextCursor={s.nextCursor}
          loadAction={s.loadAction}
          listRef={listRef}
          onTabChange={(t) => onNavigate({ to: '.', search: (p) => ({ ...p, tab: t }) })}
          onSearchChange={(q) =>
            onNavigate({ to: '.', search: (p) => ({ ...p, q, itemId: undefined }) })
          }
          onToggleSelect={s.handleToggleSelect}
          onSelectAll={s.handleSelectAll}
          onDeselectAll={s.handleDeselectAll}
          onRowClick={s.handleRowClick}
          onLoadMore={s.loadItems}
          onBulkDone={s.handleBulkDone}
          bulkUpdateFn={bulkUpdateFn}
        />
      </Panel>
      <ResizeHandle />
      <Panel defaultSize={50} minSize={30} className="overflow-hidden">
        {s.selectedItem ? (
          <InboxDetailPanel
            selectedItem={s.selectedItem}
            detailState={s.detailState}
            onClose={s.closeDetail}
          />
        ) : (
          <EmptyDetailPlaceholder />
        )}
      </Panel>
      <InboxDetailSheet
        open={s.isMobile && !!s.selectedItem}
        onOpenChange={(o) => {
          if (!o) s.closeDetail()
        }}
        item={s.selectedItem}
        detailState={s.detailState}
      />
    </PanelGroup>
  )
}
