// The preview toggle. It is absent — not disabled — on the tabs the preview
// cannot mirror, which is the same `show` contract PortalDetailPreview uses for
// the panel. It moves into the editor's own pane with the live preview (slice 30).

import { Eye } from 'lucide-react'
import { Button } from '#/components/ui/button'

type Props = Readonly<{
  show: boolean
  open: boolean
  onToggle: (open: boolean) => void
}>

export function PortalPreviewToggle({ show, open, onToggle }: Props) {
  if (!show) return null
  return (
    <div className="flex justify-end">
      <Button
        variant="outline"
        className="min-h-11 sm:min-h-9"
        onClick={() => onToggle(!open)}
        aria-pressed={open}
      >
        <Eye /> {open ? 'Hide preview' : 'Preview'}
      </Button>
    </div>
  )
}
