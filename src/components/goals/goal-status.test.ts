import { describe, expect, it } from 'vitest'
import { GOAL_STATUS, goalResultStatus } from './goal-status'

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

describe('a goal month result', () => {
  it('is achieved or not achieved once the month could be judged', () => {
    expect(goalResultStatus({ state: 'eligible', achieved: true }, false)).toEqual({
      label: 'Achieved',
      tone: 'positive',
    })
    expect(goalResultStatus({ state: 'eligible', achieved: false }, false)).toEqual({
      label: 'Not achieved',
      tone: 'negative',
    })
    expect(goalResultStatus({ state: 'eligible', achieved: null }, false)).toEqual({
      label: 'Not achieved',
      tone: 'negative',
    })
  })

  it.each([
    ['insufficient_data', 'More ratings needed', 'neutral'],
    ['updating', 'Updating', 'neutral'],
    ['quarantined', 'Needs review', 'warn'],
    ['unavailable', 'Unavailable', 'neutral'],
  ] as const)('says why a %s month has no verdict: "%s"', (state, label, tone) => {
    expect(goalResultStatus({ state, achieved: null }, false)).toEqual({ label, tone })
  })

  it('marks a corrected result in the label and keeps its tone', () => {
    expect(goalResultStatus({ state: 'eligible', achieved: true }, true)).toEqual({
      label: 'Corrected · Achieved',
      tone: 'positive',
    })
  })
})
