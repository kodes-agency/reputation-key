import { describe, expect, it } from 'vitest'
import type { PrintKitWords } from '#/shared/domain/portal-print-kit'
import {
  FIT,
  TENT_FACE_GRID,
  TYPE_FLOOR_PT,
} from '#/shared/domain/portal-print-kit-measures'
import { PANEL_SIZE_PT } from '#/shared/domain/portal-print-kit-sheets'
import {
  faceOf,
  layOutImmersive,
  layOutPaper,
  stackLines,
  wordsToCode,
} from './__fixtures__/print-kit-face-fixtures'

// The long-copy steps (spec 2.5): once every fit step is used up, the place
// label shrinks to its 21 pt floor, then the second language steps down to its
// floors (11.5 / 9 / 9 pt), and only then, the last resort, the place label goes
// under its floor. The words never reach the code block.

/** 120 characters each, a Portal title's limit. */
const TITLES_120 = {
  en: 'The rooftop terrace bar and lounge overlooking the old harbour, with the garden restaurant and the spa on the lower deck',
  fr: 'La terrasse panoramique du bar et du salon sur le vieux port, avec le restaurant du jardin et le spa au niveau inférieur',
  de: 'Die Dachterrassenbar und Lounge mit Blick auf den alten Hafen, mit Gartenrestaurant und Wellnessbereich im Untergeschoss',
}
const TITLES_60 = {
  en: 'The rooftop terrace bar and lounge overlooking the old harbour',
  fr: 'La terrasse panoramique du bar et du salon sur le vieux port',
}

const words = (
  piece: PrintKitWords['piece'],
  languages: PrintKitWords['languages'],
  titles: Readonly<Record<string, string>>,
) => faceOf({ piece, languages, callToAction: 'tell' }, titles)

/**
 * The sizes a two-language stack set, in its order: the place label, the second
 * title, the lead headline and subline, the rule, the second headline and subline.
 */
function sizesOf(layout: Parameters<typeof stackLines>[0]) {
  const lines = stackLines(layout)
  const titleAt = lines.findIndex((line) => line.style.face === 'bodyStrong')
  const display = lines.filter((line) => line.style.face === 'display')
  const body = lines.filter((line) => line.style.face === 'body')
  return {
    place: lines[0]?.style.size ?? Number.NaN,
    place2: lines[titleAt]?.style.size ?? Number.NaN,
    head: lines[titleAt + 1]?.style.size ?? Number.NaN,
    head2: display.at(-1)?.style.size ?? Number.NaN,
    sub2: body.at(-1)?.style.size ?? Number.NaN,
  }
}

describe('the second language gives way before the place label goes under its floor', () => {
  it('on the Paper 4 × 6 in card', async () => {
    const layout = await layOutPaper(
      words('counter_card', ['en', 'fr'], TITLES_60),
      'card4x6',
    )
    expect(sizesOf(layout)).toMatchObject({ place: 21, place2: 9, head2: 11.5, sub2: 9 })
    expect(wordsToCode(layout)).toBeGreaterThanOrEqual(FIT.paperGapPt.code - 1e-6)
  })

  it('on the Immersive A6 card', async () => {
    const layout = await layOutImmersive(
      words('counter_card', ['en', 'de'], { en: TITLES_60.en, de: TITLES_120.de }),
      'cardA6',
    )
    expect(sizesOf(layout)).toMatchObject({ place: 21, place2: 9, head2: 11.5, sub2: 9 })
    expect(wordsToCode(layout)).toBeGreaterThanOrEqual(FIT.gapPt.floor - 1e-6)
  })

  it('on the Immersive 4 × 6 in tent panel', async () => {
    const layout = await layOutImmersive(
      words('table_tent', ['en', 'fr'], TITLES_60),
      'tentPanel4x6',
    )
    expect(sizesOf(layout)).toMatchObject({ place: 21, place2: 9, head2: 11.5, sub2: 9 })
  })
})

describe('120-character titles and French and German copy', () => {
  const pairs = [
    ['en', 'fr'],
    ['de', 'fr'],
  ] as const

  it.each(['card4x6', 'cardA6'] as const)(
    'never reach the code block on the %s, in either style',
    async (geometry) => {
      for (const languages of pairs) {
        const face = words('counter_card', [...languages], TITLES_120)
        const paper = await layOutPaper(face, geometry)
        const immersive = await layOutImmersive(face, geometry)
        expect(wordsToCode(paper)).toBeGreaterThanOrEqual(FIT.paperGapPt.code - 1e-6)
        expect(wordsToCode(immersive)).toBeGreaterThanOrEqual(FIT.gapPt.floor - 1e-6)
        for (const layout of [paper, immersive]) {
          const sizes = sizesOf(layout)
          // The last resort: the second language is at its floors before the place label is under its own.
          expect(sizes.place).toBeLessThan(TYPE_FLOOR_PT.place)
          expect(sizes).toMatchObject({ place2: 9, head2: 11.5, sub2: 9 })
          expect(sizes.place).toBeGreaterThanOrEqual(TYPE_FLOOR_PT.read)
        }
      }
    },
  )

  it.each(['tentFaceLetter', 'tentFaceA5'] as const)(
    'keep the place label the largest type on the Paper %s, inside its margins',
    async (geometry) => {
      for (const languages of pairs) {
        const layout = await layOutPaper(
          words('table_tent', [...languages], TITLES_120),
          geometry,
        )
        const sizes = sizesOf(layout)
        expect(sizes.place).toBeGreaterThanOrEqual(sizes.head)
        const rowBottom = Math.max(
          layout.stack.y + layout.stack.stack.heightPt,
          layout.code.y + layout.code.plan.heightPt,
        )
        const grid = TENT_FACE_GRID[geometry === 'tentFaceLetter' ? 'letter' : 'a4']
        expect(rowBottom).toBeLessThanOrEqual(
          PANEL_SIZE_PT[geometry].heightPt - grid.foldClearancePt + 1e-6,
        )
      }
    },
  )

  it.each(['tentPanel4x6', 'tentPanelA6'] as const)(
    'never reach the code block on the Immersive %s',
    async (geometry) => {
      for (const languages of pairs) {
        const layout = await layOutImmersive(
          words('table_tent', [...languages], TITLES_120),
          geometry,
        )
        expect(wordsToCode(layout)).toBeGreaterThanOrEqual(FIT.gapPt.floor - 1e-6)
        expect(sizesOf(layout)).toMatchObject({ place2: 9, head2: 11.5, sub2: 9 })
      }
    },
  )
})
