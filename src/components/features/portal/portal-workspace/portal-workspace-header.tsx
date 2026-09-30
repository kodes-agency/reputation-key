// The workspace header. One row: the way back, the portal's name with a single
// quiet status line, and — only where they apply — what is waiting to go live
// and the way to publish it. Status is deliberately not a panel (round-4 owner
// decision): a portal that needs nothing shows only its name and its state.
//
// In review mode the row is the same but the way back reads "Back to editing"
// and the publish actions are absent, because the page below is the publish step.

import { Link } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import { Button } from '#/components/ui/button'
import type { PortalDetailTab } from '../portal-detail/portal-detail-rules'

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
}>

export function PortalWorkspaceHeader(props: PortalWorkspaceHeaderProps) {
  const { propertyId, portalId, portalName, propertyName, statusLine, mode } = props
  const reviewing = mode === 'review'
  return (
    <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-4 py-3 md:px-6">
      {reviewing ? (
        <Button variant="ghost" size="sm" asChild className="-ml-2 min-h-11 sm:min-h-8">
          <Link
            to="/properties/$propertyId/portals/$portalId"
            params={{ propertyId, portalId }}
            search={{ tab: props.activeTab }}
          >
            <ArrowLeft aria-hidden /> Back to editing
          </Link>
        </Button>
      ) : (
        <Button variant="ghost" size="sm" asChild className="-ml-2 min-h-11 sm:min-h-8">
          <Link to="/properties/$propertyId/portals" params={{ propertyId }}>
            <ArrowLeft aria-hidden /> Portals
          </Link>
        </Button>
      )}
      <div className="min-w-0 flex-1 basis-56 border-l pl-4">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <h1 className="truncate text-base font-semibold tracking-tight">
            {reviewing ? `Review changes to ${portalName}` : portalName}
          </h1>
          <p className="text-xs text-muted-foreground">
            <span aria-hidden>• </span>
            {statusLine}
          </p>
        </div>
        <p className="truncate text-xs text-muted-foreground">{propertyName}</p>
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
}: PortalWorkspaceHeaderProps) {
  if (!canReview) {
    return pendingNote === null ? null : (
      <p className="text-sm text-muted-foreground">{pendingNote}</p>
    )
  }
  return (
    <div className="flex flex-wrap items-center gap-3">
      {pendingNote === null ? null : (
        <Link
          to="/properties/$propertyId/portals/$portalId/review"
          params={{ propertyId, portalId }}
          search={{ tab: activeTab }}
          className="text-sm text-muted-foreground underline decoration-dotted underline-offset-4 hover:text-foreground"
        >
          {pendingNote}
        </Link>
      )}
      <Button asChild className="min-h-11 sm:min-h-9">
        <Link
          to="/properties/$propertyId/portals/$portalId/review"
          params={{ propertyId, portalId }}
          search={{ tab: activeTab }}
        >
          Review &amp; publish
        </Link>
      </Button>
    </div>
  )
}
