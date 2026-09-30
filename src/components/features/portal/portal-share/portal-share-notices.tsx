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
        You do not have permission to make, replace or stop the portal's code.
      </AlertDescription>
    </Alert>
  )
}

export function PortalRevokedNotice({ show }: NoticeProps) {
  if (!show) return null
  return (
    <Alert aria-live="polite">
      <ShieldX />
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
    <Alert>
      <Link2 />
      <AlertTitle>QR update available</AlertTitle>
      <AlertDescription>
        This code was made before visit goals were added. It remains usable, but visits
        from it are not included in scan-based goals. Replace the code, then swap the
        printed QR for the new one to include future visits.
      </AlertDescription>
    </Alert>
  )
}
