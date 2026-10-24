import { describe, expect, it } from 'vitest'
import type { PortalPrintKitView } from '#/contexts/portal/application/public-api'
import { previewCardPlan } from '#/components/features/portal/portal-share/print-kit-card-art-layout'
import { previewImmersiveFit } from '#/components/features/portal/portal-share/print-kit-immersive-art-layout'
import { previewPaperFit } from '#/components/features/portal/portal-share/print-kit-preview-fit'
import type { PrintKitPaper, PrintKitStyle } from '#/shared/domain/portal-print-kit'
import type { LargeCardPlan } from '#/shared/domain/portal-print-kit-card'
import type { CardTextRole } from '#/shared/domain/portal-print-kit-card-words'
import { CODE_TILE } from '#/shared/domain/portal-print-kit-code-tile'
import type { ImmersiveGeometry } from '#/shared/domain/portal-print-kit-immersive'
import {
  immersivePrintKitPalette,
  paperPrintKitPalette,
} from '#/shared/domain/portal-print-kit-palette'
import type { StackSizes } from '#/shared/domain/portal-print-kit-long-copy'
import type { PanelGeometry } from '#/shared/domain/portal-print-kit-sheets'
import { layoutCardFace } from './print-kit-card-face'
import type { FaceStack } from './print-kit-face-stack'
import { qrMatrix } from './print-kit-qr'
import {
  faceOf,
  layOutImmersive,
  layOutPaper,
  newDocument,
} from './__fixtures__/print-kit-face-fixtures'

// The Share tab's preview sets a face's words at the sizes the PDF prints, from
// widths it estimates: never larger (a larger line would push the code block off
// the preview's face), and close enough that the preview reads as the file.

const LOOK: PortalPrintKitView['look'] = {
  wordmark: 'Avela',
  propertyName: 'Avela Beach Resort',
  accentColour: '#EAD6A8',
  fieldColour: '#16130E',
  heroUrl: null,
  heroFocal: null,
  logoUrl: null,
}

const TITLES = [
  { en: 'Pool & Terrace', fr: 'Piscine et terrasse', de: 'Pool und Terrasse' },
  {
    en: 'The rooftop terrace bar and lounge overlooking the old harbour',
    fr: 'La terrasse panoramique du bar et du salon sur le vieux port',
    de: 'Die Dachterrassenbar mit Blick auf den alten Hafen und die Bucht',
  },
  {
    en: 'The rooftop terrace bar and lounge overlooking the old harbour, with the garden restaurant and the spa on the lower deck',
    fr: 'La terrasse panoramique du bar et du salon sur le vieux port, avec le restaurant du jardin et le spa au niveau inférieur',
    de: 'Die Dachterrassenbar und Lounge mit Blick auf den alten Hafen, mit Gartenrestaurant und Wellnessbereich im Untergeschoss',
  },
]
const IMMERSIVE: readonly ImmersiveGeometry[] = [
  'card4x6',
  'cardA6',
  'tentPanel4x6',
  'tentPanelA6',
]
const LANGUAGES = [['en'], ['en', 'fr'], ['de', 'fr']] as const

/** The sizes the PDF measured, read from its stack in order. */
function measuredSizes(stack: FaceStack): Partial<StackSizes> {
  const lines = stack.items.flatMap((item) => (item.kind === 'line' ? [item] : []))
  const titleAt = lines.findIndex((line) => line.style.face === 'bodyStrong')
  if (titleAt < 0) return { place: lines[0]?.style.size }
  const display = lines.filter((line) => line.style.face === 'display')
  const body = lines.filter((line) => line.style.face === 'body')
  return {
    place: lines[0]?.style.size,
    place2: lines[titleAt]?.style.size,
    head2: display.at(-1)?.style.size,
    sub2: body.at(-1)?.style.size,
  }
}

/** The preview's sizes, as the PDF's: never larger, and the place label at most one step smaller. */
function expectParity(preview: StackSizes, measured: Partial<StackSizes>, label: string) {
  for (const [part, size] of Object.entries(measured)) {
    const previewSize = preview[part as keyof StackSizes]
    expect(previewSize, `${label}: ${part}`).toBeLessThanOrEqual((size ?? 0) + 1e-9)
  }
  expect(preview.place, `${label}: place`).toBeGreaterThanOrEqual(
    (measured.place ?? 0) - 0.5,
  )
}

