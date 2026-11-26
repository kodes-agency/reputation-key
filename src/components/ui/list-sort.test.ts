import { describe, expect, it } from 'vitest'
import { directionsFor } from './list-sort'

describe('directionsFor', () => {
  it('lists the natural direction first, so "A to Z" reads before "Z to A"', () => {
    expect(directionsFor('asc')).toEqual(['asc', 'desc'])
  })

  it('lists a most-first sort descending first', () => {
    expect(directionsFor('desc')).toEqual(['desc', 'asc'])
  })
})
