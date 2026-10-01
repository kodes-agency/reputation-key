// The Immersive Hub look: what a snapshot's two brand colours become on the
// page. It replaces `portal-theme-style.ts` for schema version 3.
//
// The page is always dark and its text always light, so the look cannot be the
// manager's alone to get wrong: the accent and the field arrive from a snapshot
// that was valid when published, but a manual field may be any colour, and an
// accent may be darker than the field it sits on. Every colour this returns is
// therefore checked here with the same arithmetic the Brand Profile writer and
// the publication builder use (`portal-field-colour`), and a colour that would
// not be readable is replaced rather than drawn. Legibility is a property of
// the resolver, not of the data.
//
// Pure, and the only place CSS custom-property values are made: each is a
// validated `#RRGGBB`, so nothing a manager typed can reach a stylesheet.

import {
  contrastRatio,
  deriveBackdropTones,
  deriveFieldColour,
  isAccentReadableOnField,
  parseHexColour,
  readableForegroundOn,
} from '#/shared/domain/portal-field-colour'

/** Champagne: the accent of a property that has no brand colour of its own. */
export const DEFAULT_IMMERSIVE_ACCENT = '#EAD6A8'
/** Body text on the field. Headings are white; this is the warm off-white of the board. */
export const IMMERSIVE_TEXT_COLOUR = '#F6F1E8'
/**
 * Light text must clear this on the field. AAA for normal text, because the
 * quietest text on the page (the visit notice) is drawn at two-thirds opacity
 * and still has to reach AA.
 */
export const MIN_FIELD_TEXT_CONTRAST = 7

export type ImmersiveBrandColours = Readonly<{
  accentColour: string
  fieldColour: string
}>

export type ImmersiveLookVariable =
  | '--ih-field'
  | '--ih-accent'
  | '--ih-on-accent'
  | '--ih-wash-warm'
  | '--ih-wash-cool'
  | '--ih-wash-deep'

export type ImmersiveLook = Readonly<{
  /** The dark colour the page is painted on. */
  field: string
  /** The accent as the page draws it: readable on `field`, or the text colour. */
  accent: string
  /** Text and icons drawn on a fill of `accent`. */
  onAccent: string
  /** Inline custom properties for the page root. */
  style: Readonly<Record<ImmersiveLookVariable, string>>
}>

/** A strict `#rrggbb`, upper-cased, or null. */
function normalisedHex(value: string): string | null {
  return parseHexColour(value) ? value.toUpperCase() : null
}

function isFieldForLightText(field: string): boolean {
  return (contrastRatio(IMMERSIVE_TEXT_COLOUR, field) ?? 0) >= MIN_FIELD_TEXT_CONTRAST
}

/** The stored field when light text can be read on it, else the accent's derived field. */
function resolveField(stored: string, accent: string): string {
  const candidate = normalisedHex(stored)
  if (candidate && isFieldForLightText(candidate)) return candidate
  // The derived field is near-black at any accent, so the accent is known valid here.
  return (
    deriveFieldColour(accent) ?? (deriveFieldColour(DEFAULT_IMMERSIVE_ACCENT) as string)
  )
}

export function resolveImmersiveLook(brand: ImmersiveBrandColours): ImmersiveLook {
  const accent = normalisedHex(brand.accentColour) ?? DEFAULT_IMMERSIVE_ACCENT
  const field = resolveField(brand.fieldColour, accent)
  const drawnAccent = isAccentReadableOnField(accent, field)
    ? accent
    : IMMERSIVE_TEXT_COLOUR
  const onAccent = readableForegroundOn(drawnAccent)
  // The accent is validated above, so its tones exist.
  const tones = deriveBackdropTones(accent) as NonNullable<
    ReturnType<typeof deriveBackdropTones>
  >
  return {
    field,
    accent: drawnAccent,
    onAccent,
    style: {
      '--ih-field': field,
      '--ih-accent': drawnAccent,
      '--ih-on-accent': onAccent,
      '--ih-wash-warm': tones.warm,
      '--ih-wash-cool': tones.cool,
      '--ih-wash-deep': tones.deep,
    },
  }
}
