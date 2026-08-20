import { useState } from 'react'
import { Copy, Link2, QrCode, ShieldX } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import { FormErrorBanner } from '#/components/forms/form-error-banner'
import { usePermissions } from '#/shared/hooks/usePermissions'
import { PortalLinkActions } from './portal-link-actions'
import { PortalLinkIssueForm } from './portal-link-issue-form'
import { QRCodeModal } from './qr-code-modal'
import { COPY_FAILED_MESSAGE, useCopyLink } from './use-copy-link'
import type { PortalShareProps } from './portal-share-types'

export type { IssuedPortalLink } from './portal-share-types'

// Fixed locale + UTC so the server and client render the same string (same
// reason as property-dashboard-review-row.tsx): a mismatch hydrates as an error.
const timestampFormatter = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'medium',
  timeZone: 'UTC',
})

function formatTimestamp(iso: string | null): string | null {
  if (iso === null) return null
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? null : timestampFormatter.format(date)
}

export function PortalShare({
  portalId,
  portalName,
  issuedLink,
  revoked,
  tokenStatus,
  onLinkIssued,
  onLinksRevoked,
  issueMutation,
  rotateMutation,
  revokeMutation,
}: PortalShareProps) {
  const { can } = usePermissions()
  const [qrOpen, setQrOpen] = useState(false)
  const publicUrl = issuedLink?.publicUrl ?? null
  const { linkRef, copied, copyFailed, copyLink } = useCopyLink(publicUrl)
  const mutationError =
    issueMutation.error ?? rotateMutation.error ?? revokeMutation.error
  const isPending =
    issueMutation.isPending || rotateMutation.isPending || revokeMutation.isPending
  const canManage = can('portal.update')

  // The raw URL only exists in memory for the render that issued or rotated it,
  // so `publicUrl` cannot answer "is a link live?" after a reload — deriving the
  // rotate/revoke affordances from it left a leaked QR permanently unrevocable.
  // `tokenStatus` (C2, returned by getPortal) is the durable answer; in-session
  // issue/revoke outcomes run ahead of it until the detail query refetches, so
  // they take precedence.
  const hasActiveToken = !revoked && (publicUrl !== null || tokenStatus.hasActiveToken)
  const issuedAtLabel = formatTimestamp(tokenStatus.issuedAt)
  const graceLabel = formatTimestamp(tokenStatus.graceExpiresAt)
  const activeLinkDetail = [
    tokenStatus.version === null ? null : `version ${tokenStatus.version}`,
    issuedAtLabel === null ? null : `issued ${issuedAtLabel}`,
  ]
    .filter((part) => part !== null)
    .join(', ')

  return (
    <section
      className="flex flex-col gap-5 rounded-lg border p-4 sm:p-6"
      aria-labelledby="share-heading"
    >
      <div className="flex flex-col gap-1">
        <h2 id="share-heading" className="text-lg font-semibold">
          Share portal
        </h2>
        <p className="text-sm text-muted-foreground">
          Public links are opaque and shown only when generated or rotated. Copy or
          download the QR code before leaving this page.
        </p>
      </div>

      {!canManage && (
        <Alert>
          <ShieldX />
          <AlertTitle>View-only access</AlertTitle>
          <AlertDescription>
            You do not have permission to generate, rotate, or revoke public links.
          </AlertDescription>
        </Alert>
      )}

      <FormErrorBanner error={mutationError} />

      {revoked && !publicUrl && (
        <Alert aria-live="polite">
          <ShieldX />
          <AlertTitle>Public links revoked</AlertTitle>
          <AlertDescription>
            Previously issued links no longer provide access. Generate a new link when you
            are ready to share this portal again.
          </AlertDescription>
        </Alert>
      )}

      {canManage && !hasActiveToken && (
        <PortalLinkIssueForm
          portalId={portalId}
          isPending={isPending}
          issueMutation={issueMutation}
          onLinkIssued={onLinkIssued}
        />
      )}

      {publicUrl && (
        <div className="flex flex-col gap-4">
          <Alert>
            <Link2 />
            <AlertTitle>Save this link now</AlertTitle>
            <AlertDescription>
              For security, the full link will not be shown again after this page is
              reloaded. Losing it requires rotation.
            </AlertDescription>
          </Alert>

          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">Public link</span>
            <div className="flex flex-col gap-2 sm:flex-row">
              <code
                ref={linkRef}
                className="min-w-0 flex-1 break-all rounded-md bg-muted px-3 py-2 text-sm"
              >
                {publicUrl}
              </code>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11 flex-1 sm:min-h-9"
                  onClick={() => void copyLink()}
                >
                  <Copy data-icon="inline-start" /> {copied ? 'Copied' : 'Copy link'}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="size-11 sm:size-9"
                  aria-label="Show QR code"
                  onClick={() => setQrOpen(true)}
                >
                  <QrCode />
                </Button>
              </div>
            </div>
            {copyFailed && (
              <p className="text-sm text-destructive" role="alert">
                {COPY_FAILED_MESSAGE}
              </p>
            )}
          </div>
        </div>
      )}

      {hasActiveToken && !publicUrl && (
        <Alert>
          <Link2 />
          <AlertTitle>A public link is active</AlertTitle>
          <AlertDescription>
            {activeLinkDetail !== '' && (
              <p>This portal is shared as {activeLinkDetail}.</p>
            )}
            <p>
              The URL is shown only once, when it is generated or rotated, so it cannot
              be displayed again here. Rotate the link to get a new URL you can copy or
              print, or revoke it to stop all access.
            </p>
            {graceLabel !== null && (
              <p>A previously rotated link keeps working until {graceLabel} (UTC).</p>
            )}
          </AlertDescription>
        </Alert>
      )}

      {canManage && hasActiveToken && (
        <PortalLinkActions
          portalId={portalId}
          isPending={isPending}
          rotateMutation={rotateMutation}
          revokeMutation={revokeMutation}
          onLinkIssued={onLinkIssued}
          onLinksRevoked={() => {
            setQrOpen(false)
            onLinksRevoked()
          }}
        />
      )}

      <p className="sr-only" role="status" aria-live="polite">
        {isPending
          ? 'Updating the portal public link'
          : copied
            ? 'Portal link copied'
            : ''}
      </p>

      {publicUrl && (
        <QRCodeModal
          open={qrOpen}
          onOpenChange={setQrOpen}
          publicUrl={publicUrl}
          portalName={portalName}
        />
      )}
    </section>
  )
}
