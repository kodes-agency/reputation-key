// "Download" on the code block: the code as a PNG or as an SVG. "Download again"
// when the address is not in memory and will be fetched for the file.

import { ChevronDown, Download } from 'lucide-react'
import { Button } from '#/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import type { QrFormat } from './portal-qr'

type Props = Readonly<{
  disabled: boolean
  /** The address is not in memory: say the file comes from a fresh fetch. */
  again?: boolean
  onDownload: (format: QrFormat) => void
}>

const FORMATS: readonly Readonly<{ format: QrFormat; label: string; hint: string }>[] = [
  { format: 'png', label: 'PNG image', hint: 'For screens and everyday printing' },
  { format: 'svg', label: 'SVG file', hint: 'For print shops and designers' },
]

export function PortalDownloadMenu({ disabled, again = false, onDownload }: Props) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" disabled={disabled} className="min-h-11 sm:min-h-9">
          <Download data-icon="inline-start" /> {again ? 'Download again' : 'Download'}
          <ChevronDown data-icon="inline-end" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        {FORMATS.map(({ format, label, hint }) => (
          <DropdownMenuItem
            key={format}
            className="min-h-11 sm:min-h-9"
            onSelect={() => onDownload(format)}
          >
            <span className="flex flex-col">
              <span>{label}</span>
              <span className="text-xs text-muted-foreground">{hint}</span>
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
