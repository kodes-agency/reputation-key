// Detail header: the way back to the portal list, and the preview toggle.
// The toggle is absent — not disabled — on the tabs the preview cannot mirror,
// which is the same `show` contract PortalDetailPreview uses for the panel.

import { Link } from '@tanstack/react-router'
import { ArrowLeft, Eye } from 'lucide-react'
import { Button } from '#/components/ui/button'

type Props = Readonly<{
  propertyId: string
  showPreview: boolean
  previewOpen: boolean
  onPreviewToggle: (open: boolean) => void
}>

export function PortalDetailHeader({
  propertyId,
  showPreview,
  previewOpen,
  onPreviewToggle,
}: Props) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <Button variant="ghost" asChild>
        <Link to="/properties/$propertyId/portals" params={{ propertyId }}>
          <ArrowLeft /> Back
        </Link>
      </Button>
      <PreviewToggleButton
        show={showPreview}
        open={previewOpen}
        onToggle={onPreviewToggle}
      />
    </div>
  )
}

function PreviewToggleButton({
  show,
  open,
  onToggle,
}: Readonly<{ show: boolean; open: boolean; onToggle: (open: boolean) => void }>) {
  if (!show) return null
  return (
    <Button
      variant="outline"
      className="min-h-11 sm:min-h-9"
      onClick={() => onToggle(!open)}
      aria-pressed={open}
    >
      <Eye /> {open ? 'Hide preview' : 'Preview'}
    </Button>
  )
}
