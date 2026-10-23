// The type and the logo per size (round-3 spec-delta S3, S4): the type steps of
// each face, the logo's optical sizes and the fit steps of a two-language Table
// card. The spacing, the band and what each size drops are
// `portal-print-kit-sizes.ts`; the code tile is `portal-print-kit-code-tile.ts`.
//
// Type is in points. The roles are those of round-2 R2: the property name under
// a logo, the eyebrow (the portal title), the call to action (the largest line),
// its sub-line and, on Table and Large, the second language's call to action.
// Nothing draws from this yet: today's faces read `TYPE_PT` in
// `portal-print-kit-measures.ts`, which goes when the faces move over.

import { BAND, type FaceKind } from './portal-print-kit-sizes'
import type { PrintKitStyle } from './portal-print-kit'

/** What a guest reads on a Mini card is the one text under 9 pt (the cue and the sub-line), at 8. */
export const MINI_READ_FLOOR_PT = 8

export type FaceType = Readonly<{
  /** The property name under a logo, a caption that repeats the logo; null where it is dropped. */
  name: number | null
  /** The portal title above the call to action; null where it is dropped. */
  eyebrow: number | null
  /** The call to action, the largest line: Immersive and Paper set it at different sizes. */
  ctaImmersive: number
  ctaPaper: number
  sub: number
  /** The second language's call to action; null where it is not on the face. */
  cta2: number | null
  /** The brand's wordmark, for a property with no logo. */
  wordmark: number
}>

export const FACE_TYPE_PT: Readonly<Record<FaceKind, FaceType>> = {
  large: {
    name: 8.5,
    eyebrow: 10,
    ctaImmersive: 28,
    ctaPaper: 30,
    sub: 11,
    cta2: 15,
    wordmark: 16,
  },
  table: {
    name: 7.5,
    eyebrow: 9,
    ctaImmersive: 24,
    ctaPaper: 26,
    sub: 9.5,
    cta2: 13,
    wordmark: 14,
  },
  tent: {
    name: null,
    eyebrow: 9,
    ctaImmersive: 20,
    ctaPaper: 26,
    sub: 9.5,
    cta2: null,
    wordmark: 13,
  },
  mini: {
    name: null,
    eyebrow: null,
    ctaImmersive: 17,
    ctaPaper: 18,
    sub: 8,
    cta2: null,
    wordmark: 11,
  },
}

/**
 * How big a logo prints. A logo is sized by its optical size, not its height:
 * the geometric mean of the drawn width and height (in millimetres) is held at
 * `opticalMm`, so a square mark and a wide badge look as large as each other, and
 * the height is then clamped between its floor and ceiling and the width to its
 * ceiling.
 */
export type LogoOptical = Readonly<{
  opticalMm: number
  heightMinMm: number
  heightMaxMm: number
  widthMaxMm: number
}>

export const LOGO_OPTICAL: Readonly<
  Record<FaceKind, Readonly<Record<PrintKitStyle, LogoOptical>>>
> = {
  large: {
    immersive: { opticalMm: 15, heightMinMm: 9.5, heightMaxMm: 13, widthMaxMm: 32 },
    paper: { opticalMm: 17, heightMinMm: 10.5, heightMaxMm: 14, widthMaxMm: 38 },
  },
  table: {
    immersive: { opticalMm: 12.5, heightMinMm: 8, heightMaxMm: 10.5, widthMaxMm: 28 },
    paper: { opticalMm: 14.5, heightMinMm: 9, heightMaxMm: 12, widthMaxMm: 32 },
  },
  tent: {
    immersive: { opticalMm: 12, heightMinMm: 8, heightMaxMm: 10, widthMaxMm: 28 },
    paper: { opticalMm: 14, heightMinMm: 9, heightMaxMm: 12, widthMaxMm: 40 },
  },
  mini: {
    immersive: { opticalMm: 10, heightMinMm: 6.5, heightMaxMm: 8.5, widthMaxMm: 22 },
    paper: { opticalMm: 11, heightMinMm: 7, heightMaxMm: 9, widthMaxMm: 24 },
  },
}

/**
 * The height, in millimetres, a logo of `aspect` (width over height, measured to
 * its ink) prints at. The width ceiling wins over the height floor, so a very
 * wide mark gets shorter than the floor rather than wider than the box.
 */
export function logoOpticalHeightMm(aspect: number, optical: LogoOptical): number {
  const held = optical.opticalMm / Math.sqrt(aspect)
  return Math.min(
    optical.heightMaxMm,
    Math.max(optical.heightMinMm, held),
    optical.widthMaxMm / aspect,
  )
}

export type SizeFitStep = Readonly<{
  step: 'band' | 'cta' | 'sub' | 'cta2'
  /** Where the step starts and where it stops: points of type, or points of band height. */
  from: number
  to: number
}>

/**
 * The steps a two-language Immersive Table card takes when it is tight, in order,
 * each only once the one before is used up: the band to its minimum, the call to
 * action 24 to 21 pt, the lead sub-line 9.5 to 9 pt, the second call to action 13
 * to 12 pt. The spec-delta's board lands exactly at the group-gap minimum (12 pt),
 * which makes it the densest in the set. The spec-delta also lists a fifth step
 * (the two-line bar, 0.42 to 0.38 in); its boards and its code-tile table both
 * draw the two-line bar at 0.38 in with no step, so there is none here.
 */
export const TABLE_TWO_LANGUAGE_FIT: readonly SizeFitStep[] = [
  { step: 'band', from: BAND.table.targetPt, to: BAND.table.minPt },
  { step: 'cta', from: FACE_TYPE_PT.table.ctaImmersive, to: 21 },
  { step: 'sub', from: FACE_TYPE_PT.table.sub, to: 9 },
  { step: 'cta2', from: 13, to: 12 },
]

/**
 * How small the Table call to action may go to stay on one line, where the steps
 * above leave it too wide for its column. Only the Europe EN + BG board needs it
 * (spec-delta S4: 20 pt): measured in the embedded font, the Bulgarian call to
 * action is 228.9 pt at 21 pt and 218.0 pt at 20 pt, in a 219.1 pt column. A card
 * that fits at 21 pt, such as EN + ES, stops there and does not use this room.
 */
export const TABLE_CTA_ONE_LINE_FLOOR_PT = 20
