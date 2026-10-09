// The Immersive Hub look: what a snapshot's two brand colours become on the
// page. It replaces `portal-theme-style.ts` for schema version 3.
//
// The page is always dark and its text always light, so the look cannot be the
// manager's alone to get wrong: the accent and the field arrive from a snapshot
// that was valid when published, but a manual field may be any colour, and an
// accent may be darker than the field it sits on. Every colour this returns is
// therefore checked here with the same arithmetic the Brand Profile writer and
// the publication builder use (`portal-field-colour`), and a colour that would
// not be readable is replaced rather than drawn. The washes over the field are
// darkened where their hue is bright, and the photo backdrop is bounded by the
// constants below whatever the photo (the worst case, a white one, is pinned in
// the tests). Legibility is a property of the resolver, not of the data.
//
// Pure, and the only place CSS custom-property values are made: each is a
// validated `#RRGGBB`, so nothing a manager typed can reach a stylesheet.

import {
  IMMERSIVE_TEXT_COLOUR,
  MIN_FIELD_TEXT_CONTRAST,
  MIN_TEXT_CONTRAST,
  contrastRatio,
  deriveBackdropTones,
  deriveFieldColour,
  isAccentReadableOnField,
  isFieldForLightText,
  parseHexColour,
  readableForegroundOn,
} from '#/shared/domain/portal-field-colour'
import { heroBackgroundsOf, mix as over, type Rgb } from './immersive-hero-scrim'

export { IMMERSIVE_TEXT_COLOUR, MIN_FIELD_TEXT_CONTRAST }

/** Champagne: the accent of a property that has no brand colour of its own. */
export const DEFAULT_IMMERSIVE_ACCENT = '#EAD6A8'
/**
 * The photo backdrop, drawn so no photo can make it too bright for the page
 * text: the photo at `brightness`, a layer of the field over it (`fieldMix`),
 * and two washes at their painted strength. The stylesheet is built from these.
 */
export const PHOTO_BACKDROP = {
  brightness: 0.35,
  fieldMix: 0.45,
  warmWash: 0.2,
  coolWash: 0.34,
} as const

/** The share of white mixed into the field for glass where `backdrop-filter` is missing. */
const GLASS_SOLID_WHITE = 0.06

export type ImmersiveBrandColours = Readonly<{
  accentColour: string
  fieldColour: string
}>

export type ImmersiveLookVariable =
  | '--ih-field'
  | '--ih-text'
  | '--ih-glass-solid'
  | '--ih-accent'
  | '--ih-on-accent'
  | '--ih-kicker-photo'
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

/** `#RRGGBB` of `base` with `share` of white mixed in; `base` is a validated colour. */
function liftedFrom(base: string, share: number): string {
  const channels = parseHexColour(base) as readonly number[]
  return `#${channels
    .map((channel) =>
      Math.round(channel * (1 - share) + 255 * share)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')
    .toUpperCase()}`
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

/** The share of white in the page's accent text: `--ih-accent-text` in the stylesheet mixes the accent 88% with white. */
const ACCENT_TEXT_WHITE_SHARE = 0.12

/**
 * The title's kicker over a photo. It is small (11 px), so it needs 4.5:1, and a
 * photo is not the field: the worst one a manager can upload is white, and the
 * hero's scrims (`immersive-hero-scrim.ts`) dim it only so far. The accent
 * draws the kicker where it clears that on that worst photo, in every place the
 * wordmark and title can sit (the bare backdrop and under each wash); an accent
 * that does not, a dark one, gives way to the page's text colour. A page with no
 * photo draws the kicker on the field in the accent as always.
 */
function kickerOnPhoto(
  accent: string,
  field: string,
  tones: Readonly<{ warm: string; cool: string }>,
): string {
  const text = liftedFrom(accent, ACCENT_TEXT_WHITE_SHARE)
  const photo = [255, 255, 255].map((channel) => channel * PHOTO_BACKDROP.brightness)
  const base = over(
    parseHexColour(field) as Rgb,
    PHOTO_BACKDROP.fieldMix,
    photo as unknown as Rgb,
  )
  const backdrops = [
    base,
    over(parseHexColour(tones.warm) as Rgb, PHOTO_BACKDROP.warmWash, base),
    over(parseHexColour(tones.cool) as Rgb, PHOTO_BACKDROP.coolWash, base),
  ]
  const isReadable = backdrops.every((backdrop) =>
    heroBackgroundsOf('kicker', backdrop).every(
      (background) => (contrastRatio(text, background) ?? 0) >= MIN_TEXT_CONTRAST,
    ),
  )
  return isReadable ? text : IMMERSIVE_TEXT_COLOUR
}

export function resolveImmersiveLook(brand: ImmersiveBrandColours): ImmersiveLook {
  const accent = normalisedHex(brand.accentColour) ?? DEFAULT_IMMERSIVE_ACCENT
  const field = resolveField(brand.fieldColour, accent)
  const drawnAccent = isAccentReadableOnField(accent, field)
    ? accent
    : IMMERSIVE_TEXT_COLOUR
  const onAccent = readableForegroundOn(drawnAccent)
  // The accent and the field are validated above, so the tones exist.
  const tones = deriveBackdropTones(accent, field) as NonNullable<
    ReturnType<typeof deriveBackdropTones>
  >
  return {
    field,
    accent: drawnAccent,
    onAccent,
    style: {
      '--ih-field': field,
      '--ih-text': IMMERSIVE_TEXT_COLOUR,
      '--ih-glass-solid': liftedFrom(field, GLASS_SOLID_WHITE),
      '--ih-accent': drawnAccent,
      '--ih-on-accent': onAccent,
      '--ih-kicker-photo': kickerOnPhoto(drawnAccent, field, tones),
      '--ih-wash-warm': tones.warm,
      '--ih-wash-cool': tones.cool,
      '--ih-wash-deep': tones.deep,
    },
  }
}
