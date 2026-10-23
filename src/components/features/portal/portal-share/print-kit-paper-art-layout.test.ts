import { describe, expect, it } from 'vitest'
import { printKitSheetLabel, ptToContainerWidth } from './print-kit-paper-art-layout'

describe('printKitSheetLabel', () => {
  it('says the sheet, the cards on it and the page, as the Share tab’s caption does', () => {
    expect(
      printKitSheetLabel('counter_card', 'letter', { index: 0, count: 2, faces: 2 }),
    ).toBe('Letter · two 4 × 6 in counter cards · page 1 of 2, fronts')
    expect(
      printKitSheetLabel('counter_card', 'a4', { index: 1, count: 2, faces: 4 }),
    ).toBe('A4 · four A6 counter cards · page 2 of 2, backs')
    expect(printKitSheetLabel('table_tent', 'a4', { index: 0, count: 1, faces: 2 })).toBe(
      'A4 · table tent, folded in half to two A5 faces',
    )
  })
})

describe('ptToContainerWidth', () => {
  it('turns points into a share of the face’s width', () => {
    expect(ptToContainerWidth(144, 288)).toBe('50cqw')
    expect(ptToContainerWidth(18, 612)).toBe('2.9412cqw')
  })
})