/** The languages and titles every face shape is set with. */
const CASES = LANGUAGES.flatMap((languages) =>
  TITLES.map((titles) => ({ languages, titles })),
)

const pieceOf = (geometry: PanelGeometry) =>
  geometry.startsWith('card') ? 'counter_card' : 'table_tent'

// One face shape a test, each laid out in a single shared document: opening the
// fonts for every face made the whole run slow enough to time out on a loaded runner.
describe('the preview’s sizes against the PDF’s measured plan', () => {
  it.each(['card4x6', 'cardA6', 'tentFaceLetter', 'tentFaceA5'] as const)(
    'match on the Paper %s',
    async (geometry) => {
      const document = newDocument()
      for (const { languages, titles } of CASES) {
        const face = faceOf(
          { piece: pieceOf(geometry), languages: [...languages] },
          titles,
        )
        const layout = await layOutPaper(face, geometry, { document })
        const fit = previewPaperFit(face, geometry, LOOK)
        if (fit === null) throw new Error(`no Paper fit for ${geometry}`)
        const label = `${geometry} ${languages.join('+')} ${titles.en.length}`
        expectParity(fit.sizes, measuredSizes(layout.stack.stack), label)
      }
    },
  )

  it.each(IMMERSIVE)('match on the Immersive %s', async (geometry) => {
    const document = newDocument()
    for (const { languages, titles } of CASES) {
      const face = faceOf({ piece: pieceOf(geometry), languages: [...languages] }, titles)
      const layout = await layOutImmersive(face, geometry, { document })
      const fit = previewImmersiveFit(face, geometry, LOOK)
      const label = `${geometry} ${languages.join('+')} ${titles.en.length}`
      expectParity(fit.sizes, measuredSizes(layout.stack.stack), label)
      // The preview keeps a window only where the file does.
      if (fit.window) expect(layout.window, label).not.toBeNull()
    }
  })
})

/** The largest size each role is set at on a card. */
function roleSizes(plan: LargeCardPlan): Partial<Record<CardTextRole, number>> {
  const sizes: Partial<Record<CardTextRole, number>> = {}
  for (const item of plan.words) {
    if (item.kind !== 'line') continue
    sizes[item.role] = Math.max(sizes[item.role] ?? 0, item.style.sizePt)
  }
  return sizes
}

const CARD_QR = qrMatrix('HTTPS://AP.UP.RAILWAY.APP/p/7K3QZ0VD9MWX4HT2BN6R')

describe('the preview’s Large card against the PDF’s', () => {
  it.each([
    ['immersive', 'letter'],
    ['immersive', 'a4'],
    ['paper', 'letter'],
    ['paper', 'a4'],
  ] as const)(
    'takes a step no later, and sets no line larger, on %s %s',
    (style: PrintKitStyle, paper: PrintKitPaper) => {
      const { doc, fonts } = newDocument()
      const tile = CODE_TILE.large[paper]
      const palette =
        style === 'paper'
          ? paperPrintKitPalette(LOOK.accentColour)
          : immersivePrintKitPalette(LOOK.accentColour, LOOK.fieldColour)
      for (const { languages, titles } of CASES) {
        const face = faceOf({ piece: 'counter_card', languages: [...languages] }, titles)
        const label = `${style} ${paper} ${languages.join('+')} ${titles.en.length}`
        const file = layoutCardFace(doc, fonts, face, {
          size: 'large',
          style,
          paper,
          palette,
          qr: CARD_QR,
          tile,
          wordmark: LOOK.wordmark,
          propertyName: LOOK.propertyName,
          logo: null,
        }).plan
        const preview = previewCardPlan({
          style,
          paper,
          face,
          look: LOOK,
          tile,
          logoAspect: null,
        })
        expect(preview.stepIndex, label).toBeGreaterThanOrEqual(file.stepIndex)
        const fileSizes = roleSizes(file)
        for (const [role, size] of Object.entries(roleSizes(preview))) {
          expect(size, `${label}: ${role}`).toBeLessThanOrEqual(
            (fileSizes[role as CardTextRole] ?? 0) + 1e-9,
          )
        }
        expect(preview.code.y, label).toBeCloseTo(file.code.y, 0)
      }
    },
  )
})
