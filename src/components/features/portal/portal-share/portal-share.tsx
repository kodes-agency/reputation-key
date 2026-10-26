// Share tab container: wires permissions, mutation state and copy state to the
// sections below it. Every visibility rule is derived in portal-share-state.ts.

import { FormErrorBanner } from '#/components/forms/form-error-banner'
import { FullBleedFrame } from '#/components/layout/page-shell'
import { cn } from '#/lib/utils'
import { usePermissions } from '#/shared/hooks/usePermissions'
import { usePortalAccess } from '../portal-overview/use-portal-access'
import { PortalCodeBlock } from './portal-code-block'
import { PortalLinkIssueForm } from './portal-link-issue-form'
import { PortalPrintKitNotLive } from './portal-print-kit-not-live'
import {
  PortalSharePrintFinalSection,
  PortalSharePrintKitAside,
  PortalSharePrintKitSection,
} from './portal-share-print-kit'
import { PortalLinkReveal } from './portal-link-reveal'
import {
  PortalAskForCodeLine,
  PortalRevokedNotice,
  PortalScanGoalReadinessNotice,
  PortalUnpublishedNotice,
} from './portal-share-notices'
import { describeUnpublishedCode, describeWhoToAsk } from './portal-share-guidance'
import {
  derivePortalShareViewFromProps,
  liveStatusMessage,
  resolveMutationState,
  showScanGoalReadiness,
} from './portal-share-state'
import { usePortalShareAddresses } from './use-portal-share-addresses'
import { usePortalPrintKit } from './use-portal-print-kit'
import type { PortalShareProps } from './portal-share-types'

export type { IssuedPortalLink } from './portal-share-types'

export function PortalShare(props: PortalShareProps) {
  const { can } = usePermissions()
  // The same two questions the server asks before it makes, replaces or stops
  // a code: the role's permission and the portal.write capability (the
  // Portals pages' one rule). An archived portal's code can still be stopped.
  const canUpdate = can('portal.update')
  const canManage = usePortalAccess().canEdit
  const addresses = usePortalShareAddresses(props)
  const { publicUrl, directUrl, nfcPublicUrl } = addresses
  const { linkRef, copied, copyFailed, copyLink } = addresses.direct
  const {
    linkRef: nfcLinkRef,
    copied: nfcCopied,
    copyFailed: nfcCopyFailed,
  } = addresses.nfc
  const { error, isPending } = resolveMutationState(props)
  const view = derivePortalShareViewFromProps(props, canManage, publicUrl)
  const kit = usePortalPrintKit(props, view)
  return (
    <div className="flex min-h-full flex-col lg:flex-row">
      <FullBleedFrame
        as="section"
        className={cn(
          'flex flex-col gap-8',
          kit.show ? 'lg:w-172 lg:shrink-0 lg:border-r' : 'mx-auto w-full max-w-5xl',
        )}
        aria-label="Share"
      >
        <PortalAskForCodeLine
          ask={describeWhoToAsk(canUpdate, props.managerNames ?? [])}
        />

        <PortalUnpublishedNotice
          notice={
            props.publicationState === undefined
              ? null
              : describeUnpublishedCode(props.publicationState, canManage)
          }
          review={
            canManage && props.propertyId !== undefined
              ? { propertyId: props.propertyId, portalId: props.portalId }
              : null
          }
        />

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
            onShowAddress={view.canDownloadAgain ? addresses.showAddress : null}
            disabled={isPending}
          />
        )}

        <PortalSharePrintFinalSection kit={kit} countryCode={props.countryCode ?? null} />

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
              onCopyNfc={addresses.copyNfcAddress}
              canDownloadAgain={view.canDownloadAgain}
              resolveQrAddress={view.canDownloadAgain ? addresses.resolveQrAddress : null}
              isPending={isPending}
              rotateMutation={props.rotateMutation}
              revokeMutation={props.revokeMutation}
              onLinkIssued={props.onLinkIssued}
              onLinksRevoked={props.onLinksRevoked}
            />
          )}
        </section>

        <PortalScanGoalReadinessNotice show={showScanGoalReadiness(props, publicUrl)} />

        <PortalPrintKitNotLive notice={kit.notLive} />

        <PortalSharePrintKitSection kit={kit} />

        <p className="sr-only" role="status" aria-live="polite">
          {liveStatusMessage(isPending, copied || nfcCopied)}
        </p>
      </FullBleedFrame>
      <PortalSharePrintKitAside kit={kit} propertyId={props.propertyId} />
    </div>
  )
}
