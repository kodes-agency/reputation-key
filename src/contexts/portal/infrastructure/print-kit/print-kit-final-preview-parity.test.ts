import { describe, expect, it } from 'vitest'
import { estimatedReachEm } from '#/components/features/portal/portal-share/print-final-ink-estimates'
import {
  previewFinalMeasurer,
  previewFinalFaceLayout,
} from '#/components/features/portal/portal-share/print-final-face-layout'
import type { PortalPrintKitView } from '#/contexts/portal/application/public-api'
import type { GuestLocale } from '#/shared/domain/guest-locale'
import type { PrintTextBlock } from '#/shared/domain/portal-print-kit'
import { printFinalBlocks } from '#/shared/domain/portal-print-final-languages'
import {
  PRINT_FINAL_ORIENTATIONS,
  PRINT_FINAL_PIECES,
  type PrintFinalFace,
} from '#/shared/domain/portal-print-final'
import { choosePrintFinalTile } from '#/shared/domain/portal-print-final-code'
import { layoutPrintFinalFace } from '#/shared/domain/portal-print-final-face'
import type { PrintFinalTextStyle } from '#/shared/domain/portal-print-final-text'
import { PRINT_FINAL_TYPE } from '#/shared/domain/portal-print-final-type'
import { newDocument } from './__fixtures__/print-kit-face-fixtures'
import { pdfFinalMeasurer } from './print-kit-final-face'

// The Share tab's preview lays a final face out from estimates, the PDF from
// the fonts. The estimates must err on the crowded side: a preview line is never
// narrower or shorter than the file's, so the preview takes a long-copy step no
// later than the file and never sets a headline larger.

const { doc, fonts } = newDocument()
const pdf = pdfFinalMeasurer(doc, fonts)

const style = (over: Partial<PrintFinalTextStyle>): PrintFinalTextStyle => ({
  family: 'sans',
  weight: 400,
  italic: false,
  sizePt: 10,
  trackingEm: 0,
  leading: 1.2,
  caps: false,
  ...over,
})

const STYLES: readonly PrintFinalTextStyle[] = [
  style({ family: 'serif', weight: 600, sizePt: 28, trackingEm: -0.005 }),
  style({ weight: 600, sizePt: 15, trackingEm: -0.01 }),
  style({ sizePt: 11 }),
  style({ italic: true, sizePt: 9 }),
  style({ weight: 600, sizePt: 9.5, trackingEm: 0.16 }),
  style({ family: 'serif', weight: 600, sizePt: 14, trackingEm: 0.3 }),
]

const LINES = [
  'How did we do?',
  'About 30 seconds',
  'REVIEW US ON GOOGLE',
  'Wie war es bei uns?',
  'Évaluez votre visite',
  'Как беше при нас?',
  'Votre avis sur nous\u00a0?',
  'HOTEL ELEGANCE',
  'Chair 3 · Sala 12',
]

describe('the preview’s estimated lines', () => {
  it.each(
    STYLES.map(
      (s) =>
        [
          `${s.family} ${s.weight}${s.italic ? ' italic' : ''} ${s.sizePt} pt`,
          s,
        ] as const,
    ),
  )('%s: are never narrower, taller-topped or shallower than the file’s', (_, s) => {
    for (const line of LINES) {
      const text = s.caps ? line.toUpperCase() : line
      const file = pdf.ink(text, s)
      const preview = previewFinalMeasurer.ink(text, s)
      expect(previewFinalMeasurer.advancePt(text, s), line).toBeGreaterThanOrEqual(
        pdf.advancePt(text, s),
      )
      expect(preview.ascentPt, line).toBeGreaterThanOrEqual(file.ascentPt)
      expect(preview.descentPt, line).toBeGreaterThanOrEqual(file.descentPt)
      expect(preview.rightPt - preview.leftPt, line).toBeGreaterThanOrEqual(
        file.rightPt - file.leftPt - 0.5,
      )
    }
  })
})

