import { describe, expect, it } from 'vitest'
import { GOAL_STATUS } from './goal-status'

describe('a goal program status', () => {
  it('reads as a word, never as the stored token', () => {
    for (const [status, presentation] of Object.entries(GOAL_STATUS)) {
      expect(presentation.label).not.toBe(status)
      expect(presentation.label).toMatch(/^[A-Z]/u)
    }
  })

  it.each([
    ['scheduled', 'Scheduled', 'neutral'],
    ['active', 'Active', 'positive'],
    ['paused', 'Paused', 'warn'],
    ['ended', 'Ended', 'neutral'],
  ] as const)('%s is "%s" in the %s tone', (status, label, tone) => {
    expect(GOAL_STATUS[status]).toEqual({ label, tone })
  })
})
