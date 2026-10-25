import { describe, expect, it } from 'vitest'
import { GUEST_LOCALES, type GuestLocale } from '#/shared/domain/guest-locale'
import {
  PRINT_FINAL_LOOKS,
  PRINT_FINAL_ORIENTATIONS,
  PRINT_FINAL_PIECES,
  type PrintFinalFace,
} from '#/shared/domain/portal-print-final'
import { choosePrintFinalTile } from '#/shared/domain/portal-print-final-code'
import {
  PRINT_FINAL_CALLS_TO_ACTION,
  printFinalCopyStatus,
  type PrintFinalCallToAction,
} from '#/shared/domain/portal-print-final-copy'
import { layoutPrintFinalFace } from '#/shared/domain/portal-print-final-face'
import { printFinalBlocks } from '#/shared/domain/portal-print-final-languages'
import {
  printFinalWordsFit,
  type PrintFinalLayoutFor,
} from '#/shared/domain/portal-print-final-words-fit'
import twoLanguages from './__fixtures__/portal-print-final-two-language-fit.json'
import { newDocument } from './__fixtures__/print-kit-face-fixtures'
import { pdfFinalMeasurer } from './print-kit-final-face'

// Rule F, the release gate for a wording's copy in a language (spec 5.5, 12.1):
// with one language it fits all 12 layouts (three pieces, both orientations,
// Paper and Immersive), in the US and in Europe, at or above the floor, its
// headline on 3 lines at most, measured with the fonts the PDF embeds. A copy
// that misses must be held back (`printFinalCopyStatus` says `held`) until a
// shorter draft passes, so this test fails when a released copy stops fitting.
// The record of two languages, English with each other language in both
// orders, shows in review when a change to the planner greys more wordings.

const { doc, fonts } = newDocument()
const measurer = pdfFinalMeasurer(doc, fonts)

const layoutFor: PrintFinalLayoutFor = (face, blocks, ownStepOnly) =>
  layoutPrintFinalFace({
    face,
    blocks,
    // A wide badge, on its plate where the look puts one: the stand-in boards' brand.
    brand: {
      kind: 'logo',
      inkWidth: 2,
      inkHeight: 1,
      onPlate: face.look === 'immersive',
    },
    tile: choosePrintFinalTile({
      ...face,
      address: 'short',
      symbolModules: 29,
    })._unsafeUnwrap(),
    measurer,
    ownStepOnly,
  })

const LAYOUTS: readonly PrintFinalFace[] = (['us', 'eu'] as const).flatMap((region) =>
  PRINT_FINAL_PIECES.flatMap((piece) =>
    PRINT_FINAL_ORIENTATIONS.flatMap((orientation) =>
      PRINT_FINAL_LOOKS.map((look) => ({ piece, orientation, look, region })),
    ),
  ),
)

const nameOf = (face: PrintFinalFace) =>
  `${face.piece}-${face.orientation}-${face.look}-${face.region}`

/** The layouts that refuse a wording in these languages, or whose headline takes more than 3 lines. */
function refusals(preset: PrintFinalCallToAction, languages: readonly GuestLocale[]) {
  const blocks = printFinalBlocks(languages, { preset }, {}, 'Reception')
  return LAYOUTS.filter((face) => {
    const fit = printFinalWordsFit(face, blocks, layoutFor)
    return fit.state === 'refused' || fit.headlineLines > 3
  }).map(nameOf)
}

describe('rule F: a wording’s copy is released only where it fits every layout (spec 5.5)', () => {
  for (const preset of PRINT_FINAL_CALLS_TO_ACTION) {
    for (const locale of GUEST_LOCALES) {
      const held = printFinalCopyStatus(locale, preset) === 'held'
      // The held copies missed in the brainstorm's sweep, before the short scan
      // cue; with it they fit too, and wait on their native check and a shorter
      // draft (slice C9) before they are released.
      it(`${preset} in ${locale} fits all 24 layouts${held ? ' (held for its native check)' : ''}`, () => {
        expect(refusals(preset, [locale])).toEqual([])
      })
    }
  }
})

describe('two languages, English with each other one in both orders (the menu’s record)', () => {
  const pairs = GUEST_LOCALES.filter((locale) => locale !== 'en').flatMap(
    (other): (readonly GuestLocale[])[] => [
      ['en', other],
      [other, 'en'],
    ],
  )
  const record = Object.fromEntries(
    PRINT_FINAL_CALLS_TO_ACTION.flatMap((preset) =>
      pairs.map((languages) => [
        `${preset} ${languages.join('+')}`,
        refusals(preset, languages),
      ]),
    ),
  )

  it('refuses each wording on the layouts the record names, and no others', () => {
    expect(record).toEqual(twoLanguages)
  })
})
