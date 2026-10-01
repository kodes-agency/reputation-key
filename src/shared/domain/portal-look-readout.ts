// What the Property look page tells a manager about their colours before a guest
// meets them: the contrast of the three pairs the Immersive Hub actually draws.
// Pure, and built from the same arithmetic the guest page resolves its look
// with (`portal-field-colour`), so the readout and the page cannot disagree.

import {
  IMMERSIVE_TEXT_COLOUR,
  MIN_FIELD_TEXT_CONTRAST,
  MIN_TEXT_CONTRAST,
  contrastRatio,
  deriveFieldColour,
  isAccentReadableOnField,
  isFieldForLightText,
  parseHexColour,
  readableForegroundOn,
} from './portal-field-colour'

export type LookBackgroundMode = 'auto' | 'manual'

export type ContrastReading = Readonly<{
  ratio: number
  /** The ratio this pair has to reach. */
  minimum: number
  isReadable: boolean
}>

export type LookReadout = Readonly<{
  /** The dark colour the page is painted on. */
  field: string
  /** Text on a button filled with the accent. */
  buttonText: ContrastReading
  /** The page's small text on the field. */
  smallText: ContrastReading
  /** The accent itself (stars, highlights) on the field. */
  accentOnField: ContrastReading
  /** Whether the look may be saved: every pair above is readable. */
  isAcceptable: boolean
}>

type LookColours = Readonly<{
  accent: string
  backgroundMode: LookBackgroundMode
  /** Used only when the background is manual. */
  backgroundColour: string
}>

function reading(ratio: number | null, minimum: number): ContrastReading {
  const value = ratio ?? 0
  return { ratio: value, minimum, isReadable: value >= minimum }
}

/** The field a look paints: derived from the accent, or the chosen colour. Null when it is not a colour. */
export function lookFieldOf(colours: LookColours): string | null {
  if (parseHexColour(colours.accent) === null) return null
  const field =
    colours.backgroundMode === 'manual'
      ? colours.backgroundColour
      : deriveFieldColour(colours.accent)
  return field !== null && parseHexColour(field) !== null ? field.toUpperCase() : null
}

/** The readout for a look, or null while the accent or a manual background is not a `#rrggbb` colour. */
export function readLookContrast(colours: LookColours): LookReadout | null {
  const field = lookFieldOf(colours)
  if (field === null) return null
  const accent = colours.accent.toUpperCase()
  const accentReadable = isAccentReadableOnField(accent, field)
  // The page draws the text colour in place of an accent it cannot read.
  const drawnAccent = accentReadable ? accent : IMMERSIVE_TEXT_COLOUR
  const buttonText = reading(
    contrastRatio(readableForegroundOn(drawnAccent), drawnAccent),
    MIN_TEXT_CONTRAST,
  )
  const smallText = {
    ...reading(contrastRatio(IMMERSIVE_TEXT_COLOUR, field), MIN_FIELD_TEXT_CONTRAST),
    isReadable: isFieldForLightText(field),
  }
  const accentOnField = reading(contrastRatio(accent, field), MIN_TEXT_CONTRAST)
  return {
    field,
    buttonText,
    smallText,
    accentOnField,
    isAcceptable:
      buttonText.isReadable && smallText.isReadable && accentOnField.isReadable,
  }
}
