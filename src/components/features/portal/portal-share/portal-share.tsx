// Share tab container: wires permissions, mutation state and copy state to the
// sections below it. Every visibility rule is derived in portal-share-state.ts.

import { useState } from 'react'
import { FormErrorBanner } from '#/components/forms/form-error-banner'
import { usePermissions } from '#/shared/hooks/usePermissions'
import { PortalLinkActions } from './portal-link-actions'
import { PortalLinkIssueForm } from './portal-link-issue-form'
import { PortalLinkReveal } from './portal-link-reveal'
import {
  PortalActiveLinkNotice,
  PortalRevokedNotice,
  PortalScanGoalReadinessNotice,
  PortalViewOnlyNotice,
} from './portal-share-notices'
import {
  derivePortalShareView,
  liveStatusMessage,
  resolveMutationState,
} from './portal-share-state'
import { useCopyLink } from './use-copy-link'
import type { PortalShareProps } from './portal-share-types'

export type { IssuedPortalLink } from './portal-share-types'

export function PortalShare(props: PortalShareProps) {
  const { can } = usePermissions()
  const [qrOpen, setQrOpen] = useState(false)
  const publicUrl = props.issuedLink?.publicUrl ?? null
  const nfcPublicUrl = props.issuedLink?.publicUrls?.nfc ?? null
  const { linkRef, copied, copyFailed, copyLink } = useCopyLink(publicUrl)
  const {
    linkRef: nfcLinkRef,
    copied: nfcCopied,
    copyFailed: nfcCopyFailed,
    copyLink: copyNfcLink,
  } = useCopyLink(nfcPublicUrl)
  const { error, isPending } = resolveMutationState(props)
  const view = derivePortalShareView({
    canManage: can('portal.update'),
    revoked: props.revoked,
    publicUrl,
    tokenStatus: props.tokenStatus,
  })

  return (
    <section
      className="flex flex-col gap-5 rounded-lg border p-4 sm:p-6"
      aria-labelledby="share-heading"
    >
      <ShareHeading />

      <PortalViewOnlyNotice show={view.showViewOnlyNotice} />

      <FormErrorBanner error={error} />

      <PortalRevokedNotice show={view.showRevokedNotice} />

      {view.showIssueForm && (
        <PortalLinkIssueForm
          portalId={props.portalId}
          isPending={isPending}
          issueMutation={props.issueMutation}
          onLinkIssued={props.onLinkIssued}
        />
      )}

      <PortalLinkReveal
        publicUrl={publicUrl}
        nfcPublicUrl={nfcPublicUrl}
        portalName={props.portalName}
        linkRef={linkRef}
        nfcLinkRef={nfcLinkRef}
        copied={copied}
        nfcCopied={nfcCopied}
        copyFailed={copyFailed}
        nfcCopyFailed={nfcCopyFailed}
        onCopy={copyLink}
        onCopyNfc={copyNfcLink}
        qrOpen={qrOpen}
        onQrOpenChange={setQrOpen}
      />

      <PortalActiveLinkNotice
        show={view.showActiveLinkNotice}
        detail={view.activeLinkDetail}
        graceLabel={view.graceLabel}
      />

      <PortalScanGoalReadinessNotice
        show={
          !props.revoked &&
          publicUrl === null &&
          props.tokenStatus.hasActiveToken &&
          !props.tokenStatus.qualifiedScanReady
        }
      />

      {view.showActions && (
        <PortalLinkActions
          portalId={props.portalId}
          isPending={isPending}
          rotateMutation={props.rotateMutation}
          revokeMutation={props.revokeMutation}
          onLinkIssued={props.onLinkIssued}
          onLinksRevoked={() => {
            setQrOpen(false)
            props.onLinksRevoked()
          }}
        />
      )}

      <p className="sr-only" role="status" aria-live="polite">
        {liveStatusMessage(isPending, copied)}
      </p>
    </section>
  )
}

function ShareHeading() {
  return (
    <div className="flex flex-col gap-1">
      <h2 id="share-heading" className="text-lg font-semibold">
        Share portal
      </h2>
      <p className="text-sm text-muted-foreground">
        Public links are opaque and shown only when generated or rotated. Copy or download
        the QR code before leaving this page.
      </p>
    </div>
  )
}
