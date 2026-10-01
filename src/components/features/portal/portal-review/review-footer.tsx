// The footer of the review page: which version this publishes as, what it does
// to printed codes, the way back, and the one publish button. It stays at the
// bottom of the column while the lists scroll. The button is the one the review
// read says the server will accept; when it cannot be used the footer says why.

import { Link } from '@tanstack/react-router'
import { QrCode } from 'lucide-react'
import { Button } from '#/components/ui/button'
import type { PortalDetailTab } from '../portal-detail/portal-detail-rules'
import type { PortalEditorSection } from '../portal-editor/portal-editor-sections'
import type { ReviewFooterView } from './portal-review-footer'

type Props = Readonly<{
  view: ReviewFooterView
  propertyId: string
  portalId: string
  /** The tab and section the manager came from, so "Back to editing" returns to them. */
  tab: PortalDetailTab
  section?: PortalEditorSection
  isPublishing: boolean
  onPublish: () => void
}>

export function ReviewFooter({
  view,
  propertyId,
  portalId,
  tab,
  section,
  isPublishing,
  onPublish,
}: Props) {
  return (
    <footer className="sticky bottom-0 border-t bg-background px-4 py-3 md:px-6">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border bg-card p-3">
        <div className="min-w-0 flex-1 basis-40 text-sm">
          {view.versionLine === null ? null : (
            <p className="font-medium">{view.versionLine}</p>
          )}
          {view.note === null ? null : (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <QrCode aria-hidden="true" className="size-3.5" />
              {view.note}
            </p>
          )}
          {view.hint === null ? null : (
            <p role="status" className="text-xs text-muted-foreground">
              {view.hint}
            </p>
          )}
        </div>
        <Button variant="outline" asChild className="min-h-11 sm:min-h-9">
          <Link
            to="/properties/$propertyId/portals/$portalId"
            params={{ propertyId, portalId }}
            search={{ tab, section }}
          >
            Back to editing
          </Link>
        </Button>
        {view.primary === null ? null : (
          <Button
            type="button"
            className="min-h-11 sm:min-h-9"
            disabled={view.primary.disabled || isPublishing}
            onClick={onPublish}
          >
            {isPublishing ? view.primary.pendingLabel : view.primary.label}
          </Button>
        )}
      </div>
    </footer>
  )
}
