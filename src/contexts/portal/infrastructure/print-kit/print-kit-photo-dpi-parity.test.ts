import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import type { PortalPrintKitView } from '#/contexts/portal/application/public-api'
import {
  SOFT_PHOTO_NOTICE,
  lowestPhotoDpi,
  softPhotoNotice,
} from '#/components/features/portal/portal-share/print-kit-photo-notice'
import {
  printKitFaces,
  type PrintKitChoice,
  type PrintKitOutput,
  type PrintKitPaper,
} from '#/shared/domain/portal-print-kit'
import { CODE_TILE } from '#/shared/domain/portal-print-kit-code-tile'
import { BAND_PHOTO_DPI } from '#/shared/domain/portal-print-kit-sizes'
import type { PrintKitRenderInput } from '../../application/ports/portal-print-kit-renderer.port'
import { createPdfKitPrintKitRenderer } from './pdfkit-print-kit-renderer'
import type { PrintKitWarning } from './print-kit-pages'

// The Share tab says a photo prints soft when the PDF would report it so: both
// measure the photo with `photoPrintDpi` over the band the face plans, so the
// notice and the log line agree. The photos here are limited by their width, which
// the preview's estimated fit cannot move.

const ADDRESS =
  'https://app.reputationkey.app/p/pt_AbCdEfGhIjKlMnOp_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-aBcDe?accessArtifact=0b6d1c1e-52c4-4b34-9d63-6e3b4a1f9a10'
const TITLES = { en: 'Pool & Terrace' }

const LOOK: PortalPrintKitView['look'] = {
  wordmark: 'Avela',
  propertyName: 'Avela Beach Resort',
  accentColour: '#EAD6A8',
  fieldColour: '#16130E',
  heroUrl: '/media/hero',
  heroFocal: { x: 0.5, y: 0.5 },
  heroSize: null,
  logoUrl: null,
}

type Photo = Readonly<{ width: number; height: number }>

const choiceOf = (paper: PrintKitPaper, output: PrintKitOutput): PrintKitChoice => ({
  style: 'immersive',
  paper,
  size: 'large',
  output,
  piece: 'counter_card',
  languages: ['en'],
  callToAction: 'rate',
  showPropertyName: true,
})

/** What the PDF reports for a photo of this size on this choice: its warnings, and whether it printed. */
async function printed(choice: PrintKitChoice, photo: Photo) {
  const warnings: PrintKitWarning[] = []
  const renderer = createPdfKitPrintKitRenderer({
    now: () => new Date('2026-10-24T10:00:00Z'),
    compress: false,
    warn: (warning) => warnings.push(warning),
  })
  const bytes = await sharp({
    create: { ...photo, channels: 3, background: '#6D7F6A' },
  })
    .jpeg()
    .toBuffer()
  const input: PrintKitRenderInput = {
    title: 'Pool & Terrace',
    piece: choice.piece,
    style: choice.style,
    paper: choice.paper,
    size: choice.size,
    output: choice.output,
    faces: printKitFaces(choice, TITLES, 'Pool & Terrace'),
    wordmark: 'Avela',
    propertyName: 'Avela Beach Resort',
    logo: null,
    photo: { bytes, focalX: 0.5, focalY: 0.5 },
    accentColour: LOOK.accentColour,
    fieldColour: LOOK.fieldColour,
    qrAddress: ADDRESS,
  }
  const pdf = await renderer.render(input)
  return { warnings, isPdf: Buffer.from(pdf).subarray(0, 5).toString() === '%PDF-' }
}

const CASES: readonly (readonly [PrintKitPaper, PrintKitOutput, Photo])[] = [
  ['letter', 'print_shop', { width: 500, height: 1000 }],
  ['letter', 'print_shop', { width: 1000, height: 500 }],
  ['a4', 'office', { width: 750, height: 450 }],
  ['a4', 'office', { width: 2400, height: 1600 }],
]

describe('the Share notice and the PDF’s report of a soft photo', () => {
  it.each(CASES)(
    'agree on a %s %s print of a %j photo',
    async (paper, output, photo) => {
      const choice = choiceOf(paper, output)
      const look = { ...LOOK, heroSize: photo }
      const shown = {
        choice,
        look,
        faces: printKitFaces(choice, TITLES, 'Pool & Terrace'),
        tile: CODE_TILE[choice.size][choice.paper],
      }

      const { warnings, isPdf } = await printed(choice, photo)

      // The file is made whatever the photo.
      expect(isPdf).toBe(true)
      const dpi = lowestPhotoDpi(shown)
      expect(dpi).not.toBeNull()
      const reported = warnings[0]?.context?.dpi
      if (reported === undefined) {
        expect(dpi).toBeGreaterThanOrEqual(BAND_PHOTO_DPI.warnBelow)
        expect(softPhotoNotice(shown)).toBeNull()
        return
      }
      expect(warnings).toHaveLength(1)
      expect(Math.round(dpi ?? 0)).toBe(reported)
      expect(softPhotoNotice(shown)).toBe(SOFT_PHOTO_NOTICE)
    },
    30_000,
  )
})
