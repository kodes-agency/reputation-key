import { useId } from 'react'
import { ImageOff, LayoutTemplate } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { Checkbox } from '#/components/ui/checkbox'
import { Label } from '#/components/ui/label'
import {
  renderMaskedLayoutSvg,
  summarizeMaskedLayout,
  type MaskedLayout,
} from '#/shared/beta-feedback-layout'

type Props = Readonly<{
  layout: MaskedLayout | null
  included: boolean
  onIncludedChange: (included: boolean) => void
  onRemove: () => void
  disabled?: boolean
}>

function LayoutPreview({ layout }: Readonly<{ layout: MaskedLayout }>) {
  // The SVG is built from validated integers by `renderMaskedLayoutSvg`; no
  // page markup is ever parsed back, so this renders what will be sent rather
  // than an approximation of it.
  const svg = renderMaskedLayoutSvg(layout)
  const dataUri = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`

  return (
    <img
      src={dataUri}
      alt={`Masked layout preview: ${summarizeMaskedLayout(layout)}`}
      width={layout.width}
      height={layout.height}
      className="max-h-60 w-full rounded-md border bg-muted/40 object-contain"
    />
  )
}

/**
 * Explicit per-submission consent, with the preview and removal BETA.md §3
 * requires. Off by default, and what the reporter sees IS what is sent: blocks
 * and their positions, never a pixel of the page.
 */
export function BetaFeedbackLayoutConsent({
  layout,
  included,
  onIncludedChange,
  onRemove,
  disabled,
}: Props) {
  const checkboxId = useId()

  if (!layout) return null

  return (
    <div className="space-y-3 rounded-lg border bg-muted/25 p-3">
      <div className="flex items-start gap-2">
        <Checkbox
          id={checkboxId}
          checked={included}
          onCheckedChange={(value) => onIncludedChange(value === true)}
          disabled={disabled}
          className="mt-0.5"
        />
        <Label htmlFor={checkboxId} className="block space-y-1 font-normal">
          <span className="flex items-center gap-1.5 text-sm font-medium">
            <LayoutTemplate className="size-4 text-muted-foreground" aria-hidden="true" />
            Include a masked picture of this page
          </span>
          <span className="block text-xs leading-snug text-muted-foreground">
            Blocks and their positions only — no text, no images, no names. It helps us
            see a layout problem. Kept for at most 30 days, then deleted.
          </span>
        </Label>
      </div>

      {included && (
        <div className="space-y-2">
          <LayoutPreview layout={layout} />
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">This is exactly what is sent.</p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="gap-1.5"
              onClick={onRemove}
              disabled={disabled}
            >
              <ImageOff className="size-3.5" />
              Remove
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
