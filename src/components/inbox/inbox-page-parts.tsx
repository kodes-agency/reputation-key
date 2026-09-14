// Inbox page parts — presentational sub-components split from
// inbox-page-v2.tsx for line-count compliance.

import type { InboxItem } from '#/contexts/inbox/application/public-api'
import type { ComposerFocusBox } from './inbox-detail-content'
import type { InboxAssignmentOption } from './inbox-owner-view'
import type { InboxCurrentUser } from './inbox-case-toolbar-props'
import type { InboxDetailState } from './use-inbox-detail'
import type { InboxDetailFns } from './types'
import { InboxDetailPanel } from '#/components/inbox/inbox-detail-panel'
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

/**
 * Persistence adapter for the resizable Inbox layout.
 *
 * `useDefaultLayout` reads it through `useSyncExternalStore` with the SAME
 * getter as the server snapshot, so during hydration a saved layout in
 * localStorage is rendered against server HTML that had none: React logs the
 * attribute mismatch on the sidebar Panel and keeps the server flex-grow, and
 * the saved layout never applies. The page hands this adapter over only once
 * hydrated (`useHydrated`); until then `HYDRATING_LAYOUT_STORAGE` reads
 * nothing, matching the server exactly.
 */
export const inboxLayoutStorage: LayoutStorage = {
  getItem: (key) => window.localStorage.getItem(key),
  setItem: (key, value) => {
    window.localStorage.setItem(key, value)
  },
}

export const HYDRATING_LAYOUT_STORAGE: LayoutStorage = {
  getItem: () => null,
  setItem: () => undefined,
}

export const ResizeHandle = () => (
  <Separator className="w-1.5 bg-border/50 hover:bg-primary/30 active:bg-primary/50 transition-colors" />
)

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
  onClose: () => void
  detailFns: InboxDetailFns
  currentUser?: InboxCurrentUser
  assignmentOptions?: ReadonlyArray<InboxAssignmentOption>
  /** Where the pane's composer publishes its focus for `r` / `n`. */
  composerFocusRef?: ComposerFocusBox
}>

/**
 * The third Panel of the DESKTOP layout, and only that.
 *
 * `InboxPageV2` returns its mobile branch before it ever reaches the `Group`
 * this lives in, so every render of this component is a render at `md` and
 * above. It used to mount an `InboxDetailSheet` beside the Panel, keyed
 * `open={isMobile && !!selectedItem}`; `isMobile` is false by construction on
 * this branch, so that sheet had been permanently closed — Radix renders no
 * portal and no children for a closed dialog, so it had never put a node in the
 * document either. Its cost was that it made "the sheet" ambiguous: an edit to
 * the mobile surface could land on the copy that is never open and appear to do
 * nothing. PR 6 deleted it; the live one is mounted by `InboxPageV2` directly.
 *
 * `isMobile` went with it rather than staying as an unread prop — the one
 * sentence that keeps this honest is that the mobile branch never gets here.
 */
export function InboxDetailPane({
  selectedItem,
  detailState,
  onClose,
  detailFns,
  currentUser,
  assignmentOptions,
  composerFocusRef,
}: InboxDetailPaneProps) {
  return (
    <Panel id={INBOX_PANEL_IDS.detail} minSize={480} style={CLIP_PANEL_CONTENT}>
      {selectedItem ? (
        <InboxDetailPanel
          selectedItem={selectedItem}
          detailState={detailState}
          onClose={onClose}
          detailFns={detailFns}
          currentUser={currentUser}
          assignmentOptions={assignmentOptions}
          composerFocusRef={composerFocusRef}
        />
      ) : (
        <EmptyDetailPlaceholder />
      )}
    </Panel>
  )
}
