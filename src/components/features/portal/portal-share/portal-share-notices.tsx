// Standing notices for the Share tab. Each one renders nothing when its
// `show` flag is false, so the container stays a flat list of sections and the
// visibility rules live in portal-share-state.ts.

import { Link } from '@tanstack/react-router'
import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import type { UnpublishedCodeNotice } from './portal-share-guidance'

type NoticeProps = Readonly<{ show: boolean }>

/** Why this person can only look (their role, or portal changes switched off), and whom to ask. */
export function PortalViewOnlyNotice({
  reason,
  ask,
}: Readonly<{ reason: string | null; ask: string | null }>) {
  if (reason === null) return null
  return (
    <Alert variant="info">
      <AlertTitle>View-only access</AlertTitle>
      <AlertDescription>
        <p>{reason}</p>
        {ask === null ? null : <p>{ask}</p>}
      </AlertDescription>
    </Alert>
  )
}

/**
 * The code leads to a page guests cannot open yet (a draft, a portal turned off
 * or archived). Making and printing it is still allowed; this says what a scan
 * shows until then, and where the portal is published.
 */
export function PortalUnpublishedNotice({
  notice,
  review,
}: Readonly<{
  notice: UnpublishedCodeNotice | null
  /** Where "Review & publish" goes; null when it is not offered here. */
  review: Readonly<{ propertyId: string; portalId: string }> | null
}>) {
  if (notice === null) return null
  return (
    <Alert variant="warning">
      <AlertTitle>{notice.title}</AlertTitle>
      <AlertDescription className="space-y-3">
        <p>{notice.body}</p>
        {notice.offersReview && review !== null ? (
          <Button asChild variant="outline" size="sm">
            <Link
              to="/properties/$propertyId/portals/$portalId/review"
              params={review}
              search={{ tab: 'share' }}
            >
              Review &amp; publish
            </Link>
          </Button>
        ) : null}
      </AlertDescription>
    </Alert>
  )
}

export function PortalRevokedNotice({ show }: NoticeProps) {
  if (!show) return null
  return (
    <Alert variant="info" aria-live="polite">
      <AlertTitle>All codes stopped</AlertTitle>
      <AlertDescription>
        Earlier codes and the public address no longer open this portal. Make a new code
        when you are ready to share it again.
      </AlertDescription>
    </Alert>
  )
}

export function PortalScanGoalReadinessNotice({ show }: NoticeProps) {
  if (!show) return null
  return (
    <Alert variant="warning">
      <AlertTitle>QR update available</AlertTitle>
      <AlertDescription>
        This code was made before visit goals were added. It remains usable, but visits
        from it are not included in scan-based goals. Replace the code, then swap the
        printed QR for the new one to include future visits.
      </AlertDescription>
    </Alert>
  )
}
