import { useState } from 'react'
import { Eye, ImageOff, ShieldCheck } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { Checkbox } from '#/components/ui/checkbox'
import type { MaskedLayoutSnapshot } from '#/shared/beta-feedback-contract'
import { isBetaFeedbackAttachmentAllowed } from '#/shared/beta-feedback-contract'
import { captureMaskedLayoutSnapshot } from './masked-layout-capture'

type Props = Readonly<{
  value: MaskedLayoutSnapshot | undefined
  onChange: (value: MaskedLayoutSnapshot | undefined) => void
  disabled: boolean
}>

const fillByKind: Readonly<
  Record<MaskedLayoutSnapshot['blocks'][number]['kind'], string>
> = {
  surface: '#e2e8f0',
  text: '#64748b',
  input: '#94a3b8',
  image: '#cbd5e1',
  media: '#a8b3c2',
}

function MaskedLayoutPreview({ snapshot }: Readonly<{ snapshot: MaskedLayoutSnapshot }>) {
  return (
    <svg
      viewBox={`0 0 ${String(snapshot.gridWidth)} ${String(snapshot.gridHeight)}`}
      className="max-h-52 w-full rounded-md border bg-slate-50"
      role="img"
      aria-label="Masked layout preview"
    >
      <rect width="100%" height="100%" fill="#f8fafc" />
      {snapshot.blocks.map((block, index) => (
        <rect
          // Geometry is quantized and duplicate blocks are removed before render.
          key={`${block.kind}:${String(block.x)}:${String(block.y)}:${String(index)}`}
          x={block.x}
          y={block.y}
          width={block.width}
          height={block.height}
          rx={1}
          fill={fillByKind[block.kind]}
        />
      ))}
    </svg>
  )
}

/** Bug-only, per-submission consent. Checking the box does not capture yet. */
export function MaskedLayoutAttachmentControl({ value, onChange, disabled }: Props) {
  const [consented, setConsented] = useState(false)
  const routePath = typeof window === 'undefined' ? '/' : window.location.pathname
  const allowed = isBetaFeedbackAttachmentAllowed(routePath)

  if (!allowed) {
    return (
      <div className="flex gap-2 rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">
        <ImageOff className="mt-0.5 size-4 shrink-0" />
        <p>
          A visual preview is unavailable on this page because it may contain private or
          provider information. You can still send the bug report without one.
        </p>
      </div>
    )
  }

  if (value) {
    return (
      <div className="space-y-3 rounded-md border p-3">
        <div className="flex items-start gap-2 text-sm">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <p>
            Preview ready. It shows only a low-resolution page layout; all text, form
            values, images, and media are replaced with neutral blocks.
          </p>
        </div>
        <MaskedLayoutPreview snapshot={value} />
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={() => {
            onChange(undefined)
            setConsented(false)
          }}
        >
          Remove preview
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-3 rounded-md border p-3">
      <div className="flex items-start gap-2">
        <Checkbox
          id="beta-bug-masked-preview-consent"
          checked={consented}
          disabled={disabled}
          onCheckedChange={(checked) => setConsented(checked === true)}
        />
        <label htmlFor="beta-bug-masked-preview-consent" className="text-sm leading-snug">
          Include a masked layout preview with this bug report. RepKey will start creating
          it only after I choose “Create preview”.
        </label>
      </div>
      <p className="text-xs text-muted-foreground">
        The preview contains no page text, input values, images, media, or replay. It is
        marked to expire within 30 days. You can inspect and remove it before sending.
      </p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled || !consented}
        onClick={() => onChange(captureMaskedLayoutSnapshot())}
      >
        <Eye className="size-4" />
        Create preview
      </Button>
    </div>
  )
}
