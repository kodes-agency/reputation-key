import { describe, expect, it } from 'vitest'
import type { PrintTextBlock } from './portal-print-kit'
import type { PrintFinalFace } from './portal-print-final'
import type { PrintFinalFaceLayout } from './portal-print-final-face'
import { printFinalBlocks } from './portal-print-final-languages'
import {
  printFinalEveryCard,
  printFinalMenuRows,
  printFinalShortenBy,
  printFinalWordsFit,
  type PrintFinalLayoutFor,
} from './portal-print-final-words-fit'

// A stand-in planner: a headline of up to `room` characters fits at full size on
// a wide face, steps on an upright one, and longer ones are refused.
function stubLayout(room: number): PrintFinalLayoutFor {
  return (face, blocks, ownStepOnly) => {
    const headline = blocks[0]?.headline ?? ''
    const overflows = headline.length > (face.orientation === 'wide' ? room : room - 5)
    const stepped = ownStepOnly === true ? face.orientation === 'upright' : true
    return {
      overflows,
      headlinePt: overflows ? 16.5 : stepped && headline.length > 10 ? 17 : 19,
      plan: { parts: [{ key: 'headline', lines: 2 }] },
    } as unknown as PrintFinalFaceLayout
  }
}

const tent = (orientation: PrintFinalFace['orientation']): PrintFinalFace => ({
  piece: 'tent',
  orientation,
  look: 'paper',
  region: 'us',
})

const words = (headline: string): readonly PrintTextBlock[] => [
  { locale: 'en', kicker: 'Reception', headline, subline: '' },
]

describe('printFinalWordsFit (spec 5.7)', () => {
  it('says the wide face steps only for the upright one, which refuses the words', () => {
    const fit = printFinalWordsFit(
      tent('wide'),
      words('Thanks for choosing us'),
      stubLayout(25),
    )
    expect(fit).toMatchObject({
      state: 'step',
      headlinePt: 17,
      otherRefused: true,
      steppedForOther: true,
      headlineLines: 2,
      secondMode: 'one',
    })
  })

  it('refuses words the chosen orientation cannot hold at the floor', () => {
    expect(
      printFinalWordsFit(tent('upright'), words('x'.repeat(30)), stubLayout(25)).state,
    ).toBe('refused')
  })
})

describe('printFinalShortenBy (spec 5.7)', () => {
  it('counts the characters past the longest run of whole words that fits, dropping a trailing comma', () => {
    const fits = (headline: string) => headline.length <= 37
    expect(
      printFinalShortenBy('Tell us how your visit went today, in a few taps', fits),
    ).toBe(11)
  })

  it('says nothing when not even the first word fits', () => {
    expect(printFinalShortenBy('Supercalifragilistic words', () => false)).toBeNull()
  })
})

describe('printFinalMenuRows (spec 5.5)', () => {
  const blocksOf = (preset: Parameters<typeof printFinalBlocks>[1]['preset']) =>
    printFinalBlocks(['en', 'de'], { preset }, {}, 'Reception')

  it('greys a wording the planner refuses and holds back a copy rule F holds', () => {
    const rows = printFinalMenuRows(
      tent('upright'),
      ['en', 'de'],
      blocksOf,
      stubLayout(20),
    )
    expect(rows.map((row) => [row.preset, row.state, row.heldIn])).toEqual([
      ['how_did_we_do', 'fits', null],
      ['how_was_visit', 'too_long', null],
      ['how_was_stay', 'too_long', null],
      ['rate_visit', 'fits', null],
      ['got_30_seconds', 'held', 'de'],
    ])
  })
})

describe('printFinalEveryCard (spec 5.7, panel 9)', () => {
  it('lists every piece, wide then upright, in the board’s order', () => {
    const rows = printFinalEveryCard(
      { look: 'paper', region: 'us' },
      words('How was today?'),
      stubLayout(25),
    )
    expect(rows.map((row) => `${row.piece} ${row.orientation} ${row.state}`)).toEqual([
      'tent wide step',
      'tent upright step',
      'counter wide step',
      'counter upright step',
      // The Small card's full size is 15 pt, under the stand-in's step.
      'small wide full',
      'small upright full',
    ])
  })
})
