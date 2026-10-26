// The Print kit section's notice for a photo that would print soft. The PDF is
// made even then (a soft photo is the manager's to judge), so this is the one
// place the manager hears of it before the file is asked for: the resolution
// the photo prints at on the faces of the chosen print, measured with the same
// function and the same areas the PDF crops with (`photoPrintDpi`,
// `cardBandArea`, `tentPanelArea`), against the same threshold
// (`BAND_PHOTO_DPI`). The photo's size is the one stored with it: the browser
// never loads the picture to measure it.
//
// The faces are planned as the preview draws them, which cannot measure the
// fonts: a card's band may differ from the file's by the step a tight face takes
// (at most 0.05 in on Large), which only moves a photo whose height is what runs
// short.

import type { PortalPrintKitView } from '#/contexts/portal/application/public-api'
import type { PrintFace, PrintKitChoice } from '#/shared/domain/portal-print-kit'
import type { CodeTile } from '#/shared/domain/portal-print-kit-code-tile'
import { PRINT_PHOTO_MIN_WIDTH_PX } from '#/shared/domain/portal-media'
import {
  cardBandArea,
  photoPrintDpi,
  tentPanelArea,
  type PhotoArea,
} from '#/shared/domain/portal-print-kit-photo'
import type { PanelBleed } from '#/shared/domain/portal-print-kit-sheets'
import { BAND_PHOTO_DPI, faceKindOf } from '#/shared/domain/portal-print-kit-sizes'
import { previewCardPlan } from './print-kit-card-art-layout'
import { previewSheetPages } from './print-kit-sheet-pages'
import { previewTentPlan } from './print-kit-tent-art-layout'

export const SOFT_PHOTO_NOTICE = `Your photo is small for print and may look soft. For a sharp print, upload a photo at least ${PRINT_PHOTO_MIN_WIDTH_PX} px wide.`

type Input = Readonly<{
  choice: PrintKitChoice
  look: PortalPrintKitView['look']
  /** The faces as the file prints them. */
  faces: readonly PrintFace[]
  /** The tile the file would print the code on. */
  tile: CodeTile
}>

/** Where the photo is on a face planned once, for the bleed each panel of it has. */
type AreaAt = (bleed: PanelBleed) => PhotoArea | null

/** A face's plan, as the file lays it out, turned into its photo area. */
function areaAtOf(input: Input, face: PrintFace): AreaAt {
  const { choice, look, tile } = input
  const { style, paper } = choice
  if (faceKindOf(choice.piece, choice.size) === 'tent') {
    const plan = previewTentPlan({ style, paper, face, look, tile, logoAspect: null })
    return (bleed) => tentPanelArea(plan, bleed)
  }
  const plan = previewCardPlan({
    size: choice.size,
    style,
    paper,
    face,
    look,
    tile,
    logoAspect: null,
    showPropertyName: choice.showPropertyName,
  })
  return (bleed) => cardBandArea(plan, bleed)
}

/**
 * The lowest resolution the property's photo prints at over the photo areas of
 * the chosen print's pages, as the PDF measures it. Null when the print shows no
 * photo: Paper, the Letter-half tent (whose small window is not an area), a
 * property without a photo, or a size that has no pages.
 */
export function lowestPhotoDpi(input: Input): number | null {
  const { choice, look, faces, tile } = input
  const { heroSize } = look
  if (choice.style !== 'immersive' || heroSize === null) return null
  if (faceKindOf(choice.piece, choice.size) === null) return null
  const pages = previewSheetPages(choice, faces, tile.tilePt)
  if (pages === null) return null
  const photo = { widthPx: heroSize.width, heightPx: heroSize.height }
  // A face is planned once for every panel of its shape, as the file lays it out.
  const planned = new Map<string, AreaAt>()
  const dpis = pages
    .flatMap((page) => page.panels)
    .flatMap((panel) => {
      const face = faces.find((candidate) => candidate.side === panel.side)
      if (face === undefined) return []
      const key = `${panel.side}:${panel.geometry}`
      const areaAt = planned.get(key) ?? areaAtOf(input, face)
      planned.set(key, areaAt)
      const area = areaAt(panel.bleed)
      return area === null ? [] : [photoPrintDpi(photo, area)]
    })
  return dpis.length === 0 ? null : Math.min(...dpis)
}

/** The notice words when the photo would print under the threshold the PDF reports at; null when it prints sharp, or shows no photo. */
export function softPhotoNotice(input: Input): string | null {
  const dpi = lowestPhotoDpi(input)
  return dpi !== null && dpi < BAND_PHOTO_DPI.warnBelow ? SOFT_PHOTO_NOTICE : null
}
