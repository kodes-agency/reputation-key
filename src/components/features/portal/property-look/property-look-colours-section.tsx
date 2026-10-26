// Colours (board 09): the accent, the background tint and what a guest will be
// able to read. The readout is the guest page's own arithmetic, so "Readable"
// here means readable there. An accent the page cannot show on its field is
// flagged, not refused: guests see it as light text, and the default palette
// every Property starts with is such an accent. Only a background that light
// text cannot be read on holds the save back.
import { Check, TriangleAlert } from 'lucide-react'
import { SegmentedControl } from '#/components/ui/segmented-control'
import { PropertyLookColourField } from './property-look-colour-field'
import { PropertyLookSection } from './property-look-section'
import {
  customFieldOf,
  readoutOf,
  readoutRows,
  type LookDraft,
} from './property-look-rules'

/** The part of a look the colour controls edit; a portal's own colours are exactly this. */
export type ColoursDraft = Pick<LookDraft, 'accent' | 'backgroundMode' | 'field'>

type FieldsProps = Readonly<{
  draft: ColoursDraft
  onChange: (patch: Partial<ColoursDraft>) => void
  disabled: boolean
  /**
   * Starts the DOM ids of the readout and the background label, so two looks
   * on one page (the Property's and a portal's) never share one.
   */
  idPrefix?: string
}>

type Props = Readonly<{
  draft: LookDraft
  onChange: (patch: Partial<LookDraft>) => void
  disabled: boolean
}>

const MODE_OPTIONS = [
  { value: 'auto', label: 'Automatic' },
  { value: 'manual', label: 'Custom' },
] as const

const PROPERTY_ID_PREFIX = 'property-look'

/** The accent, the background tint and what a guest can read: the controls, without the section around them. */
export function PropertyLookColoursFields({
  draft,
  onChange,
  disabled,
  idPrefix = PROPERTY_ID_PREFIX,
}: FieldsProps) {
  // The rules read a whole look; the wordmark is not theirs to look at here.
  const look: LookDraft = { ...draft, wordmark: '' }
  const readout = readoutOf(look)
  const rows = readout === null ? [] : readoutRows(readout)
  const isManual = draft.backgroundMode === 'manual'
  const readoutId = `${idPrefix}-readout`
  const labelId = `${idPrefix}-background-label`
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <PropertyLookColourField
            label="Accent"
            value={draft.accent}
            onCommit={(accent) => onChange({ accent })}
            disabled={disabled}
            describedBy={readoutId}
          />
          <p className="text-sm text-muted-foreground">Button, stars and highlights</p>
        </div>
        <div className="space-y-1.5">
          <span id={labelId} className="text-sm font-medium">
            Background tint
          </span>
          <SegmentedControl
            aria-labelledby={labelId}
            value={draft.backgroundMode}
            onValueChange={(mode) =>
              onChange(
                mode === 'manual'
                  ? { backgroundMode: 'manual', field: customFieldOf(look) }
                  : { backgroundMode: 'auto' },
              )
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
              describedBy={readoutId}
            />
          ) : (
            <p className="text-sm text-muted-foreground">Taken from the accent</p>
          )}
        </div>
      </div>
      <ul id={readoutId} aria-label="Readability" className="space-y-1 text-sm">
        {rows.length === 0 ? (
          <li className="text-muted-foreground">Enter a colour to check it.</li>
        ) : (
          rows.map((row) => (
            <li
              key={row.label}
              className={`flex items-center gap-2 ${row.isReadable || row.note !== null ? '' : 'text-negative'}`}
            >
              {row.isReadable ? (
                <Check className="size-4 shrink-0 text-positive" aria-hidden />
              ) : (
                <TriangleAlert className="size-4 shrink-0" aria-hidden />
              )}
              <span>
                {row.label} <span className="tabular-nums">{row.ratio}</span> ·{' '}
                {row.verdict}
                {row.note === null ? '' : ` · ${row.note}`}
              </span>
            </li>
          ))
        )}
      </ul>
    </>
  )
}

export function PropertyLookColoursSection({ draft, onChange, disabled }: Props) {
  return (
    <PropertyLookSection title="Colours" hint="Checked for readability on every page.">
      <PropertyLookColoursFields draft={draft} onChange={onChange} disabled={disabled} />
    </PropertyLookSection>
  )
}
