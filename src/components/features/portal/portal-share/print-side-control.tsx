// The side of the card the Print cards preview shows (design spec
// §10.4): Front or Back, drawn only where the print has a back page. The face and
// the sheet under it follow it, so a manager sees the reverse of a sheet before
// printing it.

import { SegmentedControl } from '#/components/ui/segmented-control'
import type { PrintSide } from '#/shared/domain/portal-print-back-copy'

const OPTIONS = [
  { value: 'front', label: 'Front' },
  { value: 'back', label: 'Back' },
] as const

type Props = Readonly<{
  side: PrintSide
  onChange: (side: PrintSide) => void
}>

export function PrintSideControl({ side, onChange }: Props) {
  return (
    <SegmentedControl
      aria-label="Side of the card"
      value={side}
      onValueChange={(value) => onChange(value as PrintSide)}
      options={OPTIONS}
    />
  )
}
