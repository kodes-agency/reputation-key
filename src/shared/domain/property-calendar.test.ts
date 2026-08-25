import { describe, expect, it } from 'vitest'
import { shiftPropertyLocalDays } from './property-calendar'

describe('Property-local calendar arithmetic', () => {
  it('preserves local wall-clock time across the spring DST transition', () => {
    const noonAfterSpringForward = new Date('2026-03-08T16:00:00.000Z')

    expect(
      shiftPropertyLocalDays(noonAfterSpringForward, -1, 'America/New_York'),
    ).toEqual(new Date('2026-03-07T17:00:00.000Z'))
  })

  it('preserves local wall-clock time across the autumn DST transition', () => {
    const noonAfterFallBack = new Date('2026-11-01T17:00:00.000Z')

    expect(shiftPropertyLocalDays(noonAfterFallBack, -1, 'America/New_York')).toEqual(
      new Date('2026-10-31T16:00:00.000Z'),
    )
  })

  it('preserves sub-second precision at rolling-window boundaries', () => {
    const instant = new Date('2026-03-20T16:00:00.347Z')

    expect(shiftPropertyLocalDays(instant, -30, 'America/New_York')).toEqual(
      new Date('2026-02-18T17:00:00.347Z'),
    )
  })
})
