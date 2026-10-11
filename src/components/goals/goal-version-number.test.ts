import { describe, expect, it } from 'vitest'
import { goalVersionNumber } from './goal-version-number'

const at = (iso: string) => new Date(iso)
// The first instants of two Sofia months.
const OCTOBER = at('2026-09-30T21:00:00.000Z')
const NOVEMBER = at('2026-10-31T22:00:00.000Z')

const version = (id: string, effectiveFrom: Date, effectiveTo: Date | null) => ({
  id,
  effectiveFrom,
  effectiveTo,
})

describe('goalVersionNumber', () => {
  it('counts the plan a goal was created with as the first', () => {
    const head = version('v1', OCTOBER, null)

    expect(goalVersionNumber([head], head)).toBe(1)
  })

  it('does not count a plan replaced before it began', () => {
    // Edited twice before November: neither replaced plan covered a month.
    const head = version('v3', NOVEMBER, null)
    const versions = [
      version('v1', NOVEMBER, NOVEMBER),
      version('v2', NOVEMBER, NOVEMBER),
      head,
    ]

    expect(goalVersionNumber(versions, head)).toBe(1)
  })

  it('counts every plan that was in force, and the one now shown', () => {
    // October counted under the first plan; the change waiting for November
    // was itself replaced before November began.
    const head = version('v3', NOVEMBER, null)
    const versions = [
      version('v1', OCTOBER, NOVEMBER),
      version('v2', NOVEMBER, NOVEMBER),
      head,
    ]

    expect(goalVersionNumber(versions, head)).toBe(2)
  })

  it('counts the plan of a goal ended before it started', () => {
    const head = version('v1', NOVEMBER, NOVEMBER)

    expect(goalVersionNumber([head], head)).toBe(1)
  })
})
