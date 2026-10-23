import { describe, expect, it } from 'vitest'
import type { PortalPrintKitView } from '#/contexts/portal/application/public-api'
import { previewImmersiveFit } from '#/components/features/portal/portal-share/print-kit-immersive-art-layout'
import { previewPaperFit } from '#/components/features/portal/portal-share/print-kit-preview-fit'
import type { ImmersiveGeometry } from '#/shared/domain/portal-print-kit-immersive'
import type { StackSizes } from '#/shared/domain/portal-print-kit-long-copy'
import type { PanelGeometry } from '#/shared/domain/portal-print-kit-sheets'
import type { FaceStack } from './print-kit-face-stack'
import {
  faceOf,
  layOutImmersive,
  layOutPaper,
} from './__fixtures__/print-kit-face-fixtures'

// The Share tab's preview sets a face's words at the sizes the PDF prints, from
// widths it estimates: never larger (a larger line would push the code block off
// the preview's face), and close enough that the preview reads as the file.

const LOOK: PortalPrintKitView['look'] = {
  wordmark: 'Avela',
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

const cases = <G extends PanelGeometry>(geometries: readonly G[]) =>
  geometries.flatMap((geometry) =>
    LANGUAGES.flatMap((languages) =>
      TITLES.map((titles) => ({ geometry, languages, titles })),
    ),
  )

describe('the preview’s sizes against the PDF’s measured plan', () => {
  it('match on Paper cards and tent faces', async () => {
    for (const { geometry, languages, titles } of cases([
      'card4x6',
      'cardA6',
      'tentFaceLetter',
      'tentFaceA5',
    ])) {
      const piece = geometry.startsWith('card') ? 'counter_card' : 'table_tent'
      const face = faceOf({ piece, languages: [...languages] }, titles)
      const layout = await layOutPaper(face, geometry)
      const fit = previewPaperFit(face, geometry, LOOK)
      if (fit === null) throw new Error(`no Paper fit for ${geometry}`)
      const label = `${geometry} ${languages.join('+')} ${titles.en.length}`
      expectParity(fit.sizes, measuredSizes(layout.stack.stack), label)
    }
  })

  it('match on Immersive cards and tent panels', async () => {
    for (const { geometry, languages, titles } of cases(IMMERSIVE)) {
      const piece = geometry.startsWith('card') ? 'counter_card' : 'table_tent'
      const face = faceOf({ piece, languages: [...languages] }, titles)
      const layout = await layOutImmersive(face, geometry)
      const fit = previewImmersiveFit(face, geometry, LOOK)
      const label = `${geometry} ${languages.join('+')} ${titles.en.length}`
      expectParity(fit.sizes, measuredSizes(layout.stack.stack), label)
      // The preview keeps a window only where the file does.
      if (fit.window) expect(layout.window, label).not.toBeNull()
    }
  })
})
