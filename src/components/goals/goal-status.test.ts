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
  it('a met month is Met in the positive tone', () => {
    expect(goalResultStatus({ state: 'eligible', achieved: true }, false)).toEqual({
      label: 'Met',
      tone: 'positive',
    })
  })

  it('a missed month is Not met and never red', () => {
    for (const achieved of [false, null]) {
      expect(goalResultStatus({ state: 'eligible', achieved }, false)).toEqual({
        label: 'Not met',
        tone: 'neutral',
      })
    }
  })

  it('a month being checked is neutral', () => {
    expect(goalResultStatus({ state: 'quarantined', achieved: null }, false)).toEqual({
      label: 'Being checked',
      tone: 'neutral',
    })
  })

  it.each([
    ['insufficient_data', 'More ratings needed', 'neutral'],
    ['updating', 'Updating', 'neutral'],
    ['unavailable', 'Unavailable', 'neutral'],
  ] as const)('says why a %s month has no verdict: "%s"', (state, label, tone) => {
    expect(goalResultStatus({ state, achieved: null }, false)).toEqual({ label, tone })
  })

  it('marks a corrected result in the label and keeps its tone', () => {
    expect(goalResultStatus({ state: 'eligible', achieved: true }, true)).toEqual({
      label: 'Corrected · Met',
      tone: 'positive',
    })
    expect(goalResultStatus({ state: 'eligible', achieved: false }, true)).toEqual({
      label: 'Corrected · Not met',
      tone: 'neutral',
    })
  })
})
