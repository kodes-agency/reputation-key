import { useState } from 'react'
import { Button } from '#/components/ui/button'
import { Copy, QrCode } from 'lucide-react'
import { QRCodeModal } from './qr-code-modal'

type Props = Readonly<{
  portalSlug: string
  propertySlug: string
}>

export function PortalShare({ portalSlug, propertySlug }: Props) {
  const [copied, setCopied] = useState(false)
  const [qrOpen, setQrOpen] = useState(false)

  const guestUrl = `/p/${propertySlug}/${portalSlug}`

  const getFullUrl = () =>
    typeof window !== 'undefined' ? `${window.location.origin}${guestUrl}` : ''

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(getFullUrl())
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // fallback
    }
  }

  return (
    <>
      <div className="rounded-lg border p-4 space-y-3">
        <h3 className="font-semibold">Share</h3>
        <div className="flex items-center gap-2">
          <code className="flex-1 text-sm bg-muted px-3 py-2 rounded-md truncate">
            {guestUrl}
          </code>
          <Button variant="outline" size="sm" onClick={handleCopy}>
            <Copy className="size-3.5" />
            {copied ? 'Copied!' : 'Copy'}
          </Button>
          <Button variant="outline" size="sm" onClick={() => setQrOpen(true)}>
            <QrCode className="size-3.5" />
          </Button>
        </div>
      </div>

      <QRCodeModal
        open={qrOpen}
        onOpenChange={setQrOpen}
        portalSlug={portalSlug}
        propertySlug={propertySlug}
      />
    </>
  )
}
