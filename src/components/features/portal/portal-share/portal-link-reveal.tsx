// The one render in which the raw public link exists: show it, let it be
// copied, and offer the QR code. Renders nothing once the URL is gone (a
// reload, or a revoke) — portal-share-notices.tsx explains that state instead.

import { Copy, Link2, QrCode } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import { QRCodeModal } from './qr-code-modal'
import { COPY_FAILED_MESSAGE } from './use-copy-link'
import type { RefObject } from 'react'

type Props = Readonly<{
  publicUrl: string | null
  nfcPublicUrl: string | null
  portalName: string
  linkRef: RefObject<HTMLElement | null>
  nfcLinkRef: RefObject<HTMLElement | null>
  copied: boolean
  nfcCopied: boolean
  copyFailed: boolean
  nfcCopyFailed: boolean
  onCopy: () => Promise<void>
  onCopyNfc: () => Promise<void>
  qrOpen: boolean
  onQrOpenChange: (open: boolean) => void
}>

export function PortalLinkReveal(props: Props) {
  const { publicUrl } = props
  if (publicUrl === null) return null
  return (
    <div className="flex flex-col gap-4">
      <SaveLinkWarning />
      <LinkRow
        label="QR address"
        publicUrl={publicUrl}
        linkRef={props.linkRef}
        copied={props.copied}
        copyFailed={props.copyFailed}
        onCopy={props.onCopy}
        onShowQrCode={() => props.onQrOpenChange(true)}
      />
      {props.nfcPublicUrl !== null && (
        <LinkRow
          label="NFC address"
          publicUrl={props.nfcPublicUrl}
          linkRef={props.nfcLinkRef}
          copied={props.nfcCopied}
          copyFailed={props.nfcCopyFailed}
          onCopy={props.onCopyNfc}
        />
      )}
      <QRCodeModal
        open={props.qrOpen}
        onOpenChange={props.onQrOpenChange}
        publicUrl={publicUrl}
        portalName={props.portalName}
      />
    </div>
  )
}

function SaveLinkWarning() {
  return (
    <Alert>
      <Link2 />
      <AlertTitle>Save this link now</AlertTitle>
      <AlertDescription>
        For security, these full addresses will not be shown again after this page is
        reloaded. Save the QR address for printed materials and the NFC address when
        programming NFC tags.
      </AlertDescription>
    </Alert>
  )
}

type LinkRowProps = Readonly<{
  label: string
  publicUrl: string
  linkRef: RefObject<HTMLElement | null>
  copied: boolean
  copyFailed: boolean
  onCopy: () => Promise<void>
  onShowQrCode?: () => void
}>

function LinkRow({
  label,
  publicUrl,
  linkRef,
  copied,
  copyFailed,
  onCopy,
  onShowQrCode,
}: LinkRowProps) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium">{label}</span>
      <div className="flex flex-col gap-2 sm:flex-row">
        <code
          ref={linkRef}
          className="min-w-0 flex-1 break-all rounded-md bg-muted px-3 py-2 text-sm"
        >
          {publicUrl}
        </code>
        <LinkButtons
          label={label}
          copied={copied}
          onCopy={onCopy}
          onShowQrCode={onShowQrCode}
        />
      </div>
      {copyFailed && (
        <p className="text-sm text-destructive" role="alert">
          {COPY_FAILED_MESSAGE}
        </p>
      )}
    </div>
  )
}

type LinkButtonsProps = Readonly<{
  label: string
  copied: boolean
  onCopy: () => Promise<void>
  onShowQrCode?: () => void
}>

function LinkButtons({ label, copied, onCopy, onShowQrCode }: LinkButtonsProps) {
  return (
    <div className="flex gap-2">
      <Button
        type="button"
        variant="outline"
        className="min-h-11 flex-1 sm:min-h-9"
        onClick={() => void onCopy()}
      >
        <Copy data-icon="inline-start" /> {copied ? 'Copied' : `Copy ${label}`}
      </Button>
      {onShowQrCode && (
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="size-11 sm:size-9"
          aria-label="Show QR code"
          onClick={onShowQrCode}
        >
          <QrCode />
        </Button>
      )}
    </div>
  )
}