describe('the preview’s reach tables', () => {
  const characters = [
    ...' !"#$%&\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~’‘“”–—…·',
    ...'éÉàÀüÜßñçœОценетпосщи',
  ]
  const faces = [
    ['serif', style({ family: 'serif', weight: 600, sizePt: 1000 })],
    ['sans', style({ sizePt: 1000 })],
    ['sans', style({ weight: 600, sizePt: 1000 })],
    ['sans', style({ italic: true, sizePt: 1000 })],
  ] as const

  it('never say a character reaches less far above or below its baseline than the font draws it', () => {
    for (const [family, s] of faces) {
      for (const character of characters) {
        const file = pdf.ink(character, s)
        const reach = estimatedReachEm(family, character)
        expect(reach.up * 1000, `${family} ${character}`).toBeGreaterThanOrEqual(
          file.ascentPt,
        )
        expect(reach.down * 1000, `${family} ${character}`).toBeGreaterThanOrEqual(
          file.descentPt,
        )
      }
    }
  })
})

const TITLES = [
  { en: 'Reception', es: 'Recepción', de: 'Rezeption', fr: 'Réception', bg: 'Рецепция' },
  {
    en: 'The rooftop terrace bar and lounge overlooking the old harbour',
    es: 'El bar de la azotea y el salón con vistas al puerto viejo',
    de: 'Die Dachterrassenbar mit Blick auf den alten Hafen und die Bucht',
    fr: 'La terrasse panoramique du bar et du salon sur le vieux port',
    bg: 'Барът на покрива с изглед към старото пристанище',
  },
]
const LANGUAGES: readonly (readonly GuestLocale[])[] = [
  ['en'],
  ['en', 'es'],
  ['de'],
  ['de', 'fr'],
  ['bg', 'en'],
]

/** A manager's own long headline, which steps the tent's headline down: the long-copy case. */
const LONG_COPY: readonly PrintTextBlock[] = [
  {
    locale: 'en',
    kicker: 'Review us on Google',
    headline: 'How was your stay with us tonight?',
    subline: 'About 30 seconds',
  },
]

function blockSets(
  titles: (typeof TITLES)[number],
): readonly (readonly PrintTextBlock[])[] {
  return [
    ...LANGUAGES.map((languages) =>
      printFinalBlocks(languages, { preset: 'how_did_we_do' }, titles, 'Reception'),
    ),
    LONG_COPY,
  ]
}

let stepped = 0

const look = (logo: boolean): PortalPrintKitView['look'] => ({
  wordmark: 'Harborline Inn Millbrook-Near The Arboretum',
  propertyName: 'Harborline Inn Millbrook-Near The Arboretum',
  accentColour: '#A8C6FE',
  fieldColour: '#001E57',
  heroUrl: null,
  heroFocal: null,
  heroSize: null,
  logoUrl: logo ? 'data:image/png;base64,' : null,
})

const FACES: readonly PrintFinalFace[] = (['us', 'eu'] as const).flatMap((region) =>
  PRINT_FINAL_PIECES.flatMap((piece) =>
    PRINT_FINAL_ORIENTATIONS.map((orientation) => ({
      piece,
      orientation,
      look: 'paper' as const,
      region,
    })),
  ),
)

describe('the preview’s final faces', () => {
  it.each(FACES.map((f) => [`${f.piece} ${f.orientation} (${f.region})`, f] as const))(
    '%s: never set the headline larger than the file',
    (_, face) => {
      const tile = choosePrintFinalTile({ ...face, address: 'short', symbolModules: 29 })
      for (const titles of TITLES)
        for (const blocks of blockSets(titles))
          for (const withLogo of [true, false]) {
            const preview = previewFinalFaceLayout({
              face,
              blocks,
              look: look(withLogo),
              tile: tile._unsafeUnwrap(),
              logoAspect: 2,
            })
            const file = layoutPrintFinalFace({
              face,
              blocks,
              brand: withLogo
                ? { kind: 'logo', inkWidth: 2, inkHeight: 1, onPlate: false }
                : { kind: 'wordmark', text: look(false).wordmark },
              tile: tile._unsafeUnwrap(),
              measurer: pdf,
            })
            const what = `${blocks.map((b) => b.locale).join('+')} · ${titles.en} · logo ${withLogo}`
            if (file.headlinePt < PRINT_FINAL_TYPE[face.piece].headlinePt) stepped += 1
            expect(preview.headlinePt, what).toBeLessThanOrEqual(file.headlinePt)
            if (file.overflows) expect(preview.overflows, what).toBe(true)
          }
    },
  )

  it('include faces whose words take the long-copy step', () => {
    expect(stepped).toBeGreaterThan(0)
  })
})
