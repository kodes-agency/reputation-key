import { describe, expect, it } from 'vitest'
import { aiError, isAiError } from './errors'

describe('AI domain errors', () => {
  it('constructs closed tagged errors with optional context', () => {
    expect(
      aiError('provider_unavailable', 'provider failed', { retryable: true }),
    ).toEqual({
      _tag: 'AiError',
      code: 'provider_unavailable',
      message: 'provider failed',
      context: { retryable: true },
    })
    expect(aiError('forbidden', 'denied')).not.toHaveProperty('context')
  })

  it.each([
    [aiError('invalid_request', 'invalid'), true],
    [null, false],
    ['AiError', false],
    [{}, false],
    [{ _tag: 'OtherError' }, false],
  ])('recognizes only AI errors', (value, expected) => {
    expect(isAiError(value)).toBe(expected)
  })
})
