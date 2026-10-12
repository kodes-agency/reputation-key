import { describe, expect, it } from 'vitest'
import { directionsFor, SORT_DIRECTIONS } from './list-sort'

describe('directionsFor', () => {
  it('lists the natural direction first, so "A to Z" reads before "Z to A"', () => {
    expect(directionsFor('asc')).toEqual(['asc', 'desc'])
  })

  it('lists a most-first sort descending first', () => {
    expect(directionsFor('desc')).toEqual(['desc', 'asc'])
  })

  it('offers every direction exactly once', () => {
    expect([...directionsFor('asc')].sort()).toEqual([...SORT_DIRECTIONS].sort())
  })
})
