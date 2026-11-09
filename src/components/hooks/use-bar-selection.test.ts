// Which bar a pointer chooses: the one drawn under it, however the bars are spaced.
import { describe, expect, it } from 'vitest'
import { chosenIndex } from './use-bar-selection'

describe('choosing a bar with the pointer', () => {
  it('splits an evenly drawn plot into equal shares', () => {
    expect(chosenIndex(0.1, 4)).toBe(0)
    expect(chosenIndex(0.26, 4)).toBe(1)
    expect(chosenIndex(0.99, 4)).toBe(3)
  })

  it('keeps a pointer past either edge on the first or last bar', () => {
    expect(chosenIndex(-0.2, 4)).toBe(0)
    expect(chosenIndex(1.4, 4)).toBe(3)
  })

  it('chooses the nearest stop when the stops are unevenly spaced', () => {
    // Three weeks close together, then a long gap to the fourth.
    const stops = [0.05, 0.1, 0.15, 0.9]
    expect(chosenIndex(0.12, stops.length, stops)).toBe(1)
    expect(chosenIndex(0.5, stops.length, stops)).toBe(2)
    expect(chosenIndex(0.6, stops.length, stops)).toBe(3)
  })

  it('takes the earlier stop when the pointer is exactly between two', () => {
    expect(chosenIndex(0.5, 2, [0.25, 0.75])).toBe(0)
  })

  it('chooses nothing when there are no bars', () => {
    expect(chosenIndex(0.5, 0)).toBe(0)
  })
})
