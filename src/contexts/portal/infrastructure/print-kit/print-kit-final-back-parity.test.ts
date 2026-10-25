import { describe, expect, it } from 'vitest'
import { previewFinalBackLayout } from '#/components/features/portal/portal-share/print-final-face-layout'
import type { PortalPrintKitView } from '#/contexts/portal/application/public-api'
import {
  PRINT_FINAL_ORIENTATIONS,
  type PrintFinalFace,
} from '#/shared/domain/portal-print-final'
import { layoutPrintFinalBack } from '#/shared/domain/portal-print-final-back'
import { ptMm } from '#/shared/domain/portal-print-final-measures'
import { newDocument } from './__fixtures__/print-kit-face-fixtures'
import { pdfFinalMeasurer } from './print-kit-final-face'

// The Share tab's preview lays a back page out from estimates, the PDF from the
// fonts, with one planner. The estimates err on the crowded side, so the preview
// breaks the name into as many lines as the file, never fewer and never wider,
// and puts the block where the file does to within a millimetre.

const { doc, fonts } = newDocument()
const measurer = pdfFinalMeasurer(doc, fonts)

const NAMES = [
  'Harborline Inn Millbrook-Near The Arboretum',
  'Oakmere by Larkspur Hotel Millbrook Field Airport',
  'Hampton Inn Houston-Near The Galleria',
  'Hotel Elegance',
  'The Grand Harborline Inn and Suites Millbrook Near The Old Arboretum',
  'Hôtel de la Paix Genève',
  'Хотел Рила',
]

const look = (propertyName: string, logo: boolean): PortalPrintKitView['look'] => ({
  wordmark: 'Hotel Elegance',
  propertyName,
  accentColour: '#A8C6FE',
  fieldColour: '#001E57',
  heroUrl: null,
  heroFocal: null,
  heroSize: null,
  logoUrl: logo ? 'data:image/png;base64,' : null,
})

const FACES: readonly PrintFinalFace[] = (['us', 'eu'] as const).flatMap((region) =>
  (['counter', 'small'] as const).flatMap((piece) =>
    PRINT_FINAL_ORIENTATIONS.flatMap((orientation) =>
      (['paper', 'immersive'] as const).map((faceLook) => ({
        piece,
        orientation,
        look: faceLook,
        region,
      })),
    ),
  ),
)

describe('the preview’s back pages', () => {
  it.each(
    FACES.map((f) => [`${f.look} ${f.piece} ${f.orientation} (${f.region})`, f] as const),
  )('%s: break the name as the file does and put the block where it does', (_, face) => {
    for (const name of NAMES)
      for (const logo of [true, false]) {
        const preview = previewFinalBackLayout({
          face,
          look: look(name, logo),
          logoAspect: 2,
          onPlate: face.look === 'immersive',
        })
        const file = layoutPrintFinalBack({
          face,
          brand: logo
            ? {
                kind: 'logo',
                inkWidth: 2,
                inkHeight: 1,
                onPlate: face.look === 'immersive',
              }
            : { kind: 'wordmark', text: 'Hotel Elegance' },
          propertyName: name,
          measurer,
        })
        const what = `${name} · logo ${logo}`
        const lines = (layout: typeof file) =>
          layout.contents.flatMap((c) => (c.kind === 'name' ? [c.set.lines.length] : []))
        expect(lines(preview), what).toEqual(lines(file))
        expect(
          preview.plan.parts.map((p) => p.key),
          what,
        ).toEqual(file.plan.parts.map((p) => p.key))
        const [previewBlock, fileBlock] = [preview.plan.block, file.plan.block]
        if (previewBlock === null || fileBlock === null) continue
        expect(
          Math.abs(ptMm(previewBlock.topPt) - ptMm(fileBlock.topPt)),
          what,
        ).toBeLessThan(1)
        // Never narrower than the file's block.
        expect(previewBlock.rightPt - previewBlock.leftPt, what).toBeGreaterThanOrEqual(
          fileBlock.rightPt - fileBlock.leftPt - 0.5,
        )
        if (file.plan.fits) expect(preview.plan.fits, what).toBe(true)
      }
  })
})
