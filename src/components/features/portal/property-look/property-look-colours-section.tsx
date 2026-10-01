// Colours (board 09): the accent, the background tint and what a guest will be
// able to read. The readout is the guest page's own arithmetic, so "Readable"
// here means readable there; an accent the page could not read is not saved.
import { Check, TriangleAlert } from 'lucide-react'
import { SegmentedControl } from '#/components/ui/segmented-control'
import { PropertyLookColourField } from './property-look-colour-field'
import { PropertyLookSection } from './property-look-section'
import { readoutOf, readoutRows, type LookDraft } from './property-look-rules'

type Props = Readonly<{
  draft: LookDraft
  onChange: (patch: Partial<LookDraft>) => void
  disabled: boolean
}>

const MODE_OPTIONS = [
  { value: 'auto', label: 'Automatic' },
  { value: 'manual', label: 'Custom' },
] as const

const READOUT_ID = 'property-look-readout'

export function PropertyLookColoursSection({ draft, onChange, disabled }: Props) {
  const readout = readoutOf(draft)
  const rows = readout === null ? [] : readoutRows(readout)
  const isManual = draft.backgroundMode === 'manual'
  return (
    <PropertyLookSection title="Colours" hint="Checked for readability on every page.">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <PropertyLookColourField
            label="Accent"
            value={draft.accent}
            onCommit={(accent) => onChange({ accent })}
            disabled={disabled}
            invalid={readout !== null && !readout.accentOnField.isReadable}
            describedBy={READOUT_ID}
          />
          <p className="text-sm text-muted-foreground">Button, stars and highlights</p>
        </div>
        <div className="space-y-1.5">
          <span id="property-look-background-label" className="text-sm font-medium">
            Background tint
          </span>
          <SegmentedControl
            aria-labelledby="property-look-background-label"
            value={draft.backgroundMode}
            onValueChange={(mode) =>
              onChange({ backgroundMode: mode === 'manual' ? 'manual' : 'auto' })
            }
            options={MODE_OPTIONS}
            disabled={disabled}
          />
          {isManual ? (
            <PropertyLookColourField
              label="Background colour"
              value={draft.field}
              onCommit={(field) => onChange({ field })}
              disabled={disabled}
              invalid={readout !== null && !readout.smallText.isReadable}
              describedBy={READOUT_ID}
            />
          ) : (
            <p className="text-sm text-muted-foreground">Taken from the accent</p>
          )}
        </div>
      </div>
      <ul id={READOUT_ID} aria-label="Readability" className="space-y-1 text-sm">
        {rows.length === 0 ? (
          <li className="text-muted-foreground">Enter a colour to check it.</li>
        ) : (
          rows.map((row) => (
            <li
              key={row.label}
              className={`flex items-center gap-2 ${row.isReadable ? '' : 'text-negative'}`}
            >
              {row.isReadable ? (
                <Check className="size-4 shrink-0 text-positive" aria-hidden />
              ) : (
                <TriangleAlert className="size-4 shrink-0" aria-hidden />
              )}
              <span>
                {row.label} <span className="tabular-nums">{row.ratio}</span> ·{' '}
                {row.verdict}
              </span>
            </li>
          ))
        )}
      </ul>
    </PropertyLookSection>
  )
}
