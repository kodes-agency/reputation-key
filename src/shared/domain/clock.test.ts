import { describe, expect, it } from 'vitest'
import { strictlyAfter } from './clock'

const EARLIER = new Date('2026-10-13T09:00:00.000Z')

describe('strictlyAfter', () => {
  it('keeps the clock reading when it has moved past the earlier instant', () => {
    const now = new Date('2026-10-13T09:00:00.250Z')

    expect(strictlyAfter(EARLIER, now)).toBe(now)
  })

  it.each([
    ['has not moved', new Date(EARLIER)],
    ['went backwards', new Date('2026-10-13T08:59:59.000Z')],
  ])(
    'answers the instant just after the earlier one when the clock %s',
    (_label, now) => {
      expect(strictlyAfter(EARLIER, now)).toEqual(new Date('2026-10-13T09:00:00.001Z'))
    },
  )
})
