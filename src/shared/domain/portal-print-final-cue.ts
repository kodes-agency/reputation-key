// The scan cue in the final code block's bar (final design spec §5.2, review 3):
// one short cue per language that fits one line on every bar, measured with the
// font and centred in the bar by its ink. A one-language cue that would still
// break the bar's side padding wraps at the space nearest its middle into the
// two-line bar (the fallback; the cues below never need it); a two-language bar
// holds one line per language and never wraps.
//
// Pure and shared. The PDF measures a cue with the guest fonts' own outlines;
// the Share tab's preview estimates it from the width tables, which err wide, so
// a cue the file keeps on one line is never wrapped by the file and left whole by
// the preview.

import type { GuestLocale } from './guest-locale'
import { mmPt } from './portal-print-final-measures'
import type {
  PrintFinalTextMeasurer,
  PrintFinalTextStyle,
} from './portal-print-final-text'
import { PRINT_FINAL_TYPE_SETTINGS } from './portal-print-final-type'

/**
 * The cue per language: what the phone is for, short enough for the narrowest bar
 * (the US Small card: 27.8 mm at 8 pt between one cap height each side). The
 * wider wording ("Scannez avec l’appareil photo", "Mit der Kamera scannen",
 * "Inquadri con la fotocamera", "Сканирайте с камерата") broke the padding on
 * tents and Small cards. Drafts no native speaker has checked yet (the closed
 * beta allows them, as the rest of the copy does): the es, it, fr, de and bg
 * cues need a native check, and a longer replacement must still fit.
 */
export const PRINT_FINAL_SCAN_CUE: Readonly<Record<GuestLocale, string>> = Object.freeze({
  en: 'Scan with your camera',
  es: 'Escanee con la cámara',
  bg: 'Сканирайте с камера',
  it: 'Apra la fotocamera',
  fr: 'Scannez avec la caméra',
  de: 'Mit Kamera scannen',
})

/** Fixed rule C: a cue keeps one cap height (0.7 × its size) of bar each side. */
const CUE_PADDING_CAPS = 0.7

/** How a cue line is set: Ysabeau Office 600, untracked, 1.12 line boxes. */
export function printFinalCueStyle(cuePt: number): PrintFinalTextStyle {
  return {
    family: 'sans',
    weight: 600,
    italic: false,
    sizePt: cuePt,
    trackingEm: 0,
    leading: PRINT_FINAL_TYPE_SETTINGS.cue.leading,
    caps: false,
  }
}

/** What a cue line may measure: the tile less its padding each side. */
const cueRoomPt = (tilePt: number, cuePt: number): number =>
  tilePt - 2 * CUE_PADDING_CAPS * cuePt

/**
 * The cue's lines: one per language, the first on top. One language whose cue
 * would break the padding wraps at the space nearest its middle into the
 * two-line bar. The width is the measurer's, so the file wraps by the font and
 * the preview by its estimate.
 */
export function printFinalCueLines(
  cues: readonly string[],
  tilePt: number,
  cuePt: number,
  measurer: PrintFinalTextMeasurer,
): readonly string[] {
  const [only] = cues
  if (cues.length !== 1 || only === undefined) return cues
  const style = printFinalCueStyle(cuePt)
  if (measurer.advancePt(only, style) <= cueRoomPt(tilePt, cuePt)) return cues
  const middle = only.length / 2
  const spaces = [...only]
    .map((ch, index) => (ch === ' ' && index > 0 ? index : -1))
    .filter((index) => index > 0)
    .sort((a, b) => Math.abs(a - middle) - Math.abs(b - middle))
  const at = spaces[0]
  return at === undefined ? cues : [only.slice(0, at), only.slice(at + 1)]
}

/**
 * Whether every cue line keeps rule C's padding. Two languages print one cue a
 * line and cannot wrap, so a pair with a cue too long for the bar does not fit:
 * the file would set text across the bar's edge. A single language always fits
 * once it has wrapped, unless it is one long word.
 */
export function printFinalCuesFit(
  lines: readonly string[],
  tilePt: number,
  cuePt: number,
  measurer: PrintFinalTextMeasurer,
): boolean {
  const style = printFinalCueStyle(cuePt)
  const room = cueRoomPt(tilePt, cuePt)
  return lines.every((line) => measurer.advancePt(line, style) <= room)
}

/**
 * Where each cue line's baseline goes, in points from the bar's top, with the
 * lines centred in the bar by their ink (the highest glyph of the first line to
 * the deepest of the last), not by their line boxes: a descender in the lower
 * line (Bulgarian "р", Italian "p") otherwise sits under the middle of the bar
 * and leaves rule C's 0.5 mm short on the Small card's 0.30 in bar. The lines
 * are one line box (1.12 × the cue) plus the 0.3 mm gap apart.
 */
export function placePrintFinalCues(
  lines: readonly string[],
  cuePt: number,
  barPt: number,
  measurer: PrintFinalTextMeasurer,
): readonly number[] {
  const style = printFinalCueStyle(cuePt)
  const pitch = cuePt * style.leading + mmPt(PRINT_FINAL_TYPE_SETTINGS.cue.lineGapMm)
  const inks = lines.map((line) => measurer.ink(line, style))
  const top = Math.min(...inks.map((ink, index) => index * pitch - ink.ascentPt))
  const bottom = Math.max(...inks.map((ink, index) => index * pitch + ink.descentPt))
  const first = barPt / 2 - (top + bottom) / 2
  return lines.map((_, index) => first + index * pitch)
}
