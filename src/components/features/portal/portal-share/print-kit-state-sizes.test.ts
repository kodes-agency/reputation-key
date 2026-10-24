import { describe, expect, it } from 'vitest'
import { type PrintKitChoice } from '#/shared/domain/portal-print-kit'
import { CODE_TILE, TODAY_CODE_TILE } from '#/shared/domain/portal-print-kit-code-tile'
import {
  initialPrintKitChoice,
  printKitBarMeasure,
  reconcilePrintKitChoice,
} from './print-kit-state'

// The Share tab's choice once a print has a size, an output and a name line
// (round-3 spec-delta S7): what it starts on, how it is settled when a size, piece
// or language stops being offered, and the bar its tile makes.

const CARD: PrintKitChoice = {
  style: 'paper',
  paper: 'letter',
  size: 'large',
  output: 'office',
  piece: 'counter_card',
  languages: ['en', 'bg'],
  callToAction: 'rate',
  showPropertyName: true,
}

const ALL_SIZES = ['large', 'table', 'mini'] as const

describe('initialPrintKitChoice, at a size', () => {
  it('starts on Large while Large is the only size offered, and on Table once it is offered', () => {
    expect(initialPrintKitChoice(['en'], 'US').size).toBe('large')
    expect(initialPrintKitChoice(['en'], 'US', ALL_SIZES).size).toBe('table')
    expect(initialPrintKitChoice(['en'], 'US', ['large', 'mini']).size).toBe('large')
  })

  it('starts a Mini-only portal on one language', () => {
    expect(initialPrintKitChoice(['en', 'bg'], 'US', ['mini'])).toMatchObject({
      size: 'mini',
      languages: ['en'],
    })
  })

  it('prints the property’s name under the logo until the manager says not to', () => {
    expect(initialPrintKitChoice(['en'], 'US').showPropertyName).toBe(true)
  })
})

describe('reconcilePrintKitChoice, at a size', () => {
  it('settles a size that is no longer offered on the size managers start on', () => {
    const mini = { ...CARD, size: 'mini', languages: ['en'] } as const
    expect(reconcilePrintKitChoice(mini, ['en', 'bg'], 'US').size).toBe('large')
    expect(reconcilePrintKitChoice(mini, ['en', 'bg'], 'US', ['large', 'mini'])).toBe(
      mini,
    )
  })

  it('gives a Mini card one language, the larger, since it prints one', () => {
    const chosen = { ...CARD, size: 'mini' } as const
    const settled = reconcilePrintKitChoice(chosen, ['en', 'bg'], 'US', ALL_SIZES)
    expect(settled.languages).toEqual(['en'])
  })

  it('turns a tent at Mini into a card, and an output the print cannot take into its style’s own', () => {
    const tent = {
      ...CARD,
      size: 'mini',
      piece: 'table_tent',
      languages: ['en'],
    } as const
    expect(reconcilePrintKitChoice(tent, ['en'], 'US', ALL_SIZES).piece).toBe(
      'counter_card',
    )
    const shop = { ...CARD, output: 'print_shop' } as const
    expect(reconcilePrintKitChoice(shop, ['en', 'bg'], 'US', ALL_SIZES).output).toBe(
      'office',
    )
  })
})

describe('printKitBarMeasure', () => {
  const large = { piece: 'counter_card', size: 'large', paper: 'letter' } as const

  it('names the bar the tile makes, in the unit the paper is cut in', () => {
    expect(printKitBarMeasure(large, CODE_TILE.large.letter.tilePt, false)).toBe(
      '1.75 in (4.4 cm)',
    )
    expect(
      printKitBarMeasure(
        { ...large, size: 'table', paper: 'a4' },
        CODE_TILE.table.a4.tilePt,
        false,
      ),
    ).toBe('36 mm (3.6 cm)')
    expect(
      printKitBarMeasure({ ...large, size: 'mini' }, CODE_TILE.mini.letter.tilePt, true),
    ).toBe('1.25 in (3.2 cm)')
  })

  it('gives today’s 2 in bar too for a Large card whose address is not known: a long address prints on it', () => {
    expect(printKitBarMeasure(large, CODE_TILE.large.letter.tilePt, true)).toBe(
      '1.75 in (4.4 cm), or 2 in (5.1 cm) if the code still has a long address',
    )
  })

  it('names the 2 in bar of the Letter-half tent, which never changes', () => {
    expect(
      printKitBarMeasure(
        { piece: 'table_tent', size: 'large', paper: 'letter' },
        TODAY_CODE_TILE.tilePt,
        true,
      ),
    ).toBe('2 in (5.1 cm)')
  })
})
