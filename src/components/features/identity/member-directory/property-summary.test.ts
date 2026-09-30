import { describe, expect, it } from 'vitest'
import { summarizeProperties } from './property-summary'

const named = (...names: string[]) => names.map((name) => ({ name }))

describe('summarizeProperties', () => {
  it('names every property when there are two or fewer', () => {
    expect(summarizeProperties(named('Sofia', 'Varna'))).toEqual({
      shown: ['Sofia', 'Varna'],
      hiddenCount: 0,
      all: 'Sofia, Varna',
    })
  })

  it('counts the properties past the second instead of naming them', () => {
    expect(summarizeProperties(named('Sofia', 'Varna', 'Burgas', 'Plovdiv'))).toEqual({
      shown: ['Sofia', 'Varna'],
      hiddenCount: 2,
      all: 'Sofia, Varna, Burgas, Plovdiv',
    })
  })

  it('has nothing to show for no properties', () => {
    expect(summarizeProperties([])).toEqual({ shown: [], hiddenCount: 0, all: '' })
  })
})
