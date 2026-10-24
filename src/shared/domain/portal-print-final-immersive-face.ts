// One Immersive final face, laid out and painted (final design spec §4 and §6):
// the face laid out as any final face is (`layoutPrintFinalFace`), its colours
// from the photo, its art, and the two decisions that read the photo's pixels.
//
//   - The plate (§4): the logo sits on the cream plate unless it is light (its
//     median ink luminance 0.4 or more) and reaches 4.5:1 against a 1.5 mm ring
//     round it where the face puts it, read with the logo straight on the photo.
//   - The scrims (§6.3): deepened 0.06 at a time, up to 0.30, until every word
//     reaches 4.6:1 against the 95th-percentile brightness under it (the
//     generator's threshold: 4.5:1 with a tenth to spare for rounding).
//
// Pure and shared: the PDF and the Share tab's preview call this with their own
// measures and their own decode of the same photo.

import type { PrintFinalFace } from './portal-print-final'
import { printFinalArt, type PrintFinalArt } from './portal-print-final-art'
import { printFinalLogoOnPlate } from './portal-print-final-brand'
import type { PrintFinalTile } from './portal-print-final-code'
import {
  printFinalImmersiveColours,
  printFinalToneColour,
  type PrintFinalColours,
} from './portal-print-final-colours'
import {
  printFinalRingContrast,
  printFinalScene,
  printFinalTextContrast,
  type PrintFinalScenePhoto,
} from './portal-print-final-contrast'
import {
  layoutPrintFinalFace,
  type PrintFinalFaceLayout,
} from './portal-print-final-face'
import {
  printFinalImmersivePalette,
  type PrintFinalImmersivePalette,
} from './portal-print-final-immersive'
import type { PrintFinalBleed } from './portal-print-final-layers'
import type { PrintFinalPlacedPart } from './portal-print-final-parts'
import type { PrintFinalTextMeasurer } from './portal-print-final-text'
import type { PrintTextBlock } from './portal-print-kit'

/** The brand: the property's name, or its logo by its drawn pixels with how light its ink is. */
export type PrintFinalImmersiveBrand =
  | Readonly<{ kind: 'wordmark'; text: string }>
  | Readonly<{
      kind: 'logo'
      inkWidth: number
      inkHeight: number
      /** The median luminance of the logo's printed pixels; null when it could not be read (the plate then). */
      medianInkLuminance: number | null
    }>

export type PrintFinalImmersiveFaceInput = Readonly<{
  face: PrintFinalFace
  blocks: readonly PrintTextBlock[]
  brand: PrintFinalImmersiveBrand
  tile: PrintFinalTile
  measurer: PrintFinalTextMeasurer
  accentColour: string
  fieldColour: string
  photo: PrintFinalScenePhoto | null
  bleed?: PrintFinalBleed
}>

export type PrintFinalWordContrast = Readonly<{
  key: PrintFinalPlacedPart['key']
  ratio: number
}>

export type PrintFinalImmersiveFace = Readonly<{
  layout: PrintFinalFaceLayout
  palette: PrintFinalImmersivePalette
  colours: PrintFinalColours
  art: PrintFinalArt
  /** How much the scrims were deepened: 0 to 0.30. */
  boost: number
  /** Each word's contrast against the face under it, at that boost. */
  contrasts: readonly PrintFinalWordContrast[]
  logoOnPlate: boolean
}>

/** The scrims deepen this much at a time, up to the most (§6.3). */
export const PRINT_FINAL_SCRIM_BOOST = Object.freeze({ step: 0.06, max: 0.3 })
/** Every word reaches this before the scrims stop deepening. */
const WORD_CONTRAST_TARGET = 4.6

function layoutWith(
  input: PrintFinalImmersiveFaceInput,
  onPlate: boolean,
): PrintFinalFaceLayout {
  const { brand } = input
  return layoutPrintFinalFace({
    face: input.face,
    blocks: input.blocks,
    brand:
      brand.kind === 'wordmark'
        ? brand
        : { kind: 'logo', inkWidth: brand.inkWidth, inkHeight: brand.inkHeight, onPlate },
    tile: input.tile,
    measurer: input.measurer,
  })
}

