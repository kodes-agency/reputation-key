import { describe, expect, it } from 'vitest'
import { classifyOpenAiStatus } from '../dispositions'
import {
  classifyAnthropicRefusal,
  classifyAnthropicStatus,
  isAnthropicQuotaExhaustedBody,
} from './dispositions'

const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value))

describe('Anthropic response dispositions', () => {
  it.each([
    [200, 'success', false],
    [400, 'provider_refused', false],
    [401, 'provider_unavailable', false],
    [402, 'quota_exhausted', false],
    [403, 'provider_unavailable', false],
    [404, 'provider_unavailable', false],
    [408, 'provider_unavailable', false],
    [409, 'provider_unavailable', false],
    [413, 'provider_refused', false],
    [422, 'provider_refused', false],
    [429, 'rate_limited', true],
    [500, 'provider_unavailable', true],
    [502, 'provider_unavailable', true],
    [503, 'provider_unavailable', true],
    [504, 'provider_unavailable', true],
    [529, 'provider_unavailable', true],
    [307, 'provider_unavailable', false],
  ] as const)('classifies %i as %s', (status, disposition, retryable) => {
    expect(classifyAnthropicStatus(status)).toMatchObject({ disposition, retryable })
  })

  it('matches OpenAI for every status except Anthropic billing and overload rows', () => {
    for (let status = 100; status <= 599; status += 1) {
      if (status === 402 || status === 529) continue
      const anthropic = classifyAnthropicStatus(status)
      const openAi = classifyOpenAiStatus(status)
      expect({
        disposition: anthropic.disposition,
        retryable: anthropic.retryable,
        circuitFailure: anthropic.circuitFailure,
      }).toEqual({
        disposition: openAi.disposition,
        retryable: openAi.retryable,
        circuitFailure: openAi.circuitFailure,
      })
    }
  })

  it.each([
    [
      400,
      'invalid_request_error',
      'You have reached your specified API usage limits today',
      undefined,
      true,
    ],
    [
      400,
      'invalid_request_error',
      ' YOUR CREDIT BALANCE IS TOO LOW for this request',
      undefined,
      true,
    ],
    [400, 'invalid_request_error', 'ordinary invalid request', undefined, false],
    [429, 'rate_limit_error', 'tier cap', 'enforced_spend_limit_reached', true],
    [429, 'rate_limit_error', 'ordinary rate limit', undefined, false],
    [402, 'billing_error', 'billing failed', undefined, true],
  ] as const)(
    'detects quota status %i with the documented body fields',
    (status, type, message, errorCode, expected) => {
      expect(
        isAnthropicQuotaExhaustedBody({
          status,
          bytes: bytes({
            error: {
              type,
              message,
              ...(errorCode === undefined ? {} : { details: { error_code: errorCode } }),
            },
          }),
          maxBytes: 4_096,
        }),
      ).toBe(expected)
    },
  )

  it.each([
    [
      400,
      { error: { type: 'invalid_request_error', message: 'ordinary' } },
      'provider_refused',
      false,
      false,
      null,
    ],
    [
      400,
      {
        error: {
          type: 'invalid_request_error',
          message: 'Your credit balance is too low',
        },
      },
      'quota_exhausted',
      false,
      true,
      null,
    ],
    [402, {}, 'quota_exhausted', false, true, null],
    [
      429,
      { error: { type: 'rate_limit_error', message: 'ordinary' } },
      'rate_limited',
      true,
      true,
      7,
    ],
    [
      429,
      {
        error: {
          type: 'rate_limit_error',
          message: 'cap',
          details: { error_code: 'enforced_spend_limit_reached' },
        },
      },
      'quota_exhausted',
      false,
      true,
      null,
    ],
    [
      529,
      { error: { type: 'overloaded_error', message: 'busy' } },
      'provider_unavailable',
      true,
      true,
      7,
    ],
  ] as const)(
    'classifies a complete %i answer as %s',
    (status, body, disposition, providerRetryable, usageKnown, retryAfterSeconds) => {
      expect(
        classifyAnthropicRefusal(
          {
            completeStatus: status,
            decodedResponseBytes: bytes(body),
            retryAfterSeconds: 7,
          },
          4_096,
        ),
      ).toEqual({ disposition, providerRetryable, usageKnown, retryAfterSeconds })
    },
  )
})
