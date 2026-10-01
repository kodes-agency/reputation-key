// The code block of the Share tab: the portal's one code, which is both a QR
// image and an NFC address. The picture and the downloads need the address. It
// is in memory after a code is made, replaced or fetched again; after a reload
// it is fetched again on demand when the code was sealed (ADR 0064), and
// otherwise gone. The block still says when the code was made and still offers
// replace and stop.

import { Calendar, Check, Clock, Copy, Info, QrCode } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { PortalCodeActions } from './portal-code-actions'
import { PortalDownloadMenu } from './portal-download-menu'
import { describeMadeCode } from './portal-share-state'
import { QR_INK, QR_PAPER } from './portal-qr'
import { COPY_FAILED_MESSAGE } from './use-copy-link'
import { usePortalCodeDownload, type ResolveQrAddress } from './use-portal-code-download'
import { usePortalQrPreview } from './use-portal-qr-preview'
import type { RefObject } from 'react'
import type { PortalShareView } from './portal-share-state'
import type { IssuedPortalLink, PortalShareMutations } from './portal-share-types'

type Props = Readonly<{
  portalId: string
  portalName: string
  view: PortalShareView
  /** The QR address, in memory only after the code was made or replaced. */
  qrAddress: string | null
  nfcAddress: string | null
  nfcLinkRef: RefObject<HTMLElement | null>
  nfcCopied: boolean
  nfcCopyFailed: boolean
  onCopyNfc: () => Promise<void>
  /** Download again is on: the manager can fetch the address when it is not in memory. */
  canDownloadAgain: boolean
  /** Fetches the QR address for a file; null when download again is off. */
  resolveQrAddress: ResolveQrAddress | null
  isPending: boolean
  rotateMutation: PortalShareMutations['rotateMutation']
  revokeMutation: PortalShareMutations['revokeMutation']
  onLinkIssued: (link: IssuedPortalLink) => void
  onLinksRevoked: () => void
}>

// fallow-ignore-next-line complexity
export function PortalCodeBlock({
  portalId,
  portalName,
  view,
  qrAddress,
  nfcAddress,
  nfcLinkRef,
  nfcCopied,
  nfcCopyFailed,
  onCopyNfc,
  canDownloadAgain,
  resolveQrAddress,
  isPending,
  rotateMutation,
  revokeMutation,
  onLinkIssued,
  onLinksRevoked,
}: Props) {
  const download = usePortalCodeDownload(qrAddress, portalName, resolveQrAddress)
  const madeText = describeMadeCode(view.madeLabel, view.madeBy)

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
      <QrTile address={qrAddress} portalName={portalName} />
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <div className="flex flex-col gap-0.5">
          <h3 className="text-sm font-semibold">QR code and NFC tag</h3>
          <p className="text-sm text-muted-foreground">Both open {portalName}.</p>
        </div>
        <ul className="flex flex-col gap-1.5 text-sm">
          {madeText !== null && <CodeFact icon={<Calendar />}>{madeText}</CodeFact>}
          <CodeFact icon={<Check className="text-positive" />}>
            Printed codes keep working when you publish changes.
          </CodeFact>
          {view.graceLabel !== null && (
            <CodeFact icon={<Clock />}>
              The code before this one keeps working until {view.graceLabel} (UTC).
            </CodeFact>
          )}
          {qrAddress === null && (
            <CodeFact icon={<Info />}>
              {canDownloadAgain
                ? 'Download the code again whenever you need it. Each download is recorded in History.'
                : 'The QR image and the addresses are shown only when a code is made or replaced.'}
            </CodeFact>
          )}
        </ul>
        <div className="flex flex-wrap gap-2">
          {(qrAddress !== null || canDownloadAgain) && (
            <PortalDownloadMenu
              disabled={download.isWorking || isPending}
              again={qrAddress === null}
              onDownload={(format) => void download.download(format)}
            />
          )}
          {(nfcAddress !== null || canDownloadAgain) && (
            <Button
              type="button"
              variant="outline"
              className="min-h-11 sm:min-h-9"
              onClick={() => void onCopyNfc()}
            >
              <Copy data-icon="inline-start" />
              {nfcCopied ? 'Copied' : 'Copy NFC address'}
            </Button>
          )}
          {view.showActions && (
            <PortalCodeActions
              portalId={portalId}
              isPending={isPending}
              rotateMutation={rotateMutation}
              revokeMutation={revokeMutation}
              onLinkIssued={onLinkIssued}
              onLinksRevoked={onLinksRevoked}
            />
          )}
        </div>
        {download.failed && (
          <p className="text-sm text-destructive" role="alert">
            The file could not be made. Try again, or replace the code to get a new set.
          </p>
        )}
        {nfcCopyFailed && nfcAddress !== null && (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-destructive" role="alert">
              {COPY_FAILED_MESSAGE}
            </p>
            <code
              ref={nfcLinkRef}
              className="break-all rounded-md bg-muted px-3 py-2 text-sm"
            >
              {nfcAddress}
            </code>
          </div>
        )}
      </div>
    </div>
  )
}

function CodeFact({
  icon,
  children,
}: Readonly<{ icon: React.ReactNode; children: React.ReactNode }>) {
  return (
    <li className="flex items-start gap-2">
      <span className="mt-0.5 shrink-0 text-muted-foreground [&_svg]:size-4">{icon}</span>
      <span>{children}</span>
    </li>
  )
}

/** The QR image on a pale tile, or a placeholder when there is no address to draw. */
function QrTile({
  address,
  portalName,
}: Readonly<{ address: string | null; portalName: string }>) {
  const { qrDataUrl, generationError } = usePortalQrPreview(address)
  return (
    <div
      className="flex size-36 shrink-0 items-center justify-center self-start rounded-lg border"
      style={{ backgroundColor: QR_PAPER }}
      aria-busy={address !== null && qrDataUrl === null && !generationError}
    >
      {qrDataUrl !== null ? (
        <img
          src={qrDataUrl}
          width={136}
          height={136}
          alt={`QR code for ${portalName}`}
          className="size-[136px] rounded-md"
        />
      ) : (
        <QrCode
          className="size-10 opacity-40"
          style={{ color: QR_INK }}
          aria-hidden="true"
        />
      )}
    </div>
  )
}
