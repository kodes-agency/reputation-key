import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '#/components/ui/dialog'
import { Button } from '#/components/ui/button'
import { Copy, Download } from 'lucide-react'

type QRCodeModalProps = Readonly<{
  open: boolean
  onOpenChange: (open: boolean) => void
  portalId: string
  portalSlug: string
  organizationId: string
}>

export function QRCodeModal({
  open,
  onOpenChange,
  portalId,
  portalSlug,
  organizationId,
}: QRCodeModalProps) {
  const [copied, setCopied] = useState(false)

  const getGuestUrl = () =>
    typeof window !== 'undefined'
      ? `${window.location.origin}/p/${organizationId}/${portalSlug}?source=qr`
      : ''
  const qrApiUrl = `/api/portals/${portalId}/qr`

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(getGuestUrl())
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // fallback
    }
  }

  const handleDownload = () => {
    const link = document.createElement('a')
    link.href = qrApiUrl
    link.download = `qr-${portalSlug}.png`
    link.click()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>QR Code</DialogTitle>
          <DialogDescription>Scan this code to open the guest portal.</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center gap-4 py-4">
          <img
            src={qrApiUrl}
            alt={`QR code for ${portalSlug}`}
            className="w-64 h-64 rounded-lg border"
          />

          <div className="flex items-center gap-2 w-full px-4">
            <code className="flex-1 text-sm bg-muted px-3 py-2 rounded-md truncate">
              {typeof window !== 'undefined'
                ? `${window.location.origin}/p/${organizationId}/${portalSlug}?source=qr`
                : ''}
            </code>
            <Button variant="outline" size="sm" onClick={handleCopy}>
              <Copy className="size-3.5" />
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>

          <Button variant="outline" onClick={handleDownload} className="w-full max-w-xs">
            <Download className="size-3.5 mr-2" />
            Download PNG
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
