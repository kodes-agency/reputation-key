// Share tab container: wires permissions, mutation state and copy state to the
// sections below it. Every visibility rule is derived in portal-share-state.ts.

import { FormErrorBanner } from '#/components/forms/form-error-banner'
import { cn } from '#/lib/utils'
import { usePermissions } from '#/shared/hooks/usePermissions'
import { PortalCodeBlock } from './portal-code-block'
import { PortalLinkIssueForm } from './portal-link-issue-form'
import { PortalPrintKitPreview } from './portal-print-kit-preview'
import { PortalPrintKitSection } from './portal-print-kit-section'
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
import { usePortalShareAddresses } from './use-portal-share-addresses'
import { usePortalPrintKit } from './use-portal-print-kit'
import type { PortalShareProps } from './portal-share-types'

export type { IssuedPortalLink } from './portal-share-types'

export function PortalShare(props: PortalShareProps) {
  const { can } = usePermissions()
  const addresses = usePortalShareAddresses(props)
  const { publicUrl, directUrl, nfcPublicUrl } = addresses
  const { linkRef, copied, copyFailed, copyLink } = addresses.direct
  const {
    linkRef: nfcLinkRef,
    copied: nfcCopied,
    copyFailed: nfcCopyFailed,
  } = addresses.nfc
  const { error, isPending } = resolveMutationState(props)
  const view = derivePortalShareView({
    canManage: can('portal.update'),
    revoked: props.revoked,
    publicUrl,
    tokenStatus: props.tokenStatus,
    addressRevealed: props.issuedLink?.revealed ?? false,
    addressRecoverable: props.issuedLink?.addressRecoverable,
    issuedVersion: props.issuedLink?.version ?? null,
  })
  const {
    show: showPrintKit,
    printKit,
    download: printKitDownload,
    unavailableReason,
  } = usePortalPrintKit(props, view)

  return (
    <div className="flex min-h-full flex-col lg:flex-row">
      <section
        className={cn(
          'flex flex-col gap-8 px-4 py-5 md:px-6 md:py-8',
          showPrintKit ? 'lg:w-172 lg:shrink-0 lg:border-r' : 'mx-auto w-full max-w-5xl',
        )}
        aria-label="Share"
      >
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
            onShowAddress={view.canDownloadAgain ? addresses.showAddress : null}
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

        <PortalScanGoalReadinessNotice
          show={
            !props.revoked &&
            publicUrl === null &&
            props.tokenStatus.hasActiveToken &&
            !props.tokenStatus.qualifiedScanReady
          }
        />

        {showPrintKit && (
          <PortalPrintKitSection
            view={printKit.view}
            choice={printKit.choice}
            isError={printKit.isError}
            onRetry={printKit.retry}
            onChoiceChange={printKit.setChoice}
            unavailableReason={unavailableReason}
            isWorking={printKitDownload.isWorking}
            errorMessage={printKitDownload.errorMessage}
            onDownload={() => void printKitDownload.download()}
          />
        )}

        <p className="sr-only" role="status" aria-live="polite">
          {liveStatusMessage(isPending, copied || nfcCopied)}
        </p>
      </section>
      {showPrintKit && (
        <PortalPrintKitPreview
          piece={printKit.choice?.piece ?? 'table_tent'}
          view={printKit.view}
          faces={printKit.faces}
          face={printKit.face}
          side={printKit.side}
          onSideChange={printKit.setSide}
          qrAddress={publicUrl}
          isError={printKit.isError}
          onRetry={printKit.retry}
        />
      )}
    </div>
  )
}
