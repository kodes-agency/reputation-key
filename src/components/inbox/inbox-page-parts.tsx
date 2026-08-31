// Inbox page parts — presentational sub-components split from
// inbox-page-v2.tsx for line-count compliance.

import type { InboxItem } from '#/contexts/inbox/application/public-api'
import type { InboxDetailState } from './use-inbox-detail'
import type { InboxDetailFns } from './types'
import { InboxDetailPanel } from '#/components/inbox/inbox-detail-panel'
import { InboxDetailSheet } from '#/components/inbox/inbox-detail-sheet'
import { PageShell } from '#/components/layout/page-shell'
import { PageHeader } from '#/components/layout/page-header'
import { Panel, Separator, type LayoutStorage } from 'react-resizable-panels'
import { Inbox } from 'lucide-react'

/**
 * Stable Panel ids for the desktop inbox layout.
 *
 * `useDefaultLayout` persists a `{ [panelId]: size }` map, so these ids are
 * part of the saved-layout contract: renaming one orphans stored layouts.
 * Without them the panels fall back to `useId`, which is not stable across
 * releases.
 */
export const INBOX_PANEL_IDS = {
  sidebar: 'inbox-sidebar',
  list: 'inbox-list',
  detail: 'inbox-detail',
} as const

/**
 * v4 renders a Panel as an outer flex box (`overflow: visible`) wrapping an
 * inner content div that it hard-codes to `overflow: auto`. `className` lands
 * on that inner div, so a Tailwind `overflow-hidden` class loses to the inline
 * style. Passing overflow through `style` is the only way to keep the clipping
 * v2 gave us (v2's single panel div had inline `overflow: hidden`).
 */
export const CLIP_PANEL_CONTENT = { overflow: 'hidden' } as const

/** SSR-safe persistence adapter for the resizable Inbox layout. */
export const inboxLayoutStorage: LayoutStorage = {
  getItem: (key) =>
    typeof window === 'undefined' ? null : window.localStorage.getItem(key),
  setItem: (key, value) => {
    if (typeof window !== 'undefined') window.localStorage.setItem(key, value)
  },
}

export const ResizeHandle = () => (
  <Separator className="w-1.5 bg-border/50 hover:bg-primary/30 active:bg-primary/50 transition-colors" />
)

const FOLDER_LABELS: Record<string, string> = {
  open: 'Open reviews',
  escalated: 'Escalated reviews',
  closed: 'Closed reviews',
}

export const folderLabelFor = (folder: string | undefined): string =>
  FOLDER_LABELS[folder ?? 'open'] ?? 'Open reviews'

export function InboxNoOrgState() {
  return (
    <PageShell>
      <PageHeader
        title="Inbox"
        description="Select an organization to view your inbox."
      />
    </PageShell>
  )
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

type InboxDetailPaneProps = Readonly<{
  selectedItem: InboxItem | null
  detailState: InboxDetailState
  isMobile: boolean
  onClose: () => void
  detailFns: InboxDetailFns
  currentUserId?: string
}>

export function InboxDetailPane({
  selectedItem,
  detailState,
  isMobile,
  onClose,
  detailFns,
  currentUserId,
}: InboxDetailPaneProps) {
  return (
    <>
      <Panel
        id={INBOX_PANEL_IDS.detail}
        defaultSize="50%"
        minSize="30%"
        style={CLIP_PANEL_CONTENT}
      >
        {selectedItem ? (
          <InboxDetailPanel
            selectedItem={selectedItem}
            detailState={detailState}
            onClose={onClose}
            detailFns={detailFns}
            currentUserId={currentUserId}
          />
        ) : (
          <EmptyDetailPlaceholder />
        )}
      </Panel>
      <InboxDetailSheet
        open={isMobile && !!selectedItem}
        onOpenChange={(o) => {
          if (!o) onClose()
        }}
        item={selectedItem}
        detailState={detailState}
        detailFns={detailFns}
        currentUserId={currentUserId}
      />
    </>
  )
}
