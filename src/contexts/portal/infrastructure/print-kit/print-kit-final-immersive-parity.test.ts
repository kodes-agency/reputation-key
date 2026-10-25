import { describe, expect, it } from 'vitest'
import { previewFinalImmersiveFace } from '#/components/features/portal/portal-share/print-final-face-layout'
import type { PreviewFinalPhoto } from '#/components/features/portal/portal-share/use-print-final-pictures'
import type { PortalPrintKitView } from '#/contexts/portal/application/public-api'
import type { GuestLocale } from '#/shared/domain/guest-locale'
import { printFinalBlocks } from '#/shared/domain/portal-print-final-languages'
import {
  PRINT_FINAL_ORIENTATIONS,
  PRINT_FINAL_PIECES,
  type PrintFinalFace,
} from '#/shared/domain/portal-print-final'
import { choosePrintFinalTile } from '#/shared/domain/portal-print-final-code'
import { PRINT_FINAL_DEFAULT_FRAMING } from '#/shared/domain/portal-print-final-framing'
import { layoutPrintFinalImmersiveFace } from '#/shared/domain/portal-print-final-immersive-face'
import type { PrintFinalPhotoSample } from '#/shared/domain/portal-print-final-photo-sample'
import { newDocument } from './__fixtures__/print-kit-face-fixtures'
import { pdfFinalMeasurer } from './print-kit-final-face'

// The Share tab's preview paints an Immersive face with the planner the PDF
// uses, from its own decode of the photo and its own estimates of the words.
// Given the same pixels, the two paint the same colours, decide the same plate,
// keep every word readable and deepen the scrims alike, within one step.

const { doc, fonts } = newDocument()
const pdf = pdfFinalMeasurer(doc, fonts)

/** A photo bright at the top (a pale wall) and dark at the foot, `widthPx` wide. */
function sampleOf(widthPx: number): PrintFinalPhotoSample {
  const heightPx = Math.round((widthPx * 2) / 3)
  const rgb = new Uint8ClampedArray(widthPx * heightPx * 3)
  for (let row = 0; row < heightPx; row++) {
    for (let column = 0; column < widthPx; column++) {
      const stripe = Math.floor(column / (widthPx / 24)) % 2 === 0 ? 30 : 0
      const level = Math.max(0, 225 - (row / heightPx) * 200 + stripe)
      rgb.set([level, level * 0.85, level * 0.7], (row * widthPx + column) * 3)
    }
  }
  return { widthPx, heightPx, rgb }
}

const PHOTO: PreviewFinalPhoto = {
  sample: sampleOf(240),
  detail: sampleOf(960),
  pixels: { widthPx: 1620, heightPx: 1080 },
}

const look = (logo: boolean): PortalPrintKitView['look'] => ({
  wordmark: 'Hotel Elegance',
  propertyName: 'Hotel Elegance',
  accentColour: '#E3B873',
  fieldColour: '#2A1712',
  heroUrl: 'data:image/png;base64,',
  heroFocal: { x: 0.5, y: 0.4 },
  heroSize: { width: 1620, height: 1080 },
  logoUrl: logo ? 'data:image/png;base64,' : null,
})

const FACES: readonly PrintFinalFace[] = (['us', 'eu'] as const).flatMap((region) =>
  PRINT_FINAL_PIECES.flatMap((piece) =>
    PRINT_FINAL_ORIENTATIONS.map((orientation) => ({
      piece,
      orientation,
      look: 'immersive' as const,
      region,
    })),
  ),
)

const blocksOf = (languages: readonly GuestLocale[]) =>
  printFinalBlocks(
    languages,
    'rate',
    {
      en: 'Review us on Google',
      es: 'Reseñe en Google',
      de: 'Bewerten Sie uns auf Google',
    },
    'Reception',
  )

describe('the preview’s final Immersive faces', () => {
  it.each(FACES.map((f) => [`${f.piece} ${f.orientation} (${f.region})`, f] as const))(
    '%s: paint as the file does',
    (_, face) => {
      const tile = choosePrintFinalTile({
        ...face,
        address: 'short',
        symbolModules: 29,
      })._unsafeUnwrap()
      for (const languages of [['en'], ['en', 'es'], ['de']] as const)
        for (const withLogo of [true, false]) {
          const blocks = blocksOf(languages)
          const logo = { aspect: 1.2, medianInkLuminance: 0.9 }
          const preview = previewFinalImmersiveFace({
            face,
            blocks,
            look: look(withLogo),
            tile,
            logo: withLogo ? logo : null,
            photo: PHOTO,
          })
          const file = layoutPrintFinalImmersiveFace({
            face,
            blocks,
            brand: withLogo
              ? { kind: 'logo', inkWidth: 1.2, inkHeight: 1, medianInkLuminance: 0.9 }
              : { kind: 'wordmark', text: 'Hotel Elegance' },
            tile,
            measurer: pdf,
            accentColour: '#E3B873',
            fieldColour: '#2A1712',
            photo: {
              ...PHOTO,
              focal: { x: 0.5, y: 0.4 },
              framing: PRINT_FINAL_DEFAULT_FRAMING,
            },
          })
          const what = `${languages.join('+')} · logo ${withLogo}`
          expect(preview.palette, what).toEqual(file.palette)
          expect(preview.logoOnPlate, what).toBe(file.logoOnPlate)
          expect(preview.layout.headlinePt, what).toBeLessThanOrEqual(
            file.layout.headlinePt,
          )
          expect(Math.abs(preview.boost - file.boost), what).toBeLessThanOrEqual(
            0.06 + 1e-9,
          )
          for (const word of preview.contrasts) {
            if (preview.boost < 0.3)
              expect(word.ratio, `${what} ${word.key}`).toBeGreaterThanOrEqual(4.6)
          }
        }
    },
  )
})
