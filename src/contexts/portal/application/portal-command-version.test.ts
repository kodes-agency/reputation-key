import { describe, expect, it } from 'vitest'
import { nextPortalCommandAt } from './portal-command-version'

describe('nextPortalCommandAt', () => {
  const current = new Date('2026-08-26T10:00:00.000Z')

  it('advances the revision when the wall clock has not moved', () => {
    expect(nextPortalCommandAt(current, current)).toEqual(
      new Date('2026-08-26T10:00:00.001Z'),
    )
  })

  it('retains a later wall-clock instant', () => {
    const later = new Date('2026-08-26T10:00:01.000Z')
    expect(nextPortalCommandAt(later, current)).toBe(later)
  })
})
