// The footer of the review page: which version this publishes as, what it does
// to printed codes, the way back, and the one publish button. It stays at the
// bottom of the screen while the page scrolls: below `lg` across the whole page,
// so it is still there under the phones; from `lg` at the foot of the lists'
// column. The button is the one the review read says the server will accept;
// when it cannot be used the footer says why. When nothing waits to go live the
// way back is the main action. Otherwise, on a phone the way back is the
// header's alone, so the facts and the button share one row and the footer
// covers less of a small screen.

import { Link } from '@tanstack/react-router'
import { QrCode } from 'lucide-react'
import { PAGE_GUTTER_X } from '#/components/layout/page-shell'
import { BackLink } from '#/components/ui/back-link'
import { Button } from '#/components/ui/button'
import { cn } from '#/lib/utils'
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
  className?: string
}>

export function ReviewFooter({
  view,
  propertyId,
  portalId,
  tab,
  section,
  isPublishing,
  onPublish,
  className,
}: Props) {
  const back = {
    to: '/properties/$propertyId/portals/$portalId',
    params: { propertyId, portalId },
    search: { tab, section },
  } as const
  return (
    <footer
      className={cn(
        PAGE_GUTTER_X,
        'sticky bottom-0 z-10 border-t bg-background py-3',
        className,
      )}
    >
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
        {view.backIsPrimary ? (
          <Button asChild>
            {/* The review is under the portal's address: not "current" for that. */}
            <Link {...back} activeOptions={{ exact: true }}>
              Back to editing
            </Link>
          </Button>
        ) : (
          <BackLink {...back} label="Back to editing" className="hidden sm:inline-flex" />
        )}
        {view.primary === null ? null : (
          <Button
            type="button"
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
