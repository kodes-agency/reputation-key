import { describe, expect, it } from 'vitest'
import {
  PREREQUISITE_QUIET_ATTEMPTS,
  deliveryRetryDelayMs,
  escalateStalePrerequisiteWait,
  prerequisiteRetryDelayMs,
} from './dispatch-job-options'
import { PrerequisiteNotReadyError } from './prerequisite-not-ready'

describe('prerequisiteRetryDelayMs', () => {
  it('retries the first attempt sooner than an ordinary failure', () => {
    expect(prerequisiteRetryDelayMs(1)).toBeLessThan(deliveryRetryDelayMs(1))
  })

  it('grows with the attempt and stops at a minute', () => {
    expect(prerequisiteRetryDelayMs(2)).toBeGreaterThan(prerequisiteRetryDelayMs(1))
    expect(prerequisiteRetryDelayMs(30)).toBe(60_000)
  })
})

describe('escalateStalePrerequisiteWait', () => {
  const wait = new PrerequisiteNotReadyError('waiting')

  it('keeps a young wait quiet', () => {
    expect(escalateStalePrerequisiteWait(wait, PREREQUISITE_QUIET_ATTEMPTS - 1)).toBe(
      wait,
    )
  })

  it('turns a wait past its quiet window into an ordinary error with the wait as cause', () => {
    const escalated = escalateStalePrerequisiteWait(wait, PREREQUISITE_QUIET_ATTEMPTS)
    expect(escalated).toBeInstanceOf(Error)
    expect(escalated).not.toBeInstanceOf(PrerequisiteNotReadyError)
    expect((escalated as Error).cause).toBe(wait)
  })

  it('passes a real error through at any attempt', () => {
    const real = new Error('boom')
    expect(escalateStalePrerequisiteWait(real, 99)).toBe(real)
  })
})
