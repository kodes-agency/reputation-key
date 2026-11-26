import { describe, expect, it } from 'vitest'
import { goalFigure, goalSoFarNote } from './goal-so-far'

describe('goalFigure', () => {
  it('prints a count as a whole number with its separator', () => {
    expect(goalFigure('portal_rating_count', 1412)).toBe('1,412')
  })

  it('prints an average to one decimal', () => {
    expect(goalFigure('portal_rating_average', 4)).toBe('4.0')
  })
})

describe('goalSoFarNote', () => {
  it('prints the figure for the month still running', () => {
    const note = goalSoFarNote('portal_rating_count', {
      kind: 'live',
      value: 412,
      sampleCount: 412,
    })

    expect(note).toBe('412 so far')
  })

  it('says why an average has no figure yet', () => {
    const note = goalSoFarNote('portal_rating_average', {
      kind: 'too_few',
      sampleCount: 6,
      minimumSample: 10,
    })

    expect(note).toBe('Too few ratings so far: 6 of the 10 an average needs')
  })

  it('says a figure cannot be read rather than leave a gap that looks like none', () => {
    const note = goalSoFarNote('qualified_scans', { kind: 'unavailable' })

    expect(note).toBe('This month’s figure can’t be read right now')
  })

  it('says nothing for a goal that is not counting', () => {
    const note = goalSoFarNote('qualified_scans', { kind: 'not_started' })

    expect(note).toBeNull()
  })
})
