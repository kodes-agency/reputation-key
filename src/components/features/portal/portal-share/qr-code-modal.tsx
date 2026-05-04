import { useState, useEffect } from 'react'
import QRCode from 'qrcode'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '#/components/ui/dialog'
import { Button } from '#/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '#/components/ui/tooltip'
import { Copy, Download } from 'lucide-react'

type QRCodeModalProps = Readonly<{
  open: boolean
  onOpenChange: (open: boolean) => void
  portalSlug: string
  propertySlug: string
}>

export function QRCodeModal({
  open,
  onOpenChange,
  portalSlug,
  propertySlug,
}: QRCodeModalProps) {
  const [copied, setCopied] = useState(false)
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)

  const path = `/p/${propertySlug}/${portalSlug}?source=qr`
  const guestUrl = typeof window !== 'undefined' ? `${window.location.origin}${path}` : ''

  // Generate QR code client-side
  useEffect(() => {
    if (open && guestUrl) {
      QRCode.toDataURL(guestUrl, {
        width: 256,
        margin: 2,
        color: {
          dark: '#000000',
          light: '#ffffff',
        },
      })
        .then(setQrDataUrl)
        .catch(console.error)
    }
  }, [open, guestUrl])

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(guestUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // fallback
    }
  }

  const handleDownload = () => {
    if (!qrDataUrl) return
    const link = document.createElement('a')
    link.href = qrDataUrl
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
          {qrDataUrl && (
            <img
              src={qrDataUrl}
              alt={`QR code for ${portalSlug}`}
              className="w-64 h-64 rounded-lg border"
            />
          )}

          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex items-center gap-2 w-full px-4 cursor-help">
                  <code className="flex-1 text-sm bg-muted px-3 py-2 rounded-md truncate">
                    {path}
                  </code>
                </div>
              </TooltipTrigger>
              <TooltipContent>
                <p>{guestUrl}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

          <div className="flex items-center gap-2 w-full px-4">
            <Button variant="outline" size="sm" onClick={handleCopy} className="flex-1">
              <Copy className="size-3.5 mr-2" />
              {copied ? 'Copied' : 'Copy URL'}
            </Button>
            <Button
              variant="outline"
              onClick={handleDownload}
              className="flex-1"
              disabled={!qrDataUrl}
            >
              <Download className="size-3.5 mr-2" />
              Download PNG
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
