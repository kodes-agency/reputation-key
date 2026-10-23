// The colours of one print, from the property's look. Shared by the PDF and the
// Share tab's preview, so both paint the same card (spec 3).
//
// One palette per style, derived from the accent by the formulas the design
// boards use, with the contrast each token is held to named beside it. Immersive
// keeps the guest page's own dark field, so light text clears AAA on it whatever
// the accent (portal-field-colour.ts), and the two washes are the guest
// backdrop's, so a printed card and the page it opens look like one thing. Paper
// prints no background: the paper is the customer's.

import {
  contrastRatio,
  deriveBackdropTones,
  deriveFieldColour,
  mixColour,
  nudgeLightness,
  parseHexColour,
  relativeLuminance,
  toneOnTone,
} from './portal-field-colour'
import type { PrintKitStyle } from './portal-print-kit'

/** The ink of every Paper face and of the code's modules. */
export const PRINT_KIT_INK = '#121614'
/** What the board shows as the paper; the PDF prints no background, the paper is the customer's. */
export const PRINT_KIT_PAPER = '#FDFCF9'
/** Sublines on Paper: 7.1:1 on the paper. */
const PRINT_KIT_SOFT = '#5C5650'
/** Sublines on Immersive: the guest page's body text. */
const PRINT_KIT_BODY = '#F6F1E8'
/** The tile under the code: fixed, so any phone reads it. */
export const PRINT_KIT_TILE = '#F6F1E6'
const WHITE = '#FFFFFF'

/**
 * How strongly the washes are painted at their peak over the field. The guest
 * backdrop paints them at about twice this; on a card they sit behind small type
 * and a near-black field, so they are quieter.
 */
export const PRINT_KIT_WASH_ALPHA = 0.3

/** The contrast each token is held to, in the order the spec lists them. */
export const PRINT_KIT_CONTRAST = {
  /** Paper accent-ink: 6:1 rather than 4.5:1, because toner prints small type lighter. */
  paperAccentInk: 6,
  immersiveAccentInk: 7,
  accentLine: 3,
  /** The bar's text on its fill. */
  bar: 4.5,
  monoLine: 3,
} as const

/** The lift of the Immersive ridge band and of the monogram's ground, over the field. */
const LIFT_MIX = { ridge: 0.14, plate: 0.08 } as const
/** How far the monogram letter starts from the ground toward the accent line. */
const MONO_MIX = 0.6

type BarColours = Readonly<{
  /** The accent, moved away from `barText` until the pair reaches 4.5:1. */
  barFill: string
  /** Ink or white, whichever contrasts more with the accent. */
  barText: string
}>

export type PaperPrintKitPalette = BarColours &
  Readonly<{
    style: 'paper'
    paper: string
    ink: string
    soft: string
    /** The accent darkened to 6:1 on paper: second-language title, rules, tile outline. */
    accentInk: string
  }>

export type ImmersivePrintKitPalette = BarColours &
  Readonly<{
    style: 'immersive'
    field: string
    headline: string
    body: string
    /** The accent lightened to 7:1 on the field: the second-language title. */
    accentInk: string
    /** The accent lightened to 3:1 on the field: window frame, language rule, ridge hairline. */
    accentLine: string
    /** The ridge band over the fold. */
    lift: string
    /** The monogram window's ground. */
    plateTone: string
    /** The monogram letter, tone on tone with `plateTone`. */
    mono: string
    /** The two rules beside the monogram, 3:1 on `plateTone`. */
    monoLine: string
    /** The washes over the field, painted at `PRINT_KIT_WASH_ALPHA`. */
    warm: string
    cool: string
  }>

export type PrintKitPalette = PaperPrintKitPalette | ImmersivePrintKitPalette

/** The bar of the code block: its text, and its fill held at 4.5:1 against that text. */
function barColours(accent: string): BarColours {
  const barText =
    (contrastRatio(accent, PRINT_KIT_INK) ?? 0) >= (contrastRatio(accent, WHITE) ?? 0)
      ? PRINT_KIT_INK
      : WHITE
  const away = barText === PRINT_KIT_INK ? 1 : -1
  return {
    barFill: nudgeLightness(accent, barText, PRINT_KIT_CONTRAST.bar, away),
    barText,
  }
}

