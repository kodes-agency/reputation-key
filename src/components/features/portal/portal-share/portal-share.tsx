// Share tab container: wires permissions, mutation state and copy state to the
// sections below it. Every visibility rule is derived in portal-share-state.ts.

import { FormErrorBanner } from '#/components/forms/form-error-banner'
import { cn } from '#/lib/utils'
import { usePermissions } from '#/shared/hooks/usePermissions'
import { PortalCodeBlock } from './portal-code-block'
import { PortalLinkIssueForm } from './portal-link-issue-form'
import { PortalPrintKitPreview } from './portal-print-kit-preview'
import type { PortalPrintKitReader } from './portal-print-kit-types'
import { PortalPrintKitSection } from './portal-print-kit-section'
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
import { printKitAvailability } from './print-kit-state'
import { useAddressReveal } from './use-address-reveal'
import { useCopyLink } from './use-copy-link'
import { usePrintKit } from './use-print-kit'
import { usePrintKitDownload } from './use-print-kit-download'
import type { PortalShareProps } from './portal-share-types'

export type { IssuedPortalLink } from './portal-share-types'

/** Stands in for the read when the tab has no print kit; the query is off then and never calls it. */
const NO_PRINT_KIT_READ: PortalPrintKitReader = () =>
  Promise.reject(new Error('This tab has no print kit'))

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
  // The print kit is for a manager with a live code; it carries the preview
  // beside the tab, so the tab is two columns when it is on.
  const showPrintKit = props.printKit !== undefined && view.showActions && view.showCode
  const printKit = usePrintKit({
    portalId: props.portalId,
    read: props.printKit?.read ?? NO_PRINT_KIT_READ,
    enabled: showPrintKit,
  })
  const printKitDownload = usePrintKitDownload({
    portalId: props.portalId,
    choice: printKit.choice,
    downloadMutation: props.printKit?.downloadMutation,
  })
  const availability = printKitAvailability({ canDownloadAgain: view.canDownloadAgain })

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

        {showPrintKit && (
          <PortalPrintKitSection
            view={printKit.view}
            choice={printKit.choice}
            isError={printKit.isError}
            onRetry={printKit.retry}
            onChoiceChange={printKit.setChoice}
            unavailableReason={availability.reason}
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
