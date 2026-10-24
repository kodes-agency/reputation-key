// The small table tent's face in the Share tab's preview, planned by the function
// the PDF draws from (`planTent`, round-3 spec-delta S5): the same row of the
// words and the code block, centred down the face, with the call to action
// stepping down as the file's does, measured from the width tables the preview
// estimates with. One language a face: the lead language's words and its one cue
// line.

import type { PortalPrintKitView } from '#/contexts/portal/application/public-api'
import type {
  PrintFace,
  PrintKitPaper,
  PrintKitStyle,
} from '#/shared/domain/portal-print-kit'
import {
  cueLinesFor,
  estimatedCueWidthPt,
  planCodeBlock,
} from '#/shared/domain/portal-print-kit-code-block'
import type { CodeTile } from '#/shared/domain/portal-print-kit-code-tile'
import { planTent, type TentPlan } from '#/shared/domain/portal-print-kit-tent'
import { previewBrandInput, previewMeasures } from './print-kit-card-art-layout'

export type PreviewTentInput = Readonly<{
  style: PrintKitStyle
  paper: PrintKitPaper
  face: PrintFace
  look: PortalPrintKitView['look']
  tile: CodeTile
  /** The logo picture's width over its height, once it has loaded. */
  logoAspect: number | null
}>

/** The face with its lead language alone: the tent prints one language a face. */
export const leadLanguageOf = (face: PrintFace): PrintFace => ({
  ...face,
  blocks: face.blocks.slice(0, 1),
})

/** Where everything on a small tent's face goes, as the file places it. */
export function previewTentPlan(input: PreviewTentInput): TentPlan {
  const { style, paper, look } = input
  const face = leadLanguageOf(input.face)
  const cues = cueLinesFor(face.blocks.map((block) => block.locale))
  return planTent({
    style,
    paper,
    face,
    brand: previewBrandInput(look, style, input.logoAspect),
    code: planCodeBlock(cues, estimatedCueWidthPt, input.tile),
    ...previewMeasures,
  })
}
