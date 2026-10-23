import { describe, expect, it } from 'vitest'
import { shareGaps } from './print-kit-gaps'

describe('shareGaps', () => {
  it('shares the spare height equally when every gap clears its minimum', () => {
    expect(shareGaps(30, [4, 3])).toEqual([15, 15])
    expect(shareGaps(60, [11, 4, 9])).toEqual([20, 20, 20])
  })

  it('holds a gap at its minimum and gives the rest to the others', () => {
    // Equal shares would be 5 each, under the first gap's 8.
    expect(shareGaps(10, [8, 1])).toEqual([8, 2])
    expect(shareGaps(30, [16, 2, 2])).toEqual([16, 7, 7])
  })

  it('leaves every gap at its minimum when the minimums do not fit', () => {
    expect(shareGaps(5, [4, 3])).toEqual([4, 3])
  })

  it('shares nothing among no gaps', () => {
    expect(shareGaps(10, [])).toEqual([])
  })
})
