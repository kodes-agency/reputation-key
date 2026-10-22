import { afterEach, describe, expect, it, vi } from 'vitest'
import { describeFailure, requiredEnv, runActionStep } from './action-step.ts'

describe('requiredEnv', () => {
  it('returns the trimmed value', () => {
    expect(requiredEnv({ NAME: '  value ' }, 'NAME')).toBe('value')
  })

  it('names the variable, with the hint, when it is empty or blank', () => {
    expect(() => requiredEnv({ NAME: '   ' }, 'NAME', ': add it')).toThrow(
      /^NAME is empty: add it$/u,
    )
    expect(() => requiredEnv({}, 'NAME')).toThrow(/^NAME is empty$/u)
  })
})

describe('describeFailure', () => {
  it('adds the cause a network error carries', () => {
    const error = new TypeError('fetch failed', {
      cause: new Error('getaddrinfo ENOTFOUND us.sentry.io'),
    })

    expect(describeFailure(error)).toBe(
      'fetch failed (getaddrinfo ENOTFOUND us.sentry.io)',
    )
  })

  it('reads anything that is not an Error as text', () => {
    expect(describeFailure('plain')).toBe('plain')
  })
})

describe('runActionStep', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('prints what the step reports and exits 0', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)

    await expect(runActionStep(async () => ['first', 'second'])).resolves.toBe(0)
    expect(log.mock.calls).toEqual([['first'], ['second']])
  })

  it('prints a workflow error with the cause and exits 1', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await expect(
      runActionStep(async () => {
        throw new Error('outer', { cause: new Error('inner') })
      }),
    ).resolves.toBe(1)
    expect(error.mock.calls).toEqual([['::error::outer (inner)']])
  })
})
