import { describe, expect, it } from 'vitest'
import { describeStatesSummary } from './portal-review-states'

describe('describeStatesSummary', () => {
  it('says how many languages the states are drawn in', () => {
    expect(describeStatesSummary(4)).toBe(
      'Arrival, after each rating and done · in 4 languages',
    )
    expect(describeStatesSummary(1)).toBe(
      'Arrival, after each rating and done · in 1 language',
    )
  })
})
