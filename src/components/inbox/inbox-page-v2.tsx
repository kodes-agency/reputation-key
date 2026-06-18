// Inbox page v2 — three-panel email-style layout with resizable panels.
// Sidebar (folder nav) | List (review previews) | Detail (full review).
import type { InboxCtx } from './inbox-types'
import { InboxListPanel } from '#/components/inbox/inbox-list-panel-v2'
import { InboxSidebar } from '#/components/layout/inbox-sidebar'
import { useInboxPage, type InboxPageNav } from './use-inbox-page'
import { bulkUpdateInboxStatusFn } from '#/contexts/inbox/server/inbox'
import { useRef } from 'react'
import { Panel, PanelGroup } from 'react-resizable-panels'
import type { InboxSearchParams } from './inbox-search-schema'
import {
  ResizeHandle,
  folderLabelFor,
  InboxNoOrgState,
  InboxDetailPane,
} from './inbox-page-parts'

export { inboxSearchSchema, type InboxSearchParams } from './inbox-search-schema'

export function InboxPageV2({
  ctx,
  search,
  properties,
  onNavigate,
  bulkUpdateFn,
  onPropertyChange,
  activePropertyId,
}: {
  ctx: InboxCtx
  search: InboxSearchParams
  properties?: ReadonlyArray<{ id: string; name: string }>
  onNavigate: InboxPageNav
  bulkUpdateFn: typeof bulkUpdateInboxStatusFn
  /** Override for the property-switcher dropdown. */
  onPropertyChange?: (propertyId: string | undefined) => void
  /** Active property — from route param on /reviews, from search on /inbox. */
  activePropertyId?: string
}) {
  const orgId = ctx.activeOrganization?.id
  const effectivePropertyId = activePropertyId ?? search.propertyId
  const s = useInboxPage(
    orgId,
    { ...search, propertyId: effectivePropertyId },
    onNavigate,
  )
  const listRef = useRef<HTMLDivElement>(null)
  const folderLabel = folderLabelFor(s.folder)

  if (!orgId) return <InboxNoOrgState />

  const handlePropertyChange =
    onPropertyChange ??
    ((id: string | undefined) =>
      onNavigate({
        to: '.',
        search: (p) => ({ ...p, propertyId: id, itemId: undefined }),
      }))

  return (
    <PanelGroup direction="horizontal" autoSaveId="inbox-layout" className="h-full">
      <Panel defaultSize={20} minSize={15} maxSize={30} className="overflow-hidden">
        <InboxSidebar
          propertyId={effectivePropertyId}
          properties={properties}
          onPropertyChange={handlePropertyChange}
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
      <InboxDetailPane
        selectedItem={s.selectedItem}
        detailState={s.detailState}
        isMobile={s.isMobile}
        onClose={s.closeDetail}
      />
    </PanelGroup>
  )
}
