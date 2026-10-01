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
  directPortalAddress,
  liveStatusMessage,
  resolveMutationState,
} from './portal-share-state'
import { useAddressReveal } from './use-address-reveal'
import { useCopyLink } from './use-copy-link'
import type { PortalShareProps } from './portal-share-types'

export type { IssuedPortalLink } from './portal-share-types'

export function PortalShare(props: PortalShareProps) {
  const { can } = usePermissions()
  // The QR address (it carries the access-artifact marker) draws the image; the
  // address row and its Copy button show the direct one.
  const publicUrl = props.issuedLink?.publicUrl ?? null
  const directUrl = publicUrl === null ? null : directPortalAddress(publicUrl)
  const nfcPublicUrl = props.issuedLink?.publicUrls?.nfc ?? null
  const { linkRef, copied, copyFailed, copyLink } = useCopyLink(directUrl)
  const {
    linkRef: nfcLinkRef,
    copied: nfcCopied,
    copyFailed: nfcCopyFailed,
    copyFetchedLink: copyFetchedNfc,
    copyLink: copyNfc,
  } = useCopyLink(nfcPublicUrl)
  const { error, isPending } = resolveMutationState(props)
  const view = derivePortalShareView({
    canManage: can('portal.update'),
    revoked: props.revoked,
    publicUrl,
    tokenStatus: props.tokenStatus,
    addressRevealed: props.issuedLink?.revealed ?? false,
    addressRecoverable: props.issuedLink?.addressRecoverable,
  })
  // "Download again": each of these fetches the address once, which the server
  // records, and then works from memory like a made address.
  const reveal = useAddressReveal(props)
  const showAddress = async () => (await reveal('show')) !== null
  const resolveQrAddress = async () => (await reveal('download'))?.publicUrl ?? null
  const copyNfcAddress = () =>
    nfcPublicUrl !== null
      ? copyNfc()
      : copyFetchedNfc(async () => (await reveal('copy'))?.publicUrls?.nfc ?? null)

  return (
    <section className="flex flex-col gap-8" aria-label="Share">
      <PortalViewOnlyNotice show={view.showViewOnlyNotice} />

      <FormErrorBanner error={error} />

      <PortalRevokedNotice show={view.showRevokedNotice} />

      {view.showAddressRow && (
        <PortalLinkReveal
          publicUrl={directUrl}
          linkRef={linkRef}
          copied={copied}
          copyFailed={copyFailed}
          onCopy={copyLink}
          showSaveWarning={view.showSaveWarning}
          onShowAddress={view.canDownloadAgain ? showAddress : null}
          disabled={isPending}
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
            onCopyNfc={copyNfcAddress}
            canDownloadAgain={view.canDownloadAgain}
            resolveQrAddress={view.canDownloadAgain ? resolveQrAddress : null}
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
