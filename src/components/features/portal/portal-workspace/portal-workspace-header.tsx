// The workspace header. One row: the way back, the portal's name with a single
// quiet status line, and — only where they apply — what is waiting to go live
// and the way to publish it. Status is deliberately not a panel (round-4 owner
// decision): a portal that needs nothing shows only its name and its state.
//
// In review mode the row is the same but the way back reads "Back to editing"
// and the publish actions and "Open page" are absent, because the page below is
// the publish step.
//
// On a phone the row becomes two: the way back (an arrow), the name and
// "Review & publish" first, then the save line, what is waiting and "Open page";
// the Property's name is left out there. Flex `order` lifts the button onto the
// first row; the document keeps the wider order (what is waiting, then the
// button), which is the order the Tab key and a screen reader follow.

import { Link } from '@tanstack/react-router'
import { PAGE_GUTTER_X } from '#/components/layout/page-shell'
import { BackLink } from '#/components/ui/back-link'
import { Button } from '#/components/ui/button'
import { cn } from '#/lib/utils'
import type { ReactNode } from 'react'
import type { PortalDetailTab } from '../portal-detail/portal-detail-rules'
import type { PortalEditorSection } from '../portal-editor/portal-editor-sections'

export type PortalWorkspaceHeaderProps = Readonly<{
  propertyId: string
  portalId: string
  portalName: string
  propertyName: string
  /** From `describePortalStatus`. */
  statusLine: string
  /** From `describePendingChanges`; null when nothing is waiting. */
  pendingNote: string | null
  /** Whether "Review & publish" is offered (`canReviewAndPublish`). */
  canReview: boolean
  mode: 'edit' | 'review'
  /**
   * The tab being edited. The review links carry it as `?tab=`, so "Back to
   * editing" returns to it.
   */
  activeTab: PortalDetailTab
  /** The Page tab's section; carried the same way, so review returns to it. */
  activeSection?: PortalEditorSection
  /**
   * The autosave line ("Saving…", "Draft saved"). A slot, so the header stays
   * presentational and the layout supplies the one that reads the coordinator.
   */
  saveStatus?: ReactNode
  /**
   * "Open page" (`PortalOpenPageControl`), a slot like `saveStatus`. It sits
   * after the save status and the pending note, right before "Review & publish".
   * Absent in review mode, where the header is a focused step.
   */
  openPage?: ReactNode
}>

export function PortalWorkspaceHeader(props: PortalWorkspaceHeaderProps) {
  const { propertyId, portalId, portalName, propertyName, statusLine, mode } = props
  const reviewing = mode === 'review'
  return (
    <header
      className={cn(
        'flex flex-wrap items-center gap-x-3 gap-y-1 border-b py-2 sm:gap-x-4 sm:gap-y-2 sm:py-3',
        PAGE_GUTTER_X,
      )}
    >
      {reviewing ? (
        <BackLink
          to="/properties/$propertyId/portals/$portalId"
          params={{ propertyId, portalId }}
          search={{ tab: props.activeTab, section: props.activeSection }}
          label="Back to editing"
          flush
        />
      ) : (
        <BackLink
          to="/properties/$propertyId/portals"
          params={{ propertyId }}
          label="Back to portals"
          iconBelow="sm"
          flush
        />
      )}
      {/* In review the way back keeps its words ("Back to editing" is the only
          way back on a phone), so the title takes a row of its own there. */}
      <div
        className={cn(
          'min-w-0 flex-1 border-l pl-3 sm:basis-56 sm:pl-4',
          reviewing ? 'basis-56' : 'basis-0',
        )}
      >
        <div className="flex flex-wrap items-baseline gap-x-2">
          <h1 className="truncate text-base font-semibold tracking-tight">
            {reviewing ? `Review changes to ${portalName}` : portalName}
          </h1>
          <p className="text-xs text-muted-foreground">
            <span aria-hidden>• </span>
            {statusLine}
          </p>
        </div>
        <p className="hidden truncate text-xs text-muted-foreground sm:block">
          {propertyName}
        </p>
      </div>
      {reviewing ? null : <ReviewActions {...props} />}
    </header>
  )
}

function ReviewActions({
  propertyId,
  portalId,
  pendingNote,
  canReview,
  activeTab,
  activeSection,
  saveStatus,
  openPage,
}: PortalWorkspaceHeaderProps) {
  const reviewSearch = { tab: activeTab, section: activeSection }
  return (
    <>
      <div className="order-last flex basis-full flex-wrap items-center gap-x-3 gap-y-1 sm:order-none sm:basis-auto">
        {saveStatus}
        {pendingNote === null ? null : canReview ? (
          <Link
            to="/properties/$propertyId/portals/$portalId/review"
            params={{ propertyId, portalId }}
            search={reviewSearch}
            className="text-sm text-muted-foreground underline decoration-dotted underline-offset-4 hover:text-foreground"
          >
            {pendingNote}
          </Link>
        ) : (
          <p className="text-sm text-muted-foreground">{pendingNote}</p>
        )}
        {openPage}
      </div>
      {canReview ? (
        <Button asChild>
          <Link
            to="/properties/$propertyId/portals/$portalId/review"
            params={{ propertyId, portalId }}
            search={reviewSearch}
          >
            Review &amp; publish
          </Link>
        </Button>
      ) : null}
    </>
  )
}
