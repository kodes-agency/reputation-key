import { describe, expect, it } from 'vitest'
import { goalListSearchSchema } from './-goal-list-search'

describe('goalListSearchSchema', () => {
  it('opens the active goals when the address names no view', () => {
    expect(goalListSearchSchema.parse({})).toEqual({ view: 'active' })
  })

  it('reads the history view and the result a goal notice links to', () => {
    expect(goalListSearchSchema.parse({ view: 'history', result: 'result-1' })).toEqual({
      view: 'history',
      result: 'result-1',
    })
  })

  // Anyone can type an address. A view the page does not have opens the active
  // goals, as no view does, instead of failing the page.
  it('opens the active goals for a view it does not know', () => {
    expect(goalListSearchSchema.parse({ view: 'all' })).toEqual({ view: 'active' })
    expect(goalListSearchSchema.parse({ view: 7 })).toEqual({ view: 'active' })
  })

  it('drops a result it cannot read and keeps the view', () => {
    // The router reads `?result=42` as a number.
    expect(goalListSearchSchema.parse({ view: 'history', result: 42 })).toEqual({
      view: 'history',
    })
  })

  it('reads a request to open the Google rating goal wizard on arrival', () => {
    expect(goalListSearchSchema.parse({ start: 'rating-goal' })).toEqual({
      view: 'active',
      start: 'rating-goal',
    })
  })

  it('drops a start it does not know', () => {
    expect(goalListSearchSchema.parse({ start: 'portal-goal' })).toEqual({
      view: 'active',
    })
  })
})