function artAt(
  input: PrintFinalImmersiveFaceInput,
  layout: PrintFinalFaceLayout,
  palette: PrintFinalImmersivePalette,
  boost: number,
): PrintFinalArt {
  return printFinalArt({
    plan: layout.plan,
    palette,
    hasPhoto: input.photo !== null,
    languageCount: input.blocks.length,
    boost,
    bleed: input.bleed,
  })
}

/** Whether the logo goes on the plate: read straight on the photo, where the face puts it. */
function decidePlate(
  input: PrintFinalImmersiveFaceInput,
  palette: PrintFinalImmersivePalette,
): boolean {
  const { brand } = input
  if (brand.kind !== 'logo' || brand.medianInkLuminance === null) return true
  const tone = { medianInkLuminance: brand.medianInkLuminance, ringContrast: null }
  if (!printFinalLogoOnPlate('immersive', tone)) return false
  const bare = layoutWith(input, false)
  const part = bare.plan.parts.find((p) => p.key === 'brand')
  if (part === undefined) return true
  const scene = printFinalScene(artAt(input, bare, palette, 0), input.photo)
  const ring = printFinalRingContrast(
    scene,
    {
      leftPt: part.xPt,
      topPt: part.yPt,
      rightPt: part.xPt + part.widthPt,
      bottomPt: part.yPt + part.heightPt,
    },
    bare.plan,
    brand.medianInkLuminance,
  )
  return printFinalLogoOnPlate('immersive', { ...tone, ringContrast: ring })
}

function contrastsOf(
  layout: PrintFinalFaceLayout,
  colours: PrintFinalColours,
  art: PrintFinalArt,
  photo: PrintFinalScenePhoto | null,
): PrintFinalWordContrast[] {
  const scene = printFinalScene(art, photo)
  return layout.plan.parts.flatMap((part, index) => {
    const content = layout.contents[index]
    if (content === undefined) return []
    if (content.kind !== 'words' && content.kind !== 'wordmark') return []
    const colour =
      content.kind === 'words' ? printFinalToneColour(colours, content.tone) : colours.ink
    const box = {
      leftPt: part.xPt,
      topPt: part.yPt,
      rightPt: part.xPt + part.widthPt,
      bottomPt: part.yPt + part.heightPt,
    }
    return [{ key: part.key, ratio: printFinalTextContrast(scene, box, colour) }]
  })
}

/** Lays out and paints one Immersive face. */
export function layoutPrintFinalImmersiveFace(
  input: PrintFinalImmersiveFaceInput,
): PrintFinalImmersiveFace {
  const palette = printFinalImmersivePalette({
    accentColour: input.accentColour,
    fieldColour: input.fieldColour,
    sample: input.photo?.sample ?? null,
    orientation: input.face.orientation,
    languageCount: input.blocks.length,
  })
  const colours = printFinalImmersiveColours(palette)
  const logoOnPlate = decidePlate(input, palette)
  const layout = layoutWith(input, logoOnPlate)
  const steps =
    input.photo === null
      ? 0
      : Math.round(PRINT_FINAL_SCRIM_BOOST.max / PRINT_FINAL_SCRIM_BOOST.step)
  let boost = 0
  let art = artAt(input, layout, palette, boost)
  let contrasts = contrastsOf(layout, colours, art, input.photo)
  for (
    let step = 1;
    step <= steps && contrasts.some((c) => c.ratio < WORD_CONTRAST_TARGET);
    step++
  ) {
    boost = Math.round(step * PRINT_FINAL_SCRIM_BOOST.step * 100) / 100
    art = artAt(input, layout, palette, boost)
    contrasts = contrastsOf(layout, colours, art, input.photo)
  }
  return { layout, palette, colours, art, boost, contrasts, logoOnPlate }
}
