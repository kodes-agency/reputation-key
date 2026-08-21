// Standing notices for the Share tab. Each one renders nothing when its
// `show` flag is false, so the container stays a flat list of sections and the
// visibility rules live in portal-share-state.ts.

import { Link2, ShieldX } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert'

type NoticeProps = Readonly<{ show: boolean }>

export function PortalViewOnlyNotice({ show }: NoticeProps) {
  if (!show) return null
  return (
    <Alert>
      <ShieldX />
      <AlertTitle>View-only access</AlertTitle>
      <AlertDescription>
        You do not have permission to generate, rotate, or revoke public links.
      </AlertDescription>
    </Alert>
  )
}

export function PortalRevokedNotice({ show }: NoticeProps) {
  if (!show) return null
  return (
    <Alert aria-live="polite">
      <ShieldX />
      <AlertTitle>Public links revoked</AlertTitle>
      <AlertDescription>
        Previously issued links no longer provide access. Generate a new link when you are
        ready to share this portal again.
      </AlertDescription>
    </Alert>
  )
}

type ActiveLinkNoticeProps = Readonly<{
  show: boolean
  /** `version 3, issued Jan 4, 2026`; empty when the token has no metadata. */
  detail: string
  graceLabel: string | null
}>

export function PortalActiveLinkNotice({
  show,
  detail,
  graceLabel,
}: ActiveLinkNoticeProps) {
  if (!show) return null
  return (
    <Alert>
      <Link2 />
      <AlertTitle>A public link is active</AlertTitle>
      <AlertDescription>
        {detail !== '' && <p>This portal is shared as {detail}.</p>}
        <p>
          The URL is shown only once, when it is generated or rotated, so it cannot be
          displayed again here. Rotate the link to get a new URL you can copy or print, or
          revoke it to stop all access.
        </p>
        {graceLabel !== null && (
          <p>A previously rotated link keeps working until {graceLabel} (UTC).</p>
        )}
      </AlertDescription>
    </Alert>
  )
}
