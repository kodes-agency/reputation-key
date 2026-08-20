import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { AlertCircle, Copy, Download } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog'
import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import { copyToClipboard } from '#/lib/clipboard'

type QRCodeModalProps = Readonly<{
  open: boolean
  onOpenChange: (open: boolean) => void
  publicUrl: string
  portalName: string
}>

export function QRCodeModal({
  open,
  onOpenChange,
  publicUrl,
  portalName,
}: QRCodeModalProps) {
  const [copied, setCopied] = useState(false)
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const [generationError, setGenerationError] = useState(false)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setQrDataUrl(null)
    setGenerationError(false)
    void QRCode.toDataURL(publicUrl, {
      width: 256,
      margin: 2,
      color: {
        dark: '#16151a',
        light: '#faf9fc',
      },
    })
      .then((dataUrl) => {
        if (!cancelled) setQrDataUrl(dataUrl)
      })
      .catch(() => {
        if (!cancelled) setGenerationError(true)
      })
    return () => {
      cancelled = true
    }
  }, [open, publicUrl])

  const handleCopy = async () => {
    if (!(await copyToClipboard(publicUrl))) return
    setCopied(true)
    window.setTimeout(() => setCopied(false), 2000)
  }

  const handleDownload = () => {
    if (!qrDataUrl) return
    const safeName = portalName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
    const link = document.createElement('a')
    link.href = qrDataUrl
    link.download = `${safeName || 'portal'}-qr.png`
    link.click()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Portal QR code</DialogTitle>
          <DialogDescription>
            Download this code before leaving the page. It contains the newly issued
            opaque public link.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center gap-4 py-4">
          {!qrDataUrl && !generationError && (
            <div
              className="flex size-64 items-center justify-center rounded-lg border bg-muted"
              aria-busy="true"
              aria-live="polite"
            >
              <span className="text-sm text-muted-foreground">Generating QR code…</span>
            </div>
          )}

          {generationError && (
            <Alert variant="destructive">
              <AlertCircle />
              <AlertTitle>QR code unavailable</AlertTitle>
              <AlertDescription>
                The link is still valid. Close this dialog and try again, or copy the link
                instead.
              </AlertDescription>
            </Alert>
          )}

          {qrDataUrl && (
            <img
              src={qrDataUrl}
              alt={`QR code for ${portalName}`}
              className="size-64 max-w-full rounded-lg border"
            />
          )}

          <code className="w-full break-all rounded-md bg-muted px-3 py-2 text-sm">
            {publicUrl}
          </code>

          <div className="flex w-full flex-col gap-2 sm:flex-row">
            <Button
              type="button"
              variant="outline"
              onClick={() => void handleCopy()}
              className="min-h-11 flex-1 sm:min-h-9"
            >
              <Copy /> {copied ? 'Copied' : 'Copy link'}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={handleDownload}
              className="min-h-11 flex-1 sm:min-h-9"
              disabled={!qrDataUrl}
            >
              <Download /> Download PNG
            </Button>
          </div>
          <p className="sr-only" role="status" aria-live="polite">
            {copied ? 'Portal link copied' : ''}
          </p>
        </div>
      </DialogContent>
    </Dialog>
  )
}
