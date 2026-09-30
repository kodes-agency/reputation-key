// Share tab container: wires permissions, mutation state and copy state to the
// sections below it. Every visibility rule is derived in portal-share-state.ts.

import { FormErrorBanner } from '#/components/forms/form-error-banner'
import { usePermissions } from '#/shared/hooks/usePermissions'
import { PortalCodeBlock } from './portal-code-block'
import { PortalLinkIssueForm } from './portal-link-issue-form'
import { PortalLinkReveal } from './portal-link-reveal'
import {
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
  const publicUrl = props.issuedLink?.publicUrl ?? null
  const nfcPublicUrl = props.issuedLink?.publicUrls?.nfc ?? null
  const { linkRef, copied, copyFailed, copyLink } = useCopyLink(publicUrl)
  const {
    linkRef: nfcLinkRef,
    copied: nfcCopied,
    copyFailed: nfcCopyFailed,
    copyLink: copyNfc,
  } = useCopyLink(nfcPublicUrl)
  const { error, isPending } = resolveMutationState(props)
  const view = derivePortalShareView({
    canManage: can('portal.update'),
    revoked: props.revoked,
    publicUrl,
    tokenStatus: props.tokenStatus,
  })

  return (
    <section className="flex flex-col gap-8" aria-label="Share">
      <PortalViewOnlyNotice show={view.showViewOnlyNotice} />

      <FormErrorBanner error={error} />

      <PortalRevokedNotice show={view.showRevokedNotice} />

      {view.showAddress && (
        <PortalLinkReveal
          publicUrl={publicUrl}
          linkRef={linkRef}
          copied={copied}
          copyFailed={copyFailed}
          onCopy={copyLink}
        />
      )}

      <section className="flex flex-col gap-4" aria-labelledby="code-heading">
        <h2 id="code-heading" className="text-lg font-semibold">
          Code
        </h2>

        {view.showIssueForm && (
          <PortalLinkIssueForm
            portalId={props.portalId}
            isPending={isPending}
            issueMutation={props.issueMutation}
            onLinkIssued={props.onLinkIssued}
          />
        )}

        {view.showCode && (
          <PortalCodeBlock
            portalId={props.portalId}
            portalName={props.portalName}
            view={view}
            qrAddress={view.showAddress ? publicUrl : null}
            nfcAddress={view.showAddress ? nfcPublicUrl : null}
            nfcLinkRef={nfcLinkRef}
            nfcCopied={nfcCopied}
            nfcCopyFailed={nfcCopyFailed}
            onCopyNfc={copyNfc}
            isPending={isPending}
            rotateMutation={props.rotateMutation}
            revokeMutation={props.revokeMutation}
            onLinkIssued={props.onLinkIssued}
            onLinksRevoked={props.onLinksRevoked}
          />
        )}
      </section>

      <PortalScanGoalReadinessNotice
        show={
          !props.revoked &&
          publicUrl === null &&
          props.tokenStatus.hasActiveToken &&
          !props.tokenStatus.qualifiedScanReady
        }
      />

      <p className="sr-only" role="status" aria-live="polite">
        {liveStatusMessage(isPending, copied || nfcCopied)}
      </p>
    </section>
  )
}