/** An accent the print can read, upper case; ink for one it cannot (stored accents are `#rrggbb`). */
function usableAccent(accent: string): string {
  return parseHexColour(accent) ? accent.toUpperCase() : PRINT_KIT_INK
}

export function paperPrintKitPalette(accent: string): PaperPrintKitPalette {
  const base = usableAccent(accent)
  return {
    style: 'paper',
    paper: PRINT_KIT_PAPER,
    ink: PRINT_KIT_INK,
    soft: PRINT_KIT_SOFT,
    accentInk: nudgeLightness(
      base,
      PRINT_KIT_PAPER,
      PRINT_KIT_CONTRAST.paperAccentInk,
      -1,
    ),
    ...barColours(base),
  }
}

/**
 * The Immersive palette. `field` is the property look's field; with none it is
 * the field derived from the accent, as the guest page derives it.
 */
export function immersivePrintKitPalette(
  accent: string,
  field: string | null,
): ImmersivePrintKitPalette {
  const base = usableAccent(accent)
  const ground =
    field !== null && parseHexColour(field)
      ? field.toUpperCase()
      : (deriveFieldColour(base) ?? PRINT_KIT_INK)
  const accentLine = nudgeLightness(base, ground, PRINT_KIT_CONTRAST.accentLine, 1)
  const plateTone = mixColour(ground, PRINT_KIT_BODY, LIFT_MIX.plate)
  const tones = deriveBackdropTones(base, ground)
  return {
    style: 'immersive',
    field: ground,
    headline: WHITE,
    body: PRINT_KIT_BODY,
    accentInk: nudgeLightness(base, ground, PRINT_KIT_CONTRAST.immersiveAccentInk, 1),
    accentLine,
    lift: mixColour(ground, PRINT_KIT_BODY, LIFT_MIX.ridge),
    plateTone,
    mono: toneOnTone(mixColour(plateTone, accentLine, MONO_MIX), plateTone),
    monoLine: nudgeLightness(accentLine, plateTone, PRINT_KIT_CONTRAST.monoLine, 1),
    warm: tones?.warm ?? ground,
    cool: tones?.cool ?? ground,
    ...barColours(base),
  }
}

/** Below this contrast with the paper a logo is too light to print on it alone (spec 3.1). */
const PAPER_LOGO_MIN_CONTRAST = 1.6

/**
 * Whether a logo whose drawing has `luminance` (relative, alpha-weighted, 0 to
 * 1) needs a plate to print on paper: a cream or white logo made for a dark page
 * would vanish. Its plate is the field colour the accent derives.
 */
export function logoNeedsPaperPlate(luminance: number | null): boolean {
  if (luminance === null) return false
  const paper = relativeLuminance(PRINT_KIT_PAPER) ?? 1
  const ratio = (Math.max(paper, luminance) + 0.05) / (Math.min(paper, luminance) + 0.05)
  return ratio < PAPER_LOGO_MIN_CONTRAST
}

/** The plate under a light logo on paper: the field the accent derives, as the guest page's. */
export function paperLogoPlate(accent: string): string {
  return deriveFieldColour(usableAccent(accent)) ?? PRINT_KIT_INK
}

/** Below this alpha-weighted luminance a logo is too dark to read on the Immersive field (spec 3.2). */
const DARK_LOGO_LUMINANCE = 0.35

/** The plate under a dark logo on the Immersive field: the code tile's cream. */
export const IMMERSIVE_LOGO_PLATE = PRINT_KIT_TILE

/**
 * Whether a logo whose drawing has `luminance` needs the cream plate to print on
 * the Immersive field: a dark logo made for a light page would vanish into it.
 */
export function logoNeedsCreamPlate(luminance: number | null): boolean {
  return luminance !== null && luminance < DARK_LOGO_LUMINANCE
}

/** The palette of one style, from the property's accent and field. */
export function printKitPalette(
  accent: string,
  field: string | null,
  style: 'paper',
): PaperPrintKitPalette
export function printKitPalette(
  accent: string,
  field: string | null,
  style: 'immersive',
): ImmersivePrintKitPalette
export function printKitPalette(
  accent: string,
  field: string | null,
  style: PrintKitStyle,
): PrintKitPalette
export function printKitPalette(
  accent: string,
  field: string | null,
  style: PrintKitStyle,
): PrintKitPalette {
  return style === 'paper'
    ? paperPrintKitPalette(accent)
    : immersivePrintKitPalette(accent, field)
}
